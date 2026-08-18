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
 * Fixed-window rate limit, counted in Redis so every instance shares one budget.
 *
 * Nginx already limits by IP at the edge; this is the service-level backstop for
 * traffic that reaches a service another way (another container, a port-forward,
 * a future gateway). Credentials endpoints are the ones that matter.
 *
 * ponytail: fixed window, not a sliding one - a burst can straddle two windows
 * and get 2x the budget. Move to a sorted-set sliding window if that matters.
 */
let rateLimitRedis: RedisClient | null = null;

function redisForRateLimit(): RedisClient {
  rateLimitRedis ??= new Redis(envOr('REDIS_URL', 'redis://localhost:6379'), {
    maxRetriesPerRequest: 1,
  });
  return rateLimitRedis;
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
 * Which counters a request falls into. Pure, so the interesting part - that a
 * subject is normalised and that one request is counted in two places - is
 * checkable without a Redis or an HTTP server.
 */
export function rateLimitBuckets(
  options: RateLimitOptions,
  request: { path: string; address: string; body: unknown },
  window: number,
): RateLimitBucket[] {
  const name = options.name ?? request.path;
  const buckets: RateLimitBucket[] = [
    { key: `ratelimit:${name}:addr:${request.address}:${window}`, limit: options.limit },
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
    key: `ratelimit:${name}:subject:${subject}:${window}`,
    limit: options.subjectLimit ?? options.limit,
  });
  return buckets;
}

export function rateLimit(options: RateLimitOptions): Type<CanActivate> {
  @Injectable()
  class RateLimitGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest<Request>();
      const window = Math.floor(Date.now() / (options.windowSeconds * 1000));
      const buckets = rateLimitBuckets(
        options,
        { path: request.path, address: clientAddress(request), body: request.body },
        window,
      );

      let exceeded = false;
      try {
        for (const bucket of buckets) {
          const hits = await redisForRateLimit().incr(bucket.key);
          if (hits === 1) await redisForRateLimit().expire(bucket.key, options.windowSeconds);
          // Every bucket is incremented before any of them refuses: stopping at
          // the first one over budget would leave the others under-counting a
          // request that really was made.
          if (hits > bucket.limit) exceeded = true;
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
