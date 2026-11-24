#!/usr/bin/env bash
# Downloads the glyph ranges used by street labels (Noto Sans, SIL OFL) from
# protomaps/basemaps-assets into public/fonts/.
set -euo pipefail
cd "$(dirname "$0")/.."
FONT="Noto Sans Regular"
BASE="https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts"
mkdir -p "public/fonts/$FONT"
for range in 0-255 256-511 8192-8447; do
  curl -fsSL "$BASE/${FONT// /%20}/$range.pbf" -o "public/fonts/$FONT/$range.pbf"
done
echo "Fonts in public/fonts/$FONT"
