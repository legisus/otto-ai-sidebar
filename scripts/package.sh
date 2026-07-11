#!/usr/bin/env bash
# Build the Chrome Web Store upload: a zip of extension/ with the manifest at the root.
set -euo pipefail
cd "$(dirname "$0")/.."

V=$(node -p "require('./extension/manifest.json').version")
PV=$(node -p "require('./package.json').version")
if [ "$V" != "$PV" ]; then
  echo "version mismatch: manifest.json=$V package.json=$PV" >&2
  exit 1
fi

OUT="otto-$V.zip"
rm -f "$OUT"
(cd extension && zip -qr "../$OUT" . -x "*.DS_Store")
echo "Wrote $OUT:"
unzip -l "$OUT"
