// frontend/src/services/terminalService.ts
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export class TerminalService {
    private term: Terminal | null = null;
    private fitAddonInstance: FitAddon | null = null;
    private terminalElement: HTMLElement;
    private currentBuffer: string = '';
    private currentCwd: string = '';
    private onDataCallback: ((data: string) => void) | null = null;

    constructor(terminalElement: HTMLElement) {
        this.terminalElement = terminalElement;
        this.currentCwd = '~';
    }

    initialize(onReady: () => void): void {
        if (this.term) {
            // 如果终端已经存在，先销毁它以确保完全重新初始化
            this.destroy();
        }

        this.term = new Terminal({
            fontSize: 14,
            fontFamily: '"Cascadia Code", monospace',
            theme: {
                background: '#1a202c',
                foreground: '#68d391',
                cursor: '#68d391',
                selectionBackground: 'rgba(104, 211, 145, 0.3)'
            },
            convertEol: true,
            cursorBlink: true,
            cursorStyle: 'block',
            disableStdin: false,
            scrollback: 1000
        });

        this.fitAddonInstance = new FitAddon();
        this.term.loadAddon(this.fitAddonInstance);
        this.term.open(this.terminalElement);

        if (this.onDataCallback) {
            this.term.onData(this.onDataCallback);
        }

        // **核心修复点 1: 确保在重新打开时清理显示内容并放置光标**
        // 我们不应该直接写入保存的 currentBuffer，因为我们想要一个干净的界面。
        // 相反，我们将在 onReady 之后立即写入提示符。
        // 为了确保干净的重绘和光标位置，使用 setTimeout 确保 DOM 稳定后再执行
        setTimeout(() => {
            if (this.fitAddonInstance && this.term) {
                this.fitAddonInstance.fit();
                this.term.focus();

                // **关键光标和提示符重置逻辑**
                // 1. 清空当前视图（如果可能的话，虽然 Xterm.js 通常会自己处理）
                this.term.clear(); // 清空可视区域，保证干净

                // 2. 将光标移动到起始位置并写入提示符
                // 确保在任何输出前，光标总是在行的开始
                this.term.write('\x1b[2K\r'); // 再次清空行并回车，以防万一
                this.term.write(this.getPromptString()); // 写入单个提示符

                onReady(); // 终端完全准备好后，调用回调函数
                console.log('Terminal initialized and ready.');
            } else {
                console.error("Terminal instance or FitAddon was null after timeout during initialization.");
            }
        }, 100);

        console.log('Terminal initialization started.');
    }

    destroy(): void {
        if (this.term) {
            // 保存当前缓冲区内容，以便在重新打开时可以恢复，如果需要的话
            // 但在你的场景中，你希望每次展开都是干净的，所以 currentBuffer 可能不需要被恢复
            // 现阶段，我们不将 currentBuffer 写入 initialize，因此此处保存意义不大，但保留不影响
            const lines: string[] = [];
            for (let i = 0; i < this.term.buffer.normal.length; i++) {
                const line = this.term.buffer.normal.getLine(i);
                if (line) {
                    lines.push(line.translateToString(true));
                }
            }
            this.currentBuffer = lines.join('\n'); // 存储是为了潜在的未来恢复功能

            this.term.dispose(); // 销毁 Xterm.js 实例
            this.term = null;
            this.fitAddonInstance = null;
            console.log('Terminal destroyed.');
        }
    }

    fit(): void {
        if (this.fitAddonInstance && this.term) {
            this.fitAddonInstance.fit();
        }
    }

    write(data: string): void {
        if (this.term) {
            this.term.write(data);
        }
    }

    // writePrompt 应该只在命令执行后或特定清理后调用，而不是在每次 initialize 时也调用
    writePrompt(): void {
        if (this.term) {
            // 确保写入提示符前，光标在行首，并且该行是干净的
            this.term.write('\x1b[2K\r'); // 清空当前行并回车到行首
            this.term.write(this.getPromptString());
        }
    }

    getPromptString(): string {
        return `${this.currentCwd}$ `;
    }

    setCwd(cwd: string): void {
        this.currentCwd = cwd;
    }

    getCurrentCwd(): string {
        return this.currentCwd;
    }

    getTerminalInstance(): Terminal | null {
        return this.term;
    }

    onData(callback: (data: string) => void): void {
        this.onDataCallback = callback;
        if (this.term) {
            this.term.onData(callback);
        }
    }

    enableInput(): void {
        if (this.term) {
            this.term.options.disableStdin = false;
        }
    }

    disableInput(): void {
        if (this.term) {
            this.term.options.disableStdin = true;
        }
    }

    clear(): void {
        if (this.term) {
            this.term.clear();
            // 清空后也需要写提示符
            this.writePrompt();
        }
    }

    isInitialized(): boolean {
        return this.term !== null;
    }
}