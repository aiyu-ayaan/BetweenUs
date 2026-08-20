#!/bin/sh
# Turns whatever is in ANDROID_KEYSTORE_BASE64 into a keystore file, or says
# precisely why it cannot - without printing the secret.
#
#   .github/scripts/decode-keystore.sh <output-path>
#   .github/scripts/decode-keystore.sh --self-check <a-real-keystore>
#
# `base64 -d` is strict, and a keystore that is perfectly fine arrives as
# something it refuses in more ways than is obvious:
#
#   - PEM banners, from `certutil -encode` on Windows
#   - line wrapping, from `base64` without -w0 and from every text box
#   - a UTF-8 BOM, from PowerShell redirection into a file that was then pasted
#   - quotes, from pasting a shell variable rather than its value
#   - the URL-safe alphabet, which uses - and _ where base64 uses + and /
#   - missing `=` padding, which some encoders leave off
#
# All six are recoverable and are recovered here. What is not recoverable is a
# secret that does not hold base64 of a keystore at all, and that is what the
# error is for.
#
# Order matters in one place: banner lines go BEFORE the URL-safe translation,
# because `-----BEGIN CERTIFICATE-----` is made of the same dashes that
# translation turns into `+`, and a banner rewritten into data corrupts
# everything after it.

set -e

fail() {
  # `::error::` renders on the job summary; plain echo would only be in the log.
  echo "::error::$1"
  shift
  for line in "$@"; do echo "::error::$line"; done
  exit 1
}

decode() {
  secret="$1"
  out="$2"

  raw="$(printf '%s' "$secret" | sed -e '/-----/d' | tr -d '[:space:]')"

  # Only when it looks URL-safe: a standard-alphabet blob has no - or _ in it,
  # and translating one that does have them would be inventing data.
  case "$raw" in
    *[-_]*)
      case "$raw" in
        *[+/]*) : ;;  # both alphabets at once is not either of them
        *) raw="$(printf '%s' "$raw" | tr -- '-_' '+/')" ;;
      esac
      ;;
  esac

  # A BOM, a stray quote, a hex dump, the file's own bytes: anything outside
  # the alphabet is dropped here, and counted so the error can say how much.
  clean="$(printf '%s' "$raw" | tr -cd 'A-Za-z0-9+/=')"

  before=$(printf '%s' "$raw" | wc -c)
  after=$(printf '%s' "$clean" | wc -c)
  dropped=$((before - after))

  case $((after % 4)) in
    0) : ;;
    2) clean="${clean}==" ;;
    3) clean="${clean}=" ;;
    *)
      fail "ANDROID_KEYSTORE_BASE64 is not base64." \
        "After stripping banners and whitespace it is ${after} characters," \
        "which cannot be base64 of anything - a base64 length is never 1 more" \
        "than a multiple of 4. It looks truncated, or it is not base64 at all."
      ;;
  esac

  if [ "$after" -eq 0 ]; then
    fail "ANDROID_KEYSTORE_BASE64 is set but holds no base64 characters at all."
  fi

  if ! printf '%s' "$clean" | base64 -d > "$out" 2>/dev/null; then
    fail "ANDROID_KEYSTORE_BASE64 is not base64." \
      "${after} base64-alphabet characters, ${dropped} other characters dropped." \
      "Generate it as a single line, straight to the clipboard:" \
      "  PowerShell:   [Convert]::ToBase64String([IO.File]::ReadAllBytes('release.jks')) | Set-Clipboard" \
      "  Linux/macOS:  base64 -w0 release.jks | pbcopy   (or xclip -selection clipboard)" \
      "Do not redirect to a file first - PowerShell 5.1 writes UTF-16 and you" \
      "will paste something that is not what you generated." \
      "A correct secret begins MII (PKCS#12) or /u3+7Q (JKS). Check that first."
  fi

  # It decoded. Whether it decoded to a keystore is a different question, and
  # one worth asking now: base64 of the wrong file decodes perfectly.
  magic="$(od -An -v -tx1 -N4 "$out" | tr -d ' \n')"
  case "$magic" in
    feedfeed) echo "keystore: JKS" ;;
    cececece) echo "keystore: JCEKS" ;;
    30????*)  echo "keystore: PKCS#12" ;;
    *)
      size=$(wc -c < "$out")
      rm -f "$out"
      fail "That decoded, but it is not a keystore." \
        "${size} bytes starting ${magic} - a JKS starts feedfeed and a PKCS#12" \
        "starts 3082. The secret holds base64 of some other file."
      ;;
  esac
}

self_check() {
  keystore="$1"
  [ -f "$keystore" ] || { echo "self-check needs a real keystore path"; exit 1; }

  tmp="${TMPDIR:-/tmp}/keystore-self-check.$$"
  mkdir -p "$tmp"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT

  plain="$(base64 -w0 < "$keystore" 2>/dev/null || base64 < "$keystore" | tr -d '\n')"
  wrapped="$(base64 < "$keystore")"
  failures=0

  try() {
    name="$1"
    secret="$2"
    if ( decode "$secret" "$tmp/out.jks" ) > /dev/null 2>&1 && cmp -s "$tmp/out.jks" "$keystore"; then
      echo "  ok      $name"
    else
      echo "  FAILED  $name"
      failures=$((failures + 1))
    fi
    rm -f "$tmp/out.jks"
  }

  refuses() {
    name="$1"
    secret="$2"
    if ( decode "$secret" "$tmp/out.jks" ) > /dev/null 2>&1; then
      echo "  FAILED  $name (accepted something it should refuse)"
      failures=$((failures + 1))
    else
      echo "  ok      $name"
    fi
    rm -f "$tmp/out.jks"
  }

  echo "recovers:"
  try "single line"              "$plain"
  try "wrapped at 76 columns"    "$wrapped"
  try "CRLF line endings"        "$(printf '%s' "$wrapped" | sed -e 's/$/\r/')"
  try "PEM banners"              "$(printf -- '-----BEGIN CERTIFICATE-----\n%s\n-----END CERTIFICATE-----\n' "$wrapped")"
  try "UTF-8 BOM"                "$(printf '\357\273\277%s' "$plain")"
  try "surrounding quotes"       "\"$plain\""
  try "leading/trailing spaces"  "   $plain   "
  try "no padding"               "$(printf '%s' "$plain" | tr -d '=')"
  try "URL-safe alphabet"        "$(printf '%s' "$plain" | tr -- '+/' '-_')"

  echo "refuses:"
  refuses "not base64 at all"    "this is definitely not base64 !!!"
  refuses "empty"                ""
  refuses "base64 of a text file" "$(printf 'hello world, not a keystore' | base64 | tr -d '\n')"
  refuses "the raw keystore"     "$(head -c 512 "$keystore")"

  if [ "$failures" -ne 0 ]; then
    echo "decode-keystore self-check FAILED ($failures)"
    exit 1
  fi
  echo "decode-keystore self-check passed"
}

case "$1" in
  --self-check) self_check "$2" ;;
  '') echo "usage: decode-keystore.sh <output-path>"; exit 1 ;;
  *) decode "${KEYSTORE_BASE64:-}" "$1" ;;
esac
