import 'reflect-metadata';
import { bootstrapService } from '@betweenus/nest-common';
import { AppModule } from './app.module';

void bootstrapService({
  service: 'server-service',
  module: AppModule,
  portVar: 'SERVER_SERVICE_PORT',
  defaultPort: 3003,
  // A channel layout is sent whole, and a big server's is past Express's 100kb.
  jsonBodyLimit: '2mb',
});
