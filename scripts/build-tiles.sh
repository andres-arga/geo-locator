#!/usr/bin/env bash
# Builds public/tiles/<city>.pmtiles: an extract of the Protomaps daily OSM basemap
# limited to the city bbox (read from scripts/sources/<city>.places.json).
#   npm run tiles              # CABA
#   npm run tiles -- cordoba
# Requires the `pmtiles` CLI (go install github.com/protomaps/go-pmtiles@latest).
# Override the source build with PROTOMAPS_BUILD=YYYYMMDD.
set -euo pipefail
cd "$(dirname "$0")/.."

CITY=${1:-caba}
BBOX=$(node -e "console.log(JSON.parse(require('fs').readFileSync('scripts/sources/$CITY.places.json','utf8')).bbox.join(','))")
MAXZOOM=15
OUT=public/tiles/$CITY.pmtiles

PMTILES=${PMTILES:-$(command -v pmtiles || echo "$HOME/go/bin/go-pmtiles")}
if [ ! -x "$PMTILES" ]; then
  echo "pmtiles CLI not found. Install: go install github.com/protomaps/go-pmtiles@latest" >&2
  exit 1
fi

# Try the last few daily builds (the newest may not be published yet).
for i in 0 1 2 3 4 5 6; do
  D=${PROTOMAPS_BUILD:-$(date -u -d "-$i day" +%Y%m%d)}
  URL="https://build.protomaps.com/$D.pmtiles"
  echo "Extracting $CITY ($BBOX) from $URL"
  if "$PMTILES" extract "$URL" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM"; then
    echo "$D" > "public/tiles/$CITY.pmtiles.source.txt"
    ls -lh "$OUT"
    exit 0
  fi
  [ -n "${PROTOMAPS_BUILD:-}" ] && break
done
echo "Could not extract tiles" >&2
exit 1
