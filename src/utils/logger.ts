/**
 * Logger utility for NbkristQik
 * Provides structured logging with different levels
 * Environment-aware: verbose in development, minimal in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug');

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[LOG_LEVEL as LogLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const emoji = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
    }[level];

    let formatted = `${timestamp} ${emoji} [${level.toUpperCase()}] ${message}`;
    
    if (meta) {
      formatted += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return formatted;
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, error?: Error | any, meta?: any): void {
    if (this.shouldLog('error')) {
      const errorMeta = error instanceof Error 
        ? { message: error.message, stack: error.stack, ...meta }
        : { error, ...meta };
      
      console.error(this.formatMessage('error', message, errorMeta));
    }
  }

  // Security-specific logging
  security(message: string, meta?: any): void {
    this.warn(`🔐 [SECURITY] ${message}`, meta);
  }

  // Performance logging
  perf(message: string, durationMs?: number, meta?: any): void {
    const perfMeta = durationMs 
      ? { durationMs, ...meta }
      : meta;
    this.debug(`⚡ [PERF] ${message}`, perfMeta);
  }
}

export const logger = new Logger();
