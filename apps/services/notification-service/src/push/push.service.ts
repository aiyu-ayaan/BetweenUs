/**
 * Fan-out: a message was created, and somebody's phone is asleep.
 *
 * Everything already running - the desktop app, an open tab, a phone with the
 * app in front of somebody - is fed by `/ws/chat` and needs nothing from here.
 * This is only for the clients that are not running, which on Android means FCM
 * and is the whole reason phase 27 exists.
 *
 * Two rules shape every line below.
 *
 * **The push is data-only.** It never carries a `notification` block, so
 * Android never draws one on its own: the app is woken and writes the
 * notification itself. That is not a style choice. The body is sealed with the
 * channel key, so this service could not write a notification worth reading if
 * it wanted to - and the client is also the only side that knows whether the
 * channel is already on screen, which is what makes suppression look like
 * WhatsApp's rather than like a duplicate.
 *
 * **The filter here is the half a server can answer.** Off entirely, a muted
 * channel and a muted person are on the envelope, so they are decided here and
 * the phone is never woken. Quiet hours are on the recipient's clock and a
 * mention is inside the ciphertext, so both are decided on the client - the
 * push still goes, and the client drops it. See FCM/README.md.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { channelAudience, prisma } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { Logger } from '@betweenus/logger';
import type { Message, MessagePushData } from '@betweenus/shared-types';
import { DevicesService } from '../modules/devices/devices.service';
import { messaging } from './firebase';

/** FCM's own ceiling for one `sendEach` call. */
const MAX_PER_BATCH = 500;

/**
 * How long a woken client has to be worth waking. Past this the message is
 * old news and the badge on next launch says it better than a late buzz.
 */
const TIME_TO_LIVE_SECONDS = 60 * 60 * 24;

/** What FCM says when a token is dead: an uninstall, a clear-data, an expiry. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

@Injectable()
export class PushService implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly devices: DevicesService,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!messaging()) {
      // Said once, at boot, rather than per message. A deployment with no
      // Firebase project is a running deployment without push, not an error.
      this.logger.info('Push disabled: no Firebase credentials in the environment');
    }

    await this.events.subscribe(EVENTS.MESSAGE_CREATED, (envelope) => {
      void this.onMessage(envelope.payload.message).catch((error: unknown) => {
        this.logger.error('Push fan-out failed', { reason: String(error) });
      });
    });
  }

  private async onMessage(message: Message): Promise<void> {
    const transport = messaging();
    if (!transport) return;

    const audience = (await channelAudience(message.channelId)).filter(
      (userId) => userId !== message.author.id,
    );
    if (audience.length === 0) return;

    const recipients = await this.allowed(audience, message);
    if (recipients.length === 0) return;

    const byUser = await this.devices.tokensFor(recipients.map((one) => one.userId));
    const messages = recipients.flatMap((recipient) => {
      const data = this.payload(message, recipient.mentionsOnly);
      return (byUser.get(recipient.userId) ?? []).map((token) => ({
        token,
        data: data as unknown as Record<string, string>,
        android: {
          // The point of the push is a phone that is asleep, and a normal
          // priority data message is exactly what Doze holds back.
          priority: 'high' as const,
          ttl: TIME_TO_LIVE_SECONDS * 1000,
        },
      }));
    });
    if (messages.length === 0) return;

    const dead: string[] = [];
    let delivered = 0;
    for (let index = 0; index < messages.length; index += MAX_PER_BATCH) {
      const batch = messages.slice(index, index + MAX_PER_BATCH);
      const response = await transport.sendEach(batch);
      delivered += response.successCount;
      response.responses.forEach((one, position) => {
        if (one.success) return;
        const code = one.error?.code ?? '';
        const token = batch[position]?.token;
        if (token && DEAD_TOKEN_CODES.has(code)) dead.push(token);
        // The code, never the token: a log line is not a place for a
        // credential that can push to somebody's phone.
        else this.logger.warn('Push rejected', { code });
      });
    }

    const forgotten = await this.devices.forget(dead);
    this.logger.info('Push sent', {
      channelId: message.channelId,
      recipients: recipients.length,
      delivered,
      forgotten,
    });
  }

  /**
   * Who, of the people who may read this channel, still wants waking.
   *
   * One query for every preference row rather than one per recipient: an
   * account with no row is an account with the defaults, which is most of them.
   */
  private async allowed(
    audience: string[],
    message: Message,
  ): Promise<{ userId: string; mentionsOnly: boolean }[]> {
    const settings = await prisma.notificationSetting.findMany({
      where: { userId: { in: audience } },
      select: {
        userId: true,
        enabled: true,
        mutedChannelIds: true,
        mentionOnlyChannelIds: true,
        mutedUserIds: true,
      },
    });
    const byUser = new Map(settings.map((row) => [row.userId, row]));

    return audience.flatMap((userId) => {
      const row = byUser.get(userId);
      if (!row) return [{ userId, mentionsOnly: false }];
      if (!row.enabled) return [];
      if (row.mutedChannelIds.includes(message.channelId)) return [];
      if (row.mutedUserIds.includes(message.author.id)) return [];
      return [{ userId, mentionsOnly: row.mentionOnlyChannelIds.includes(message.channelId) }];
    });
  }

  /**
   * The envelope, and the sealed body. Nothing here is anything the recipient
   * could not already read off `/ws/chat`, and the words are still ciphertext.
   */
  private payload(message: Message, mentionsOnly: boolean): MessagePushData {
    const data: MessagePushData = {
      type: 'message.created',
      messageId: message.id,
      channelId: message.channelId,
      authorId: message.author.id,
      authorName: message.author.displayName || message.author.username,
      content: message.content,
      createdAt: message.createdAt,
    };
    if (message.author.avatarUrl) data.authorAvatarUrl = message.author.avatarUrl;
    if (mentionsOnly) data.mentionsOnly = '1';
    return data;
  }
}
