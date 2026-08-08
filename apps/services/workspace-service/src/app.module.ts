import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { EventBus } from '@nexora/events';
import { pingDatabase } from '@nexora/database';
import { createHealthController } from '@nexora/nest-common';
import {
  ChannelsController,
  WorkspacesController,
} from './modules/workspaces/workspaces.controller';
import { WorkspacesService } from './modules/workspaces/workspaces.service';

const SERVICE_NAME = 'workspace-service';

@Module({
  controllers: [
    WorkspacesController,
    ChannelsController,
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    WorkspacesService,
    {
      provide: EventBus,
      useFactory: () => new EventBus(envOr('REDIS_URL', 'redis://localhost:6379'), SERVICE_NAME),
    },
  ],
})
export class AppModule {}
