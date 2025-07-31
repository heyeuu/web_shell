// frontend/src/main.ts
import './style.css';
import { TerminalService } from './services/terminalService';
import { WebSocketService } from './api/webSocketService';
import { InputHandler } from './services/inputHandler';
import { COMMAND_LEXICON } from './utils/constants';

// 1. 获取 DOM 元素
const terminalWrapperElement = document.getElementById('terminal-wrapper');
const terminalElement = document.getElementById('terminal');

if (!terminalElement || !terminalWrapperElement) {
  console.error('Terminal elements not found! Ensure your index.html has elements with id="terminal" and "terminal-wrapper".');
  document.body.innerHTML = '<p>Error: Terminal elements not found! Please check your HTML structure.</p>';
  throw new Error('Terminal elements not found');
}

// 2. 实例化服务
const terminalService = new TerminalService(terminalElement);
const webSocketService = new WebSocketService();

let inputHandler: InputHandler | null = null;

// 3. 定义回调函数，处理从 WebSocket 收到的消息
webSocketService.onMessage((message) => {
  if (terminalService.isInitialized()) {
    if (message.output !== undefined) {
      // 写入后端输出，并确保换行
      terminalService.write(message.output);
      if (message.output && !message.output.endsWith('\n') && !message.output.endsWith('\r\n')) {
        terminalService.write('\r\n');
      }
    }
    if (message.cwd_update !== undefined) {
      terminalService.setCwd(message.cwd_update);
    }
    // **核心修复点 2: 确保在收到后端消息并处理完毕后，才写入提示符**
    // writePrompt 方法本身现在包含了光标定位和清空行的逻辑
    terminalService.writePrompt();
    terminalService.enableInput();
  }
});

// 4. 定义 WebSocket 连接关闭时的回调
webSocketService.onClose(() => {
  if (terminalService.isInitialized()) {
    terminalService.disableInput();
    terminalService.write('\r\nConnection to backend closed. Reconnecting in 5 seconds...\r\n');
    // 不需要在这里 writePrompt，因为上面已经有连接关闭消息
  }
});

// 5. 定义 WebSocket 错误时的回调
webSocketService.onError(() => {
  if (terminalService.isInitialized()) {
    terminalService.write('\r\nWebSocket Error! Check console for details.\r\n');
    terminalService.disableInput();
    // 不需要在这里 writePrompt
  }
});

// 6. 终端可见性状态和切换逻辑
let isTerminalVisible = true;

window.addEventListener('keydown', (domEvent: KeyboardEvent) => {
  if (domEvent.ctrlKey && domEvent.code === 'Backquote') {
    domEvent.preventDefault();

    if (terminalWrapperElement) {
      if (isTerminalVisible) {
        terminalWrapperElement.classList.add('terminal-hidden');
        terminalService.destroy();
        inputHandler = null;
        webSocketService.disconnect();
      } else {
        terminalWrapperElement.classList.remove('terminal-hidden');
        terminalService.initialize(() => {
          console.log("Terminal is ready (after toggle), initializing InputHandler and connecting WebSocket.");
          if (terminalService.isInitialized() && inputHandler === null) {
            inputHandler = new InputHandler(terminalService, COMMAND_LEXICON, (command) => {
              if (command === 'clear') {
                // clear 命令现在内部会调用 writePrompt
                terminalService.clear();
              } else if (command === '') {
                // 空命令，InputHandler 处理后，writePrompt 会自动处理
                terminalService.writePrompt();
              } else {
                webSocketService.sendCommand(command);
              }
            });
            webSocketService.connect();
            terminalService.enableInput();
            terminalService.getTerminalInstance()?.focus();
          }
        });
      }
      isTerminalVisible = !isTerminalVisible;
    }
    return false;
  }
  return true;
});

// 7. 监听窗口尺寸变化，以适应终端
window.addEventListener('resize', () => {
  if (isTerminalVisible && terminalService.isInitialized()) {
    terminalService.fit();
  }
});


// 8. 应用程序启动时的初始化 (首次加载)
terminalService.initialize(() => {
  console.log("Terminal is ready (initial load), initializing InputHandler and connecting WebSocket.");
  inputHandler = new InputHandler(terminalService, COMMAND_LEXICON, (command) => {
    if (command === 'clear') {
      terminalService.clear(); // clear 命令现在内部会调用 writePrompt
    } else if (command === '') {
      terminalService.writePrompt(); // 空命令，InputHandler 处理后，这里写提示符
    } else {
      webSocketService.sendCommand(command);
    }
  });
  webSocketService.connect();
});