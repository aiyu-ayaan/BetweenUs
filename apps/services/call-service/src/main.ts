import 'reflect-metadata';
import { bootstrapService } from '@nexora/nest-common';
import { createLogger, type LogLevel } from '@nexora/logger';
import { envOr } from '@nexora/config';
import { AppModule } from './app.module';
import { verifyLivekitKeys } from './livekit-check';

async function start(): Promise<void> {
  await bootstrapService({
    service: 'call-service',
    module: AppModule,
    portVar: 'CALL_SERVICE_PORT',
    defaultPort: 3007,
  });

  // Not awaited: the SFU may still be starting, and nothing here gates serving.
  void verifyLivekitKeys(createLogger('call-service', envOr('LOG_LEVEL', 'info') as LogLevel));
}

void start();
