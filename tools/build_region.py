#!/usr/bin/env python3
"""
Greater-Kolkata map builder (tiled).

  python3 tools/build_region.py osm_raw data [--retranslate]

Input : osm_raw/cell_*.json + osm_raw/region_rel.json  (from tools/fetch_region.py)
Output: data/region.json        whole-region overview: land/river, main road network, metro, stations, bus stops,
                                signals, places (areas), POIs, landmarks, ferries, river centre line, airport
        data/tiles/<tx>_<tz>.json   1 km tiles with full detail: all roads (with lanes / one-way), buildings, parks,
                                water, land use, rails, canals, runways, trees, zebra crossings
        data/strings.json       "names" / "types" (English + Bengali), other sections are kept
Coordinates: metres from LAT0/LON0 (Esplanade); x = east, z = south.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, re, sys, glob, zlib
from collections import defaultdict
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import polygonize, unary_union, linemerge
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bengali import to_bengali, word_bn  # noqa: E402

LAT0, LON0 = 22.565, 88.349
S, W, N, E = 22.535, 88.280, 22.700, 88.490
KX = 111320.0 * math.cos(math.radians(LAT0))
KZ = 110574.0
TS = 1000.0  # tile size (m)


def xz(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KZ)


r1 = lambda v: round(v, 1)


def flat(cs):
    o = []
    for x, z in cs:
        o += [r1(x), r1(z)]
    return o


def hsh(i):
    return zlib.crc32(str(i).encode()) & 0xffffffff


src, dst = sys.argv[1], sys.argv[2]
RETRANSLATE = "--retranslate" in sys.argv
X0, Z1 = xz(S, W)
X1, Z0 = xz(N, E)
WORLD = box(X0, Z0, X1, Z1)
print("region", round(X0), round(Z0), round(X1), round(Z1))

OSM_BN = {}


def name_of(t):
    n = t.get("name:en") or t.get("name") or ""
    if re.search("[ঀ-৿]", n) and t.get("name:en"):
        n = t["name:en"]
    if n and t.get("name:bn") and n not in OSM_BN:
        OSM_BN[n] = t["name:bn"]
    return n.strip()


def coords(e):
    return [xz(p["lat"], p["lon"]) for p in e.get("geometry", []) if p]


def rel_polys(e):
    outers, inners = [], []
    for m in e.get("members", []):
        g = m.get("geometry")
        if not g or m.get("type") != "way":
            continue
        cs = [xz(p["lat"], p["lon"]) for p in g if p]
        if len(cs) >= 2:
            (outers if m.get("role") != "inner" else inners).append(LineString(cs))
    try:
        polys = list(polygonize(linemerge(outers) if outers else []))
        holes = list(polygonize(linemerge(inners) if inners else []))
    except Exception:
        return []
    if not polys:
        return []
    shape = unary_union(polys)
    if holes:
        shape = shape.difference(unary_union(holes))
    return [shape] if shape.geom_type == "Polygon" else [g for g in getattr(shape, "geoms", []) if g.geom_type == "Polygon"]


def poly_out(pg, simplify=0.3):
    pg = pg.simplify(simplify, preserve_topology=True)
    if pg.is_empty or pg.geom_type != "Polygon":
        return None
    ext = list(pg.exterior.coords)[:-1]
    if len(ext) < 3:
        return None
    o = {"p": flat(ext)}
    hs = [flat(list(i.coords)[:-1]) for i in pg.interiors if len(i.coords) > 3]
    if hs:
        o["h"] = hs
    return o


def polys_of(e):
    t = e.get("tags", {})
    if e["type"] == "way":
        cs = coords(e)
        if len(cs) < 4 or math.dist(cs[0], cs[-1]) > 0.5:
            return []
        try:
            pg = Polygon(cs).buffer(0)
        except Exception:
            return []
        return [pg] if pg.geom_type == "Polygon" else [g for g in getattr(pg, "geoms", []) if g.geom_type == "Polygon"]
    if e["type"] == "relation" and t.get("type") in ("multipolygon", None):
        return rel_polys(e)
    return []


def tiles_of_bounds(b):
    return [(tx, tz) for tx in range(math.floor(b[0] / TS), math.floor(b[2] / TS) + 1)
            for tz in range(math.floor(b[1] / TS), math.floor(b[3] / TS) + 1)]


def tile_box(tx, tz):
    return box(tx * TS, tz * TS, (tx + 1) * TS, (tz + 1) * TS)


def lines_of(g):
    if g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [list(g.coords)]
    return [list(x.coords) for x in getattr(g, "geoms", []) if x.geom_type == "LineString" and len(x.coords) >= 2]


def polys_clip(pg):
    """[(tile, polygon piece)]"""
    out = []
    for t in tiles_of_bounds(pg.bounds):
        try:
            g = pg.intersection(tile_box(*t))
        except Exception:
            continue
        for p in ([g] if g.geom_type == "Polygon" else [x for x in getattr(g, "geoms", []) if x.geom_type == "Polygon"]):
            if p.area > 4:
                out.append((t, p))
    return out


tiles = defaultdict(lambda: defaultdict(list))

# ---------------------------------------------------------------- river & big water (region relations)
rel = []
for fn in sorted(glob.glob(os.path.join(src, "region_rel*.json"))):
    rel += json.load(open(fn))["elements"]
river_parts = []
metro_rels, ferry_lines = [], []
for e in rel:
    t = e.get("tags", {})
    if e["type"] == "relation" and (t.get("water") == "river" or t.get("waterway") in ("riverbank", "river") or t.get("name") in ("Hooghly", "Hugli")):
        for pg in rel_polys(e):
            if pg.area > 50000:
                river_parts.append(pg)
    elif e["type"] == "relation" and t.get("route") in ("subway", "light_rail", "monorail"):
        metro_rels.append(e)
    elif t.get("route") == "ferry":
        if e["type"] == "way":
            ferry_lines.append((name_of(t), coords(e)))
        else:
            for m in e.get("members", []):
                if m.get("type") == "way" and m.get("geometry"):
                    ferry_lines.append((name_of(t), [xz(p["lat"], p["lon"]) for p in m["geometry"] if p]))
river = unary_union(river_parts).intersection(WORLD.buffer(60)) if river_parts else None
print("river parts", len(river_parts), "area km2", round(river.area / 1e6, 2) if river else 0)

# ---------------------------------------------------------------- stream the cells
ROAD_W = {"motorway": 18, "trunk": 16, "primary": 13, "secondary": 11, "tertiary": 8.5,
          "motorway_link": 7, "trunk_link": 7, "primary_link": 7, "secondary_link": 7, "tertiary_link": 6,
          "residential": 6, "living_street": 5, "unclassified": 6, "service": 4, "busway": 7,
          "pedestrian": 5, "footway": 2.2, "path": 2, "steps": 2.2, "track": 3, "cycleway": 2}
KINDS = ["motorway", "trunk", "primary", "secondary", "tertiary", "link", "residential", "service", "foot", "track"]
RK = {k: i for i, k in enumerate(KINDS)}


def road_kind(h):
    if h.endswith("_link"):
        return "link"
    if h in ("living_street", "unclassified", "residential", "busway"):
        return "residential"
    if h in ("footway", "path", "steps", "pedestrian", "cycleway"):
        return "foot"
    return h if h in RK else None


SPECIAL = {
    "Writers' Building": "writers", "Howrah Junction": "redbrick", "Kolkata New market": "redbrick",
    "Nakhoda Mosque": "nakhoda", "Indian Museum": "museum", "Raj Bhavan": "white",
    "Saint Paul's Anglican Cathedral": "cathedral", "Calcutta Town Hall": "white",
    "Victoria Memorial": "skip", "Eden Gardens": "skip", "Howrah Metro": "glass",
    "Netaji Indoor Stadium": "stadium", "RBI Museum": "white", "Emami Market": "glass", "Sealdah": "redbrick",
}
LU_KIND = {"residential": 0, "commercial": 1, "retail": 1, "industrial": 2, "railway": 3, "military": 4, "construction": 2,
           "religious": 1, "education": 0, "institutional": 1, "garages": 2, "brownfield": 2, "port": 2}
PARK_K = {"park": 0, "garden": 0, "playground": 0, "nature_reserve": 3, "pitch": 1, "golf_course": 2, "stadium": 1, "sports_centre": 1,
          "grass": 0, "recreation_ground": 0, "village_green": 0, "meadow": 0, "forest": 3, "wood": 3, "scrub": 3, "grassland": 0, "wetland": 4}

seen = set()
bridge_ways = []      # (attrs, coords) processed after all cells
net_roads = []        # region-wide road network (residential and bigger)
named_segs = defaultdict(list)  # grid -> (a, b, name, kind, w)
SEG_G = 80.0
pois_raw, places, stations_raw, rail_raw, bus_raw, signals_raw, crossings_raw = [], [], [], [], [], [], []
subway_way_tags = {}
named_index = defaultdict(list)   # lower name -> [(x, z, kind, tags, polygon)]
bld_polys = []
landmark_bld = {}
aero_terminals, aprons_c, runways = [], [], []
stats = defaultdict(int)


def add_named(n, x, z, kind, t, pg=None):
    if n:
        named_index[n.lower()].append((x, z, kind, t, pg))


def add_road_piece(o, cs, ys=None):
    """clip a road into tiles; ys = heights per vertex (optional)"""
    line = LineString(cs)
    if ys:
        cum = [0.0]
        for a, b in zip(cs, cs[1:]):
            cum.append(cum[-1] + math.dist(a, b))
    for t in tiles_of_bounds(line.bounds):
        for pc in lines_of(line.intersection(tile_box(*t))):
            oo = dict(o); oo["p"] = flat(pc)
            if ys:
                hy = []
                for p in pc:
                    s = line.project(Point(p))
                    i = 1
                    while i < len(cum) - 1 and cum[i] < s:
                        i += 1
                    f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
                    hy.append(round(ys[i - 1] + (ys[i] - ys[i - 1]) * f, 2))
                oo["y"] = hy
            tiles[t]["roads"].append(oo)


rail_lines, platforms, bstand_raw, taxi_raw, park_pos = [], [], [], [], []


def collect_extra(e, t, typ):
    """railway main lines, platforms, bus stands, taxi stands, aircraft stands"""
    rw = t.get("railway")
    if typ == "way" and rw == "rail" and t.get("service") not in ("yard", "siding", "spur", "crossover") and t.get("tunnel") != "yes" \
            and "metro" not in (t.get("name", "") + t.get("usage", "")).lower():
        cs = coords(e)
        if len(cs) >= 2:
            rail_lines.append(LineString(cs))
        return
    if typ == "way" and (rw == "platform" or (t.get("public_transport") == "platform" and t.get("train") == "yes")):
        cs = coords(e)
        if len(cs) >= 2:
            closed = cs[0] == cs[-1] and len(cs) > 3
            platforms.append({"p": flat(cs), "a": 1} if closed else {"p": flat(cs)})
        return
    am, aw = t.get("amenity"), t.get("aeroway")
    if am in ("bus_station", "taxi") or aw in ("parking_position", "stand"):
        if typ == "node":
            x, z = xz(e["lat"], e["lon"]); poly = None; ang = None
        else:
            cs = coords(e)
            if len(cs) < 2:
                return
            if cs[0] == cs[-1] and len(cs) > 3:
                pg = Polygon(cs)
                if not pg.is_valid or pg.area < 1:
                    return
                c = pg.representative_point(); x, z = c.x, c.y; poly = flat(cs); ang = None
            else:
                x, z = cs[0]; poly = None; ang = math.atan2(cs[-1][1] - cs[0][1], cs[-1][0] - cs[0][0])
        if aw:
            park_pos.append([r1(x), r1(z), round(ang, 3) if ang is not None else None])
        elif am == "bus_station":
            bstand_raw.append((x, z, name_of(t), poly))
        else:
            taxi_raw.append((x, z, name_of(t)))


def process(e):
    t = e.get("tags", {})
    typ = e["type"]
    collect_extra(e, t, typ)
    # ------------------------------------------------ roads
    h = t.get("highway")
    if typ == "way" and h in ROAD_W and t.get("area") != "yes":
        k = road_kind(h)
        cs = coords(e)
        if not k or len(cs) < 2 or t.get("tunnel") in ("yes", "building_passage"):
            return
        if t.get("oneway") == "-1":
            cs = cs[::-1]
        w = ROAD_W[h]
        lanes = 0
        try:
            lanes = int(str(t.get("lanes", "0")).split(";")[0])
            if lanes and k != "foot":
                w = max(w, min(lanes * 3.2, 22))
        except ValueError:
            lanes = 0
        wt = num(t.get("width"))  # surveyed carriageway width wins when mapped
        if wt and 2 <= wt <= 40 and k != "foot":
            w = wt
        o = {"k": RK[k], "w": w}
        n = name_of(t)
        if n:
            o["n"] = n
        if t.get("oneway") in ("yes", "-1", "1") or h in ("motorway", "motorway_link") or t.get("junction") == "roundabout":
            o["ow"] = 1
        if lanes:
            o["ln"] = lanes
        if t.get("junction") == "roundabout":
            o["ra"] = 1
        if n:
            for a, b in zip(cs, cs[1:]):
                for gx in range(int(min(a[0], b[0]) // SEG_G) - 1, int(max(a[0], b[0]) // SEG_G) + 2):
                    for gz in range(int(min(a[1], b[1]) // SEG_G) - 1, int(max(a[1], b[1]) // SEG_G) + 2):
                        named_segs[(gx, gz)].append((a, b, n, RK[k], w))
            add_named(n, cs[len(cs) // 2][0], cs[len(cs) // 2][1], "road", t)
        if t.get("bridge") in ("yes", "viaduct"):
            o["br"] = 1
            try:
                o["ly"] = int(t.get("layer", "1"))
            except ValueError:
                o["ly"] = 1
            bridge_ways.append((o, cs))
            return
        stats["roads"] += 1
        if RK[k] <= RK["residential"]:
            for pc in lines_of(LineString(cs).intersection(WORLD)):
                oo = dict(o); oo["p"] = flat(pc); net_roads.append(oo)
        add_road_piece(o, cs)
        return
    # ------------------------------------------------ rails / metro tracks / canals / runways
    rw = t.get("railway")
    if typ == "way" and rw in ("rail", "tram", "subway", "light_rail", "narrow_gauge", "construction"):
        if rw == "subway" or rw == "light_rail" or "metro" in (t.get("name", "") + t.get("construction", "")).lower():
            subway_way_tags[e["id"]] = (t.get("tunnel") == "yes", t.get("bridge") in ("yes", "viaduct") or t.get("layer", "0") not in ("0", "-1", "-2"))
            return
        if rw == "construction" or t.get("tunnel") == "yes" or t.get("service") in ("yard", "siding", "spur") and False:
            return
        cs = coords(e)
        line = LineString(cs)
        for tt in tiles_of_bounds(line.bounds):
            for pc in lines_of(line.intersection(tile_box(*tt))):
                o = {"k": 1 if rw == "tram" else 0, "p": flat(pc)}
                if t.get("bridge") in ("yes", "viaduct"):
                    o["br"] = 1
                tiles[tt]["rails"].append(o)
        return
    ww = t.get("waterway")
    if typ == "way" and ww in ("canal", "river", "drain") and t.get("tunnel") != "yes":
        cs = coords(e)
        line = LineString(cs)
        wd = {"canal": 14, "river": 25, "drain": 4}[ww]
        try:
            wd = float(t.get("width", wd))
        except ValueError:
            pass
        for tt in tiles_of_bounds(line.bounds):
            for pc in lines_of(line.intersection(tile_box(*tt))):
                tiles[tt]["canals"].append({"w": min(wd, 40), "p": flat(pc)})
        return
    aw = t.get("aeroway")
    if typ == "way" and aw in ("runway", "taxiway"):
        cs = coords(e)
        try:
            wd = float(t.get("width", 45 if aw == "runway" else 22))
        except ValueError:
            wd = 45 if aw == "runway" else 22
        if aw == "runway":
            runways.append({"p": flat(cs), "w": wd, "ref": t.get("ref", "")})
        line = LineString(cs)
        for tt in tiles_of_bounds(line.bounds):
            for pc in lines_of(line.intersection(tile_box(*tt))):
                tiles[tt]["aero"].append({"k": 0 if aw == "runway" else 1, "w": wd, "p": flat(pc)})
        return
    # ------------------------------------------------ points
    if typ == "node":
        x, z = xz(e["lat"], e["lon"])
        if not WORLD.contains(Point(x, z)):
            return
        tt = (math.floor(x / TS), math.floor(z / TS))
        hw = t.get("highway")
        if hw == "bus_stop" or t.get("amenity") == "bus_station" or (t.get("public_transport") == "platform" and t.get("bus") == "yes"):
            bus_raw.append((x, z, name_of(t)))
        elif hw == "traffic_signals":
            signals_raw.append((x, z))
        elif hw == "crossing":
            crossings_raw.append((x, z, tt))
        elif t.get("natural") == "tree":
            tiles[tt]["trees"].append([r1(x), r1(z)])
        if t.get("place") in ("suburb", "neighbourhood", "quarter", "locality", "town", "city", "village", "hamlet") and name_of(t):
            places.append({"n": name_of(t), "x": r1(x), "z": r1(z), "k": t["place"]})
    # stations
    if rw in ("station", "halt") or t.get("station") == "subway" or (t.get("public_transport") == "station" and (t.get("subway") == "yes" or t.get("train") == "yes")):
        p = coords(e) if typ != "node" else [xz(e["lat"], e["lon"])]
        if p and name_of(t):
            x = sum(c[0] for c in p) / len(p); z = sum(c[1] for c in p) / len(p)
            if WORLD.contains(Point(x, z)):
                metro = t.get("station") == "subway" or t.get("subway") == "yes" or t.get("light_rail") == "yes" or "metro" in t.get("network", "").lower()
                (stations_raw if metro else rail_raw).append((name_of(t), x, z, t))
    if rw == "subway_entrance" and typ == "node":
        x, z = xz(e["lat"], e["lon"])
        stations_raw.append(("__entrance__", x, z, t))
    # ------------------------------------------------ areas
    pgs = None
    if "building" in t and t.get("building") != "no":
        pgs = polys_of(e)
        for pg in pgs:
            if pg.area < 6 or pg.area > 250000 or not WORLD.contains(pg.representative_point()):
                continue
            add_building(pg, t, e["id"])
    elif t.get("natural") == "water" or t.get("landuse") in ("reservoir", "basin") or ww in ("riverbank", "dock"):
        if t.get("water") == "river" or ww == "riverbank":
            return
        for pg in polys_of(e):
            for tt, p in polys_clip(pg):
                o = poly_out(p, 0.5)
                if o:
                    tiles[tt]["water"].append(o)
    elif t.get("leisure") in PARK_K or t.get("landuse") in PARK_K or t.get("natural") in PARK_K:
        lk = t.get("leisure") if t.get("leisure") in PARK_K else (t.get("landuse") if t.get("landuse") in PARK_K else t.get("natural"))
        n = name_of(t)
        for pg in polys_of(e):
            if n:
                c = pg.representative_point(); add_named(n, c.x, c.y, "park", t, pg)
            for tt, p in polys_clip(pg):
                o = poly_out(p, 0.8)
                if o:
                    o["k"] = PARK_K[lk]
                    if n and p.area > 3000:
                        o["n"] = n
                    tiles[tt]["parks"].append(o)
    elif t.get("landuse") in LU_KIND or (typ == "way" and t.get("aeroway") in ("apron", "aerodrome")):
        if t.get("aeroway") == "apron":
            for pg in polys_of(e):
                aprons_c.append(pg.centroid.coords[0])
                for tt, p in polys_clip(pg):
                    o = poly_out(p, 1.0)
                    if o:
                        tiles[tt]["aprons"].append(o)
            return
        if t.get("aeroway") == "aerodrome":
            pg = polys_of(e)
            if pg:
                c = pg[0].centroid; add_named(name_of(t) or "Airport", c.x, c.y, "aerodrome", t, pg[0])
            return
        for pg in polys_of(e):
            for tt, p in polys_clip(pg):
                o = poly_out(p, 1.0)
                if o and p.area > 300:
                    o["k"] = LU_KIND[t["landuse"]]
                    tiles[tt]["landuse"].append(o)
    # ------------------------------------------------ POIs
    n = name_of(t)
    if n:
        kind = poi_kind(t)
        if kind:
            p = [xz(e["lat"], e["lon"])] if typ == "node" else (coords(e) or [xz(q["lat"], q["lon"]) for m in e.get("members", []) for q in (m.get("geometry") or [])])
            if p:
                x = sum(c[0] for c in p) / len(p); z = sum(c[1] for c in p) / len(p)
                if WORLD.contains(Point(x, z)):
                    pois_raw.append((n, kind, x, z, t))
        if typ == "node" or kind:
            p = [xz(e["lat"], e["lon"])] if typ == "node" else coords(e)
            if p:
                add_named(n, sum(c[0] for c in p) / len(p), sum(c[1] for c in p) / len(p), "node" if typ == "node" else "area", t)
    if t.get("aeroway") == "terminal":
        for pg in (pgs if pgs is not None else polys_of(e)):
            aero_terminals.append(pg)


def poi_kind(t):
    a, n, lei, tour, sh = t.get("amenity"), (t.get("name:en") or t.get("name") or "").lower(), t.get("leisure"), t.get("tourism"), t.get("shop")
    if a == "ferry_terminal" or t.get("man_made") == "ghat" or re.search(r"\bghat\b", n) and a not in ("bus_station", "post_office"): return "ghat"
    if a == "fuel": return "fuel"
    if sh in ("confectionery", "pastry") or re.search(r"sweet|mishti|mistanna|bhandar", n) and (a in ("restaurant", "fast_food", "cafe") or sh): return "sweets"
    if a in ("restaurant", "fast_food", "cafe", "food_court", "ice_cream", "bar", "pub"): return "food"
    if a in ("bank", "atm"): return "bank"
    if a in ("hospital", "clinic", "doctors") or t.get("healthcare") in ("hospital", "clinic", "centre"): return "hospital"
    if a == "pharmacy" or "healthcare" in t: return "health"
    if a in ("cinema", "theatre", "arts_centre"): return "cinema"
    if a == "police": return "police"
    if a == "place_of_worship": return "worship"
    if sh in ("mall", "department_store"): return "mall"
    if a == "marketplace": return "market"
    if sh: return "shop"
    if tour in ("hotel", "guest_house", "hostel", "motel"): return "hotel"
    if tour in ("museum", "gallery"): return "museum"
    if lei in ("stadium", "pitch", "sports_centre", "golf_course", "track") and t.get("name"): return "stadium"
    if tour in ("attraction", "artwork", "viewpoint", "theme_park", "zoo"): return "sight"
    if a in ("school", "college", "university", "library", "language_school", "kindergarten"): return "edu"
    if "office" in t or a in ("embassy", "townhall", "courthouse", "post_office"): return "office"
    if "historic" in t: return "sight"
    if lei in ("park", "garden", "nature_reserve") and t.get("name"): return "park"
    if t.get("building") in ("apartments", "residential") and t.get("name") or t.get("landuse") == "residential" and t.get("name"): return "residential"
    return None


def num(v):
    try:
        return float(str(v).lower().replace("m", "").replace(",", ".").split(";")[0].strip())
    except (ValueError, TypeError):
        return None


CSS_COL = {"white": "#f2f2ee", "black": "#2a2a2a", "grey": "#9a9a9a", "gray": "#9a9a9a", "silver": "#c0c0c0", "red": "#b03a2e",
           "maroon": "#7b2d26", "brown": "#7a5236", "orange": "#e08a3c", "yellow": "#e8cf5a", "beige": "#e6d8b8", "cream": "#f0e6c8",
           "tan": "#d2b48c", "green": "#5f8f4e", "olive": "#808046", "blue": "#3f6fb0", "navy": "#2c3e6b", "lightblue": "#a9cbe6",
           "pink": "#e3a7b8", "purple": "#7d4f8f", "gold": "#d4a937", "ivory": "#f5f1e0", "khaki": "#cdbb86", "lightgrey": "#cfcfcf",
           "lightgray": "#cfcfcf", "darkgrey": "#5e5e5e", "darkgray": "#5e5e5e", "terracotta": "#c0643d", "sandybrown": "#e3a865"}
MATERIAL_COL = {"brick": "#a8533a", "glass": "#7fa6bf", "concrete": "#b9b4aa", "plaster": "#e6e0d0", "stone": "#cbbf9e",
                "metal": "#8c9196", "wood": "#8a6440", "sandstone": "#d6b88a", "marble": "#f1eee6", "tile": "#b05a3c",
                "roof_tiles": "#b05a3c", "tin": "#9aa0a6", "asbestos": "#a7a49c", "thatch": "#b39a5e"}


def css_colour(v):
    if not v:
        return None
    v = str(v).strip().lower().replace(" ", "")
    if v.startswith("#") and len(v) in (4, 7):
        return v if len(v) == 7 else "#" + "".join(ch * 2 for ch in v[1:])
    return CSS_COL.get(v)


def add_building(pg, t, eid):
    n = name_of(t)
    sp = SPECIAL.get(n)
    if t.get("aeroway") == "terminal":
        sp = "glass"
    if sp == "skip":
        return
    o = poly_out(pg, 0.25)
    if not o:
        return
    ht = None
    try:
        if "height" in t:
            ht = float(str(t["height"]).replace("m", "").strip())
        elif "building:levels" in t:
            ht = float(str(t["building:levels"]).split(";")[0]) * 3.4 + 1
    except ValueError:
        ht = None
    if ht is None:
        b = t.get("building", "yes")
        r = hsh(eid)
        lv = [2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7, 8][r % 12]
        if b in ("house", "hut", "shed", "roof", "garage", "kiosk", "detached", "semidetached_house"):
            lv = 1 + r % 2
        elif b in ("apartments", "commercial", "office", "hotel"):
            lv = 5 + r % 8
        elif b in ("train_station", "retail", "church", "mosque", "temple", "public", "warehouse", "industrial"):
            lv = 3
        if pg.area < 40:
            lv = 1
        elif pg.area < 90:
            lv = min(lv, 3)
        ht = lv * 3.4 + 0.6
    ht = max(3, min(ht, 260))
    o["ht"] = round(ht, 1)
    if n:
        o["n"] = n
    if sp:
        o["s"] = sp
    b = t.get("building", "yes")
    if b != "yes":
        o["b"] = b
    # real appearance where the mappers recorded it (building:colour / material / roof:colour / roof:shape)
    wc = css_colour(t.get("building:colour")) or MATERIAL_COL.get(t.get("building:material", ""))
    if wc:
        o["c"] = wc
    rc = css_colour(t.get("roof:colour")) or MATERIAL_COL.get(t.get("roof:material", ""))
    if rc:
        o["rc"] = rc
    rs = t.get("roof:shape")
    if rs in ("dome", "onion", "pyramidal", "hipped", "gabled", "round"):
        o["rs"] = {"dome": "d", "onion": "d", "round": "d", "pyramidal": "p", "hipped": "p", "gabled": "g"}[rs]
    if t.get("amenity") == "place_of_worship" or b in ("temple", "mosque", "church", "cathedral", "chapel"):
        o["rel"] = t.get("religion", {"temple": "hindu", "mosque": "muslim", "church": "christian", "cathedral": "christian", "chapel": "christian"}.get(b, ""))
    c = pg.representative_point()
    tt = (math.floor(c.x / TS), math.floor(c.y / TS))
    tiles[tt]["buildings"].append(o)
    bld_polys.append(pg)
    stats["buildings"] += 1
    if n:
        add_named(n, c.x, c.y, "building", t, pg)


cells = sorted(glob.glob(os.path.join(src, "cell_*.json")))
for i, fn in enumerate(cells):
    els = json.load(open(fn))["elements"]
    for e in els:
        k = (e["type"], e["id"])
        if k in seen:
            continue
        seen.add(k)
        try:
            process(e)
        except Exception as ex:  # keep going on odd geometry
            stats["errors"] += 1
    del els
    print(f"cell {i + 1}/{len(cells)} {os.path.basename(fn)} roads={stats['roads']} buildings={stats['buildings']}", flush=True)
for e in rel:  # ferry ways / nature reserves etc. that only came with the region query
    if (e["type"], e["id"]) not in seen and e["type"] == "relation" and e.get("tags", {}).get("leisure") == "nature_reserve":
        seen.add((e["type"], e["id"])); process(e)

# ---------------------------------------------------------------- bridges & flyovers (heights)
ends = defaultdict(int)
key = lambda p: (round(p[0] / 3), round(p[1] / 3))
for o, cs in bridge_ways:
    ends[key(cs[0])] += 1; ends[key(cs[-1])] += 1
for o, cs in bridge_ways:
    line = LineString(cs)
    L = line.length
    over_river = river is not None and line.intersects(river)
    nm = o.get("n", "")
    if over_river or re.search(r"Setu|Howrah Bridge|Bally Bridge", nm):
        ys = [0.45] * len(cs)
        o["rb"] = 1  # river bridge
    elif L > 60 and o["k"] < RK["foot"]:
        H = 7.5 + 2.0 * max(0, o.get("ly", 1) - 1)
        s_conn, e_conn = ends[key(cs[0])] > 1, ends[key(cs[-1])] > 1
        ramp = min(110, L * 0.45)
        ys, acc = [], 0.0
        for i, p in enumerate(cs):
            if i:
                acc += math.dist(cs[i - 1], p)
            hgt = H
            sm = lambda u: (lambda v: v * v * (3 - 2 * v))(max(0, min(1, u)))
            if not s_conn and acc < ramp:
                hgt = H * sm(acc / ramp)
            if not e_conn and L - acc < ramp:
                hgt = min(hgt, H * sm((L - acc) / ramp))
            ys.append(round(max(0.16, hgt), 2))
        o["el"] = 1
    else:
        ys = None
    if o["k"] <= RK["residential"]:
        for pc in lines_of(line.intersection(WORLD)):
            oo = dict(o); oo["p"] = flat(pc)
            if ys:
                oo["y"] = [ys[0]] * 0 or None
            net_roads.append((oo, pc, cs, ys))
    add_road_piece(o, cs, ys)
# resolve heights for net-road bridge pieces
fixed = []
for r in net_roads:
    if isinstance(r, tuple):
        oo, pc, cs, ys = r
        oo.pop("y", None)
        if ys:
            line = LineString(cs); cum = [0.0]
            for a, b in zip(cs, cs[1:]):
                cum.append(cum[-1] + math.dist(a, b))
            hy = []
            for p in pc:
                s = line.project(Point(p)); i = 1
                while i < len(cum) - 1 and cum[i] < s:
                    i += 1
                f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
                hy.append(round(ys[i - 1] + (ys[i] - ys[i - 1]) * f, 2))
            oo["y"] = hy
        fixed.append(oo)
    else:
        fixed.append(r)
net_roads = fixed
print("net roads", len(net_roads), "bridges", len(bridge_ways))

# ---------------------------------------------------------------- nearest-road helpers
def nearest_seg(x, z, max_kind=RK["residential"], maxd=60):
    best, bd = None, maxd
    for s in named_segs.get((int(x // SEG_G), int(z // SEG_G)), []):
        if s[3] > max_kind:
            continue
        (ax, az), (bx, bz) = s[0], s[1]
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz or 1
        u = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2))
        cx, cz = ax + u * dx, az + u * dz
        d = math.hypot(cx - x, cz - z)
        if d < bd:
            bd, best = d, (s, cx, cz, math.atan2(dz, dx), d)
    return best


bld_tree = STRtree(bld_polys) if bld_polys else None


def in_building(x, z):
    if not bld_tree:
        return False
    p = Point(x, z)
    for i in bld_tree.query(p):
        if bld_polys[i].contains(p):
            return True
    return False


def in_river(x, z):
    return river is not None and river.contains(Point(x, z))


# ---------------------------------------------------------------- bus stops (real + generated), signals, crossings
bus = []
for x, z, n in bus_raw:
    r = nearest_seg(x, z)
    if not r:
        continue
    s, cx, cz, ang, d = r
    nx, nz = x - cx, z - cz
    l = math.hypot(nx, nz)
    if l < 0.1:
        nx, nz = -math.sin(ang), math.cos(ang)
    else:
        nx, nz = nx / l, nz / l
    px, pz = cx + nx * (s[4] / 2 + 2.2), cz + nz * (s[4] / 2 + 2.2)
    if in_building(px, pz) or in_river(px, pz) or any(math.hypot(b["x"] - px, b["z"] - pz) < 25 for b in bus[-30:]):
        continue
    o = {"x": r1(px), "z": r1(pz), "f": round(math.atan2(-nx, -nz), 3), "r": 1}
    if n:
        o["n"] = n
    bus.append(o)
bus_grid = defaultdict(list)
for b in bus:
    bus_grid[(int(b["x"] // 250), int(b["z"] // 250))].append(b)


def near_bus(x, z, d):
    gx, gz = int(x // 250), int(z // 250)
    return any(math.hypot(b["x"] - x, b["z"] - z) < d for i in (-1, 0, 1) for j in (-1, 0, 1) for b in bus_grid.get((gx + i, gz + j), []))


for r in net_roads:
    if r["k"] > RK["secondary"] or r.get("el") or r.get("rb"):
        continue
    p = r["p"]; acc = 210.0; idx = 0
    for i in range(1, len(p) // 2):
        ax, az, bx, bz = p[i * 2 - 2], p[i * 2 - 1], p[i * 2], p[i * 2 + 1]
        L = math.hypot(bx - ax, bz - az)
        if L < 0.01:
            continue
        tx, tz = (bx - ax) / L, (bz - az) / L
        nx, nz = -tz, tx
        while acc < L:
            side = 1 if idx % 2 else -1
            sx, sz = ax + tx * acc + nx * side * (r["w"] / 2 + 2.2), az + tz * acc + nz * side * (r["w"] / 2 + 2.2)
            idx += 1
            if not near_bus(sx, sz, 230) and not in_building(sx, sz) and not in_river(sx, sz) and WORLD.contains(Point(sx, sz)):
                o = {"x": r1(sx), "z": r1(sz), "f": round(math.atan2(-nx * side, -nz * side), 3)}
                if r.get("n"):
                    o["n"] = r["n"]
                bus.append(o); bus_grid[(int(sx // 250), int(sz // 250))].append(o)
            acc += 420
        acc -= L
signals = []
for x, z in signals_raw:
    r = nearest_seg(x, z, RK["tertiary"], 25)
    if r:
        signals.append([r1(x), r1(z), round(r[3], 3), r[0][4]])
# junction signals: every meeting of big roads (OSM only maps a few dozen signals in Kolkata)
vtx = defaultdict(list)
for ri, r in enumerate(net_roads):
    if r["k"] > RK["secondary"] or r.get("el") or r.get("rb") or r.get("ow") and r["k"] == RK["link"]:
        continue
    p = r["p"]; n = len(p) // 2
    for i in range(n):
        key = (round(p[i * 2] * 2), round(p[i * 2 + 1] * 2))
        j = i + 1 if i + 1 < n else i - 1
        vtx[key].append((ri, r["k"], r["w"], math.atan2(p[j * 2 + 1] - p[i * 2 + 1], p[j * 2] - p[i * 2]), 1 if (i == 0 or i == n - 1) else 2))
sig_grid = defaultdict(list)
for s_ in signals:
    sig_grid[(int(s_[0] // 80), int(s_[1] // 80))].append(s_)
cands = []
for key, arms in vtx.items():
    roads_here = {a[0] for a in arms}
    if len(roads_here) < 2:
        continue
    narm = sum(a[4] for a in arms)
    kmin = min(a[1] for a in arms)
    if narm < 3 or (kmin > RK["primary"] and narm < 4):
        continue
    best = min(arms, key=lambda a: (a[1], -a[2]))
    cands.append((kmin, -narm, key[0] / 2, key[1] / 2, best[3], best[2]))
cands.sort()
gen_sig = 0
for kmin, _, x, z, ang, w in cands:
    gx, gz = int(x // 80), int(z // 80)
    if any(math.hypot(o[0] - x, o[1] - z) < 70 for i in (-1, 0, 1) for j in (-1, 0, 1) for o in sig_grid.get((gx + i, gz + j), [])):
        continue
    o = [r1(x), r1(z), round(ang, 3), w]
    signals.append(o); sig_grid[(gx, gz)].append(o); gen_sig += 1
print("signals: osm", len(signals) - gen_sig, "generated", gen_sig)
for x, z, tt in crossings_raw:
    r = nearest_seg(x, z, RK["residential"], 12)
    if r:
        tiles[tt]["crossings"].append([r1(r[1]), r1(r[2]), round(r[3], 3), r[0][4]])
for s in signals:  # zebra crossings on signal approaches
    for k in (-1, 1):
        x, z = s[0] + math.cos(s[2]) * k * (s[3] / 2 + 3), s[1] + math.sin(s[2]) * k * (s[3] / 2 + 3)
        r = nearest_seg(x, z, RK["residential"], 12)
        if r:
            tiles[(math.floor(x / TS), math.floor(z / TS))]["crossings"].append([r1(r[1]), r1(r[2]), round(r[3], 3), r[0][4]])

# ---------------------------------------------------------------- bus stands (depots / termini), taxi stands
def roadside(x, z, off=4.0, maxd=120):
    r = nearest_seg(x, z, RK["tertiary"], maxd) or nearest_seg(x, z, RK["residential"], maxd)
    if not r:
        return None
    s_, cx, cz, ang, d = r
    nx, nz = x - cx, z - cz; l = math.hypot(nx, nz)
    if l < 0.1:
        nx, nz, l = -math.sin(ang), math.cos(ang), 1
    nx, nz = nx / l, nz / l
    return cx + nx * (s_[4] / 2 + off), cz + nz * (s_[4] / 2 + off), ang, (nx, nz)


bstands = []
for x, z, n, poly in bstand_raw:
    if any(math.hypot(b["x"] - x, b["z"] - z) < 60 for b in bstands):
        continue
    rs = roadside(x, z, 9)
    ang = rs[2] if rs else 0.0
    o = {"x": r1(x), "z": r1(z), "a": round(ang, 3)}
    if poly:
        o["p"] = poly
    elif rs and math.hypot(rs[0] - x, rs[1] - z) > 25:   # point far from road: keep it, it is a yard
        pass
    if n:
        o["n"] = n
    bstands.append(o)
print("bus stands", len(bstands), "aircraft stands", len(park_pos), "platforms", len(platforms))

# ---------------------------------------------------------------- mainline railway network for running trains
railnet = []
if rail_lines:
    merged = linemerge(unary_union(rail_lines))
    for ln in (merged.geoms if hasattr(merged, "geoms") else [merged]):
        if ln.length < 1200:
            continue
        ln = ln.simplify(1.5)
        railnet.append(flat(list(ln.coords)))
print("rail lines", len(railnet), "km", round(sum(LineString(list(zip(r[0::2], r[1::2]))).length for r in railnet) / 1000, 1))

# ---------------------------------------------------------------- POIs
pois, seen_p = [], set()
for n, kind, x, z, t in pois_raw:
    k2 = (n, round(x / 30), round(z / 30))
    if k2 in seen_p:
        continue
    seen_p.add(k2)
    o = {"n": n, "k": kind, "x": r1(x), "z": r1(z)}
    st = t.get("addr:street")
    if not st:
        r = nearest_seg(x, z, RK["residential"], 80)
        st = r[0][2] if r else ""
    if st:
        o["st"] = st
    sub = t.get("shop") or t.get("cuisine") or t.get("amenity") or t.get("tourism") or ""
    if sub:
        o["t"] = sub
    if t.get("brand"):
        o["br"] = t["brand"]
    pois.append(o)

# ---------------------------------------------------------------- Wikidata notable places + curated famous list
WD_SKIP = re.compile(r"constituency|ward|administrative|village|census town|big city|city|road|street|grave|cemetery|neighbo|locality|"
                     r"metro station|railway station|bus stop|river|lake|canal|human settlement|suburb|district|division|"
                     r"organization|company|business|sub post office|branch", re.I)
WD_KIND = [(r"school|college|universit|academ|institute|education|library", "edu"), (r"hotel|guest house|hostel", "hotel"),
           (r"hospital|health|clinic|medical", "hospital"), (r"temple|mosque|church|cathedral|husayniyya|monastery|synagogue|shrine|gurdwara|mandir", "worship"),
           (r"museum|gallery", "museum"), (r"ghat", "ghat"), (r"restaurant|caf|tea house|food|bakery|sweet", "food"),
           (r"shopping|mall|market", "mall"), (r"stadium|venue|cricket|sports|ground|golf|race", "stadium"), (r"park|garden|zoo", "park"),
           (r"skyscraper|tower|building|office|headquarters|court|secretariat", "building"), (r"gas station", "fuel"), (r"movie theat|cinema|theatre|auditorium", "cinema"),
           (r"palace|monument|memorial|fort|statue|landmark|tourist|heritage|bridge|square|attraction|house", "sight"), (r"bank", "bank"), (r"post office", "office")]
pgrid = defaultdict(list)
for o in pois:
    pgrid[(int(o["x"] // 200), int(o["z"] // 200))].append(o)
nrm = lambda s_: re.sub(r"[^a-z0-9]", "", s_.lower())


def near_poi(x, z, name, d):
    k = nrm(name)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for o in pgrid.get((int(x // 200) + i, int(z // 200) + j), []):
                on = nrm(o["n"]) if isinstance(o["n"], str) else ""
                if math.hypot(o["x"] - x, o["z"] - z) < d and on and (on == k or (len(k) > 5 and (k in on or on in k))):
                    return o
    return None


def add_extra(name, kind, x, z, extra):
    if not WORLD.contains(Point(x, z)):
        return None
    o = near_poi(x, z, name, 300)
    if o is None:
        o = {"n": name, "k": kind, "x": r1(x), "z": r1(z)}
        r = nearest_seg(x, z, RK["residential"], 80)
        if r:
            o["st"] = r[0][2]
        pois.append(o); pgrid[(int(x // 200), int(z // 200))].append(o)
    elif kind in ("ghat", "wonder", "sweets", "stadium", "mall", "building", "museum"):
        o["k"] = kind
    for k_, v in extra.items():
        if v and k_ not in o:
            o[k_] = v
    return o


wd_path, fam_path = os.path.join(src, "wikidata.json"), os.path.join(src, "famous.json")
n_wd = n_f = 0
if os.path.exists(wd_path):
    for it in json.load(open(wd_path)):
        en, types = it.get("en"), " ".join(it.get("types", []))
        if not en or not types or WD_SKIP.search(types) and not re.search(r"ghat|temple|hotel|stadium|museum|venue", types, re.I):
            continue
        kind = next((k_ for pat, k_ in WD_KIND if re.search(pat, types, re.I)), None)
        if not kind:
            continue
        if it.get("bn"):
            OSM_BN.setdefault(en, it["bn"])
        x, z = xz(it["lat"], it["lon"])
        if add_extra(en, kind, x, z, {"img": it.get("img"), "d": it.get("desc"), "db": it.get("bndesc"), "q": it["q"]}):
            n_wd += 1
manual = os.path.join(os.path.dirname(os.path.abspath(__file__)), "famous_manual.json")
fam = json.load(open(fam_path)) if os.path.exists(fam_path) else []
if os.path.exists(manual):
    for m_ in json.load(open(manual)):
        fam.append({"en": m_["name"], "kind": m_.get("kind", "food"), "lat": m_["lat"], "lon": m_["lon"], "desc": m_.get("desc", ""), "bndesc": m_.get("bndesc", ""), "bn": m_.get("bn")})
for f_ in fam:
    if f_.get("bn"):
        OSM_BN[f_["en"]] = f_["bn"]
    x, z = xz(f_["lat"], f_["lon"])
    o = add_extra(f_["en"], f_["kind"], x, z, {"img": f_.get("img"), "q": f_.get("q")})
    if o:
        o["f"] = 1; o["d"] = f_["desc"]; o["db"] = f_["bndesc"]
        if o["k"] != f_["kind"] and f_["kind"] in ("food", "sweets", "hotel", "wonder", "ghat", "building", "mall", "stadium", "market", "museum", "worship"):
            o["k"] = f_["kind"]
        n_f += 1
print("pois", len(pois), "wikidata merged", n_wd, "famous", n_f, "kinds", dict(sorted(__import__("collections").Counter(o["k"] for o in pois).items())))

# ---------------------------------------------------------------- metro (lines, viaducts, stations)
LINE_COL = {"blue": "#2b6cd4", "green": "#1fa05a", "purple": "#8e44ad", "orange": "#f08a24", "yellow": "#f2c230", "pink": "#e75480"}
LINE_NAME = {"blue": ("Blue Line (Line 1)", "ব্লু লাইন (১ নম্বর লাইন)"), "green": ("Green Line (Line 2)", "গ্রিন লাইন (২ নম্বর লাইন)"),
             "purple": ("Purple Line (Line 3)", "পার্পল লাইন (৩ নম্বর লাইন)"), "yellow": ("Yellow Line (Line 4)", "ইয়েলো লাইন (৪ নম্বর লাইন)"),
             "orange": ("Orange Line (Line 6)", "অরেঞ্জ লাইন (৬ নম্বর লাইন)"), "pink": ("Pink Line (Line 5)", "পিঙ্ক লাইন (৫ নম্বর লাইন)")}
lines = {}
for e in metro_rels:
    t = e.get("tags", {})
    s = (t.get("name", "") + " " + t.get("ref", "") + " " + t.get("colour", "")).lower()
    lid = next((c for c in LINE_COL if c in s), None)
    if not lid:
        lid = {"1": "blue", "2": "green", "3": "purple", "4": "yellow", "6": "orange", "5": "pink"}.get(t.get("ref", "").strip(), None)
    if not lid or lid in lines:
        continue
    segs, stops = [], []
    for m in e.get("members", []):
        if m["type"] == "way" and m.get("geometry") and m.get("role", "") == "":
            cs = [xz(p["lat"], p["lon"]) for p in m["geometry"] if p]
            tun, el = subway_way_tags.get(m["ref"], (True, False))
            for pc in lines_of(LineString(cs).intersection(WORLD)):
                segs.append({"p": flat(pc), "e": 0 if tun else (2 if el else 1)})
        elif m["type"] == "node" and m.get("role", "").startswith("stop") and "lat" in m:
            stops.append(xz(m["lat"], m["lon"]))
    if segs:
        lines[lid] = {"id": lid, "c": LINE_COL[lid], "n": LINE_NAME[lid][0], "segs": segs, "stops": stops}
        OSM_BN[LINE_NAME[lid][0]] = LINE_NAME[lid][1]
entrances = [(x, z) for n, x, z, t in stations_raw if n == "__entrance__"]
stations = []
for n, x, z, t in stations_raw:
    if n == "__entrance__":
        continue
    base = re.sub(r"\s*\((Line|Metro)[^)]*\)", "", n).replace(" Metro Station", "").replace(" Metro", "").strip()
    if t.get("name:bn"):
        OSM_BN[base] = re.sub(r"\s*\(.*?\)", "", t["name:bn"]).strip()
    lns = [lid for lid, L in lines.items() if any(math.dist((x, z), st) < 350 for st in L["stops"])]
    same = next((s for s in stations if s["n"] == base and math.dist((s["x"], s["z"]), (x, z)) < 400), None)
    if same:
        same["lines"] = sorted(set(same["lines"]) | set(lns)); continue
    stations.append({"n": base, "x": r1(x), "z": r1(z), "lines": lns})
for st in stations:
    st["ent"] = [[r1(a), r1(b)] for a, b in entrances if math.dist((a, b), (st["x"], st["z"])) < 320]
    if not st["lines"] and lines:
        best = min(lines.values(), key=lambda L: min([math.dist((st["x"], st["z"]), s) for s in L["stops"]] or [1e9]))
        if min([math.dist((st["x"], st["z"]), s) for s in best["stops"]] or [1e9]) < 600:
            st["lines"] = [best["id"]]
stations = [s for s in stations if s["lines"]]
for lid, L in lines.items():
    order = []
    for sp in L["stops"]:
        for i, st in enumerate(stations):
            if lid in st["lines"] and math.dist((st["x"], st["z"]), sp) < 400 and i not in order:
                order.append(i)
    L["stn"] = order
    del L["stops"]
rail_st, seen_r = [], set()
for n, x, z, t in rail_raw:
    if "Goods" in n or "Yard" in n or n in seen_r:
        continue
    seen_r.add(n)
    rail_st.append({"n": n, "x": r1(x), "z": r1(z)})

# ---------------------------------------------------------------- river centre line, land, ferries
center = []
if river is not None:
    prev = None
    z = Z0 + 20
    while z < Z1:
        seg = river.intersection(LineString([(X0 - 100, z), (X1 + 100, z)]))
        parts = lines_of(seg)
        if parts:
            spans = [(min(p[0][0], p[-1][0]), max(p[0][0], p[-1][0])) for p in parts]
            if prev is None:
                a, b = max(spans, key=lambda s: s[1] - s[0])
            else:
                a, b = min(spans, key=lambda s: abs((s[0] + s[1]) / 2 - prev) - (s[1] - s[0]) * 0.1)
            if b - a > 120:
                prev = (a + b) / 2
                center.append([r1(prev), r1(z), r1(b - a)])
        z += 40
land = WORLD.difference(river) if river is not None else WORLD
land_out = [poly_out(g, 1.5) for g in (land.geoms if land.geom_type == "MultiPolygon" else [land])]
river_out = [poly_out(g, 1.5) for g in ((river.geoms if river.geom_type == "MultiPolygon" else [river]) if river is not None else [])]
ferries = []
for n, cs in ferry_lines:
    for pc in lines_of(LineString(cs).intersection(WORLD)):
        if len(pc) >= 2 and math.dist(pc[0], pc[-1]) > 150:
            o = {"p": flat(pc)}
            if n:
                o["n"] = n
            ferries.append(o)

# ---------------------------------------------------------------- landmarks found by name
def orect(pg):
    pts = list(pg.exterior.coords)[:-1]
    cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - cx) ** 2 for p in pts); szz = sum((p[1] - cz) ** 2 for p in pts); sxz = sum((p[0] - cx) * (p[1] - cz) for p in pts)
    ang = 0.5 * math.atan2(2 * sxz, sxx - szz)
    ux, uz = math.cos(ang), math.sin(ang)
    A = [(p[0] - cx) * ux + (p[1] - cz) * uz for p in pts]; B = [-(p[0] - cx) * uz + (p[1] - cz) * ux for p in pts]
    ma, mb = (min(A) + max(A)) / 2, (min(B) + max(B)) / 2
    return {"cx": r1(cx + ma * ux - mb * uz), "cz": r1(cz + ma * uz + mb * ux), "ang": round(ang, 4), "len": r1(max(A) - min(A)), "wid": r1(max(B) - min(B))}


def find(patterns, kinds=None, prefer_poly=True):
    best = None
    for pat in patterns:
        rx = re.compile(pat, re.I)
        for nm, items in named_index.items():
            if not rx.search(nm):
                continue
            for it in items:
                if kinds and it[2] not in kinds:
                    continue
                score = (1 if it[4] is not None else 0) * (2 if prefer_poly else 0) + (it[4].area / 1e5 if it[4] is not None else 0)
                if best is None or score > best[0]:
                    best = (score, it, nm)
        if best:
            return best[1]
    return None


LM_FIND = {
    "dakshineswar": (["dakshineswar kali", "dakshineswar.*(temple|mandir)", "dakshineswar kali bari"], None),
    "sealdah": (["^sealdah$", "^sealdah station", "sealdah railway"], None),
    "biswabangla": (["biswa bangla gate", "kolkata gate", "biswa bangla.*gate"], None),
    "akankha": (["akankha", "aakankha"], None),
    "airport": (["netaji subhash chandra bose international airport", "netaji subhas chandra bose international", "kolkata airport"], ["aerodrome", "area", "building", "node"]),
    "dumdum": (["^dum dum junction$", "^dum dum$", "^dumdum junction$"], None),
    "belghoria": (["^belgharia$", "^belghoria", "belgharia station", "^belgharia"], None),
    "dankuni": (["^dankuni junction", "^dankuni$", "dankuni"], None),
    "hatibagan": (["hatibagan market", "^hatibagan"], None),
    "ultadanga": (["^ultadanga", "ultadanga road"], None),
    "borobazar": (["boro ?bazar", "baithakkhana", "sealdah market", "koley market"], None),
    "newtown": (["^new ?town$", "^newtown", "new town"], ["node", "area"]),
    "ecopark": (["eco park", "prakriti tirtha"], None),
    "saltlakestadium": (["salt lake stadium", "yuva bharati", "yuba bharati", "vivekananda yuba bharati krirangan"], None),
    "dakshineswar_metro": (["^dakshineswar$"], None),
}
landmarks = {}
for lid, (pats, kinds) in LM_FIND.items():
    it = find(pats, kinds)
    if it:
        x, z, kind, t, pg = it
        o = {"x": r1(x), "z": r1(z), "name": next((nm for nm, items in named_index.items() if it in items), "")}
        if pg is not None and pg.geom_type == "Polygon":
            o["rect"] = orect(pg)
        landmarks[lid] = o
        print("landmark", lid, "->", o["name"], o["x"], o["z"])
    else:
        print("landmark", lid, "NOT FOUND")
# footprints of the central landmarks (so the game can decorate them without the tile)
for lid, nm in [("writers", "writers' building"), ("stpauls", "saint paul's anglican cathedral"), ("newmarket", "kolkata new market"),
                ("station", "howrah junction"), ("museum", "indian museum"), ("nakhoda", "nakhoda mosque"), ("sealdah_bld", "sealdah")]:
    items = [i for i in named_index.get(nm, []) if i[4] is not None]
    if items:
        it = max(items, key=lambda i: i[4].area)
        landmarks[lid] = {"x": r1(it[0]), "z": r1(it[1]), "rect": orect(it[4]), "name": nm}
# river bridges to model
bridges = {}
cross = []
for o, cs in bridge_ways:
    nm = o.get("n", "")
    if river is None or not re.search(r"vidyasagar|vivekananda setu|nivedita|bally bridge|willingdon|belghoria expressway", nm, re.I):
        continue
    for pc in lines_of(LineString(cs).intersection(river)):
        if math.dist(pc[0], pc[-1]) > 150:
            cross.append((nm, pc, o["w"]))
for nm, pc, w in cross:
    if re.search("vidyasagar", nm, re.I) and "vidyasagar" not in bridges:
        bridges["vidyasagar"] = {"a": [r1(pc[0][0]), r1(pc[0][1])], "b": [r1(pc[-1][0]), r1(pc[-1][1])], "w": w}
# OSM tags both Bally bridges as "Vivekananda Setu": the upstream (northern) one is Vivekananda, the downstream one Nivedita
for nm, pc, w in cross:  # Nivedita Setu carries the Belghoria Expressway (just north of Vivekananda Setu)
    if re.search("belghoria expressway|nivedita", nm, re.I) and "nivedita" not in bridges:
        bridges["nivedita"] = {"a": [r1(pc[0][0]), r1(pc[0][1])], "b": [r1(pc[-1][0]), r1(pc[-1][1])], "w": 22}
vb = sorted([c for c in cross if re.search("vivekananda|bally|willingdon", c[0], re.I)], key=lambda c: (c[1][0][1] + c[1][-1][1]) / 2)
uniq = []
for c in vb:
    zc = (c[1][0][1] + c[1][-1][1]) / 2
    if not any(abs(zc - u) < 20 for u, _ in uniq):
        uniq.append((zc, c))
if uniq:
    bridges["vivekananda"] = {"a": [r1(uniq[0][1][1][0][0]), r1(uniq[0][1][1][0][1])], "b": [r1(uniq[0][1][1][-1][0]), r1(uniq[0][1][1][-1][1])], "w": uniq[0][1][2]}
if len(uniq) > 1 and "nivedita" not in bridges:
    bridges["nivedita"] = {"a": [r1(uniq[-1][1][1][0][0]), r1(uniq[-1][1][1][0][1])], "b": [r1(uniq[-1][1][1][-1][0]), r1(uniq[-1][1][1][-1][1])], "w": uniq[-1][1][2]}
print("bridges", bridges)
airport = {"runways": runways, "aprons": [[r1(a), r1(b)] for a, b in aprons_c[:12]],
           "terminals": [orect(pg) for pg in aero_terminals if pg.area > 2000][:4]}

# ---------------------------------------------------------------- strings: names -> strings.json
strings_path = os.path.join(dst, "strings.json")
try:
    strings = json.load(open(strings_path, encoding="utf-8"))
except (FileNotFoundError, json.JSONDecodeError):
    strings = {}
old_names = {} if RETRANSLATE else {e["en"]: e["bn"] for e in strings.get("names", []) if "en" in e}
names, name_idx = [], {}


def nid(en):
    if en not in name_idx:
        name_idx[en] = len(names)
        auto = to_bengali(en)
        old = old_names.get(en)
        names.append({"en": en, "bn": old if (old and old != auto and old != OSM_BN.get(en)) else (OSM_BN.get(en) or auto)})
    return name_idx[en]


def conv(o):
    if isinstance(o.get("n"), str) and o["n"]:
        o["n"] = nid(o["n"])
    if isinstance(o.get("st"), str) and o["st"]:
        o["st"] = nid(o["st"])
    return o


for coll in (net_roads, pois, list(lines.values()), stations, rail_st, bus, places, bstands):
    for o in coll:
        conv(o)
for lm in landmarks.values():
    if lm.get("name"):
        lm["ni"] = nid(next((it[3].get("name:en") or it[3].get("name") for it in named_index.get(lm["name"], []) if it[3].get("name")), lm["name"].title()))
        del lm["name"]
os.makedirs(os.path.join(dst, "tiles"), exist_ok=True)
for f in glob.glob(os.path.join(dst, "tiles", "*.json")):
    os.remove(f)
tile_list = []
for (tx, tz), tdata in tiles.items():
    if not (X0 - TS <= tx * TS <= X1 and Z0 - TS <= tz * TS <= Z1):
        continue
    for k in ("roads", "buildings", "parks"):
        for o in tdata.get(k, []):
            conv(o)
    tile_list.append([tx, tz, len(tdata.get("buildings", []))])
    json.dump(tdata, open(os.path.join(dst, "tiles", f"{tx}_{tz}.json"), "w"), separators=(",", ":"), ensure_ascii=False)

TYPE_BN = {}
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from build_types import TYPE_BN  # noqa
except Exception:
    pass
old_types = {} if RETRANSLATE else {k: v["bn"] for k, v in strings.get("types", {}).items()}


def type_bn(tp):
    out = []
    for p in [p.strip() for p in tp.replace(",", ";").split(";") if p.strip()]:
        k = p.lower().replace(" ", "_")
        out.append(TYPE_BN.get(k) or " ".join(word_bn(w, True) for w in k.split("_")))
    return ", ".join(out)


types = {}
for p in pois:
    if p.get("t") and p["t"] not in types:
        types[p["t"]] = {"en": p["t"].replace("_", " ").replace(";", ", "), "bn": old_types.get(p["t"]) or type_bn(p["t"])}
strings["names"] = names
strings["types"] = dict(sorted(types.items()))
json.dump(strings, open(strings_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

taxis = []
TAXI_AT = ["howrah", "sealdah", "kolkata", "dum dum junction", "santragachi", "ballygunge", "shalimar", "bidhannagar road", "esplanade", "new market", "park street", "airport"]
cand_taxi = [(x, z, n) for x, z, n in taxi_raw]
for st in rail_raw:
    if any(re.search("^" + k, st[0].lower()) for k in TAXI_AT):
        cand_taxi.append((st[1], st[2], st[0]))
for lid, lm in landmarks.items():
    if lid in ("airport", "sealdah", "biswabangla", "dakshineswar"):
        cand_taxi.append((lm["x"], lm["z"], None))
for x, z, n in cand_taxi:
    rs = roadside(x, z, 2.6, 160)
    if not rs or any(math.hypot(t_["x"] - rs[0], t_["z"] - rs[1]) < 80 for t_ in taxis) or in_building(rs[0], rs[1]) or in_river(rs[0], rs[1]):
        continue
    taxis.append({"x": r1(rs[0]), "z": r1(rs[1]), "a": round(rs[2], 3)})
print("taxi stands", len(taxis))
airport["stands"] = park_pos

region = {
    "meta": {"lat0": LAT0, "lon0": LON0, "kx": KX, "kz": KZ, "bounds": [r1(X0), r1(Z0), r1(X1), r1(Z1)], "tile": TS,
             "attribution": "Map data (c) OpenStreetMap contributors, ODbL"},
    "tiles": tile_list, "land": [l for l in land_out if l], "river": [r for r in river_out if r], "center": center,
    "roads": net_roads, "pois": pois, "places": places, "bus": bus, "signals": signals,
    "transit": {"metro": list(lines.values()), "stations": stations, "rail": rail_st},
    "landmarks": landmarks, "bridges": bridges, "ferries": ferries, "airport": airport,
    "bstands": bstands, "taxis": taxis, "railnet": railnet, "platforms": platforms,
}
json.dump(region, open(os.path.join(dst, "region.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print("tiles", len(tile_list), "net roads", len(net_roads), "pois", len(pois), "places", len(places), "bus", len(bus),
      "signals", len(signals), "stations", len(stations), "rail", len(rail_st), "lines", {k: len(v["segs"]) for k, v in lines.items()},
      "names", len(names), "errors", stats["errors"], "region.json MB", round(os.path.getsize(os.path.join(dst, "region.json")) / 1e6, 2))
