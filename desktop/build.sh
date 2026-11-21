#!/bin/zsh
# Builds Cue.app into ~/Applications and opens it. Needs Xcode (macOS 26+ SDK), Node 23.6+, and Ollama for the local model.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=desktop/build
APP="$HOME/Applications/Cue.app"
mkdir -p "$OUT" "$HOME/Applications"

npm run build
swiftc -O -swift-version 5 -target arm64-apple-macos26.0 desktop/Cue/main.swift -o "$OUT/Cue"

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
codesign --force --sign - "$APP"
echo "Built $APP"
open "$APP"
