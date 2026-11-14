"""Fetch notable places (with coordinates, en/bn labels, type, photo, description) inside the game region from Wikidata.
Wikidata is CC0; photos are on Wikimedia Commons (free licences, credited in-game).  Output: osm_raw/wikidata.json"""
import json, sys, time, urllib.parse, urllib.request

S, W, N, E = 22.535, 88.280, 22.700, 88.490
Q = """SELECT ?item ?en ?bn ?coord ?img ?typeLabel ?desc ?bndesc WHERE {
  SERVICE wikibase:box { ?item wdt:P625 ?coord . bd:serviceParam wikibase:cornerSouthWest "Point(%f %f)"^^geo:wktLiteral .
                                                   bd:serviceParam wikibase:cornerNorthEast "Point(%f %f)"^^geo:wktLiteral . }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?bn FILTER(LANG(?bn) = "bn") }
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeLabel FILTER(LANG(?typeLabel) = "en") }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?item schema:description ?bndesc FILTER(LANG(?bndesc) = "bn") }
}""" % (W, S, E, N)
out = sys.argv[1] if len(sys.argv) > 1 else "osm_raw/wikidata.json"
req = urllib.request.Request("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(Q),
                             headers={"User-Agent": "KolkataCity3D-builder/1.0 (open-source game map builder)", "Accept": "application/sparql-results+json"})
for attempt in range(4):
    try:
        data = json.load(urllib.request.urlopen(req, timeout=180)); break
    except Exception as ex:
        print("retry", ex); time.sleep(10)
items = {}
for b in data["results"]["bindings"]:
    qid = b["item"]["value"].rsplit("/", 1)[1]
    it = items.setdefault(qid, {"q": qid, "types": []})
    lon, lat = map(float, b["coord"]["value"][6:-1].split())
    it["lat"], it["lon"] = lat, lon
    for k, src in (("en", "en"), ("bn", "bn"), ("desc", "desc"), ("bndesc", "bndesc")):
        if src in b: it[k] = b[src]["value"]
    if "img" in b: it["img"] = urllib.parse.unquote(b["img"]["value"].rsplit("/", 1)[1])
    if "typeLabel" in b and b["typeLabel"]["value"] not in it["types"]: it["types"].append(b["typeLabel"]["value"])
json.dump(list(items.values()), open(out, "w"), ensure_ascii=False)
print("items", len(items), "with photo", sum(1 for i in items.values() if "img" in i), "with bn", sum(1 for i in items.values() if "bn" in i))
