import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { AuthResponse, AuthTokens, PublicUser } from '@nexora/shared-types';
import { rateLimit } from '@nexora/nest-common';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, UpdateAccountDto } from './dto';

/**
 * Login and register share one budget per client address: a credential-stuffing
 * run that alternates between them gets no extra room. Generous enough that a
 * person typo-ing their password never sees it.
 */
const CredentialsRateLimit = rateLimit({
  limit: 20,
  windowSeconds: 60,
  name: 'auth-credentials',
});

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
  @UseGuards(CredentialsRateLimit)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  /** Available to any signed-in account, not only admins. */
  @Post('account/password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
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
