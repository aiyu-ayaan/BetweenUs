import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { AdminOAuthProvider, AdminStatus, AdminUser } from '@nexora/shared-types';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminOAuthProviderDto, AdminUserUpdateDto } from './dto';
import { isProviderName } from './oauth-providers';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /**
   * Deliberately unauthenticated: the panel has to be able to say "run
   * `pnpm admin:create`" to someone who cannot log in yet. It answers one
   * boolean and nothing else.
   */
  @Get('status')
  status(): Promise<AdminStatus> {
    return this.admin.status();
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, AdminGuard)
  users(
    @Query('query') query?: string,
    @Query('take') take = '50',
    @Query('skip') skip = '0',
  ): Promise<AdminUser[]> {
    return this.admin.users(query, Number(take) || 50, Number(skip) || 0);
  }

  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUserUpdateDto,
  ): Promise<AdminUser> {
    return this.admin.updateUser(actor.id, id, dto);
  }

  @Delete('users/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AdminGuard)
  deleteUser(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.admin.deleteUser(actor.id, id);
  }

  @Get('oauth')
  @UseGuards(JwtAuthGuard, AdminGuard)
  oauth(): Promise<AdminOAuthProvider[]> {
    return this.admin.oauthProviders();
  }

  @Put('oauth/:provider')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateOauth(
    @Param('provider') provider: string,
    @Body() dto: AdminOAuthProviderDto,
  ): Promise<AdminOAuthProvider> {
    if (!isProviderName(provider)) {
      throw new NotFoundException({ code: 'UNKNOWN_PROVIDER', message: 'No such provider' });
    }
    return this.admin.updateOAuthProvider(provider, dto);
  }
}
