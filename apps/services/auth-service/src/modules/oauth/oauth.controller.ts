import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { rateLimit } from '@nexora/nest-common';
import {
  API_CONTRACT_VERSION,
  type AuthResponse,
  type OAuthProviderSummary,
  type ServerVersion,
} from '@nexora/shared-types';
import { isProviderName } from '../admin/oauth-providers';
import { OAuthExchangeDto } from './dto';
import { OAuthService } from './oauth.service';

/** A browser flow, so the budget is per address and roomy enough for retries. */
const OAuthRateLimit = rateLimit({ limit: 30, windowSeconds: 60, name: 'oauth' });

@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  /**
   * What this deployment speaks, so a client can find out it is too old before
   * a request fails in a way nobody can read.
   *
   * Public and unauthenticated, because the answer decides whether signing in
   * is worth attempting at all. It lives on the OAuth controller because the
   * client already probes `oauth/providers` on this exact path when it is
   * pointed at a deployment, so this costs no new routing anywhere.
   */
  @Get('version')
  version(): ServerVersion {
    return {
      contract: API_CONTRACT_VERSION,
      release: process.env.NEXORA_RELEASE ?? 'dev',
    };
  }

  /** Public: the login screen asks this before drawing its buttons. */
  @Get('providers')
  providers(): Promise<OAuthProviderSummary[]> {
    return this.oauth.enabledProviders();
  }

  /**
   * Entry point, opened in a real browser. `redirect` is where the finished
   * sign-in comes back to - a loopback URL for the desktop client.
   */
  @Get(':provider/start')
  @UseGuards(OAuthRateLimit)
  async start(
    @Param('provider') provider: string,
    @Query('redirect') redirect: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!isProviderName(provider)) {
      throw new NotFoundException({ code: 'UNKNOWN_PROVIDER', message: 'No such provider' });
    }
    if (!redirect) {
      throw new BadRequestException({ code: 'BAD_REDIRECT', message: 'A redirect is required' });
    }
    response.redirect(await this.oauth.authorizeUrl(provider, redirect));
  }

  /** Where the provider sends the browser back to. Never called by a client. */
  @Get(':provider/callback')
  @UseGuards(OAuthRateLimit)
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!isProviderName(provider)) {
      throw new NotFoundException({ code: 'UNKNOWN_PROVIDER', message: 'No such provider' });
    }
    if (!code || !state) {
      throw new BadRequestException({
        code: 'OAUTH_CALLBACK_INVALID',
        message: 'The provider returned an incomplete response',
      });
    }
    response.redirect(await this.oauth.completeCallback(provider, code, state));
  }

  /** The client trades its one-time code for real tokens. */
  @Post('exchange')
  @HttpCode(200)
  @UseGuards(OAuthRateLimit)
  exchange(@Body() dto: OAuthExchangeDto): Promise<AuthResponse> {
    return this.oauth.exchange(dto.code);
  }
}
