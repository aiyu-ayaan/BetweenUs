import { Body, Controller, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type {
  AuthResponse,
  AuthTokens,
  ForgotPasswordResponse,
  PublicUser,
  UsernameAvailability,
} from '@betweenus/shared-types';
import { rateLimit } from '@betweenus/nest-common';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateAccountDto,
} from './dto';
import { CREDENTIALS_RATE_LIMIT, LOGIN_RATE_LIMIT, SESSION_RATE_LIMIT } from './rate-limits';

const CredentialsRateLimit = rateLimit(CREDENTIALS_RATE_LIMIT);
const LoginRateLimit = rateLimit(LOGIN_RATE_LIMIT);
const SessionRateLimit = rateLimit(SESSION_RATE_LIMIT);

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UseGuards(CredentialsRateLimit)
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginRateLimit)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(SessionRateLimit)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /**
   * Whether a username can be registered. Unauthenticated, because the form
   * that asks is the one you fill in before you have an account.
   *
   * Rate limited with the credentials bucket: it answers a question about
   * whether an account exists, which is exactly what the login endpoint is
   * throttled for.
   */
  @Get('username-available')
  @UseGuards(CredentialsRateLimit)
  usernameAvailable(@Query('username') username = ''): Promise<UsernameAvailability> {
    return this.auth.usernameAvailable(username);
  }

  /**
   * What can be done about a forgotten password here. Answers the same thing
   * for an account that does not exist as for one that does - see the service.
   */
  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(CredentialsRateLimit)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<ForgotPasswordResponse> {
    return this.auth.forgotPassword(dto.identifier);
  }

  /** Spends a reset token. The only path that sets a password without the old one. */
  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(CredentialsRateLimit)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<AuthResponse> {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  /** Available to any signed-in account, not only admins. */
  @Post('account/password')
  @HttpCode(200)
  @UseGuards(SessionRateLimit, JwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthResponse> {
    return this.auth.changePassword(user.id, dto);
  }

  @Patch('account')
  @UseGuards(JwtAuthGuard)
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAccountDto,
  ): Promise<PublicUser> {
    return this.auth.updateAccount(user.id, dto);
  }
}
