// Pedestrians, parked taxis/cars and trams
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeHuman, animateHuman } from './human.js';
import { rng, Grid } from './geo.js';
import { walkLine, RK } from './world.js';
import { line } from './i18n.js';

const SKINS = [0x8d5a3b, 0x7a4b30, 0xa26d4a, 0x6b4029, 0xb47c57, 0x5e3a24];
const SHIRTS = [0xffffff, 0x2f6fb5, 0xd33a2c, 0x3d8b5a, 0xf2c14e, 0x7b4fa0, 0x9aa0a6, 0xe07a2f, 0x1f2a3a, 0xf1e3c6];
const PANTS = [0x26324d, 0x3a3a3a, 0x5b4a3a, 0xd8d2c0, 0x1c1c1c, 0x6b6b5a];
const SAREES = [0xd32f2f, 0xf9a825, 0x1565c0, 0x2e7d32, 0xad1457, 0xffffff, 0x6a1b9a, 0xef6c00];
// what people say lives in data/comment.json (npc_talk, npc_hurt)

export class People {
  constructor(scene, world, count = 40) {
    this.scene = scene; this.world = world; this.list = [];
    this.R = rng(777);
    this.paths = world.roads.filter(r => r.k <= RK.residential && !r.heightFn && r.len > 30);
    // spatial index of path vertices so people spawn on streets near the player
    this.pgrid = new Grid(120);
    this.paths.forEach((r, ri) => { for (let i = 0; i < r.p.length / 2; i += 2) this.pgrid.addBox([ri, i], r.p[i * 2], r.p[i * 2 + 1], r.p[i * 2], r.p[i * 2 + 1]); });
    for (let i = 0; i < count; i++) {
      const R = this.R;
      const woman = R() < 0.4;
      const h = makeHuman(woman ? {
        skin: SKINS[Math.floor(R() * SKINS.length)], shirt: SAREES[Math.floor(R() * SAREES.length)], saree: SAREES[Math.floor(R() * SAREES.length)],
        longHair: true, bindi: R() < 0.6, shoes: 0x6b3a2a, scale: 0.94 + R() * 0.06, collar: false
      } : {
        skin: SKINS[Math.floor(R() * SKINS.length)], shirt: SHIRTS[Math.floor(R() * SHIRTS.length)], pants: PANTS[Math.floor(R() * PANTS.length)],
        beard: R() < 0.25, cap: R() < 0.1 ? 0xffffff : undefined, scale: 0.97 + R() * 0.08
      });
      h.root.visible = false; scene.add(h.root);
      this.list.push({ h, active: false, path: null, i: 0, dir: 1, t: 0, speed: 1.2, state: 'walk', timer: 0, down: 0, yaw: 0 });
    }
  }

  spawn(n, px, pz) {
    for (let tries = 0; tries < 30; tries++) {
      const cand = [...this.pgrid.queryRadius(px, pz, 140)];
      if (!cand.length) return false;
      const [ri, vi] = cand[Math.floor(this.R() * cand.length)];
      const r = this.paths[ri];
      const p = r.p; const k = Math.min(vi, p.length / 2 - 2);
      const x = p[k * 2], z = p[k * 2 + 1];
      const d = Math.hypot(x - px, z - pz);
      if (d > 140 || d < 25) continue;
      const side = this.R() < 0.5 ? -1 : 1;
      const off = r.k <= RK.tertiary || r.k === RK.link ? r.w / 2 + 1.4 : r.w / 2 - 0.6;
      n.path = offset(p, off * side); n.i = k; n.t = 0; n.dir = this.R() < 0.5 ? 1 : -1; if (n.dir < 0) n.i = Math.min(k + 1, n.path.length / 2 - 1);
      n.speed = 1.0 + this.R() * 0.6; n.state = 'walk'; n.down = 0;
      n.pos = new THREE.Vector3(n.path[n.i * 2], 0.12, n.path[n.i * 2 + 1]);
      if (this.world.insideBuilding(n.pos.x, n.pos.z)) continue;
      n.active = true; n.h.root.visible = true; return true;
    }
    return false;
  }

  update(dt, player) {
    const px = player.pos.x, pz = player.pos.z;
    for (const n of this.list) {
      if (!n.active) { if (this.R() < 0.05) this.spawn(n, px, pz); continue; }
      const dist = Math.hypot(n.pos.x - px, n.pos.z - pz);
      if (dist > 170) { n.active = false; n.h.root.visible = false; continue; }
      let speed = 0;
      if (n.state === 'walk' || n.state === 'flee') {
        speed = n.state === 'flee' ? 4.2 : n.speed;
        const L = n.path.length / 2;
        let ni = n.i + n.dir;
        if (ni < 0 || ni >= L) { n.dir = -n.dir; ni = n.i + n.dir; }
        const tx = n.path[ni * 2], tz = n.path[ni * 2 + 1];
        const dx = tx - n.pos.x, dz = tz - n.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.4) n.i = ni;
        else {
          const step = Math.min(d, speed * dt);
          const prev = n.pos.clone();
          n.pos.x += dx / d * step; n.pos.z += dz / d * step;
          this.world.collide(n.pos, 0.3, prev);
          if (n.pos.distanceToSquared(prev) < (step * 0.2) ** 2) { n.dir = -n.dir; }
          n.yaw = turn(n.yaw, Math.atan2(dx, dz), dt * 8);
        }
        if (n.state === 'flee' && (n.timer -= dt) < 0) n.state = 'walk';
      } else if (n.state === 'talk') {
        n.yaw = turn(n.yaw, Math.atan2(px - n.pos.x, pz - n.pos.z), dt * 6);
        if ((n.timer -= dt) < 0) n.state = 'walk';
      } else if (n.state === 'down') {
        n.down = Math.min(1, n.down + dt * 5);
        if ((n.timer -= dt) < 0) { n.state = 'getup'; }
      } else if (n.state === 'getup') {
        n.down = Math.max(0, n.down - dt * 2);
        if (n.down <= 0) { n.state = 'flee'; n.timer = 5; n.dir = (Math.sin(n.yaw) * (n.pos.x - px) + Math.cos(n.yaw) * (n.pos.z - pz)) > 0 ? n.dir : -n.dir; }
      }
      n.pos.y = this.world.groundAt(n.pos.x, n.pos.z, n.pos.y);
      n.h.root.position.copy(n.pos); n.h.root.rotation.y = n.yaw;
      if (dist < 90) animateHuman(n.h, { speed, dt, down: n.down, wave: n.state === 'talk' && n.timer > 1.5 });
    }
  }

  nearest(x, z, r = 2.2) {
    let best = null, bd = r;
    for (const n of this.list) if (n.active && n.state !== 'down') { const d = Math.hypot(n.pos.x - x, n.pos.z - z); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  talk(n) { n.state = 'talk'; n.timer = 3; return line('npc_talk'); }

  // hit everyone in a cone in front of (x,z) facing yaw
  hit(x, z, yaw, reach, force) {
    let said = null;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const n of this.list) {
      if (!n.active || n.state === 'down' || n.state === 'getup') continue;
      const dx = n.pos.x - x, dz = n.pos.z - z, d = Math.hypot(dx, dz);
      if (d > reach || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.45) continue;
      n.state = 'down'; n.timer = 2.5 + Math.random() * 2; n.yaw = Math.atan2(-dx, -dz);
      const push = force / Math.max(d, 0.5); const prev = n.pos.clone(); n.pos.x += dx / d * push; n.pos.z += dz / d * push; this.world.collide(n.pos, 0.3, prev);
      said = line('npc_hurt');
    }
    return said;
  }
}

function turn(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, k); }
function offset(p, off) {
  const n = p.length / 2, out = [];
  for (let i = 0; i < n; i++) {
    const pi = Math.max(0, i - 1), ni = Math.min(n - 1, i + 1);
    let tx = p[ni * 2] - p[pi * 2], tz = p[ni * 2 + 1] - p[pi * 2 + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.push(p[i * 2] - tz * off, p[i * 2 + 1] + tx * off);
  }
  return out;
}

// ------------------------------------------------------------------ vehicles (static for now)
function colored(g, hex) {
  const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv'); return g;
}
function part(g, hex, x, y, z) { g.translate(x, y, z); return colored(g, hex); }

// Hindustan Ambassador-style rounded classic car. Body vertex colour white (tinted per instance).
export function ambassadorGeometry() {
  const parts = [];
  const body = new THREE.BoxGeometry(1.7, 0.62, 4.3); parts.push(part(body, 0xffffff, 0, 0.62, 0));
  const hood = new THREE.CylinderGeometry(0.85, 0.85, 1.2, 12, 1, false, 0, Math.PI); hood.rotateZ(Math.PI / 2); hood.scale(1, 0.25, 1);
  parts.push(part(hood.clone(), 0xffffff, 0, 0.93, 1.45));
  parts.push(part(hood.clone(), 0xffffff, 0, 0.93, -1.5));
  const cabin = new THREE.BoxGeometry(1.5, 0.62, 2.0); parts.push(part(cabin, 0xffffff, 0, 1.24, -0.15));
  const roofC = new THREE.CylinderGeometry(0.75, 0.75, 2.0, 12, 1, false, 0, Math.PI); roofC.rotateZ(Math.PI / 2); roofC.rotateY(Math.PI / 2); roofC.rotateY(Math.PI / 2); roofC.scale(1, 0.22, 1);
  const roofG = new THREE.BoxGeometry(1.42, 0.12, 1.9); parts.push(part(roofG, 0xffffff, 0, 1.6, -0.15));
  const glass = 0x1d2630;
  parts.push(part(new THREE.BoxGeometry(1.52, 0.44, 1.7), glass, 0, 1.27, -0.15));
  parts.push(part(new THREE.BoxGeometry(1.3, 0.42, 0.05), glass, 0, 1.25, 0.87));
  parts.push(part(new THREE.BoxGeometry(1.3, 0.42, 0.05), glass, 0, 1.25, -1.17));
  const chrome = 0xd0d0d0;
  parts.push(part(new THREE.BoxGeometry(1.75, 0.16, 0.12), chrome, 0, 0.42, 2.18));
  parts.push(part(new THREE.BoxGeometry(1.75, 0.16, 0.12), chrome, 0, 0.42, -2.18));
  parts.push(part(new THREE.BoxGeometry(0.9, 0.3, 0.06), 0x333333, 0, 0.75, 2.16)); // grille
  for (const s of [-1, 1]) { const l = new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10); l.rotateX(Math.PI / 2); parts.push(part(l, 0xfff8d0, s * 0.62, 0.78, 2.17)); }
  for (const [x, z] of [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]]) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12); w.rotateZ(Math.PI / 2); parts.push(part(w, 0x151515, x, 0.34, z));
  }
  void roofC;
  return mergeGeometries(parts);
}

let CAR_GEOM = null;
const CAR_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
/** parked taxis & cars along the roads of one tile (added to the tile group, removed with it) */
export function parkedCarsTile(world, tile, max = 60) {
  if (tile.lite) return 0;
  const R = rng(tile.tx * 3301 + tile.tz * 7919 + 4242), spots = [];
  for (const r of tile.roads) {
    if (r.ys || r.k < RK.primary || r.k > RK.residential) continue;
    walkLine(r.p, 9, (x, z, nx, nz) => {
      if (R() > 0.14) return;
      const side = R() < 0.5 ? -1 : 1, off = r.w / 2 - 1.1;
      const cx = x + nx * side * off, cz = z + nz * side * off;
      if (world.insideBuildingTile(tile, cx, cz) || world.inRiver(cx, cz)) return;
      spots.push([cx, cz, Math.atan2(-nz, nx) + (R() < 0.5 ? Math.PI : 0)]);
    });
  }
  spots.sort(() => R() - 0.5); spots.length = Math.min(spots.length, max);
  if (!spots.length) return 0;
  CAR_GEOM = CAR_GEOM || ambassadorGeometry();
  const others = [0xf4f4f4, 0xb8bcc2, 0x2a2a2a, 0x8b1e1e, 0x1f3f7a];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), c = new THREE.Color();
  world.addInstanced(tile, CAR_GEOM, CAR_MAT, spots, (m, s, i, im) => {
    q.setFromAxisAngle(up, s[2]); p.set(s[0], 0.12, s[1]); m.compose(p, q, one);
    c.set(R() < 0.65 ? 0xf4c20d : others[Math.floor(R() * others.length)]); im.setColorAt(i, c);
    const fx = Math.sin(s[2]), fz = Math.cos(s[2]);
    for (const k of [-1.3, 0, 1.3]) world.tileAddCircle(tile, s[0] + fx * k, s[1] + fz * k, 0.85);
  }, { cast: true, receive: true });
  return spots.length;
}

