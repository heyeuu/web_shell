// frontend/src/api/webSocketService.ts

interface WebSocketMessage {
    output?: string;
    cwd_update?: string;
}

export class WebSocketService {
    private ws: WebSocket | null = null;
    private onMessageCallback: ((message: WebSocketMessage) => void) | null = null;
    private onCloseCallback: (() => void) | null = null;
    private onErrorCallback: ((error: Event) => void) | null = null;

    constructor() {
        // 绑定上下文，确保回调函数中的 this 指向 WebSocketService 实例
        this.handleMessage = this.handleMessage.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.handleError = this.handleError.bind(this);
        this.handleOpen = this.handleOpen.bind(this);
    }

    connect(): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket is already open.');
            return;
        }

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.hostname}:3000/ws`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = this.handleOpen;
        this.ws.onmessage = this.handleMessage;
        this.ws.onclose = this.handleClose;
        this.ws.onerror = this.handleError;

        console.log('Attempting to connect WebSocket...');
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            console.log('WebSocket disconnected.');
        }
    }

    sendCommand(command: string): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(command);
        } else {
            console.warn('WebSocket is not open. Command not sent:', command);
        }
    }

    onMessage(callback: (message: WebSocketMessage) => void): void {
        this.onMessageCallback = callback;
    }

    onClose(callback: () => void): void {
        this.onCloseCallback = callback;
    }

    onError(callback: (error: Event) => void): void {
        this.onErrorCallback = callback;
    }

    private handleOpen(): void {
        console.log('WebSocket connection opened.');
        // 这里不需要写欢迎信息，由 main.ts 协调 TerminalService 处理
    }

    private handleMessage(event: MessageEvent): void {
        try {
            const message: WebSocketMessage = JSON.parse(event.data);
            if (this.onMessageCallback) {
                this.onMessageCallback(message);
            }
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e, event.data);
            // 错误信息可以传递给终端服务显示
            if (this.onMessageCallback) {
                this.onMessageCallback({ output: `\r\nError parsing message from backend: ${e instanceof Error ? e.message : String(e)}\r\n` });
            }
        }
    }

    private handleClose(event: CloseEvent): void {
        console.log('WebSocket connection closed:', event.code, event.reason);
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
        // 自动重连逻辑
        setTimeout(() => this.connect(), 5000);
    }

    private handleError(event: Event): void {
        console.error('WebSocket Error:', event);
        if (this.onErrorCallback) {
            this.onErrorCallback(event);
        }
        this.disconnect();
    }
}