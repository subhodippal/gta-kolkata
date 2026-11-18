// Moving traffic on the real road network: cars & taxis, buses that stop at bus stops, trams on the tram lines.
// India drives on the LEFT.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ambassadorGeometry } from './npc.js';
import { RoadGraph } from './roadgraph.js';
import { RK } from './world.js';
import { Grid } from './geo.js';
import { radialTexture } from './nightlights.js';

// soft light cone on the road in front of a vehicle: bright at the bumper, fading with distance, soft at the sides
let beamTex;
function beamTexture() {
  if (beamTex) return beamTex;
  const w = 64, h = 128, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'), im = c.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const along = Math.pow(1 - y / h, 1.6), side = Math.exp(-Math.pow((x - w / 2) / (w * 0.27), 2));
    const i = (y * w + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.round(255 * along * side);
  }
  c.putImageData(im, 0, 0);
  beamTex = new THREE.CanvasTexture(cv); beamTex.colorSpace = THREE.SRGBColorSpace;
  return beamTex;
}

function colored(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}
const part = (g, hex, x, y, z) => { g.translate(x, y, z); return colored(g, hex); };

// Kolkata city bus: long body, big windows, coloured band (tinted per instance)
export function busGeometry() {
  const p = [];
  p.push(part(new THREE.BoxGeometry(2.5, 2.2, 10.5), 0xffffff, 0, 1.55, 0));
  p.push(part(new THREE.BoxGeometry(2.54, 0.9, 9.6), 0x1b2430, 0, 2.05, -0.3));           // windows
  p.push(part(new THREE.BoxGeometry(2.3, 1.0, 0.06), 0x1b2430, 0, 2.0, 5.26));            // windscreen
  p.push(part(new THREE.BoxGeometry(2.56, 0.35, 10.55), 0x1d4fa0, 0, 1.1, 0));            // stripe
  p.push(part(new THREE.BoxGeometry(2.4, 0.12, 10.2), 0xdddddd, 0, 2.7, 0));              // roof
  p.push(part(new THREE.BoxGeometry(1.6, 0.35, 0.08), 0xffcc33, 0, 2.85 - 0.25, 5.25));   // route board
  p.push(part(new THREE.BoxGeometry(0.06, 1.8, 1.0), 0x222222, 1.27, 1.45, 3.6));         // door (left side!)
  p.push(part(new THREE.BoxGeometry(0.06, 1.8, 1.0), 0x222222, 1.27, 1.45, -3.2));
  for (const [x, z] of [[-1.1, 3.6], [1.1, 3.6], [-1.1, -3.4], [1.1, -3.4]]) { const w = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12); w.rotateZ(Math.PI / 2); p.push(part(w, 0x111111, x, 0.5, z)); }
  return mergeGeometries(p);
}
function tramCar() {
  const p = [];
  for (const k of [-5.6, 5.6]) {
    p.push(part(new THREE.BoxGeometry(2.3, 1.3, 10), 0xeeeeee, 0, 0.95, k));
    p.push(part(new THREE.BoxGeometry(2.32, 1.1, 10), 0x2f62a8, 0, 2.15, k));
    p.push(part(new THREE.BoxGeometry(2.34, 0.6, 9.4), 0x1d2630, 0, 2.15, k));
    p.push(part(new THREE.BoxGeometry(2.1, 0.25, 9.8), 0xeeeeee, 0, 2.82, k));
  }
  const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.5); pole.rotateX(0.5); p.push(part(pole, 0x222222, 0, 4.1, -4));
  return mergeGeometries(p);
}

const CAR_COLS = [0xf4c20d, 0xf4c20d, 0xf4c20d, 0xf4c20d, 0xf4f4f4, 0xb8bcc2, 0x2a2a2a, 0x8b1e1e, 0x1f3f7a, 0x3d6b4a];
const BUS_COLS = [0xffffff, 0xf2c94c, 0xe67e22, 0xa8d8ff, 0xffffff];

export class Traffic {
  constructor(scene, world, details, opts = {}) {
    this.scene = scene; this.world = world; this.details = details;
    this.graph = new RoadGraph(world.roads, 'drive');
    const G = this.graph;
    // signals & bus stops attached to graph nodes
    this.nodeSignal = new Map();
    details.signals.forEach((s, i) => { for (const n of G.grid.queryRadius(s.x, s.z, 18)) if (Math.hypot(G.x[n] - s.x, G.z[n] - s.z) < 16) this.nodeSignal.set(n, i); });
    this.stopGrid = new Grid(40);
    details.busStops.forEach(s => this.stopGrid.addBox(s, s.x, s.z, s.x, s.z));
    this.busNodes = [];
    for (let i = 0; i < G.x.length; i++) if (G.adj[i].some(e => e.r.k <= RK.secondary)) this.busNodes.push(i);

    const nCars = opts.cars ?? 70, nBus = opts.buses ?? 14;
    this.cars = this.makePool(ambassadorGeometry(), nCars, 'car', 4.4);
    this.buses = this.makePool(busGeometry(), nBus, 'bus', 10.6);
    this.all = [...this.cars.list, ...this.buses.list];
    this.trams = [];
    this.tramGeom = tramCar(); this.tramMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    world.hooks.push((tile) => this.addTileTrams(tile));
    world.unloadHooks.push((tile) => this.removeTileTrams(tile));
    this.time = 0;
    this.hornCb = null;
    this.buildLights();
  }

  // ------------------------------------------------------------ headlights, taillights and beams (night / storm)
  buildLights() {
    const n = this.all.length, col = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) col.set(k < 2 ? [1, 0.93, 0.74] : [1, 0.12, 0.06], (i * 4 + k) * 3);
    const g = new THREE.BufferGeometry();
    this.lightPos = new Float32Array(n * 12).fill(-1000);
    g.setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.lightMat = new THREE.PointsMaterial({ map: radialTexture(), size: 2.2, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.lightPts = new THREE.Points(g, this.lightMat); this.lightPts.frustumCulled = false; this.lightPts.renderOrder = 3; this.lightPts.visible = false;
    const bg = new THREE.PlaneGeometry(4.8, 15).rotateX(-Math.PI / 2).translate(0, 0, 7.5);
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xffe9b8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    this.beams = new THREE.InstancedMesh(bg, this.beamMat, n); this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false; this.beams.visible = false; this.beams.renderOrder = 2;
    this.scene.add(this.lightPts, this.beams);
  }
  /** level 0..1 from the day/night cycle and the weather */
  setLights(level) {
    this.lightMat.opacity = Math.min(1, level * 1.2); this.beamMat.opacity = level * 0.7;
    this.lightPts.visible = this.beams.visible = level > 0.03;
  }
  updateLights() {
    if (!this.lightPts.visible) return;
    const P = this.lightPos, m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), hide = new THREE.Matrix4().makeScale(0, 0, 0);
    this.all.forEach((v, i) => {
      if (!v.active) { P.fill(-1000, i * 12, i * 12 + 12); this.beams.setMatrixAt(i, hide); return; }
      const sx = Math.sin(v.yaw), sz = Math.cos(v.yaw), rx = sz, rz = -sx, bus = v.type === 'bus';
      const f = v.length / 2 - 0.12, hw = bus ? 0.95 : 0.68, hy = v.y + (bus ? 0.85 : 0.62);
      const set = (k, d, side) => { const o = i * 12 + k * 3; P[o] = v.x + sx * d + rx * side; P[o + 1] = hy; P[o + 2] = v.z + sz * d + rz * side; };
      set(0, f, hw); set(1, f, -hw); set(2, -f, hw); set(3, -f, -hw);
      q.setFromAxisAngle(up, v.yaw); m.compose(p.set(v.x + sx * (f - 0.2), v.y + 0.3, v.z + sz * (f - 0.2)), q, one); this.beams.setMatrixAt(i, m);
    });
    this.lightPts.geometry.attributes.position.needsUpdate = true; this.beams.instanceMatrix.needsUpdate = true;
  }

  makePool(geom, n, type, length) {
    const mesh = new THREE.InstancedMesh(geom, new THREE.MeshLambertMaterial({ vertexColors: true }), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const list = [];
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, hide);
      mesh.setColorAt(i, new THREE.Color(type === 'bus' ? BUS_COLS[i % BUS_COLS.length] : CAR_COLS[i % CAR_COLS.length]));
      list.push({ type, i, mesh, active: false, length, x: 0, y: 0, z: 0, yaw: 0, speed: 0 });
    }
    this.scene.add(mesh);
    return { mesh, list };
  }

  // ------------------------------------------------------------ spawning
  spawn(v, fx, fz) {
    const G = this.graph;
    for (let tries = 0; tries < 20; tries++) {
      const ang = Math.random() * Math.PI * 2, d = 70 + Math.random() * 280;
      let n = G.nearest(fx + Math.cos(ang) * d, fz + Math.sin(ang) * d, 200, v.type === 'bus' ? (i) => this.isBusNode(i) : null);
      if (n < 0) continue;
      const edges = G.adj[n].filter(e => v.type !== 'bus' || e.r.k <= RK.secondary);
      if (!edges.length) continue;
      const e = edges[Math.floor(Math.random() * edges.length)];
      if (Math.hypot(G.x[n] - fx, G.z[n] - fz) < 40) continue;
      if (this.all.some(o => o.active && o.edge === e.r && Math.hypot(o.x - G.x[n], o.z - G.z[n]) < 12)) continue;
      v.from = n; v.to = e.to; v.edge = e.r; v.elen = e.len; v.s = 0;
      v.max = (v.type === 'bus' ? 8 : 9 + Math.random() * 4) * (e.r.k <= RK.secondary ? 1 : 0.7);
      v.speed = v.max * 0.6; v.wait = 0; v.lastStop = null; v.blocked = 0;
      v.active = true; this.place(v, 0);
      return true;
    }
    return false;
  }
  isBusNode(i) { return this.graph.adj[i].some(e => e.r.k <= RK.secondary); }

  nextEdge(v) {
    const G = this.graph;
    let opts = G.adj[v.to].filter(e => e.to !== v.from);
    if (v.type === 'bus') { const big = opts.filter(e => e.r.k <= RK.secondary); if (big.length) opts = big; }
    if (!opts.length) opts = G.adj[v.to]; // dead end: U-turn
    if (!opts.length) return false;
    // prefer continuing on the same road / big roads
    const w = opts.map(e => (e.r === v.edge ? 4 : 1) * (e.r.k <= RK.secondary ? 2 : e.r.k <= RK.tertiary ? 1.4 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), k = 0;
    while (k < opts.length - 1 && (r -= w[k]) > 0) k++;
    const e = opts[k];
    v.from = v.to; v.to = e.to; v.edge = e.r; v.elen = e.len; v.s = 0;
    v.max = (v.type === 'bus' ? 8 : 9 + Math.random() * 4) * (e.r.k <= RK.secondary ? 1 : e.r.k <= RK.tertiary ? 0.8 : 0.6);
    return true;
  }

  // world position on the current edge, keeping LEFT
  place(v, dt) {
    const G = this.graph, a = v.from, b = v.to;
    const t = v.elen > 0 ? v.s / v.elen : 0;
    const dx = G.x[b] - G.x[a], dz = G.z[b] - G.z[a], L = Math.hypot(dx, dz) || 1;
    const lane = v.edge.ow ? (v.type === 'bus' ? v.edge.w * 0.2 : 0) : Math.min(v.edge.w / 4 + (v.type === 'bus' ? 0.4 : 0), 3.2);
    const lx = dz / L, lz = -dx / L; // left of travel direction
    v.x = G.x[a] + dx * t + lx * lane; v.z = G.z[a] + dz * t + lz * lane;
    v.y = G.y[a] + (G.y[b] - G.y[a]) * t;
    const target = Math.atan2(dx, dz);
    let d = target - v.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    v.yaw += dt ? d * Math.min(1, dt * 6) : d;
    v.hx = dx / L; v.hz = dz / L; v.heading = Math.atan2(dz, dx);
  }

  // ------------------------------------------------------------ per frame
  update(dt, focus, player) {
    this.time += dt;
    const G = this.graph, m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    let spawned = 0;
    for (const v of this.all) {
      if (!v.active) { if (spawned < 2 && Math.random() < 0.3) { if (this.spawn(v, focus.x, focus.z)) spawned++; } if (!v.active) { v.mesh.setMatrixAt(v.i, hide); continue; } }
      if (Math.hypot(v.x - focus.x, v.z - focus.z) > 480) { v.active = false; v.mesh.setMatrixAt(v.i, hide); continue; }
      // ---- desired speed
      let want = v.max;
      if (v.wait > 0) { v.wait -= dt; want = 0; }
      // red light at the node ahead?
      const toNode = v.elen - v.s;
      const sig = this.nodeSignal.get(v.to);
      if (sig !== undefined && toNode < 16 && toNode > 3) {
        const st = this.details.signalState(sig, v.heading, this.time);
        if (st === 'r' || (st === 'y' && toNode > 8)) want = Math.min(want, Math.max(0, (toNode - 5) * 0.8));
      }
      // vehicle ahead (same direction)
      const look = 6 + v.speed * 1.2 + v.length / 2;
      for (const o of this.all) {
        if (o === v || !o.active) continue;
        const dx = o.x - v.x, dz = o.z - v.z;
        const ahead = dx * v.hx + dz * v.hz; if (ahead <= 0 || ahead > look + o.length / 2) continue;
        const side = Math.abs(dx * -v.hz + dz * v.hx); if (side > 2.2) continue;
        if (o.hx * v.hx + o.hz * v.hz < 0.3) continue;
        want = Math.min(want, Math.max(0, (ahead - (v.length + o.length) / 2 - 2) * 0.9));
      }
      // the player in front: stop and honk
      if (player) {
        const dx = player.x - v.x, dz = player.z - v.z, ahead = dx * v.hx + dz * v.hz, side = Math.abs(dx * -v.hz + dz * v.hx);
        if (ahead > 0 && ahead < v.length / 2 + 7 && side < 2.0 && Math.abs(player.y - v.y) < 2) {
          want = 0; v.blocked += dt;
          if (v.blocked > 1.2 && this.hornCb) { this.hornCb(v); v.blocked = -2.5; }
        } else if (v.blocked > 0) v.blocked = 0; else v.blocked = Math.min(0, v.blocked + dt);
      }
      // buses stop at bus stops
      if (v.type === 'bus' && v.wait <= 0) {
        for (const s of this.stopGrid.query(v.x, v.z)) {
          if (s === v.lastStop) continue;
          const dx = s.x - v.x, dz = s.z - v.z, ahead = dx * v.hx + dz * v.hz, side = dx * v.hz - dz * v.hx; // >0 = left of bus
          if (ahead > -2 && ahead < 4 && side > 0 && side < v.edge.w / 2 + 5) { v.wait = 5 + Math.random() * 3; v.lastStop = s; break; }
        }
      }
      // ---- integrate
      const acc = want > v.speed ? 3 : 8;
      v.speed += Math.sign(want - v.speed) * Math.min(Math.abs(want - v.speed), acc * dt);
      v.s += v.speed * dt;
      let guard = 0;
      while (v.s >= v.elen && guard++ < 4) { const over = v.s - v.elen; if (!this.nextEdge(v)) { v.active = false; break; } v.s = over; }
      if (!v.active) { v.mesh.setMatrixAt(v.i, hide); continue; }
      this.place(v, dt);
      q.setFromAxisAngle(up, v.yaw); p.set(v.x, v.y, v.z); m.compose(p, q, one); v.mesh.setMatrixAt(v.i, m);
    }
    this.cars.mesh.instanceMatrix.needsUpdate = true; this.buses.mesh.instanceMatrix.needsUpdate = true;
    this.updateTrams(dt);
    this.updateLights();
  }

  // keep the player out of vehicles
  collide(pos) {
    for (const v of this.all) {
      if (!v.active || Math.abs(pos.y - v.y) > 2.5) continue;
      const dx = pos.x - v.x, dz = pos.z - v.z;
      const along = dx * v.hx + dz * v.hz, side = dx * -v.hz + dz * v.hx;
      const hl = v.length / 2 + 0.35, hw = (v.type === 'bus' ? 1.25 : 0.85) + 0.35;
      if (Math.abs(along) < hl && Math.abs(side) < hw) {
        const pa = hl - Math.abs(along), ps = hw - Math.abs(side);
        if (ps < pa) { const k = Math.sign(side) * ps; pos.x += -v.hz * k; pos.z += v.hx * k; }
        else { const k = Math.sign(along) * pa; pos.x += v.hx * k; pos.z += v.hz * k; }
      }
    }
  }

  // ------------------------------------------------------------ trams
  // a tram on the longest tram-line piece of each loaded tile
  addTileTrams(tile) {
    if (tile.lite) return;
    const ls = (tile.tramLines || []).map(p => { let L = 0; const cum = [0]; for (let i = 1; i < p.length / 2; i++) { L += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]); cum.push(L); } return { p, L, cum }; })
      .filter(l => l.L > 250).sort((a, b) => b.L - a.L).slice(0, 1);
    for (const l of ls) {
      const mesh = new THREE.Mesh(this.tramGeom, this.tramMat); mesh.castShadow = true; this.scene.add(mesh);
      this.trams.push({ l, mesh, s: l.L * Math.random(), dir: 1, wait: 0, tile: tile.key });
    }
  }
  removeTileTrams(tile) {
    this.trams = this.trams.filter(tr => { if (tr.tile === tile.key) { this.scene.remove(tr.mesh); return false; } return true; });
  }
  updateTrams(dt) {
    for (const tr of this.trams) {
      const l = tr.l;
      if (tr.wait > 0) tr.wait -= dt; else tr.s += tr.dir * 5 * dt;
      if (tr.s > l.L - 12 || tr.s < 12) { tr.dir *= -1; tr.s = Math.max(12, Math.min(l.L - 12, tr.s)); tr.wait = 6; }
      let i = 1; while (i < l.cum.length - 1 && l.cum[i] < tr.s) i++;
      const a = i - 1, f = (tr.s - l.cum[a]) / ((l.cum[i] - l.cum[a]) || 1), p = l.p;
      const x = p[a * 2] + (p[i * 2] - p[a * 2]) * f, z = p[a * 2 + 1] + (p[i * 2 + 1] - p[a * 2 + 1]) * f;
      tr.mesh.position.set(x, 0.2, z); tr.mesh.rotation.y = Math.atan2(p[i * 2] - p[a * 2], p[i * 2 + 1] - p[a * 2 + 1]);
      tr.x = x; tr.z = z;
    }
  }
}
