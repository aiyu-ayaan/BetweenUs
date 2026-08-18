import 'reflect-metadata';
import type { Server as HttpServer } from 'node:http';
import { bootstrapService } from '@betweenus/nest-common';
import { AppModule } from './app.module';
import { RemoteGateway } from './remote.gateway';

async function start(): Promise<void> {
  const app = await bootstrapService({
    service: 'remote-gateway',
    module: AppModule,
    portVar: 'REMOTE_GATEWAY_PORT',
    defaultPort: 3008,
  });

  // /ws/remote shares the HTTP listener with /api/v1/remote and /health, so the
  // whole service is one port and one Nginx upstream.
  const gateway = app.get(RemoteGateway);
  gateway.attach(app.getHttpServer() as HttpServer);
}

void start();
