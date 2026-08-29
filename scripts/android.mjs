/**
 * `pnpm android <task...>` - the Gradle build, from the repo root.
 *
 * The Android client is the one part of this workspace pnpm does not own: it
 * has no `package.json`, so `apps/android` is not a workspace package and
 * `--filter` cannot reach it. Everything else in the repo is one `pnpm` word
 * away and this was "open Android Studio", which is a lot of application to
 * start in order to type `assembleDebug`.
 *
 * The whole job is picking `gradlew.bat` over `gradlew` on Windows and running
 * it in the right directory, which is too little to be worth a dependency and
 * just enough to be wrong in a `package.json` one-liner - `./gradlew` is not
 * found by `cmd.exe` and `gradlew.bat` does not exist anywhere else.
 *
 * Tasks are passed straight through, so anything CI runs (see `ci.yml`) can be
 * run here by name. `run` is the one word that is not a Gradle task: it is
 * `installDebug` followed by actually starting the app, because installing
 * something and then reaching for the phone to tap it is not "running" it.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(repoRoot, 'apps', 'android');

/** Debug and release share it: `app/build.gradle.kts` sets no `applicationIdSuffix`. */
const APPLICATION_ID = 'com.aatech.betweenus';
const LAUNCH_ACTIVITY = `${APPLICATION_ID}/.MainActivity`;

const isWindows = process.platform === 'win32';

/**
 * The wrapper, by absolute path.
 *
 * Not `gradlew.bat` relative to `cwd`, which is the obvious thing and does not
 * work: `cmd.exe` will not resolve a bare name out of the working directory
 * when `NoDefaultCurrentDirectoryInExePath` is set, and reports it as "not
 * recognized as an internal or external command" - which reads exactly like a
 * missing Gradle rather than a lookup rule.
 */
const wrapper = path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew');

/**
 * Runs the wrapper and resolves its exit code.
 *
 * `stdio: 'inherit'` on purpose: Gradle's progress bar, its warnings and the
 * compiler errors that are the entire point of running it are worth nothing
 * captured and reprinted at the end.
 */
function gradle(args) {
  return new Promise((resolve) => {
    // A `.bat` cannot be spawned without a shell on Windows - Node refuses since
    // the argument-injection fix - so the path is quoted, because this
    // repository lives somewhere with a space in its name and so will somebody
    // else's.
    const child = spawn(isWindows ? `"${wrapper}"` : wrapper, args, {
      cwd: androidDir,
      stdio: 'inherit',
      shell: isWindows,
    });
    child.on('error', (error) => {
      console.error(`\nCould not start ${wrapper}: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * Starts the app on whichever device just had it installed.
 *
 * By activity rather than by `monkey`, so a failure to start is reported as
 * one. Not fatal on its own: the install is the part that took the minutes,
 * and a phone that is locked or that asked about the install is a normal thing
 * to have to touch once.
 */
function launch() {
  const result = spawnSync('adb', ['shell', 'am', 'start', '-n', LAUNCH_ACTIVITY], {
    stdio: 'inherit',
    shell: isWindows,
  });

  if (result.error) {
    console.error(`\nInstalled, but could not start it: ${result.error.message}`);
    console.error('`adb` is not on PATH - add the SDK\'s platform-tools to it.');
    return;
  }
  if (result.status !== 0) console.error('\nInstalled, but the app did not start.');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: pnpm android <gradle task...>   (or: run, build, test)');
  process.exit(2);
}

// `run` is install-then-start; everything else is Gradle's own vocabulary.
const isRun = args[0] === 'run';
const code = await gradle(isRun ? ['installDebug', ...args.slice(1)] : args);

if (code !== 0) process.exit(code);
if (isRun) launch();
