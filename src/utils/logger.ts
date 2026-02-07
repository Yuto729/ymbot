/**
 * Simple colored logger for terminal output
 */
import fs from 'node:fs';
import path from 'node:path';

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Log context (common fields for all logs)
type LogContext = {
  sessionId?: string;
  agentId?: string;
};

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

export const DEFAULT_LOG_DIR = '/tmp/ymbot';
export const DEFAULT_LOG_FILE = path.join(DEFAULT_LOG_DIR, 'ymbot.log'); // legacy single-file path

class Logger {
  private minLevel: LogLevel;
  private name: string;
  private logFile?: string;
  private logDir: string;

  constructor(
    name: string = 'YMBot',
    minLevel: LogLevel = LogLevel.DEBUG,
    logDir: string = DEFAULT_LOG_DIR
  ) {
    this.name = name;
    this.minLevel = minLevel;
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(
      this.logDir,
      `ymbot-${this.formatLocalDate(new Date())}.json`
    );
  }

  /**
   * Format timestamp
   */
  private formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * Format log message
   */
  private format(
    level: string,
    levelColor: string,
    message: string,
    meta?: unknown
  ): string {
    const timestamp = colors.gray + this.getTimestamp() + colors.reset;
    const nameStr = `${colors.cyan}[${this.name}]${colors.reset}`;
    const levelStr = `${levelColor}[${level}]${colors.reset}`;

    let output = `${timestamp} ${nameStr} ${levelStr} ${message}`;

    if (meta !== undefined) {
      const metaStr =
        typeof meta === 'object'
          ? `\n${JSON.stringify(meta, null, 2)}`
          : String(meta);
      output += colors.gray + metaStr + colors.reset;
    }

    return output;
  }

  /**
   * Write log entry to file in JSON Lines format
   */
  private writeToFile(
    level: string,
    message: string,
    context?: LogContext,
    meta?: unknown
  ): void {
    if (!this.logFile) return;
    try {
      const logEntry = {
        time: new Date().toISOString(),
        level: level.toLowerCase(),
        subsystem: this.name,
        ...(context?.sessionId && { sessionId: context.sessionId }),
        ...(context?.agentId && { agentId: context.agentId }),
        message,
        ...(meta !== undefined && { meta }),
      };
      const line = JSON.stringify(logEntry);
      fs.appendFileSync(this.logFile, `${line}\n`, { encoding: 'utf8' });
    } catch {
      // Silently ignore file write errors - logging should not crash the app
    }
  }

  /**
   * Debug level log
   */
  debug(message: string, context?: LogContext, meta?: unknown): void {
    if (this.minLevel <= LogLevel.DEBUG) {
      this.writeToFile('DEBUG', message, context, meta);
      console.log(this.format('DEBUG', colors.gray, message, meta));
    }
  }

  /**
   * Info level log
   */
  info(message: string, context?: LogContext, meta?: unknown): void {
    if (this.minLevel <= LogLevel.INFO) {
      this.writeToFile('INFO', message, context, meta);
      console.log(this.format('INFO', colors.blue, message, meta));
    }
  }

  /**
   * Warn level log
   */
  warn(message: string, context?: LogContext, meta?: unknown): void {
    if (this.minLevel <= LogLevel.WARN) {
      this.writeToFile('WARN', message, context, meta);
      console.warn(this.format('WARN', colors.yellow, message, meta));
    }
  }

  /**
   * Error level log
   */
  error(message: string, context?: LogContext, meta?: unknown): void {
    if (this.minLevel <= LogLevel.ERROR) {
      this.writeToFile('ERROR', message, context, meta);
      console.error(this.format('ERROR', colors.red, message, meta));
    }
  }

  /**
   * Success log (special case of info with green color)
   */
  success(message: string, context?: LogContext, meta?: unknown): void {
    if (this.minLevel <= LogLevel.INFO) {
      this.writeToFile('SUCCESS', message, context, meta);
      console.log(this.format('SUCCESS', colors.green, message, meta));
    }
  }

  /**
   * Create a child logger with a different name
   */
  child(name: string): Logger {
    return new Logger(`${this.name}:${name}`, this.minLevel, this.logDir);
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
}

// Default logger instance
export const logger = new Logger('YMBot');

// Export Logger class, LogLevel, and LogContext for custom instances
export { Logger, LogLevel };
export type { LogContext };

// Export a factory function
export function getLogger(name: string): Logger {
  return logger.child(name);
}
