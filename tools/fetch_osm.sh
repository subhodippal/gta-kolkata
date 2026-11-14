#!/usr/bin/env bash
# Downloads raw OpenStreetMap data for central Kolkata (Howrah Bridge -> Victoria Memorial)
# Usage: tools/fetch_osm.sh <output_dir>
set -euo pipefail
OUT="${1:-osm_raw}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
curl -s -A "kolkata-city-3d-map-builder/1.0" --data-urlencode "data@$HERE/query_main.overpassql" \
  https://overpass-api.de/api/interpreter -o "$OUT/kol.json"
curl -s -A "kolkata-city-3d-map-builder/1.0" --data-urlencode "data@$HERE/query_landmarks.overpassql" \
  https://overpass-api.de/api/interpreter -o "$OUT/kol2.json"
curl -s -A "kolkata-city-3d-map-builder/1.0" --data-urlencode "data@$HERE/query_transit.overpassql" \
  https://overpass-api.de/api/interpreter -o "$OUT/kol3.json"
echo "Saved to $OUT. Now run: python3 tools/build_map.py $OUT data/kolkata.json  (needs: pip install shapely)"
