/**
 * "Open BetweenUs when the system starts" on Linux.
 *
 * `app.setLoginItemSettings` is the whole answer on Windows and does nothing at
 * all on Linux - Electron documents it for macOS and Windows only, and on Linux
 * it returns without error and without effect, so the switch in settings looked
 * like it worked and never did.
 *
 * Linux has one mechanism every desktop honours: a `.desktop` file in the XDG
 * autostart directory (`$XDG_CONFIG_HOME/autostart`, `~/.config/autostart`
 * unset). GNOME, KDE, Cinnamon, XFCE and MATE all start what is in it when the
 * session begins, which is the same "at sign-in, as this user" the Windows
 * registry entry means. Enabled writes the file, disabled removes it.
 *
 * The file is named per flavour, for the same reason the Windows entry is: the
 * Dev channel switching itself on must not overwrite the stable client's entry.
 *
 * Nothing here imports Electron, so it runs under `tsx` in `autostart.check.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppFlavor } from './flavor';

/** The autostart entry's file name. One per flavour, so the two never collide. */
export function autostartFileName(flavor: AppFlavor): string {
  return flavor === 'dev' ? 'betweenus-dev.desktop' : 'betweenus.desktop';
}

/** Where the session manager looks, per the XDG Base Directory spec. */
export function autostartDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : path.join(home, '.config');
  return path.join(configHome, 'autostart');
}

/**
 * One argument of an `Exec` line, quoted the way the Desktop Entry spec asks.
 *
 * The spec's rules are two layers, and both matter for a path somebody chose:
 * an argument holding a space or a reserved character is double-quoted with `"`,
 * `` ` ``, `$` and `\` backslash-escaped inside the quotes - and then the whole
 * value is a string, whose own escape rule doubles every backslash again. `%`
 * starts a field code, so a literal one is `%%` whether quoted or not.
 */
export function quoteExecArgument(argument: string): string {
  const escapedPercent = argument.replace(/%/g, '%%');
  if (!/[\s"'\\><~|&;$*?#()`]/.test(escapedPercent)) return escapedPercent;
  const quoted = escapedPercent.replace(/(["`$\\])/g, '\\$1');
  return `"${quoted.replace(/\\/g, '\\\\')}"`;
}

export interface AutostartEntry {
  /** What the session's startup list shows, e.g. "BetweenUs". */
  name: string;
  /** The file the session manager runs: the AppImage, not the binary inside it. */
  executable: string;
  /** An icon theme name or an absolute path. */
  icon?: string;
}

/**
 * The file's contents. `--hidden` is the same flag the Windows entry passes, so
 * a session start goes to the tray rather than putting a window in front of
 * whatever the user opened first.
 */
export function desktopEntry(entry: AutostartEntry): string {
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${entry.name}`,
    'Comment=Chat, voice, screen share and remote desktop',
    `Exec=${quoteExecArgument(entry.executable)} --hidden`,
    ...(entry.icon ? [`Icon=${entry.icon}`] : []),
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Writes or removes the entry. Written on every launch while it is enabled
 * rather than once, because the AppImage is a file somebody can move: the entry
 * points at wherever this copy is now, and a stale one would start nothing.
 */
export function applyLinuxAutoStart(
  enabled: boolean,
  flavor: AppFlavor,
  entry: AutostartEntry,
  directory: string = autostartDirectory(),
): void {
  const file = path.join(directory, autostartFileName(flavor));
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return;
  }
  const contents = desktopEntry(entry);
  // An unchanged file is left alone, so a launch does not touch the disk (or
  // wake a file watcher in the session manager) for nothing.
  try {
    if (fs.readFileSync(file, 'utf8') === contents) return;
  } catch {
    // Not there yet, which is what the write below is for.
  }
  fs.mkdirSync(directory, { recursive: true });
  const partial = `${file}.part`;
  fs.writeFileSync(partial, contents, { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(partial, file);
}
