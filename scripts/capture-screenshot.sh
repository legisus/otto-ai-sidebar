#!/usr/bin/env bash
# Capture the Chrome window region (must be at 40,40 sized 1280x800 — see
# docs/store-listing.md) and save a store-ready 1280x800 PNG.
# Usage: scripts/capture-screenshot.sh <name>   → docs/store-assets/screenshot-<name>.png
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?usage: capture-screenshot.sh <name>}"
OUT="docs/store-assets/screenshot-$NAME.png"
screencapture -x -R40,40,1280,800 "$OUT"
sips -z 800 1280 "$OUT" >/dev/null
sips -g pixelWidth -g pixelHeight "$OUT"
