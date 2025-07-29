import './style.css'
// import Alpine from 'alpinejs';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css'
// import typescriptLogo from './typescript.svg'
// import viteLogo from '/vite.svg'
// import { setupCounter } from './counter.ts'

const terminalContainer = document.getElementById('terminal-container');

if (terminalContainer) {
  const term = new Terminal({
    fontSize: 14,
    fontFamily: 'monospace',
    theme: {
      background: '#1a202c',
      foreground: '#68d391',
      cursor: '#68d391',
      selectionBackground: 'rgba(104, 211, 145, 0.3)'
    },
    cursorBlink: true,
    cursorStyle: 'block'
  });

  const fitAddonInstance = new FitAddon();
  term.loadAddon(fitAddonInstance);

  term.open(terminalContainer);
  fitAddonInstance.fit();
  let currentLine: string = '';
  const prompt = '$ ';

  /*初始欢迎信息*/
  term.write('Hello world!\r\n');
  term.write('Type help to see available commands.\r\n');
  term.write(prompt);

  // 命令词典，主要用于前端的 Tab 补全
  // 注意：这里只包含前端需要知道的命令，即使它们最终由后端处理
  const commandLexicon = [
    'help',
    'echo',
    'clear',
    'about',
    'pwd'
  ];

  // --- WebSocket 客户端逻辑 ---
  const socket = new WebSocket('ws://localhost:3000/ws');

  socket.onopen = (event) => {
    term.write('\x1b[2K\r');
    term.write('Connection established with Rust Backend!\r\n');
    term.write('Type "help" (or any command) and press Enter.\r\n');
    term.write(prompt);
    console.log('WebSocket connection opened:', event);
  }

  socket.onmessage = (event) => {
    const data = event.data;
    term.write('\r\n');
    term.write(String(data));
    term.write('\r\n');
    term.write(prompt);
    currentLine = '';
  }

  socket.onclose = (event) => {
    term.write('\r\n');
    term.write(`WebSocket connection closed: Code ${event.code}, Reason: ${event.reason}\r\n`);
    term.write(prompt);
    console.log('WebSocket connection closed:', event);
  }

  socket.onerror = (event) => {
    term.write('\r\n');
    term.write('WebSocket Error! Check console for details.\r\n');
    console.error('WebSocket Error:', event);
  };

  // --- 本地命令处理器 ---
  // 这个函数现在只处理纯前端的命令，或者在 WebSocket 未连接时作为备用。
  const handleLocalCommand = (command: string): boolean => {
    const trimmedCommand = command.trim().toLowerCase();
    let response = '';

    if (trimmedCommand == 'help') {
      response = '\r\nAvailable Commands:\r\n' +
        '  help        - Show list of available commands\r\n' +
        '  echo <text> - Echoes the text you provide\r\n' +
        '  clear       - Clears the terminal screen\r\n' +
        '  about       - About this terminal\r\n' +
        '  pwd         - Prints working directory (dummy)\r\n' +
        '  (Many other commands will be handled by the backend!)\r\n';

      term.write(response);
      term.write(prompt);
      return true;
    } else if (trimmedCommand === "clear") {
      term.clear();
      term.write(prompt);
      return true;
    } else if (trimmedCommand === 'about') {
      response = 'This is a mini web terminal built with xterm.js.\r\n' +
        'Powered by Rust Axum for the backend, and Alpine.js/Tailwind CSS for the frontend.\r\n';
      term.write(response);
      term.write(prompt);
      return true;
    } else if (trimmedCommand === '') {
      response = '';
      term.write(response);
      term.write(prompt);
      return true;
    } else if (trimmedCommand === 'creeper') {
      response = 'suki~\r\n';
      term.write(response);
      term.write(prompt);
      return true;
    } else if (trimmedCommand === 'heyeuuu') {
      response = 'suki~~~Bless for sheeeeee~\r\n';
      term.write(response);
      term.write(prompt);
      return true;
    }
    else {
      response = `Unknown command: ${command}\r\n`;
      term.write(response);
      term.write(prompt);
      // return true;
    }
    return false;
  }

  window.addEventListener('resize', () => { fitAddonInstance.fit() });

  let tabCompletionCandidates: string[] = [];
  let tabCompletionIndex = 0;
  let lastTabTime: number = 0;
  const TAB_COOLDOWN = 300;

  term.onKey(({ key, domEvent }) => {
    domEvent.preventDefault();

    const isControlOrArrowKey = domEvent.altKey || domEvent.ctrlKey || domEvent.metaKey || domEvent.key.includes('Arrow');
    const printable = !isControlOrArrowKey && domEvent.key.length === 1;

    if (domEvent.key === 'Enter') {
      term.write('\r\n');

      if (currentLine.length > 0) {
        const commandToExecute = currentLine.trim();

        if (handleLocalCommand(commandToExecute)) {
        } else if (socket.readyState == WebSocket.OPEN) {
          socket.send(commandToExecute);
        } else {
          term.write('WebSocket is not connected. Unable to send command.\r\n');
          term.write(prompt);
        }
      } else {
        term.write(prompt);
      }

      currentLine = '';
      tabCompletionCandidates = [];
      tabCompletionIndex = 0;
      lastTabTime = 0;
    } else if (domEvent.key === 'Backspace') {
      if (currentLine.length > 0) {
        term.write('\b \b');
        currentLine = currentLine.slice(0, -1);
      }
      tabCompletionCandidates = [];
      tabCompletionIndex = 0;
      lastTabTime = 0;
    } else if (domEvent.key === 'Tab') {
      const now = Date.now();
      const isContinuousTab = (now - lastTabTime < TAB_COOLDOWN) && tabCompletionCandidates.length > 0;
      lastTabTime = now;

      if (!isContinuousTab || tabCompletionCandidates.length === 0) {
        tabCompletionCandidates = commandLexicon.filter(cmd => cmd.toLocaleLowerCase().startsWith(currentLine.toLocaleLowerCase()));
        tabCompletionIndex = 0;
      }

      if (tabCompletionCandidates.length === 0) {
        term.write('\x07');
      } else if (tabCompletionCandidates.length === 1) {
        const completion = tabCompletionCandidates[0];
        term.write(completion.substring(currentLine.length));
        currentLine = completion;

      } else {
        const displayCandidates = tabCompletionCandidates.join('  ');
        const currentCompletion = tabCompletionCandidates[tabCompletionIndex];

        term.write('\x1b[2K\r');
        term.write(prompt);

        if (!isContinuousTab) {
          term.write(currentLine);
          term.write('\r\n' + displayCandidates + '\r\n');
          term.write(prompt);
          term.write(currentCompletion);
          currentLine = currentCompletion;
        } else {
          const prevCompletion = tabCompletionCandidates[tabCompletionIndex === 0 ? tabCompletionCandidates.length - 1 : tabCompletionIndex - 1]
          term.write('\x1b[' + prevCompletion.length + 'D');
          term.write('\x1b[2K\r');
          term.write(currentCompletion);
          currentLine = currentCompletion;
        }
        tabCompletionIndex = (tabCompletionIndex + 1) % tabCompletionCandidates.length;
      }
    } else if (domEvent.key.includes('Arrow')) {
      tabCompletionCandidates = [];
      tabCompletionIndex = 0;
      lastTabTime = 0;

    } else if (printable) {
      term.write(key);
      currentLine += key;
      tabCompletionCandidates = [];
      tabCompletionIndex = 0;
      lastTabTime = 0;
    }
  });
} else {
  console.error('Terminal container not found. Please check your HTML structure.');
}


