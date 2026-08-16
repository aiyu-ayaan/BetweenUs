import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { pingDatabase } from '@nexora/database';
import { EventBus } from '@nexora/events';
import { Logger, createLogger } from '@nexora/logger';
import { createHealthController } from '@nexora/nest-common';
import { CallGateway } from './call.gateway';
import { CallsController } from './modules/calls/calls.controller';
import { CallsService } from './modules/calls/calls.service';

const SERVICE_NAME = 'call-service';

@Module({
  controllers: [CallsController, createHealthController(SERVICE_NAME, pingDatabase)],
  providers: [
    CallsService,
    CallGateway,
    {
      // The roster this service holds is the only true one, so it publishes it
      // for presence-service to draw dots from.
      provide: EventBus,
      useFactory: (): EventBus =>
        new EventBus(envOr('REDIS_URL', 'redis://localhost:6379'), SERVICE_NAME),
    },
    {
      provide: Logger,
      useFactory: (): Logger => createLogger(SERVICE_NAME, envOr('LOG_LEVEL', 'info') as never),
    },
  ],
})
export class AppModule {}
