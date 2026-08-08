import 'reflect-metadata';
import { bootstrapService } from '@nexora/nest-common';
import { AppModule } from './app.module';

async function start(): Promise<void> {
  await bootstrapService({
    service: 'call-service',
    module: AppModule,
    portVar: 'CALL_SERVICE_PORT',
    defaultPort: 3007,
  });
}

void start();
