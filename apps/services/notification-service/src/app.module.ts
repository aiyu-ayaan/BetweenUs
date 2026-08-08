import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { pingDatabase } from '@nexora/database';
import { Logger, createLogger } from '@nexora/logger';
import { createHealthController } from '@nexora/nest-common';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationsService } from './modules/notifications/notifications.service';

const SERVICE_NAME = 'notification-service';

@Module({
  controllers: [NotificationsController, createHealthController(SERVICE_NAME, pingDatabase)],
  providers: [
    NotificationsService,
    {
      provide: Logger,
      useFactory: (): Logger => createLogger(SERVICE_NAME, envOr('LOG_LEVEL', 'info') as never),
    },
  ],
})
export class AppModule {}
