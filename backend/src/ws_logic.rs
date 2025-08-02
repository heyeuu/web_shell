// backend/src/ws_logic.rs
use axum::extract::ws::Message;
use axum::extract::ws::WebSocket;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use shlex; // 用于解析命令字符串，处理引号和空格
use std::path::{Path, PathBuf};
use tokio::process::Command; // 用于执行系统命令
use tracing; // 日志库

// **修复 1: 统一 WebSocket 响应格式，与前端期望的 JSON 对象一致**
// 这个结构体现在与前端的 `WebSocketMessage` (在 webSocketService.ts 中) 完美匹配。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebSocketResponse {
    pub output: Option<String>,
    pub cwd_update: Option<String>,
}

const SANDBOX_ROOT: &str = "/home/heyeuuu/Workspace/secretes/happy_birthday";

// **修复 2: 命令处理函数返回的结果结构体**
// 内部使用这个结构体来封装命令处理结果，方便统一发送。
#[derive(Debug, Clone)]
struct CommandResult {
    output: String,           // 总是包含输出，即使是空字符串
    new_cwd: Option<PathBuf>, // 只有当 CWD 改变时才包含
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
            // (c >= '\u{0080}' && c != '\u{007f}') // 允许非 ASCII 的 UTF-8 字符 (非控制字符)
            // 注意：如果后端输出包含彩色文本（ANSI 转义码），xterm.js 可以很好地处理它们。
            // 过滤这些可能导致颜色丢失。因此，可以考虑保留所有字符，让 xterm.js 处理。
            // 但如果发现乱码，可以重新启用严格过滤。
            true // 暂时保留所有字符，让 Xterm.js 处理
        })
        .collect()
}

pub async fn handle_socket(socket: WebSocket, peer: String) {
    let (mut sender, mut receiver) = socket.split();

    let sandbox_root_path = PathBuf::from(SANDBOX_ROOT);
    // 初始 CWD，修正为根目录或你期望的默认路径
    let mut current_dir = sandbox_root_path.clone();
    // 确保 current_dir 是绝对路径
    if !current_dir.is_absolute() {
        current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from(SANDBOX_ROOT));
    }

    // **修复 3: 首次连接时发送欢迎信息和当前CWD，使用新的 WebSocketResponse 格式**
    let welcome_msg_content = format!(
        "Welcome to the Rust Web Terminal Backend!\r\n\
         Current directory: {}\r\n\
         Type \"help\" (or any command) and press Enter.\r\n",
        current_dir.display()
    );

    let welcome_response = WebSocketResponse {
        output: Some(clean_output(welcome_msg_content)),
        cwd_update: Some(current_dir.display().to_string()),
    };

    if let Err(e) = sender
        .send(Message::Text(
            serde_json::to_string(&welcome_response).unwrap().into(),
        ))
        .await
    {
        tracing::error!(
            "Failed to send initial welcome message to {}: {:?}",
            peer,
            e
        );
        return; // 如果无法发送初始消息，断开连接
    }

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(msg) => match msg {
                Message::Text(text) => {
                    tracing::info!("Received command from {}: {}", peer, text);

                    let CommandResult { output, new_cwd } =
                        process_command(&text.trim(), &current_dir).await;

                    // 如果 CWD 有更新，先更新后端状态
                    if let Some(path) = &new_cwd {
                        current_dir = path.clone();
                    }

                    // **修复 4: 统一发送响应，根据 CommandResult 构建 WebSocketResponse**
                    let response_to_send = WebSocketResponse {
                        output: if output.is_empty() {
                            None
                        } else {
                            Some(clean_output(output))
                        },
                        cwd_update: new_cwd.map(|p| p.display().to_string()),
                    };

                    if let Err(e) = sender
                        .send(Message::Text(
                            serde_json::to_string(&response_to_send).unwrap().into(),
                        ))
                        .await
                    {
                        tracing::error!("Failed to send response to {}: {:?}", peer, e);
                        break; // 发送失败则退出循环
                    }
                }
                Message::Pong(_) => {
                    // tracing::info!("Received Pong from {}", peer); // 过于频繁，可以注释掉
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

// **修复 5: process_command 返回 CommandResult**
async fn process_command(command_str: &str, current_dir: &Path) -> CommandResult {
    let parsed_command = shlex::split(command_str);

    if parsed_command.is_none() {
        return CommandResult {
            output: "Error: Invalid command format (unclosed quotes or invalid escapes).\r\n"
                .to_string(),
            new_cwd: None,
        };
    }

    let parts = parsed_command.unwrap();

    if parts.is_empty() {
        return CommandResult {
            output: "".to_string(),
            new_cwd: None,
        };
    }

    let cmd = parts[0].to_lowercase();
    let args: Vec<&str> = parts[1..].iter().map(|s| s.as_str()).collect();

    let mut new_cwd_opt: Option<PathBuf> = None; // 用于存储可能的 CWD 更新
    let response_output: String;

    if cmd == "sudo" || cmd == "su" || cmd == "passwd" {
        return CommandResult {
            output: "Error: Permission denied. This command is not allowed.\r\n".to_string(),
            new_cwd: None,
        };
    }

    match cmd.as_str() {
        "help" => {
            response_output = handle_help_command();
        }
        "echo" => {
            response_output = handle_echo_command(&args);
        }
        "cd" => {
            let (output, new_cwd) = handle_cd_command(&args, current_dir).await;
            response_output = output;
            new_cwd_opt = new_cwd;
        }
        "pwd" => {
            response_output = handle_pwd_command(current_dir);
        }
        "ls" => {
            response_output = handle_ls_command(&args, current_dir).await;
        }
        "whoami" => {
            response_output = handle_whoami_command().await;
        }
        "about" => {
            response_output = "This is a safe, sandboxed Rust Axum web terminal.\r\nIt only supports a limited set of commands to ensure safety.\r\n".to_string();
        }
        // --- 自定义命令 ---
        "birthday" => {
            response_output = handle_birthday_command();
        }
        "heyeuuu" => {
            response_output = handle_heyeuuu_command(&args);
        }
        "creeper" => {
            response_output = handle_creeper_command();
        }
        // ... 添加更多自定义命令 ...
        _ => response_output = format!("Unknown command: {}\r\n", command_str),
    }
    CommandResult {
        output: response_output,
        new_cwd: new_cwd_opt,
    }
}
fn handle_help_command() -> String {
    "\r\nAvailable Safe Commands:\r\n\
    \x1b[32m  help\x1b[0m        - Show this help message.\r\n\
    \x1b[32m  echo <text>\x1b[0m - Echoes the text you provide.\r\n\
    \x1b[32m  pwd\x1b[0m         - Prints working directory.\r\n\
    \x1b[32m  cd <path>\x1b[0m   - Change current directory.\r\n\
    \x1b[32m  ls\x1b[0m          - List directory contents.\r\n\
    \x1b[32m  whoami\x1b[0m      - Print the user name.\r\n\
    \x1b[32m  about\x1b[0m       - About this terminal.\r\n\
    \r\nCustom Commands:\r\n\
    \x1b[32m  birthday\x1b[0m    - Check if it's your birthday.\r\n\
    \x1b[32m  heyeuuu\x1b[0m     - A special greeting.\r\n\
    \x1b[32m  creeper\x1b[0m     - A friendly sound.\r\n"
        .to_string()
}

fn handle_echo_command(args: &[&str]) -> String {
    format!("{}\r\n", args.join(" "))
}

async fn handle_cd_command(args: &[&str], current_dir: &Path) -> (String, Option<PathBuf>) {
    let mut new_cwd_opt: Option<PathBuf> = None;
    let response_output: String;
    let sandbox_root_path = PathBuf::from(SANDBOX_ROOT);

    if args.is_empty() {
        new_cwd_opt = Some(sandbox_root_path);
        response_output = "".to_string();
    } else {
        let target_path_str = args[0];
        let target_path = PathBuf::from(target_path_str);

        let resolved_path = if target_path.is_absolute() {
            if target_path.starts_with(&sandbox_root_path) {
                target_path
            } else {
                response_output = format!(
                    "Error: Cannot access '{}' outside the sandbox.\r\n",
                    target_path_str
                );
                return (response_output, None);
            }
        } else {
            current_dir.join(target_path)
        };

        match resolved_path.canonicalize() {
            Ok(canonical_path) => {
                if canonical_path.is_dir() && canonical_path.starts_with(&sandbox_root_path) {
                    new_cwd_opt = Some(canonical_path);
                    response_output = "".to_string();
                } else if !canonical_path.starts_with(&sandbox_root_path) {
                    response_output =
                        "Error: Cannot access path outside the sandbox.\r\n".to_string();
                } else {
                    response_output = format!(
                        "Error: '{}' is not a directory or does not exist.\r\n",
                        target_path_str
                    );
                }
            }
            Err(_) => {
                response_output = format!(
                    "Error: Path '{}' is invalid or does not exist.\r\n",
                    target_path_str
                );
            }
        }
    }
    (response_output, new_cwd_opt)
}

fn handle_pwd_command(current_dir: &Path) -> String {
    format!("{}\r\n", current_dir.display())
}

async fn handle_ls_command(args: &[&str], current_dir: &Path) -> String {
    let mut command_builder = Command::new("ls");
    let sandbox_root_path = PathBuf::from(SANDBOX_ROOT);

    command_builder.current_dir(current_dir);

    let mut safe_args: Vec<PathBuf> = Vec::new();
    for arg in args {
        if arg.starts_with('-') {
            command_builder.arg(arg);
            continue;
        }

        let target_path = PathBuf::from(arg);
        let resolved_path = if target_path.is_absolute() {
            target_path
        } else {
            current_dir.join(target_path)
        };

        if let Ok(canonical_path) = resolved_path.canonicalize() {
            if canonical_path.starts_with(&sandbox_root_path) {
                safe_args.push(canonical_path);
            } else {
                return format!(
                    "Error: Cannot access path '{}' outside the sandbox.\r\n",
                    arg
                );
            }
        } else {
            return format!("Error: Path '{}' is invalid or does not exist.\r\n", arg);
        }
    }
    if safe_args.is_empty() {
        // 不需要添加任何路径参数，因为 command_builder 已经设置了工作目录
    } else {
        // 添加所有沙箱内安全的路径参数
        for path in safe_args {
            command_builder.arg(path);
        }
    }
    match command_builder.output().await {
        Ok(output) => {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).to_string()
            } else {
                format!(
                    "Error executing ls: {}\r\n",
                    String::from_utf8_lossy(&output.stderr)
                )
            }
        }
        Err(e) => format!("Failed to execute ls command: {}\r\n", e),
    }
}
async fn handle_whoami_command() -> String {
    // **注意：这里同样调用了系统命令 whoami**。
    // 为了完全安全，可以返回一个硬编码的字符串，如 "web_user" 或 "sandbox_user"。
    // 这样可以避免泄露服务器的真实用户名。
    // 例如：return "web_user\r\n".to_string();
    match Command::new("whoami").output().await {
        Ok(output) => {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).to_string()
            } else {
                "Error getting user info.\r\n".to_string()
            }
        }
        Err(_) => "Error getting user info.\r\n".to_string(),
    }
}

fn handle_birthday_command() -> String {
    let current_date = chrono::Local::now().format("%m-%d").to_string();
    if current_date == "08-06" {
        "Happy Birthday, heyeuuu! 🎉🎂\r\n".to_string()
    } else {
        "It's not my birthday yet. Is it yours?\r\n".to_string()
    }
}

fn handle_heyeuuu_command(args: &[&str]) -> String {
    let name = if args.is_empty() { "heyeuuu" } else { args[0] };
    format!("Suki~~~Bless for {}~~~\r\n", name)
}

fn handle_creeper_command() -> String {
    "Sss... Boom! (just kidding, I'm friendly) \r\n".to_string()
}
