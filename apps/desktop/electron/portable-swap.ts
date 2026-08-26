/**
 * Replacing a portable BetweenUs with the build it just downloaded.
 *
 * The old way did the swap in-process: rename the running exe out of the way,
 * copy the new one into its place, start it, quit. Windows will rename a
 * running image, so that reads as if it should work - and it does not. The
 * portable launcher keeps its own handle on the exe for as long as the app it
 * unpacked is alive, and a rename through that handle comes back
 *
 *     EBUSY: resource busy or locked, rename '...-Portable.exe' -> '...old'
 *
 * which is the error people saw in the update strip, with the download left in
 * a folder for them to run by hand.
 *
 * Nothing in-process can fix that, because the process holding the file is the
 * one asking. So the swap is handed to a small PowerShell script that outlives
 * the app: it waits for this process to exit, retries while the handle is
 * released, does the replacement and starts the new build.
 *
 * Why PowerShell and not a `.cmd`: paths here contain spaces by definition -
 * people keep this on a desktop or a USB stick - and batch quoting around
 * `move`, `copy` and `start` is the kind of thing that works until a folder is
 * called "My Apps". Arguments are passed as parameters rather than pasted into
 * the script text, so a path is never parsed as code.
 */

export interface SwapOptions {
  /** The exe the user keeps and double-clicks. */
  current: string;
  /** The freshly downloaded build, in the updates directory. */
  incoming: string;
  /** This process. The script does nothing until it is gone. */
  processId: number;
  /** Test hook: do everything except start the new build. */
  noLaunch?: boolean;
}

/** How long the script keeps trying before it gives up and runs the download. */
export const ATTEMPTS = 60;
export const ATTEMPT_DELAY_MS = 500;
/** Long enough for a quit that is closing sockets; the retry loop covers more. */
export const EXIT_TIMEOUT_S = 30;

/**
 * The script text. Pure, so the check can read it, and parameterised, so no
 * path is ever interpolated into it.
 *
 * The order matters and is the whole point:
 *
 * 1. Wait for the app to exit. Nothing before this can succeed.
 * 2. Retry the rename. A handle is released when the process ends, but virus
 *    scanners and Explorer thumbnailers take the file straight afterwards, so
 *    "it failed once" is not "it cannot be done".
 * 3. Copy, not move, the download into place: the updates directory is under
 *    AppData and the portable exe is wherever the user put it, which is often
 *    another volume.
 * 4. Start the new build from the path the user already has a shortcut to.
 *
 * If every attempt fails the download is still a working build, so it is
 * started from where it sits rather than the update being lost.
 */
export function swapScript(): string {
  return `param(
  [Parameter(Mandatory = $true)][string] $Current,
  [Parameter(Mandatory = $true)][string] $Incoming,
  [Parameter(Mandatory = $true)][int] $AppProcessId,
  [switch] $NoLaunch
)

$ErrorActionPreference = 'Stop'
$retired = "$Current.old"

# 1. The app still has the exe open. Wait it out; an already-dead process is
#    not an error, it is the state this wants.
try { Wait-Process -Id $AppProcessId -Timeout ${EXIT_TIMEOUT_S} -ErrorAction Stop } catch { }

# 2. Get the running copy out of the way, retrying while the handle clears.
$moved = $false
for ($attempt = 0; $attempt -lt ${ATTEMPTS}; $attempt++) {
  try {
    if (Test-Path -LiteralPath $retired) { Remove-Item -LiteralPath $retired -Force -ErrorAction SilentlyContinue }
    Move-Item -LiteralPath $Current -Destination $retired -Force -ErrorAction Stop
    $moved = $true
    break
  } catch {
    Start-Sleep -Milliseconds ${ATTEMPT_DELAY_MS}
  }
}

if ($moved) {
  # 3. Across volumes, so a copy rather than a move.
  Copy-Item -LiteralPath $Incoming -Destination $Current -Force
  Remove-Item -LiteralPath $Incoming -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $retired -Force -ErrorAction SilentlyContinue
  $launch = $Current
} else {
  # Something still owns the file. The download is a whole build; run it from
  # where it is rather than losing the update to a lock.
  $launch = $Incoming
}

# The script is a temp file whose job is done; PowerShell has already read it,
# so removing it here is safe and leaves nothing behind in the temp folder.
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue

if (-not $NoLaunch) { Start-Process -FilePath $launch }
`;
}

/** The arguments PowerShell is spawned with, script path included. */
export function swapArguments(scriptPath: string, options: SwapOptions): string[] {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    scriptPath,
    '-Current',
    options.current,
    '-Incoming',
    options.incoming,
    '-AppProcessId',
    String(options.processId),
  ];
  if (options.noLaunch) args.push('-NoLaunch');
  return args;
}
