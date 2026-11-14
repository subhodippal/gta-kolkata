# Kolkata City 3D

An open-world 3D browser game set in the real streets of central Kolkata. Runs on GitHub Pages, works in a laptop browser, and supports mobile in landscape mode.

## The map: Greater Kolkata (≈ 390 km², real OpenStreetMap data)

The world runs from **Dankuni** and **Dakshineswar** in the north-west to the **Airport**, **New Town** and **Biswa Bangla Gate** in the east, and south to **Victoria Memorial**. It includes Sealdah, Sealdah Boro Bazar, Hatibagan, Ultadanga, Dum Dum, Belghoria, Salt Lake, Howrah and Esplanade.

* **About 300,000 real building footprints, 48,000 streets and thousands of named places**, streamed in **1 km tiles** around you. Only nearby tiles are built in 3D; view mode loads further out. The main road network, the river, the metro and the landmarks cover the whole region all the time.
* **Every road** keeps its real class, width and lanes, from the expressways and VIP Road down to narrow lanes and footpaths. **Two-way roads** have centre lines (double yellow on main roads, dashed white on smaller ones) and lane dividers. **One-way roads** have lane lines and painted direction arrows. Big roads have edge lines. Flyovers sit on pillars, and roundabouts are kept.
* **Hand-modelled landmarks:**
  * Howrah Bridge, Victoria Memorial, Shaheed Minar, Eden Gardens
  * **Dakshineswar Kali Temple** (nine spires, twelve Shiva temples)
  * **Vidyasagar Setu** (cable-stayed), **Nivedita Setu**, **Vivekananda Setu** (steel arches)
  * **Biswa Bangla Gate**, **Akankha More**, **Salt Lake Stadium**
  * **the Airport** (planes on the apron, one taking off and landing)
  * **Sealdah station**, Writers' Building, St Paul's, New Market, Howrah Station, GPO, Nakhoda Masjid
* **On the Ganga (Hooghly):**
  * Ferry launches cross on the real OSM ferry routes, stopping at the ghats.
  * Big cargo barges and cruise steamers, and wooden country boats (nouka) with their boatmen, move slowly up and down the river on its real centre line, rocking gently on the water.
* **Metro:** all real lines from OSM (Blue, Green, Purple, Orange, Yellow where mapped). Underground parts are dashed on the map. **Elevated sections are built in 3D on viaducts with trains running on them** (towards Dum Dum and Dakshineswar, Salt Lake and Sector V, New Town and the Airport).

## Language: Bengali (বাংলা) by default

The whole game is in **Bengali**: menus, the HUD, road and shop names, landmark histories, menus in restaurants and what people say. Press **L** or use the English/বাংলা button to switch to English at any time.

| File | What's in it |
|---|---|
| `data/strings.json` | **All on-screen text.** `ui` (menus, buttons, help), `kinds`, `districts`, `landmarks` (name/kind/history), `famous` (Peter Cat, Flurys…), `menus`, plus the generated **`names`** (1,233 road, shop, building and park names as `{en, bn}`) and **`types`** (shop and cuisine types). |
| `data/comment.json` | **All spoken (audio) lines:** the welcome, what people say, what they shout when hit, shopkeeper greetings, landmark introductions, travel announcements. They're shown on screen and **read aloud** with the browser's voice (`bn-IN`). Toggle the voice with **N** or 🔊. |

Bengali names come from OpenStreetMap's official `name:bn` where it exists. The rest are produced by `tools/bengali.py`, which uses a dictionary of about 1,200 words (রোড, সরণি, থানা, বসু, মুখোপাধ্যায়…) plus phonetic rules. To correct a name, edit its `bn` value in `data/strings.json`; rebuilding the map keeps your edits.

The Bengali voice needs a browser with Bengali speech: Chrome on Android, Edge on Windows, or Google Chrome with Google voices. If there isn't one, the lines are still shown as text.

## View mode: fly over the city (V)

Press **V** in the game, or **শহর দেখুন / EXPLORE** on the title screen, to fly freely over all of Kolkata like a drone or a map app.

* **Mouse:** drag to move, right-drag to rotate and tilt, scroll to zoom in or out toward the cursor (from street level up to about 4 km), double-click to zoom into a spot
* **Keyboard:** W A S D to fly, Q / E to rotate, R / F to tilt, Z / X to zoom, Shift to go faster
* **Touch:** one finger to move, two fingers to pinch-zoom and rotate, tap for info
* **Hover** over anything to see its name: building, shop, road, park or landmark
* **Click** to open an info card; **এখানে যান / Go here** drops your character at that spot
* **Floating labels** show landmarks, shops and main roads (toggle them with **নাম দেখান / Show labels**)
* **Fly to a famous place:** a list that flies you to Howrah Bridge, Victoria Memorial, Eden Gardens and the others, with a spoken introduction

## Map, search & directions (M or /)

**Why not Google Maps or MapmyIndia?**
* **Google Maps Platform** needs an API key with a billing account. Its terms don't allow using its map data to build your own 3D world, and you can't search it offline.
* **Mappls (MapmyIndia)** has a free tier, but it also needs a key and has similar restrictions.
* **OpenStreetMap** is free and open (ODbL), and the whole city in this game is already built from it.

So search and routing run **offline on the game's own OSM data**: no key, no cost, no rate limits. There's also an optional 🌐 online search through OSM **Nominatim** (free, limited to the map area, used only when you press 🌐).

* **Interactive map:**
  * Zoom from the whole city down to street level: wheel or pinch, ＋ / －.
  * Every street is drawn in its real width and class: main and secondary roads, lanes, service roads and footpaths. Flyovers, rail lines, buildings, parks and land use are drawn too.
  * Road names appear along the roads.
  * Layers: Ⓜ metro lines and stations (with moving trains), 🚌 bus stops, 🛍 places.
* **Search** in Bengali or English: roads, shops, landmarks, metro and rail stations, bus stops, buildings, parks and areas. It tolerates spelling variants (স্ট্রীট / স্ট্রিট, small English typos).
* **Click anywhere** to drop a pin, then choose **🧭 Directions** (পথ দেখান) or **⚡ Go there** (সেখানে যান).
* **Turn-by-turn navigation:**
  * A walking route (A*) on the real street network.
  * A glowing GPS path on the ground, a beacon at the destination, and the route on the minimap.
  * Instructions such as "৫৫ মি পর ডানদিকে ঘুরুন — হুমায়ুন প্লেস", spoken in Bengali.
  * Automatic re-routing if you leave the path.

## Kolkata Metro (real OSM data)

* **Blue Line (Line 1):** Rabindra Sadan → Maidan → Park Street → Esplanade → Chandni Chowk → Central → M.G. Road → Girish Park, following the real underground route.
* **Green Line (Line 2):** Howrah Maidan → Howrah → Mahakaran → Esplanade, running **under the Hooghly** (the real tunnel route).
* **Purple Line (Line 3):** shown dashed, under construction.
* **Entrances:** 36 real station entrances with the Ⓜ sign. Press **E** at one to ride: pick a station, listen to announcements ("পরবর্তী স্টেশন মহাকরণ। দরজা বাঁদিকে খুলবে।"), and change lines at Esplanade.
* **Trains** run on the lines. You can see them on the map, and in view mode as a see-through "underground" overlay.

## Traffic & street life

* **Cars and yellow taxis** drive on the **left** along the real road network. They respect one-way streets, stop at **traffic lights** (at the 28 real signal junctions, with working red/amber/green), queue behind each other, and stop and **honk** at you.
* **Buses** in Kolkata colours run on the main roads and **stop at bus stops**. These are the 27 real OSM stops plus generated stops about every 400 m on main roads, all with shelters and বাস স্টপ signs.
* **Trams** run on the real tram tracks.
* **Zebra crossings** are painted at the real OSM crossings and at signal junctions.
* **Trees:** individually mapped OSM trees, plus trees in the parks and along the avenues.
* **Land use** colours the ground: residential, commercial, railway yards and so on.
* **Places:** 734 named places, including offices, schools and colleges, and historic sites.

## Controls

| Laptop | Mobile (landscape) |
|---|---|
| WASD / Arrows: move · Shift: run · Space: jump | Left joystick · RUN toggle · JUMP |
| Left click / J: punch · Right click / K: kick | PUNCH · KICK |
| E: interact · M: map · H: help · Mouse: look · Wheel: zoom | USE · MAP · drag the screen to look |
| V: view mode · N: voice on/off · L: বাংলা / English | VIEW (🦅) |
| M: map · /: search · E at a Ⓜ entrance: ride the metro | MAP |

Add `?q=low` to the URL on slower laptops: it turns off shadows and shortens the draw distance. Low quality is the default on phones.

## Run locally

It is a static site with no build step. Three.js loads from a CDN.

```bash
node server.js
# open http://localhost:8004
```

(`python3 -m http.server 8000` also works.)

(Opening `index.html` directly as a file won't work, because browsers block `fetch` of the map JSON from `file://`.)

## Deploy to GitHub Pages

```bash
git init && git add . && git commit -m "Kolkata City 3D - step 1"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then go to **Settings → Pages → Deploy from a branch → `main` / root**. The game will be at `https://<you>.github.io/<repo>/`.

## Rebuilding the map data

```bash
tools/fetch_osm.sh osm_raw                               # downloads from Overpass API
pip install shapely
python3 tools/build_map.py osm_raw data/kolkata.json      # map + names into data/strings.json
# add --retranslate to regenerate all Bengali names (this discards hand edits)
```

To cover a bigger part of Kolkata, change the bounding box in `tools/query_*.overpassql` and `BBOX` in `tools/build_map.py`.

## Project layout

```
index.html, css/style.css
js/main.js        renderer, sky, camera, game loop, interactions
js/world.js       region ground & river + 1 km tile streaming (roads with lane markings, buildings, parks, trees, lamps); collision & queries
js/boats.js       ferries, barges, cruise steamers & country boats on the Hooghly
js/landmarks.js   Howrah Bridge, Victoria Memorial, Shaheed Minar, Eden Gardens, ... + petrol pumps
js/pois.js        shops/restaurants markers, signboards, info cards
js/npc.js         pedestrians, parked taxis, trams
js/human.js       procedural character model + animation
js/player.js      player physics & combat
js/controls.js    keyboard / mouse / touch
js/hud.js         minimap, labels, full map & fast travel
js/viewmode.js    fly-over view mode: hover names, click info, labels, fly-to
js/roadgraph.js   street network graph + A* routing + turn instructions
js/nav.js         directions: GPS path, beacon, turn-by-turn
js/mapui.js       interactive zoomable map, search UI, place cards
js/search.js      offline Bengali/English place search (+ optional Nominatim)
js/traffic.js     cars, taxis, buses (stop at bus stops), trams; traffic-light logic
js/details.js     bus stops & shelters, traffic signals, zebra crossings
js/metro.js       Kolkata Metro lines, stations, entrances, rides, trains
js/i18n.js        loads strings.json / comment.json, Bengali digits, language switch, speech
data/region.json  whole-region overview: land/river, road network, metro, stations, bus stops, signals, places, landmarks
data/tiles/       1 km detail tiles (loaded on demand)
data/strings.json all visible text (bn + en)
data/comment.json all spoken lines (bn + en)
tools/bengali.py  English -> Bengali place-name converter
server.js         local static server (node server.js -> http://localhost:8004)
tools/            OSM download + preprocessing scripts
data/kolkata.json generated map
```

## Next steps (ideas)

* Step 2: drivable vehicles (taxis, buses, trams, hand-pulled rickshaws) with traffic AI on the real road network
* Step 3: store interiors, buying food and items, money
* Missions, day/night cycle, Durga Pujo pandals, river ferries from Babughat

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL.
3D engine: [three.js](https://threejs.org) (MIT).

## Satellite imagery

The ground under the 3D city and the 🛰 layer of the big map use **Sentinel-2 cloudless 2023** by EOX
(contains modified Copernicus Sentinel data, licence CC BY-NC-SA 4.0 — non-commercial use with attribution),
streamed from `tiles.maps.eox.at`. It is ~10 m imagery: it gives every area its real ground colour (trees, fields,
ponds, open land); buildings and roads are 3D models from OpenStreetMap on top. Toggle it in view mode (🛰 উপগ্রহ মাটি).
Google satellite / Street View / 3D imagery cannot be used: Google's terms forbid copying or deriving content from it.

Where OpenStreetMap mappers recorded them, real `building:colour`, `building:material`, `roof:colour`, `roof:shape`
and road `width` tags are used for wall/roof colours, dome / pyramid / gabled roofs and carriageway widths.

Trees are planted where the satellite image shows real tree cover (dark green pixels, sampled every ~9 m), so
forest belts, the Maidan's tree lines and green courtyards sit where they really are.

Landmark models (Biswa Bangla Gate, Dakshineswar, Shaheed Minar, Akankha sculpture, …) were re-modelled by comparing
against freely licensed reference photos on Wikimedia Commons (proportions, colours, roofs, structure).

## Living city

- **Day & night** — game clock (1 s = 1 min); the scene changes every two game hours: night → dawn → sunrise →
  morning → noon → afternoon → evening → sunset → dusk. Sun path for 22.5° N, moon, twinkling stars, lit windows,
  shopfronts and street lamps at night. Press **T** to jump ahead two hours.
- **Railways** — EMU locals and express trains (red-white engine + blue coaches) run on the real main lines
  (`railnet`, merged from OSM), brake into stations and wait at the platforms (OSM `railway=platform`, with canopies).
- **Metro** — trains run underground (−12 m), up ramps through tunnel portals and onto the viaducts; elevated
  stations; view mode's x-ray shows every underground train.
- **Buses & taxis** — buses parked at the 35 real bus stands/depots (Esplanade, Howrah, Babughat, Karunamoyee…),
  yellow Ambassadors at taxi stands (OSM + the big stations / airport); 273 traffic signals (OSM + every major junction).
- **Airport** — aircraft parked nose-in at the real stands; departures and arrivals (3° glide slope) on both runways.

## Places & map

`tools/fetch_wikidata.py` pulls ~4,600 notable places (CC0, with Bengali labels, descriptions and Commons photos);
`tools/famous.py` resolves a curated list of famous/viral food places, sweet shops, hotels, buildings, malls, ghats,
temples, grounds and the Eco Park Seven Wonders from OSM → Wikidata → Nominatim. Places that open data does not know
can be added by hand in `tools/famous_manual.json`:

```json
[{"name": "Putiram", "kind": "food", "lat": 22.5745, "lon": 88.3632, "desc": "Kachori since 1930s", "bndesc": "কচুরি", "bn": "পুঁটিরাম"}]
```

The big map has Google-Maps-style category chips (Famous, Food, Sweets, Hotels, Things to do, Museums, Temples, Ghats,
Transit, Hospitals, Education, Malls & markets, Sports, Buildings), pins, and a place card with a Wikimedia Commons photo.
Rebuild order: `pbf_to_cells.py` → `fetch_wikidata.py` → `famous.py` → `build_region.py`.
