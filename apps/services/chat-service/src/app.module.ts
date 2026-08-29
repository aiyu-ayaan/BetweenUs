import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { EventBus } from '@betweenus/events';
import { pingDatabase } from '@betweenus/database';
import { Logger, createLogger } from '@betweenus/logger';
import { createHealthController } from '@betweenus/nest-common';
import { MessagesController } from './modules/messages/messages.controller';
import { MessagesService } from './modules/messages/messages.service';
import { UnfurlService } from './modules/messages/unfurl.service';
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
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    MessagesService,
    UnfurlService,
    E2eeService,
    FriendsService,
    ChatGateway,
    ScratchSweeper,
    AttachmentSweeper,
    DisappearingSweeper,
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
