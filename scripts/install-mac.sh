#!/bin/bash
# Installs the latest Chog Buddy release on macOS.
# Files fetched with curl are not quarantined, so macOS opens the app without the
# "Apple could not verify" block that browser downloads get (the build is unsigned: $0 project).
# Read it first: https://github.com/chog-buddy-team/chog-buddy/blob/main/scripts/install-mac.sh
set -euo pipefail

REPO="chog-buddy-team/chog-buddy"
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported Mac CPU: $(uname -m)" >&2; exit 1 ;;
esac

echo "Finding the latest Chog Buddy release for $ARCH..."
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o "\"browser_download_url\": *\"[^\"]*-$ARCH\.dmg\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
[ -n "$URL" ] || { echo "Could not find a macOS download in the latest release." >&2; exit 1; }

TMP=$(mktemp -d)
trap 'hdiutil detach -quiet "$TMP/mnt" 2>/dev/null || true; rm -rf "$TMP"' EXIT
echo "Downloading $(basename "$URL")..."
curl -fL --progress-bar "$URL" -o "$TMP/ChogBuddy.dmg"

echo "Installing to /Applications..."
mkdir -p "$TMP/mnt"
hdiutil attach -nobrowse -quiet -readonly -mountpoint "$TMP/mnt" "$TMP/ChogBuddy.dmg"
osascript -e 'quit app "Chog Buddy"' 2>/dev/null || true
rm -rf "/Applications/Chog Buddy.app"
cp -R "$TMP/mnt/Chog Buddy.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/Chog Buddy.app" 2>/dev/null || true

echo "Done. Opening Chog Buddy (look for the Chog icon in your menu bar)."
open "/Applications/Chog Buddy.app"
