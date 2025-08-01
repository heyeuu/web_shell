// frontend/src/api/webSocketService.ts

// **修复 6: WebSocketMessage 定义为接口，字段为可选**
interface WebSocketMessage {
    output?: string;    // 注意这里是可选的
    cwd_update?: string; // 注意这里是可选的
}

export class WebSocketService {
    private ws: WebSocket | null = null;
    private onMessageCallback: ((message: WebSocketMessage) => void) | null = null;
    private onCloseCallback: (() => void) | null = null;
    private onErrorCallback: ((error: Event) => void) | null = null;

    constructor() {
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
        // 确保端口与后端监听的端口一致 (3000)
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
    }

    private handleMessage(event: MessageEvent): void {
        try {
            // **修复 7: 即使 output 或 cwd_update 为 None，JSON.parse 也能正常工作**
            const message: WebSocketMessage = JSON.parse(event.data);
            if (this.onMessageCallback) {
                this.onMessageCallback(message);
            }
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e, event.data);
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