// Geometry helpers: a fast mesh builder, ribbons for roads, polygon fill, spatial grid.
import * as THREE from 'three';

export class MeshBuilder {
  constructor(withUV = false) {
    this.pos = []; this.nor = []; this.col = []; this.uv = withUV ? [] : null; this.idx = [];
  }
  get n() { return this.pos.length / 3; }
  v(x, y, z, nx, ny, nz, c, u = 0, w = 0) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c.r, c.g, c.b);
    if (this.uv) this.uv.push(u, w);
    return this.n - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    if (!this.pos.length) return g;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
  // vertical wall quad from (ax,az)->(bx,bz) between y0,y1 with outward normal (nx,nz)
  wall(ax, az, bx, bz, y0, y1, nx, nz, c, u0 = 0, u1 = 1, v0 = 0, v1 = 1) {
    const a = this.v(ax, y0, az, nx, 0, nz, c, u0, v0);
    const b = this.v(bx, y0, bz, nx, 0, nz, c, u1, v0);
    const d = this.v(bx, y1, bz, nx, 0, nz, c, u1, v1);
    const e = this.v(ax, y1, az, nx, 0, nz, c, u0, v1);
    // triangle normal of (a,b,d) is proportional to (-dz, 0, dx)
    const dx = bx - ax, dz = bz - az;
    if (-dz * nx + dx * nz > 0) { this.tri(a, b, d); this.tri(a, d, e); }
    else { this.tri(a, d, b); this.tri(a, e, d); }
  }
  // flat horizontal polygon (flat array x,z,...) with optional holes, facing up
  flat(pts, holes, y, c, uvScale = 0) {
    const contour = []; for (let i = 0; i < pts.length; i += 2) contour.push(new THREE.Vector2(pts[i], pts[i + 1]));
    const hs = (holes || []).map(h => { const a = []; for (let i = 0; i < h.length; i += 2) a.push(new THREE.Vector2(h[i], h[i + 1])); return a; });
    let faces;
    try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch (e) { return; }
    const all = contour.concat(...hs);
    const base = this.n;
    for (const p of all) this.v(p.x, y, p.y, 0, 1, 0, c, p.x * uvScale, p.y * uvScale);
    for (const f of faces) {
      const A = all[f[0]], B = all[f[1]], C = all[f[2]];
      const cy = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y);
      if (cy > 0) this.tri(base + f[0], base + f[1], base + f[2]);
      else this.tri(base + f[0], base + f[2], base + f[1]);
    }
  }
}

export function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
}

export function centroid(p) {
  let x = 0, z = 0; const n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; }
  return [x / n, z / n];
}

export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// principal-axis oriented rectangle of a footprint: {cx, cz, ang, len, wid}
export function orientedRect(p) {
  const [cx, cz] = centroid(p);
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < p.length; i += 2) { const dx = p[i] - cx, dz = p[i + 1] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (let i = 0; i < p.length; i += 2) {
    const dx = p[i] - cx, dz = p[i + 1] - cz;
    const a = dx * ux + dz * uz, b = -dx * uz + dz * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2;
  return { cx: cx + ma * ux - mb * uz, cz: cz + ma * uz + mb * ux, ang, len: a1 - a0, wid: b1 - b0 };
}

// Ribbon along polyline. heightFn(sNorm, sMeters) -> y. Returns nothing; writes into builder.
// opts: {w, y | heightFn, c, ext, uvLen, slab: thickness (adds sides+bottom)}
export function ribbon(mb, p, o) {
  const n = p.length / 2; if (n < 2) return;
  const hw = o.w / 2;
  // cumulative length
  const L = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]));
  const total = L[n - 1] || 1;
  const ext = o.ext ?? 0;
  const left = [], right = [], ys = [], us = [];
  for (let i = 0; i < n; i++) {
    let x = p[i * 2], z = p[i * 2 + 1];
    let tx, tz;
    const pi = Math.max(0, i - 1), ni = Math.min(n - 1, i + 1);
    let d1x = x - p[pi * 2], d1z = z - p[pi * 2 + 1], d2x = p[ni * 2] - x, d2z = p[ni * 2 + 1] - z;
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    if (i === 0) { tx = d2x; tz = d2z; } else if (i === n - 1) { tx = d1x; tz = d1z; } else { tx = d1x + d2x; tz = d1z + d2z; }
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    let nx = -tz, nz = tx;
    let m = hw;
    if (i > 0 && i < n - 1) { const dot = nx * -d2z + nz * d2x; m = hw / Math.max(0.35, dot); }
    if (i === 0) { x -= tx * ext; z -= tz * ext; }
    if (i === n - 1) { x += tx * ext; z += tz * ext; }
    left.push(x + nx * m, z + nz * m); right.push(x - nx * m, z - nz * m);
    ys.push(o.ys ? o.ys[i] : o.heightFn ? o.heightFn(L[i] / total, L[i]) : o.y);
    us.push(L[i] / (o.uvLen || 1));
  }
  const c = o.c, base = mb.n;
  for (let i = 0; i < n; i++) {
    mb.v(left[i * 2], ys[i], left[i * 2 + 1], 0, 1, 0, c, us[i], 0);
    mb.v(right[i * 2], ys[i], right[i * 2 + 1], 0, 1, 0, c, us[i], 1);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, cc = a + 2, d = a + 3;
    // ensure up-facing
    const ax = left[i * 2], az = left[i * 2 + 1], bx = right[i * 2], bz = right[i * 2 + 1], cx = left[i * 2 + 2], cz = left[i * 2 + 3];
    const cy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (cy > 0) { mb.tri(a, b, cc); mb.tri(b, d, cc); } else { mb.tri(a, cc, b); mb.tri(b, cc, d); }
  }
  if (o.slab) {
    const sc = o.slabColor || c;
    for (let i = 0; i < n - 1; i++) {
      for (const side of [left, right]) {
        const ax = side[i * 2], az = side[i * 2 + 1], bx = side[i * 2 + 2], bz = side[i * 2 + 3];
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
        const sgn = side === left ? 1 : -1;
        // outward = away from centre line
        const mx = (left[i * 2] + right[i * 2]) / 2, mz = (left[i * 2 + 1] + right[i * 2 + 1]) / 2;
        let nx = -dz / l, nz = dx / l;
        if ((ax - mx) * nx + (az - mz) * nz < 0) { nx = -nx; nz = -nz; }
        const y0a = ys[i], y0b = ys[i + 1];
        // sloped wall: build manually
        const A = mb.v(ax, y0a - o.slab, az, nx, 0, nz, sc), B = mb.v(bx, y0b - o.slab, bz, nx, 0, nz, sc);
        const C = mb.v(bx, y0b + (o.parapet || 0), bz, nx, 0, nz, sc), D = mb.v(ax, y0a + (o.parapet || 0), az, nx, 0, nz, sc);
        if (-dz * nx + dx * nz > 0) { mb.tri(A, B, C); mb.tri(A, C, D); } else { mb.tri(A, C, B); mb.tri(A, D, C); }
        void sgn;
      }
      // bottom
      const a = mb.v(left[i * 2], ys[i] - o.slab, left[i * 2 + 1], 0, -1, 0, sc), b = mb.v(right[i * 2], ys[i] - o.slab, right[i * 2 + 1], 0, -1, 0, sc);
      const cc = mb.v(left[i * 2 + 2], ys[i + 1] - o.slab, left[i * 2 + 3], 0, -1, 0, sc), d = mb.v(right[i * 2 + 2], ys[i + 1] - o.slab, right[i * 2 + 3], 0, -1, 0, sc);
      mb.tri(a, b, cc); mb.tri(b, d, cc); mb.tri(a, cc, b); mb.tri(b, cc, d);
    }
  }
  return { total, ys };
}

// Simple uniform grid for 2D items
export class Grid {
  constructor(cell = 40) { this.cell = cell; this.map = new Map(); }
  key(gx, gz) { return gx * 73856093 ^ gz * 19349663; }
  addBox(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gz = Math.floor(z0 / c); gz <= Math.floor(z1 / c); gz++) {
        const k = this.key(gx, gz); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(item);
      }
  }
  query(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || EMPTY; }
  queryRadius(x, z, r, out = new Set()) {
    const c = this.cell;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
      for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++) {
        const a = this.map.get(this.key(gx, gz)); if (a) for (const it of a) out.add(it);
      }
    return out;
  }
}
const EMPTY = [];

export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; const L = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cz = az + t * dz;
  return { d: Math.hypot(px - cx, pz - cz), t, cx, cz };
}

// deterministic RNG
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; };
}
export function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function canvasTexture(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
