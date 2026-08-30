/**
 * Fan-out: something happened, and somebody's phone is asleep.
 *
 * Everything already running - the desktop app, an open tab, a phone with the
 * app in front of somebody - is fed by `/ws/chat` and needs nothing from here.
 * This is only for the clients that are not running: a phone with the app
 * swiped away, and a browser with the tab closed.
 *
 * **Two transports, one design.** Phones go through FCM, browsers through Web
 * Push and VAPID, and the only thing that tells a row apart is its platform
 * column. Everything above the transport is shared - the audience, the
 * preference filter, the cross-device suppression, the data-only envelope - so
 * a new kind of push is written once and reaches both. A deployment can
 * configure either, both, or neither, and none of those is broken.
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
 *
 * One more is decided here for a different reason: whether the recipient is
 * *already reading the channel on another device*. A client can only ever see
 * its own screen, so only a server can answer that one - it asks
 * presence-service, and drops those recipients from the fan-out. See
 * `docs/docs/architecture/push-suppression.md`.
 *
 * Five things are worth waking a phone for, and only the first carries words:
 *
 * - `message.created` - somebody said something.
 * - `message.deleted` - somebody unsaid it, and the notification drawn for it
 *   is now a lie. One of the two pushes here that exist to take something *off*
 *   a screen.
 * - `channel.read` - this account read the conversation somewhere else, so the
 *   notification for it on every other device has been dealt with. The other
 *   one that takes something away.
 * - `friend.request` / `friend.accepted` - somebody asked, or said yes.
 * - `server.member.added` - somebody put this account in a server.
 * - `call.roster` - who is in a call in a channel this account can hear. The
 *   whole roster rather than the arrival, because it is one notification that
 *   is rewritten as people come and go, and because an empty roster is the
 *   only thing that can say the call is over.
 * - `call.ring` - somebody is ringing this account into a call. The aimed
 *   version of the one above, and the difference is what earns it a ringtone
 *   and a full-screen ringer: a person pressed a button with this account's
 *   name under it, where a roster is a fact about a room.
 * - `call.handled` - this account answered or declined that ring somewhere.
 *   The third of the pushes that exist to take something away, and the only
 *   thing that can stop the ringer on the devices where nobody touched it.
 * - `remote.session` - somebody is on one of this account's machines. The one
 *   notification here that exists because of what it means when it is
 *   unexpected, and the only one that ignores every preference: see below.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { channelAudience, prisma } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import type { EventName, EventPayloads } from '@betweenus/events';
import { Logger } from '@betweenus/logger';
import type {
  CallHandledPushData,
  CallPushData,
  CallRingPushData,
  ChannelReadPushData,
  FriendPushData,
  Message,
  MessageDeletedPushData,
  MessagePushData,
  PushData,
  RemoteSessionPushData,
  ServerMemberPushData,
} from '@betweenus/shared-types';
import { DevicesService } from '../modules/devices/devices.service';
import { messaging } from './firebase';
import { focusedAmong } from './focus';
import { joined, namesOf, rosterChanged, worthAnnouncing } from './roster';
import { sendWebPush, webPushReady } from './webpush';

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

  /**
   * The last roster pushed per channel, so an announcement nobody's phone can
   * tell apart from the previous one is not a second buzz.
   *
   * ponytail: in memory, so two instances of this service would each push once
   * for the same roster. One instance is what the compose file runs; move this
   * to Redis if there is ever a second.
   */
  private readonly rosters = new Map<string, string[]>();

  async onModuleInit(): Promise<void> {
    // Said once, at boot, rather than per message. A deployment with neither
    // transport configured is a running deployment without push, not an error -
    // and one with a single transport reaches one kind of client, which is a
    // deliberate deployment rather than a half-broken one.
    if (!messaging()) {
      this.logger.info('Push to phones disabled: no Firebase credentials in the environment');
    }
    if (!webPushReady()) {
      this.logger.info('Push to browsers disabled: no VAPID keys in the environment');
    }

    await this.on(EVENTS.MESSAGE_CREATED, (payload) => this.onMessage(payload.message));
    await this.on(EVENTS.MESSAGE_DELETED, (payload) => this.onMessageDeleted(payload));
    await this.on(EVENTS.CHANNEL_READ, (payload) => this.onChannelRead(payload));
    await this.on(EVENTS.FRIEND_CHANGED, (payload) => this.onFriendChanged(payload));
    await this.on(EVENTS.SERVER_MEMBER_ADDED, (payload) => this.onServerMemberAdded(payload));
    await this.on(EVENTS.CALL_ROSTER, (payload) => this.onCallRoster(payload.voice));
    await this.on(EVENTS.CALL_RING, (payload) => this.onCallRing(payload));
    await this.on(EVENTS.CALL_DECLINED, (payload) =>
      this.cancelRing(payload.userId, payload.channelId, 'declined'),
    );
    await this.on(EVENTS.REMOTE_SESSION, (payload) => this.onRemoteSession(payload));
  }

  /**
   * One subscription, one place that catches. A fan-out that throws must not
   * take the bus handler with it: the next event is somebody else's phone.
   */
  private async on<K extends EventName>(
    event: K,
    handle: (payload: EventPayloads[K]) => Promise<void>,
  ): Promise<void> {
    await this.events.subscribe(event, (envelope) => {
      void handle(envelope.payload).catch((error: unknown) => {
        this.logger.error('Push fan-out failed', { event, reason: String(error) });
      });
    });
  }

  private async onMessage(message: Message): Promise<void> {
    const audience = (await channelAudience(message.channelId)).filter(
      (userId) => userId !== message.author.id,
    );
    if (audience.length === 0) return;

    const recipients = await this.allowed(audience, message);
    if (recipients.length === 0) return;

    /**
     * Anybody with this conversation open, on any of their devices, in a
     * focused window.
     *
     * They are reading it as it arrives, so none of their devices is woken -
     * including the ones that are asleep, which is the whole point: the rule is
     * per account, not per device. A different channel is a different key and
     * still buzzes everywhere, which is what makes this bearable.
     *
     * Asked after the preference filter rather than before it, so a channel
     * everybody has muted costs no request at all.
     */
    const reading = await focusedAmong(
      message.channelId,
      recipients.map((one) => one.userId),
    );
    const woken = recipients.filter((one) => !reading.has(one.userId));
    if (woken.length === 0) return;

    await this.deliver(
      woken.map((one) => ({
        userId: one.userId,
        data: this.payload(message, one.mentionsOnly),
      })),
    );
  }

  /**
   * A message was deleted, so the notification drawn for it has to go.
   *
   * The whole audience, with none of the filtering the message itself went
   * through: the point is to take a notification away, and a recipient who was
   * never sent one simply has nothing to remove. Filtering here would be a way
   * to leave a notification standing for a message that no longer exists - the
   * author included, since they may have deleted it from another machine.
   */
  private async onMessageDeleted(payload: {
    messageId: string;
    channelId: string;
  }): Promise<void> {
    const audience = await channelAudience(payload.channelId);
    if (audience.length === 0) return;

    const data: MessageDeletedPushData = {
      type: 'message.deleted',
      messageId: payload.messageId,
      channelId: payload.channelId,
    };
    // Normal priority: taking a stale notification off a screen is worth doing
    // and is not worth pulling a sleeping phone out of Doze for. It lands the
    // moment the phone is next awake, which is the moment anybody would see it.
    await this.deliver(
      audience.map((userId) => ({ userId, data })),
      { urgent: false },
    );
  }

  /**
   * This account read a channel on one of its devices, so the notification for
   * it goes away on the others.
   *
   * The mirror image of `onMessageDeleted`: no audience to work out, no
   * preferences to consult - a read marker is this account talking to itself,
   * and nobody else's phone is involved. It goes to every device including the
   * one that did the reading, which has already cleared its own notification
   * and does nothing with this.
   *
   * Normal priority. Taking a stale notification off a screen is worth doing
   * and is not worth pulling a sleeping phone out of Doze for; it lands the
   * moment the phone is next awake, which is the moment anybody would see it.
   */
  private async onChannelRead(payload: {
    userId: string;
    channelId: string;
    at: string;
  }): Promise<void> {
    const data: ChannelReadPushData = {
      type: 'channel.read',
      channelId: payload.channelId,
      at: payload.at,
    };
    await this.deliver([{ userId: payload.userId, data }], { urgent: false });
  }

  /**
   * Somebody asked to be friends, or said yes.
   *
   * Only the far side is told - the actor already knows what they just did -
   * and only for the two kinds that are news. Declining, cancelling and
   * unfriending all arrive as `removed`, and none of them is a notification.
   */
  private async onFriendChanged(payload: {
    userIds: string[];
    actorId?: string;
    kind?: 'requested' | 'accepted' | 'removed';
  }): Promise<void> {
    const { actorId, kind } = payload;
    if (!actorId || (kind !== 'requested' && kind !== 'accepted')) return;

    const recipients = payload.userIds.filter((userId) => userId !== actorId);
    if (recipients.length === 0) return;

    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { username: true, displayName: true, avatarUrl: true },
    });
    if (!actor) return;

    const data: FriendPushData = {
      type: kind === 'requested' ? 'friend.request' : 'friend.accepted',
      actorId,
      actorName: actor.displayName || actor.username,
    };
    if (actor.avatarUrl) data.actorAvatarUrl = actor.avatarUrl;

    await this.deliver((await this.enabled(recipients)).map((userId) => ({ userId, data })));
  }

  /** Added to a server: one person, one notification, no words to seal. */
  private async onServerMemberAdded(payload: {
    serverId: string;
    userId: string;
  }): Promise<void> {
    const server = await prisma.server.findUnique({
      where: { id: payload.serverId },
      select: { name: true, iconUrl: true, ownerId: true },
    });
    if (!server) return;
    // Creating a server adds its owner to it, and nobody needs telling they
    // have joined the thing they just made.
    if (server.ownerId === payload.userId) return;

    const data: ServerMemberPushData = {
      type: 'server.member.added',
      serverId: payload.serverId,
      serverName: server.name,
    };
    if (server.iconUrl) data.serverIconUrl = server.iconUrl;

    await this.deliver(
      (await this.enabled([payload.userId])).map((userId) => ({ userId, data })),
    );
  }

  /**
   * Who is in a call, told to the people who can hear the channel and are not
   * in it.
   *
   * This is the `call.started` fan-out the Android notes have been waiting
   * for, in the shape that turned out to be right: the roster, not the
   * arrival. One notification per channel, rewritten as people come and go,
   * and an empty roster is what cancels it - which is the only way a phone
   * that was told about a call ever finds out it is over.
   *
   * Announced at the two ends of a call only. It used to go out on every join
   * and every departure, and the audience is everybody who can hear the channel
   * *minus whoever is in it* - so hanging up moved somebody out of the roster,
   * into the audience, and straight into a notification telling them who was
   * still on the call they had just left.
   */
  private async onCallRoster(voice: { channelId: string; userIds: string[] }): Promise<void> {
    const { channelId, userIds } = voice;
    const previous = this.rosters.get(channelId);
    if (!rosterChanged(previous, userIds)) return;
    const first = previous === undefined;
    this.rosters.set(channelId, [...userIds]);

    // Whoever just arrived answered this call somewhere, so the ringer comes
    // down on the devices where they did not. Before the announcement and
    // never gated on preferences: an account that has turned notifications off
    // still has a ringer up if it was ringing before it turned them off, and a
    // cancel is not a notification.
    const answered = joined(previous, userIds);
    for (const userId of answered) await this.cancelRing(userId, channelId, 'answered');

    // A channel nobody has been told about, whose call has already ended:
    // nothing to cancel, so nothing to send.
    if (first && userIds.length === 0) return;

    // Only the two ends of a call. See `worthAnnouncing` for what the middle
    // used to cost the person who left it.
    if (!worthAnnouncing(previous, userIds)) return;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    if (!channel) return;

    const audience = (await channelAudience(channelId)).filter(
      (userId) => !userIds.includes(userId),
    );
    if (audience.length === 0) return;

    const data: CallPushData = {
      type: 'call.roster',
      channelId,
      channelName: channel.name,
      participants: namesOf(await namesFor(userIds)),
      count: String(userIds.length),
    };

    // A call is somebody waiting for an answer, so it is worth the Doze
    // exemption. A call that has *ended* is not: the notification it cancels
    // had already stopped mattering.
    await this.deliver(
      (await this.allowedInChannel(audience, channelId)).map((userId) => ({ userId, data })),
      { urgent: userIds.length > 0 },
    );
  }

  /**
   * Somebody is ringing this account into a call.
   *
   * The filter is deliberately thinner than the roster's. A ring is directed -
   * one person pressed a button with this account's name under it - so a muted
   * *channel* does not silence it: muting #general is saying you do not want
   * to hear about that room, not that a colleague may never call you from it.
   *
   * Two things still do. Notifications off entirely is the account saying it
   * wants no pushes at all, and that includes this one. A muted *person* is
   * the setting that exists for exactly this: somebody you do not want to hear
   * from, however they reach you. Ringing is the loudest way to reach anybody,
   * so it is the last thing that should get past it.
   *
   * Always urgent. A ring that arrives when the phone next wakes up is not a
   * ring, it is a missed call notice - and the client draws that from the
   * roster push it already gets.
   */
  private async onCallRing(payload: EventPayloads['call.ring']): Promise<void> {
    if ((await this.enabled([payload.targetId])).length === 0) return;
    if (await this.mutes(payload.targetId, payload.callerId)) return;

    const data: CallRingPushData = {
      type: 'call.ring',
      channelId: payload.channelId,
      channelName: payload.channelName,
      callerId: payload.callerId,
      callerName: payload.callerName,
    };
    if (payload.callerAvatarUrl) data.callerAvatarUrl = payload.callerAvatarUrl;

    await this.deliver([{ userId: payload.targetId, data }], { urgent: true });
  }

  /**
   * Takes the ringer down on the devices where nobody dealt with it.
   *
   * A ring is aimed at an *account*, so it lands on the phone, the laptop and
   * the browser tab alike - and the account is the one thing neither half of
   * the fan-out could tell afterwards. Answering is invisible to it: the roster
   * announcement is addressed to everybody who can hear the channel *minus
   * whoever is in the call*, so answering moves you into the one group it
   * skips. Declining was invisible too, because nothing about it was sent
   * anywhere at all. Either way the rest of the account's devices rang on until
   * they timed out or the whole call ended.
   *
   * Urgent, unlike the other two cancels here. A late badge correction is a
   * cosmetic delay; a late one of these is a phone going on ringing in somebody's
   * pocket while they are already talking - or while they have already said no.
   *
   * Past every preference, for the same reason `message.deleted` is: an account
   * that has switched notifications off can still have a ringer standing from
   * before it did, and taking one down is not a notification.
   */
  private async cancelRing(
    userId: string,
    channelId: string,
    how: CallHandledPushData['how'],
  ): Promise<void> {
    const data: CallHandledPushData = { type: 'call.handled', channelId, how };
    await this.deliver([{ userId, data }], { urgent: true });
  }

  /** Whether `userId` has muted `otherId`, whatever channel they write in. */
  private async mutes(userId: string, otherId: string): Promise<boolean> {
    const row = await prisma.notificationSetting.findUnique({
      where: { userId },
      select: { mutedUserIds: true },
    });
    return row?.mutedUserIds.includes(otherId) ?? false;
  }

  /**
   * Somebody started or ended a remote session on a machine this account owns.
   *
   * **This one ignores the preferences, and that is deliberate.** Everywhere
   * else a mute is somebody choosing not to be told about a conversation.
   * Remote access is the one capability whose misuse is invisible to the person
   * it happens to - they are, by definition, not sitting at the machine - so a
   * notification that a mute could switch off would be a notification an
   * attacker could arrange to be switched off. The only thing that stops it is
   * turning notifications off entirely, which is the account saying it wants no
   * pushes at all rather than "not this one".
   *
   * Only the owner is told. The person driving already knows what they did, and
   * a session on somebody else's machine is not news anyone else is entitled to.
   */
  private async onRemoteSession(payload: EventPayloads['remote.session']): Promise<void> {
    if (payload.ownerId === payload.actorId) return;

    const data: RemoteSessionPushData = {
      type: 'remote.session',
      sessionId: payload.sessionId,
      machineId: payload.machineId,
      machineName: payload.machineName,
      actorId: payload.actorId,
      actorName: payload.actorName,
      state: payload.state,
    };

    // A session starting is worth waking a phone for - it is the whole point.
    // One ending is a notification being taken away, and lands whenever the
    // device is next awake.
    await this.deliver(
      (await this.enabled([payload.ownerId])).map((userId) => ({ userId, data })),
      { urgent: payload.state === 'started' },
    );
  }

  /**
   * Every push goes out through here: the tokens, FCM's batch ceiling, and the
   * dead ones that come back.
   *
   * One entry per recipient rather than one payload for all of them, because
   * `message.created` writes a different payload per recipient - the
   * mentions-only flag is the reader's, not the message's.
   */
  private async deliver(
    recipients: { userId: string; data: PushData }[],
    options: { urgent?: boolean } = {},
  ): Promise<void> {
    if (recipients.length === 0) return;

    const byUser = await this.devices.tokensFor(recipients.map((one) => one.userId));
    const addresses = recipients.flatMap((recipient) =>
      (byUser.get(recipient.userId) ?? []).map((address) => ({ ...address, data: recipient.data })),
    );
    if (addresses.length === 0) return;

    // Two transports, split on the column that says which. Both halves run,
    // because an account can have a phone and a browser and neither is a
    // fallback for the other.
    const [native, web] = await Promise.all([
      this.deliverFcm(
        addresses.filter((address) => address.platform !== 'web'),
        options,
      ),
      sendWebPush(
        addresses
          .filter((address) => address.platform === 'web')
          .map((address) => ({ stored: address.token, data: address.data })),
        options,
      ),
    ]);

    const forgotten = await this.devices.forget([...native.dead, ...web.dead]);
    this.logger.info('Push sent', {
      type: recipients[0]?.data.type,
      recipients: recipients.length,
      delivered: native.delivered + web.delivered,
      forgotten,
    });
  }

  /** Phones, through Firebase. Nothing here reaches a browser. */
  private async deliverFcm(
    addresses: { token: string; data: PushData }[],
    options: { urgent?: boolean },
  ): Promise<{ delivered: number; dead: string[] }> {
    const transport = messaging();
    if (!transport || addresses.length === 0) return { delivered: 0, dead: [] };

    const messages = addresses.map((address) => ({
      token: address.token,
      data: address.data as unknown as Record<string, string>,
      android: {
        // The point of the push is a phone that is asleep, and a normal
        // priority data message is exactly what Doze holds back.
        priority: (options.urgent === false ? 'normal' : 'high') as 'normal' | 'high',
        ttl: TIME_TO_LIVE_SECONDS * 1000,
      },
    }));

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
    return { delivered, dead };
  }

  /** Accounts that have not turned notifications off altogether. */
  private async enabled(audience: string[]): Promise<string[]> {
    const off = await prisma.notificationSetting.findMany({
      where: { userId: { in: audience }, enabled: false },
      select: { userId: true },
    });
    const silent = new Set(off.map((row) => row.userId));
    return audience.filter((userId) => !silent.has(userId));
  }

  /** The same, plus the channel mute - which a call in that channel obeys too. */
  private async allowedInChannel(audience: string[], channelId: string): Promise<string[]> {
    const settings = await prisma.notificationSetting.findMany({
      where: { userId: { in: audience } },
      select: { userId: true, enabled: true, mutedChannelIds: true },
    });
    const byUser = new Map(settings.map((row) => [row.userId, row]));
    return audience.filter((userId) => {
      const row = byUser.get(userId);
      if (!row) return true;
      return row.enabled && !row.mutedChannelIds.includes(channelId);
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

/**
 * Display names for a set of ids, in the order they were asked for. Somebody
 * who has since been deleted is left out rather than named "Unknown".
 */
async function namesFor(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row.displayName || row.username]));
  return userIds.flatMap((userId) => {
    const name = byId.get(userId);
    return name ? [name] : [];
  });
}
