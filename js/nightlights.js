// Night / storm lighting: a small pool of real point lights that follows the player (the nearest street lamps, the
// home porch and a soft light around the character), so roads and pavements stay clearly visible in the dark.
// The lamp glows, road light pools and car headlights are cheap additive sprites handled in world.js / traffic.js.
import * as THREE from 'three';

let radial;
/** soft white round gradient (shared by every glow / light pool) */
export function radialTexture() {
  if (radial) return radial;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d'), g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  radial = new THREE.CanvasTexture(cv); radial.colorSpace = THREE.SRGBColorSpace;
  return radial;
}

export class NightLights {
  constructor(scene, world, { low = false } = {}) {
    this.world = world; this.t = 0;
    const n = low ? 3 : 6;
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffc874, 0, 40, 2); l.position.set(0, -50, 0); l.userData.src = null;
      scene.add(l); this.pool.push(l);
    }
    // soft torch-like light around the player so the road right in front of them is never black
    this.me = new THREE.PointLight(0xffe6bc, 0, 17, 2); scene.add(this.me);
  }

  /** level 0..1 (how dark it is), focus = player position, extra = [{x,y,z}] (home porch) */
  update(dt, level, focus, extra = []) {
    const L = this.pool, k = Math.min(1, dt * 5);
    this.me.position.set(focus.x, focus.y + 2.4, focus.z);
    this.me.intensity += (level * 26 - this.me.intensity) * k;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.25;
      const cand = [], fx = focus.x, fz = focus.z;
      for (const tile of this.world.tilesAt(fx, fz, 60)) {
        const heads = tile.lampHeads; if (!heads) continue;
        for (const h of heads) { const d = Math.hypot(h[0] - fx, h[2] - fz); if (d < 55) cand.push({ h, d }); }
      }
      for (const e of extra) { const d = Math.hypot(e.x - fx, e.z - fz); if (d < 55) cand.push({ h: [e.x, e.y, e.z], d: d * 0.6 }); }
      cand.sort((a, b) => a.d - b.d);
      const want = cand.slice(0, L.length), keep = new Set(want.map(c => c.h));
      const free = [];
      for (const l of L) { if (l.userData.src && keep.has(l.userData.src)) keep.delete(l.userData.src); else free.push(l); }
      for (const c of want) {                               // lamps nobody holds yet take a free light
        if (!keep.has(c.h)) continue;
        const l = free.shift(); if (!l) break;
        l.userData.src = c.h; l.position.set(c.h[0], c.h[1] - 0.3, c.h[2]); l.intensity *= 0.2;
      }
      for (const l of free) l.userData.src = null;
    }
    for (const l of L) l.intensity += ((l.userData.src ? level * 85 : 0) - l.intensity) * k;
  }
}
