import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { pingDatabase } from '@nexora/database';
import { Logger, createLogger } from '@nexora/logger';
import { RequestIdMiddleware, createHealthController } from '@nexora/nest-common';
import { CallsController } from './modules/calls/calls.controller';
import { CallsService } from './modules/calls/calls.service';

const SERVICE_NAME = 'call-service';

@Module({
  controllers: [CallsController, createHealthController(SERVICE_NAME, pingDatabase)],
  providers: [
    CallsService,
    {
      provide: Logger,
      useFactory: (): Logger => createLogger(SERVICE_NAME, envOr('LOG_LEVEL', 'info') as never),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
