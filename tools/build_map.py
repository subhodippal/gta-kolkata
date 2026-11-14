#!/usr/bin/env python3
"""
Converts raw OpenStreetMap Overpass JSON (central Kolkata) into a compact game map.

  python3 tools/build_map.py <osm_raw_dir> data/kolkata.json [--retranslate]

All human-readable names (roads, shops, buildings, parks, POI types) are moved to
data/strings.json -> "names" / "types" as {"en": ..., "bn": ...}; the map file only
stores an index into "names". Hand-made Bengali corrections in strings.json are kept
on rebuild unless --retranslate is passed.

Coordinates: local metres. x = east, z = south (three.js convention, -z = north).
Origin = LAT0/LON0 (near Esplanade / Shaheed Minar).
Data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, sys, os, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bengali import to_bengali, word_bn, phonetic
from shapely.geometry import Polygon, LineString, Point, box, MultiPolygon


def clip_line(cs, area):
    """clip a polyline to the world box; returns list of coordinate lists"""
    if len(cs) < 2:
        return []
    g = LineString(cs).intersection(area)
    if g.is_empty:
        return []
    parts = [g] if g.geom_type == "LineString" else [x for x in getattr(g, "geoms", []) if x.geom_type == "LineString"]
    return [list(p.coords) for p in parts if len(p.coords) >= 2]
from shapely.ops import polygonize, unary_union, linemerge

LAT0, LON0 = 22.565, 88.349
BBOX = (22.538, 88.332, 22.592, 88.366)  # s, w, n, e
KX = 111320.0 * math.cos(math.radians(LAT0))
KZ = 110574.0


def xz(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KZ)


def r1(v):
    return round(v, 1)


def flat(coords):
    out = []
    for x, z in coords:
        out += [r1(x), r1(z)]
    return out


def hsh(i):
    return zlib.crc32(str(i).encode()) & 0xffffffff


src = sys.argv[1]
dst = sys.argv[2]
elements = {}
for fn in ("kol.json", "kol2.json", "kol3.json"):
    p = os.path.join(src, fn)
    if os.path.exists(p):
        for e in json.load(open(p))["elements"]:
            elements[(e["type"], e["id"])] = e
elements = list(elements.values())

S, W, N, E = BBOX
x0, z1 = xz(S, W)
x1, z0 = xz(N, E)
WORLD = box(x0, z0, x1, z1)


def way_coords(e):
    return [xz(p["lat"], p["lon"]) for p in e.get("geometry", []) if p]


OSM_BN = {}


def name_of(t):
    n = t.get("name:en") or t.get("name") or ""
    if n and t.get("name:bn") and n not in OSM_BN:
        OSM_BN[n] = t["name:bn"]
    return n


def rel_polys(e):
    outers, inners = [], []
    for m in e.get("members", []):
        g = m.get("geometry")
        if not g or m.get("type") != "way":
            continue
        cs = [xz(p["lat"], p["lon"]) for p in g if p]
        if len(cs) < 2:
            continue
        (outers if m.get("role") != "inner" else inners).append(LineString(cs))
    polys = list(polygonize(linemerge(outers) if outers else []))
    holes = list(polygonize(linemerge(inners) if inners else []))
    if not polys:
        return []
    shape = unary_union(polys)
    if holes:
        shape = shape.difference(unary_union(holes))
    return [shape] if shape.geom_type == "Polygon" else list(getattr(shape, "geoms", []))


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


# ---------------------------------------------------------------- roads
ROAD_W = {"motorway": 16, "trunk": 16, "primary": 13, "secondary": 11, "tertiary": 8.5,
          "motorway_link": 7, "trunk_link": 7, "primary_link": 7, "secondary_link": 7, "tertiary_link": 6,
          "residential": 6, "living_street": 5, "unclassified": 6, "service": 4, "busway": 7,
          "pedestrian": 5, "footway": 2.2, "path": 2, "steps": 2.2, "track": 3, "cycleway": 2}
ROAD_K = {k: i for i, k in enumerate(["motorway", "trunk", "primary", "secondary", "tertiary", "link",
                                      "residential", "service", "foot", "track"])}


def road_kind(h):
    if h.endswith("_link"):
        return "link"
    if h in ("living_street", "unclassified", "residential", "busway"):
        return "residential"
    if h in ("footway", "path", "steps", "pedestrian", "cycleway"):
        return "foot"
    return h if h in ROAD_K else None


roads = []
named_segments = []
for e in elements:
    t = e.get("tags", {})
    h = t.get("highway")
    if e["type"] != "way" or not h or h not in ROAD_W:
        continue
    if t.get("area") == "yes":
        continue
    cs = way_coords(e)
    if len(cs) < 2:
        continue
    k = road_kind(h)
    if not k:
        continue
    w = ROAD_W[h]
    try:
        lanes = int(t.get("lanes", "0"))
        if lanes and k not in ("foot",):
            w = max(w, min(lanes * 3.2, 22))
    except ValueError:
        pass
    pieces = clip_line(cs, WORLD)
    if not pieces:
        continue
    o = {"k": ROAD_K[k], "w": w, "p": flat(pieces[0])}
    n = name_of(t)
    if n:
        o["n"] = n
    if t.get("bridge") in ("yes", "viaduct"):
        o["br"] = 1
        try:
            o["ly"] = int(t.get("layer", "1"))
        except ValueError:
            o["ly"] = 1
    if t.get("oneway") == "yes":
        o["ow"] = 1
    if t.get("tunnel") == "yes":
        continue
    for pc in pieces:
        oo = dict(o); oo["p"] = flat(pc)
        roads.append(oo)
        if n:
            for a, b in zip(pc, pc[1:]):
                named_segments.append((a, b, n, ROAD_K[k]))

# ---------------------------------------------------------------- river / land
river = None
for e in elements:
    t = e.get("tags", {})
    if e["type"] == "relation" and t.get("name") == "Hooghly":
        polys = rel_polys(e)
        river = unary_union(polys).intersection(WORLD.buffer(50))
land = WORLD.difference(river) if river is not None else WORLD
land_out = [poly_out(g, 1.0) for g in (land.geoms if land.geom_type == "MultiPolygon" else [land])]
land_out = [l for l in land_out if l]
river_out = []
if river is not None:
    for g in (river.geoms if river.geom_type == "MultiPolygon" else [river]):
        p = poly_out(g, 1.0)
        if p:
            river_out.append(p)

# ---------------------------------------------------------------- areas
parks, water, buildings = [], [], []
SPECIAL = {
    "Writers' Building": "writers", "Howrah Junction": "redbrick", "Kolkata New market": "redbrick",
    "Nakhoda Mosque": "nakhoda", "Indian Museum": "museum", "Raj Bhavan": "white",
    "Saint Paul's Anglican Cathedral": "cathedral", "Calcutta Town Hall": "white",
    "Victoria Memorial": "skip", "Eden Gardens": "skip", "Howrah Metro": "glass",
    "Netaji Indoor Stadium": "stadium", "RBI Museum": "white", "Emami Market": "glass",
}
seen_bld = set()


def add_building(pg, t, eid):
    if pg.area < 6 or pg.area > 120000:
        return
    n = name_of(t)
    sp = SPECIAL.get(n)
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
            ht = float(t["building:levels"]) * 3.4 + 1
    except ValueError:
        ht = None
    if ht is None:
        b = t.get("building", "yes")
        r = hsh(eid)
        lv_choices = [2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7, 8]
        lv = lv_choices[r % len(lv_choices)]
        if b in ("house", "hut", "shed", "roof", "garage", "kiosk"):
            lv = 1 + r % 2
        elif b in ("apartments", "commercial", "office", "hotel"):
            lv = 5 + r % 8
        elif b in ("train_station", "retail", "church", "mosque", "temple", "public"):
            lv = 3
        if pg.area < 40:
            lv = 1
        elif pg.area < 90:
            lv = min(lv, 3)
        ht = lv * 3.4 + 0.6
    ht = max(3, min(ht, 160))
    o["ht"] = round(ht, 1)
    if n:
        o["n"] = n
    if sp:
        o["s"] = sp
    b = t.get("building", "yes")
    if b not in ("yes",):
        o["b"] = b
    if t.get("amenity") == "place_of_worship":
        o["rel"] = t.get("religion", "")
    buildings.append(o)


for e in elements:
    t = e.get("tags", {})
    key = (e["type"], e["id"])
    if e["type"] == "way":
        cs = way_coords(e)
        if len(cs) < 4 or cs[0] != cs[-1]:
            # closed check (allow tiny gaps)
            if len(cs) < 4 or math.dist(cs[0], cs[-1]) > 0.5:
                continue
        try:
            pg = Polygon(cs).buffer(0)
        except Exception:
            continue
        if pg.is_empty:
            continue
        pgs = [pg] if pg.geom_type == "Polygon" else list(pg.geoms)
    elif e["type"] == "relation" and t.get("type") == "multipolygon":
        pgs = rel_polys(e)
    else:
        continue
    for pg in pgs:
        pg = pg.intersection(WORLD)
        if pg.is_empty or pg.geom_type != "Polygon":
            continue
        if "building" in t and t.get("building") != "no":
            add_building(pg, t, e["id"])
        elif t.get("natural") == "water" and t.get("water") != "river":
            o = poly_out(pg)
            if o:
                water.append(o)
        elif t.get("leisure") in ("park", "garden", "golf_course", "pitch", "stadium") or \
                t.get("landuse") in ("grass", "recreation_ground", "forest", "meadow"):
            o = poly_out(pg, 0.8)
            if o:
                lk = t.get("leisure") or t.get("landuse")
                o["k"] = {"pitch": 1, "golf_course": 2, "forest": 3, "stadium": 1}.get(lk, 0)
                n = name_of(t)
                if n:
                    o["n"] = n
                parks.append(o)

# ---------------------------------------------------------------- rails
rails = []
for e in elements:
    t = e.get("tags", {})
    if e["type"] == "way" and t.get("railway") in ("rail", "tram"):
        cs = way_coords(e)
        if len(cs) >= 2 and t.get("tunnel") != "yes":
            for pc in clip_line(cs, WORLD):
                o = {"k": 1 if t["railway"] == "tram" else 0, "p": flat(pc)}
                if t.get("bridge") == "yes":
                    o["br"] = 1
                rails.append(o)

# ---------------------------------------------------------------- POIs
GRID = 60.0
seg_grid = {}
for s in named_segments:
    (ax, az), (bx, bz) = s[0], s[1]
    for gx in range(int(min(ax, bx) // GRID) - 1, int(max(ax, bx) // GRID) + 2):
        for gz in range(int(min(az, bz) // GRID) - 1, int(max(az, bz) // GRID) + 2):
            seg_grid.setdefault((gx, gz), []).append(s)


def nearest_street(x, z):
    best, bd = "", 1e9
    for s in seg_grid.get((int(x // GRID), int(z // GRID)), []):
        (ax, az), (bx, bz) = s[0], s[1]
        dx, dz = bx - ax, bz - az
        L = dx * dx + dz * dz or 1
        u = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L))
        d = math.hypot(ax + u * dx - x, az + u * dz - z) - (6 - s[3]) * 2  # prefer major roads slightly
        if d < bd:
            bd, best = d, s[2]
    return best


pois = []
seen_poi = set()
for e in elements:
    t = e.get("tags", {})
    n = name_of(t)
    if not n:
        continue
    kind = None
    a = t.get("amenity")
    if a in ("fuel",):
        kind = "fuel"
    elif a in ("restaurant", "fast_food", "cafe"):
        kind = "food"
    elif a in ("bank", "atm"):
        kind = "bank"
    elif a in ("hospital", "pharmacy"):
        kind = "health"
    elif a == "cinema":
        kind = "cinema"
    elif a == "police":
        kind = "police"
    elif a == "place_of_worship":
        kind = "worship"
    elif "shop" in t:
        kind = "shop"
    elif t.get("tourism") in ("hotel", "guest_house", "hostel"):
        kind = "hotel"
    elif t.get("tourism") in ("attraction", "museum", "artwork", "viewpoint"):
        kind = "sight"
    elif t.get("historic") == "monument":
        kind = "sight"
    elif a in ("school", "college", "university", "library", "language_school"):
        kind = "edu"
    elif a in ("theatre", "arts_centre"):
        kind = "cinema"
    elif a == "marketplace":
        kind = "shop"
    elif "office" in t or a in ("embassy", "townhall", "courthouse", "post_office"):
        kind = "office"
    elif "historic" in t or t.get("leisure") in ("park", "garden", "sports_centre", "stadium"):
        kind = "sight"
    elif t.get("railway") in ("station", "subway_entrance") or t.get("amenity") in ("ferry_terminal", "bus_station"):
        continue  # handled as transit below
    elif t.get("railway") == "station" or t.get("amenity") == "ferry_terminal":
        kind = "transport"
    if not kind:
        continue
    if e["type"] == "node":
        x, z = xz(e["lat"], e["lon"])
    else:
        cs = way_coords(e) or [xz(p["lat"], p["lon"]) for m in e.get("members", []) for p in (m.get("geometry") or [])]
        if not cs:
            continue
        x = sum(c[0] for c in cs) / len(cs)
        z = sum(c[1] for c in cs) / len(cs)
    if not WORLD.contains(Point(x, z)):
        continue
    k2 = (n, round(x / 30), round(z / 30))
    if k2 in seen_poi:
        continue
    seen_poi.add(k2)
    o = {"n": n, "k": kind, "x": r1(x), "z": r1(z)}
    st = t.get("addr:street") or nearest_street(x, z)
    if st:
        o["st"] = st
    sub = t.get("shop") or t.get("cuisine") or t.get("amenity") or t.get("tourism") or ""
    if sub:
        o["t"] = sub
    if t.get("brand"):
        o["br"] = t["brand"]
    pois.append(o)

# ---------------------------------------------------------------- land use (ground colour)
LU_KIND = {"residential": 0, "commercial": 1, "retail": 1, "industrial": 2, "railway": 3, "military": 4, "construction": 2,
           "religious": 1, "education": 0, "institutional": 1}
landuse = []
for e in elements:
    t = e.get("tags", {})
    lu = t.get("landuse")
    if e["type"] != "way" or lu not in LU_KIND:
        continue
    cs = way_coords(e)
    if len(cs) < 4:
        continue
    try:
        pg = Polygon(cs).buffer(0).intersection(WORLD)
    except Exception:
        continue
    for g in ([pg] if pg.geom_type == "Polygon" else list(getattr(pg, "geoms", []))):
        if g.geom_type == "Polygon" and g.area > 200:
            o = poly_out(g, 1.0)
            if o:
                o["k"] = LU_KIND[lu]
                landuse.append(o)

# ---------------------------------------------------------------- transit: metro, rail stations, buses, signals
def node_xy(e):
    if e["type"] == "node":
        return xz(e["lat"], e["lon"])
    cs = way_coords(e)
    return (sum(c[0] for c in cs) / len(cs), sum(c[1] for c in cs) / len(cs)) if cs else None


LINE_STYLE = {"blue": ("#2b6cd4", "Blue Line (Line 1)", "ব্লু লাইন (১ নম্বর লাইন)"),
              "green": ("#1fa05a", "Green Line (Line 2)", "গ্রিন লাইন (২ নম্বর লাইন)"),
              "purple": ("#8e44ad", "Purple Line (Line 3) — under construction", "পার্পল লাইন (৩ নম্বর লাইন) — নির্মাণাধীন")}
metro_lines = {}
for e in elements:
    t = e.get("tags", {})
    if e["type"] != "relation" or t.get("route") != "subway":
        continue
    lid = "blue" if "blue" in (t.get("name", "") + t.get("ref", "") + t.get("colour", "")).lower() or t.get("colour") == "#0000ff" else "green"
    if lid in metro_lines:
        continue  # one direction is enough
    segs, stops = [], []
    for m in e.get("members", []):
        if m["type"] == "way" and m.get("role", "") in ("",) and m.get("geometry"):
            for pc in clip_line([xz(p["lat"], p["lon"]) for p in m["geometry"] if p], WORLD.buffer(-5)):
                segs.append(flat(pc))
        elif m["type"] == "node" and m.get("role", "").startswith("stop") and "lat" in m:
            stops.append(xz(m["lat"], m["lon"]))
    metro_lines[lid] = {"id": lid, "c": LINE_STYLE[lid][0], "n": LINE_STYLE[lid][1], "segs": segs, "stops": stops}
    OSM_BN[LINE_STYLE[lid][1]] = LINE_STYLE[lid][2]
# line 3 (under construction)
segs3 = []
for e in elements:
    t = e.get("tags", {})
    if e["type"] == "way" and t.get("railway") == "construction" and "metro" in (t.get("name", "") + t.get("construction", "")).lower():
        for pc in clip_line(way_coords(e), WORLD.buffer(-5)):
            segs3.append(flat(pc))
if segs3:
    metro_lines["purple"] = {"id": "purple", "c": LINE_STYLE["purple"][0], "n": LINE_STYLE["purple"][1], "segs": segs3, "stops": [], "uc": 1}
    OSM_BN[LINE_STYLE["purple"][1]] = LINE_STYLE["purple"][2]

stations, rail_stations = [], []
entrances = [node_xy(e) for e in elements if e.get("tags", {}).get("railway") == "subway_entrance"]
import re as _re
for e in elements:
    t = e.get("tags", {})
    if t.get("railway") != "station" and t.get("station") != "subway":
        continue
    xy = node_xy(e)
    if not xy or not WORLD.contains(Point(*xy)):
        continue
    n = name_of(t)
    if t.get("station") == "subway" or t.get("subway") == "yes":
        base = _re.sub(r"\s*\(Line \d\)", "", n).strip()
        if t.get("name:bn"):
            OSM_BN[base] = t["name:bn"]
        lines = [lid for lid, L in metro_lines.items() if any(math.dist(xy, st) < 350 for st in L["stops"])]
        same = next((st for st in stations if st["n"] == base and math.dist((st["x"], st["z"]), xy) < 300), None)
        if same:
            same["lines"] = sorted(set(same["lines"]) | set(lines))
            continue
        stations.append({"n": base, "x": r1(xy[0]), "z": r1(xy[1]), "lines": lines})
    elif t.get("railway") == "station" and "Goods" not in n:
        rail_stations.append({"n": n, "x": r1(xy[0]), "z": r1(xy[1]), "cr": 0 if n == "Howrah Junction" else 1})
for st in stations:
    st["ent"] = [[r1(a), r1(b)] for a, b in entrances if math.dist((a, b), (st["x"], st["z"])) < 320]
    if not st["lines"]:
        best = min(metro_lines.values(), key=lambda L: min([math.dist((st["x"], st["z"]), s) for s in L["stops"]] or [1e9]))
        st["lines"] = [best["id"]]
# order stations along each line by stop order
for lid, L in metro_lines.items():
    order = []
    for sp in L["stops"]:
        for i, st in enumerate(stations):
            if lid in st["lines"] and math.dist((st["x"], st["z"]), sp) < 350 and i not in order:
                order.append(i)
    L["stn"] = order
    del L["stops"]

bus_stops = []
for e in elements:
    t = e.get("tags", {})
    if t.get("highway") == "bus_stop" or t.get("amenity") == "bus_station" or (t.get("public_transport") == "platform" and t.get("bus") == "yes"):
        xy = node_xy(e)
        if xy and WORLD.contains(Point(*xy)) and not any(math.dist(xy, (b["x"], b["z"])) < 25 for b in bus_stops):
            o = {"x": r1(xy[0]), "z": r1(xy[1])}
            if name_of(t):
                o["n"] = name_of(t)
            bus_stops.append(o)
signals = [[r1(c) for c in node_xy(e)] for e in elements if e.get("tags", {}).get("highway") == "traffic_signals" and e["type"] == "node"]
crossings = [[r1(c) for c in node_xy(e)] for e in elements if e.get("tags", {}).get("highway") == "crossing" and e["type"] == "node"]
trees = [[r1(c) for c in node_xy(e)] for e in elements if e.get("tags", {}).get("natural") == "tree" and e["type"] == "node"]
transit = {"metro": list(metro_lines.values()), "stations": stations, "rail": rail_stations, "bus": bus_stops}

# ---------------------------------------------------------------- strings (names -> strings.json)
TYPE_BN = {
    "restaurant": "রেস্তোরাঁ", "fast_food": "ফাস্ট ফুড", "cafe": "ক্যাফে", "bank": "ব্যাংক", "atm": "এটিএম", "hospital": "হাসপাতাল",
    "pharmacy": "ওষুধের দোকান", "hotel": "হোটেল", "guest_house": "অতিথিশালা", "hostel": "হোস্টেল", "place_of_worship": "উপাসনালয়",
    "police": "থানা", "cinema": "সিনেমা হল", "fuel": "পেট্রোল পাম্প", "attraction": "দর্শনীয় স্থান", "museum": "জাদুঘর",
    "artwork": "শিল্পকর্ম", "information": "তথ্যকেন্দ্র", "viewpoint": "দৃশ্যস্থল", "station": "স্টেশন", "ferry_terminal": "ফেরিঘাট",
    "blood_bank": "ব্লাড ব্যাংক", "clothes": "পোশাকের দোকান", "confectionery": "মিষ্টির দোকান", "books": "বইয়ের দোকান",
    "jewelry": "গয়নার দোকান", "electronics": "ইলেকট্রনিক্স", "computer": "কম্পিউটারের দোকান", "mobile_phone": "মোবাইলের দোকান",
    "supermarket": "সুপারমার্কেট", "ticket": "টিকিট কাউন্টার", "car": "গাড়ির শোরুম", "beauty": "বিউটি পার্লার", "optician": "চশমার দোকান",
    "convenience": "মুদির দোকান", "bakery": "বেকারি", "shoes": "জুতোর দোকান", "sweets": "মিষ্টির দোকান", "hairdresser": "সেলুন",
    "department_store": "ডিপার্টমেন্ট স্টোর", "mall": "শপিং মল", "gift": "উপহারের দোকান", "tailor": "দর্জি", "furniture": "আসবাবের দোকান",
    "hardware": "হার্ডওয়্যার", "stationery": "স্টেশনারি", "bag": "ব্যাগের দোকান", "watches": "ঘড়ির দোকান", "travel_agency": "ট্রাভেল এজেন্সি",
    "chemist": "কেমিস্ট", "music": "গানের দোকান", "variety_store": "ভ্যারাইটি স্টোর", "boutique": "বুটিক", "tea": "চায়ের দোকান",
    "coffee": "কফি", "kiosk": "গুমটি", "laundry": "লন্ড্রি", "copyshop": "জেরক্সের দোকান", "photo": "ফটো স্টুডিও", "art": "শিল্প",
    "indian": "ভারতীয়", "chinese": "চাইনিজ", "bengali": "বাঙালি", "regional": "আঞ্চলিক", "pizza": "পিৎজা", "burger": "বার্গার",
    "mughlai": "মোগলাই", "biryani": "বিরিয়ানি", "italian": "ইতালীয়", "continental": "কন্টিনেন্টাল", "north_indian": "উত্তর ভারতীয়",
    "south_indian": "দক্ষিণ ভারতীয়", "vegetarian": "নিরামিষ", "ice_cream": "আইসক্রিম", "sandwich": "স্যান্ডউইচ", "chicken": "চিকেন",
    "thai": "থাই", "japanese": "জাপানি", "tibetan": "তিব্বতি", "momo": "মোমো", "kebab": "কাবাব", "seafood": "সামুদ্রিক খাবার",
    "american": "আমেরিকান", "mexican": "মেক্সিকান", "asian": "এশীয়", "international": "আন্তর্জাতিক", "street_food": "রাস্তার খাবার",
    "fish": "মাছ", "cake": "কেক", "dessert": "ডেজার্ট", "juice": "জুস", "breakfast": "প্রাতরাশ", "rolls": "রোল", "roll": "রোল",
}


def type_bn(t):
    parts = [p.strip() for p in t.replace(",", ";").split(";") if p.strip()]
    out = []
    for p in parts:
        k = p.lower().replace(" ", "_")
        out.append(TYPE_BN.get(k) or " ".join(word_bn(w, True) for w in k.split("_")))
    return ", ".join(out)


strings_path = os.path.join(os.path.dirname(os.path.abspath(dst)), "strings.json")
retranslate = "--retranslate" in sys.argv
try:
    strings = json.load(open(strings_path, encoding="utf-8"))
except (FileNotFoundError, json.JSONDecodeError):
    strings = {}
old_names = {} if retranslate else {e["en"]: e["bn"] for e in strings.get("names", []) if "en" in e}
old_types = {} if retranslate else {k: v["bn"] for k, v in strings.get("types", {}).items()}

names, name_idx = [], {}


def nid(en):
    if en not in name_idx:
        name_idx[en] = len(names)
        auto = to_bengali(en)
        old = old_names.get(en)
        # a hand edit (differs from the automatic result) always wins; then official OSM name:bn; then automatic
        names.append({"en": en, "bn": old if (old and old != auto and old != OSM_BN.get(en)) else (OSM_BN.get(en) or auto)})
    return name_idx[en]


for coll in (roads, buildings, parks, pois, transit["metro"], stations, rail_stations, bus_stops):
    for o in coll:
        if o.get("n"):
            o["n"] = nid(o["n"])
        if o.get("st"):
            o["st"] = nid(o["st"])
types = {}
for p in pois:
    if p.get("t") and p["t"] not in types:
        types[p["t"]] = {"en": p["t"].replace("_", " ").replace(";", ", "), "bn": old_types.get(p["t"]) or type_bn(p["t"])}
strings["names"] = names
strings["types"] = dict(sorted(types.items()))
json.dump(strings, open(strings_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

out = {
    "meta": {"lat0": LAT0, "lon0": LON0, "kx": KX, "kz": KZ, "bounds": [r1(x0), r1(z0), r1(x1), r1(z1)],
             "attribution": "Map data (c) OpenStreetMap contributors, ODbL", "names": "strings.json"},
    "land": land_out, "river": river_out, "roads": roads, "buildings": buildings,
    "parks": parks, "water": water, "rails": rails, "pois": pois,
    "landuse": landuse, "transit": transit, "signals": signals, "crossings": crossings, "trees": trees,
}
json.dump(out, open(dst, "w"), separators=(",", ":"), ensure_ascii=False)
print("roads", len(roads), "buildings", len(buildings), "parks", len(parks), "water", len(water),
      "rails", len(rails), "pois", len(pois), "land", len(land_out), "river", len(river_out),
      "stations", len(stations), "metro", [(L["id"], len(L["segs"]), len(L["stn"])) for L in transit["metro"]],
      "bus", len(bus_stops), "signals", len(signals), "landuse", len(landuse), "names", len(names), "types", len(types), "bytes", os.path.getsize(dst))
