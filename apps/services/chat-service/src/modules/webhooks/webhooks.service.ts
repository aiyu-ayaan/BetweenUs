/**
 * Webhooks: a URL an outside system POSTs to in order to say something in a
 * channel.
 *
 * Discord's shape, because it is the one every CI runner, alerting stack and
 * "send to chat" integration already speaks - one opaque URL carrying its own
 * authority, a JSON body with a `content` field, and no account, OAuth dance or
 * bot framework anywhere near it. A webhook that needed a client library would
 * not be reachable from the `curl` in somebody's deploy script, which is the
 * entire reason to have one.
 *
 * ## Why this lives in chat-service
 *
 * Managing a webhook is a channel operation and would fit `server-service`;
 * *executing* one writes a message and has to broadcast it, which only this
 * service can do. Splitting the two would put one `/api/v1/webhooks` prefix
 * across two upstreams in the gateway, so both halves are here and the routing
 * stays one line.
 *
 * ## The plaintext exception
 *
 * **A webhook body is stored and delivered in the clear.** This is the single
 * documented exception to the sealed-envelope rule, and it is deliberate.
 *
 * The design assumes every author holds the channel key. A build server does
 * not, cannot be given one - handing a channel key to a shell script is handing
 * away the channel, to everyone who can read that script, permanently - and
 * could not use one without this project shipping its crypto to every language
 * anybody writes a deploy script in.
 *
 * So the trade is made visible rather than hidden. `Message.kind` is `WEBHOOK`,
 * every client draws the row with a badge saying it was not encrypted, and the
 * channel says a webhook is attached. A channel with a webhook on it is a
 * channel whose guarantee is now "everything except what the robots say", and
 * the clients say exactly that instead of implying more.
 *
 * Nothing here weakens a *person's* message: `POST /api/v1/messages` still
 * takes a sealed envelope and this service still cannot read one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { envOr } from '@betweenus/config';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { prisma, resolveChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS } from '@betweenus/permissions';
import {
  WEBHOOK_CONTENT_MAX_LENGTH,
  WEBHOOK_EMBED_MAX,
  type ExecuteWebhookRequest,
  type Message,
  type WebhookEmbed,
  type WebhookSummary,
  type WebhookWithToken,
} from '@betweenus/shared-types';
import { toMessage } from '../messages/messages.service';

/**
 * How many random bytes the token half of the URL carries.
 *
 * 32 bytes, base64url, is 43 characters - the same order as Discord's and far
 * past guessing. It is the *only* thing protecting a channel from anybody who
 * finds the URL, so it is sized as a secret rather than as an identifier.
 */
const TOKEN_BYTES = 32;

/** Only what a client draws. The row also carries the hash, which nothing may read. */
const WEBHOOK_SELECT = {
  id: true,
  channelId: true,
  name: true,
  avatarUrl: true,
  lastUsedAt: true,
  createdAt: true,
  createdBy: {
    select: { id: true, username: true, displayName: true, avatarUrl: true, coverUrl: true, about: true },
  },
} as const;

const MESSAGE_INCLUDE = {
  author: true,
  deletedBy: true,
  reactions: { select: { userId: true, emoji: true } },
  views: { select: { userId: true } },
  webhook: { select: { id: true, name: true, avatarUrl: true } },
} as const;

/**
 * SHA-256 of a token, which is the only form of it this service keeps.
 *
 * The same rule `RemoteMachine.agentTokenHash` and `PasswordReset.tokenHash`
 * already follow. Discord keeps its webhook URLs re-readable so it can show
 * them again; a token a database can be asked for is a token a database dump
 * hands over, and losing this one costs a rotation rather than an account.
 *
 * No salt and no slow KDF, deliberately: this is a 256-bit random value, not a
 * password, so there is no dictionary to run and nothing for a work factor to
 * buy. What it needs is a constant-time single lookup, which is what a unique
 * index on the digest gives.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class WebhooksService {
  constructor(private readonly events: EventBus) {}

  /**
   * Every webhook on a channel.
   *
   * `MANAGE_WEBHOOK` to *see* them and not merely to change them: the list is
   * how somebody finds out that a channel they are in is being posted into by
   * an outside system, and a member who can read that list can tell that the
   * channel's plaintext exception is live. That is worth showing, but the audit
   * question ("who let a robot in here") belongs with the people who can answer
   * it. Members learn a webhook exists from the badge on its messages, which is
   * the honest place for them to learn it.
   */
  async list(userId: string, channelId: string): Promise<WebhookSummary[]> {
    await this.requireManage(userId, channelId);
    const rows = await prisma.webhook.findMany({
      where: { channelId },
      select: WEBHOOK_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSummary);
  }

  /**
   * Mints one, and returns the URL. This is the only moment the token exists in
   * readable form outside the caller's screen.
   */
  async create(
    userId: string,
    channelId: string,
    name: string,
    avatarUrl: string | null,
  ): Promise<WebhookWithToken> {
    await this.requireManage(userId, channelId);

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const row = await prisma.webhook.create({
      data: {
        channelId,
        name: name.trim(),
        avatarUrl,
        createdById: userId,
        tokenHash: hashToken(token),
      },
      select: WEBHOOK_SELECT,
    });
    return { ...toSummary(row), url: urlFor(row.id, token) };
  }

  async update(
    userId: string,
    webhookId: string,
    changes: { name?: string; avatarUrl?: string | null },
  ): Promise<WebhookSummary> {
    const existing = await this.owned(userId, webhookId);
    const row = await prisma.webhook.update({
      where: { id: existing.id },
      data: {
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        // null is a real value - it clears the picture back to the initial -
        // so only an absent key means "leave it alone".
        ...(changes.avatarUrl !== undefined ? { avatarUrl: changes.avatarUrl } : {}),
      },
      select: WEBHOOK_SELECT,
    });
    return toSummary(row);
  }

  /**
   * A new token for an existing webhook, invalidating the old one at once.
   *
   * The way back from a URL that has leaked, and the way back from one that was
   * simply not written down when it was created - which is the cost of hashing
   * it, and is why this endpoint is not optional.
   */
  async rotate(userId: string, webhookId: string): Promise<WebhookWithToken> {
    const existing = await this.owned(userId, webhookId);
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const row = await prisma.webhook.update({
      where: { id: existing.id },
      data: { tokenHash: hashToken(token) },
      select: WEBHOOK_SELECT,
    });
    return { ...toSummary(row), url: urlFor(row.id, token) };
  }

  /**
   * Deletes it. What it has already said stays: `Message.webhookId` is
   * `SetNull`, so the history keeps its rows and they fall back to a name.
   * Deleting a webhook is closing a door, not retracting what came through it.
   */
  async remove(userId: string, webhookId: string): Promise<void> {
    const existing = await this.owned(userId, webhookId);
    await prisma.webhook.delete({ where: { id: existing.id } });
  }

  /**
   * Posts a message as the webhook. **Unauthenticated** - the token in the URL
   * is the whole of the authority, which is what makes it reachable from a
   * `curl` in a deploy script.
   *
   * Looked up by the digest, so a wrong token is one indexed miss rather than a
   * scan. A wrong token and a deleted webhook answer identically: the URL is
   * the secret, and distinguishing "no such webhook" from "wrong token" would
   * let anybody with an id confirm one exists.
   */
  async execute(
    webhookId: string,
    token: string,
    body: ExecuteWebhookRequest,
  ): Promise<{ message: Message; ignored: string[] }> {
    const webhook = await prisma.webhook.findFirst({
      where: { id: webhookId, tokenHash: hashToken(token) },
    });
    if (!webhook) {
      throw new NotFoundException({
        code: 'WEBHOOK_NOT_FOUND',
        message: 'No webhook with that id and token',
      });
    }

    const content = renderBody(body);
    if (content.length === 0) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_BODY',
        message: 'A webhook message needs content or at least one embed',
      });
    }
    if (content.length > WEBHOOK_CONTENT_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_BODY',
        // Named, because "too long" from an integration nobody is watching is a
        // silent failure somebody debugs for an afternoon.
        message: `Rendered message is ${content.length} characters; the limit is ${WEBHOOK_CONTENT_MAX_LENGTH}`,
      });
    }

    const row = await prisma.message.create({
      data: {
        channelId: webhook.channelId,
        // The row has to belong to a real account - `authorId` is not nullable,
        // and making it nullable to model robots would touch every query in
        // this service. The person who opened the door is the honest answer,
        // and no client draws it: `kind` is WEBHOOK, so they all draw the
        // webhook's own name over the top.
        authorId: webhook.createdById,
        kind: 'WEBHOOK',
        // Plaintext. See the file header - this is the documented exception.
        content,
        webhookId: webhook.id,
      },
      include: MESSAGE_INCLUDE,
    });

    // The first thing anybody asks about a webhook that "isn't working". Not
    // awaited with the message: a failed bookkeeping write must not turn a
    // delivered message into a 500 the sender then retries.
    void prisma.webhook
      .update({ where: { id: webhook.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    const message = toMessage(row);
    await this.events.publish(EVENTS.MESSAGE_CREATED, { message });
    return { message, ignored: ignoredFields(body) };
  }

  /** `MANAGE_WEBHOOK` on the channel's server. A direct message has no webhooks. */
  private async requireManage(userId: string, channelId: string): Promise<void> {
    const access = await resolveChannelAccess(userId, channelId);
    if (!access) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }
    // A direct message belongs to two people and has no roles to hold the
    // permission - and a URL that posts into somebody's DMs forever is not a
    // thing this app is going to offer.
    if (access.serverId === null) {
      throw new ForbiddenException({
        code: 'WEBHOOK_NOT_ALLOWED',
        message: 'Direct messages cannot have webhooks',
      });
    }
    if (!access.permissions.includes(PERMISSIONS.MANAGE_WEBHOOK)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Missing permission ${PERMISSIONS.MANAGE_WEBHOOK}`,
      });
    }
  }

  /**
   * The webhook, once the caller has been shown to manage its channel.
   *
   * Resolved through the channel rather than by who created it: a webhook
   * belongs to the channel it posts into, so an administrator has to be able to
   * revoke one opened by somebody who has since left.
   */
  private async owned(userId: string, webhookId: string) {
    const row = await prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!row) {
      throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' });
    }
    await this.requireManage(userId, row.channelId);
    return row;
  }
}

/**
 * Where a webhook's URL points.
 *
 * `PUBLIC_API_URL`, which is the same variable the OAuth callback is built
 * from - read from the environment rather than from the request, because this
 * URL is pasted into somebody else's system and has to be the deployment's
 * public address. A `Host` header behind a Cloudflare Tunnel is whatever the
 * tunnel put there, and a webhook URL that only works from inside the network
 * is a webhook URL that does not work.
 */
function urlFor(id: string, token: string): string {
  const base = envOr('PUBLIC_API_URL', 'http://localhost:8080').replace(/\/+$/, '');
  return `${base}/api/v1/webhooks/${id}/${token}`;
}

function toSummary(row: {
  id: string;
  channelId: string;
  name: string;
  avatarUrl: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  createdBy: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    about: string;
  };
}): WebhookSummary {
  return {
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    avatarUrl: row.avatarUrl,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    createdBy: {
      id: row.createdBy.id,
      username: row.createdBy.username,
      displayName: row.createdBy.displayName,
      avatarUrl: row.createdBy.avatarUrl,
      coverUrl: row.createdBy.coverUrl,
      about: row.createdBy.about,
    },
  };
}

/**
 * Flattens a Discord payload into the one plaintext string a message body is.
 *
 * Embeds are rendered to Markdown rather than modelled, and that is the whole
 * design decision here. Every client in this app already renders Markdown in a
 * message; a structured embed would need a renderer in three clients, a place
 * in the sealed manifest it cannot go, and a fallback for the two years of
 * builds that predate it. Markdown is the fallback, so it is also the format.
 *
 * What is lost is the coloured bar down the left of a Discord embed. What is
 * kept is every word an integration sent, on every client, including the ones
 * already installed.
 *
 * Exported for `webhook-body.check.ts`.
 */
export function renderBody(body: ExecuteWebhookRequest): string {
  const parts: string[] = [];
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (content) parts.push(content);

  const embeds = Array.isArray(body.embeds) ? body.embeds.slice(0, WEBHOOK_EMBED_MAX) : [];
  for (const embed of embeds) {
    const rendered = renderEmbed(embed);
    if (rendered) parts.push(rendered);
  }

  return parts.join('\n\n').trim();
}

function renderEmbed(embed: WebhookEmbed): string {
  const lines: string[] = [];

  const title = text(embed.title);
  if (title) {
    // A title with a URL becomes a link, which is what a Discord embed's title
    // does and is the only part of one anybody actually clicks.
    const url = text(embed.url);
    lines.push(url ? `**[${title}](${url})**` : `**${title}**`);
  }

  const description = text(embed.description);
  if (description) lines.push(description);

  for (const field of Array.isArray(embed.fields) ? embed.fields : []) {
    const name = text(field?.name);
    const value = text(field?.value);
    if (!name && !value) continue;
    // `inline` is dropped: it asks for a column layout, and a plaintext body
    // has no columns. Rendering it as a run-on line instead would lose the
    // field names, which are the half worth keeping.
    lines.push(name ? `**${name}**\n${value}` : value);
  }

  const footer = text(embed.footer?.text);
  if (footer) lines.push(`_${footer}_`);

  return lines.join('\n').trim();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Which fields of the payload were accepted and then not used.
 *
 * Returned in the response rather than swallowed. An integration that sends
 * `avatar_url` and sees its own picture ignored has no way to tell a policy
 * from a bug, and would go looking for the bug.
 */
export function ignoredFields(body: ExecuteWebhookRequest): string[] {
  const ignored: string[] = [];
  // Fetching an arbitrary URL would make every client that draws this message
  // beacon back to whoever supplied it, and would make this service fetch it
  // too. The webhook's own stored picture is used instead.
  if (typeof body.avatar_url === 'string' && body.avatar_url.length > 0) {
    ignored.push('avatar_url');
  }
  // A per-message name would need a column on every message to carry it, and
  // the thing it buys - one URL posting under several identities - is bought
  // instead by making several webhooks, which is a button rather than a schema
  // change. Reported rather than swallowed, so an integration whose name is not
  // showing up looks here instead of at its own code.
  if (typeof body.username === 'string' && body.username.length > 0) {
    ignored.push('username');
  }
  const embeds = Array.isArray(body.embeds) ? body.embeds : [];
  if (embeds.length > WEBHOOK_EMBED_MAX) ignored.push(`embeds beyond ${WEBHOOK_EMBED_MAX}`);
  if (embeds.some((embed) => typeof embed?.color === 'number')) ignored.push('embed color');
  return ignored;
}
