import 'reflect-metadata';
import type { Server as HttpServer } from 'node:http';
import { bootstrapService } from '@nexora/nest-common';
import { AppModule } from './app.module';
import { CallGateway } from './call.gateway';

async function start(): Promise<void> {
  const app = await bootstrapService({
    service: 'call-service',
    module: AppModule,
    portVar: 'CALL_SERVICE_PORT',
    defaultPort: 3007,
  });

  // The signalling server shares the HTTP listener, so /ws/call and /health
  // live behind one port and one Nginx upstream - the same arrangement
  // presence-service uses.
  //
  // Nothing is verified against a media server at startup any more, because
  // there is not one to be wrong about. This service is ready when it is
  // listening.
  app.get(CallGateway).attach(app.getHttpServer() as HttpServer);
}

void start();
