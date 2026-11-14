// Greater Kolkata world: region overview (land, river, main road network) + 1 km detail tiles streamed around the player.
import * as THREE from 'three';
import { t, tn } from './i18n.js';
import { MeshBuilder, ribbon, Grid, signedArea, centroid, pointInPoly, distToSeg, rng, hashStr, canvasTexture } from './geo.js';

const C = (hex) => new THREE.Color(hex);
const tick = () => new Promise(r => setTimeout(r, 0));

// road kinds (match tools/build_region.py)
export const RK = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, link: 5, residential: 6, service: 7, foot: 8, track: 9 };

const WALL_PALETTE = ['#d9b36c', '#e3c48a', '#d8a7a0', '#e6e0d0', '#cfc8b8', '#b9b4aa', '#a8533a', '#b86a4a', '#a9b99a', '#e8d6a8',
  '#9fb7c4', '#c9a27a', '#e9e4dc', '#d4c3a3', '#c47f5e', '#bfae8e', '#e0cfa9', '#9aa39a'];
const SPECIAL_COL = {
  writers: '#b0442c', redbrick: '#a34a32', white: '#eeeae0', museum: '#e2d2ae', cathedral: '#e8e4da',
  nakhoda: '#a8432f', glass: '#7d97a8', stadium: '#bdbab2'
};
const ROAD_COL = ['#47474a', '#47474a', '#4a4a4c', '#505052', '#58585a', '#505052', '#5e5d5b', '#686660', '#b5a786', '#8a7a5c'].map(C);
const PLACE_PRI = { suburb: 0, town: 0, city: 0, quarter: 1, neighbourhood: 1, village: 2, locality: 2, hamlet: 3 };

export class World {
  constructor(scene, region, opts = {}) {
    this.scene = scene; this.d = region; this.low = !!opts.mobile;
    const b = region.meta.bounds; this.bounds = { x0: b[0], z0: b[1], x1: b[2], z1: b[3] };
    this.TS = region.meta.tile;
    this.tileSet = new Set(region.tiles.map(([x, z]) => x + '_' + z));
    this.tiles = new Map(); this.cache = new Map(); this.loading = new Map();
    this.buildQueue = [];
    this.hooks = []; this.unloadHooks = [];
    this.netStreetGrid = new Grid(60);
    this.elevGrid = new Grid(30); this.bridgeGrid = new Grid(30);
    this.globalCircles = new Grid(16);
    this.lmGrid = new Grid(64); this.lmBlds = [];
    this.ghostPolys = []; this.hidePolys = [];
    this.placeGrid = new Grid(1500);
    this.tex = {};
    this.focus = new THREE.Vector3();
    this.radius = opts.radius || (this.low ? 900 : 1300);
  }

  // ------------------------------------------------------------ startup
  async build(progress = () => { }) {
    this.makeTextures();
    progress(0.06, t('load_ground')); await tick();
    this.buildRiverMask();
    this.buildGround();
    progress(0.12, t('load_roads')); await tick();
    this.prepareNet();
    this.buildOverview();
    for (const p of this.d.places) this.placeGrid.addBox(p, p.x, p.z, p.x, p.z);
  }

  /** the main road network of the whole region (residential and bigger): used by traffic, routing, search, overview */
  prepareNet() {
    this.roads = [];
    for (const r of this.d.roads) {
      const p = r.p, n = p.length / 2;
      let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const rr = { ...r, len, ys: r.y || null, heightFn: r.y ? true : null, elevated: !!r.el, riverBridge: !!r.rb };
      this.roads.push(rr);
      if (rr.ni !== undefined) for (let i = 0; i < n - 1; i++) {
        const s = [p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3], rr.ni, r.k, r.w];
        this.netStreetGrid.addBox(s, Math.min(s[0], s[2]) - 30, Math.min(s[1], s[3]) - 30, Math.max(s[0], s[2]) + 30, Math.max(s[1], s[3]) + 30);
      }
      if (rr.ys) {
        const sw = rr.riverBridge ? 4.5 : 1.0;
        for (let i = 0; i < n - 1; i++) {
          const s = [p[i * 2], p[i * 2 + 1], rr.ys[i], p[i * 2 + 2], p[i * 2 + 3], rr.ys[i + 1], r.w / 2 + sw];
          (rr.riverBridge ? this.bridgeGrid : this.elevGrid).addBox(s, Math.min(s[0], s[3]) - s[6], Math.min(s[1], s[4]) - s[6], Math.max(s[0], s[3]) + s[6], Math.max(s[1], s[4]) + s[6]);
        }
      }
    }
  }

  // low-detail road network for the whole region (visible beyond the loaded tiles)
  buildOverview() {
    const mb = new MeshBuilder();
    for (const r of this.roads) {
      if (r.k > RK.tertiary) continue;
      ribbon(mb, r.p, { w: r.w, y: 0.03, ys: r.ys ? r.ys.map(y => y - 0.08) : null, c: ROAD_COL[r.k] });
    }
    const m = new THREE.Mesh(mb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 }));
    m.receiveShadow = true; m.matrixAutoUpdate = false; this.scene.add(m);
  }

  // ------------------------------------------------------------ textures & materials
  makeTextures() {
    const noise = (ctx, w, h, base, amt, n = 4000) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const v = Math.random() * amt - amt / 2;
        ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
    };
    this.tex.ground = canvasTexture(256, 256, (c, w, h) => noise(c, w, h, '#ffffff', 0.25, 6000));
    this.tex.asphalt = canvasTexture(256, 256, (c, w, h) => {
      noise(c, w, h, '#ffffff', 0.3, 9000);
      c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 2;
      for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(Math.random() * w, Math.random() * h); c.lineTo(Math.random() * w, Math.random() * h); c.stroke(); }
    });
    this.tex.grass = canvasTexture(256, 256, (c, w, h) => {
      noise(c, w, h, '#ffffff', 0.35, 12000);
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(120,90,40,${Math.random() * 0.25})`; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 14, 0, 7); c.fill(); }
    });
    this.tex.windows = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2500; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; c.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 124, 256, 6); c.fillRect(0, 252, 256, 4);
      const bay = (x, y, type) => {
        if (type === 0) {
          c.fillStyle = '#2b3a34'; c.fillRect(x + 34, y + 22, 60, 82);
          c.fillStyle = '#3f7a55'; c.fillRect(x + 34, y + 22, 28, 82); c.fillRect(x + 66, y + 22, 28, 82);
          c.fillStyle = 'rgba(0,0,0,0.3)'; for (let k = 0; k < 82; k += 6) c.fillRect(x + 34, y + 22 + k, 60, 2);
          c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(x + 30, y + 18, 68, 5);
        } else if (type === 1) {
          c.fillStyle = '#34404c'; c.fillRect(x + 30, y + 28, 68, 66);
          c.fillStyle = 'rgba(160,190,210,0.35)'; c.fillRect(x + 32, y + 30, 30, 30);
          c.strokeStyle = '#1d1d1d'; c.lineWidth = 2;
          for (let k = 0; k < 68; k += 11) { c.beginPath(); c.moveTo(x + 30 + k, y + 28); c.lineTo(x + 30 + k, y + 94); c.stroke(); }
        } else if (type === 2) {
          c.fillStyle = '#3a2f28'; c.fillRect(x + 38, y + 16, 52, 96);
          c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(x + 10, y + 108, 108, 10);
          c.strokeStyle = '#2a2a2a'; c.lineWidth = 3;
          c.beginPath(); c.moveTo(x + 12, y + 80); c.lineTo(x + 116, y + 80); c.stroke();
          for (let k = 14; k < 116; k += 8) { c.beginPath(); c.moveTo(x + k, y + 80); c.lineTo(x + k, y + 108); c.stroke(); }
          const cols = ['#e53935', '#fdd835', '#1e88e5', '#ffffff', '#8e24aa'];
          for (let k = 0; k < 3; k++) { c.fillStyle = cols[(x + y + k) % 5]; c.fillRect(x + 20 + k * 30, y + 82, 18, 22); }
        } else {
          c.fillStyle = '#2d343a'; c.beginPath(); c.moveTo(x + 36, y + 106); c.lineTo(x + 36, y + 50);
          c.arc(x + 64, y + 50, 28, Math.PI, 0); c.lineTo(x + 92, y + 106); c.closePath(); c.fill();
          c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 4; c.stroke();
          c.fillStyle = '#3f7a55'; c.fillRect(x + 40, y + 60, 22, 46); c.fillRect(x + 66, y + 60, 22, 46);
        }
      };
      bay(0, 0, 0); bay(128, 0, 1); bay(0, 128, 2); bay(128, 128, 3);
    });
    this.tex.shops = canvasTexture(512, 128, (c) => {
      const signs = ['#d32f2f', '#fbc02d', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b', '#00796b'];
      for (let b = 0; b < 4; b++) {
        const x = b * 128;
        c.fillStyle = '#cfc6b4'; c.fillRect(x, 0, 128, 128);
        c.fillStyle = signs[(b * 3 + 1) % signs.length]; c.fillRect(x + 4, 6, 120, 26);
        c.fillStyle = 'rgba(255,255,255,0.9)'; c.font = 'bold 15px sans-serif';
        const words = ['STORES', 'BHANDAR', 'MEDICAL', 'SWEETS', 'TEA', 'TAILOR', 'MOBILE', 'HOTEL'];
        c.fillText(words[(b * 5) % 8], x + 20, 25);
        if (b % 2 === 0) {
          c.fillStyle = '#8d9196'; c.fillRect(x + 8, 36, 112, 92);
          c.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 36; k < 128; k += 5) c.fillRect(x + 8, k, 112, 2);
        } else {
          c.fillStyle = '#2a2018'; c.fillRect(x + 8, 36, 112, 92);
          for (let k = 0; k < 18; k++) { c.fillStyle = signs[k % signs.length]; c.fillRect(x + 12 + (k % 6) * 18, 42 + Math.floor(k / 6) * 20, 14, 14); }
          c.fillStyle = '#6d4c33'; c.fillRect(x + 8, 104, 112, 24);
        }
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, 0, 4, 128);
      }
    });
    this.tex.water = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#8080ff'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { c.strokeStyle = `rgba(${100 + Math.random() * 60},${100 + Math.random() * 60},255,0.5)`; c.beginPath(); const x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y); c.quadraticCurveTo(x + 10, y - 4, x + 20, y); c.stroke(); }
    });
    this.tex.sidewalk = canvasTexture(128, 128, (c) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, 128, 128);
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 2;
      for (let k = 0; k <= 128; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, 128); c.stroke(); c.beginPath(); c.moveTo(0, k); c.lineTo(128, k); c.stroke(); }
      for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`; c.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
    });
    const off = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; };
    this.mat = {
      ground: off(new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex.ground }), 5),
      landuse: off(new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex.ground }), 4),
      grass: off(new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex.grass }), 2),
      side: off(new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex.sidewalk }), 1),
      road: off(new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex.asphalt }), -1),
      flat: off(new THREE.MeshLambertMaterial({ vertexColors: true }), -2),
      water: off(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x88aaaa }), -3),
      mark: off(new THREE.MeshBasicMaterial({ vertexColors: true }), -4),
      walls: new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex.windows }),
      shops: new THREE.MeshLambertMaterial({ map: this.tex.shops }),
      roofs: new THREE.MeshLambertMaterial({ vertexColors: true }),
      slab: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      pillar: new THREE.MeshLambertMaterial({ color: 0xa8a294 }),
      tank: new THREE.MeshLambertMaterial({ color: 0x222222 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x5a4632 }),
      crown: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      pole: new THREE.MeshLambertMaterial({ color: 0x3b6fb0 }),
      roofShape: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      lampHead: new THREE.MeshLambertMaterial({ color: 0xfff3c4, emissive: 0x665522 }),
    };
    this.geo = {
      box: (() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; })(),
      tank: (() => { const g = new THREE.CylinderGeometry(1, 1, 1.4, 10); g.translate(0, 0.7, 0); return g; })(),
      trunk: (() => { const g = new THREE.CylinderGeometry(0.18, 0.3, 1, 6); g.translate(0, 0.5, 0); return g; })(),
      crown: new THREE.IcosahedronGeometry(1, 1),
      dome: new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1),
      pyramid: (() => { const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); g.rotateY(Math.PI / 4); g.translate(0, 0.5, 0); return g; })(),
      gable: (() => { const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]); const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g; })(),
      pole: (() => { const g = new THREE.CylinderGeometry(0.07, 0.11, 7, 6); g.translate(0, 3.5, 0); return g; })(),
      arm: (() => { const g = new THREE.BoxGeometry(0.08, 0.08, 1.6); g.translate(0, 7, 0.75); return g; })(),
      head: (() => { const g = new THREE.BoxGeometry(0.35, 0.18, 0.6); g.translate(0, 6.9, 1.5); return g; })(),
    };
  }

  // ------------------------------------------------------------ river
  buildRiverMask() {
    const R = 8, { x0, z0, x1, z1 } = this.bounds;
    const w = Math.ceil((x1 - x0) / R), h = Math.ceil((z1 - z0) / R);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff';
    for (const r of this.d.river) {
      c.beginPath();
      for (const ring of [r.p, ...(r.h || [])]) { for (let i = 0; i < ring.length; i += 2) { const X = (ring[i] - x0) / R, Z = (ring[i + 1] - z0) / R; i ? c.lineTo(X, Z) : c.moveTo(X, Z); } c.closePath(); }
      c.fill('evenodd');
    }
    const img = c.getImageData(0, 0, w, h).data;
    this.riverMask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) this.riverMask[i] = img[i * 4] > 127 ? 1 : 0;
    this.rmW = w; this.rmH = h; this.rmR = R;
  }
  inRiver(x, z) {
    const { x0, z0 } = this.bounds;
    const i = Math.floor((x - x0) / this.rmR), j = Math.floor((z - z0) / this.rmR);
    if (i < 0 || j < 0 || i >= this.rmW || j >= this.rmH) return false;
    return this.riverMask[j * this.rmW + i] === 1;
  }

  buildGround() {
    const mb = new MeshBuilder(true), landCol = C('#9a9178'), bankCol = C('#6f6553');
    for (const l of this.d.land) {
      mb.flat(l.p, l.h, 0, landCol, 1 / 10);
      for (const [p, isHole] of [[l.p, false], ...(l.h || []).map(h => [h, true])]) {
        const A = signedArea(p);
        for (let i = 0; i < p.length; i += 2) {
          const j = (i + 2) % p.length, ax = p[i], az = p[i + 1], bx = p[j], bz = p[j + 1];
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
          let nx = dz / L, nz = -dx / L; if (A < 0) { nx = -nx; nz = -nz; } if (isHole) { nx = -nx; nz = -nz; }
          mb.wall(ax, az, bx, bz, -9, 0, nx, nz, bankCol, 0, L / 10, 0, 1);
        }
      }
    }
    const g = new THREE.Mesh(mb.build(), this.mat.ground); g.receiveShadow = true; g.matrixAutoUpdate = false; this.scene.add(g);
    const { x0, z0, x1, z1 } = this.bounds;
    const wg = new THREE.PlaneGeometry(x1 - x0 + 4000, z1 - z0 + 4000, 1, 1); wg.rotateX(-Math.PI / 2);
    this.tex.water.repeat.set(500, 420);
    this.waterMat = new THREE.MeshPhongMaterial({ color: 0x5e7563, specular: 0x667777, shininess: 60, normalMap: this.tex.water, normalScale: new THREE.Vector2(0.4, 0.4), transparent: true, opacity: 0.95 });
    const water = new THREE.Mesh(wg, this.waterMat); water.position.set((x0 + x1) / 2, -2.2, (z0 + z1) / 2);
    this.scene.add(water); this.water = water;
    const bed = new THREE.Mesh(wg.clone(), new THREE.MeshBasicMaterial({ color: 0x2b3328 })); bed.position.set(water.position.x, -9, water.position.z); this.scene.add(bed);
    const outer = new THREE.Shape([new THREE.Vector2(x0 - 8000, z0 - 8000), new THREE.Vector2(x1 + 8000, z0 - 8000), new THREE.Vector2(x1 + 8000, z1 + 8000), new THREE.Vector2(x0 - 8000, z1 + 8000)]);
    outer.holes.push(new THREE.Path([new THREE.Vector2(x0, z0), new THREE.Vector2(x0, z1), new THREE.Vector2(x1, z1), new THREE.Vector2(x1, z0)]));
    const og = new THREE.ShapeGeometry(outer); og.rotateX(Math.PI / 2);
    const om = new THREE.Mesh(og, new THREE.MeshLambertMaterial({ color: 0x8a8370, side: THREE.DoubleSide })); om.position.y = -0.3; this.scene.add(om);
  }

  // ------------------------------------------------------------ tile streaming
  key(tx, tz) { return tx + '_' + tz; }
  tileOf(x, z) { return [Math.floor(x / this.TS), Math.floor(z / this.TS)]; }

  async fetchTile(k) {
    if (this.cache.has(k)) { const d = this.cache.get(k); this.cache.delete(k); this.cache.set(k, d); return d; }
    if (this.loading.has(k)) return this.loading.get(k);
    const pr = fetch(`data/tiles/${k}.json`).then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
      this.loading.delete(k);
      if (d) {
        this.resolveTile(d);
        this.cache.set(k, d);
        while (this.cache.size > 90) { const first = this.cache.keys().next().value; if (this.tiles.has(first)) { const v = this.cache.get(first); this.cache.delete(first); this.cache.set(first, v); break; } this.cache.delete(first); }
      }
      return d;
    });
    this.loading.set(k, pr);
    return pr;
  }
  resolveTile(d) {
    const names = this.names || [];
    for (const k of ['roads', 'buildings', 'parks']) for (const o of (d[k] || [])) if (typeof o.n === 'number') { o.ni = o.n; o.n = names[o.n]?.en || ''; }
  }
  tileData(tx, tz) { return this.cache.get(this.key(tx, tz)) || null; }

  /** call every frame: loads / builds / unloads tiles around the focus point */
  update(focus, radius = this.radius) {
    this.focus.copy(focus);
    const TS = this.TS, need = new Set();
    const [cx, cz] = this.tileOf(focus.x, focus.z), n = Math.ceil(radius / TS) + 1;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const tx = cx + i, tz = cz + j, k = this.key(tx, tz);
      if (!this.tileSet.has(k)) continue;
      const d = this.tileDist(tx, tz, focus);
      if (d > radius) continue;
      need.add(k);
      const tile = this.tiles.get(k);
      const lite = d > 1400;
      if (tile && tile.lite && !lite) { this.unloadTile(tile); }
      if (!this.tiles.has(k) && !this.buildQueue.some(q => q.k === k)) {
        this.buildQueue.push({ k, tx, tz, lite });
        this.fetchTile(k);
      }
    }
    for (const tile of [...this.tiles.values()]) if (!need.has(tile.key) && this.tileDist(tile.tx, tile.tz, focus) > radius + 500) this.unloadTile(tile);
    this.buildQueue = this.buildQueue.filter(q => need.has(q.k) || this.tileDist(q.tx, q.tz, focus) < radius + 300);
    // build at most one ready tile per frame, nearest first
    this.buildQueue.sort((a, b) => this.tileDist(a.tx, a.tz, focus) - this.tileDist(b.tx, b.tz, focus));
    const i = this.buildQueue.findIndex(q => this.cache.has(q.k));
    if (i >= 0) { const q = this.buildQueue.splice(i, 1)[0]; if (!this.tiles.has(q.k)) this.buildTile(q.tx, q.tz, this.cache.get(q.k), q.lite); }
  }
  tileDist(tx, tz, p) {
    const x0 = tx * this.TS, z0 = tz * this.TS;
    const dx = Math.max(x0 - p.x, 0, p.x - (x0 + this.TS)), dz = Math.max(z0 - p.z, 0, p.z - (z0 + this.TS));
    return Math.hypot(dx, dz);
  }
  /** load & build the tiles around a point right now (teleports, spawn) */
  async ensureAround(x, z, r = 350) {
    const [cx, cz] = this.tileOf(x, z), ks = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const tx = cx + i, tz = cz + j, k = this.key(tx, tz);
      if (this.tileSet.has(k) && this.tileDist(tx, tz, { x, z }) <= r) ks.push([tx, tz, k]);
    }
    const data = await Promise.all(ks.map(([, , k]) => this.fetchTile(k)));
    ks.forEach(([tx, tz, k], i) => { const ex = this.tiles.get(k); if (ex && ex.lite) this.unloadTile(ex); if (!this.tiles.has(k) && data[i]) this.buildTile(tx, tz, data[i], false); });
  }
  loadedCount() { return this.tiles.size; }

  unloadTile(tile) {
    this.scene.remove(tile.group);
    tile.group.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); if (o.userData.ownMat) o.material.dispose(); });
    this.tiles.delete(tile.key);
    for (const h of this.unloadHooks) h(tile);
  }

  // ------------------------------------------------------------ tile building
  buildTile(tx, tz, d, lite) {
    const tile = {
      tx, tz, key: this.key(tx, tz), d, lite, group: new THREE.Group(),
      x0: tx * this.TS, z0: tz * this.TS, x1: (tx + 1) * this.TS, z1: (tz + 1) * this.TS,
      blds: [], bldGrid: new Grid(32), streetGrid: new Grid(40), roadGrid: new Grid(40), circleGrid: new Grid(16), elevGrid: new Grid(30),
      roads: [],
    };
    tile.group.matrixAutoUpdate = false;
    this.buildTileGround(tile);
    this.buildTileRoads(tile);
    this.buildTileRails(tile);
    this.buildTileBuildings(tile);
    if (!lite) { this.buildTileTrees(tile); this.buildTileLamps(tile); this.buildTileCrossings(tile); }
    this.tiles.set(tile.key, tile);
    for (const h of this.hooks) h(tile);
    this.scene.add(tile.group);
    tile.group.updateMatrixWorld(true);
    return tile;
  }
  addMesh(tile, geom, mat, opts = {}) {
    if (!geom.attributes.position) return null;
    const m = new THREE.Mesh(geom, mat);
    m.receiveShadow = opts.receive ?? true; m.castShadow = !!opts.cast && !tile.lite;
    m.matrixAutoUpdate = false; tile.group.add(m); return m;
  }
  addInstanced(tile, geom, mat, list, setter, opts = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geom, mat, list.length);
    im.userData.shared = true;
    const m = new THREE.Matrix4();
    list.forEach((it, i) => { setter(m, it, i, im); im.setMatrixAt(i, m); });
    im.castShadow = !!opts.cast && !tile.lite; im.receiveShadow = opts.receive ?? false;
    im.matrixAutoUpdate = false; im.computeBoundingSphere();
    tile.group.add(im); return im;
  }
  tileAddCircle(tile, x, z, r) { const c = [x, z, r]; tile.circleGrid.addBox(c, x - r, z - r, x + r, z + r); }

  buildTileGround(tile) {
    const d = tile.d;
    const lu = new MeshBuilder(true), lcol = [C('#a1987f'), C('#aaa18b'), C('#8d887d'), C('#857a6a'), C('#7d8866')];
    for (const l of (d.landuse || [])) lu.flat(l.p, l.h, 0.02, lcol[l.k] || lcol[0], 1 / 10);
    const ap = C('#9a9a96');
    for (const a of (d.aprons || [])) lu.flat(a.p, a.h, 0.05, ap, 1 / 10);
    this.addMesh(tile, lu.build(), this.mat.landuse);
    const g = new MeshBuilder(true), pcol = [C('#5f8c3e'), C('#74a84c'), C('#6b9c45'), C('#4d7b36'), C('#6f8f55')];
    for (const pk of (d.parks || [])) g.flat(pk.p, pk.h, 0.04, pcol[pk.k || 0], 1 / 6);
    this.addMesh(tile, g.build(), this.mat.grass);
    const w = new MeshBuilder(), wc = C('#4b7f80');
    for (const pd of (d.water || [])) w.flat(pd.p, pd.h, 0.09, wc);
    for (const cn of (d.canals || [])) ribbon(w, cn.p, { w: cn.w, y: 0.08, c: wc, ext: 1 });
    this.addMesh(tile, w.build(), this.mat.water);
    // airport runways & taxiways with markings
    if (d.aero && d.aero.length) {
      const rw = new MeshBuilder(), mk = new MeshBuilder(), runC = C('#3a3a3c'), taxC = C('#4a4a4a'), white = C('#f4f4f4'), yel = C('#f2c230');
      for (const a of d.aero) {
        ribbon(rw, a.p, { w: a.w, y: a.k === 0 ? 0.09 : 0.08, c: a.k === 0 ? runC : taxC, ext: a.k === 0 ? 0 : a.w / 2 });
        if (a.k === 0) { dashes(mk, a.p, null, 0.12, white, [0], 0.45, 30, 20); dashes(mk, a.p, null, 0.12, white, [-a.w / 2 + 1, a.w / 2 - 1], 0.25, 1e6, 0); }
        else dashes(mk, a.p, null, 0.11, yel, [0], 0.15, 1e6, 0);
      }
      this.addMesh(tile, rw.build(), this.mat.road);
      this.addMesh(tile, mk.build(), this.mat.mark, { receive: false });
    }
  }

  buildTileRoads(tile) {
    const road = new MeshBuilder(true), side = new MeshBuilder(true), foot = new MeshBuilder(true), marks = new MeshBuilder(), slabs = new MeshBuilder();
    const colSide = C('#b3ada0'), colSlab = C('#9c978c'), white = C('#f2f2f2'), yellow = C('#f2c230');
    const pillars = [];
    const yOf = (k) => k <= 4 ? 0.16 : k <= 6 ? 0.13 : k === 7 ? 0.11 : 0.07;
    for (const r of (tile.d.roads || [])) {
      const p = r.p, k = r.k, n = p.length / 2;
      if (n < 2) continue;
      let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const y = yOf(k), ys = r.y || null;
      const rr = { ...r, len, ys }; tile.roads.push(rr);
      // grids
      for (let i = 0; i < n - 1; i++) {
        const s = [p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3], r.ni, k, r.w];
        if (k < RK.foot) tile.roadGrid.addBox(s, Math.min(s[0], s[2]) - r.w, Math.min(s[1], s[3]) - r.w, Math.max(s[0], s[2]) + r.w, Math.max(s[1], s[3]) + r.w);
        if (r.ni !== undefined) tile.streetGrid.addBox(s, Math.min(s[0], s[2]) - 30, Math.min(s[1], s[3]) - 30, Math.max(s[0], s[2]) + 30, Math.max(s[1], s[3]) + 30);
        if (ys && k > RK.residential) { const e = [p[i * 2], p[i * 2 + 1], ys[i], p[i * 2 + 2], p[i * 2 + 3], ys[i + 1], r.w / 2 + 1]; tile.elevGrid.addBox(e, Math.min(e[0], e[3]) - e[6], Math.min(e[1], e[4]) - e[6], Math.max(e[0], e[3]) + e[6], Math.max(e[1], e[4]) + e[6]); }
      }
      if (k === RK.foot || k === RK.track) { ribbon(foot, p, { w: r.w, y, ys, c: ROAD_COL[k], ext: 0.5, uvLen: 4 }); continue; }
      ribbon(road, p, { w: r.w, y, ys, c: ROAD_COL[k], ext: r.w * 0.45, uvLen: 8 });
      if (ys) {
        const sw = r.rb ? 4.5 : 1.0;
        ribbon(slabs, p, { w: r.w + sw * 2, ys: ys.map(v => v - 0.04), c: colSlab, slab: r.rb ? 2.2 : 1.3, parapet: 1.0, slabColor: colSlab });
        if (r.el) {
          let acc = 14;
          for (let i = 0; i < n - 1; i++) {
            const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3], sl = Math.hypot(bx - ax, bz - az);
            while (acc < sl) { const f = acc / sl, h = ys[i] + (ys[i + 1] - ys[i]) * f; if (h > 3) pillars.push([ax + (bx - ax) * f, az + (bz - az) * f, h - 1.3, Math.atan2(bx - ax, bz - az), r.w]); acc += 28; }
            acc -= sl;
          }
        }
      } else if ((k <= RK.tertiary || k === RK.link) && !tile.lite) {
        ribbon(side, p, { w: r.w + 6, y: 0.1, c: colSide, ext: r.w * 0.45 + 3, uvLen: 2.5 });
      }
      if (!tile.lite && k <= RK.tertiary && r.w >= 6) this.roadMarkings(marks, r, p, ys, y + 0.02, white, yellow);
    }
    this.addMesh(tile, side.build(), this.mat.side);
    this.addMesh(tile, road.build(), this.mat.road);
    this.addMesh(tile, foot.build(), this.mat.road);
    this.addMesh(tile, marks.build(), this.mat.mark, { receive: false });
    this.addMesh(tile, slabs.build(), this.mat.slab, { cast: true });
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), pp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this.addInstanced(tile, this.geo.box, this.mat.pillar, pillars, (m, pl) => { q.setFromAxisAngle(up, pl[3]); s.set(Math.min(pl[4] * 0.55, 7), pl[2], 1.6); pp.set(pl[0], 0, pl[1]); m.compose(pp, q, s); this.tileAddCircle(tile, pl[0], pl[1], 1.2); }, { cast: true, receive: true });
  }

  /** Indian road markings: two-way roads get centre lines (double yellow on main roads, dashed white on smaller ones),
   *  one-way roads get lane dividers + direction arrows, big roads get edge lines. */
  roadMarkings(mb, r, p, ys, y, white, yellow) {
    const w = r.w, lanes = r.ln || Math.max(1, Math.round(w / 3.4));
    const hf = ys ? heightFromYs(p, ys, 0.02) : null;
    if (!r.ow) {
      if (r.k <= RK.primary) dashes(mb, p, hf, y, yellow, [-0.18, 0.18], 0.08, 1e6, 0);       // double solid yellow
      else dashes(mb, p, hf, y, white, [0], 0.08, 3, 5);                                     // dashed white centre
      const per = Math.floor(lanes / 2);
      for (let i = 1; i < per; i++) { const o = i * (w / 2) / per; dashes(mb, p, hf, y, white, [-o, o], 0.07, 3, 6); }
    } else {
      for (let i = 1; i < lanes; i++) dashes(mb, p, hf, y, white, [-w / 2 + i * w / lanes], 0.07, 3, 6);
      if (r.len > 40) arrows(mb, p, hf, y, white, lanes, w);
    }
    if (r.k <= RK.secondary) dashes(mb, p, hf, y, white, [-w / 2 + 0.35, w / 2 - 0.35], 0.07, 1e6, 0); // edge lines
  }

  buildTileRails(tile) {
    const rails = new MeshBuilder(), bal = new MeshBuilder(true);
    const steel = C('#3b3b3d'), ballast = C('#7a6f62'), sleepers = C('#5b4c3e');
    tile.tramLines = [];
    for (const r of (tile.d.rails || [])) {
      const tram = r.k === 1, y = tram ? 0.2 : 0.12;
      if (!tram) ribbon(bal, r.p, { w: 3.4, y: 0.09, c: ballast, uvLen: 3 });
      else tile.tramLines.push(r.p);
      const g = tram ? 0.72 : 0.84;
      for (const off of [-g, g]) ribbon(rails, offsetLine(r.p, off), { w: 0.14, y, c: steel });
      if (!tram && !tile.lite) dashes(rails, r.p, null, 0.1, sleepers, [0], 1.25, 0.3, 1.2);
    }
    this.addMesh(tile, bal.build(), this.mat.side);
    this.addMesh(tile, rails.build(), this.mat.flat);
  }

  buildTileBuildings(tile) {
    const wl = new MeshBuilder(true), sh = new MeshBuilder(true), rf = new MeshBuilder();
    const tanks = [], roofs = [], R = rng(tile.tx * 7919 + tile.tz * 104729), GF = 3.8, white = C('#ffffff');
    for (const b of (tile.d.buildings || [])) {
      const p = b.p, seed = hashStr(p[0] + ':' + p[1]);
      if (this.hidePolys.length) { const [hx, hz] = centroid(p); if (this.hidePolys.some(h => pointInPoly(hx, hz, h))) continue; }
      let ht = b.ht;
      if (b.s === 'writers') ht = Math.max(ht, 21);
      if (b.s === 'redbrick' || b.s === 'museum') ht = Math.max(ht, 15);
      let col;
      if (b.c) col = C(b.c);                       // surveyed building:colour / material
      else if (b.s && SPECIAL_COL[b.s]) col = C(SPECIAL_COL[b.s]);
      else { col = C(WALL_PALETTE[seed % WALL_PALETTE.length]); col.multiplyScalar(0.82 + (seed >> 8) % 100 / 100 * 0.22); }
      const roof = b.rc ? C(b.rc) : col.clone().multiplyScalar(0.62).lerp(C('#6d6a63'), 0.4);
      const [cx, cz] = centroid(p);
      const shopFront = !tile.lite && ht >= 7 && !b.s && b.b !== 'house' && (seed % 5) !== 0;
      const uOff = (seed % 4) * 0.5;
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      for (const [ring, isHole] of [[p, false], ...(b.h || []).map(h => [h, true])]) {
        const A = signedArea(ring); let per = 0;
        for (let i = 0; i < ring.length; i += 2) {
          const j = (i + 2) % ring.length, ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
          let nx = dz / L, nz = -dx / L; if (A < 0) { nx = -nx; nz = -nz; } if (isHole) { nx = -nx; nz = -nz; }
          const u0 = per / 8 + uOff, u1 = (per + L) / 8 + uOff;
          if (shopFront && !isHole) {
            sh.wall(ax, az, bx, bz, 0, GF, nx, nz, white, per / 16, (per + L) / 16, 0, 1);
            wl.wall(ax, az, bx, bz, GF, ht, nx, nz, col, u0, u1, 0, (ht - GF) / 6.8);
          } else wl.wall(ax, az, bx, bz, 0, ht, nx, nz, col, u0, u1, 0, ht / 6.8);
          per += L;
        }
      }
      rf.flat(p, b.h, ht, roof);
      if (b.rs) roofs.push([b.rs, (x0 + x1) / 2, ht, (z0 + z1) / 2, x1 - x0, z1 - z0, roof]);
      if (!tile.lite && ht > 6 && (x1 - x0) * (z1 - z0) > 80 && R() < 0.5 && pointInPoly(cx, cz, p)) tanks.push([cx + (R() - 0.5) * 2, ht, cz + (R() - 0.5) * 2, 0.6 + R() * 0.5]);
      const rec = { p, h: b.h, x0, z0, x1, z1, ht, n: b.n, ni: b.ni, s: b.s, b: b.b, rel: b.rel, cx, cz };
      if (this.ghostPolys.some(g => pointInPoly(cx, cz, g))) rec.ghost = true;
      tile.blds.push(rec);
      tile.bldGrid.addBox(rec, x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    }
    this.addMesh(tile, wl.build(), this.mat.walls, { cast: true });
    this.addMesh(tile, sh.build(), this.mat.shops);
    this.addMesh(tile, rf.build(), this.mat.roofs, { cast: true });
    // roof:shape from OSM (dome / pyramidal-hipped / gabled), sized to the footprint
    for (const [k, g] of [['d', this.geo.dome], ['p', this.geo.pyramid], ['g', this.geo.gable]]) {
      const list = roofs.filter(r => r[0] === k);
      this.addInstanced(tile, g, this.mat.roofShape, list, (m, r, i, im) => {
        const s = Math.min(r[4], r[5]), hgt = k === 'd' ? s * 0.5 : k === 'p' ? s * 0.35 : s * 0.3;
        m.makeScale(k === 'd' ? s * 0.9 : r[4], hgt, k === 'd' ? s * 0.9 : r[5]); m.setPosition(r[1], r[2], r[3]); im.setColorAt(i, r[6]);
      }, { cast: true });
    }
    this.addInstanced(tile, this.geo.tank, this.mat.tank, tanks, (m, tk) => { m.makeScale(tk[3], 1, tk[3]); m.setPosition(tk[0], tk[1], tk[2]); }, { cast: true });
  }

  buildTileTrees(tile) {
    const R = rng(tile.tx * 31 + tile.tz * 17 + 99), pts = [], d = tile.d;
    const inWater = (x, z) => (d.water || []).some(w => pointInPoly(x, z, w.p));
    for (const pk of (d.parks || [])) {
      if (pk.k === 1 || (d.aero && d.aero.length) || (d.aprons && d.aprons.length)) continue; // no forest on the airfield
      const p = pk.p;
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      const count = Math.min(500, Math.floor(Math.abs(signedArea(p)) / (pk.k === 3 ? 110 : 280)));
      let tries = count * 3;
      for (let c = 0; c < count && tries-- > 0;) {
        const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
        if (!pointInPoly(x, z, p) || inWater(x, z) || this.insideBuildingTile(tile, x, z) || this.nearRoadTile(tile, x, z, 1.5)) continue;
        pts.push([x, z, 0.7 + R() * 0.8, R()]); c++;
      }
    }
    for (const [x, z] of (d.trees || [])) if (!this.insideBuildingTile(tile, x, z)) pts.push([x, z, 0.9 + R() * 0.5, R()]);
    for (const r of tile.roads) {
      if (r.k > RK.tertiary || r.ys) continue;
      walkLine(r.p, 24, (x, z, nx, nz, i) => {
        const sd = (i % 2) ? 1 : -1, tx = x + nx * sd * (r.w / 2 + 2), tz = z + nz * sd * (r.w / 2 + 2);
        if (R() < 0.5 && !this.insideBuildingTile(tile, tx, tz) && !this.inRiver(tx, tz)) pts.push([tx, tz, 0.6 + R() * 0.5, R()]);
      });
    }
    if (this.hidePolys.length) { const keep = pts.filter(t => !this.treeFree(t[0], t[1])); pts.length = 0; pts.push(...keep); }
    if (pts.length > (this.low ? 300 : 900)) pts.length = this.low ? 300 : 900;
    const greens = ['#3f6b2a', '#4c7a30', '#5a8a36', '#365e26', '#6b8f3a'].map(C);
    this.addInstanced(tile, this.geo.trunk, this.mat.trunk, pts, (m, tr) => { m.makeScale(tr[2] * 1.2, 4 * tr[2] + 1.5, tr[2] * 1.2); m.setPosition(tr[0], 0, tr[1]); this.tileAddCircle(tile, tr[0], tr[1], 0.35 * tr[2] + 0.15); }, { cast: true });
    this.addInstanced(tile, this.geo.crown, this.mat.crown, pts, (m, tr, i, im) => { m.makeScale(3.2 * tr[2] + 1.2, 2.6 * tr[2] + 1.2, 3.2 * tr[2] + 1.2); m.setPosition(tr[0], 4 * tr[2] + 2.6, tr[1]); im.setColorAt(i, greens[Math.floor(tr[3] * greens.length)]); }, { cast: true, receive: true });
  }

  buildTileLamps(tile) {
    const pts = [];
    for (const r of tile.roads) {
      if (r.k > RK.secondary || r.ys) continue;
      walkLine(r.p, 32, (x, z, nx, nz, i) => {
        const sd = (i % 2) ? 1 : -1, off = r.w / 2 + 0.7, lx = x + nx * sd * off, lz = z + nz * sd * off;
        if (!this.insideBuildingTile(tile, lx, lz)) pts.push([lx, lz, Math.atan2(-nx * sd, -nz * sd)]);
      });
    }
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pp = new THREE.Vector3();
    const set = (m, l) => { q.setFromAxisAngle(up, l[2]); pp.set(l[0], 0.1, l[1]); m.compose(pp, q, one); };
    this.addInstanced(tile, this.geo.pole, this.mat.pole, pts, (m, l) => { set(m, l); this.tileAddCircle(tile, l[0], l[1], 0.18); }, { cast: true });
    this.addInstanced(tile, this.geo.arm, this.mat.pole, pts, set);
    this.addInstanced(tile, this.geo.head, this.mat.lampHead, pts, set);
  }

  buildTileCrossings(tile) {
    const mb = new MeshBuilder(), white = C('#f2f2f2');
    for (const [x, z, ang, w] of (tile.d.crossings || [])) {
      const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux, y = 0.19;
      for (let s = -w / 2 + 0.4; s < w / 2 - 0.3; s += 1.0) {
        const cx = x + vx * s, cz = z + vz * s;
        const a = mb.v(cx - ux * 1.6 - vx * 0.25, y, cz - uz * 1.6 - vz * 0.25, 0, 1, 0, white), b = mb.v(cx + ux * 1.6 - vx * 0.25, y, cz + uz * 1.6 - vz * 0.25, 0, 1, 0, white);
        const c = mb.v(cx + ux * 1.6 + vx * 0.25, y, cz + uz * 1.6 + vz * 0.25, 0, 1, 0, white), e = mb.v(cx - ux * 1.6 + vx * 0.25, y, cz - uz * 1.6 + vz * 0.25, 0, 1, 0, white);
        mb.tri(a, b, c); mb.tri(a, c, e); mb.tri(a, c, b); mb.tri(a, e, c);
      }
    }
    this.addMesh(tile, mb.build(), this.mat.mark, { receive: false });
  }

  // ------------------------------------------------------------ queries
  tilesAt(x, z, margin = 160) {
    const out = [], [cx, cz] = this.tileOf(x, z);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const tile = this.tiles.get(this.key(cx + i, cz + j));
      if (tile && x > tile.x0 - margin && x < tile.x1 + margin && z > tile.z0 - margin && z < tile.z1 + margin) out.push(tile);
    }
    return out;
  }
  /** all building records in loaded tiles (for maps/landmarks) */
  *allBuildings() { for (const tile of this.tiles.values()) yield* tile.blds; yield* this.lmBlds; }
  get blds() { return [...this.allBuildings()]; }

  addCircle(x, z, r) { const c = [x, z, r]; this.globalCircles.addBox(c, x - r, z - r, x + r, z + r); }
  addCollider(poly, ht = 20, name) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < poly.length; i += 2) { x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); z0 = Math.min(z0, poly[i + 1]); z1 = Math.max(z1, poly[i + 1]); }
    const [cx, cz] = centroid(poly);
    const rec = { p: poly, x0, z0, x1, z1, ht, n: name, cx, cz, landmark: true };
    this.lmBlds.push(rec); this.lmGrid.addBox(rec, x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    return rec;
  }
  /** hand-modelled landmark replaces the OSM footprints here: don't draw them (rebuilds loaded tiles) */
  treeFree(x, z) { return this.hidePolys.length > 0 && this.hidePolys.some(h => pointInPoly(x, z, h)); } // landmark sites
  hideBuildingsIn(poly) {
    this.hidePolys.push(poly); this.removeBuildingsIn(poly);
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < poly.length; i += 2) { x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); z0 = Math.min(z0, poly[i + 1]); z1 = Math.max(z1, poly[i + 1]); }
    for (const tile of [...this.tiles.values()]) if (!(tile.x1 < x0 || tile.x0 > x1 || tile.z1 < z0 || tile.z0 > z1)) { const { tx, tz, d, lite } = tile; this.unloadTile(tile); this.buildTile(tx, tz, d, lite); }
  }
  removeBuildingsIn(poly) {
    this.ghostPolys.push(poly);
    for (const tile of this.tiles.values()) for (const b of tile.blds) if (pointInPoly(b.cx, b.cz, poly)) b.ghost = true;
  }
  insideBuildingTile(tile, x, z) {
    for (const b of tile.bldGrid.query(x, z)) {
      if (b.ghost || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (pointInPoly(x, z, b.p) && !(b.h && b.h.some(h => pointInPoly(x, z, h)))) return b;
    }
    return null;
  }
  insideBuilding(x, z) {
    for (const tile of this.tilesAt(x, z)) { const b = this.insideBuildingTile(tile, x, z); if (b) return b; }
    for (const b of this.lmGrid.query(x, z)) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPoly(x, z, b.p)) return b;
    return null;
  }
  nearRoadTile(tile, x, z, extra = 0) {
    for (const s of tile.roadGrid.query(x, z)) if (distToSeg(x, z, s[0], s[1], s[2], s[3]).d < s[6] / 2 + extra) return true;
    return false;
  }
  nearRoad(x, z, extra = 0) {
    for (const tile of this.tilesAt(x, z, 40)) if (this.nearRoadTile(tile, x, z, extra)) return true;
    for (const s of this.netStreetGrid.query(x, z)) if (distToSeg(x, z, s[0], s[1], s[2], s[3]).d < s[6] / 2 + extra) return true;
    return false;
  }
  nearCircle(x, z, r) {
    for (const g of [this.globalCircles, ...this.tilesAt(x, z, 20).map(t => t.circleGrid)])
      for (const c of g.query(x, z)) if (Math.hypot(x - c[0], z - c[1]) < r + c[2]) return true;
    return false;
  }
  onRiverBridge(x, z) {
    for (const s of this.bridgeGrid.query(x, z)) if (distToSeg(x, z, s[0], s[1], s[3], s[4]).d < s[6] + 0.6) return true;
    return false;
  }
  groundAt(x, z, y = 0) {
    let g = 0;
    const grids = [this.elevGrid, ...this.tilesAt(x, z, 20).map(t => t.elevGrid)];
    for (const grid of grids) for (const s of grid.query(x, z)) {
      const r = distToSeg(x, z, s[0], s[1], s[3], s[4]);
      if (r.d < s[6]) { const h = s[2] + (s[5] - s[2]) * r.t; if (h <= y + 0.9 && h > g) g = h; }
    }
    if (this.inRiver(x, z) && this.onRiverBridge(x, z)) g = Math.max(g, 0.45);
    else if (g === 0) g = 0.12;
    return g;
  }

  collide(pos, r, prev) {
    const tiles = this.tilesAt(pos.x, pos.z, 40);
    const grids = [...tiles.map(t => t.bldGrid), this.lmGrid];
    for (let iter = 0; iter < 2; iter++) {
      for (const grid of grids) for (const b of grid.query(pos.x, pos.z)) {
        if (b.ghost || pos.y > b.ht + 0.2) continue;
        if (pos.x < b.x0 - r || pos.x > b.x1 + r || pos.z < b.z0 - r || pos.z > b.z1 + r) continue;
        for (const p of (b.h ? [b.p, ...b.h] : [b.p])) {
          for (let i = 0; i < p.length; i += 2) {
            const j = (i + 2) % p.length;
            const q = distToSeg(pos.x, pos.z, p[i], p[i + 1], p[j], p[j + 1]);
            if (q.d < r && q.d > 1e-6) { const k = (r - q.d) / q.d; pos.x += (pos.x - q.cx) * k; pos.z += (pos.z - q.cz) * k; }
          }
        }
        if (prev && pointInPoly(pos.x, pos.z, b.p) && !(b.h && b.h.some(h => pointInPoly(pos.x, pos.z, h)))) { pos.x = prev.x; pos.z = prev.z; }
      }
    }
    if (pos.y < 4) {
      for (const g of [this.globalCircles, ...tiles.map(t => t.circleGrid)]) for (const c of g.query(pos.x, pos.z)) {
        const dx = pos.x - c[0], dz = pos.z - c[1], d = Math.hypot(dx, dz), m = r + c[2];
        if (d < m && d > 1e-6) { pos.x = c[0] + dx / d * m; pos.z = c[1] + dz / d * m; }
      }
    }
    if (this.inRiver(pos.x, pos.z) && !this.onRiverBridge(pos.x, pos.z) && prev) { pos.x = prev.x; pos.z = prev.z; return 'river'; }
    const B = this.bounds;
    pos.x = Math.max(B.x0 + 5, Math.min(B.x1 - 5, pos.x)); pos.z = Math.max(B.z0 + 5, Math.min(B.z1 - 5, pos.z));
    return null;
  }

  streetAt(x, z) { const i = this.streetIdAt(x, z); return i === null ? '' : tn(i); }
  streetIdAt(x, z, maxD = 28) {
    let best = null, bd = maxD;
    const grids = [this.netStreetGrid, ...this.tilesAt(x, z, 30).map(t => t.streetGrid)];
    for (const g of grids) for (const s of g.query(x, z)) {
      if (s[4] === undefined) continue;
      const d = distToSeg(x, z, s[0], s[1], s[2], s[3]).d - s[6] / 2 - (s[5] <= 3 ? 3 : 0);
      if (d < bd) { bd = d; best = s[4]; }
    }
    return best;
  }
  /** area name from OSM place nodes (suburb / neighbourhood / ...) */
  districtAt(x, z) {
    if (this.inRiver(x, z)) return t('river');
    let best = null, bs = 1e18;
    for (const p of this.placeGrid.queryRadius(x, z, 2500)) {
      const d = Math.hypot(p.x - x, p.z - z); if (d > 2500) continue;
      const s = d * (1 + 0.25 * (PLACE_PRI[p.k] ?? 2)) * (p.k === 'suburb' ? 0.8 : 1);
      if (s < bs) { bs = s; best = p; }
    }
    return best ? tn(best.ni) : t('kolkata');
  }
  parkAt(x, z) {
    for (const tile of this.tilesAt(x, z, 0)) for (const pk of (tile.d.parks || [])) if (pk.ni !== undefined && pointInPoly(x, z, pk.p)) return pk;
    return null;
  }

  findSafeSpot(x, z, needRoad = true) {
    for (let r = 0; r < 220; r += 2) {
      const steps = Math.max(1, Math.floor(r * 1.5));
      for (let i = 0; i < steps; i++) {
        const a = i / steps * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!this.insideBuilding(px, pz) && !this.inRiver(px, pz) && !this.nearCircle(px, pz, 0.8) && (!needRoad || this.nearRoad(px, pz, 4))) return [px, pz];
      }
    }
    return [x, z];
  }
}

// ------------------------------------------------------------ helpers
function heightFromYs(p, ys, add = 0) {
  const cum = [0]; for (let i = 1; i < p.length / 2; i++) cum.push(cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]));
  return (u, s) => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return ys[i - 1] + (ys[i] - ys[i - 1]) * f + add; };
}

function offsetLine(p, off) {
  const n = p.length / 2, out = [];
  for (let i = 0; i < n; i++) {
    const pi = Math.max(0, i - 1), ni = Math.min(n - 1, i + 1);
    let tx = p[ni * 2] - p[pi * 2], tz = p[ni * 2 + 1] - p[pi * 2 + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.push(p[i * 2] - tz * off, p[i * 2 + 1] + tx * off);
  }
  return out;
}

export function walkLine(p, step, fn) {
  let acc = step / 2, idx = 0;
  for (let i = 0; i < p.length / 2 - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    while (acc < L) { fn(ax + tx * acc, az + tz * acc, -tz, tx, idx++); acc += step; }
    acc -= L;
  }
}

/** painted line pieces along a polyline. offs = lateral offsets; dash/gap in metres (gap 0 = solid) */
function dashes(mb, p, heightFn, y, c, offs, w = 0.15, dash = 3, gap = 6) {
  const n = p.length / 2; let s = 0, acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
    if (gap === 0) acc = 0;
    while (acc < L) {
      const e = Math.min(L, acc + (gap === 0 ? L : dash));
      const y0 = heightFn ? heightFn(0, s + acc) : y, y1 = heightFn ? heightFn(0, s + e) : y;
      for (const off of offs) {
        const x0 = ax + tx * acc + nx * off, z0 = az + tz * acc + nz * off, x1 = ax + tx * e + nx * off, z1 = az + tz * e + nz * off;
        const a = mb.v(x0 + nx * w, y0, z0 + nz * w, 0, 1, 0, c), b = mb.v(x0 - nx * w, y0, z0 - nz * w, 0, 1, 0, c);
        const d = mb.v(x1 + nx * w, y1, z1 + nz * w, 0, 1, 0, c), f = mb.v(x1 - nx * w, y1, z1 - nz * w, 0, 1, 0, c);
        mb.tri(a, b, d); mb.tri(b, f, d); mb.tri(a, d, b); mb.tri(b, d, f);
      }
      if (gap === 0) break;
      acc += dash + gap;
    }
    if (gap !== 0) acc -= L;
    s += L;
  }
}

/** white direction arrows for one-way roads, one per lane every ~60 m */
function arrows(mb, p, heightFn, y, c, lanes, w) {
  walkLine(p, 60, (x, z, nx, nz, i) => {
    const tx = nz, tz = -nx; // direction of travel
    for (let l = 0; l < lanes; l++) {
      const off = -w / 2 + (l + 0.5) * w / lanes;
      const cx = x + nx * off, cz = z + nz * off, yy = heightFn ? y : y;
      const P = (a, b) => mb.v(cx + tx * a + nx * b, yy, cz + tz * a + nz * b, 0, 1, 0, c);
      const s0 = P(-2.2, -0.12), s1 = P(-2.2, 0.12), s2 = P(0.6, 0.12), s3 = P(0.6, -0.12);
      mb.tri(s0, s1, s2); mb.tri(s0, s2, s3); mb.tri(s0, s2, s1); mb.tri(s0, s3, s2);
      const h0 = P(0.6, -0.55), h1 = P(0.6, 0.55), h2 = P(1.8, 0);
      mb.tri(h0, h1, h2); mb.tri(h0, h2, h1);
    }
    void i;
  });
}
