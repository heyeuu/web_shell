// frontend/src/services/inputHandler.ts
import { Terminal } from '@xterm/xterm';
import { TerminalService } from './terminalService'; // 导入 TerminalService

export class InputHandler {
    private terminalService: TerminalService; // 引用 TerminalService 实例
    private term: Terminal; // Xterm.js 实例 (从 TerminalService 获取)
    private commandLexicon: string[];
    private onCommandCallback: ((command: string) => void) | null = null;

    private currentLine: string = '';
    private tabCompletionCandidates: string[] = [];
    private tabCompletionIndex: number = 0;
    private lastTabTime: number = 0;
    private readonly TAB_COOLDOWN = 300; // ms

    // 构造函数现在接收 TerminalService 实例
    constructor(terminalService: TerminalService, commandLexicon: string[], onCommand: (command: string) => void) {
        // 关键检查：确保传入的 terminalService 存在且已初始化 Xterm.js 实例
        // 如果 `main.ts` 正确地在 `terminalService.initialize` 的 `onReady` 回调中创建 InputHandler，
        // 那么 `terminalService.getTerminalInstance()` 此时应该是非空的。
        const termInstance = terminalService.getTerminalInstance();
        if (!terminalService || !termInstance) {
            // 如果这个错误被触发，说明 `main.ts` 的协调逻辑或者 `TerminalService` 的初始化时序有问题。
            // 之前的 `Uncaught Error` 正是发生在此处。
            throw new Error("TerminalService must be fully initialized with an Xterm.js instance before InputHandler is created.");
        }

        this.terminalService = terminalService;
        this.term = termInstance; // 从 TerminalService 获取实际的 Xterm.js 实例
        this.commandLexicon = commandLexicon;
        this.onCommandCallback = onCommand;

        // 确保 onData 绑定的是正确的 this 上下文
        this.handleData = this.handleData.bind(this);
        // 通过 TerminalService 注册 onData 监听器
        // TerminalService 的 onData 方法会处理将其绑定到当前的 Xterm 实例。
        this.terminalService.onData(this.handleData);
    }

    private writeText(data: string): void {
        this.term.write(data);
    }

    private rewriteCurrentLine(): void {
        // \x1b[2K 是清除当前行，\r 是将光标移到行首
        this.term.write('\x1b[2K\r');
        // 正确修复: 使用 terminalService.getPromptString() 来获取提示符字符串
        this.term.write(`${this.terminalService.getPromptString()}${this.currentLine}`);
    }

    // 核心输入处理逻辑
    private handleData(data: string): void {
        // 在处理输入前，检查终端是否已禁用输入
        if (this.terminalService.getTerminalInstance()?.options.disableStdin) return;

        const charCode = data.charCodeAt(0);

        if (charCode === 13) { // Enter key
            this.writeText('\x1b[2K\r'); // 清除当前行
            // 正确修复: 使用 terminalService.getPromptString() 来获取提示符字符串
            this.writeText(`${this.terminalService.getPromptString()}${this.currentLine}\r\n`); // 显示执行的命令并换行

            const commandToExecute = this.currentLine.trim();
            if (commandToExecute === '') {
                // 如果是空命令，直接通知外部（main.ts 会负责写提示符）
                if (this.onCommandCallback) {
                    this.onCommandCallback('');
                }
            } else if (commandToExecute === 'clear') {
                // clear 命令由 TerminalService 处理，然后通知外部（main.ts 会负责写提示符）
                this.terminalService.clear();
                if (this.onCommandCallback) {
                    this.onCommandCallback('clear');
                }
            } else {
                // 其他命令发送到外部处理（WebSocketService）
                if (this.onCommandCallback) {
                    this.onCommandCallback(commandToExecute);
                }
            }
            this.currentLine = '';
            this.resetTabCompletion();
            return;
        }

        if (charCode === 127 || charCode === 8) { // Backspace or Delete
            if (this.currentLine.length > 0) {
                this.writeText('\b \b'); // 回退，擦除字符，再回退
                this.currentLine = this.currentLine.slice(0, -1);
            }
            this.resetTabCompletion();
            return;
        }

        if (charCode === 9) { // Tab key for completion
            const now = Date.now();
            const isContinuousTab = (now - this.lastTabTime < this.TAB_COOLDOWN) && this.tabCompletionCandidates.length > 0;
            this.lastTabTime = now;

            if (!isContinuousTab) {
                this.tabCompletionCandidates = this.commandLexicon.filter(cmd =>
                    cmd.toLowerCase().startsWith(this.currentLine.toLowerCase())
                );
                this.tabCompletionIndex = 0;
            }

            if (this.tabCompletionCandidates.length === 0) {
                this.writeText('\x07'); // Bell character
            } else if (this.tabCompletionCandidates.length === 1) {
                const completion = this.tabCompletionCandidates[0];
                this.writeText(completion.substring(this.currentLine.length));
                this.currentLine = completion;
            } else {
                const currentCompletion = this.tabCompletionCandidates[this.tabCompletionIndex];
                this.rewriteCurrentLine(); // 清除并重写当前输入行

                if (!isContinuousTab) {
                    this.writeText(this.currentLine); // 重写当前行内容
                    this.writeText('\r\n' + this.tabCompletionCandidates.join('  ') + '\r\n'); // 显示所有候选项
                    this.rewriteCurrentLine(); // 再次重写当前输入行，让光标回到正确位置
                }

                this.writeText(currentCompletion.substring(this.currentLine.length)); // 补全命令
                this.currentLine = currentCompletion;

                this.tabCompletionIndex = (this.tabCompletionIndex + 1) % this.tabCompletionCandidates.length;
            }
            return;
        }

        if (charCode === 3) { // Ctrl+C
            this.writeText('^C\r\n');
            this.currentLine = '';
            if (this.onCommandCallback) {
                this.onCommandCallback(''); // 发送一个空命令或特殊标记表示Ctrl+C
            }
            this.resetTabCompletion();
            return;
        }

        if (charCode >= 32 || charCode === 10 || charCode === 13) { // 可打印字符，换行，回车
            this.writeText(data);
            this.currentLine += data;
            this.resetTabCompletion();
        }
    }

    private resetTabCompletion(): void {
        this.tabCompletionCandidates = [];
        this.tabCompletionIndex = 0;
        this.lastTabTime = 0;
    }
}