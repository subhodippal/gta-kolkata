// Suburban & long-distance trains on the real railway main lines (OpenStreetMap railway=rail, merged into long
// lines by build_region.py). Local EMUs (9 cars) and express trains (red-white engine + blue coaches) run both ways,
// brake into stations, wait at the platform and pull out again. Platforms come from OSM railway=platform.
import * as THREE from 'three';
import { MeshBuilder } from './geo.js';

const CAR = 20.5, GAP = 0.9, Y = 0.35;

function sideTex(body, band, stripe, win, doors) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64; const c = cv.getContext('2d');
  c.fillStyle = body; c.fillRect(0, 0, 512, 64);
  c.fillStyle = band; c.fillRect(0, 14, 512, 22);
  c.fillStyle = stripe; c.fillRect(0, 44, 512, 5);
  c.fillStyle = win; for (let x = 40; x < 480; x += 30) if (!doors.some(d => Math.abs(d - x) < 26)) c.fillRect(x, 17, 20, 16);
  c.fillStyle = '#2a2a2a'; for (const d of doors) c.fillRect(d - 12, 10, 24, 50);
  c.fillStyle = '#d8d8d8'; for (const d of doors) c.fillRect(d - 1, 10, 2, 50);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function endTex(face) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const c = cv.getContext('2d');
  c.fillStyle = face; c.fillRect(0, 0, 64, 64); c.fillStyle = '#1d2630'; c.fillRect(10, 14, 44, 18);
  c.fillStyle = '#fff6c0'; c.fillRect(8, 44, 8, 6); c.fillRect(48, 44, 8, 6);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const L = (o) => new THREE.MeshLambertMaterial(o);

export class Trains {
  constructor(scene, world, data, opts = {}) {
    this.scene = scene; this.world = world;
    const B = data.meta.bounds, inside = (x, z) => x > B[0] + 50 && x < B[2] - 50 && z > B[1] + 50 && z < B[3] - 50;
    const runs = [];   // keep only the parts of each line inside the map
    for (const p of (data.railnet || [])) {
      let cur = [];
      for (let i = 0; i < p.length; i += 2) { if (inside(p[i], p[i + 1])) cur.push(p[i], p[i + 1]); else { if (cur.length > 4) runs.push(cur); cur = []; } }
      if (cur.length > 4) runs.push(cur);
    }
    this.lines = runs.map(p => this.prep(p)).filter(l => l.len > 2500);
    const st = data.transit?.rail || [];
    for (const l of this.lines) l.stops = this.stopsOn(l, st);
    this.buildPlatforms(data.platforms || []);
    // car types
    const box = new THREE.BoxGeometry(3.15, 3.7, CAR); box.translate(0, 1.85 + 0.55, 0);
    const roofEMU = L({ color: 0x8c949c }), roofExp = L({ color: 0x5d6670 });
    const emuSide = L({ map: sideTex('#ececea', '#7a1f2b', '#2a4c9c', '#24303a', [70, 256, 442]) });
    const expSide = L({ map: sideTex('#24519a', '#24519a', '#f2f2f2', '#c9dbe8', [30, 482]) });
    const locoSide = L({ map: sideTex('#c62828', '#c62828', '#f5f5f5', '#c62828', [60]) });
    const emuEnd = L({ map: endTex('#f2c230') }), expEnd = L({ color: 0x24519a }), locoEnd = L({ map: endTex('#c62828') }), under = L({ color: 0x222222 });
    this.max = opts.max ?? 26;
    const trainsPerLine = this.lines.map(l => Math.max(1, Math.round(l.len / 7000)));
    const kinds = [];
    this.lines.forEach((l, li) => { for (let k = 0; k < trainsPerLine[li]; k++) kinds.push([li, k]); });
    kinds.length = Math.min(kinds.length, this.max);
    this.trains = kinds.map(([li, k], i) => {
      const l = this.lines[li], exp = i % 4 === 3;
      const n = exp ? 13 : 9, s = (k + 0.5) / trainsPerLine[li] * l.len;
      return { l, exp, n, s: Math.min(l.len - n * (CAR + GAP), Math.max(n * (CAR + GAP), s)), dir: k % 2 ? -1 : 1, v: 0, vmax: exp ? 24 : 17, wait: 4 + (i * 7) % 25, lastStop: -1 };
    });
    let nEMU = 0, nExp = 0, nLoco = 0;
    for (const t of this.trains) { if (t.exp) { nLoco++; nExp += t.n - 1; } else nEMU += t.n; }
    const mk = (mats, n) => { const im = new THREE.InstancedMesh(box, mats, Math.max(1, n)); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im; };
    this.emu = mk([emuSide, emuSide, roofEMU, under, emuEnd, emuEnd], nEMU);
    this.exp = mk([expSide, expSide, roofExp, under, expEnd, expEnd], nExp);
    this.loco = mk([locoSide, locoSide, roofExp, under, locoEnd, locoEnd], nLoco);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.up = new THREE.Vector3(0, 1, 0); this.v3 = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
  }

  prep(p) {
    const cum = [0];
    for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
    return { p, cum, len: cum[cum.length - 1] };
  }
  // station positions along a line (closest point within 90 m)
  stopsOn(l, st) {
    const out = [];
    for (const s of st) {
      let best = 90, bs = -1;
      for (let i = 0; i < l.cum.length - 1; i++) {
        const ax = l.p[i * 2], az = l.p[i * 2 + 1], bx = l.p[i * 2 + 2], bz = l.p[i * 2 + 3], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / L2)), d = Math.hypot(ax + u * dx - s.x, az + u * dz - s.z);
        if (d < best) { best = d; bs = l.cum[i] + u * Math.sqrt(L2); }
      }
      if (bs > 30 && bs < l.len - 30 && !out.some(o => Math.abs(o - bs) < 150)) out.push(bs);
    }
    return out.sort((a, b) => a - b);
  }
  at(l, s, out) {
    s = Math.max(0, Math.min(l.len, s));
    let lo = 0, hi = l.cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (l.cum[mid] <= s) lo = mid; else hi = mid; }
    const f = (s - l.cum[lo]) / ((l.cum[hi] - l.cum[lo]) || 1), p = l.p;
    out.x = p[lo * 2] + (p[hi * 2] - p[lo * 2]) * f; out.z = p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * f;
    out.a = Math.atan2(p[hi * 2] - p[lo * 2], p[hi * 2 + 1] - p[lo * 2 + 1]);
    return out;
  }

  buildPlatforms(list) {
    const top = new MeshBuilder(), roof = new MeshBuilder(), side = new THREE.Color(0xb9b3a6), topC = new THREE.Color(0xd8d2c4), roofC = new THREE.Color(0x5f7a6a);
    const posts = [];
    for (const pl of list) {
      let poly = pl.p;
      if (!pl.a) {   // centre line -> 6 m wide strip
        const p = pl.p, n = p.length / 2, left = [], right = [];
        for (let i = 0; i < n; i++) {
          const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1), dx = p[j1 * 2] - p[j0 * 2], dz = p[j1 * 2 + 1] - p[j0 * 2 + 1], Ln = Math.hypot(dx, dz) || 1;
          const nx = -dz / Ln * 3, nz = dx / Ln * 3;
          left.push(p[i * 2] + nx, p[i * 2 + 1] + nz); right.unshift(p[i * 2] - nx, p[i * 2 + 1] - nz);
          if (i % 2 === 0) posts.push([p[i * 2], p[i * 2 + 1]]);
        }
        poly = left.concat(right);
      }
      if (poly.length < 6) continue;
      top.flat(poly, null, 0.95, topC);
      roof.flat(poly, null, 4.8, roofC);
      for (let i = 0; i < poly.length; i += 2) {
        const j = (i + 2) % poly.length, ax = poly[i], az = poly[i + 1], bx = poly[j], bz = poly[j + 1], Ln = Math.hypot(bx - ax, bz - az) || 1;
        top.wall(ax, az, bx, bz, 0, 0.95, (bz - az) / Ln, -(bx - ax) / Ln, side);
        top.wall(ax, az, bx, bz, 0, 0.95, -(bz - az) / Ln, (bx - ax) / Ln, side);
      }
    }
    const add = (mb, mat) => { const g = mb.build(); if (!g.attributes.position) return; const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true; this.scene.add(m); };
    add(top, L({ vertexColors: true }));
    add(roof, L({ vertexColors: true, side: THREE.DoubleSide }));
    if (posts.length) {
      const g = new THREE.CylinderGeometry(0.12, 0.12, 3.9, 6); g.translate(0, 0.95 + 1.95, 0);
      const im = new THREE.InstancedMesh(g, L({ color: 0x4a5a50 }), posts.length), m = new THREE.Matrix4();
      posts.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); im.setMatrixAt(i, m); });
      im.computeBoundingSphere(); this.scene.add(im);
    }
  }

  update(dt) {
    const o = {}, m = this.m, q = this.q;
    let ie = 0, ix = 0, il = 0;
    for (const t of this.trains) {
      const l = t.l;
      if (t.wait > 0) { t.wait -= dt; }
      else {
        // next stop ahead
        const ahead = t.dir > 0 ? l.stops.find(s => s > t.s + 1 && s !== t.lastStop) : [...l.stops].reverse().find(s => s < t.s - 1 && s !== t.lastStop);
        const end = t.dir > 0 ? l.len - 2 : 2;
        const stopAt = ahead !== undefined && (!t.exp || Math.round(ahead) % 3 === 0) ? ahead : end;
        const dist = Math.abs(stopAt - t.s);
        const brake = t.v * t.v / (2 * 0.7) + 2;
        if (dist < brake) t.v = Math.max(1.2, t.v - 0.9 * dt); else t.v = Math.min(t.vmax, t.v + 0.6 * dt);
        t.s += t.dir * t.v * dt;
        if (dist < 1.5 || (t.dir > 0 ? t.s >= stopAt : t.s <= stopAt)) {
          t.s = stopAt; t.v = 0; t.lastStop = stopAt;
          if (stopAt === end) {     // terminus: reverse (head becomes the tail)
            t.s = t.s - t.dir * (t.n - 1) * (CAR + GAP); t.dir *= -1; t.wait = 30; t.lastStop = -1;
          } else t.wait = t.exp ? 25 : 16;
        }
      }
      for (let k = 0; k < t.n; k++) {
        this.at(l, t.s - t.dir * k * (CAR + GAP) - t.dir * CAR / 2, o);
        q.setFromAxisAngle(this.up, o.a); m.compose(this.v3.set(o.x, Y, o.z), q, this.one);
        if (t.exp) { if (k === 0) this.loco.setMatrixAt(il++, m); else this.exp.setMatrixAt(ix++, m); }
        else this.emu.setMatrixAt(ie++, m);
      }
    }
    for (const im of [this.emu, this.exp, this.loco]) im.instanceMatrix.needsUpdate = true;
  }

  // nearest train to a point (for view-mode info / honk)
  nearest(x, z) {
    let best = null, bd = 1e9; const o = {};
    for (const t of this.trains) { this.at(t.l, t.s, o); const d = Math.hypot(o.x - x, o.z - z); if (d < bd) { bd = d; best = { t, d, x: o.x, z: o.z }; } }
    return best;
  }
}
