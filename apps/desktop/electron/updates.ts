/**
 * Desktop updates: what is out there, which build of it this install wants, and
 * getting it onto the disk.
 *
 * This is deliberately the same shape as the Android updater in
 * `apps/android/.../feature/update` rather than electron-updater: the release
 * workflow already publishes named assets to a GitHub Release, so a check is
 * one API call and a download is one more. electron-updater would want a
 * `latest.yml` published alongside them, a `publish` block in
 * `electron-builder.yml`, and it still could not update the portable build -
 * which is half of what ships.
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
 * Which Windows build this is.
 *
 * `installer` was put here by `BetweenUs-<version>-Setup.exe`; `portable` is a
 * single exe the user is running from wherever they dropped it; `unpacked` is a
 * development run, which has no release to update to and must never be offered
 * one.
 *
 * The portable build is the one that has to be got right: it must be offered
 * `-Portable.exe` and never `-Setup.exe`, or the update quietly turns a
 * portable copy into an installed one somewhere else on the disk.
 */
export type Flavor = 'installer' | 'portable' | 'unpacked';

/**
 * electron-builder's portable target unpacks itself to a temp directory and
 * points `PORTABLE_EXECUTABLE_FILE` at the exe the user actually double
 * clicked. That variable existing *is* the answer - there is nothing else that
 * distinguishes the two builds at runtime.
 */
export function flavorFrom(env: NodeJS.ProcessEnv, packaged: boolean): Flavor {
  if (!packaged) return 'unpacked';
  return env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer';
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
 * The asset this install can actually apply. A portable copy is only ever
 * offered `-Portable.exe`; an installed one only ever `-Setup.exe`. There is no
 * fallback between them on purpose: no update at all beats the wrong one.
 */
export function assetFor(release: Release, flavor: Flavor): ReleaseAsset | null {
  if (flavor === 'unpacked') return null;
  const suffix = flavor === 'portable' ? '-portable.exe' : '-setup.exe';
  return release.assets.find((asset) => asset.name.toLowerCase().endsWith(suffix)) ?? null;
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
  const asset = assetFor(release, flavor);
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
