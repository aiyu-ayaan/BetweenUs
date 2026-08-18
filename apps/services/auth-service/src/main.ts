import 'reflect-metadata';
import { bootstrapService } from '@betweenus/nest-common';
import { AppModule } from './app.module';

void bootstrapService({
  service: 'auth-service',
  module: AppModule,
  portVar: 'AUTH_SERVICE_PORT',
  defaultPort: 3001,
});
