// River traffic on the Ganga / Hooghly: ferry steamers on the real ferry routes, big cargo / cruise boats and
// small wooden country boats (nouka) moving slowly up and down the river, gently rocking on the water.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WATER_Y = -2.2;

function col(g, hex) {
  if (g.index) g = g.toNonIndexed();
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}
const P = (arr, g, hex, x, y, z) => { g.translate(x, y, z); arr.push(col(g, hex)); };
function hull(len, wid, depth, hex, arr, pointy = 0.35) {
  // tapered hull from an extruded outline
  const s = new THREE.Shape();
  s.moveTo(-wid / 2, -len / 2); s.lineTo(wid / 2, -len / 2); s.lineTo(wid / 2, len / 2 - len * pointy); s.quadraticCurveTo(wid / 2, len / 2, 0, len / 2);
  s.quadraticCurveTo(-wid / 2, len / 2, -wid / 2, len / 2 - len * pointy); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -depth * 0.35, 0);
  arr.push(col(g, hex));
}

// WBTC-style ferry launch: white & blue double-deck steamer
function ferryGeom() {
  const a = [];
  hull(26, 7, 2.4, 0x2a4f8f, a, 0.3);
  P(a, new THREE.BoxGeometry(6.4, 2.4, 17), 0xf2f2f2, 0, 2.3, -1.5);
  P(a, new THREE.BoxGeometry(6.5, 0.9, 17.1), 0x1f2a36, 0, 2.6, -1.5);        // windows band
  P(a, new THREE.BoxGeometry(6.8, 0.25, 18), 0xd8d8d8, 0, 3.6, -1.5);          // upper deck
  P(a, new THREE.BoxGeometry(4.2, 1.8, 5), 0xf2f2f2, 0, 4.6, 2);               // wheelhouse
  P(a, new THREE.BoxGeometry(4.3, 0.7, 5.1), 0x1f2a36, 0, 4.9, 2);
  const funnel = new THREE.CylinderGeometry(0.6, 0.7, 2.6, 10); P(a, funnel, 0xc0392b, 0, 5.6, -4);
  for (const x of [-3.2, 3.2]) P(a, new THREE.BoxGeometry(0.08, 0.9, 17), 0xffffff, x, 4.1, -1.5);    // railings
  return mergeGeometries(a);
}
// cargo barge (big, slow)
function bargeGeom() {
  const a = [];
  hull(48, 10, 3, 0x3b3b3b, a, 0.18);
  P(a, new THREE.BoxGeometry(9, 1.6, 30), 0x6d4c33, 0, 2.2, 2);   // cargo (sand / coal heap)
  P(a, new THREE.BoxGeometry(8, 4, 7), 0xe9e4d8, 0, 3.2, -18);    // cabin
  P(a, new THREE.BoxGeometry(8.1, 0.8, 7.1), 0x1f2a36, 0, 4.4, -18);
  P(a, new THREE.CylinderGeometry(0.5, 0.5, 3), 0x222222, 0, 6, -20);
  return mergeGeometries(a);
}
// tourist cruise steamer
function cruiseGeom() {
  const a = [];
  hull(34, 9, 2.6, 0xf2f2f2, a, 0.28);
  for (let k = 0; k < 2; k++) {
    P(a, new THREE.BoxGeometry(8, 2.6, 22 - k * 6), 0xfaf6ea, 0, 2.4 + k * 2.8, -1);
    P(a, new THREE.BoxGeometry(8.1, 1.0, 22.1 - k * 6), 0x2c3e50, 0, 2.7 + k * 2.8, -1);
  }
  P(a, new THREE.BoxGeometry(8.4, 0.2, 23), 0xc0392b, 0, 7.6, -1);   // red canopy
  return mergeGeometries(a);
}
// wooden country boat (nouka) with a curved bamboo canopy (chhoi)
function noukaGeom() {
  const a = [];
  hull(9, 2.2, 0.9, 0x5b3b22, a, 0.45);
  const tail = new THREE.ConeGeometry(0.6, 1.8, 6); tail.rotateX(-Math.PI / 2 - 0.5); P(a, tail, 0x5b3b22, 0, 0.6, -4.9);
  const chh = new THREE.CylinderGeometry(1.15, 1.15, 3.2, 12, 1, true, -Math.PI / 2, Math.PI); chh.rotateX(Math.PI / 2); chh.rotateY(Math.PI / 2); chh.rotateY(Math.PI / 2);
  const roof = new THREE.CylinderGeometry(1.15, 1.15, 3.2, 12, 1, true, 0, Math.PI); roof.rotateZ(Math.PI / 2); roof.rotateY(Math.PI / 2);
  roof.rotateZ(0); roof.translate(0, 0.9, -0.5); a.push(col(roof, 0xb08d57));
  P(a, new THREE.CylinderGeometry(0.05, 0.05, 3.4), 0x4a3320, 0.4, 1.6, 2.6);   // the boatman's long pole
  void chh;
  return mergeGeometries(a);
}
// boatman
function boatmanGeom() {
  const a = [];
  P(a, new THREE.BoxGeometry(0.4, 0.7, 0.25), 0xffffff, 0, 0.95, 0);
  P(a, new THREE.SphereGeometry(0.14, 8, 6), 0x7a4b30, 0, 1.45, 0);
  P(a, new THREE.BoxGeometry(0.36, 0.6, 0.22), 0x1f6f8b, 0, 0.35, 0);
  return mergeGeometries(a);
}

export class Boats {
  constructor(scene, world, opts = {}) {
    this.scene = scene; this.world = world;
    const C = world.d.center || [];
    this.center = C;
    this.boats = [];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const add = (geom, kind, extra) => { const m = new THREE.Mesh(geom, mat); m.castShadow = true; scene.add(m); const b = { mesh: m, kind, phase: Math.random() * 6, ...extra }; this.boats.push(b); return b; };
    // ferries on real ferry routes (back and forth, waiting at the ghats)
    const fg = ferryGeom();
    for (const f of (world.d.ferries || []).slice(0, opts.ferries ?? 10)) {
      const p = f.p, cum = [0];
      for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
      add(fg, 'ferry', { path: p, cum, L: cum[cum.length - 1], s: Math.random() * cum[cum.length - 1], dir: Math.random() < 0.5 ? 1 : -1, speed: 4, wait: 0 });
    }
    if (C.length > 4) {
      const big = [bargeGeom(), cruiseGeom()], ng = noukaGeom(), man = boatmanGeom();
      const n = opts.big ?? 8;
      for (let i = 0; i < n; i++) add(big[i % 2], 'big', { ci: Math.random() * (C.length - 1), dir: i % 2 ? 1 : -1, lane: (Math.random() - 0.5) * 0.35, speed: i % 2 ? 2.2 : 1.6 });
      const m = opts.small ?? 26;
      for (let i = 0; i < m; i++) {
        const b = add(ng, 'nouka', { ci: Math.random() * (C.length - 1), dir: Math.random() < 0.5 ? 1 : -1, lane: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.17), speed: 0.7 + Math.random() * 0.6 });
        const bm = new THREE.Mesh(man, mat); bm.position.set(0.4, 0.2, 2.6); b.mesh.add(bm);
      }
    }
  }

  // position on the river centre line (index can be fractional), lateral offset as a fraction of width
  river(ci, lane) {
    const C = this.center, i = Math.max(0, Math.min(C.length - 2, Math.floor(ci))), f = ci - i;
    const a = C[i], b = C[i + 1];
    const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f, w = a[2] + (b[2] - a[2]) * f;
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return { x: x + (dz / L) * lane * w, z: z - (dx / L) * lane * w, dx: dx / L, dz: dz / L, seg: L }; // offset across the river
  }

  update(dt, time, focus) {
    for (const b of this.boats) {
      const m = b.mesh;
      if (b.kind === 'ferry') {
        if (b.wait > 0) b.wait -= dt;
        else {
          b.s += b.dir * b.speed * dt;
          if (b.s > b.L || b.s < 0) { b.dir *= -1; b.s = Math.max(0, Math.min(b.L, b.s)); b.wait = 15; }
        }
        let i = 1; while (i < b.cum.length - 1 && b.cum[i] < b.s) i++;
        const f = (b.s - b.cum[i - 1]) / ((b.cum[i] - b.cum[i - 1]) || 1), p = b.path;
        const x = p[i * 2 - 2] + (p[i * 2] - p[i * 2 - 2]) * f, z = p[i * 2 - 1] + (p[i * 2 + 1] - p[i * 2 - 1]) * f;
        m.position.set(x, WATER_Y, z);
        m.rotation.y = Math.atan2((p[i * 2] - p[i * 2 - 2]) * b.dir, (p[i * 2 + 1] - p[i * 2 - 1]) * b.dir);
      } else {
        const C = this.center;
        const seg = Math.hypot(C[Math.min(C.length - 1, Math.floor(b.ci) + 1)][0] - C[Math.floor(b.ci)][0], C[Math.min(C.length - 1, Math.floor(b.ci) + 1)][1] - C[Math.floor(b.ci)][1]) || 40;
        b.ci += b.dir * b.speed * dt / seg;
        if (b.ci <= 0 || b.ci >= C.length - 1.01) { b.dir *= -1; b.ci = Math.max(0, Math.min(C.length - 1.01, b.ci)); }
        const r = this.river(b.ci, b.lane);
        m.position.set(r.x, WATER_Y, r.z);
        const target = Math.atan2(r.dx * b.dir, r.dz * b.dir);
        let d = target - m.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        m.rotation.y += d * Math.min(1, dt * 0.8);
      }
      // gentle rocking on the water
      const k = b.kind === 'nouka' ? 1.6 : 0.5;
      m.position.y += Math.sin(time * 1.3 + b.phase) * 0.12 * k;
      m.rotation.z = Math.sin(time * 0.9 + b.phase) * 0.03 * k;
      m.rotation.x = Math.sin(time * 0.7 + b.phase * 2) * 0.015 * k;
      m.visible = !focus || Math.hypot(m.position.x - focus.x, m.position.z - focus.z) < 3500;
    }
  }
}
