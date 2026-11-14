#!/usr/bin/env python3
"""
Download OpenStreetMap data for Greater Kolkata (Dankuni / Dakshineswar / Airport / New Town / Esplanade / Victoria)
in ~3 km cells from the Overpass API, politely (sequential, with retries).

  python3 tools/fetch_region.py osm_raw

Writes osm_raw/cell_<r>_<c>.json for every cell plus osm_raw/region_rel.json (rivers, lakes, metro, ferries).
Existing files are skipped, so the script can be resumed.
"""
import os, sys, time, json, urllib.request, urllib.parse

S, W, N, E = 22.535, 88.280, 22.700, 88.490
ROWS, COLS = 10, 13
URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
UA = "kolkata-city-3d-map-builder/1.0"

CELL_Q = """[out:json][timeout:600][maxsize:1073741824][bbox:{s},{w},{n},{e}];
(
  way["highway"];
  way["building"];
  relation["building"];
  way["leisure"~"park|garden|stadium|pitch|golf_course|nature_reserve|playground|sports_centre"];
  relation["leisure"~"park|garden|golf_course|stadium"];
  way["landuse"];
  relation["landuse"];
  way["natural"~"water|wetland|wood|scrub|grassland|tree_row"];
  way["waterway"~"riverbank|canal|river|drain|dock"];
  way["railway"~"rail|tram|subway|light_rail|construction|narrow_gauge"];
  way["aeroway"];
  nwr["amenity"]["name"];
  node["amenity"~"fuel|bus_station|toilets|drinking_water"];
  nwr["shop"]["name"];
  nwr["tourism"];
  nwr["historic"]["name"];
  nwr["office"]["name"];
  nwr["railway"~"station|subway_entrance|halt|tram_stop"];
  node["public_transport"="station"];
  node["highway"~"bus_stop|traffic_signals|crossing|turning_circle"];
  node["natural"="tree"];
  node["place"];
  way["man_made"~"bridge|pier|tower|water_tower"];
  way["route"="ferry"];
);
out geom;"""

REL_QS = [
  """[out:json][timeout:600];(relation["natural"="water"]({s},{w},{n},{e});relation["waterway"="riverbank"]({s},{w},{n},{e}););out geom;""",
  """[out:json][timeout:600];(relation["route"~"subway|light_rail|monorail"]({s},{w},{n},{e}););out geom;""",
  """[out:json][timeout:600];(relation["route"="ferry"]({s},{w},{n},{e});way["route"="ferry"]({s},{w},{n},{e});relation["aeroway"]({s},{w},{n},{e});relation["leisure"="nature_reserve"]({s},{w},{n},{e}););out geom;""",
]


def fetch(q, path, server=0):
    if os.path.exists(path) and os.path.getsize(path) > 100:
        print("skip", path); return
    data = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(8):
        url = URLS[(server + attempt) % len(URLS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=900) as r:
                body = r.read()
            json.loads(body)  # validate
            if b'"remark"' in body[:2000] and b"runtime error" in body[:4000]:
                raise RuntimeError("overpass runtime error")
            open(path, "wb").write(body)
            print(f"ok {path} {len(body) / 1e6:.1f} MB in {time.time() - t0:.0f}s", flush=True)
            time.sleep(4)
            return
        except Exception as ex:
            wait = 20 * (attempt + 1)
            print(f"retry {path} ({ex}) in {wait}s", flush=True)
            time.sleep(wait)
    raise SystemExit("failed " + path)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "osm_raw"
    os.makedirs(out, exist_ok=True)
    for i, q in enumerate(REL_QS):
        fetch(q.format(s=S, w=W, n=N, e=E), os.path.join(out, f"region_rel_{i}.json"))
    dl, dw = (N - S) / ROWS, (E - W) / COLS
    jobs = []
    for r in range(ROWS):
        for c in range(COLS):
            s, w = S + r * dl, W + c * dw
            jobs.append((CELL_Q.format(s=round(s, 5), w=round(w, 5), n=round(s + dl, 5), e=round(w + dw, 5)), os.path.join(out, f"cell_{r}_{c}.json")))
    # one worker per public Overpass server (each server sees one request at a time)
    import threading
    lock = threading.Lock()

    def worker(server):
        while True:
            with lock:
                if not jobs:
                    return
                q, p = jobs.pop(0)
            fetch(q, p, server)
    ths = [threading.Thread(target=worker, args=(i,)) for i in range(len(URLS))]
    for th in ths:
        th.start()
    for th in ths:
        th.join()


if __name__ == "__main__":
    main()
