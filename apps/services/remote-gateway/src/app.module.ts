import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { pingDatabase } from '@nexora/database';
import { Logger, createLogger } from '@nexora/logger';
import { createHealthController } from '@nexora/nest-common';
import { RemoteController } from './modules/remote/remote.controller';
import { RemoteService } from './modules/remote/remote.service';
import { RemoteGateway } from './remote.gateway';

const SERVICE_NAME = 'remote-gateway';

@Module({
  controllers: [RemoteController, createHealthController(SERVICE_NAME, pingDatabase)],
  providers: [
    RemoteService,
    RemoteGateway,
    {
      provide: Logger,
      useFactory: (): Logger => createLogger(SERVICE_NAME, envOr('LOG_LEVEL', 'info') as never),
    },
  ],
})
export class AppModule {}
