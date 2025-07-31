// frontend/src/main.ts
import './style.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const terminalWrapperElement = document.getElementById('terminal-wrapper');
const terminalElement = document.getElementById('terminal');

if (!terminalElement || !terminalWrapperElement) {
  console.error('Terminal elements not found! Ensure your index.html has elements with id="terminal" and "terminal-wrapper".');
  document.body.innerHTML = '<p>Error: Terminal elements not found! Please check your HTML structure.</p>';
  throw new Error('Terminal elements not found');
}

let term: Terminal | null = null;
let fitAddonInstance: FitAddon | null = null;
let currentBuffer: string = ''; // Used to save terminal content
let currentCwd = ''; // Store current working directory
let ws: WebSocket | null = null;

let isTerminalVisible = true; // Terminal visibility state, initial state is visible

// --- Terminal Initialization/Destruction Logic ---
function initializeTerminal() {
  // Destroy existing terminal instance if it exists, to ensure a clean re-initialization
  // This is crucial for fixing the "no interaction" after re-expansion.
  if (term) {
    destroyTerminal();
  }

  term = new Terminal({
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
    disableStdin: false, // **CRITICAL**: Ensure stdin is enabled on initialization
    scrollback: 1000
  });

  fitAddonInstance = new FitAddon();
  term.loadAddon(fitAddonInstance);
  term.open(terminalElement!);

  // **CRITICAL**: Attach onData listener to the NEW terminal instance
  term.onData(handleTerminalInput);

  // Connect WebSocket if not already connected (or re-connect if closed)
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    connectWebSocket();
  }

  // Adjust size and focus AFTER the element is visible and has its full dimensions
  // We add an extra small delay here to ensure rendering has caught up.
  setTimeout(() => {
    if (fitAddonInstance) {
      fitAddonInstance.fit(); // Ensure terminal dimensions are correct
    }
    if (term) {
      term.focus(); // Ensure terminal has focus for input
      // **CRITICAL**: Ensure cursor is on a new, clean line after re-expansion
      term.write('\x1b[2K\r'); // Clear current line and move to beginning
      term.write('\r\n');      // Add a new line
      writePrompt();           // Then write the prompt
    }
  }, 100); // Increased timeout slightly for better reliability

  // Write saved buffer content
  if (currentBuffer) {
    // Need to be careful not to write buffer and then overwrite with prompt immediately
    // Best to write buffer and then prompt separately.
    // For now, let's just make sure prompt is correct after initial load/re-load
    // If buffer needs to be persistent, we'd write it *before* the prompt.
    // For current issue, focus on prompt and interaction.
  }
}

function destroyTerminal() {
  if (term) {
    // Save current buffer content before disposing
    const lines: string[] = [];
    for (let i = 0; i < term.buffer.normal.length; i++) {
      const line = term.buffer.normal.getLine(i);
      if (line) {
        lines.push(line.translateToString(true)); // true to include trailing whitespace
      }
    }
    currentBuffer = lines.join('\n');

    term.dispose(); // Dispose of the terminal instance
    term = null; // Set term to null so it's re-initialized next time
    fitAddonInstance = null; // Also clear fit addon instance
  }
}

// **Important**: Keep the window resize listener outside of initializeTerminal
// It only needs to be added once when the script loads.
window.addEventListener('resize', () => {
  // Only fit if terminal is visible and instantiated
  if (isTerminalVisible && fitAddonInstance && term) {
    fitAddonInstance.fit();
  }
});


// --- Other functions (command lexicon, prompt, WebSocket, input handling) remain the same ---
const commandLexicon = [
  'help', 'echo', 'clear', 'about', 'pwd', 'whoami', 'cd', 'ls',
  'heyeuuu', 'birthday', 'crush', 'hello', 'creeper', 'exit', 'logout', 'login',
  'cat', 'touch', 'mkdir', 'rm', 'rmdir', 'cp', 'mv',
];

function writePrompt() {
  if (term) {
    term.write(`${currentCwd}$ `); // Removed initial \r\n here as it's now handled explicitly in initializeTerminal
  }
}

function rewriteCurrentLine() {
  if (term) {
    term.write('\x1b[2K\r');
    term.write(`${currentCwd}$ ${currentLine}`);
  }
}

function connectWebSocket() {
  if (ws) {
    ws.close();
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.hostname}:3000/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connection opened.');
    if (term) { // Check if term exists before using
      term.reset(); // Clear existing content (important for a fresh start)
      term.write('Connection established with Rust Backend!\r\n');
      term.write('Type "help" (or any command) and press Enter.\r\n');
      term.options.disableStdin = false; // **CRITICAL**: Re-enable stdin on successful connection
      writePrompt(); // Ensure prompt is written after connection
    }
  };

  ws.onmessage = (event) => {
    if (!term) return; // If terminal is not active, ignore messages
    try {
      const message = JSON.parse(event.data) as { output?: string, cwd_update?: string };

      if (message.output !== undefined) {
        term.write(message.output);
        if (message.output && !message.output.endsWith('\n') && !message.output.endsWith('\r\n')) {
          term.write('\r\n');
        }
      }

      if (message.cwd_update !== undefined) {
        currentCwd = message.cwd_update;
        // No need to write prompt here, it's called after message.output handling
      }
      // CRITICAL: Ensure prompt is written AFTER the output/cwd_update is fully processed
      writePrompt();
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e, event.data);
      term.write(`\r\nError parsing message from backend: ${e}\r\n`);
      writePrompt();
    }
    currentLine = ''; // Reset current line after processing command
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed');
    if (term) { // Ensure term exists
      term.write('\r\nConnection to backend closed. Reconnecting in 5 seconds...\r\n');
      term.options.disableStdin = true; // Disable stdin on close
    }
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket Error:', error);
    if (term) { // Ensure term exists
      term.write(`\r\nWebSocket Error! Check console for details.\r\n`);
    }
    ws?.close();
  };
}

let currentLine = '';
let tabCompletionCandidates: string[] = [];
let tabCompletionIndex = 0;
let lastTabTime: number = 0;
const TAB_COOLDOWN = 300;

function handleTerminalInput(data: string) {
  if (!term || term.options.disableStdin) return; // Important: Check disableStdin

  const charCode = data.charCodeAt(0);

  if (charCode === 13) { // Enter key
    term.write('\x1b[2K\r'); // Clear current line
    term.write(`${currentCwd}$ ${currentLine}\r\n`); // Show executed command and new line

    const commandToExecute = currentLine.trim();

    if (commandToExecute === 'clear') {
      term.clear();
      writePrompt();
    } else if (commandToExecute === '') {
      writePrompt();
    } else if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(commandToExecute);
    } else {
      term.write('Backend not connected. Unable to send commands.\r\n');
      writePrompt();
    }
    currentLine = '';
    tabCompletionCandidates = [];
    tabCompletionIndex = 0;
    lastTabTime = 0;
    return;
  }

  if (charCode === 127 || charCode === 8) { // Backspace or Delete
    if (currentLine.length > 0) {
      term.write('\b \b'); // Move back, erase char, move back
      currentLine = currentLine.slice(0, -1);
    }
    tabCompletionCandidates = [];
    tabCompletionIndex = 0;
    lastTabTime = 0;
    return;
  }

  if (charCode === 9) { // Tab key
    const now = Date.now();
    const isContinuousTab = (now - lastTabTime < TAB_COOLDOWN) && tabCompletionCandidates.length > 0;
    lastTabTime = now;

    if (!isContinuousTab) {
      tabCompletionCandidates = commandLexicon.filter(cmd =>
        cmd.toLowerCase().startsWith(currentLine.toLowerCase())
      );
      tabCompletionIndex = 0;
    }

    if (tabCompletionCandidates.length === 0) {
      term.write('\x07'); // Bell character
    } else if (tabCompletionCandidates.length === 1) {
      const completion = tabCompletionCandidates[0];
      term.write(completion.substring(currentLine.length));
      currentLine = completion;
    } else {
      const currentCompletion = tabCompletionCandidates[tabCompletionIndex];
      rewriteCurrentLine(); // Clear and rewrite current input before displaying candidates

      if (!isContinuousTab) {
        term.write(currentLine); // Rewrite current line after clearing
        term.write('\r\n' + tabCompletionCandidates.join('  ') + '\r\n'); // Display candidates
        rewriteCurrentLine(); // Rewrite current input again
      }

      term.write(currentCompletion.substring(currentLine.length)); // Complete the command
      currentLine = currentCompletion;

      tabCompletionIndex = (tabCompletionIndex + 1) % tabCompletionCandidates.length;
    }
    return;
  }

  if (charCode === 3) { // Ctrl+C
    term.write('^C\r\n');
    currentLine = '';
    writePrompt();
    return;
  }

  if (charCode >= 32 || charCode === 10 || charCode === 13) { // Printable characters, newline, carriage return
    term.write(data);
    currentLine += data;
    tabCompletionCandidates = [];
    tabCompletionIndex = 0;
    lastTabTime = 0;
  }
}

// Attach the custom key event handler to `window`, not `term`.
window.addEventListener('keydown', (domEvent: KeyboardEvent) => {
  if (domEvent.ctrlKey && domEvent.code === 'Backquote') {
    domEvent.preventDefault(); // Prevent default browser behavior for Ctrl+`

    if (terminalWrapperElement) {
      if (isTerminalVisible) {
        terminalWrapperElement.classList.add('terminal-hidden');
        destroyTerminal(); // Destroy terminal when hiding
      } else {
        terminalWrapperElement.classList.remove('terminal-hidden');
        // No need for a timeout here, initializeTerminal handles its own timing
        initializeTerminal(); // Re-initialize when showing
      }
      isTerminalVisible = !isTerminalVisible;
    }
    return false; // Prevent further event propagation
  }
  return true; // Allow other key events to propagate
});

// Initial terminal setup on page load
initializeTerminal();