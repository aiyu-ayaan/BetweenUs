#!/bin/sh
# Prove a built AppImage is one somebody can actually run.
#
#   .github/scripts/smoke-appimage.sh apps/desktop/release/BetweenUs-1.0.6.AppImage
#
# electron-builder finishing is not that proof. The AppImage that shipped before
# this check existed built cleanly and took ninety seconds to open, because of
# how it was compressed; a missing library, a broken asar or a main process that
# throws on Linux would all build cleanly too. So this starts it, the way a
# person's session would, and waits for it to get somewhere.
#
# "Somewhere" is the autostart entry. Launch on startup is on by default, and the
# app writes ~/.config/autostart/betweenus.desktop once its main process is up
# (electron/autostart.ts) - so the file appearing, pointing at this AppImage,
# means Electron started, the bundle loaded, main ran, and the Linux half of
# "start with the system" works. Then the process has to still be alive: an app
# that writes the file and crashes a second later is not a pass.
#
# Everything runs in a throwaway HOME, so it never touches a real profile.

set -eu

APPIMAGE_FILE="$(readlink -f "${1:?usage: smoke-appimage.sh <file.AppImage>}")"
[ -f "$APPIMAGE_FILE" ] || { echo "::error::$APPIMAGE_FILE does not exist"; exit 1; }
chmod +x "$APPIMAGE_FILE"

WORK="$(mktemp -d)"
LOG="$WORK/app.log"
PID=""
# The app runs in a session of its own (setsid, below) so this can take down the
# whole tree - xvfb-run, Xvfb, Electron and its helpers - rather than leave a
# window server running on the runner after the step has finished.
cleanup() {
  if [ -n "$PID" ]; then
    kill -TERM "-$PID" 2>/dev/null || true
    sleep 1
    kill -KILL "-$PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Embedded desktop entry:"
(cd "$WORK" && "$APPIMAGE_FILE" --appimage-extract '*.desktop' >/dev/null)
cat "$WORK"/squashfs-root/*.desktop
# The window is matched to its menu entry by this; the installer's entry and
# desktopName in electron-builder.yml say the same thing.
grep -qx 'StartupWMClass=betweenus' "$WORK"/squashfs-root/*.desktop || {
  echo "::error::The AppImage's desktop entry has lost StartupWMClass=betweenus"
  exit 1
}
rm -rf "$WORK/squashfs-root"

if ! command -v xvfb-run >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y -qq xvfb >/dev/null
fi

mkdir -p "$WORK/home" "$WORK/tmp"
# Unpacked rather than FUSE-mounted: a runner is not guaranteed a FUSE device,
# and what is being tested is the application, not the kernel's FUSE. TMPDIR is
# where the runtime unpacks it, so the cleanup above takes that with it too.
HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/home/.config" TMPDIR="$WORK/tmp" APPIMAGE_EXTRACT_AND_RUN=1 \
  setsid xvfb-run -a "$APPIMAGE_FILE" --hidden --enable-logging=stderr >"$LOG" 2>&1 &
PID=$!

ENTRY="$WORK/home/.config/autostart/betweenus.desktop"
for _ in $(seq 1 90); do
  [ -f "$ENTRY" ] && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done

fail() {
  echo "::error::$1"
  echo "--- application output"
  tail -n 80 "$LOG" || true
  exit 1
}

[ -f "$ENTRY" ] || fail "BetweenUs did not get as far as writing its autostart entry within 90 seconds."
echo "Autostart entry written by the app:"
cat "$ENTRY"
grep -q "^Exec=.*\.AppImage.* --hidden\$" "$ENTRY" ||
  fail "The autostart entry does not start the AppImage with --hidden."

# Still running a few seconds on is the difference between started and crashed.
sleep 5
kill -0 "$PID" 2>/dev/null || fail "BetweenUs exited after starting."

echo "AppImage smoke test passed."
