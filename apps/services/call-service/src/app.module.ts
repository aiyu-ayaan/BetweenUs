import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { pingDatabase } from '@nexora/database';
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
      provide: Logger,
      useFactory: (): Logger => createLogger(SERVICE_NAME, envOr('LOG_LEVEL', 'info') as never),
    },
  ],
})
export class AppModule {}
