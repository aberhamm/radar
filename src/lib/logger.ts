/**
 * Structured JSON-line logger for debugging and observability.
 *
 * Reads LOG_LEVEL from env (error | warn | info | debug). Default: info.
 * Writes to stderr so stdout remains clean for structured output (--json, --export).
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: string;
  tool?: string;
  duration?: number;
  [key: string]: unknown;
}

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw && raw in LEVEL_ORDER) return raw as LogLevel;
  return 'info';
}

class Logger {
  private threshold: number;

  constructor() {
    this.threshold = LEVEL_ORDER[resolveLevel()];
  }

  private emit(entry: LogEntry): void {
    if (LEVEL_ORDER[entry.level] > this.threshold) return;
    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  error(message: string, meta?: Partial<Omit<LogEntry, 'level' | 'timestamp' | 'message'>>): void {
    this.emit({ level: 'error', timestamp: new Date().toISOString(), message, ...meta });
  }

  warn(message: string, meta?: Partial<Omit<LogEntry, 'level' | 'timestamp' | 'message'>>): void {
    this.emit({ level: 'warn', timestamp: new Date().toISOString(), message, ...meta });
  }

  info(message: string, meta?: Partial<Omit<LogEntry, 'level' | 'timestamp' | 'message'>>): void {
    this.emit({ level: 'info', timestamp: new Date().toISOString(), message, ...meta });
  }

  debug(message: string, meta?: Partial<Omit<LogEntry, 'level' | 'timestamp' | 'message'>>): void {
    this.emit({ level: 'debug', timestamp: new Date().toISOString(), message, ...meta });
  }

  /** Re-read LOG_LEVEL from env (useful after env changes in tests). */
  reload(): void {
    this.threshold = LEVEL_ORDER[resolveLevel()];
  }
}

export const logger = new Logger();
