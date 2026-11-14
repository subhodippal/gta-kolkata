// Real satellite imagery on the ground and the map.
// Source: "Sentinel-2 cloudless 2023" by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2023),
// licence CC BY-NC-SA 4.0 — free for non-commercial use with attribution (shown in the HUD and the map).
// ~10 m imagery: gives every place its real ground colour (green cover, fields, ponds, bare land, roof mass),
// the 3D buildings / roads from OpenStreetMap stand on top of it.
import * as THREE from 'three';

export const SAT_URL = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${z}/${y}/${x}.jpg`;
export const SAT_ATTR = 'Sentinel-2 cloudless 2023 © EOX (CC BY-NC-SA 4.0), Copernicus data';
const ZOOM = 16;            // ~2.2 m / px at Kolkata (imagery itself is ~10 m)
const imgCache = new Map();  // url -> Promise<HTMLImageElement|null>

export function satImage(z, x, y) {
  const url = SAT_URL(z, x, y);
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
    imgCache.set(url, p);
    if (imgCache.size > 1500) imgCache.delete(imgCache.keys().next().value);
  }
  return p;
}

// local metres <-> lat/lon <-> web-mercator pixels
export function makeProj(meta) {
  const toLL = (x, z) => [meta.lat0 - z / meta.kz, meta.lon0 + x / meta.kx];
  const toPx = (lat, lon, zm) => {
    const n = 256 * 2 ** zm, s = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  };
  return { toLL, toPx, px: (x, z, zm) => { const [la, lo] = toLL(x, z); return toPx(la, lo, zm); } };
}

let enabled = true;
try { enabled = localStorage.getItem('kc_sat') !== '0'; } catch { /* storage blocked */ }
export const satEnabled = () => enabled;

export class SatelliteGround {
  constructor(world) {
    this.world = world; this.proj = makeProj(world.d.meta);
    this.mats = new Map();
    world.hooks.push(t => this.addTile(t));
    world.unloadHooks.push(t => this.dropTile(t));
    for (const t of world.tiles.values()) this.addTile(t);
    document.getElementById('satAttr')?.classList.toggle('hidden', !enabled);
    // keep the river open: the imagery is masked by the river polygons (8 m mask)
    this.alphaFor = (tile) => {
      const W = world, R = W.rmR, n = Math.round(W.TS / R), cv = document.createElement('canvas'); cv.width = cv.height = n;
      const c = cv.getContext('2d'), id = c.createImageData(n, n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const v = W.inRiver(tile.x0 + (i + 0.5) * R, tile.z0 + (j + 0.5) * R) ? 0 : 255, o = (j * n + i) * 4;
        id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
      }
      c.putImageData(id, 0, 0);
      return new THREE.CanvasTexture(cv);
    };
  }

  setEnabled(on) {
    enabled = on; document.getElementById('satAttr')?.classList.toggle('hidden', !on); try { localStorage.setItem('kc_sat', on ? '1' : '0'); } catch { /* ignore */ }
    for (const t of this.world.tiles.values()) { if (on) this.addTile(t); else this.dropTile(t); }
  }

  async addTile(tile) {
    if (!enabled || tile.sat) return;
    tile.sat = 'loading';
    const P = this.proj, [ax, ay] = P.px(tile.x0, tile.z0, ZOOM), [bx, by] = P.px(tile.x1, tile.z1, ZOOM);
    const W = Math.round(bx - ax), H = Math.round(by - ay);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), jobs = [];
    for (let ty = Math.floor(ay / 256); ty <= Math.floor(by / 256); ty++)
      for (let tx = Math.floor(ax / 256); tx <= Math.floor(bx / 256); tx++)
        jobs.push(satImage(ZOOM, tx, ty).then(im => { if (im) c.drawImage(im, tx * 256 - ax, ty * 256 - ay); return !!im; }));
    const ok = (await Promise.all(jobs)).some(Boolean);
    if (!ok || tile.sat !== 'loading' || this.world.tiles.get(tile.key) !== tile) { if (tile.sat === 'loading') tile.sat = null; return; }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const hasRiver = this.tileTouchesRiver(tile);
    const mat = new THREE.MeshLambertMaterial({
      map: tex, alphaMap: hasRiver ? this.alphaFor(tile) : null, alphaTest: hasRiver ? 0.5 : 0,
      polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 1.5,
    });
    const g = new THREE.PlaneGeometry(this.world.TS, this.world.TS); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set((tile.x0 + tile.x1) / 2, 0.05, (tile.z0 + tile.z1) / 2); m.receiveShadow = true;
    m.updateMatrix(); m.matrixAutoUpdate = false; m.userData.ownMat = true;
    tile.group.add(m); m.updateMatrixWorld(true);
    tile.sat = m;
    if (!tile.lite) this.addTrees(tile, c, W, H);
  }

  // trees exactly where the satellite sees tree cover (dark, green-dominant pixels), sampled every ~9 m
  addTrees(tile, c, W, H) {
    let px; try { px = c.getImageData(0, 0, W, H).data; } catch { return; }
    const Wd = this.world, TS = Wd.TS, step = 9, pts = [], d = tile.d;
    let seed = (tile.tx * 73856093) ^ (tile.tz * 19349663); const R = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const inWater = (x, z) => (d.water || []).some(w => pointIn(x, z, w.p));
    for (let z = tile.z0 + step / 2; z < tile.z1; z += step) for (let x = tile.x0 + step / 2; x < tile.x1; x += step) {
      const jx = x + (R() - 0.5) * step * 0.8, jz = z + (R() - 0.5) * step * 0.8;
      const i = Math.floor((jx - tile.x0) / TS * W), j = Math.floor((jz - tile.z0) / TS * H);
      let r = 0, g = 0, b = 0, n = 0;
      for (let v = Math.max(0, j - 1); v <= Math.min(H - 1, j + 1); v++) for (let u = Math.max(0, i - 1); u <= Math.min(W - 1, i + 1); u++) { const o = (v * W + u) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; }
      r /= n; g /= n; b /= n;
      if (!(g > r + 3 && g >= b - 2 && r + g + b < 340)) continue;
      if (Wd.inRiver(jx, jz) || Wd.insideBuildingTile(tile, jx, jz) || Wd.nearRoadTile(tile, jx, jz, 2) || inWater(jx, jz) || Wd.treeFree(jx, jz)) continue;
      pts.push([jx, jz, 0.6 + R() * 0.9, R(), Math.min(1, (340 - (r + g + b)) / 160)]);
    }
    if (pts.length > (Wd.low ? 700 : 2600)) { for (let k = pts.length - 1; k > 0; k--) { const q = Math.floor(R() * (k + 1)); [pts[k], pts[q]] = [pts[q], pts[k]]; } pts.length = Wd.low ? 700 : 2600; }
    if (!pts.length || tile.sat === null) return;
    const greens = ['#2f5a22', '#3a6a28', '#46772e', '#2a4f1f', '#55803a'].map(h => new THREE.Color(h));
    const tr = Wd.addInstanced(tile, Wd.geo.trunk, Wd.mat.trunk, pts, (m, t) => { m.makeScale(t[2] * 1.2, 4 * t[2] + 1.5, t[2] * 1.2); m.setPosition(t[0], 0, t[1]); }, { cast: true });
    const cr = Wd.addInstanced(tile, Wd.geo.crown, Wd.mat.crown, pts, (m, t, i, im) => { const s = 3.4 * t[2] + 1.4; m.makeScale(s, 2.7 * t[2] + 1.3, s); m.setPosition(t[0], 4 * t[2] + 2.6, t[1]); im.setColorAt(i, greens[Math.floor(t[3] * greens.length)]); }, { cast: true, receive: true });
    for (const o of [tr, cr]) o.updateMatrixWorld(true);
    tile.satTrees = [tr, cr];
  }

  tileTouchesRiver(tile) {
    for (let z = tile.z0; z < tile.z1; z += 16) for (let x = tile.x0; x < tile.x1; x += 16) if (this.world.inRiver(x, z)) return true;
    return false;
  }

  dropTile(tile) {
    const m = tile.sat;
    if (m && m !== 'loading') { tile.group.remove(m); m.geometry.dispose(); m.material.map.dispose(); m.material.alphaMap?.dispose(); m.material.dispose(); }
    tile.sat = null;
    for (const o of (tile.satTrees || [])) { tile.group.remove(o); o.dispose(); }
    tile.satTrees = null;
  }
}

function pointIn(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
