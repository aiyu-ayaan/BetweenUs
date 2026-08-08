/**
 * Redis-backed presence state.
 *
 * Online users live in one sorted set scored by their last heartbeat, so a
 * crashed client ages out instead of appearing online forever, and no per-user
 * key bookkeeping is needed. Voice membership is a set per channel.
 *
 * Nothing here is durable on purpose: presence is realtime state, and Redis is
 * where the architecture puts it.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { envOr } from '@nexora/config';
import type { PresenceState, VoiceState } from '@nexora/shared-types';

const ONLINE_KEY = 'presence:online';
const VOICE_KEY = (channelId: string): string => `presence:voice:${channelId}`;
const VOICE_INDEX = 'presence:voice:channels';

/** A client that has not checked in for this long is treated as gone. */
export const STALE_AFTER_MS = 90_000;

@Injectable()
export class PresenceStore implements OnModuleDestroy {
  private readonly redis = new Redis(envOr('REDIS_URL', 'redis://localhost:6379'), {
    maxRetriesPerRequest: null,
  });

  /** Marks a user online, or refreshes their heartbeat. */
  async touch(userId: string): Promise<void> {
    await this.redis.zadd(ONLINE_KEY, Date.now(), userId);
  }

  async goOffline(userId: string): Promise<void> {
    await this.redis.zrem(ONLINE_KEY, userId);
  }

  async onlineUsers(): Promise<PresenceState[]> {
    const cutoff = Date.now() - STALE_AFTER_MS;
    // Drop stale entries as a side effect of reading, so no sweeper job is
    // needed for a set this small.
    await this.redis.zremrangebyscore(ONLINE_KEY, '-inf', cutoff);
    const ids = await this.redis.zrange(ONLINE_KEY, 0, -1);
    return ids.map((userId) => ({ userId, status: 'online' as const }));
  }

  async joinVoice(channelId: string, userId: string): Promise<VoiceState> {
    await this.redis.sadd(VOICE_KEY(channelId), userId);
    await this.redis.sadd(VOICE_INDEX, channelId);
    return this.voiceState(channelId);
  }

  async leaveVoice(channelId: string, userId: string): Promise<VoiceState> {
    await this.redis.srem(VOICE_KEY(channelId), userId);
    const state = await this.voiceState(channelId);
    if (state.userIds.length === 0) await this.redis.srem(VOICE_INDEX, channelId);
    return state;
  }

  /** Channels this user is in, so a disconnect can clear all of them. */
  async voiceChannelsOf(userId: string): Promise<string[]> {
    const channels = await this.redis.smembers(VOICE_INDEX);
    const memberships = await Promise.all(
      channels.map(async (channelId) => ({
        channelId,
        member: await this.redis.sismember(VOICE_KEY(channelId), userId),
      })),
    );
    return memberships.filter((entry) => entry.member === 1).map((entry) => entry.channelId);
  }

  async voiceState(channelId: string): Promise<VoiceState> {
    return { channelId, userIds: await this.redis.smembers(VOICE_KEY(channelId)) };
  }

  async allVoiceStates(): Promise<VoiceState[]> {
    const channels = await this.redis.smembers(VOICE_INDEX);
    return Promise.all(channels.map((channelId) => this.voiceState(channelId)));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
