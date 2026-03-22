import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { platform, homedir } from 'os';

function getDefaultLogPath(): string {
  const os = platform();
  if (os === 'win32') {
    // Use ProgramData on Windows — always writable by services
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    return join(programData, 'WhatsOn', 'whatson-api.log');
  }
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Logs', 'whatson-api.log');
  }
  // Linux
  return '/var/log/whatson-api.log';
}

const LOG_FILE = process.env.LOG_FILE || getDefaultLogPath();

// Ensure log directory exists — try multiple approaches
let logStream: ReturnType<typeof createWriteStream> | null = null;

try {
  const logDir = dirname(LOG_FILE);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  logStream = createWriteStream(LOG_FILE, { flags: 'a' });
} catch {
  // If default path fails (permissions), try next to the executable
  try {
    const exeDir = dirname(process.execPath);
    const fallbackLog = join(exeDir, 'whatson-api.log');
    logStream = createWriteStream(fallbackLog, { flags: 'a' });
  } catch {
    // If that also fails, try temp directory
    try {
      const tmpLog = join(require('os').tmpdir(), 'whatson-api.log');
      logStream = createWriteStream(tmpLog, { flags: 'a' });
    } catch {
      // Give up on file logging — console only
    }
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: string, ...args: any[]): void {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  logStream?.write(line);
}

// Intercept console.log/warn/error to also write to the log file
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: any[]) => {
  originalLog(...args);
  writeLog('INFO', ...args);
};

console.warn = (...args: any[]) => {
  originalWarn(...args);
  writeLog('WARN', ...args);
};

console.error = (...args: any[]) => {
  originalError(...args);
  writeLog('ERROR', ...args);
};

// Catch uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  writeLog('FATAL', `Uncaught exception: ${err.message}\n${err.stack}`);
  originalError('FATAL: Uncaught exception:', err);
  // Give the log stream time to flush before exiting
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  writeLog('FATAL', `Unhandled rejection: ${msg}`);
  originalError('FATAL: Unhandled rejection:', reason);
});

// Log startup info
writeLog('INFO', '═══════════════════════════════════════');
writeLog('INFO', `Whats On API starting`);
writeLog('INFO', `PID: ${process.pid}`);
writeLog('INFO', `Node: ${process.version}`);
writeLog('INFO', `Platform: ${process.platform} ${process.arch}`);
writeLog('INFO', `CWD: ${process.cwd()}`);
writeLog('INFO', `Log file: ${LOG_FILE}`);
writeLog('INFO', `Argv: ${process.argv.join(' ')}`);

export { LOG_FILE };
