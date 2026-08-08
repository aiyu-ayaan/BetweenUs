import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { EventBus } from '@nexora/events';
import { Logger, createLogger } from '@nexora/logger';
import { createHealthController } from '@nexora/nest-common';
import { PresenceGateway } from './presence.gateway';
import { PresenceStore } from './presence.store';

const SERVICE_NAME = 'presence-service';

@Module({
  controllers: [createHealthController(SERVICE_NAME)],
  providers: [
    PresenceStore,
    PresenceGateway,
    {
      provide: EventBus,
      useFactory: () => new EventBus(envOr('REDIS_URL', 'redis://localhost:6379'), SERVICE_NAME),
    },
    {
      provide: Logger,
      useFactory: (): Logger => createLogger(SERVICE_NAME, envOr('LOG_LEVEL', 'info') as never),
    },
  ],
})
export class AppModule {}
