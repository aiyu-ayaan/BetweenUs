import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { pingDatabase } from '@betweenus/database';
import { EventBus } from '@betweenus/events';
import { Logger, createLogger } from '@betweenus/logger';
import { createHealthController } from '@betweenus/nest-common';
import { RemoteController } from './modules/remote/remote.controller';
import { RemoteService } from './modules/remote/remote.service';
import { RemoteGateway } from './remote.gateway';
import { RetentionSweeper } from './modules/remote/retention';

const SERVICE_NAME = 'remote-gateway';

@Module({
  controllers: [RemoteController, createHealthController(SERVICE_NAME, pingDatabase)],
  providers: [
    RemoteService,
    RemoteGateway,
    RetentionSweeper,
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
