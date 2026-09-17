/**
 * Which BetweenUs this process is: the one people install, or the Dev channel.
 *
 * The problem this solves is mundane and constant: an installed BetweenUs sits
 * in the tray all day, and `pnpm dev` used to be the *same application* as far
 * as the operating system was concerned - the same name, so the same `userData`
 * directory, so the same single-instance lock, which the installed copy already
 * held. The development window did not open. Developing meant quitting the copy
 * that carries the actual conversations first.
 *
 * A flavour is one decision - a name - and everything else follows from it,
 * because every identity Electron and Windows key off is derived from the name:
 *
 * - `userData` is `<appData>/<name>`, so the Dev channel keeps its own
 *   settings, secrets, downloads and E2EE device key. Two devices of one
 *   account is a case the protocol already handles; two processes sharing one
 *   key store is not.
 * - The single-instance lock is per `userData`, so both run at once, which is
 *   the whole point.
 * - The AppUserModelID is per flavour, so a Dev toast opens the Dev window and
 *   Windows keeps the two apart in the taskbar and notification centre.
 * - The startup registry entry is per name, so enabling "start with the system"
 *   in one does not silently point at the other.
 *
 * Two ways in, and only two, so the answer is the same everywhere:
 *
 * - **Unpackaged** - `pnpm dev`, `pnpm dev:duo`, anything run from source - is
 *   the Dev channel by definition. There is nothing to set and nothing to
 *   forget.
 * - **Packaged** - the flavour is baked into the name by the build
 *   (`electron-builder.dev.yml`), so an installed Dev channel build is a
 *   separate application with its own shortcut and its own uninstall entry,
 *   installed beside the stable one rather than over it.
 *
 * Note that this is *not* `Channel` in `updates.ts` (which release stream an
 * install takes: stable, beta, alpha) nor `Flavor` there (what shape the
 * install is: an installer or an unpacked tree). Those describe a stable build;
 * this says whether it is a stable build at all.
 */

/** Which application this is. Only the stable one is ever released. */
export type AppFlavor = 'stable' | 'dev';

/**
 * The Dev channel's name, and the whole mechanism.
 *
 * It is what makes the `userData` path, the tray tooltip, the shortcut and the
 * uninstall entry say Dev, and it is the only thing a packaged build is
 * recognised by. Change it here and in `electron-builder.dev.yml` - in its
 * `extraMetadata` block, which is the copy the *runtime* reads - together, or a
 * Dev install quietly starts living in the stable client's directory.
 *
 * The stable application has no such constant, and deliberately so: its name is
 * whatever `apps/desktop/package.json` says - `@betweenus/desktop`, which is
 * where every installed client's settings, secrets and device key already live.
 * Renaming it would orphan all of them. The Dev channel is the only flavour
 * that renames anything.
 */
export const DEV_PRODUCT_NAME = 'BetweenUs Dev';

/**
 * The flavour of this process.
 *
 * Unpackaged is always Dev - running from source is developing, whatever the
 * name says - and a packaged build is whatever name it was built with.
 */
export function flavorOf(packaged: boolean, name: string): AppFlavor {
  if (!packaged) return 'dev';
  return name === DEV_PRODUCT_NAME ? 'dev' : 'stable';
}

/**
 * The Windows application identity, which decides which window a notification
 * belongs to and which taskbar button it groups under.
 *
 * `pnpm dev:duo` narrows it further, because its two windows are two accounts
 * on one machine and a toast for Alice must not raise Bob's window.
 */
export function appUserModelIdFor(flavor: AppFlavor, profile?: string): string {
  const base = flavor === 'dev' ? 'com.betweenus.desktop.dev' : 'com.betweenus.desktop';
  return profile ? `${base}.${profile}` : base;
}
