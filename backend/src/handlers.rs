use axum::{
    extract::{State, connect_info::ConnectInfo, ws::WebSocketUpgrade},
    response::Response,
};
use std::{net::SocketAddr, sync::Arc};
use tracing;

use crate::state::AppState;

use crate::ws_logic::handle_socket;

pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(_state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    let peer = addr.to_string();
    tracing::info!("New WebSocket connection from: {:?}", peer);
    ws.on_upgrade(move |socket| handle_socket(socket, peer))
}

pub async fn hello_world() -> &'static str {
    "Hello, World from Rust Backend API!"
}

pub async fn handle_404() -> impl axum::response::IntoResponse {
    tracing::warn!("404 Not Found");
    (axum::http::StatusCode::NOT_FOUND, "Not Found")
}
