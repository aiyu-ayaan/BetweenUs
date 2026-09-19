#!/bin/sh
# Install, update or remove the BetweenUs desktop client on Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/aiyu-ayaan/BetweenUs/master/scripts/install-linux.sh | sh
#
# Options go after `sh -s --` when piped:
#
#   ... | sh -s -- --channel beta     take beta builds (and stable ones)
#   ... | sh -s -- --version 1.0.6    a specific release
#   ... | sh -s -- --uninstall        remove it (your account data stays)
#
# What it does is the Linux half of what the Windows installer does, per user
# and without root, because the same two things have to hold:
#
# - The app can replace itself. The updater (apps/desktop/electron/updates.ts)
#   writes the next AppImage over the file it was started from, so that file
#   lives somewhere this user owns: ~/.local/share/betweenus/BetweenUs.AppImage.
#   Installing it anywhere root owns would make every update fail.
# - It looks installed. A menu entry and icon, a `betweenus` command, and the
#   first launch - after which the app registers itself to start with the
#   session, exactly as it does on Windows (~/.config/autostart).
#
# Re-running it is the update path for anyone who would rather not wait for the
# in-app one, and is always safe: a running copy keeps running from the old
# file until it is restarted.
#
# POSIX sh on purpose - it is piped into whatever `sh` is, which on Debian and
# Ubuntu is dash, not bash.

set -eu

REPOSITORY="aiyu-ayaan/BetweenUs"
# Overridable for a fork or a mirror; the default is the project that publishes
# the releases, the same constant as REPOSITORY in updates.ts.
API="${BETWEENUS_RELEASES_URL:-https://api.github.com/repos/${REPOSITORY}/releases?per_page=100}"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
INSTALL_DIR="${BETWEENUS_INSTALL_DIR:-$DATA_HOME/betweenus}"
APP="$INSTALL_DIR/BetweenUs.AppImage"
BIN_DIR="${BETWEENUS_BIN_DIR:-$HOME/.local/bin}"
# The entry's name is the window's WM_CLASS (desktopName in
# electron-builder.yml), which is how a dock matches the window to it.
DESKTOP_FILE="$DATA_HOME/applications/betweenus.desktop"
ICON_FILE="$DATA_HOME/icons/hicolor/512x512/apps/betweenus.png"
AUTOSTART_FILE="$CONFIG_HOME/autostart/betweenus.desktop"

CHANNEL="${BETWEENUS_CHANNEL:-stable}"
VERSION=""
FROM_FILE=""
LAUNCH=1
UNINSTALL=0

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Install or update BetweenUs for this user.

  --channel stable|beta|alpha   release stream (default: stable). A channel takes
                                its own builds and everything steadier.
  --version X.Y.Z[-beta.N]      install this release instead of the newest
  --from-file PATH              install a local AppImage instead of downloading
  --no-launch                   do not start BetweenUs when done
  --uninstall                   remove BetweenUs (account data is kept)
  -h, --help                    show this

Environment: BETWEENUS_CHANNEL, BETWEENUS_INSTALL_DIR, BETWEENUS_BIN_DIR,
BETWEENUS_RELEASES_URL (a fork's or mirror's releases API).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --channel) [ $# -ge 2 ] || die "--channel needs a value"; CHANNEL="$2"; shift 2 ;;
    --channel=*) CHANNEL="${1#*=}"; shift ;;
    --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="${2#v}"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; VERSION="${VERSION#v}"; shift ;;
    --from-file) [ $# -ge 2 ] || die "--from-file needs a path"; FROM_FILE="$2"; shift 2 ;;
    --from-file=*) FROM_FILE="${1#*=}"; shift ;;
    --no-launch) LAUNCH=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

case "$CHANNEL" in
  stable | beta | alpha) ;;
  *) die "--channel must be stable, beta or alpha, not '$CHANNEL'" ;;
esac

# Per user, like the Windows installer (perMachine: false). As root this would
# install into /root, where the person who asked for it will never see it.
if [ "$(id -u)" -eq 0 ] && [ -z "${BETWEENUS_ALLOW_ROOT:-}" ]; then
  die "run this as the user who will use BetweenUs, not as root (no sudo needed)."
fi

refresh_menus() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q "$DATA_HOME/applications" 2>/dev/null || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true
  fi
}

# --- Uninstall ---------------------------------------------------------------

if [ "$UNINSTALL" -eq 1 ]; then
  rm -f "$APP" "$APP.part" "$DESKTOP_FILE" "$ICON_FILE" "$AUTOSTART_FILE"
  # Only our own link: a `betweenus` somebody put there themselves stays.
  if [ -L "$BIN_DIR/betweenus" ] && [ "$(readlink "$BIN_DIR/betweenus")" = "$APP" ]; then
    rm -f "$BIN_DIR/betweenus"
  fi
  rmdir "$INSTALL_DIR" 2>/dev/null || true
  refresh_menus
  say "BetweenUs is removed."
  # Same promise as the Windows uninstaller (deleteAppDataOnUninstall: false):
  # uninstalling to reinstall must not be what loses somebody's keys.
  say "Your account data is kept in $CONFIG_HOME/@betweenus/desktop - delete that folder too to remove it."
  exit 0
fi

# --- Checks ------------------------------------------------------------------

# Releases build x86_64 only. Anything else would download a binary that cannot
# run, so say so instead.
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | amd64) ;;
  *) die "BetweenUs for Linux is built for x86_64 only; this machine is $ARCH." ;;
esac

if [ -z "$FROM_FILE" ]; then
  if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fsSL --retry 3 -H "Accept: $2" "$1"; }
    fetch_to() { curl -fL --retry 3 --progress-bar -o "$2" "$1"; }
  elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -qO- --header="Accept: $2" "$1"; }
    fetch_to() { wget -q --show-progress -O "$2" "$1"; }
  else
    die "curl or wget is needed to download BetweenUs."
  fi
fi

# --- Pick the release --------------------------------------------------------

# A sortable key for a version, the same ordering updates.ts uses: by number,
# then alpha < beta < stable, then the pre-release number. Plain `sort -V`
# puts 1.0.6 *before* 1.0.6-alpha.1, which is backwards.
version_key() {
  printf '%s\n' "$1" | awk -F'[.-]' '{
    stage = 2; n = 99999
    if ($4 == "alpha") { stage = 0; n = $5 } else if ($4 == "beta") { stage = 1; n = $5 }
    printf "%08d.%08d.%08d.%d.%08d\n", $1, $2, $3, stage, n
  }'
}

# Whether `$CHANNEL` takes this version. Mirrors `accepts` in updates.ts.
channel_accepts() {
  case "$1" in
    *-alpha.*) [ "$CHANNEL" = alpha ] ;;
    *-beta.*) [ "$CHANNEL" != stable ] ;;
    *) true ;;
  esac
}

if [ -n "$FROM_FILE" ]; then
  [ -f "$FROM_FILE" ] || die "no such file: $FROM_FILE"
  label="$(basename "$FROM_FILE")"
else
  say "Looking up BetweenUs releases..."
  releases="$(fetch "$API" "application/vnd.github+json")" ||
    die "could not reach GitHub. Check the connection and try again (the API allows 60 requests an hour per address)."

  # Every AppImage on every release, with the digest GitHub recorded for it.
  # The API lists an asset's `digest` before its `browser_download_url`, so the
  # last digest seen belongs to the next URL. A carried-forward asset (a release
  # that did not rebuild Linux) appears under its own older version, which is
  # exactly the build it is.
  candidates="$(printf '%s\n' "$releases" |
    grep -oE '"(digest|browser_download_url)": *"[^"]*"' |
    awk -F'"' '
      $2 == "digest" { digest = $4; next }
      $2 == "browser_download_url" {
        if ($4 ~ /\/BetweenUs-[^\/]+\.AppImage$/) print $4 " " digest
        digest = ""
      }' | sort -u)"

  [ -n "$candidates" ] || die "no Linux build has been published yet. See https://github.com/${REPOSITORY}/releases"

  # Each eligible build as "<sort key> <version> <url> <digest>", and the newest
  # is the last line after a sort. Newline-separated, and no URL contains a
  # space, so splitting per line is safe here.
  eligible=""
  old_ifs="$IFS"
  IFS='
'
  for line in $candidates; do
    IFS="$old_ifs"
    url="${line%% *}"
    digest="${line#* }"
    file="${url##*/}"
    v="${file#BetweenUs-}"
    v="${v%.AppImage}"
    # Only the shapes release-version.mjs produces; anything else is skipped
    # rather than guessed at (a Dev build, a renamed upload).
    printf '%s\n' "$v" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$' || continue
    if [ -n "$VERSION" ]; then
      [ "$v" = "$VERSION" ] || continue
    else
      channel_accepts "$v" || continue
    fi
    eligible="$eligible$(version_key "$v") $v $url $digest
"
  done
  IFS="$old_ifs"

  newest="$(printf '%s' "$eligible" | sort | tail -n 1)"
  best=""
  best_digest=""
  if [ -n "$newest" ]; then
    # Split into its four fields on purpose; globbing is off while it does.
    set -f
    # shellcheck disable=SC2086
    set -- $newest
    set +f
    label="$2"
    best="$3"
    best_digest="${4:-}"
  fi

  if [ -z "$best" ]; then
    if [ -n "$VERSION" ]; then
      die "release $VERSION has no Linux build."
    fi
    die "no Linux build on the $CHANNEL channel yet."
  fi
fi

# --- Download ----------------------------------------------------------------

mkdir -p "$INSTALL_DIR"
partial="$APP.part"
trap 'rm -f "$partial"' EXIT INT TERM

if [ -n "$FROM_FILE" ]; then
  say "Installing $label..."
  cp "$FROM_FILE" "$partial"
else
  say "Downloading BetweenUs $label..."
  fetch_to "$best" "$partial" || die "the download failed. Nothing was changed."

  # GitHub records a sha256 for every asset uploaded since mid-2025. Checked
  # when it is there; an older asset without one is still an https download
  # from the release itself.
  case "$best_digest" in
    sha256:*)
      if command -v sha256sum >/dev/null 2>&1; then
        actual="$(sha256sum "$partial" | awk '{print $1}')"
        [ "sha256:$actual" = "$best_digest" ] ||
          die "the download does not match the checksum GitHub published for it. Nothing was changed."
      fi
      ;;
  esac
fi

# An HTML error page saved under the right name would otherwise become "the
# app" and fail in a confusing way on launch.
magic="$(head -c 4 "$partial" | od -An -c | tr -d ' \n')"
[ "$magic" = '177ELF' ] || die "that is not an AppImage. Nothing was changed."

chmod 755 "$partial"
# A rename within one directory, so a failure part-way leaves the old build in
# place and runnable - the same rule the in-app updater follows.
mv -f "$partial" "$APP"
trap - EXIT INT TERM

# --- Desktop integration -----------------------------------------------------

# The icon comes out of the AppImage itself, so it is always this build's.
extract_dir="$(mktemp -d)"
if (cd "$extract_dir" && "$APP" --appimage-extract 'usr/share/icons/hicolor/512x512/apps/betweenus.png' >/dev/null 2>&1) &&
  [ -f "$extract_dir/squashfs-root/usr/share/icons/hicolor/512x512/apps/betweenus.png" ]; then
  mkdir -p "$(dirname "$ICON_FILE")"
  cp "$extract_dir/squashfs-root/usr/share/icons/hicolor/512x512/apps/betweenus.png" "$ICON_FILE"
else
  warn "could not read the icon out of the AppImage; the menu entry will use a generic one."
fi
rm -rf "$extract_dir"

# Quoted per the Desktop Entry spec, the same rule electron/autostart.ts uses:
# in a quoted argument ", `, $ and \ are backslash-escaped, then every backslash
# is doubled for the string value, and % is always %%.
exec_path="$(printf '%s' "$APP" | sed -e 's/%/%%/g' -e 's/[\\"`$]/\\&/g' -e 's/\\/\\\\/g')"

mkdir -p "$(dirname "$DESKTOP_FILE")"
cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=BetweenUs
GenericName=Chat
Comment=Chat, voice, screen share and remote desktop
Exec="$exec_path" %U
TryExec=$APP
Icon=betweenus
Terminal=false
Categories=Network;InstantMessaging;Chat;
StartupWMClass=betweenus
StartupNotify=true
EOF
chmod 644 "$DESKTOP_FILE"
refresh_menus

mkdir -p "$BIN_DIR"
if [ ! -e "$BIN_DIR/betweenus" ] || [ -L "$BIN_DIR/betweenus" ]; then
  ln -sf "$APP" "$BIN_DIR/betweenus"
else
  warn "$BIN_DIR/betweenus exists and is not ours; left it alone."
fi

say "BetweenUs $label is installed to $APP"

case ":${PATH}:" in
  *":$BIN_DIR:"*) ;;
  *) say "Add $BIN_DIR to your PATH to start it with the 'betweenus' command." ;;
esac

# --- FUSE --------------------------------------------------------------------

# The AppImage runtime is static, so libfuse2 is not needed - but mounting still
# goes through the kernel's FUSE device and the setuid `fusermount3` helper.
# Without them it can still run by unpacking itself on every launch, which is
# slower, so this says what to install rather than failing.
if [ ! -e /dev/fuse ] || ! { command -v fusermount3 >/dev/null 2>&1 || command -v fusermount >/dev/null 2>&1; }; then
  warn "FUSE is not available, so BetweenUs will unpack itself on every start (slower)."
  warn "Install it with your package manager, e.g.: sudo apt install fuse3   /   sudo dnf install fuse3"
fi

# --- First launch --------------------------------------------------------------

# Like the Windows installer's runAfterFinish. It is also what turns on "start
# with the system": the app writes its autostart entry on launch while that
# setting is on, which it is by default.
if [ "$LAUNCH" -eq 1 ] && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
  if pgrep -f "$APP" >/dev/null 2>&1; then
    say "BetweenUs is already running; restart it to use $label."
  else
    say "Starting BetweenUs..."
    nohup "$APP" >/dev/null 2>&1 &
  fi
fi
