#!/usr/bin/env python3
"""
Extract Greater Kolkata from a Geofabrik .osm.pbf into Overpass-style JSON chunks (same format as
'out geom'), so tools/build_region.py can read it.  Much faster than many Overpass queries.

  pip install osmium
  curl -L -o osm_raw/eastern-zone.osm.pbf https://download.geofabrik.de/asia/india/eastern-zone-latest.osm.pbf
  python3 tools/pbf_to_cells.py osm_raw/eastern-zone.osm.pbf osm_raw

Writes osm_raw/cell_pbf_000.json ... (river / metro / ferry relations still come from tools/fetch_region.py's
region_rel_*.json, which are small Overpass queries).
"""
import json, os, sys
import osmium

S, W, N, E = 22.535, 88.280, 22.700, 88.490
M = 0.01  # margin (deg) so ways crossing the border are complete
KEYS = {"highway", "building", "leisure", "landuse", "natural", "waterway", "railway", "aeroway", "amenity", "shop", "tourism",
        "historic", "office", "public_transport", "place", "man_made", "route", "bridge:name"}
REL_KEYS = {"building", "landuse", "leisure", "natural", "amenity", "aeroway", "tourism", "historic", "man_made", "waterway"}
CHUNK = 40000

src, out = sys.argv[1], sys.argv[2]


def inside(lat, lon, m=0.0):
    return S - m <= lat <= N + m and W - m <= lon <= E + m


class RelScan(osmium.SimpleHandler):
    """pass 1: multipolygon relations we care about -> member way ids"""
    def __init__(self):
        super().__init__(); self.rels = {}; self.need = set()

    def relation(self, r):
        tags = {t.k: t.v for t in r.tags}
        if tags.get("type") not in ("multipolygon", None) or not (REL_KEYS & tags.keys()):
            return
        mem = [(m.type, m.ref, m.role) for m in r.members]
        if not any(t == "w" for t, _, _ in mem) or len(mem) > 3000:
            return
        self.rels[r.id] = (tags, mem)
        for t, ref, _ in mem:
            if t == "w":
                self.need.add(ref)


class Main(osmium.SimpleHandler):
    def __init__(self, need):
        super().__init__(); self.need = need; self.geom = {}; self.buf = []; self.n = 0; self.count = 0

    def emit(self, e):
        self.buf.append(e)
        if len(self.buf) >= CHUNK:
            self.flush()

    def flush(self):
        if not self.buf:
            return
        p = os.path.join(out, f"cell_pbf_{self.n:03d}.json")
        json.dump({"elements": self.buf}, open(p, "w"), separators=(",", ":"))
        print("wrote", p, len(self.buf), flush=True)
        self.count += len(self.buf); self.n += 1; self.buf = []

    def node(self, n):
        if not n.tags or not n.location.valid() or not inside(n.location.lat, n.location.lon):
            return
        tags = {t.k: t.v for t in n.tags}
        if KEYS & tags.keys():
            self.emit({"type": "node", "id": n.id, "lat": n.location.lat, "lon": n.location.lon, "tags": tags})

    def way(self, w):
        try:
            g = [{"lat": nd.location.lat, "lon": nd.location.lon} for nd in w.nodes if nd.location.valid()]
        except Exception:
            return
        if len(g) < 2:
            return
        hit = any(inside(p["lat"], p["lon"], M) for p in g[:: max(1, len(g) // 50)]) or any(inside(p["lat"], p["lon"], M) for p in (g[0], g[-1]))
        if w.id in self.need and hit:
            self.geom[w.id] = g
        if not hit or not w.tags:
            return
        tags = {t.k: t.v for t in w.tags}
        if KEYS & tags.keys():
            self.emit({"type": "way", "id": w.id, "tags": tags, "geometry": g})


print("pass 1: relations…", flush=True)
rs = RelScan(); rs.apply_file(src)
print("relations of interest", len(rs.rels), "member ways", len(rs.need), flush=True)
for f in os.listdir(out):
    if f.startswith("cell_pbf_"):
        os.remove(os.path.join(out, f))
print("pass 2: nodes & ways (with locations)…", flush=True)
mh = Main(rs.need)
mh.apply_file(src, locations=True, idx="flex_mem")
print("pass 3: assembling multipolygons…", flush=True)
for rid, (tags, mem) in rs.rels.items():
    members = []
    for t, ref, role in mem:
        if t == "w" and ref in mh.geom:
            members.append({"type": "way", "ref": ref, "role": role, "geometry": mh.geom[ref]})
    if members:
        mh.emit({"type": "relation", "id": rid, "tags": tags, "members": members})
mh.flush()
print("done, elements:", mh.count)
