import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ATTEMPTS, swapArguments, swapScript } from './portable-swap';

// --- The script text --------------------------------------------------------

const script = swapScript();

assert.match(script, /Wait-Process -Id \$AppProcessId/, 'the swap waits for the app to be gone');
assert.match(script, /for \(\$attempt = 0; \$attempt -lt \d+/, 'and retries while the handle clears');
assert.ok(
  script.indexOf('Wait-Process') < script.indexOf('Move-Item'),
  'waiting has to come before the rename, or this is the in-process bug again',
);
assert.match(script, /Copy-Item -LiteralPath \$Incoming/, 'copied, because volumes differ');
assert.ok(!/\$Current\s*=/.test(script), 'paths arrive as parameters, never pasted into the script');
assert.match(script, /Start-Process -FilePath \$launch/, 'and the new build is started');
assert.ok(ATTEMPTS >= 10, 'one failed attempt is not "cannot be done"');

const args = swapArguments('C:\swap.ps1', {
  current: 'C:\My Apps\BetweenUs-Portable.exe',
  incoming: 'C:\Temp\new.exe',
  processId: 1234,
});
assert.ok(args.includes('-ExecutionPolicy') && args.includes('Bypass'), 'policy must not block it');
assert.equal(args[args.indexOf('-Current') + 1], 'C:\My Apps\BetweenUs-Portable.exe');
assert.equal(args[args.indexOf('-AppProcessId') + 1], '1234');
assert.ok(!args.includes('-NoLaunch'), 'the test hook is off unless it is asked for');
assert.ok(swapArguments('C:\swap.ps1', {
  current: 'a',
  incoming: 'b',
  processId: 1,
  noLaunch: true,
}).includes('-NoLaunch'));

// --- The real thing, against a real lock ------------------------------------
//
// Everything above is text. This runs the script on Windows with a file that is
// genuinely held open with no sharing, by a process that is genuinely still
// alive - which is what EBUSY was - and asserts the swap still lands.

if (process.platform !== 'win32') {
  console.log('portable-swap.check.ts ok (script text only; the swap is Windows-only)');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'betweenus-swap-'));
  // Spaces in the path, because that is where people keep a portable build.
  const folder = path.join(root, 'My Portable Apps');
  fs.mkdirSync(folder);
  const current = path.join(folder, 'BetweenUs-0.0.1-alpha.11-Portable.exe');
  const incoming = path.join(root, 'BetweenUs-0.0.1-alpha.13-Portable.exe');
  fs.writeFileSync(current, 'old build');
  fs.writeFileSync(incoming, 'new build');

  const scriptPath = path.join(root, 'swap.ps1');
  fs.writeFileSync(scriptPath, script, 'utf8');

  // The lock: an exclusive handle on the exe, released after three seconds by a
  // process that lives that long. Held with FileShare None, so a rename fails
  // exactly the way the portable launcher made it fail.
  const holder = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$f = [System.IO.File]::Open('${current.replace(/'/g, "''")}', 'Open', 'ReadWrite', 'None'); Start-Sleep -Seconds 3; $f.Close()`,
    ],
    { stdio: 'ignore' },
  );

  // Proof the lock is real: while it is held, the old in-process swap fails.
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.throws(
    () => fs.renameSync(current, `${current}.old`),
    /EBUSY|EPERM|EACCES/,
    'the held handle has to reproduce the bug, or this test proves nothing',
  );

  const started = Date.now();
  const run = spawnSync(
    'powershell.exe',
    swapArguments(scriptPath, { current, incoming, processId: holder.pid ?? 0, noLaunch: true }),
    { encoding: 'utf8', timeout: 90_000 },
  );

  assert.equal(run.status, 0, `the swap script failed: ${run.stderr}`);
  assert.equal(fs.readFileSync(current, 'utf8'), 'new build', 'the kept exe is now the new build');
  assert.equal(fs.existsSync(incoming), false, 'and the download is not left behind');
  assert.equal(fs.existsSync(`${current}.old`), false, 'nor the retired copy');
  assert.ok(
    Date.now() - started >= 1500,
    'it waited for the holder rather than racing it',
  );

  fs.rmSync(root, { recursive: true, force: true });
  console.log('portable-swap.check.ts ok (swapped a genuinely locked exe)');
}
