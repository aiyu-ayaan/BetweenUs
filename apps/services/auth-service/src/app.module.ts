import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { envOr } from '@nexora/config';
import { EventBus } from '@nexora/events';
import { pingDatabase } from '@nexora/database';
import { RequestIdMiddleware, createHealthController } from '@nexora/nest-common';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { authDatabaseProvider } from './modules/auth/auth.db';

const SERVICE_NAME = 'auth-service';

@Module({
  controllers: [AuthController, createHealthController(SERVICE_NAME, pingDatabase)],
  providers: [
    AuthService,
    authDatabaseProvider,
    {
      provide: EventBus,
      useFactory: () => new EventBus(envOr('REDIS_URL', 'redis://localhost:6379'), SERVICE_NAME),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
