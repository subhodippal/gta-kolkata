// View mode: fly over the city like a drone / map app, hover to see names, click for details.
import * as THREE from 'three';
import { t, tn, tt, num, speak, line, landmarkLine, onLang } from './i18n.js';
import { KIND_STYLE } from './pois.js';
import { RK } from './world.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class ViewMode {
  constructor({ camera, canvas, scene, world, pois, landmarks, hud, sun, controls, low }) {
    Object.assign(this, { camera, canvas, scene, world, pois, landmarks, hud, sun, controls, low });
    this.active = false;
    this.target = new THREE.Vector3();
    this.dist = 250; this.yaw = 0; this.pitch = 0.8;
    this.goal = null;
    this.pointers = new Map();
    this.drag = null;
    this.hoverAt = 0; this.mouse = null;
    this.ray = new THREE.Raycaster();
    this.showLabels = true;
    this.labelPool = [];
    this.roadAnchors = this.makeRoadAnchors();
    this.buildFlyList();
    onLang(() => this.buildFlyList());
    $('viewExit').onclick = () => this.onExit && this.onExit();
    $('labelsChk').onchange = (e) => { this.showLabels = e.target.checked; if (!this.showLabels) this.hideLabels(); };
    if (controls.touch) $('vhelp').dataset.i18n = 'view_help_touch';
    this.bindInput();
  }

  // ------------------------------------------------------------ setup
  makeRoadAnchors() {
    const seen = new Map(), out = [];
    for (const r of this.world.roads) {
      if (r.ni === undefined || r.k > RK.tertiary || r.len < 80 || r.heightFn) continue;
      const p = r.p, mid = Math.floor(p.length / 4) * 2;
      const x = p[mid], z = p[mid + 1];
      const prev = seen.get(r.ni);
      if (prev && prev.some(([a, b]) => Math.hypot(a - x, b - z) < 350)) continue;
      seen.set(r.ni, [...(prev || []), [x, z]]);
      out.push({ ni: r.ni, x, z, k: r.k });
    }
    return out;
  }
  buildFlyList() {
    const el = $('flyList'); el.innerHTML = '';
    for (const l of [...this.landmarks].sort((a, b) => a.name.localeCompare(b.name))) {
      const b = document.createElement('button'); b.textContent = l.name;
      b.onclick = () => this.flyToLandmark(l);
      el.appendChild(b);
    }
  }

  // ------------------------------------------------------------ enter / exit
  enter(x, z, yaw = 0) {
    this.active = true;
    this.target.set(x, 0, z);
    this.yaw = yaw; this.pitch = 0.75; this.dist = 160; this.goal = null;
    this.controls.freeMouse = true;
    if (document.pointerLockElement) document.exitPointerLock();
    $('viewui').classList.remove('hidden'); document.body.classList.add('viewing');
    this.saved = { far: this.camera.far, fogNear: this.scene.fog.near, fogFar: this.scene.fog.far };
    this.camera.far = this.low ? 4000 : 9000; this.camera.updateProjectionMatrix();
  }
  exit() {
    this.active = false;
    this.controls.freeMouse = false;
    $('viewui').classList.add('hidden'); $('tooltip').classList.add('hidden'); document.body.classList.remove('viewing');
    this.hideLabels();
    if (this.saved) { this.camera.far = this.saved.far; this.camera.updateProjectionMatrix(); this.scene.fog.near = this.saved.fogNear; this.scene.fog.far = this.saved.fogFar; }
    const c = this.sun.shadow.camera; Object.assign(c, { left: -70, right: 70, top: 70, bottom: -70, far: 500 }); c.updateProjectionMatrix();
  }

  flyTo(x, z, dist, pitch, yaw) {
    this.goal = { x, z, dist: dist ?? this.dist, pitch: pitch ?? this.pitch, yaw: yaw ?? this.yaw };
  }
  flyToLandmark(l) {
    const big = { eden: 520, howrah: 620, station: 520, victoria: 360, newmarket: 300 }[l.id] || 220;
    this.flyTo(l.x, l.z, big, 0.55);
    this.hud.say(line('fly_to', { place: l.name }), 3, '🦅 ');
    setTimeout(() => { if (this.active) speak(landmarkLine(l.id)); }, 2200);
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button });
      this.goal = null;
      if (this.pointers.size === 1) this.drag = (e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey) ? 'rotate' : 'pan';
      else this.drag = 'multi';
      this.pinch = this.pinchInfo();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      this.mouse = { x: e.clientX, y: e.clientY, type: e.pointerType };
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.drag === 'pan' && this.pointers.size === 1) {
        const a = this.groundAt(p.x, p.y), b = this.groundAt(e.clientX, e.clientY);
        if (a && b) { this.target.x += a.x - b.x; this.target.z += a.z - b.z; }
      } else if (this.drag === 'rotate') {
        this.yaw -= dx * 0.005; this.pitch = clamp(this.pitch + dy * 0.004, 0.08, 1.55);
      }
      p.x = e.clientX; p.y = e.clientY;
      if (this.drag === 'multi' && this.pointers.size >= 2) {
        const now = this.pinchInfo(), was = this.pinch;
        if (was && now) {
          this.dist = clamp(this.dist * was.d / Math.max(now.d, 1), 6, 4000);
          let da = now.a - was.a; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
          this.yaw += da;
          this.pitch = clamp(this.pitch + (now.cy - was.cy) * 0.004, 0.08, 1.55);
          const g0 = this.groundAt(was.cx, was.cy), g1 = this.groundAt(now.cx, now.cy);
          if (g0 && g1) { this.target.x += g0.x - g1.x; this.target.z += g0.z - g1.z; }
        }
        this.pinch = now;
      }
    });
    const up = (e) => {
      if (!this.active) return;
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (p && this.pointers.size === 0 && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6 && performance.now() - p.t < 400 && p.button === 0) {
        this.select(e.clientX, e.clientY);
      }
      if (this.pointers.size === 0) this.drag = null; else { this.drag = 'multi'; this.pinch = this.pinchInfo(); }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.mouse = null; $('tooltip').classList.add('hidden'); });
    cv.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault(); this.goal = null;
      const f = Math.exp(clamp(e.deltaY, -200, 200) * 0.0012);
      const g = this.groundAt(e.clientX, e.clientY);
      const nd = clamp(this.dist * f, 6, 4000), k = 1 - nd / this.dist;
      if (g) { this.target.x += (g.x - this.target.x) * k; this.target.z += (g.z - this.target.z) * k; }
      this.dist = nd;
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      if (!this.active) return;
      const h = this.pick(e.clientX, e.clientY); if (h) this.flyTo(h.x, h.z, Math.max(12, this.dist * 0.35));
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  pinchInfo() {
    const ps = [...this.pointers.values()]; if (ps.length < 2) return null;
    const [a, b] = ps;
    return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  ndc(cx, cy) { const r = this.canvas.getBoundingClientRect(); return new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); }
  // intersection with the horizontal plane through the target
  groundAt(cx, cy) {
    this.ray.setFromCamera(this.ndc(cx, cy), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y > -1e-4) return null;
    const s = (this.target.y - o.y) / d.y;
    if (s < 0 || s > 20000) return null;
    return { x: o.x + d.x * s, z: o.z + d.z * s };
  }
  // march the ray through the city: first building roof/wall or the ground
  pick(cx, cy) {
    this.ray.setFromCamera(this.ndc(cx, cy), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const W = this.world, B = W.bounds;
    let s = 0.5; const max = Math.min(12000, this.dist * 6 + 800);
    while (s < max) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (x < B.x0 - 50 || x > B.x1 + 50 || z < B.z0 - 50 || z > B.z1 + 50) { if ((d.x > 0 && x > B.x1) || (d.x < 0 && x < B.x0) || (d.z > 0 && z > B.z1) || (d.z < 0 && z < B.z0)) return null; }
      if (y <= 0.1) return { x, z, y: 0 };
      if (y < 160) { const b = W.insideBuilding(x, z); if (b && y <= b.ht) return { x, z, y, b }; }
      s += Math.max(0.4, s * 0.008);
    }
    return null;
  }

  // what is at this point? -> {title, sub, info}
  describe(h) {
    const W = this.world;
    const district = W.districtAt(h.x, h.z);
    // shop / restaurant markers
    const p = this.pois.nearest(h.x, h.z, h.b ? 14 : 7);
    if (p) {
      const st = KIND_STYLE[p.k] || KIND_STYLE.shop;
      return { title: st.icon + ' ' + tn(p.ni), sub: (p.t ? tt(p.t) : st.label) + (p.sti !== undefined ? ' · ' + tn(p.sti) : ''), info: () => ({ ...this.pois.visit(p), go: [p.x, p.z] }) };
    }
    for (const l of this.landmarks) {
      let d;
      if (l.seg) { const [ax, az, bx, bz] = l.seg; const dx = bx - ax, dz = bz - az; const tt2 = clamp(((h.x - ax) * dx + (h.z - az) * dz) / (dx * dx + dz * dz), 0, 1); d = Math.hypot(h.x - ax - dx * tt2, h.z - az - dz * tt2) - 20; }
      else d = Math.hypot(h.x - l.x, h.z - l.z) - l.r * 0.8;
      if (d < 0) return { title: '⭐ ' + l.name, sub: l.kind, info: () => ({ kind: l.kind, name: l.name, street: district, body: l.body, say: landmarkLine(l.id), go: l.travel }) };
    }
    if (h.b) {
      const b = h.b, name = b.ni !== undefined ? tn(b.ni) : t('building');
      const floors = Math.max(1, Math.round((b.ht - 0.6) / 3.4));
      const sid = W.streetIdAt(b.cx, b.cz, 60);
      const street = sid !== null ? tn(sid) : '';
      const body = `<p>${t('body_building', { district, h: num(Math.round(b.ht)), floors: num(floors) })}</p>`;
      return { title: '🏢 ' + name, sub: (street ? street + ' · ' : '') + district, info: () => ({ kind: t('building'), name, street: street ? t('address', { street }) : t('kolkata'), body, go: [b.cx, b.cz] }) };
    }
    const sid = W.streetIdAt(h.x, h.z, 6);
    if (sid !== null) {
      const name = tn(sid);
      return { title: '🛣 ' + name, sub: district, info: () => ({ kind: t('street'), name, street: t('kolkata'), body: `<p>${t('body_street', { district })}</p>`, go: [h.x, h.z] }) };
    }
    const pk = W.parkAt(h.x, h.z);
    if (pk) {
      const name = tn(pk.ni);
      return { title: '🌳 ' + name, sub: district, info: () => ({ kind: t('park'), name, street: district, body: `<p>${t('body_area', { district })}</p>`, go: [h.x, h.z] }) };
    }
    return { title: '📍 ' + district, sub: '', info: () => ({ kind: t('area'), name: district, street: t('kolkata'), body: `<p>${t('body_area', { district })}</p>`, go: [h.x, h.z] }) };
  }

  select(cx, cy) {
    const h = this.pick(cx, cy); if (!h) return;
    const d = this.describe(h);
    this.hud.panel(d.info());
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const c = this.controls;
    // keyboard / joystick flying
    const ax = c.axes();
    const fast = c.keys.has('ShiftLeft') || c.keys.has('ShiftRight') ? 3 : 1;
    const sp = Math.max(25, this.dist * 0.9) * fast * dt;
    if (ax.mag > 0.05) {
      this.goal = null;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      this.target.x += (fx * ax.y + rx * ax.x) * sp; this.target.z += (fz * ax.y + rz * ax.x) * sp;
    }
    const k = c.keys;
    if (k.has('KeyQ')) this.yaw += dt * 1.2;
    if (k.has('KeyE')) this.yaw -= dt * 1.2;
    if (k.has('KeyR')) this.pitch = clamp(this.pitch + dt * 0.8, 0.08, 1.55);
    if (k.has('KeyF')) this.pitch = clamp(this.pitch - dt * 0.8, 0.08, 1.55);
    if (k.has('KeyZ') || k.has('Equal') || k.has('NumpadAdd')) this.dist = clamp(this.dist * Math.exp(-dt * 1.5), 6, 4000);
    if (k.has('KeyX') || k.has('Minus') || k.has('NumpadSubtract')) this.dist = clamp(this.dist * Math.exp(dt * 1.5), 6, 4000);
    if (c.zoom) this.dist = clamp(this.dist * Math.exp(c.zoom * 0.12), 6, 4000);
    // smooth flights
    if (this.goal) {
      const g = this.goal, f = 1 - Math.exp(-dt * 2.2);
      this.target.x += (g.x - this.target.x) * f; this.target.z += (g.z - this.target.z) * f;
      this.dist += (g.dist - this.dist) * f; this.pitch += (g.pitch - this.pitch) * f;
      let dy = g.yaw - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; this.yaw += dy * f;
      if (Math.hypot(g.x - this.target.x, g.z - this.target.z) < 0.5 && Math.abs(g.dist - this.dist) < 1) this.goal = null;
    }
    const B = this.world.bounds;
    this.target.x = clamp(this.target.x, B.x0, B.x1); this.target.z = clamp(this.target.z, B.z0, B.z1);
    this.target.y = 0;

    // camera
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist);
    const minY = this.world.groundAt(this.camera.position.x, this.camera.position.z, 999) + 1.5;
    const b = this.world.insideBuilding(this.camera.position.x, this.camera.position.z);
    this.camera.position.y = Math.max(this.camera.position.y, minY, b ? b.ht + 2 : 0);
    this.camera.lookAt(this.target);

    // fog / shadows scale with altitude
    const fogFar = clamp(this.dist * 3 + 700, 1300, this.low ? 3500 : 7000);
    this.scene.fog.far = fogFar; this.scene.fog.near = fogFar * 0.3;
    const s = clamp(this.dist * 1.1, 70, 900), sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - s) > 5) { Object.assign(sc, { left: -s, right: s, top: s, bottom: -s, far: s * 4 + 500 }); sc.updateProjectionMatrix(); }
    this.shadowSize = s;

    $('alt').textContent = t('altitude', { h: num(Math.round(this.camera.position.y)) });

    // hover tooltip (throttled)
    this.hoverAt -= dt;
    if (this.mouse && this.mouse.type === 'mouse' && !this.drag && this.hoverAt <= 0) {
      this.hoverAt = 0.12;
      const h = this.pick(this.mouse.x, this.mouse.y), tip = $('tooltip');
      if (h) {
        const d = this.describe(h);
        tip.innerHTML = `<b>${d.title}</b>${d.sub ? `<small>${d.sub}</small>` : ''}`;
        tip.style.left = this.mouse.x + 'px'; tip.style.top = this.mouse.y + 'px'; tip.classList.remove('hidden');
      } else tip.classList.add('hidden');
    }
    if (this.showLabels) this.updateLabels();
  }

  // ------------------------------------------------------------ floating labels
  label(i) {
    while (this.labelPool.length <= i) { const d = document.createElement('div'); d.className = 'lbl'; $('labels').appendChild(d); this.labelPool.push(d); }
    return this.labelPool[i];
  }
  hideLabels() { for (const d of this.labelPool) d.style.display = 'none'; }
  updateLabels() {
    const cam = this.camera, v = new THREE.Vector3(), W = innerWidth, H = innerHeight;
    const items = [];
    for (const l of this.landmarks) items.push({ x: l.x, y: 30, z: l.z, text: '⭐ ' + l.name, cls: 'lbl big', pri: 0 });
    const R = clamp(this.dist * 1.6, 80, 700);
    if (this.dist < 1200) {
      const ps = [...this.pois.grid.queryRadius(this.target.x, this.target.z, R)]
        .map(p => [p, Math.hypot(p.x - this.target.x, p.z - this.target.z)]).filter(a => a[1] < R).sort((a, b) => a[1] - b[1]).slice(0, 28);
      for (const [p] of ps) { const st = KIND_STYLE[p.k] || KIND_STYLE.shop; items.push({ x: p.x, y: 7, z: p.z, text: st.icon + ' ' + tn(p.ni), cls: 'lbl', col: st.col, pri: 2 }); }
    }
    if (this.dist < 2000) {
      const RR = R * 1.5;
      for (const a of this.roadAnchors) {
        if (Math.abs(a.x - this.target.x) > RR || Math.abs(a.z - this.target.z) > RR) continue;
        items.push({ x: a.x, y: 1, z: a.z, text: tn(a.ni), cls: 'lbl road', pri: 1 });
      }
    }
    let n = 0; const boxes = [];
    items.sort((a, b) => a.pri - b.pri);
    for (const it of items) {
      v.set(it.x, it.y, it.z).project(cam);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
      const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
      const w = it.text.length * 7 + 16;
      if (boxes.some(b => Math.abs(b[0] - sx) < (b[2] + w) / 2 && Math.abs(b[1] - sy) < 20)) continue; // avoid overlaps
      boxes.push([sx, sy, w]);
      const d = this.label(n++);
      if (d._t !== it.text) { d.textContent = it.text; d._t = it.text; }
      if (d.className !== it.cls) d.className = it.cls;
      if (it.col) d.style.setProperty('--c', it.col);
      d.style.left = sx + 'px'; d.style.top = sy + 'px'; d.style.display = 'block';
      if (n >= 70) break;
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
  }
}
