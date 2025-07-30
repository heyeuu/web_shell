mod handlers;
mod state;
mod ws_logic;

use axum::{
    Router,
    routing::{get, get_service},
};

use std::net::SocketAddr;
use tokio::net::TcpListener;

use tower_http::services::ServeDir;
use tower_http::trace::{self, TraceLayer};

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

// use colored::*;
use crate::handlers::{handle_404, hello_world, websocket_handler};

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

    let app_state = std::sync::Arc::new(state::AppState::default());

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
