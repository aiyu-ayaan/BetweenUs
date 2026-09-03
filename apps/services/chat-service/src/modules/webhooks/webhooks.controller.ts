import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type { Message, WebhookSummary, WebhookWithToken } from '@betweenus/shared-types';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, ExecuteWebhookDto, UpdateWebhookDto } from './dto';

/**
 * Managing a channel's webhooks. Every route here needs `MANAGE_WEBHOOK` on the
 * channel's server, checked in the service rather than inline - see
 * `WebhooksService.requireManage`.
 *
 * Executing one is deliberately **not** here: it is unauthenticated, and a
 * controller-wide `JwtAuthGuard` with one route poking a hole in it is a hole
 * somebody eventually widens by accident. See `WebhookExecuteController`.
 */
@Controller('webhooks')
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<WebhookSummary[]> {
    return this.webhooks.list(user.id, channelId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateWebhookDto,
  ): Promise<WebhookWithToken> {
    return this.webhooks.create(user.id, body.channelId, body.name, body.avatarUrl ?? null);
  }

  @Patch(':webhookId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('webhookId', ParseUUIDPipe) webhookId: string,
    @Body() body: UpdateWebhookDto,
  ): Promise<WebhookSummary> {
    return this.webhooks.update(user.id, webhookId, body);
  }

  /** A new token, invalidating the old one. The only way back from a leak. */
  @Post(':webhookId/rotate')
  rotate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('webhookId', ParseUUIDPipe) webhookId: string,
  ): Promise<WebhookWithToken> {
    return this.webhooks.rotate(user.id, webhookId);
  }

  @Delete(':webhookId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('webhookId', ParseUUIDPipe) webhookId: string,
  ): Promise<void> {
    return this.webhooks.remove(user.id, webhookId);
  }
}

/**
 * The one unauthenticated route in this service.
 *
 * Its own controller precisely so it carries no `JwtAuthGuard` to exempt itself
 * from: the authority is the token in the path, and that is the whole point -
 * a webhook has to be callable by a `curl` in a deploy script that holds no
 * account, no refresh token and no way to get one.
 *
 * `POST` only, and never `GET`: a GET that posts a message is one a link
 * preview crawler fires by following the URL out of a chat window.
 */
@Controller('webhooks')
export class WebhookExecuteController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':webhookId/:token')
  @HttpCode(200)
  execute(
    // Not `ParseUUIDPipe`: an unauthenticated route should answer a malformed
    // id the same way it answers a wrong one, and a 400 saying "that is not a
    // UUID" tells a prober what shape to guess in.
    @Param('webhookId') webhookId: string,
    @Param('token') token: string,
    @Body() body: ExecuteWebhookDto,
  ): Promise<{ message: Message; ignored: string[] }> {
    return this.webhooks.execute(webhookId, token, body);
  }
}
