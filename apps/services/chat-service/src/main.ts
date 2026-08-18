import 'reflect-metadata';
import type { Server as HttpServer } from 'node:http';
import { bootstrapService } from '@betweenus/nest-common';
import { AppModule } from './app.module';
import { ChatGateway } from './gateways/chat.gateway';

async function start(): Promise<void> {
  const app = await bootstrapService({
    service: 'chat-service',
    module: AppModule,
    portVar: 'CHAT_SERVICE_PORT',
    defaultPort: 3004,
  });

  // The WebSocket server shares the HTTP listener, so /ws/chat and the REST
  // routes live behind one port and one Nginx upstream.
  const gateway = app.get(ChatGateway);
  await gateway.attach(app.getHttpServer() as HttpServer);
}

void start();
