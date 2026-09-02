/**
 * Cross-service NestJS wiring: request ids, the shared error contract, a health
 * endpoint and a bootstrap helper. No business logic - services own that.
 */
import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Type,
  ValidationPipe,
  INestApplication,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import Redis, { type Redis as RedisClient } from 'ioredis';
import type { NextFunction, Request, Response } from 'express';
import { envOr, envNumber, loadEnv } from '@betweenus/config';
import { createLogger, type LogLevel, type Logger } from '@betweenus/logger';
import type { ApiErrorBody, HealthResponse } from '@betweenus/shared-types';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithId extends Request {
  requestId?: string;
}

/** Assigns (or reuses) a request id so logs and error bodies can be correlated. */
function assignRequestId(req: RequestWithId, res: Response): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  return requestId;
}

/**
 * Request id + one structured line per completed request.
 *
 * Mounted in `bootstrapService`, so every service gets it without wiring, and
 * before the router, so an id exists even for a 404 that reaches no controller.
 * The id comes from the caller when it sends one, which is what makes a trace
 * survive a hop between services.
 */
function requestContextMiddleware(logger: Logger) {
  return (req: RequestWithId, res: Response, next: NextFunction): void => {
    const requestId = assignRequestId(req, res);
    const startedAt = Date.now();

    res.on('finish', () => {
      // Health probes every few seconds would drown everything else.
      if (req.path === '/health') return;

      const userId = (req as { user?: { id?: string } }).user?.id;
      logger.child({ requestId, ...(userId ? { userId } : {}) }).info('Request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  };
}

/** Maps a thrown error code onto the machine-readable `error.code` field. */
const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly exposeDetails: boolean,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const requestId = request.requestId ?? 'unknown';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = STATUS_CODES[status] ?? 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (typeof record.code === 'string') code = record.code;
        if (typeof record.message === 'string') message = record.message;
        else if (Array.isArray(record.message)) message = record.message.join(', ');
      }
    } else if (this.exposeDetails && exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error('Unhandled request failure', exception, {
        requestId,
        path: request.url,
        method: request.method,
      });
    } else {
      this.logger.warn('Request rejected', {
        requestId,
        path: request.url,
        method: request.method,
        status,
        code,
      });
    }

    // Stack traces never leave the process.
    const body: ApiErrorBody = { error: { code, message, requestId } };
    response.status(status).json(body);
  }
}

/**
 * Sliding-window rate limit, counted in Redis so every instance shares one
 * budget.
 *
 * Nginx already limits by IP at the edge; this is the service-level backstop for
 * traffic that reaches a service another way (another container, a port-forward,
 * a future gateway). Credentials endpoints are the ones that matter.
 *
 * It used to be a fixed window - one `INCR` on a key carrying `floor(now / w)` -
 * which is smaller and has a hole in it: the budget refills all at once, at a
 * boundary an attacker can compute as easily as the server can. Twenty attempts
 * in the last second of one minute and twenty in the first second of the next is
 * forty attempts in two seconds, from a limit that reads "20 per minute". The
 * limit was never wrong about the average; it was wrong about the burst, which
 * is the only thing a credential-stuffing run cares about.
 *
 * A sorted set per bucket, scored by arrival time, is the standard answer: prune
 * what has aged out, add this request, count what is left. There is no boundary
 * to straddle, because the window is measured from now rather than from a clock
 * everybody shares.
 */
let shared: RedisClient | null = null;

/**
 * One Redis connection per process, for the small key-value work several parts
 * of a service need - the rate-limit counters below, and the refresh-rotation
 * grace in auth-service.
 *
 * Not the `EventBus` connections: those are a publisher and a subscriber, and a
 * connection in subscriber mode refuses ordinary commands. This is the third
 * one, and it is one rather than one per caller.
 *
 * `maxRetriesPerRequest: 1` on purpose. Everything reached through here has a
 * correct answer for "Redis did not reply" - the rate limiter fails open, the
 * rotation grace falls back to its in-process map - and all of those answers are
 * worse the longer they take. A caller that hangs waiting for Redis has turned a
 * degraded dependency into a degraded request.
 */
export function sharedRedis(): RedisClient {
  shared ??= new Redis(envOr('REDIS_URL', 'redis://localhost:6379'), {
    maxRetriesPerRequest: 1,
  });
  return shared;
}

/**
 * Closes it, for a process that wants to end.
 *
 * An open Redis connection holds the event loop open, so a self-check that
 * touched this would print its last line and then sit there until something
 * killed it - which is a green check that never returns, and `turbo run check`
 * waiting forever on one package. A long-running service never needs this.
 */
export async function closeSharedRedis(): Promise<void> {
  if (!shared) return;
  const client = shared;
  shared = null;
  await client.quit().catch(() => client.disconnect());
}

/** Just the headers and peer address a client address can be derived from. */
export interface AddressableRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function headerValue(request: AddressableRequest, name: string): string | undefined {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

/**
 * Which address a request is counted against.
 *
 * `x-forwarded-for` is the header everyone reaches for and it is the wrong one
 * to read from the left: the gateway *appends* to it, so a caller that sends
 * `X-Forwarded-For: 1.2.3.4` gets `1.2.3.4, <their real address>` and the first
 * entry is a bucket they chose themselves. A credential-stuffing run then picks
 * a new one per request and the service-level limit counts nothing at all.
 *
 * `x-real-ip` is set by the gateway with `proxy_set_header`, which *replaces*
 * whatever arrived, so it cannot be chosen by the caller. It is read first, and
 * the last hop of `x-forwarded-for` - the one the gateway added - is the
 * fallback for a proxy that sets only that.
 *
 * Neither header means anything on a request that did not come through the
 * gateway, which is why the services sit on internal Docker networks and
 * nothing but Nginx can reach them.
 */
export function clientAddress(request: AddressableRequest): string {
  const real = headerValue(request, 'x-real-ip');
  if (real) return real;

  const forwarded = headerValue(request, 'x-forwarded-for');
  const hops = forwarded?.split(',').map((hop) => hop.trim()).filter(Boolean) ?? [];
  return hops[hops.length - 1] || request.ip || request.socket?.remoteAddress || 'unknown';
}

export interface RateLimitOptions {
  /** Requests allowed per window, per client address. */
  limit: number;
  windowSeconds: number;
  /** Bucket name; defaults to the request path. Share it to pool two routes. */
  name?: string;
  /**
   * A second bucket, counted against what is being *attacked* rather than who
   * is attacking it - the account named in the request body.
   *
   * An address budget alone says nothing about one account under attack from
   * many addresses, which is the shape credential stuffing actually has: a
   * botnet of a thousand hosts gets the full per-address budget each, all of it
   * aimed at one password. This is the other half, and the two are checked
   * together because either one alone has a hole the other covers.
   *
   * Returns null when the request carries no subject, in which case only the
   * address bucket applies.
   */
  subject?: (body: Record<string, unknown>) => string | null;
  /** Budget for the subject bucket per window; defaults to `limit`. */
  subjectLimit?: number;
}

/** One counter to check: its Redis key and the budget it is allowed. */
export interface RateLimitBucket {
  key: string;
  limit: number;
}

/**
 * How many entries a bucket may hold, as a multiple of its budget.
 *
 * A sorted set holds one member per request rather than one integer, so an
 * address being hammered grows a key without bound for a whole window - ten
 * thousand requests a second against a sixty-second window is six hundred
 * thousand members, and doing that to a handful of addresses is a way to spend a
 * service's memory using the endpoint that exists to stop exactly that.
 *
 * Trimming to the newest `limit * this` costs one command and changes no answer.
 * The count is only ever compared against `limit`, and the cap is above it, so a
 * bucket that is over budget stays over budget. What is dropped is the *oldest*
 * entries, which are the ones that would have aged out first - so if it moves
 * the moment a client is let back in at all, it moves it later.
 */
const BUCKET_CAP_FACTOR = 2;

/**
 * Which counters a request falls into. Pure, so the interesting part - that a
 * subject is normalised and that one request is counted in two places - is
 * checkable without a Redis or an HTTP server.
 *
 * Time is not an input. It used to be: the key carried `floor(now / window)`, so
 * the key itself was what expired, and the boundary where it changed was the
 * hole. A sliding window measures from now, and the key it measures in is the
 * same key forever.
 */
export function rateLimitBuckets(
  options: RateLimitOptions,
  request: { path: string; address: string; body: unknown },
): RateLimitBucket[] {
  const name = options.name ?? request.path;
  const buckets: RateLimitBucket[] = [
    { key: `ratelimit:${name}:addr:${request.address}`, limit: options.limit },
  ];

  if (!options.subject) return buckets;

  const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<
    string,
    unknown
  >;
  // Normalised here rather than in every caller: `Alice@example.com` and
  // `alice@example.com ` are one account, and a bucket per spelling is no
  // bucket at all.
  const raw = options.subject(body);
  const subject = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (subject.length === 0) return buckets;

  buckets.push({
    key: `ratelimit:${name}:subject:${subject}`,
    limit: options.subjectLimit ?? options.limit,
  });
  return buckets;
}

/**
 * Counts one request against one bucket and answers whether it is over budget.
 *
 * One round trip. `multi` rather than five awaits because the five commands are
 * one decision: two requests interleaving between the prune and the count would
 * each read a number that was never true.
 *
 * The request is added before it is judged, which is what the fixed-window
 * `INCR` did too - a refused request is still a request that was made, and not
 * counting it is how a client learns that hammering is free.
 */
async function countRequest(bucket: RateLimitBucket, now: number, windowMs: number): Promise<number> {
  const results = await sharedRedis()
    .multi()
    // Everything that has aged out of the window. Inclusive of the cutoff, so an
    // entry exactly `windowMs` old is outside a window that means "the last
    // windowMs".
    .zremrangebyscore(bucket.key, 0, now - windowMs)
    // A uuid, because the member has to be unique or the set silently dedupes
    // two requests that arrived in the same millisecond into one.
    .zadd(bucket.key, now, randomUUID())
    // Keep the newest `limit * BUCKET_CAP_FACTOR`; `-(n + 1)` is "all but the
    // last n", and is a no-op while the set is smaller than that.
    .zremrangebyrank(bucket.key, 0, -(bucket.limit * BUCKET_CAP_FACTOR + 1))
    .zcard(bucket.key)
    // Belt and braces with the prune above: a bucket nobody touches again is
    // collected instead of sitting in memory until the next restart.
    .pexpire(bucket.key, windowMs)
    .exec();

  if (!results) throw new Error('rate-limit transaction was not applied');
  const [error, value] = results[3] ?? [new Error('rate-limit count is missing'), null];
  if (error) throw error;
  return typeof value === 'number' ? value : Number(value);
}

export function rateLimit(options: RateLimitOptions): Type<CanActivate> {
  @Injectable()
  class RateLimitGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest<Request>();
      const now = Date.now();
      const windowMs = options.windowSeconds * 1000;
      const buckets = rateLimitBuckets(options, {
        path: request.path,
        address: clientAddress(request),
        body: request.body,
      });

      let exceeded = false;
      try {
        for (const bucket of buckets) {
          const count = await countRequest(bucket, now, windowMs);
          // Every bucket is counted before any of them refuses: stopping at the
          // first one over budget would leave the others under-counting a
          // request that really was made.
          if (count > bucket.limit) exceeded = true;
        }
      } catch {
        // Redis down: fail open. Locking everyone out of login is the worse outage.
        return true;
      }

      if (exceeded) {
        throw new HttpException(
          { code: 'RATE_LIMITED', message: 'Too many requests, try again later' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    }
  }
  return RateLimitGuard;
}

/**
 * What `CORS_ORIGIN` means on the wire.
 *
 * `credentials: true` alongside a wildcard origin is a contradiction - no
 * browser honours the pair - and it was asking for a cookie-bearing
 * cross-origin request this API has no use for: every client authenticates with
 * a bearer token it attaches itself. So credentials are allowed only when an
 * explicit origin list says which sites they may come from, and a comma
 * separates entries so a deployment can name its web client and its admin panel
 * without opening the door to everything.
 */
export function corsOptions(origin: string): { origin: string | string[]; credentials: boolean } {
  const list = origin
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (list.length === 0 || list.includes('*')) {
    return { origin: '*', credentials: false };
  }
  return { origin: list, credentials: true };
}

/** Every service mounts this at `/health`. Keep the payload free of infra detail. */
export function createHealthController(serviceName: string, check?: () => Promise<boolean>) {
  @Controller('health')
  class HealthController {
    @Get()
    async health(): Promise<HealthResponse> {
      const ok = check ? await check() : true;
      return {
        status: ok ? 'ok' : 'degraded',
        service: serviceName,
        uptime: Math.round(process.uptime()),
      };
    }
  }
  return HealthController;
}

export interface BootstrapOptions {
  service: string;
  module: unknown;
  portVar: string;
  defaultPort: number;
  /** REST prefix. WebSocket gateways opt out by passing an empty string. */
  globalPrefix?: string;
}

export async function bootstrapService(options: BootstrapOptions): Promise<INestApplication> {
  loadEnv();

  const logger = createLogger(options.service, envOr('LOG_LEVEL', 'info') as LogLevel);
  const isProduction = envOr('NODE_ENV', 'development') === 'production';

  const app = await NestFactory.create(options.module as never, { logger: false });

  app.use(requestContextMiddleware(logger));

  // `/health` stays unprefixed so orchestrators probe one stable path.
  app.setGlobalPrefix(options.globalPrefix ?? 'api/v1', { exclude: ['health'] });
  app.enableCors(corsOptions(envOr('CORS_ORIGIN', '*')));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter(logger, !isProduction));

  const port = envNumber(options.portVar, options.defaultPort);
  await app.listen(port);
  logger.info('Service started', { port, nodeEnv: envOr('NODE_ENV', 'development') });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutting down', { signal });
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return app;
}

export { createLogger };
export type { Logger };
