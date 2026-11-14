// Interactive city map: zoom/pan, detailed streets with names, metro, buses, places, search & directions.
import { t, tn, tk, num, getLang, onLang, strings } from './i18n.js';
import { KIND_STYLE } from './pois.js';
import { fmtDist } from './nav.js';
import { RK } from './world.js';
import { satImage, makeProj, SAT_ATTR } from './satellite.js';

const $ = (id) => document.getElementById(id);
// category chips (Google-Maps style)
const CATS = [
  ['famous', '⭐', p => p.f], ['food', '🍛', p => p.k === 'food'], ['sweets', '🍬', p => p.k === 'sweets'], ['hotel', '🏨', p => p.k === 'hotel'],
  ['sight', '📷', p => ['sight', 'wonder', 'park'].includes(p.k)], ['museum', '🏛', p => p.k === 'museum'], ['worship', '🛕', p => p.k === 'worship'],
  ['ghat', '🛶', p => p.k === 'ghat'], ['transit', '🚇', null], ['hospital', '🏥', p => p.k === 'hospital' || p.k === 'health'],
  ['edu', '🎓', p => p.k === 'edu'], ['shop', '🏬', p => ['mall', 'market'].includes(p.k)], ['stadium', '🏟', p => p.k === 'stadium'],
  ['building', '🏙', p => ['building', 'office', 'residential'].includes(p.k)],
];
const esc2 = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const photoCache = new Map();
// a photo for a place: its Wikidata image, else the first Wikimedia Commons search hit (free licences)
async function placePhoto(p, en) {
  const key = p.img || en; if (photoCache.has(key)) return photoCache.get(key);
  let res = null;
  try {
    if (p.img) res = { src: 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(p.img) + '?width=480', page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(p.img) };
    else {
      const u = 'https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query&generator=search&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=480&gsrsearch='
        + encodeURIComponent(en + ' Kolkata filetype:bitmap');
      const j = await (await fetch(u)).json(), pg = j.query && Object.values(j.query.pages)[0];
      if (pg) res = { src: pg.imageinfo[0].thumburl, page: pg.imageinfo[0].descriptionurl };
    }
  } catch { res = null; }
  photoCache.set(key, res); return res;
}
const FONT = '"Hind Siliguri", sans-serif';
const ROAD_STYLE = [ // [colour, casing, min px width]
  ['#f2c14e', '#a77d1c', 3], ['#f2c14e', '#a77d1c', 3], ['#fbe08a', '#b8953a', 2.6], ['#fff3c4', '#c5ad6b', 2.2], ['#ffffff', '#b9b4a6', 1.8],
  ['#ffffff', '#b9b4a6', 1.6], ['#ffffff', '#c9c4b6', 1.2], ['#f4f1ea', '#d0cabc', 0.8], ['#e6dcc6', null, 0.6], ['#d8ccb0', null, 0.6]];

export class MapUI {
  constructor({ world, pois, landmarks, metro, details, search, nav, hud, getPlayer, onTravel, onDirections }) {
    Object.assign(this, { world, pois, landmarks, metro, details, search, nav, hud, getPlayer, onTravel, onDirections });
    this.el = $('bigmap'); this.cv = $('bigcanvas'); this.ov = $('mapoverlay');
    this.base = document.createElement('canvas');
    this.isOpen = false; this.dirty = true;
    this.layers = { metro: true, bus: true, places: true, sat: false };
    this.proj = makeProj(world.d.meta);
    this.pointers = new Map();
    this.sel = null;
    this.req = new Set();
    // precompute road bounding boxes + label anchors
    for (const r of world.roads) {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; const p = r.p;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      r.bb = [x0, z0, x1, z1];
    }
    this.bindUI();
    onLang(() => { this.dirty = true; this.fillSide(); });
    this.fillSide();
  }

  // ------------------------------------------------------------ open / close
  open(focus, focusSearch = false) {
    this.isOpen = true; this.el.classList.remove('hidden'); this.hud.open = 'map';
    if (document.pointerLockElement) document.exitPointerLock();
    this.resize();
    const p = focus || this.getPlayer().pos;
    if (!this.scale) { this.cx = p.x; this.cz = p.z; this.scale = 0.9 * devicePixelRatio; }
    else { this.cx = p.x; this.cz = p.z; }
    this.dirty = true;
    if (focusSearch) setTimeout(() => $('searchInput').focus({ preventScroll: true }), 50);
  }
  close() { this.isOpen = false; this.el.classList.add('hidden'); $('searchResults').innerHTML = ''; if (this.hud.open === 'map') this.hud.open = null; }
  resize() {
    const r = this.cv.getBoundingClientRect(), d = devicePixelRatio;
    for (const c of [this.cv, this.ov, this.base]) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
    this.dirty = true;
  }

  // world <-> screen (device px)
  sx(x) { return this.cv.width / 2 + (x - this.cx) * this.scale; }
  sz(z) { return this.cv.height / 2 + (z - this.cz) * this.scale; }
  wx(px) { return this.cx + (px - this.cv.width / 2) / this.scale; }
  wz(py) { return this.cz + (py - this.cv.height / 2) / this.scale; }
  clampScale() { const B = this.world.bounds; const fit = Math.min(this.cv.width / (B.x1 - B.x0), this.cv.height / (B.z1 - B.z0)) * 0.9; this.scale = Math.max(fit, Math.min(10 * devicePixelRatio, this.scale)); }
  zoomAt(px, py, f) { const x = this.wx(px), z = this.wz(py); this.scale *= f; this.clampScale(); this.cx = x - (px - this.cv.width / 2) / this.scale; this.cz = z - (py - this.cv.height / 2) / this.scale; this.dirty = true; }

  // ------------------------------------------------------------ input
  bindUI() {
    const cv = this.ov;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      this.pinch = this.pinchInfo();
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      const d = devicePixelRatio;
      if (this.pointers.size === 1) { this.cx -= (e.clientX - p.x) * d / this.scale; this.cz -= (e.clientY - p.y) * d / this.scale; this.dirty = true; }
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size >= 2) {
        const now = this.pinchInfo();
        if (this.pinch && now) { const r = this.cv.getBoundingClientRect(); this.zoomAt((now.cx - r.left) * d, (now.cy - r.top) * d, now.d / Math.max(1, this.pinch.d)); }
        this.pinch = now;
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId); this.pointers.delete(e.pointerId);
      if (p && this.pointers.size === 0 && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6 && performance.now() - p.t < 450) this.click(e);
      this.pinch = this.pinchInfo();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = this.cv.getBoundingClientRect(), d = devicePixelRatio; this.zoomAt((e.clientX - r.left) * d, (e.clientY - r.top) * d, Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.0015)); }, { passive: false });
    addEventListener('resize', () => { if (this.isOpen) this.resize(); });

    $('zoomIn').onclick = () => this.zoomAt(this.cv.width / 2, this.cv.height / 2, 1.6);
    $('zoomOut').onclick = () => this.zoomAt(this.cv.width / 2, this.cv.height / 2, 1 / 1.6);
    $('myLoc').onclick = () => { const p = this.getPlayer().pos; this.cx = p.x; this.cz = p.z; this.dirty = true; };
    $('mapClose').onclick = () => this.close();
    this.cat = null;
    const chips = $('mapChips');
    for (const [id, icon] of CATS) {
      const b = document.createElement('button'); b.dataset.cat = id;
      const lab = () => { b.textContent = icon + ' ' + t('cat_' + id); }; lab(); onLang(lab);
      b.onclick = () => { this.cat = this.cat === id ? null : id; chips.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.cat === this.cat)); this.fillCat(); this.dirty = true; };
      chips.appendChild(b);
    }
    for (const k of ['metro', 'bus', 'places', 'sat']) { const c = $('lay_' + k); c.onchange = () => { this.layers[k] = c.checked; this.dirty = true; }; }
    const inp = $('searchInput');
    let tmr;
    inp.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => this.runSearch(inp.value), 120); });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const first = $('searchResults').querySelector('button'); if (first) first.click(); }
      if (e.key === 'Escape') { if (inp.value) { inp.value = ''; this.runSearch(''); } else this.close(); inp.blur(); }
    });
    inp.addEventListener('keyup', (e) => e.stopPropagation());
    $('searchOnline').onclick = () => this.runOnline(inp.value);
    $('cardClose').onclick = () => { $('placeCard').classList.add('hidden'); this.sel = null; };
    $('cardDir').onclick = () => { if (this.sel) { this.onDirections(this.sel.x, this.sel.z, this.sel.title); this.close(); } };
    $('cardGo').onclick = () => { if (this.sel) { this.onTravel(this.sel.x, this.sel.z, this.sel.title); this.close(); } };
  }
  pinchInfo() { const ps = [...this.pointers.values()]; if (ps.length < 2) return null; const [a, b] = ps; return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }

  // items of the active category (POIs, or transit stops)
  catItems() {
    if (!this.cat) return [];
    if (this.cat === 'transit') {
      const out = [];
      this.metro.stations.forEach(st => out.push({ x: st.x, z: st.z, title: tn(st.ni) + ' ' + t('metro_word'), icon: 'Ⓜ', col: '#d4202a', sub: t('cat_transit') }));
      for (const r of this.metro.rail) out.push({ x: r.x, z: r.z, title: tn(r.ni), icon: '🚆', col: '#555', sub: t('cat_transit') });
      for (const s of (this.details.standList || [])) out.push({ x: s.x, z: s.z, title: s.kind === 'bus' ? t('bus_stand') + (s.ni !== undefined ? ' — ' + tn(s.ni) : '') : t('taxi_stand'), icon: s.kind === 'bus' ? '🚌' : '🚕', col: s.kind === 'bus' ? '#1f4f9c' : '#e0a800', sub: t('cat_transit') });
      return out;
    }
    const f = CATS.find(c => c[0] === this.cat)[2];
    return this.pois.list.filter(f).map(p => this.poiItem(p));
  }
  poiItem(p) {
    const st = KIND_STYLE[p.k] || KIND_STYLE.shop;
    return { x: p.x, z: p.z, title: tn(p.ni), icon: st.icon, col: st.col, sub: tk(p.k) + (p.sti !== undefined ? ' · ' + tn(p.sti) : ''), poi: p, famous: !!p.f };
  }
  fillCat() {
    const box = $('catBox'), el = $('catList');
    if (!this.cat) { box.classList.add('hidden'); return; }
    const c = this.cx !== undefined ? { x: this.cx, z: this.cz } : this.getPlayer().pos;
    const items = this.catItems().sort((a, b) => (b.famous - a.famous) || (Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z)));
    $('catTitle').textContent = CATS.find(k => k[0] === this.cat)[1] + ' ' + t('cat_' + this.cat) + ' — ' + t('cat_results', { n: num(items.length) });
    el.innerHTML = '';
    for (const it of items.slice(0, 200)) {
      const b = document.createElement('button');
      b.innerHTML = `${it.famous ? '⭐' : it.icon} ${esc2(it.title)}<small>${fmtDist(Math.hypot(it.x - c.x, it.z - c.z))}</small>`;
      b.onclick = () => this.select(it, true); el.appendChild(b);
    }
    box.classList.remove('hidden');
  }
  fillSide() {
    if (this.cat) this.fillCat();
    const el = $('famousList'); el.innerHTML = '';
    for (const l of [...this.landmarks].sort((a, b) => a.name.localeCompare(b.name))) {
      const b = document.createElement('button'); b.textContent = '⭐ ' + l.name; b.onclick = () => this.select({ x: l.travel[0], z: l.travel[1], title: l.name, sub: l.kind, icon: '⭐' }, true); el.appendChild(b);
    }
    const ml = $('metroList'); ml.innerHTML = '';
    this.metro.stations.forEach((st, si) => {
      const b = document.createElement('button');
      b.innerHTML = st.lines.map(id => `<i class="dot" style="--c:${this.metro.lineById(id)?.c}"></i>`).join('') + ' ' + tn(st.ni);
      b.onclick = () => this.select({ x: st.x, z: st.z, title: tn(st.ni) + ' ' + t('metro_word'), sub: st.lines.map(id => tn(this.metro.lineById(id).ni)).join(' · '), icon: 'Ⓜ' }, true);
      ml.appendChild(b);
    });
  }

  // ------------------------------------------------------------ search
  runSearch(q) {
    const box = $('searchResults'); box.innerHTML = '';
    if (!q.trim()) return;
    const res = this.search.query(q, this.getPlayer().pos);
    if (!res.length) box.innerHTML = `<div class="sr-none">${t('search_none')}</div>`;
    for (const it of res) box.appendChild(this.resultRow(it));
  }
  async runOnline(q) {
    if (!q.trim()) return;
    const box = $('searchResults'); box.innerHTML = `<div class="sr-none">${t('search_loading')}</div>`;
    try {
      const res = await this.search.online(q);
      box.innerHTML = res.length ? `<div class="sr-note">${t('search_online_note')}</div>` : `<div class="sr-none">${t('search_none')}</div>`;
      for (const it of res) box.appendChild(this.resultRow(it));
    } catch (e) { box.innerHTML = `<div class="sr-none">${t('search_offline')}</div>`; }
  }
  resultRow(it) {
    const b = document.createElement('button'); b.className = 'sr';
    const name = it.kind === 'online' ? it.en : this.search.label(it);
    const p = this.getPlayer().pos, d = Math.hypot(it.x - p.x, it.z - p.z);
    const sub = it.sub || (it.sti !== undefined ? tn(it.sti) : this.world.districtAt(it.x, it.z));
    b.innerHTML = `<span class="sri">${it.icon}</span><span class="srt"><b>${esc(name)}</b><small>${esc(sub)} · ${fmtDist(d)}</small></span>`;
    b.onclick = () => { $('searchResults').innerHTML = ''; this.select({ x: it.x, z: it.z, title: name, sub, icon: it.icon }, true); };
    return b;
  }

  // ------------------------------------------------------------ selection card
  click(e) {
    const r = this.cv.getBoundingClientRect(), d = devicePixelRatio, px = (e.clientX - r.left) * d, py = (e.clientY - r.top) * d;
    // icons first
    let best = null, bd = 16 * d;
    const consider = (x, z, info) => { const dd = Math.hypot(this.sx(x) - px, this.sz(z) - py); if (dd < bd) { bd = dd; best = info; } };
    for (const l of this.landmarks) consider(l.x, l.z, () => ({ x: l.travel[0], z: l.travel[1], title: l.name, sub: l.kind, icon: '⭐' }));
    for (const it of (this.pinItems || [])) { const dd = Math.hypot(this.sx(it.x) - px, this.sz(it.z) - py - 14 * d); if (dd < bd) { bd = dd; best = () => it; } }
    this.metro.stations.forEach(st => consider(st.x, st.z, () => ({ x: st.x, z: st.z, title: tn(st.ni) + ' ' + t('metro_word'), sub: st.lines.map(id => tn(this.metro.lineById(id).ni)).join(' · '), icon: 'Ⓜ' })));
    if (this.scale > 1.2 * d && this.layers.places) for (const p of this.pois.list) consider(p.x, p.z, () => this.poiItem(p));
    if (this.layers.bus && this.scale > 0.9 * d) for (const s of this.details.busStops) consider(s.x, s.z, () => ({ x: s.x, z: s.z, title: t('bus_stop') + (s.ni !== undefined ? ' — ' + tn(s.ni) : ''), sub: this.world.districtAt(s.x, s.z), icon: '🚌' }));
    if (best) return this.select(best(), false);
    const x = this.wx(px), z = this.wz(py);
    const street = this.world.streetAt(x, z);
    this.select({ x, z, title: street || t('dropped_pin'), sub: this.world.districtAt(x, z), icon: '📍' }, false);
  }
  select(s, center) {
    this.sel = s;
    if (center) { this.cx = s.x; this.cz = s.z; if (this.scale < 1.6 * devicePixelRatio) this.scale = 1.6 * devicePixelRatio; this.dirty = true; }
    const p = this.getPlayer().pos;
    $('cardIcon').textContent = s.icon || '📍';
    $('cardTitle').textContent = s.title; $('cardSub').textContent = s.sub || '';
    $('cardDist').textContent = t('distance_from_you', { d: fmtDist(Math.hypot(s.x - p.x, s.z - p.z)) });
    const p0 = s.poi, bn = getLang() === 'bn';
    $('cardDesc').textContent = p0 ? ((bn ? p0.db : p0.d) || p0.d || '') : '';
    const ph = $('cardPhoto'); ph.classList.add('hidden');
    if (p0 && (p0.img || p0.f || ['sight', 'museum', 'worship', 'ghat', 'wonder', 'stadium', 'hotel', 'building', 'mall'].includes(p0.k))) {
      const en = strings().names?.[p0.ni]?.en || s.title, token = (this.photoToken = {});
      placePhoto(p0, en).then(r => {
        if (token !== this.photoToken || !r) return;
        const img = $('cardImg'); img.onload = () => ph.classList.remove('hidden'); img.onerror = () => ph.classList.add('hidden');
        img.src = r.src; $('cardCredit').textContent = t('photo_credit'); $('cardCredit').href = r.page;
      });
    }
    $('placeCard').classList.remove('hidden');
  }

  // ------------------------------------------------------------ drawing
  update() {
    if (!this.isOpen) return;
    if (this.dirty) { this.drawBase(); this.dirty = false; }
    this.drawOverlay();
  }

  // satellite imagery tiles under the vector layers (web-mercator tiles drawn in local metres)
  drawSat(c, vx0, vz0, vx1, vz1, S) {
    const P = this.proj, cosl = Math.cos(this.world.d.meta.lat0 * Math.PI / 180);
    const z = Math.max(9, Math.min(16, Math.round(Math.log2(S * 40075016 * cosl / 256))));
    const [ax, ay] = P.px(vx0, vz0, z), [bx, by] = P.px(vx1, vz1, z);
    const n = 256 * 2 ** z, back = (px, py) => {                    // mercator px -> local metres
      const lon = px / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * py / n))) * 180 / Math.PI;
      return [(lon - this.world.d.meta.lon0) * this.world.d.meta.kx, -(lat - this.world.d.meta.lat0) * this.world.d.meta.kz];
    };
    this.satImgs = this.satImgs || new Map();
    for (let ty = Math.floor(ay / 256); ty <= Math.floor(by / 256); ty++) for (let tx = Math.floor(ax / 256); tx <= Math.floor(bx / 256); tx++) {
      const key = z + '/' + tx + '/' + ty, im = this.satImgs.get(key);
      const [x0, z0] = back(tx * 256, ty * 256), [x1, z1] = back(tx * 256 + 256, ty * 256 + 256);
      if (im) c.drawImage(im, x0, z0, x1 - x0 + 1 / S, z1 - z0 + 1 / S);   // +1px hides seams
      else if (im === undefined) {
        this.satImgs.set(key, null);
        if (this.satImgs.size > 600) this.satImgs.delete(this.satImgs.keys().next().value);
        satImage(z, tx, ty).then(img => { if (img) { this.satImgs.set(key, img); if (this.isOpen) this.dirty = true; } });
      }
    }
  }

  drawBase() {
    const c = this.base.getContext('2d'), W = this.base.width, H = this.base.height, S = this.scale, d = devicePixelRatio, wd = this.world.d;
    const vx0 = this.wx(0), vx1 = this.wx(W), vz0 = this.wz(0), vz1 = this.wz(H);
    const vis = (bb) => !(bb[2] < vx0 || bb[0] > vx1 || bb[3] < vz0 || bb[1] > vz1);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#9cc7dd'; c.fillRect(0, 0, W, H); // river colour as background
    c.setTransform(S, 0, 0, S, W / 2 - this.cx * S, H / 2 - this.cz * S);
    const poly = (p, h) => { c.beginPath(); for (let i = 0; i < p.length; i += 2) i ? c.lineTo(p[i], p[i + 1]) : c.moveTo(p[i], p[i + 1]); c.closePath(); if (h) for (const hh of h) { for (let i = 0; i < hh.length; i += 2) i ? c.lineTo(hh[i], hh[i + 1]) : c.moveTo(hh[i], hh[i + 1]); c.closePath(); } };
    const line = (p) => { c.beginPath(); for (let i = 0; i < p.length; i += 2) i ? c.lineTo(p[i], p[i + 1]) : c.moveTo(p[i], p[i + 1]); c.stroke(); };
    c.fillStyle = '#efe9dc'; for (const l of wd.land) { poly(l.p, l.h); c.fill('evenodd'); }
    // detail tiles in view (fetched on demand when zoomed in)
    const W2 = this.world, TS = W2.TS, detail = S > 0.22 * d, tdl = [];
    if (detail) {
      for (let tx = Math.floor(vx0 / TS); tx <= Math.floor(vx1 / TS); tx++) for (let tz = Math.floor(vz0 / TS); tz <= Math.floor(vz1 / TS); tz++) {
        const k = W2.key(tx, tz); if (!W2.tileSet.has(k)) continue;
        const td = W2.tileData(tx, tz);
        if (td) tdl.push(td);
        else if (!this.req.has(k) && this.req.size < 6) { this.req.add(k); W2.fetchTile(k).then(() => { this.req.delete(k); this.dirty = true; }); }
      }
    }
    const sat = this.layers.sat;
    if (sat) this.drawSat(c, vx0, vz0, vx1, vz1, S);
    $('mapAttr').textContent = '© OpenStreetMap contributors' + (sat ? ' · ' + SAT_ATTR : '');
    if (!sat) {
    const luc = ['#ece4d3', '#f1e2d6', '#e3e0db', '#e2dad0', '#dfe6d3'];
    for (const td of tdl) for (const l of (td.landuse || [])) { c.fillStyle = luc[l.k] || luc[0]; poly(l.p, l.h); c.fill('evenodd'); }
    for (const td of tdl) for (const a of (td.aprons || [])) { c.fillStyle = '#d6d6d2'; poly(a.p, a.h); c.fill('evenodd'); }
    for (const td of tdl) for (const pk of (td.parks || [])) { c.fillStyle = pk.k === 1 ? '#bfe3a6' : pk.k === 4 ? '#cfe3c6' : '#c8e6b0'; poly(pk.p, pk.h); c.fill('evenodd'); }
    c.fillStyle = '#9cc7dd'; for (const td of tdl) for (const w of (td.water || [])) { poly(w.p, w.h); c.fill('evenodd'); }
    c.strokeStyle = '#9cc7dd'; c.lineCap = 'round'; for (const td of tdl) for (const cn of (td.canals || [])) { c.lineWidth = cn.w; line(cn.p); }
    c.fillStyle = '#9cc7dd'; for (const r of wd.river) { poly(r.p, r.h); c.fill('evenodd'); }
    }
    if (!sat && S > 0.35 * d) {
      c.strokeStyle = '#c4b9a6'; c.lineWidth = 1 / S;
      for (const td of tdl) for (const b of (td.buildings || [])) {
        const p = b.p; if (p[0] < vx0 - 200 || p[0] > vx1 + 200 || p[1] < vz0 - 200 || p[1] > vz1 + 200) continue;
        c.fillStyle = b.s ? '#e8c9b8' : (S > 1.5 * d ? '#d9d0c1' : '#ddd5c7');
        poly(p, b.h); c.fill('evenodd'); if (S > 1.2 * d) c.stroke();
      }
    }
    // runways
    for (const td of tdl) for (const a of (td.aero || [])) { c.strokeStyle = a.k === 0 ? '#8a8a8a' : '#b5b5b5'; c.lineWidth = a.w; c.lineCap = 'butt'; line(a.p); }
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const td of tdl) for (const r of (td.rails || [])) { c.strokeStyle = r.k ? '#7f8c8d' : '#8a8a8a'; c.lineWidth = Math.max(1.5 / S, r.k ? 1.0 : 2.2); c.setLineDash(r.k ? [] : [6 / S, 4 / S]); line(r.p); }
    c.setLineDash([]);
    // roads: zoomed in = every street from the tiles; zoomed out = main network
    const useTiles = S > 0.6 * d && tdl.length;
    const roadList = useTiles ? tdl.flatMap(td => td.roads || []) : this.world.roads.filter(r => vis(r.bb));
    const drawRoads = (casing) => {
      for (let k = 9; k >= 0; k--) {
        const st = ROAD_STYLE[k];
        if (casing && !st[1]) continue;
        if (k >= RK.residential && S < 0.3 * d) continue;
        if (k >= RK.service && S < 0.6 * d) continue;
        if (k === RK.foot && S < 1.1 * d) continue;
        c.strokeStyle = casing ? st[1] : st[0];
        if (k === RK.foot || k === RK.track) c.setLineDash([3 / S, 2 / S]); else c.setLineDash([]);
        for (const r of roadList) {
          if (r.k !== k) continue;
          const w = Math.max(st[2] * d / S, r.w);
          c.lineWidth = casing ? w + 2 * d / S : w;
          line(r.p);
        }
      }
      c.setLineDash([]);
    };
    drawRoads(true); drawRoads(false);
    for (const r of roadList) if ((r.el || r.elevated)) { c.strokeStyle = '#8a6d1f'; c.lineWidth = r.w + 3 * d / S; line(r.p); c.strokeStyle = '#f7d77a'; c.lineWidth = r.w; line(r.p); }
    // metro lines: tunnels dashed, viaducts solid
    if (this.layers.metro) for (const L of this.metro.lines) {
      c.strokeStyle = L.c; c.lineWidth = Math.max(4 * d / S, 6); c.globalAlpha = L.uc ? 0.5 : 0.9;
      for (const sg of L.segs) { c.setLineDash(L.uc || !sg.e ? [18 * d / S, 6 * d / S] : []); line(sg.p); }
      c.globalAlpha = 1; c.setLineDash([]);
    }
    // ---------- labels & icons (screen space)
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.labelBoxes = [];
    // road names along the road
    const minK = S > 2 * d ? RK.service : S > 1.1 * d ? RK.residential : S > 0.6 * d ? RK.tertiary : S > 0.35 * d ? RK.secondary : -1;
    const done = new Map();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const roadsSorted = this.world.roads.filter(r => r.ni !== undefined && r.k <= minK && r.k !== RK.foot && vis(r.bb)).sort((a, b) => a.k - b.k || b.len - a.len);
    for (const r of roadsSorted) {
      const name = tn(r.ni); if (!name) continue;
      const fs = Math.round((r.k <= 3 ? 12 : 11) * d);
      c.font = `${r.k <= 3 ? 700 : 600} ${fs}px ${FONT}`;
      const tw = c.measureText(name).width;
      // longest segment on screen
      let bi = -1, bl = 0;
      for (let i = 2; i < r.p.length; i += 2) { const l = Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]) * S; if (l > bl) { bl = l; bi = i; } }
      if (bi < 0 || bl < tw * 0.6) continue;
      const mx = this.sx((r.p[bi] + r.p[bi - 2]) / 2), my = this.sz((r.p[bi + 1] + r.p[bi - 1]) / 2);
      if (mx < 0 || my < 0 || mx > W || my > H) continue;
      const prev = done.get(r.ni) || [];
      if (prev.some(([x, y]) => Math.hypot(x - mx, y - my) < 260 * d)) continue;
      if (!this.freeBox(mx, my, tw * 0.7, fs)) continue;
      prev.push([mx, my]); done.set(r.ni, prev);
      let a = Math.atan2(r.p[bi + 1] - r.p[bi - 1], r.p[bi] - r.p[bi - 2]); if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
      c.save(); c.translate(mx, my); c.rotate(a);
      c.lineWidth = 3 * d; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.strokeText(name, 0, 0); c.fillStyle = r.k <= 3 ? '#5a4310' : '#444'; c.fillText(name, 0, 0);
      c.restore();
    }
    // area names (OSM places)
    for (const pl of this.world.d.places) {
      const big = pl.k === 'suburb' || pl.k === 'town' || pl.k === 'city';
      if (!(big ? S > 0.06 * d : S > 0.3 * d) || (S > 2.2 * d && !big)) continue;
      this.text(c, tn(pl.ni), this.sx(pl.x), this.sz(pl.z), (big ? 15 : 12) * d, big ? '#5d4037' : '#795548', big ? 700 : 600);
    }
    // bus stops
    if (this.layers.bus && S > 0.9 * d) for (const s of this.details.busStops) this.icon(c, s.x, s.z, '#1f4f9c', '🚌', 7 * d);
    // places
    if (this.layers.places && S > 1.0 * d) {
      for (const p of this.pois.list) {
        const st = KIND_STYLE[p.k] || KIND_STYLE.shop;
        this.icon(c, p.x, p.z, st.col, S > 1.6 * d ? st.icon : '', S > 1.6 * d ? 8 * d : 3.5 * d);
        if (S > 2.6 * d) this.text(c, tn(p.ni), this.sx(p.x), this.sz(p.z) + 14 * d, 11 * d, '#333', 600);
      }
    }
    // famous places (always) and the active category: Google-style pins with labels
    {
      const items = this.cat ? this.catItems() : [];
      if (!this.cat || this.cat !== 'famous') for (const p of this.pois.list) if (p.f && S > 0.1 * d) items.push(this.poiItem(p));
      items.sort((a, b) => b.famous - a.famous);
      this.pinItems = items;
      for (const it of items) {
        const X = this.sx(it.x), Y = this.sz(it.z);
        if (X < -30 || Y < -30 || X > W + 30 || Y > H + 30) continue;
        const big = it.famous, r = (big ? 11 : 9) * d;
        if (!big && S < 0.2 * d) { this.icon(c, it.x, it.z, it.col, '', 3.5 * d); continue; }
        this.pinShape(c, X, Y, r, it.col, it.icon, big);
        if (S > (big ? 0.25 : 0.6) * d && this.freeBox(X, Y + 10 * d, Math.min(120, it.title.length * 4) * d, 8 * d)) this.text(c, it.title, X, Y + 10 * d, (big ? 12.5 : 11) * d, big ? '#6a1b9a' : '#333', 700);
      }
    }
    // rail stations
    for (const r of this.metro.rail) { this.icon(c, r.x, r.z, '#555', '🚆', 9 * d); if (S > 0.5 * d) this.text(c, tn(r.ni), this.sx(r.x), this.sz(r.z) - 16 * d, 12 * d, '#333', 700); }
    // metro stations
    if (this.layers.metro) for (const st of this.metro.stations) {
      const x = this.sx(st.x), y = this.sz(st.z);
      c.fillStyle = '#fff'; c.strokeStyle = this.metro.lineById(st.lines[0])?.c || '#d4202a'; c.lineWidth = 3 * d;
      c.beginPath(); c.arc(x, y, 9 * d, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#d4202a'; c.font = `bold ${10 * d}px sans-serif`; c.fillText('M', x, y + 0.5);
      this.text(c, tn(st.ni), x, y - 18 * d, 13 * d, '#1d3f8f', 700);
    }
    // landmarks
    for (const l of this.landmarks) { this.icon(c, l.x, l.z, '#ffcf3f', '⭐', 10 * d); this.text(c, l.name, this.sx(l.x), this.sz(l.z) + 20 * d, 13 * d, '#7a4a00', 700); }
    // river label
    this.text(c, t('river_label'), this.sx(-560), this.sz(-900), 15 * d, '#2b6d93', 700);
  }
  freeBox(x, y, hw, hh) {
    if (this.labelBoxes.some(b => Math.abs(b[0] - x) < b[2] + hw && Math.abs(b[1] - y) < b[3] + hh)) return false;
    this.labelBoxes.push([x, y, hw, hh]); return true;
  }
  pinShape(c, X, Y, r, col, glyph, star) {
    const cy = Y - r * 1.5;
    c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 2 * devicePixelRatio;
    c.beginPath(); c.moveTo(X, Y); c.arc(X, cy, r, Math.PI * 0.75, Math.PI * 2.25); c.closePath(); c.fill(); c.stroke();
    c.font = `${r * 1.15}px sans-serif`; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(glyph, X, cy + 1);
    if (star) { c.font = `${r * 0.9}px sans-serif`; c.fillText('⭐', X + r * 0.9, cy - r * 0.8); }
  }
  icon(c, x, z, col, glyph, r) {
    const X = this.sx(x), Y = this.sz(z);
    if (X < -20 || Y < -20 || X > c.canvas.width + 20 || Y > c.canvas.height + 20) return;
    c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 1.5 * devicePixelRatio;
    c.beginPath(); c.arc(X, Y, r, 0, 7); c.fill(); c.stroke();
    if (glyph) { c.font = `${r * 1.1}px sans-serif`; c.fillStyle = '#000'; c.fillText(glyph, X, Y + 1); }
  }
  text(c, s, x, y, size, col, wt = 600) {
    if (x < -200 || y < -50 || x > c.canvas.width + 200 || y > c.canvas.height + 50) return;
    c.font = `${wt} ${Math.round(size)}px ${FONT}`;
    const w = c.measureText(s).width / 2;
    if (!this.freeBox(x, y, w, size * 0.6)) return;
    c.lineWidth = 3.5 * devicePixelRatio; c.strokeStyle = 'rgba(255,255,255,0.92)'; c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y);
  }

  drawOverlay() {
    const c = this.ov.getContext('2d'), W = this.ov.width, H = this.ov.height, d = devicePixelRatio;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.drawImage(this.base, 0, 0);
    // route
    const rp = this.hud.routePts;
    if (rp) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (const [col, w] of [['#fff', 9], ['#7b3fe4', 5.5]]) {
        c.strokeStyle = col; c.lineWidth = w * d; c.beginPath();
        for (let i = 0; i < rp.length; i += 3) { const x = this.sx(rp[i]), y = this.sz(rp[i + 2]); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      }
      const ds = this.hud.routeDest; if (ds) this.pin(c, this.sx(ds.x), this.sz(ds.z), '#7b3fe4');
    }
    // metro trains
    if (this.layers.metro) for (const tr of this.metro.trainPositions()) { c.fillStyle = tr.c; c.strokeStyle = '#fff'; c.lineWidth = 2 * d; c.beginPath(); c.roundRect(this.sx(tr.x) - 7 * d, this.sz(tr.z) - 4 * d, 14 * d, 8 * d, 3 * d); c.fill(); c.stroke(); }
    // selected place
    if (this.sel && !$('placeCard').classList.contains('hidden')) this.pin(c, this.sx(this.sel.x), this.sz(this.sel.z), '#e8452c');
    // player
    const p = this.getPlayer();
    const px = this.sx(p.pos.x), py = this.sz(p.pos.z), pulse = 1 + Math.sin(performance.now() / 200) * 0.15;
    c.fillStyle = 'rgba(66,133,244,0.25)'; c.beginPath(); c.arc(px, py, 18 * d * pulse, 0, 7); c.fill();
    c.save(); c.translate(px, py); c.rotate(-p.yaw + Math.PI);
    c.fillStyle = '#4285f4'; c.strokeStyle = '#fff'; c.lineWidth = 2.5 * d;
    c.beginPath(); c.moveTo(0, -11 * d); c.lineTo(8 * d, 9 * d); c.lineTo(0, 4 * d); c.lineTo(-8 * d, 9 * d); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // scale bar
    const m = this.niceMeters(120 * d / this.scale), bw = m * this.scale;
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(W - bw - 30 * d, H - 34 * d, bw + 20 * d, 24 * d);
    c.fillStyle = '#333'; c.fillRect(W - bw - 20 * d, H - 18 * d, bw, 3 * d);
    c.font = `600 ${11 * d}px ${FONT}`; c.textAlign = 'center'; c.fillText(fmtDist(m), W - bw / 2 - 20 * d, H - 26 * d);
  }
  niceMeters(m) { const p = Math.pow(10, Math.floor(Math.log10(m))); for (const k of [1, 2, 5, 10]) if (k * p >= m) return k * p; return 10 * p; }
  pin(c, x, y, col) {
    const d = devicePixelRatio;
    c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 2 * d;
    c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x - 12 * d, y - 16 * d, x - 10 * d, y - 30 * d, x, y - 30 * d); c.bezierCurveTo(x + 10 * d, y - 30 * d, x + 12 * d, y - 16 * d, x, y); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y - 21 * d, 4 * d, 0, 7); c.fill();
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
void num; void getLang;
