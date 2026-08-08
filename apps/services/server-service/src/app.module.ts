import { Module } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { EventBus } from '@nexora/events';
import { pingDatabase } from '@nexora/database';
import { createHealthController } from '@nexora/nest-common';
import {
  ChannelsController,
  ServersController,
} from './modules/servers/servers.controller';
import { ServersService } from './modules/servers/servers.service';

const SERVICE_NAME = 'server-service';

@Module({
  controllers: [
    ServersController,
    ChannelsController,
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    ServersService,
    {
      provide: EventBus,
      useFactory: () => new EventBus(envOr('REDIS_URL', 'redis://localhost:6379'), SERVICE_NAME),
    },
  ],
})
export class AppModule {}
