import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the notice strips sit, which is a layout rule the components cannot
 * state for themselves.
 *
 * Windows paints the minimise/maximise/close overlay into the top forty pixels
 * of the window no matter what the renderer draws there, and TopBar is the one
 * row that reserves a gap for it. A strip above TopBar therefore ran underneath
 * the close button - which sliced "Restart and install" down to "Res".
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, '..', 'App.tsx'), 'utf8');

const topBar = app.indexOf('<TopBar');
assert.ok(topBar > 0, 'App still renders TopBar');

for (const notice of ['<ConnectionNotice />', '<VersionNotice />', '<UpdateNotice />']) {
  const at = app.indexOf(notice);
  assert.ok(at > 0, `App still renders ${notice}`);
  assert.ok(
    at > topBar,
    `${notice} must sit below TopBar, or the window controls overlay lands on top of it`,
  );
}

console.log('UpdateNotice.check.ts ok');
