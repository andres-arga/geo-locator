#!/usr/bin/env bash
# Builds public/tiles/caba.pmtiles: an extract of the Protomaps daily OSM basemap
# limited to the CABA bbox. Requires the `pmtiles` CLI
# (go install github.com/protomaps/go-pmtiles@latest, or a release binary).
# Override the source build with PROTOMAPS_BUILD=YYYYMMDD.
set -euo pipefail
cd "$(dirname "$0")/.."

BBOX="-58.56,-34.72,-58.32,-34.51"   # keep in sync with src/cities/caba.ts
MAXZOOM=15
OUT=public/tiles/caba.pmtiles

PMTILES=${PMTILES:-$(command -v pmtiles || echo "$HOME/go/bin/go-pmtiles")}
if [ ! -x "$PMTILES" ]; then
  echo "pmtiles CLI not found. Install: go install github.com/protomaps/go-pmtiles@latest" >&2
  exit 1
fi

# Try the last few daily builds (the newest may not be published yet).
for i in 0 1 2 3 4 5 6; do
  D=${PROTOMAPS_BUILD:-$(date -u -d "-$i day" +%Y%m%d)}
  URL="https://build.protomaps.com/$D.pmtiles"
  echo "Extracting from $URL"
  if "$PMTILES" extract "$URL" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM"; then
    echo "$D" > public/tiles/caba.pmtiles.source.txt
    ls -lh "$OUT"
    exit 0
  fi
  [ -n "${PROTOMAPS_BUILD:-}" ] && break
done
echo "Could not extract tiles" >&2
exit 1
