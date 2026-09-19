/** Run with `tsx electron/autostart.check.ts`. The Linux autostart entry. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyLinuxAutoStart,
  autostartDirectory,
  autostartFileName,
  desktopEntry,
  quoteExecArgument,
} from './autostart';

// The two flavours never share an entry, or switching the Dev channel on
// silently repoints the stable client's startup at a development build.
assert.equal(autostartFileName('stable'), 'betweenus.desktop');
assert.equal(autostartFileName('dev'), 'betweenus-dev.desktop');

// XDG_CONFIG_HOME when it is set and absolute; the spec says a relative one is
// invalid and is ignored, which is the same as unset.
assert.equal(autostartDirectory({}, '/home/a'), '/home/a/.config/autostart');
assert.equal(autostartDirectory({ XDG_CONFIG_HOME: '/cfg' }, '/home/a'), '/cfg/autostart');
assert.equal(autostartDirectory({ XDG_CONFIG_HOME: 'cfg' }, '/home/a'), '/home/a/.config/autostart');

// A plain path is left bare. The installer puts the AppImage somewhere like
// this, and it is the line the session manager actually runs.
assert.equal(
  quoteExecArgument('/home/a/.local/share/betweenus/BetweenUs.AppImage'),
  '/home/a/.local/share/betweenus/BetweenUs.AppImage',
);
// A space is quoted, or the session runs `/home/a/My` with an argument.
assert.equal(quoteExecArgument('/home/a/My Apps/BetweenUs.AppImage'), '"/home/a/My Apps/BetweenUs.AppImage"');
// `$` and `"` are escaped inside the quotes, and the backslash that escapes them
// is doubled by the string-value rule the spec applies first.
assert.equal(quoteExecArgument('/x/$HOME'), '"/x/\\\\$HOME"');
assert.equal(quoteExecArgument('/x/a"b'), '"/x/a\\\\"b"');
// `%` begins a field code, quoted or not.
assert.equal(quoteExecArgument('/x/100%'), '/x/100%%');

const entry = desktopEntry({
  name: 'BetweenUs',
  executable: '/opt/My Apps/BetweenUs.AppImage',
  icon: 'betweenus',
});
assert.match(entry, /^\[Desktop Entry\]\n/);
// `--hidden`, the same flag the Windows entry passes: a session start goes to
// the tray, not in front of whatever was opened first.
assert.match(entry, /^Exec="\/opt\/My Apps\/BetweenUs\.AppImage" --hidden$/m);
assert.match(entry, /^Icon=betweenus$/m);
assert.match(entry, /^Type=Application$/m);
assert.ok(!desktopEntry({ name: 'B', executable: '/b' }).includes('Icon='));

// The file itself: written when enabled, rewritten when the AppImage moved,
// removed when disabled, and a second disable is not an error.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'betweenus-autostart-'));
try {
  const file = path.join(directory, 'nested', 'autostart', 'betweenus.desktop');
  const nested = path.dirname(file);

  applyLinuxAutoStart(true, 'stable', { name: 'BetweenUs', executable: '/a/BetweenUs.AppImage' }, nested);
  assert.match(fs.readFileSync(file, 'utf8'), /^Exec=\/a\/BetweenUs\.AppImage --hidden$/m);

  applyLinuxAutoStart(true, 'stable', { name: 'BetweenUs', executable: '/b/BetweenUs.AppImage' }, nested);
  assert.match(fs.readFileSync(file, 'utf8'), /^Exec=\/b\/BetweenUs\.AppImage --hidden$/m);
  assert.ok(!fs.existsSync(`${file}.part`), 'no staging file is left behind');

  // The Dev channel writes its own file and leaves the stable one alone.
  applyLinuxAutoStart(true, 'dev', { name: 'BetweenUs Dev', executable: '/d' }, nested);
  assert.ok(fs.existsSync(path.join(nested, 'betweenus-dev.desktop')));
  applyLinuxAutoStart(false, 'dev', { name: 'BetweenUs Dev', executable: '/d' }, nested);
  assert.ok(fs.existsSync(file), 'disabling Dev leaves the stable entry');

  applyLinuxAutoStart(false, 'stable', { name: 'BetweenUs', executable: '/b' }, nested);
  assert.ok(!fs.existsSync(file));
  applyLinuxAutoStart(false, 'stable', { name: 'BetweenUs', executable: '/b' }, nested);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('autostart.check.ts ok');
