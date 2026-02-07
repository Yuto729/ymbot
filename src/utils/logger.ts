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

/**
 * Agent hook event types (corresponds to Claude Agent SDK hook names)
 * Use this enum to categorize log events by their hook trigger
 *
 * @example
 * ```bash
 * # Find all compaction events
 * jq 'select(.meta.eventType == "PreCompact")' /tmp/ymbot/ymbot-*.json
 *
 * # Find all tool executions
 * jq 'select(.meta.eventType == "PostToolUse")' /tmp/ymbot/ymbot-*.json
 *
 * # Count events by type
 * jq '.meta.eventType' /tmp/ymbot/ymbot-*.json | sort | uniq -c
 * ```
 */
export enum AgentHookEvent {
  /** Before compaction (manual or auto) */
  PRE_COMPACT = 'PreCompact',

  /** Before tool execution */
  PRE_TOOL_USE = 'PreToolUse',

  /** After tool execution */
  POST_TOOL_USE = 'PostToolUse',

  /** Session started or resumed */
  SESSION_START = 'SessionStart',

  /** Session ended */
  SESSION_END = 'SessionEnd',

  /** Agent stopped */
  STOP = 'Stop',

  /** User submitted prompt */
  USER_PROMPT_SUBMIT = 'UserPromptSubmit',

  /** Agent response (custom event for final output) */
  AGENT_RESPONSE = 'AgentResponse',

  /** Agent message received from SDK */
  MESSAGE_RECEIVED = 'MessageReceived',

  /** Heartbeat execution error */
  HEARTBEAT_ERROR = 'HeartbeatError',

  /** Notification send error */
  NOTIFICATION_ERROR = 'NotificationError',

  /** Notifier lifecycle (start/stop) */
  NOTIFIER_LIFECYCLE = 'NotifierLifecycle',

  /** Notification sent successfully */
  NOTIFICATION_SENT = 'NotificationSent',
}

/**
 * Structured log metadata with required eventType field
 * Use this type for important logs (hooks, errors, notifications) to ensure
 * they include an event type for filtering
 *
 * For simple informational logs, you can use plain objects without eventType
 */
export interface StructuredLogMetadata {
  /** Event type (required for structured logs) */
  eventType: AgentHookEvent;
  /** Additional metadata fields */
  [key: string]: unknown;
}

/**
 * @deprecated Use StructuredLogMetadata for typed logs
 */
export type LogMetadata = StructuredLogMetadata;

/**
 * Serialize error object for logging
 * Converts Error objects to plain objects, stringifies non-objects
 */
export function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if (error.cause) {
      serialized.cause = serializeError(error.cause);
    }
    return serialized;
  }
  if (typeof error === 'object' && error !== null) {
    return error;
  }
  return String(error);
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
   * @param meta - Optional metadata. Use StructuredLogMetadata for important logs with eventType
   */
  debug(
    message: string,
    context?: LogContext,
    meta?: Record<string, unknown>
  ): void {
    if (this.minLevel <= LogLevel.DEBUG) {
      this.writeToFile('DEBUG', message, context, meta);
      console.log(this.format('DEBUG', colors.gray, message, meta));
    }
  }

  /**
   * Info level log
   * @param meta - Optional metadata. Use StructuredLogMetadata for important logs with eventType
   */
  info(
    message: string,
    context?: LogContext,
    meta?: Record<string, unknown>
  ): void {
    if (this.minLevel <= LogLevel.INFO) {
      this.writeToFile('INFO', message, context, meta);
      console.log(this.format('INFO', colors.blue, message, meta));
    }
  }

  /**
   * Warn level log
   * @param meta - Optional metadata. Use StructuredLogMetadata for important logs with eventType
   */
  warn(
    message: string,
    context?: LogContext,
    meta?: Record<string, unknown>
  ): void {
    if (this.minLevel <= LogLevel.WARN) {
      this.writeToFile('WARN', message, context, meta);
      console.warn(this.format('WARN', colors.yellow, message, meta));
    }
  }

  /**
   * Error level log
   * @param meta - Optional metadata. Use StructuredLogMetadata for important logs with eventType
   */
  error(
    message: string,
    context?: LogContext,
    meta?: Record<string, unknown>
  ): void {
    if (this.minLevel <= LogLevel.ERROR) {
      this.writeToFile('ERROR', message, context, meta);
      console.error(this.format('ERROR', colors.red, message, meta));
    }
  }

  /**
   * Success log (special case of info with green color)
   * @param meta - Optional metadata. Use StructuredLogMetadata for important logs with eventType
   */
  success(
    message: string,
    context?: LogContext,
    meta?: Record<string, unknown>
  ): void {
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
