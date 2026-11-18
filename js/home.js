// The player's home: set it anywhere (saved in the browser), a small Bengali-style house with a lit porch and windows,
// a tall beacon you can see from afar, and a door you can walk up to and enter (rest, sleep till morning).
import * as THREE from 'three';
import { canvasTexture } from './geo.js';
import { t } from './i18n.js';
import { radialTexture } from './nightlights.js';

const KEY = 'kolkata_home_v1';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } },
};
const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };

export class Home {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.pos = null;            // the doorstep: x, z, y
    this.yaw = 0;
    this.group = null; this.circles = [];
    this.glowMat = new THREE.MeshLambertMaterial({ color: 0xfff0c0, emissive: 0x000000 });
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x38e0a0, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const saved = store.get();
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.z)) this.set(saved.x, saved.z, saved.yaw || 0, false);
  }

  /** where the porch lamp is (for the street-light pool) */
  get porch() { return this.group ? this.group.localToWorld(new THREE.Vector3(0, 2.3, 2.6)) : null; }
  get isSet() { return !!this.pos; }
  dist(x, z) { return this.pos ? Math.hypot(this.pos.x - x, this.pos.z - z) : Infinity; }

  /** the first direction (starting with the one the player faces) where the house fits: no building, river or road underneath */
  pickYaw(x, z, yaw) {
    const W = this.world;
    for (const d of [0, 0.785, -0.785, 1.571, -1.571, 2.356, -2.356, 3.14159]) {
      const a = yaw + d, cx = x + Math.sin(a) * 2.8, cz = z + Math.cos(a) * 2.8, ux = Math.cos(a), uz = -Math.sin(a), fx = Math.sin(a), fz = Math.cos(a);
      const pts = [[cx, cz], [cx + ux * 2.6, cz + uz * 2.6], [cx - ux * 2.6, cz - uz * 2.6], [cx + fx * 2.1, cz + fz * 2.1], [cx - fx * 2.1, cz - fz * 2.1]];
      if (pts.every(([px, pz]) => !W.insideBuilding(px, pz) && !W.inRiver(px, pz) && !W.nearRoad(px, pz, 2))) return a;
    }
    return yaw;
  }

  /** put the home door at (x, z); the house stands one step in front, facing the door back at the player */
  set(x, z, yaw, save = true) {
    this.clear();
    if (save) yaw = this.pickYaw(x, z, yaw);
    const y = this.world.groundAt(x, z, 50);
    this.pos = { x, z, y }; this.yaw = yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), cx = x + fx * 2.8, cz = z + fz * 2.8;
    const g = this.group = new THREE.Group(); g.position.set(cx, y, cz); g.rotation.y = yaw + Math.PI;
    const wall = new THREE.MeshLambertMaterial({ color: 0xe9d7a0 }), trim = new THREE.MeshLambertMaterial({ color: 0x2f6fb5 }),
      roof = new THREE.MeshLambertMaterial({ color: 0xb4554a }), wood = new THREE.MeshLambertMaterial({ color: 0x6b3f22 }),
      dark = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    g.add(box(5.2, 3.2, 4.0, 0, 1.6, 0, wall));                       // body
    g.add(box(5.5, 0.25, 4.3, 0, 3.3, 0, roof));                      // flat roof slab
    g.add(box(5.5, 0.45, 0.2, 0, 3.6, 2.05, trim), box(5.5, 0.45, 0.2, 0, 3.6, -2.05, trim),
      box(0.2, 0.45, 4.3, 2.65, 3.6, 0, trim), box(0.2, 0.45, 4.3, -2.65, 3.6, 0, trim)); // parapet
    g.add(box(5.3, 0.3, 4.1, 0, 0.15, 0, trim));                      // plinth stripe
    g.add(box(1.0, 2.2, 0.12, 0, 1.2, 2.02, wood));                   // door
    g.add(box(1.3, 0.12, 0.5, 0, 2.4, 2.2, trim));                    // porch hood
    g.add(box(1.6, 0.14, 0.9, 0, 0.12, 2.45, new THREE.MeshLambertMaterial({ color: 0x8d8a84 }))); // step
    for (const x2 of [-1.7, 1.7]) {                                   // lit windows
      g.add(box(1.0, 1.1, 0.1, x2, 1.9, 2.03, this.glowMat), box(1.2, 0.1, 0.16, x2, 2.5, 2.04, trim), box(1.2, 0.1, 0.16, x2, 1.3, 2.04, trim));
    }
    g.add(box(1.1, 1.0, 0.1, 2.62, 1.9, 0, this.glowMat)); g.children[g.children.length - 1].rotation.y = Math.PI / 2;
    g.add(box(1.2, 1.0, 1.0, -1.5, 3.9, -0.8, new THREE.MeshLambertMaterial({ color: 0x4a7fb8 }))); // water tank on the roof
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.glowMat); lamp.position.set(0, 2.1, 2.2); g.add(lamp);
    g.add(box(0.06, 0.7, 0.06, 0.75, 2.4, 2.1, dark));
    // nameplate
    const tex = canvasTexture(256, 96, (c, w, h) => {
      c.fillStyle = '#1f7a52'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, h - 10);
      c.fillStyle = '#fff'; c.font = 'bold 44px "Hind Siliguri", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🏠 ' + t('home'), w / 2, h / 2 + 2);
    }, false);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.68), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); sign.position.set(0, 3.0, 2.12); g.add(sign);
    // beacon: a faint green light pillar that can be seen across the neighbourhood
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 90, 12, 1, true), this.beaconMat); beacon.position.set(0, 45, 0); beacon.renderOrder = 4; g.add(beacon);
    this.poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0xffc878, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), this.poolMat); pool.position.set(0, 0.24, 4.2); pool.renderOrder = 3; g.add(pool);
    this.scene.add(g);
    // keep people out of the walls (the doorstep itself stays free)
    for (const lx of [-1.8, 0, 1.8]) for (const lz of [-1.2, 0.5]) {
      const wx = cx + Math.cos(yaw + Math.PI) * lx + Math.sin(yaw + Math.PI) * lz, wz = cz - Math.sin(yaw + Math.PI) * lx + Math.cos(yaw + Math.PI) * lz;
      const c = [wx, wz, 1.35]; this.world.globalCircles.addBox(c, wx - 1.4, wz - 1.4, wx + 1.4, wz + 1.4); this.circles.push(c);
    }
    if (save) store.set({ x, z, yaw });
  }

  clear() {
    if (this.group) { this.scene.remove(this.group); this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.group = null; }
    for (const c of this.circles) c[0] = 1e9;           // retire the old collision circles
    this.circles = []; this.pos = null;
  }

  /** night lighting: windows and porch glow, a light pool spills onto the street */
  update(night, elapsed) {
    if (!this.group) return;
    const on = THREE.MathUtils.clamp(night, 0, 1);
    this.glowMat.emissive.setRGB(1, 0.82, 0.45).multiplyScalar(0.15 + on * 1.1);
    this.poolMat.opacity = on * 0.8;
    this.beaconMat.opacity = 0.14 + on * 0.22 + Math.sin(elapsed * 2) * 0.03;
  }
}
