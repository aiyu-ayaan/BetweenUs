/**
 * Desktop updates: what is out there, which build of it this install wants, and
 * getting it onto the disk.
 *
 * This is deliberately the same shape as the Android updater in
 * `apps/android/.../feature/update` rather than electron-updater: the release
 * workflow already publishes named assets to a GitHub Release, so a check is
 * one API call and a download is one more. electron-updater would want a
 * `latest.yml` published alongside them, a `publish` block in
 * `electron-builder.yml`, and a second release path to keep working.
 *
 * Nothing here imports Electron, so it runs under `tsx` in `updates.check.ts`.
 * Applying the download is the one part that needs the app, and that lives in
 * `main.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Where the builds come from. A constant rather than a setting, same reasoning
 * as Android: this is the project that signs the releases.
 */
export const REPOSITORY = 'aiyu-ayaan/BetweenUs';

export const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;

// --- Versions ---------------------------------------------------------------

export const ALPHA = 0;
export const BETA = 1;
export const STABLE = 2;

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** ALPHA | BETA | STABLE - a finished release sorts above its pre-releases. */
  stage: number;
  stageNumber: number;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/i;

/**
 * Only the shapes `scripts/release-version.mjs` can produce are understood.
 * Anything else is null and is skipped rather than guessed at, because a guess
 * here downloads the wrong build.
 */
export function parseVersion(text: string | null | undefined): Version | null {
  const match = VERSION_PATTERN.exec((text ?? '').trim());
  if (!match) return null;
  const [, major, minor, patch, label, number] = match;
  const stage = label?.toLowerCase() === 'alpha' ? ALPHA : label?.toLowerCase() === 'beta' ? BETA : STABLE;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    stage,
    // A stable release has no pre-release number and must still beat `-beta.9`
    // of the same version.
    stageNumber: number === undefined ? Number.MAX_SAFE_INTEGER : Number(number),
  };
}

export function compareVersions(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    a.stage - b.stage ||
    a.stageNumber - b.stageNumber
  );
}

// --- Channels ---------------------------------------------------------------

export type Channel = 'stable' | 'beta' | 'alpha';

const CHANNEL_STAGE: Record<Channel, number> = { stable: STABLE, beta: BETA, alpha: ALPHA };

export const CHANNELS: Channel[] = ['stable', 'beta', 'alpha'];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as string[]).includes(value);
}

/**
 * A channel takes its own builds and everything steadier. Somebody on beta who
 * was offered nothing but betas would never be offered the stable release that
 * supersedes the one they are running.
 */
export function accepts(channel: Channel, version: Version): boolean {
  return version.stage >= CHANNEL_STAGE[channel];
}

/**
 * The channel a build belongs to, used as the default: somebody who installed
 * an alpha wants alphas, and defaulting them to stable would strand them until
 * the version they are running is released.
 */
export function channelOf(version: string | null | undefined): Channel {
  const parsed = parseVersion(version);
  if (parsed?.stage === ALPHA) return 'alpha';
  if (parsed?.stage === BETA) return 'beta';
  return 'stable';
}

// --- Flavours ---------------------------------------------------------------

/**
 * Which build this is, and therefore whether it can replace itself.
 *
 * `installer` was put here by a release artifact - the setup exe on Windows,
 * the AppImage on Linux - and updates itself with the next one; `unpacked` has
 * no release to update to and must never be offered one.
 *
 * There was a third, `portable`, for the single exe that shipped beside the
 * Windows installer. Windows ships one build now, so a copy of that portable
 * exe is treated as an install and is offered the setup exe - which is the only
 * update it can be given, and installs properly over it.
 */
export type Flavor = 'installer' | 'unpacked';

/**
 * Packaged is the whole answer on Windows and is not sufficient on Linux.
 *
 * An AppImage is a single file, and `APPIMAGE` is the runtime telling the app
 * where that file is - which is exactly the path an update writes over. Without
 * it this is a `linux-unpacked` tree or a directory somebody extracted: both are
 * `app.isPackaged === true`, and neither has one file to replace. Offering those
 * an update downloads ninety megabytes that can never be applied, so they report
 * `unpacked`, which is the flavour that is never offered anything.
 *
 * The platform and the variable are parameters rather than read inline so the
 * self-check can put this on a machine it is not running on.
 */
export function flavorFrom(
  packaged: boolean,
  platform: string = process.platform,
  appImage: string | undefined = process.env.APPIMAGE,
): Flavor {
  if (!packaged) return 'unpacked';
  if (platform === 'linux') return appImage ? 'installer' : 'unpacked';
  return 'installer';
}

// --- Releases ---------------------------------------------------------------

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface Release {
  version: Version;
  tag: string;
  name: string;
  notes: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

/** The GitHub JSON this understands, trimmed to what it reads. */
interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
}

export function parseReleases(payload: unknown): Release[] {
  if (!Array.isArray(payload)) return [];
  const releases: Release[] = [];
  for (const entry of payload as GithubRelease[]) {
    if (entry?.draft) continue;
    const version = parseVersion(entry?.tag_name);
    if (!version) continue;
    releases.push({
      version,
      tag: entry.tag_name ?? '',
      name: entry.name?.trim() || (entry.tag_name ?? ''),
      notes: entry.body ?? '',
      publishedAt: entry.published_at ?? '',
      assets: (entry.assets ?? [])
        .filter((asset) => asset?.name && asset?.browser_download_url)
        .map((asset) => ({
          name: asset.name as string,
          url: asset.browser_download_url as string,
          size: asset.size ?? 0,
        })),
    });
  }
  return releases;
}

/**
 * The newest release on `channel` that is newer than what is installed.
 *
 * "Newer" is by version, never by publish date: a stable release cut after an
 * alpha is still not an upgrade for somebody running that alpha.
 */
export function pickRelease(
  releases: Release[],
  installed: Version | null,
  channel: Channel,
): Release | null {
  let best: Release | null = null;
  for (const release of releases) {
    if (!accepts(channel, release.version)) continue;
    if (installed && compareVersions(release.version, installed) <= 0) continue;
    if (!best || compareVersions(release.version, best.version) > 0) best = release;
  }
  return best;
}

/**
 * The one asset each platform can apply, and the name it is read back out of
 * the updates directory with.
 *
 * Both halves of one naming contract in one place, because they have to agree:
 * the release workflow attaches the name, `assetFor` finds it in a release, and
 * `versionOfFile` reads the version back off a downloaded file - which is what
 * makes the updates directory the record of what is waiting, with nothing
 * written down beside it.
 *
 * macOS is deliberately absent rather than guessed at. `electron-builder.yml`
 * declares a `.dmg` target, but no Mac build has ever been released and an
 * unsigned, un-notarised one is refused by Gatekeeper - so a Mac reports
 * `unpacked` and is offered nothing at all, which is the honest answer until
 * there is a notarised build to offer.
 */
const ASSETS: Record<string, { suffix: string; name: RegExp }> = {
  win32: { suffix: '-setup.exe', name: /^BetweenUs-(.+)-Setup\.exe$/i },
  linux: { suffix: '.appimage', name: /^BetweenUs-(.+)\.AppImage$/i },
};

/**
 * The asset this install can actually apply, and nothing else. A release that
 * built the other platforms only offers nothing rather than handing Linux a
 * setup exe.
 */
export function assetFor(
  release: Release,
  flavor: Flavor,
  platform: string = process.platform,
): ReleaseAsset | null {
  if (flavor === 'unpacked') return null;
  const spec = ASSETS[platform];
  if (!spec) return null;
  return release.assets.find((asset) => asset.name.toLowerCase().endsWith(spec.suffix)) ?? null;
}

/**
 * The version in a downloaded file's name, or null if it is not one this
 * platform could run. See main.ts, which sweeps the directory with it - a file
 * left behind by a different platform's build reads as null and is deleted.
 */
export function versionOfFile(name: string, platform: string = process.platform): string | null {
  const label = ASSETS[platform]?.name.exec(name)?.[1];
  return label && parseVersion(label) ? label : null;
}

// --- The network side -------------------------------------------------------

export interface UpdateOffer {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  asset: ReleaseAsset;
}

/**
 * What this install should be offered, or null for "nothing to do".
 *
 * Unauthenticated, so it is subject to GitHub's sixty-requests-an-hour-per-
 * address limit. That is ample for a check on launch and a button in settings,
 * and it is why a failure here is reported rather than retried.
 */
export async function findUpdate(
  installedVersion: string,
  channel: Channel,
  flavor: Flavor,
  fetchImpl: typeof fetch = fetch,
  platform: string = process.platform,
): Promise<UpdateOffer | null> {
  if (flavor === 'unpacked') return null;
  const response = await fetchImpl(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = pickRelease(
    parseReleases(await response.json()),
    parseVersion(installedVersion),
    channel,
  );
  if (!release) return null;
  const asset = assetFor(release, flavor, platform);
  if (!asset) return null;
  return {
    version: release.tag.replace(/^v/, ''),
    name: release.name,
    notes: release.notes,
    publishedAt: release.publishedAt,
    asset,
  };
}

/**
 * Streams the asset into `directory` and answers with where it landed.
 *
 * Streamed rather than buffered because these are ninety-megabyte executables
 * and this process is also the one drawing the window. `onProgress` gets a
 * fraction, or -1 for as long as the total length is unknown.
 */
export async function downloadAsset(
  asset: ReleaseAsset,
  directory: string,
  onProgress: (fraction: number) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const target = path.join(directory, asset.name);
  const response = await fetchImpl(asset.url, { headers: { Accept: 'application/octet-stream' } });
  if (!response.ok || !response.body) throw new Error(`Download answered ${response.status}`);

  // Content-Length is the redirected object's, which is the honest one; the
  // release metadata's size is the fallback for a server that omits it.
  const total = Number(response.headers.get('content-length')) || asset.size;
  const partial = `${target}.part`;
  const sink = fs.createWriteStream(partial);
  let received = 0;

  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength;
      if (!sink.write(chunk)) await new Promise<void>((resolve) => sink.once('drain', () => resolve()));
      onProgress(total > 0 ? Math.min(1, received / total) : -1);
    }
    await new Promise<void>((resolve, reject) => {
      sink.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    sink.destroy();
    fs.rmSync(partial, { force: true });
    throw error;
  }

  // A half-written file must never be runnable, so it only gets its real name
  // once every byte is on the disk.
  fs.rmSync(target, { force: true });
  fs.renameSync(partial, target);
  return target;
}
