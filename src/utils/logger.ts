/**
 * Simple colored logger for terminal output
 */

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

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

class Logger {
  private minLevel: LogLevel;
  private name: string;

  constructor(name: string = 'YMBot', minLevel: LogLevel = LogLevel.DEBUG) {
    this.name = name;
    this.minLevel = minLevel;
  }

  /**
   * Format timestamp
   */
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
   * Debug level log
   */
  debug(message: string, meta?: unknown): void {
    if (this.minLevel <= LogLevel.DEBUG) {
      console.log(this.format('DEBUG', colors.gray, message, meta));
    }
  }

  /**
   * Info level log
   */
  info(message: string, meta?: unknown): void {
    if (this.minLevel <= LogLevel.INFO) {
      console.log(this.format('INFO', colors.blue, message, meta));
    }
  }

  /**
   * Warn level log
   */
  warn(message: string, meta?: unknown): void {
    if (this.minLevel <= LogLevel.WARN) {
      console.warn(this.format('WARN', colors.yellow, message, meta));
    }
  }

  /**
   * Error level log
   */
  error(message: string, meta?: unknown): void {
    if (this.minLevel <= LogLevel.ERROR) {
      console.error(this.format('ERROR', colors.red, message, meta));
    }
  }

  /**
   * Success log (special case of info with green color)
   */
  success(message: string, meta?: unknown): void {
    if (this.minLevel <= LogLevel.INFO) {
      console.log(this.format('SUCCESS', colors.green, message, meta));
    }
  }

  /**
   * Create a child logger with a different name
   */
  child(name: string): Logger {
    return new Logger(`${this.name}:${name}`, this.minLevel);
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

// Export Logger class and LogLevel for custom instances
export { Logger, LogLevel };

// Export a factory function
export function getLogger(name: string): Logger {
  return logger.child(name);
}
