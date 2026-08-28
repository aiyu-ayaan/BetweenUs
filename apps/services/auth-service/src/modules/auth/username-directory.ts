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
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { envOr } from '@betweenus/config';
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

@Injectable()
export class UsernameDirectory implements OnModuleInit {
  private readonly filter = new BloomFilter(EXPECTED_ACCOUNTS, FALSE_POSITIVE_RATE);

  constructor(@Inject(AuthDatabase) private readonly db: AuthDb) {}

  /**
   * Loads every existing username into the filter at boot.
   *
   * ponytail: one filter per process, built once and never rebuilt. A username
   * registered against another instance is absent from this one's filter until
   * it restarts, which makes this instance say "available" for a name that is
   * not - and then the unique constraint refuses the registration with the
   * message it would have shown anyway. Share it through Redis if the answer
   * being momentarily optimistic ever matters more than it does today.
   */
  async onModuleInit(): Promise<void> {
    await this.warm();
  }

  async warm(): Promise<void> {
    const rows = await this.db.user.findMany({ select: { username: true } });
    for (const row of rows) this.filter.add(normalizeUsername(row.username));
    logger.info('Username filter warmed', { usernames: rows.length });
  }

  /** Called after a registration or a rename, so this process stops offering it. */
  remember(username: string): void {
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
