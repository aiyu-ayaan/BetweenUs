/**
 * Cross-service NestJS wiring: request ids, the shared error contract, a health
 * endpoint and a bootstrap helper. No business logic - services own that.
 */
import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
  ValidationPipe,
  INestApplication,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { envOr, envNumber, loadEnv } from '@nexora/config';
import { createLogger, type LogLevel, type Logger } from '@nexora/logger';
import type { ApiErrorBody, HealthResponse } from '@nexora/shared-types';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithId extends Request {
  requestId?: string;
}

/** Assigns (or reuses) a request id so logs and error bodies can be correlated. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
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

  // `/health` stays unprefixed so orchestrators probe one stable path.
  app.setGlobalPrefix(options.globalPrefix ?? 'api/v1', { exclude: ['health'] });
  app.enableCors({
    origin: envOr('CORS_ORIGIN', '*'),
    credentials: true,
  });
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
