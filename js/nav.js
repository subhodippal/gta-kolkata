// Directions: walking route on the real street network, GPS path in the world, turn-by-turn in Bengali.
import * as THREE from 'three';
import { RoadGraph } from './roadgraph.js';
import { MeshBuilder, ribbon, canvasTexture } from './geo.js';
import { t, tn, num, line, speak } from './i18n.js';

const $ = (id) => document.getElementById(id);

export function fmtDist(m) {
  return m >= 1000 ? t('km', { n: num((m / 1000).toFixed(1)) }) : t('meters', { n: num(Math.max(5, Math.round(m / 5) * 5)) });
}

export class Nav {
  constructor(scene, world, hud) {
    this.scene = scene; this.world = world; this.hud = hud;
    this.graph = new RoadGraph(world.roads, 'walk');
    this.route = null; this.dest = null;
    this.tex = canvasTexture(64, 64, (c) => {
      c.clearRect(0, 0, 64, 64);
      c.fillStyle = 'rgba(255,207,63,0.35)'; c.fillRect(0, 0, 64, 64);
      c.strokeStyle = '#ffcf3f'; c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(18, 12); c.lineTo(42, 32); c.lineTo(18, 52); c.stroke();
    });
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    // destination beacon
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 80, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcf3f, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 40; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 32), new THREE.MeshBasicMaterial({ color: 0xffcf3f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; g.add(ring);
    g.visible = false; scene.add(g); this.beacon = g; this.ring = ring;
    $('navClose').onclick = () => this.clear();
    this.checkT = 0;
  }

  set(x, z, label, from) {
    this.dest = { x, z, label };
    const ok = this.compute(from);
    if (!ok) { this.hud.toast(t('nav_none'), 3); this.dest = null; return false; }
    this.hud.say(line('nav_start', { place: label, d: fmtDist(this.route.length) }), 4, '🧭 ');
    return true;
  }
  compute(from) {
    const r = this.graph.route(from.x, from.z, this.dest.x, this.dest.z);
    if (!r) return false;
    // append the final leg to the exact destination
    r.pts.push(this.dest.x, 0.2, this.dest.z);
    this.route = r; this.spoken = new Set(); this.progress = 0;
    this.buildMesh();
    this.beacon.position.set(this.dest.x, 0, this.dest.z); this.beacon.visible = true;
    $('navbox').classList.remove('hidden');
    $('navDest').textContent = this.dest.label;
    this.hud.routePts = r.pts; this.hud.routeDest = this.dest;
    return true;
  }
  clear() {
    this.route = null; this.dest = null;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    this.beacon.visible = false; $('navbox').classList.add('hidden');
    this.hud.routePts = null; this.hud.routeDest = null;
  }

  buildMesh() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    const p3 = this.route.pts, flat = [], ys = [], cum = [0];
    for (let i = 0; i < p3.length; i += 3) { flat.push(p3[i], p3[i + 2]); ys.push(p3[i + 1]); if (i) cum.push(cum[cum.length - 1] + Math.hypot(p3[i] - p3[i - 3], p3[i + 2] - p3[i - 1])); }
    const total = cum[cum.length - 1] || 1;
    const mb = new MeshBuilder(true);
    const yAt = (u, s) => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return Math.max(0.25, ys[i - 1] + (ys[i] - ys[i - 1]) * f + 0.12); };
    ribbon(mb, flat, { w: 1.8, heightFn: yAt, c: new THREE.Color(0xffffff), uvLen: 2.2 });
    void total;
    this.mesh = new THREE.Mesh(mb.build(), this.mat); this.mesh.renderOrder = 3;
    this.scene.add(this.mesh);
    this.cum = cum; this.flat = flat;
  }

  // distance along route of the point closest to p (searching forward from current progress)
  locate(px, pz) {
    const f = this.flat; let best = this.progress, bd = 1e9, bi = 0;
    for (let i = 1; i < f.length / 2; i++) {
      const ax = f[i * 2 - 2], az = f[i * 2 - 1], bx = f[i * 2], bz = f[i * 2 + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
      const d = Math.hypot(ax + dx * u - px, az + dz * u - pz);
      if (d < bd) { bd = d; best = this.cum[i - 1] + Math.sqrt(l2) * u; bi = i; }
    }
    return { s: best, d: bd, i: bi };
  }

  update(dt, pos) {
    this.tex.offset.x -= dt * 1.2;
    this.ring.rotation.z += dt;
    if (!this.route) return;
    const loc = this.locate(pos.x, pos.z);
    this.progress = loc.s;
    const total = this.cum[this.cum.length - 1];
    const remain = Math.max(0, total - loc.s);
    const toDest = Math.hypot(pos.x - this.dest.x, pos.z - this.dest.z);
    if (toDest < 10) {
      this.hud.say(line('nav_arrived', { place: this.dest.label }), 4, '🏁 ');
      this.clear(); return;
    }
    // off the route? re-route (throttled)
    this.checkT -= dt;
    if (loc.d > 28 && this.checkT <= 0) {
      this.checkT = 2;
      this.hud.toast('🧭 ' + line('nav_reroute'), 2);
      this.compute(pos); return;
    }
    // next instruction
    const next = this.route.steps.find(st => st.at > loc.s - 3);
    let text, icon = '⬆';
    if (next) {
      const d = next.at - loc.s;
      const road = next.ni !== undefined ? tn(next.ni) : '';
      icon = next.dir === 'left' ? '⬅' : next.dir === 'right' ? '➡' : '⬆';
      text = t(next.dir === 'left' ? 'nav_left' : next.dir === 'right' ? 'nav_right' : 'nav_straight', { d: fmtDist(d), road: road ? t('nav_onto', { road }) : '' });
      if (d < 35 && !this.spoken.has(next)) { this.spoken.add(next); speak(line(next.dir === 'left' ? 'nav_left' : next.dir === 'right' ? 'nav_right' : 'nav_straight', { d: fmtDist(d), road })); }
    } else {
      text = t('nav_straight', { d: fmtDist(remain), road: '' });
    }
    $('navIcon').textContent = icon;
    $('navText').textContent = text;
    $('navRemain').textContent = t('nav_remaining', { d: fmtDist(remain) });
  }
}
