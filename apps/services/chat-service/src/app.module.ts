import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { EventBus } from '@nexora/events';
import { pingDatabase } from '@nexora/database';
import { Logger, createLogger } from '@nexora/logger';
import { createHealthController } from '@nexora/nest-common';
import { MessagesController } from './modules/messages/messages.controller';
import { MessagesService } from './modules/messages/messages.service';
import { UploadsController } from './modules/uploads/uploads.controller';
import { E2eeController } from './modules/e2ee/e2ee.controller';
import { E2eeService } from './modules/e2ee/e2ee.service';
import { ChatGateway } from './gateways/chat.gateway';

const SERVICE_NAME = 'chat-service';

@Module({
  controllers: [
    MessagesController,
    UploadsController,
    E2eeController,
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    MessagesService,
    E2eeService,
    ChatGateway,
    {
      provide: EventBus,
      useFactory: () => new EventBus(envOr('REDIS_URL', 'redis://localhost:6379'), SERVICE_NAME),
    },
    {
      // Logger is a class, so it doubles as its own injection token.
      provide: Logger,
      useFactory: (): Logger => createLogger(SERVICE_NAME, envOr('LOG_LEVEL', 'info') as never),
    },
  ],
})
export class AppModule {}
