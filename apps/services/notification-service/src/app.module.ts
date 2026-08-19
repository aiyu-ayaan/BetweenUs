import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { pingDatabase } from '@betweenus/database';
import { EventBus } from '@betweenus/events';
import { Logger, createLogger } from '@betweenus/logger';
import { createHealthController } from '@betweenus/nest-common';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { DevicesController } from './modules/devices/devices.controller';
import { DevicesService } from './modules/devices/devices.service';
import { PushService } from './push/push.service';

const SERVICE_NAME = 'notification-service';

@Module({
  controllers: [
    NotificationsController,
    DevicesController,
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    NotificationsService,
    DevicesService,
    PushService,
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
