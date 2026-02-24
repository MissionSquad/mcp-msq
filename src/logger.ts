type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel = levels[(process.env.LOG_LEVEL as LogLevel) ?? 'info']

function log(level: LogLevel, message: string, ...args: unknown[]) {
  if (levels[level] >= currentLevel) {
    const timestamp = new Date().toISOString()
    console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}`, ...args)
  }
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
  info: (message: string, ...args: unknown[]) => log('info', message, ...args),
  warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
  error: (message: string, ...args: unknown[]) => log('error', message, ...args),
}
