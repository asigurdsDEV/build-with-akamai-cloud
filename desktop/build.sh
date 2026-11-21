#!/bin/zsh
# Builds Cue.app into ~/Applications and opens it. Needs Xcode (macOS 26+ SDK), Node 23.6+, and Ollama for the local model.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=desktop/build
APP="$HOME/Applications/Cue.app"
mkdir -p "$OUT" "$HOME/Applications"

npm run build
swiftc -O -swift-version 5 -target arm64-apple-macos26.0 desktop/Cue/*.swift -o "$OUT/Cue"

if [[ ! -f "$OUT/Cue.icns" ]]; then
  swift desktop/make-icon.swift "$OUT/icon.png"
  rm -rf "$OUT/Cue.iconset" && mkdir "$OUT/Cue.iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$OUT/icon.png" --out "$OUT/Cue.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$OUT/icon.png" --out "$OUT/Cue.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$OUT/Cue.iconset" -o "$OUT/Cue.icns"
fi

osascript -e 'quit app "Cue"' 2>/dev/null || true
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$OUT/Cue" "$APP/Contents/MacOS/Cue"
cp "$OUT/Cue.icns" "$APP/Contents/Resources/Cue.icns"
WEB="$APP/Contents/Resources/web"   # the server and built app live inside Cue.app
mkdir -p "$WEB/node_modules"
cp -R dist server shared package.json "$WEB/"
cp -R node_modules/aws4fetch "$WEB/node_modules/"
rm -f "$WEB/shared/"*.test.ts
sed -e "s#__NODE__#$(command -v node)#" -e "s#__OLLAMA__#$(command -v ollama || echo /opt/homebrew/bin/ollama)#" desktop/Info.plist > "$APP/Contents/Info.plist"
# Sign with a stable identity so macOS keeps Mic / Speech / Screen Recording permissions across rebuilds.
# Ad-hoc signing (-) changes the app's identity every build, so macOS asks again each time.
# The first build picks an Apple Development certificate and remembers it (by fingerprint) in desktop/build/,
# because the keychain can list several in any order and a different one would reset the permissions.
ID_FILE="$OUT/sign-identity"
if [[ -n "${CUE_SIGN_IDENTITY:-}" ]]; then IDENTITY="$CUE_SIGN_IDENTITY"
elif [[ -s "$ID_FILE" ]]; then IDENTITY="$(<"$ID_FILE")"
else
  IDENTITY="$(security find-identity -v -p codesigning | awk '/Apple Development/ {print $2; exit}')"
  [[ -n "$IDENTITY" ]] && echo "$IDENTITY" > "$ID_FILE"
fi
codesign --force --sign "${IDENTITY:--}" "$APP"
echo "Signed with: $(codesign -dvv "$APP" 2>&1 | awk -F= '/^Authority=Apple Development/ {print $2; exit}' | sed -E 's/: .* \(/: … (/' || true)"
echo "Built $APP"
open "$APP"
