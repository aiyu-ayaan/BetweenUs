import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type {
  AdminAuditPage,
  AdminOAuthProvider,
  AdminSmtpSettings,
  AdminSmtpTestResult,
  AdminStatus,
  AdminUser,
  AdminUserPage,
} from '@betweenus/shared-types';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminOAuthProviderDto, AdminSmtpDto, AdminSmtpTestDto, AdminUserUpdateDto } from './dto';
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
    @Query('cursor') cursor?: string,
  ): Promise<AdminUserPage> {
    return this.admin.users(query, Number(take) || 50, cursor || undefined);
  }

  @Get('audit')
  @UseGuards(JwtAuthGuard, AdminGuard)
  audit(@Query('take') take = '50', @Query('cursor') cursor?: string): Promise<AdminAuditPage> {
    return this.admin.audit(Number(take) || 50, cursor || undefined);
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

  /**
   * The deployment's outgoing mail server.
   *
   * It is what decides whether the forgot-password screen can offer to send
   * anything at all; with no row here every client says "ask your
   * administrator" instead, which is the honest answer for a self-hosted
   * deployment that has no mail server and does not want one.
   */
  @Get('smtp')
  @UseGuards(JwtAuthGuard, AdminGuard)
  smtp(): Promise<AdminSmtpSettings> {
    return this.admin.smtpSettings();
  }

  @Put('smtp')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateSmtp(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AdminSmtpDto,
  ): Promise<AdminSmtpSettings> {
    return this.admin.updateSmtp(actor.id, dto);
  }

  /** Sends one message, so the settings are proved before somebody needs them. */
  @Post('smtp/test')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminGuard)
  testSmtp(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AdminSmtpTestDto,
  ): Promise<AdminSmtpTestResult> {
    return this.admin.testSmtp(actor.id, dto.to);
  }

  @Get('oauth')
  @UseGuards(JwtAuthGuard, AdminGuard)
  oauth(): Promise<AdminOAuthProvider[]> {
    return this.admin.oauthProviders();
  }

  @Put('oauth/:provider')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateOauth(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('provider') provider: string,
    @Body() dto: AdminOAuthProviderDto,
  ): Promise<AdminOAuthProvider> {
    if (!isProviderName(provider)) {
      throw new NotFoundException({ code: 'UNKNOWN_PROVIDER', message: 'No such provider' });
    }
    return this.admin.updateOAuthProvider(actor.id, provider, dto);
  }
}
