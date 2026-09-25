/**
 * "Is this username taken?", answered without a query in the common case.
 *
 * The registration form asks once per keystroke. Almost every one of those is
 * a name nobody has, and a Bloom filter answers exactly that shape of question
 * for free: it has no false negatives, so a name it has never been given is a
 * name that has never been registered, and only the near-misses reach Postgres.
 *
 * The database's unique constraint is still the thing that decides. This is a
 * cache in front of it and is treated as one - see `available` below, which
 * never returns "taken" on the filter's word alone.
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { envOr } from '@betweenus/config';
import { EVENTS, EventBus } from '@betweenus/events';
import { createLogger, type LogLevel } from '@betweenus/logger';
import { BloomFilter } from './bloom';
import { AuthDatabase, type AuthDb } from './auth.db';

const logger = createLogger('auth-service', envOr('LOG_LEVEL', 'info') as LogLevel);

/**
 * What the filter is sized for. Not a cap: exceeding it costs a higher
 * false-positive rate, which costs a database lookup that would have happened
 * anyway, and nothing else.
 */
const EXPECTED_ACCOUNTS = Number(envOr('USERNAME_BLOOM_CAPACITY', '200000')) || 200_000;
const FALSE_POSITIVE_RATE = 0.001;

/** The rule the DTO enforces, repeated here so the answer matches the refusal. */
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,32}$/;

/**
 * Usernames are compared in lower case.
 *
 * They always were, one step downstream: signing in lowercases what was typed
 * before looking the account up. Doing it here as well is what makes that true
 * rather than nearly true - `Ayaan` and `ayaan` were two rows the unique index
 * was happy with and only one of which could ever log in by name.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * The two events that carry a username, and the only part of the bus this
 * needs - narrowed so a self-check can hand in a bus that is a map in memory.
 */
export type UsernameFeed = Pick<EventBus, 'subscribe'>;

@Injectable()
export class UsernameDirectory implements OnModuleInit {
  private readonly filter = new BloomFilter(EXPECTED_ACCOUNTS, FALSE_POSITIVE_RATE);

  constructor(
    @Inject(AuthDatabase) private readonly db: AuthDb,
    @Optional() @Inject(EventBus) private readonly feed?: UsernameFeed,
  ) {}

  /**
   * Listens for names registered anywhere, then loads every existing one.
   *
   * Each process still holds its own bit array, but no longer only its own
   * registrations: every registration and rename is already published on the
   * bus as `user.created` / `user.updated`, with the username in it, so every
   * instance adds the name the moment any instance writes it. That includes
   * this one hearing its own echo, which is harmless - setting a bit twice is
   * setting it once - and is also what covers the OAuth sign-up path, which
   * creates an account without going through `remember`.
   *
   * Subscribed before the warm-up query, so a name registered while the query
   * runs is in one or the other rather than neither. Not awaited: a bus that is
   * slow to connect must not hold the service's boot, and the only cost of the
   * gap is the one there always was - the unique constraint refuses a name this
   * filter briefly thought was free.
   */
  async onModuleInit(): Promise<void> {
    void this.listen().catch((error: unknown) => {
      logger.warn('Username filter is not following other instances', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await this.warm();
  }

  /** Follows registrations and renames made by every instance, this one included. */
  async listen(): Promise<void> {
    if (!this.feed) return;
    await this.feed.subscribe(EVENTS.USER_CREATED, (envelope) => {
      this.remember(envelope.payload.username);
    });
    await this.feed.subscribe(EVENTS.USER_UPDATED, (envelope) => {
      this.remember(envelope.payload.user.username);
    });
  }

  async warm(): Promise<void> {
    const rows = await this.db.user.findMany({ select: { username: true } });
    for (const row of rows) this.filter.add(normalizeUsername(row.username));
    logger.info('Username filter warmed', { usernames: rows.length });
  }

  /** Called after a registration or a rename, so this process stops offering it. */
  remember(username: string): void {
    if (typeof username !== 'string' || username.length === 0) return;
    this.filter.add(normalizeUsername(username));
  }

  /**
   * Whether the name can be registered.
   *
   * The filter can only ever save a lookup, never cause a wrong "taken": a
   * `false` from it is certain, and a `true` is checked against the table
   * before anybody is told the name is gone.
   */
  async available(username: string): Promise<{ available: boolean; reason?: 'taken' | 'invalid' }> {
    const normalized = normalizeUsername(username);
    if (!USERNAME_PATTERN.test(normalized)) return { available: false, reason: 'invalid' };

    if (!this.filter.mightHave(normalized)) return { available: true };

    const taken = await this.db.user.findUnique({
      where: { username: normalized },
      select: { id: true },
    });
    return taken ? { available: false, reason: 'taken' } : { available: true };
  }
}
