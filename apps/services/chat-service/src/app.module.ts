import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { EventBus } from '@betweenus/events';
import { pingDatabase } from '@betweenus/database';
import { Logger, createLogger } from '@betweenus/logger';
import { createHealthController } from '@betweenus/nest-common';
import { MessagesController } from './modules/messages/messages.controller';
import { MessagesService } from './modules/messages/messages.service';
import { UnfurlService } from './modules/messages/unfurl.service';
import { ArrivalsService } from './modules/messages/arrivals.service';
import { DisappearingSweeper } from './modules/messages/disappearing-sweeper';
import { UploadsController } from './modules/uploads/uploads.controller';
import { ScratchSweeper } from './modules/uploads/scratch-sweeper';
import { AttachmentSweeper } from './modules/uploads/attachment-sweeper';
import { E2eeController } from './modules/e2ee/e2ee.controller';
import { E2eeService } from './modules/e2ee/e2ee.service';
import {
  BlocksController,
  DirectChannelsController,
  FriendsController,
  UserSearchController,
} from './modules/friends/friends.controller';
import { FriendsService } from './modules/friends/friends.service';
import {
  WebhookExecuteController,
  WebhooksController,
} from './modules/webhooks/webhooks.controller';
import { WebhooksService } from './modules/webhooks/webhooks.service';
import { StatusController } from './modules/status/status.controller';
import { StatusService } from './modules/status/status.service';
import { StatusSweeper } from './modules/status/status-sweeper';
import { ChatGateway } from './gateways/chat.gateway';

const SERVICE_NAME = 'chat-service';

@Module({
  controllers: [
    MessagesController,
    UploadsController,
    E2eeController,
    UserSearchController,
    FriendsController,
    BlocksController,
    DirectChannelsController,
    WebhooksController,
    StatusController,
    // Registered after WebhooksController so `/webhooks/:id/rotate` is matched
    // by the guarded route before `/webhooks/:id/:token` can swallow it.
    WebhookExecuteController,
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    MessagesService,
    UnfurlService,
    ArrivalsService,
    E2eeService,
    FriendsService,
    WebhooksService,
    StatusService,
    ChatGateway,
    ScratchSweeper,
    AttachmentSweeper,
    DisappearingSweeper,
    StatusSweeper,
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
