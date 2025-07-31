// backend/src/ws_logic.rs
use axum::extract::ws::Message;
use axum::extract::ws::WebSocket;
use dirs;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use shlex;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use tracing;

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WebSocketResponse {
    #[serde(rename = "output")]
    Output(String),
    #[serde(rename = "cwd_update")]
    CwdUpdate(String),
}

// 清理函数：移除 Xterm.js 无法解析的控制字符（特别是 DEL 字符）
fn clean_output(s: String) -> String {
    s.chars()
        .filter(|&c| {
            // 过滤掉 ASCII 控制字符 (0-31) 和 DEL (127)
            // 允许常见的可见字符，包括空格，以及换行符 \n 和回车符 \r
            (c >= '\u{0020}' && c <= '\u{007e}') || // 可打印 ASCII 字符
            c == '\n' || // 换行符
            c == '\r' || // 回车符
            (c >= '\u{0080}' && c != '\u{007f}') // 允许非 ASCII 的 UTF-8 字符 (非控制字符)
        })
        .collect()
}

pub async fn handle_socket(socket: WebSocket, peer: String) {
    let (mut sender, mut receiver) = socket.split();

    // 初始 CWD，修正为根目录或你期望的默认路径
    let mut current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));

    // 欢迎消息
    let welcome_msg = "Welcome to the Rust Web Terminal Backend!\r\n";
    sender
        .send(Message::Text(
            serde_json::to_string(&WebSocketResponse::Output(
                clean_output(welcome_msg.to_string()), // 清理欢迎消息
            ))
            .unwrap()
            .into(),
        ))
        .await
        .expect("Failed to send welcome message");

    // 初始 CWD 更新
    sender
        .send(Message::Text(
            serde_json::to_string(&WebSocketResponse::CwdUpdate(
                current_dir.display().to_string(),
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(msg) => match msg {
                Message::Text(text) => {
                    tracing::info!("Received message from {}: {}", peer, text);

                    let (response_raw, new_cwd) = process_command(&text.trim(), &current_dir).await;

                    if !response_raw.is_empty() {
                        sender
                            .send(Message::Text(
                                serde_json::to_string(&WebSocketResponse::Output(clean_output(
                                    response_raw,
                                ))) // 清理命令输出
                                .unwrap()
                                .into(),
                            ))
                            .await
                            .expect("Failed to send command output");
                    }

                    if new_cwd != current_dir {
                        current_dir = new_cwd;
                        sender
                            .send(Message::Text(
                                serde_json::to_string(&WebSocketResponse::CwdUpdate(
                                    current_dir.display().to_string(),
                                ))
                                .unwrap()
                                .into(),
                            ))
                            .await
                            .expect("Failed to send CWD update");
                    }
                }
                Message::Pong(_) => {
                    tracing::info!("Received Pong from {}", peer);
                }
                Message::Close(c) => {
                    tracing::info!("Connection closed by {}: {:?}", peer, c);
                    break;
                }
                _ => {
                    tracing::warn!("Unsupported message type from {}: {:?}", peer, msg);
                }
            },
            Err(err) => {
                tracing::error!("WebSocket error for `{}`: {}", peer, err);
                break;
            }
        }
    }
    tracing::info!("`{}` WebSocket connection closed.", peer);
}

async fn process_command(command_str: &str, current_dir: &Path) -> (String, PathBuf) {
    let parsed_command = shlex::split(command_str);

    if parsed_command.is_none() {
        return (
            "Error: Invalid command format (unclosed quotes or invalid escapes).\r\n".to_string(),
            current_dir.to_path_buf(),
        );
    }

    let parts = parsed_command.unwrap();

    if parts.is_empty() {
        return ("".to_string(), current_dir.to_path_buf());
    }

    let cmd = parts[0].to_lowercase();
    let args: Vec<&str> = parts[1..].iter().map(|s| s.as_str()).collect();

    let mut new_cwd = current_dir.to_path_buf();
    let response: String;

    match cmd.as_str() {
        "help" => {
            response = "\r\nAvailable Commands (handled by backend):\r\n\
            \x1b[32m  help\x1b[0m        - Show list of available commands\r\n\
            \x1b[32m  echo <text>\x1b[0m - Echoes the text you provide\r\n\
            \x1b[32m  about\x1b[0m       - About this backend\r\n\
            \x1b[32m  pwd\x1b[0m         - Prints working directory\r\n\
            \x1b[32m  ls\x1b[0m          - List directory contents\r\n\
            \x1b[32m  cd <path>\x1b[0m   - Change current directory\r\n\
            \x1b[32m  whoami\x1b[0m      - Print the user name associated with the current effective user ID\r\n"
                .to_string();
        }
        "cd" => {
            if args.is_empty() {
                if let Some(home) = dirs::home_dir() {
                    new_cwd = home;
                    response = "".to_string(); // **修正：cd 成功时返回空字符串**
                } else {
                    response = "Error: Could not find home directory.\r\n".to_string();
                }
            } else {
                let target_path_str = args[0];
                let target_path = PathBuf::from(target_path_str);

                let resolved_path = if target_path.is_absolute() {
                    target_path
                } else {
                    current_dir.join(target_path)
                };

                if let Ok(canonical_path) = resolved_path.canonicalize() {
                    if canonical_path.is_dir() {
                        new_cwd = canonical_path;
                        response = "".to_string(); // **修正：cd 成功时返回空字符串**
                    } else {
                        response = format!(
                            "Error: {} is not a directory or does not exist.\r\n",
                            target_path_str
                        );
                    }
                } else {
                    response = format!(
                        "Error: Path '{}' is invalid or does not exist.\r\n",
                        target_path_str
                    );
                }
            }
        }
        "pwd" => {
            response = format!("{}\r\n", current_dir.display());
        }
        "ls" | "whoami" => {
            let mut command_builder = Command::new(cmd.as_str());
            command_builder.current_dir(current_dir);

            for arg in &args {
                command_builder.arg(arg);
            }

            match command_builder.output().await {
                Ok(output) => {
                    if output.status.success() {
                        response =
                            clean_output(String::from_utf8_lossy(&output.stdout).to_string()); // 清理 stdout
                    } else {
                        response = clean_output(format!(
                            "Error executing {}: {}\r\n",
                            cmd,
                            String::from_utf8_lossy(&output.stderr)
                        )); // 清理 stderr
                    }
                }
                Err(e) => {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        response = format!(
                            "Error: Command '{}' not found. Is it installed and in your PATH?\r\n",
                            cmd
                        );
                    } else {
                        response = format!("Failed to execute {} command: {}\r\n", cmd, e);
                    }
                }
            }
        }
        "echo" => {
            let text_to_echo = args.join(" ");
            response = format!("{text_to_echo}\r\n");
        }
        "about" => {
            response = "This is the Rust Axum backend for your Web terminal.\r\n\
                        It handles commands sent via WebSocket.\r\n"
                .to_string();
        }
        "birthday" => response = "Happy Birthday ohhhhhyeahhhhhhh! 🎉🎂".to_string(),
        "heyeuuu" => response = "suki~~~Bless for sheeeeee~".to_string(),
        "creeper" => response = "suki~".to_string(),
        "" => response = "".to_string(),
        _ => response = format!("Unknown command: {}\r\n", command_str),
    }
    (response, new_cwd)
}
