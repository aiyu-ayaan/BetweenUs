/**
 * Structured JSON logging with secret redaction.
 *
 * Deliberately dependency-free: one JSON line per event is all the MVP needs,
 * and it is what a log shipper wants anyway.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/** Keys whose values must never reach a log sink. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'jwtsecret',
  'jwtrefreshsecret',
  'apikey',
  'privatekey',
]);

export interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export class Logger {
  private readonly minWeight: number;

  constructor(
    private readonly service: string,
    level: LogLevel = 'info',
    private readonly base: LogContext = {},
  ) {
    this.minWeight = LEVEL_WEIGHT[level];
  }

  /** Returns a logger that stamps every line with extra context (request id, user id). */
  child(context: LogContext): Logger {
    const level = (Object.keys(LEVEL_WEIGHT) as LogLevel[]).find(
      (key) => LEVEL_WEIGHT[key] === this.minWeight,
    );
    return new Logger(this.service, level ?? 'info', { ...this.base, ...context });
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    this.write('error', message, { ...context, err: error ? serializeError(error) : undefined });
  }

  fatal(message: string, error?: unknown, context?: LogContext): void {
    this.write('fatal', message, { ...context, err: error ? serializeError(error) : undefined });
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < this.minWeight) return;

    const line = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...(redact({ ...this.base, ...context }) as Record<string, unknown>),
    };

    const serialized = JSON.stringify(line);
    if (level === 'error' || level === 'fatal') process.stderr.write(`${serialized}\n`);
    else process.stdout.write(`${serialized}\n`);
  }
}

export function createLogger(service: string, level: LogLevel = 'info'): Logger {
  return new Logger(service, level);
}
