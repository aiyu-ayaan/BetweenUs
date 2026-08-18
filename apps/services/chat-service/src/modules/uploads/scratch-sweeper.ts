/**
 * Clears out multipart uploads nobody finished.
 *
 * A client that starts a large upload and then closes, crashes or loses its
 * connection leaves its parts behind. `LocalStorageDriver.sweepStaleMultipart`
 * has always been able to remove them and nothing has ever called it, so a
 * deployment's scratch directory only grew - by the size of every abandoned
 * upload, which is by definition the large ones.
 *
 * S3 is deliberately not swept from here. A bucket has a lifecycle rule for
 * exactly this (`AbortIncompleteMultipartUpload`), it is one line of bucket
 * configuration, and walking a bucket from the application to do the same thing
 * would be slower, more expensive and a worse answer. `DEPLOYMENT.md` is where
 * that belongs; this covers the driver that has nobody else to do it.
 *
 * ponytail: a timer in the process. Two replicas will both sweep and race each
 * other into the same directories, which `sweepStaleMultipart` already treats
 * as normal - a part that has gone is a part that does not need removing.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { envNumber } from '@betweenus/config';
import { Logger } from '@betweenus/logger';
import { LocalStorageDriver, getStorage } from '@betweenus/storage';

const HOUR_MS = 60 * 60 * 1000;

/** How often to look. An abandoned upload is not urgent. */
const INTERVAL_MS = 6 * HOUR_MS;

/** Not at boot: a service starting is the worst moment to add disk work. */
const FIRST_RUN_DELAY_MS = 5 * 60_000;

/**
 * How long a scratch directory may sit untouched before it is fair game.
 *
 * Generously longer than any real upload: the client uploads parts one after
 * another, so an upload still in progress is touched every few seconds, and the
 * only thing this can catch is one that stopped. Twelve hours means a laptop
 * that was suspended mid-upload still finds its parts when it wakes.
 */
function maxAgeMs(): number {
  return envNumber('UPLOAD_SCRATCH_MAX_AGE_HOURS', 12) * HOUR_MS;
}

@Injectable()
export class ScratchSweeper implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    if (!(getStorage() instanceof LocalStorageDriver)) return;

    this.first = setTimeout(() => {
      void this.run();
      this.timer = setInterval(() => void this.run(), INTERVAL_MS);
      this.timer.unref?.();
    }, FIRST_RUN_DELAY_MS);
    this.first.unref?.();
  }

  private async run(): Promise<void> {
    const storage = getStorage();
    if (!(storage instanceof LocalStorageDriver)) return;

    try {
      const removed = await storage.sweepStaleMultipart(maxAgeMs());
      if (removed > 0) this.logger.info('Swept abandoned uploads', { removed });
    } catch (error) {
      this.logger.warn('Could not sweep abandoned uploads', { reason: String(error) });
    }
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
