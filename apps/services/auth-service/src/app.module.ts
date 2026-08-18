import { Module } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { EventBus } from '@betweenus/events';
import { pingDatabase } from '@betweenus/database';
import { createHealthController } from '@betweenus/nest-common';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { authDatabaseProvider } from './modules/auth/auth.db';
import { AdminController } from './modules/admin/admin.controller';
import { AdminService } from './modules/admin/admin.service';
import { OAuthController } from './modules/oauth/oauth.controller';
import { OAuthService } from './modules/oauth/oauth.service';

const SERVICE_NAME = 'auth-service';

@Module({
  controllers: [
    AuthController,
    AdminController,
    OAuthController,
    createHealthController(SERVICE_NAME, pingDatabase),
  ],
  providers: [
    AuthService,
    AdminService,
    OAuthService,
    authDatabaseProvider,
    {
      provide: EventBus,
      useFactory: () => new EventBus(envOr('REDIS_URL', 'redis://localhost:6379'), SERVICE_NAME),
    },
  ],
})
export class AppModule {}
