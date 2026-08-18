import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { EventBus } from '@betweenus/events';
import { Logger, createLogger } from '@betweenus/logger';
import { createHealthController } from '@betweenus/nest-common';
import { PresenceController } from './presence.controller';
import { PresenceGateway } from './presence.gateway';
import { PresenceStore } from './presence.store';

const SERVICE_NAME = 'presence-service';

@Module({
  controllers: [createHealthController(SERVICE_NAME), PresenceController],
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
