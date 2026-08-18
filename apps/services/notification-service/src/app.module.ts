import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { pingDatabase } from '@betweenus/database';
import { Logger, createLogger } from '@betweenus/logger';
import { createHealthController } from '@betweenus/nest-common';
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
