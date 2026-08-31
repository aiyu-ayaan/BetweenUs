import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { pingDatabase } from '@betweenus/database';
import { EventBus } from '@betweenus/events';
import { Logger, createLogger } from '@betweenus/logger';
import { createHealthController } from '@betweenus/nest-common';
import { CallGateway } from './call.gateway';
import { CallsController } from './modules/calls/calls.controller';
import { CallsService } from './modules/calls/calls.service';
import { RelayController } from './modules/calls/relay.controller';
import { RelayHealthService } from './modules/calls/relay-health.service';

const SERVICE_NAME = 'call-service';

@Module({
  controllers: [
    CallsController,
    RelayController,
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    CallsService,
    CallGateway,
    RelayHealthService,
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
