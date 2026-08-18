import 'reflect-metadata';
import { bootstrapService } from '@betweenus/nest-common';
import { AppModule } from './app.module';

void bootstrapService({
  service: 'server-service',
  module: AppModule,
  portVar: 'SERVER_SERVICE_PORT',
  defaultPort: 3003,
});
