/**
 * The push device registry, in both stores.
 *
 * **Postgres is what the fan-out reads.** It is one query joined against the
 * accounts and preferences already there, it is transactional, and it goes when
 * the account does - `device_tokens` cascades off `users`, so deleting somebody
 * cannot leave their phone being pushed to.
 *
 * **Firestore holds the same rows** - `deviceTokens/{uid}_{deviceId}`, carrying
 * the uid and the token - beside the Firebase project that minted them. That is
 * what makes the registry legible from the Firebase console, and what a Cloud
 * Function or a second sender would read if either ever exists.
 *
 * Postgres is the authority. Every Firestore write is best effort and is logged
 * rather than thrown: a registry mirror that cannot be written is a mirror that
 * is behind, and refusing to register a phone over it would be trading the
 * working store for the copy. They are reconciled by the next registration,
 * which the client makes on every sign-in and every rotation.
 *
 * One row per (account, installation), keyed on the installation and not on the
 * token: a token rotates, and a registry keyed on it grows a row per rotation
 * and then pushes at every dead one.
 *
 * A token is never logged - section 23 of CLAUDE.md - which includes the errors.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@betweenus/database';
import { Logger } from '@betweenus/logger';
import type { RegisterDeviceRequest, RegisteredDevice } from '@betweenus/shared-types';
import { DEVICE_COLLECTION, MAX_IN_CLAUSE, deviceDocumentId, firestore } from '../../push/firestore';

@Injectable()
export class DevicesService {
  constructor(private readonly logger: Logger) {}

  /**
   * Register, or refresh after a rotation. The same call for both: the client
   * cannot tell the difference either, and does not have to.
   */
  async register(userId: string, dto: RegisterDeviceRequest): Promise<RegisteredDevice> {
    const row = await prisma.$transaction(async (tx) => {
      // This token belonged to another row - another account on this phone, or
      // this account's own previous installation. It can only be in one place.
      const displaced = await tx.deviceToken.findMany({
        where: { token: dto.token, NOT: { userId, deviceId: dto.deviceId } },
        select: { userId: true, deviceId: true },
      });
      if (displaced.length > 0) {
        await tx.deviceToken.deleteMany({
          where: { token: dto.token, NOT: { userId, deviceId: dto.deviceId } },
        });
      }

      const fields = {
        token: dto.token,
        platform: dto.platform,
        label: dto.label ?? null,
        appVersion: dto.appVersion ?? null,
        lastSeenAt: new Date(),
      };

      const saved = await tx.deviceToken.upsert({
        where: { userId_deviceId: { userId, deviceId: dto.deviceId } },
        create: { userId, deviceId: dto.deviceId, ...fields },
        update: fields,
      });
      return { saved, displaced };
    });

    // The mirror, after the store that matters has committed.
    await this.mirrorDelete(row.displaced);
    await this.mirrorWrite(userId, dto);

    return {
      deviceId: row.saved.deviceId,
      platform: row.saved.platform as RegisteredDevice['platform'],
      label: row.saved.label,
      lastSeenAt: row.saved.lastSeenAt.toISOString(),
    };
  }

  /**
   * Sign-out, an account switch, or a server switch. Scoped to the caller, so
   * one account cannot unregister another's phone by guessing a device id.
   */
  async unregister(userId: string, deviceId: string): Promise<void> {
    await prisma.deviceToken.deleteMany({ where: { userId, deviceId } });
    await this.mirrorDelete([{ userId, deviceId }]);
  }

  /** What this account can be reached on. Used by the fan-out, and nothing else. */
  async tokensFor(userIds: string[]): Promise<Map<string, string[]>> {
    if (userIds.length === 0) return new Map();
    const rows = await prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, token: true },
    });
    const byUser = new Map<string, string[]>();
    for (const row of rows) {
      const tokens = byUser.get(row.userId);
      if (tokens) tokens.push(row.token);
      else byUser.set(row.userId, [row.token]);
    }
    return byUser;
  }

  /**
   * Tokens the transport has told us are dead - an uninstall, a clear-data, a
   * token that expired. Kept, they are a push attempt per message forever.
   */
  async forget(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    const doomed = await prisma.deviceToken.findMany({
      where: { token: { in: tokens } },
      select: { userId: true, deviceId: true },
    });
    const { count } = await prisma.deviceToken.deleteMany({ where: { token: { in: tokens } } });
    await this.mirrorDelete(doomed);
    return count;
  }

  // --- the Firestore mirror ---

  private async mirrorWrite(userId: string, dto: RegisterDeviceRequest): Promise<void> {
    const store = firestore();
    if (!store) return;
    const now = new Date();
    try {
      await store
        .collection(DEVICE_COLLECTION)
        .doc(deviceDocumentId(userId, dto.deviceId))
        .set(
          {
            uid: userId,
            deviceId: dto.deviceId,
            token: dto.token,
            platform: dto.platform,
            label: dto.label ?? null,
            appVersion: dto.appVersion ?? null,
            updatedAt: now,
          },
          // Merge, so a field some later version adds is not wiped by an
          // older one re-registering. No `createdAt`: Postgres has it, and
          // writing it here on every rotation would only make it a lie.
          { merge: true },
        );
    } catch (error: unknown) {
      // Never the token, and never fatal: Postgres already holds the row.
      this.logger.warn('Firestore device mirror write failed', { reason: String(error) });
    }
  }

  private async mirrorDelete(rows: { userId: string; deviceId: string }[]): Promise<void> {
    const store = firestore();
    if (!store || rows.length === 0) return;
    try {
      const batch = store.batch();
      for (const row of rows) {
        batch.delete(store.collection(DEVICE_COLLECTION).doc(deviceDocumentId(row.userId, row.deviceId)));
      }
      await batch.commit();
    } catch (error: unknown) {
      this.logger.warn('Firestore device mirror delete failed', { reason: String(error) });
    }
  }

  /**
   * The mirror, read back.
   *
   * Nothing in the send path uses this - Postgres answers that. It exists so
   * the mirror can be checked without opening the console, and so a future
   * sender that only has Firebase has somewhere to look. Chunked because
   * Firestore's `in` takes thirty values at a time.
   */
  async mirroredTokensFor(userIds: string[]): Promise<Map<string, string[]>> {
    const store = firestore();
    const byUser = new Map<string, string[]>();
    if (!store || userIds.length === 0) return byUser;

    for (let index = 0; index < userIds.length; index += MAX_IN_CLAUSE) {
      const chunk = userIds.slice(index, index + MAX_IN_CLAUSE);
      const snapshot = await store
        .collection(DEVICE_COLLECTION)
        .where('uid', 'in', chunk)
        .get();
      snapshot.forEach((document) => {
        const data = document.data() as { uid?: string; token?: string };
        if (!data.uid || !data.token) return;
        const tokens = byUser.get(data.uid);
        if (tokens) tokens.push(data.token);
        else byUser.set(data.uid, [data.token]);
      });
    }
    return byUser;
  }
}
