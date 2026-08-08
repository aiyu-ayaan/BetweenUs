import 'reflect-metadata';
import { bootstrapService } from '@nexora/nest-common';
import { AppModule } from './app.module';

void bootstrapService({
  service: 'workspace-service',
  module: AppModule,
  portVar: 'WORKSPACE_SERVICE_PORT',
  defaultPort: 3003,
});
