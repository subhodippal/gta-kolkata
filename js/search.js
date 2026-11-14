// Place search over the game's own OpenStreetMap data (offline, free, Bengali + English),
// with an optional online fallback to OSM Nominatim (free, no key) for addresses inside the map area.
import { strings, tn, getLang } from './i18n.js';
import { KIND_STYLE } from './pois.js';

// normalise for matching: lower-case, no spaces/punctuation, unify common Bengali spelling variants
export function norm(s) {
  return (s || '').toLowerCase().normalize('NFC')
    .replace(/[ী]/g, 'ি').replace(/[ূ]/g, 'ু').replace(/[ঁ‌‍়]/g, '').replace(/ৎ/g, 'ত').replace(/ণ/g, 'ন').replace(/[শষ]/g, 'স').replace(/য/g, 'জ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function lev1(a, b) { // edit distance <= 1 ?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}

export class Search {
  constructor({ world, pois, landmarks, metro, busStops }) {
    this.world = world;
    const S = strings(), names = S.names;
    const items = [];
    const add = (o) => { o.ken = norm(o.en); o.kbn = norm(o.bn); o.wen = o.en.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); items.push(o); };
    // landmarks
    for (const l of landmarks) {
      const n = S.landmarks?.[l.id]?.name || { en: l.id, bn: l.id };
      add({ en: n.en, bn: n.bn, kind: 'landmark', icon: '⭐', x: l.x, z: l.z, ref: l, boost: 30 });
    }
    // metro & rail stations
    metro.stations.forEach((st, si) => add({ en: names[st.ni].en + ' Metro', bn: names[st.ni].bn + ' মেট্রো', ni: st.ni, kind: 'metro', icon: 'Ⓜ', x: st.x, z: st.z, ref: si, boost: 25 }));
    for (const r of metro.rail) add({ en: names[r.ni].en + ' Station', bn: names[r.ni].bn + ' স্টেশন', ni: r.ni, kind: 'rail', icon: '🚆', x: r.x, z: r.z, boost: 15 });
    // POIs
    for (const p of pois.list) add({ en: names[p.ni].en, bn: names[p.ni].bn, ni: p.ni, kind: 'poi', icon: (KIND_STYLE[p.k] || KIND_STYLE.shop).icon, x: p.x, z: p.z, ref: p, sti: p.sti, boost: 8 });
    // roads: one entry per name, at the middle of its longest piece
    const roads = new Map();
    for (const r of world.roads) {
      if (r.ni === undefined) continue;
      const cur = roads.get(r.ni); if (!cur || r.len > cur.len) roads.set(r.ni, r);
    }
    for (const [ni, r] of roads) { const m = Math.floor(r.p.length / 4) * 2; add({ en: names[ni].en, bn: names[ni].bn, ni, kind: 'road', icon: '🛣', x: r.p[m], z: r.p[m + 1], boost: r.k <= 3 ? 12 : 5 }); }
    // named bus stops
    for (const s of busStops) if (s.real && s.ni !== undefined) add({ en: names[s.ni].en + ' Bus Stop', bn: names[s.ni].bn + ' বাস স্টপ', ni: s.ni, kind: 'bus', icon: '🚌', x: s.x, z: s.z, boost: 3 });
    // areas / neighbourhoods (OSM place nodes: Hatibagan, Ultadanga, New Town, Belghoria …)
    for (const p of world.d.places) add({ en: names[p.ni].en, bn: names[p.ni].bn, ni: p.ni, kind: 'area', icon: '📍', x: p.x, z: p.z, boost: p.k === 'suburb' || p.k === 'town' ? 22 : 14 });
    this.items = items;
  }

  label(it) { return getLang() === 'bn' ? it.bn : it.en; }

  query(q, from, limit = 12) {
    const k = norm(q); if (!k) return [];
    const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
    const out = [];
    for (const it of this.items) {
      let sc = 0;
      for (const key of [it.ken, it.kbn]) {
        if (!key) continue;
        if (key === k) sc = Math.max(sc, 120);
        else if (key.startsWith(k)) sc = Math.max(sc, 100 - Math.min(30, key.length - k.length));
        else if (key.includes(k)) sc = Math.max(sc, 70);
      }
      if (!sc && words.length && words.every(w => it.wen.some(x => x.startsWith(w) || (w.length >= 4 && lev1(w, x))))) sc = 55;
      if (!sc) continue;
      sc += it.boost;
      if (from) sc -= Math.min(20, Math.hypot(it.x - from.x, it.z - from.z) / 250);
      out.push([sc, it]);
    }
    out.sort((a, b) => b[0] - a[0]);
    // de-duplicate same name very close together
    const res = [];
    for (const [, it] of out) {
      if (res.some(r => r.en === it.en && Math.hypot(r.x - it.x, r.z - it.z) < 150)) continue;
      res.push(it); if (res.length >= limit) break;
    }
    return res;
  }

  /** online search with OSM Nominatim (respecting its usage policy: only on explicit request) */
  async online(q) {
    const m = this.world.d.meta, b = this.world.bounds;
    const toLL = (x, z) => [m.lat0 - z / m.kz, m.lon0 + x / m.kx];
    const [n, w] = toLL(b.x0, b.z0), [s, e] = toLL(b.x1, b.z1);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&bounded=1&viewbox=${w},${n},${e},${s}&accept-language=bn,en&q=${encodeURIComponent(q + ', Kolkata')}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const js = await res.json();
    return js.map(r => {
      const x = (+r.lon - m.lon0) * m.kx, z = -(+r.lat - m.lat0) * m.kz;
      const name = r.name || r.display_name.split(',')[0];
      return { en: name, bn: name, kind: 'online', icon: '🌐', x, z, sub: r.display_name.split(',').slice(1, 3).join(','), boost: 0 };
    }).filter(r => r.x > b.x0 && r.x < b.x1 && r.z > b.z0 && r.z < b.z1);
  }
}
