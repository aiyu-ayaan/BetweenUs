import 'reflect-metadata';
import { bootstrapService } from '@betweenus/nest-common';
import { AppModule } from './app.module';

async function start(): Promise<void> {
  await bootstrapService({
    service: 'notification-service',
    module: AppModule,
    portVar: 'NOTIFICATION_SERVICE_PORT',
    defaultPort: 3006,
  });
}

void start();
