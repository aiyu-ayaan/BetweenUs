import 'reflect-metadata';
import type { Server as HttpServer } from 'node:http';
import { bootstrapService } from '@betweenus/nest-common';
import { AppModule } from './app.module';
import { PresenceGateway } from './presence.gateway';

async function start(): Promise<void> {
  const app = await bootstrapService({
    service: 'presence-service',
    module: AppModule,
    portVar: 'PRESENCE_SERVICE_PORT',
    defaultPort: 3005,
  });

  // The WebSocket server shares the HTTP listener, so /ws/presence and /health
  // live behind one port and one Nginx upstream.
  const gateway = app.get(PresenceGateway);
  await gateway.attach(app.getHttpServer() as HttpServer);
}

void start();
