use axum::{
    Router,
    extract::{
        State,
        connect_info::ConnectInfo,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
    routing::{get, get_service},
};
use futures_util::{SinkExt, StreamExt};

use std::{net::SocketAddr, sync::Arc};

use tokio::net::TcpListener;

use tower_http::services::ServeDir;
use tower_http::trace::{self, TraceLayer};

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Default)]
struct AppState {
    // connected_clients:Rw
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    tracing::info!("Starting backend server...");

    // --- 初始化应用程序状态 ---
    let app_state = Arc::new(AppState::default());
    // --- 配置静态文件服务 ---
    let static_files_path = std::env::current_dir().unwrap().join("../frontend/dist");
    tracing::debug!("Serving static files from: {:?}", static_files_path);

    // --- 定义路由 ---
    let app = Router::new()
        .route("/ws", get(websocket_handler))
        .fallback(get_service(
            ServeDir::new(static_files_path).not_found_service(get(handle_404)),
        ))
        .route("/api/hello", get(hello_world))
        .with_state(app_state)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(trace::DefaultMakeSpan::new().include_headers(true))
                .on_response(trace::DefaultOnResponse::new().include_headers(true)),
        );
    // --- 启动服务器 ---
    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Server failed to bind to address");
    tracing::info!(
        "Listening on http://{}",
        listener.local_addr().expect("Server failed to start")
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(_state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    let peer = addr.to_string();
    tracing::info!("New WebSocket connection from: {:?}", peer);
    ws.on_upgrade(move |socket| handle_socket(socket, peer))
}

async fn handle_socket(socket: WebSocket, peer: String) {
    let (mut sender, mut receiver) = socket.split();

    sender
        .send(Message::Text(
            "Welcome to the Rust Web Terminal Backend!".into(),
        ))
        .await
        .unwrap();

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(msg) => match msg {
                Message::Text(text) => {
                    tracing::info!("Received message from {}: {}", peer, text);
                    let response = process_command(text.trim()).await;
                    sender.send(Message::Text(response.into())).await.unwrap();
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

async fn process_command(command: &str) -> String {
    let parts: Vec<&str> = command.splitn(2, ' ').collect();
    let command = parts.get(0).unwrap_or(&"").to_lowercase();

    match command.as_str() {
        "help" => {
            let response = "\r\nAvailable Commands (handled by backend):\r\n\
            \x1b[32m  help\x1b[0m        - Show list of available commands\r\n\
            \x1b[32m  echo <text>\x1b[0m - Echoes the text you provide\r\n\
            \x1b[32m  about\x1b[0m       - About this backend\r\n\
            \x1b[32m  pwd\x1b[0m         - Prints working directory (simulated)\r\n"
                .to_string();
            response
        }
        "echo" => {
            let text_to_echo = if parts.len() > 1 {
                parts[1].to_string()
            } else {
                "".to_string()
            };
            format!("{text_to_echo}\r\n")
        }
        "pwd" => "todo".to_string(),
        "" => "".to_string(),
        "birthday" => "Happy Birthday ohhhhhyeahhhhhhh! 🎉🎂".to_string(),
        "about" => "This is the Rust Axum backend for your Web terminal.\r\n\
            It handles commands sent via WebSocket.\r\n"
            .to_string(),
        "heyeuuu" => "suki~~~Bless for sheeeeee~".to_string(),
        "creeper" => "suki~".to_string(),
        _ => format!("Unknown command: {}\r\n", command),
    }
}

async fn hello_world() -> &'static str {
    "Hello, World from Rust Backend API!"
}

async fn handle_404() -> impl axum::response::IntoResponse {
    tracing::warn!("404 Not Found");
    (axum::http::StatusCode::NOT_FOUND, "Not Found")
}
