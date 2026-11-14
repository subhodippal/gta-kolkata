// Kolkata Metro: real lines & stations from OpenStreetMap (Blue Line 1, Green Line 2 under the Hooghly,
// Purple Line 3 under construction). Station entrances in 3D, rides between stations, trains on the map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { t, tn, line, num, speak, onLang } from './i18n.js';
import { canvasTexture, MeshBuilder, ribbon } from './geo.js';

const $ = (id) => document.getElementById(id);
const ESPLANADE = 'Esplanade';

export class Metro {
  constructor(scene, world, data, hud) {
    this.scene = scene; this.world = world; this.hud = hud;
    const tr = data.transit || { metro: [], stations: [] };
    this.lines = tr.metro; this.stations = tr.stations; this.rail = tr.rail || [];
    for (const L of this.lines) {
      // ordered polyline (for trains & drawing) with elevation type per vertex: 0 tunnel, 1 at grade, 2 elevated viaduct
      const ch = this.chain(L.segs);
      L.path = ch.path; L.elev = ch.elev;
      L.len = 0; L.cum = [];
      for (let i = 0; i < L.path.length; i += 2) { if (i) L.len += Math.hypot(L.path[i] - L.path[i - 2], L.path[i + 1] - L.path[i - 1]); L.cum.push(L.len); }
      L.stationS = (L.stn || []).map(si => this.project(L, this.stations[si].x, this.stations[si].z));
    }
    this.buildViaducts();
    this.entrances = [];
    this.buildEntrances();
    this.buildOverlay();
    this.trains = [];
    for (const L of this.lines) if (!L.uc && L.len > 200) {
      const n = Math.max(2, Math.round(L.len / 4000));
      for (let k = 0; k < n; k++) {
        const tr = { L, s: L.len * (k / n), dir: k % 2 ? 1 : -1, wait: 0, cars: [] };
        const geo = this.carGeoms[L.c] || (this.carGeoms[L.c] = trainCar(L.c));
        for (let c = 0; c < 6; c++) { const m = new THREE.Mesh(geo, this.trainMat); m.castShadow = true; m.visible = false; this.scene.add(m); tr.cars.push(m); }
        this.trains.push(tr);
      }
    }
    this.riding = null;
    $('metroClose').onclick = () => this.closePanel();
  }

  // join line segments ({p, e}) into one ordered polyline (greedy by nearest ends), keeping the elevation flag per vertex
  chain(segs) {
    if (!segs.length) return { path: [], elev: [] };
    const left = segs.map(s => ({ p: s.p.slice(), e: new Array(s.p.length / 2).fill(s.e ?? 0) }));
    const rev = (o) => { const p = [], e = []; for (let i = o.p.length - 2; i >= 0; i -= 2) { p.push(o.p[i], o.p[i + 1]); e.push(o.e[i / 2]); } return { p, e }; };
    let cur = left.shift();
    while (left.length) {
      const path = cur.p, ex = path[path.length - 2], ez = path[path.length - 1], sx = path[0], sz = path[1];
      let best = -1, bd = 1e18, mode = 0;
      left.forEach((s, i) => {
        const n = s.p.length;
        for (const [d, m] of [[Math.hypot(s.p[0] - ex, s.p[1] - ez), 0], [Math.hypot(s.p[n - 2] - ex, s.p[n - 1] - ez), 1], [Math.hypot(s.p[n - 2] - sx, s.p[n - 1] - sz), 2], [Math.hypot(s.p[0] - sx, s.p[1] - sz), 3]])
          if (d < bd) { bd = d; best = i; mode = m; }
      });
      if (bd > 400) break;
      const s = left.splice(best, 1)[0];
      if (mode === 0) cur = { p: cur.p.concat(s.p), e: cur.e.concat(s.e) };
      else if (mode === 1) { const r = rev(s); cur = { p: cur.p.concat(r.p), e: cur.e.concat(r.e) }; }
      else if (mode === 2) cur = { p: s.p.concat(cur.p), e: s.e.concat(cur.e) };
      else { const r = rev(s); cur = { p: r.p.concat(cur.p), e: r.e.concat(cur.e) }; }
    }
    return { path: cur.p, elev: cur.e };
  }
  // smooth track height along the line: tunnel -12 m, at grade 0.3 m, viaduct 11.1 m, with ramps between
  heightAt(L, s) {
    const Y = [-12, 0.3, 11.1];
    let i = 1; while (i < L.cum.length - 1 && L.cum[i] < s) i++;
    const a = Y[L.elev[i - 1] ?? 0], b = Y[L.elev[i] ?? 0];
    if (a === b) return a;
    const f = (s - L.cum[i - 1]) / ((L.cum[i] - L.cum[i - 1]) || 1);
    return a + (b - a) * f;
  }
  elevAt(L, s) { let i = 1; while (i < L.cum.length - 1 && L.cum[i] < s) i++; return Math.min(L.elev[i - 1] ?? 0, L.elev[i] ?? 0); }

  // elevated metro viaducts (concrete deck on pillars) and at-grade tracks
  buildViaducts() {
    const mb = new MeshBuilder(), rails = new MeshBuilder(), deck = new THREE.Color(0xb9b4a8), steel = new THREE.Color(0x3b3b3d), pillars = [];
    const H = 11;
    for (const L of this.lines) for (const sg of L.segs) {
      if (!sg.e || L.uc) continue;
      const y = sg.e === 2 ? H : 0.25;
      if (sg.e === 2) ribbon(mb, sg.p, { w: 9, y, c: deck, slab: 1.6, parapet: 1.1, slabColor: deck });
      else ribbon(mb, sg.p, { w: 4, y: 0.1, c: new THREE.Color(0x7a6f62) });
      for (const off of [-2.3, -0.9, 0.9, 2.3]) ribbon(rails, offsetLine(sg.p, off * (sg.e === 2 ? 1 : 0.4)), { w: 0.14, y: y + 0.05, c: steel });
      if (sg.e === 2) {
        let acc = 15; const p = sg.p;
        for (let i = 2; i < p.length; i += 2) {
          const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], l = Math.hypot(bx - ax, bz - az);
          while (acc < l) { const f = acc / l; pillars.push([ax + (bx - ax) * f, az + (bz - az) * f, Math.atan2(bx - ax, bz - az)]); acc += 32; }
          acc -= l;
        }
      }
    }
    const m1 = new THREE.Mesh(mb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); m1.castShadow = m1.receiveShadow = true; this.scene.add(m1);
    this.scene.add(new THREE.Mesh(rails.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    if (pillars.length) {
      const g = new THREE.CylinderGeometry(1.1, 1.3, H - 1.6, 10); g.translate(0, (H - 1.6) / 2, 0);
      const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xa8a294 }), pillars.length);
      const m = new THREE.Matrix4();
      pillars.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); im.setMatrixAt(i, m); this.world.addCircle(x, z, 1.4); });
      im.computeBoundingSphere(); im.castShadow = true; this.scene.add(im);
    }
    // 3D trains for the above-ground parts
    this.trainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.carGeoms = {};
    this.buildStationsAndPortals(H);
  }

  // elevated stations on the viaduct (platform deck, roof, stairs) and tunnel portals where lines come up
  buildStationsAndPortals(H) {
    const grey = new THREE.MeshLambertMaterial({ color: 0xc4beb2 }), roofM = new THREE.MeshLambertMaterial({ color: 0xe8e8e4, side: THREE.DoubleSide }),
      dark = new THREE.MeshBasicMaterial({ color: 0x0c0c0e }), conc = new THREE.MeshLambertMaterial({ color: 0xa9a399 });
    const add = (g, mat, x, y, z, ry) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; this.scene.add(m); return m; };
    const done = new Set();
    for (const L of this.lines) {
      if (L.uc) continue;
      (L.stn || []).forEach((si, k) => {
        const s = L.stationS[k], e = this.elevAt(L, s); if (done.has(si + ':' + e)) return; done.add(si + ':' + e);
        const [x, z] = this.pointAt(L, s), [x2, z2] = this.pointAt(L, s + 5), ry = Math.atan2(x2 - x, z2 - z);
        if (e === 2) {
          add(new THREE.BoxGeometry(22, 1.4, 150), grey, x, H - 0.8, z, ry);                       // concourse deck
          add(new THREE.BoxGeometry(22, 0.3, 150), roofM, x, H + 7.5, z, ry).scale.set(1.1, 1, 1);  // roof
          for (const side of [-1, 1]) for (let k2 = -3; k2 <= 3; k2++) {
            const ox = Math.cos(ry) * side * 10.5 + Math.sin(ry) * k2 * 22, oz = -Math.sin(ry) * side * 10.5 + Math.cos(ry) * k2 * 22;
            add(new THREE.CylinderGeometry(0.25, 0.25, 7.5, 8), conc, x + ox, H + 3.75, z + oz, 0);
          }
          for (const side of [-1, 1]) { const ox = Math.cos(ry) * side * 15, oz = -Math.sin(ry) * side * 15;   // stair towers to the street
            add(new THREE.BoxGeometry(6, H + 2, 12), conc, x + ox, (H + 2) / 2, z + oz, ry); this.world.addCircle(x + ox, z + oz, 5); }
        } else if (e === 1) {
          add(new THREE.BoxGeometry(16, 1, 140), grey, x, 0.5, z, ry);
          add(new THREE.BoxGeometry(17, 0.3, 120), roofM, x, 6.5, z, ry);
        }
      });
      // tunnel portals
      for (let i = 1; i < L.elev.length; i++) {
        const a = L.elev[i - 1] ?? 0, b = L.elev[i] ?? 0;
        if ((a === 0) === (b === 0)) continue;
        const x = L.path[i * 2], z = L.path[i * 2 + 1], j = b === 0 ? i - 1 : i + 1;
        if (j < 0 || j * 2 + 1 >= L.path.length) continue;
        const ry = Math.atan2(L.path[j * 2] - x, L.path[j * 2 + 1] - z);    // facing out of the tunnel
        const key = Math.round(x / 50) + ',' + Math.round(z / 50); if (done.has(key)) continue; done.add(key);
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; this.scene.add(g);
        const P = (w, h, d, mat, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m); };
        P(11, 2, 1.5, conc, 0, 6.5, 0); P(1.2, 7, 1.5, conc, -5.6, 3.5, 0); P(1.2, 7, 1.5, conc, 5.6, 3.5, 0);
        P(10, 5.5, 0.3, dark, 0, 2.75, -0.6);                                 // dark tunnel mouth
        for (const sd of [-1, 1]) P(0.8, 3, 60, conc, sd * 5.6, 1.5, 30);       // ramp side walls
        for (const k of [-1, 0, 1]) this.world.addCircle(x + Math.sin(ry) * 30 + Math.cos(ry) * k * 5.6, z + Math.cos(ry) * 30 - Math.sin(ry) * k * 5.6, 0.6);
      }
    }
  }

  project(L, x, z) { // distance along the line of the closest point
    let best = 0, bd = 1e18;
    for (let i = 2; i < L.path.length; i += 2) {
      const ax = L.path[i - 2], az = L.path[i - 1], bx = L.path[i], bz = L.path[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
      if (d < bd) { bd = d; best = L.cum[i / 2 - 1] + Math.sqrt(l2) * u; }
    }
    return best;
  }
  pointAt(L, s) {
    s = Math.max(0, Math.min(L.len, s));
    let i = 1; while (i < L.cum.length - 1 && L.cum[i] < s) i++;
    const a = i - 1, f = (s - L.cum[a]) / ((L.cum[i] - L.cum[a]) || 1), p = L.path;
    return [p[a * 2] + (p[i * 2] - p[a * 2]) * f, p[a * 2 + 1] + (p[i * 2 + 1] - p[a * 2 + 1]) * f];
  }
  lineById(id) { return this.lines.find(L => L.id === id); }
  stName(si) { return tn(this.stations[si].ni); }

  // ------------------------------------------------------------ 3D entrances
  buildEntrances() {
    const W = this.world, parts = [], signPos = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const col = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };
    this.stations.forEach((st, si) => {
      let ents = st.ent && st.ent.length ? st.ent : [[st.x, st.z]];
      ents = ents.map(([x, z]) => W.insideBuilding(x, z) || W.inRiver(x, z) ? W.findSafeSpot(x, z, false) : [x, z]);
      for (const [x, z] of ents) {
        // face the nearest road
        let ang = 0, bd = 1e9;
        for (const s of W.netStreetGrid.query(x, z)) { const dx = s[2] - s[0], dz = s[3] - s[1]; const l2 = dx * dx + dz * dz || 1; const u = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2)); const d = Math.hypot(s[0] + dx * u - x, s[1] + dz * u - z); if (d < bd) { bd = d; ang = Math.atan2(dx, dz); } }
        q.setFromAxisAngle(up, ang); m.compose(new THREE.Vector3(x, 0.1, z), q, one);
        const P = (g, hex, px, py, pz) => { g.translate(px, py, pz); g.applyMatrix4(m); parts.push(col(g, hex)); };
        P(new THREE.BoxGeometry(3.2, 0.12, 4.6), 0x8b8f94, 0, 0.06, 0);   // paving
        P(new THREE.BoxGeometry(2.4, 0.05, 3.6), 0x101010, 0, 0.13, 0.2);   // stairwell opening
        for (const sx of [-1.35, 1.35]) P(new THREE.BoxGeometry(0.25, 1.0, 4.2), 0xc9c4b8, sx, 0.5, 0);   // side walls
        P(new THREE.BoxGeometry(2.95, 1.0, 0.25), 0xc9c4b8, 0, 0.5, -2.0);
        for (const sx of [-1.4, 1.4]) P(new THREE.BoxGeometry(0.12, 2.8, 0.12), 0x666a70, sx, 1.4, -2.0);
        P(new THREE.BoxGeometry(3.3, 0.18, 4.8), 0x30343a, 0, 2.9, 0);    // canopy
        signPos.push([new THREE.Vector3(0, 3.6, -2.0).applyMatrix4(m), ang]);
        this.entrances.push({ x, z, si });
        W.addCircle(x, z, 1.8);
      }
    });
    if (parts.length) { const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true })); mesh.castShadow = mesh.receiveShadow = true; this.scene.add(mesh); }
    // Metro "M" signs
    const tex = canvasTexture(128, 128, (c) => {
      c.fillStyle = '#d4202a'; c.beginPath(); c.arc(64, 64, 60, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(64, 64, 48, 0, 7); c.fill();
      c.fillStyle = '#1d3f8f'; c.font = 'bold 76px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('M', 64, 68);
    }, false);
    const sg = new THREE.CircleGeometry(0.7, 24);
    const im = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), Math.max(1, signPos.length)); im.frustumCulled = false;
    signPos.forEach(([p, a], i) => { q.setFromAxisAngle(up, a); m.compose(p, q, one); im.setMatrixAt(i, m); });
    this.scene.add(im);
  }

  nearestEntrance(x, z, r = 4) {
    let best = null, bd = r;
    for (const e of this.entrances) { const d = Math.hypot(e.x - x, e.z - z); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  // ------------------------------------------------------------ underground overlay (view mode)
  buildOverlay() {
    this.overlay = new THREE.Group(); this.overlay.visible = false;
    for (const L of this.lines) {
      const pts = []; for (let i = 0; i < L.path.length; i += 2) pts.push(new THREE.Vector3(L.path[i], 1.5, L.path[i + 1]));
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
      const g = new THREE.TubeGeometry(curve, Math.min(600, pts.length * 4), 2.2, 6, false);
      const mat = new THREE.MeshBasicMaterial({ color: L.c, transparent: true, opacity: L.uc ? 0.35 : 0.65, depthTest: false });
      const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 5; this.overlay.add(mesh);
    }
    const sg = new THREE.CylinderGeometry(7, 7, 2, 20);
    for (const st of this.stations) {
      const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
      m.position.set(st.x, 1.5, st.z); m.renderOrder = 6; this.overlay.add(m);
    }
    this.trainMeshes = [];
    const tg = new THREE.BoxGeometry(4, 3, 120);
    for (let i = 0; i < this.lines.reduce((n, L) => n + (!L.uc && L.len > 200 ? Math.max(2, Math.round(L.len / 4000)) : 0), 0); i++) { const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 })); m.renderOrder = 7; m.visible = false; this.overlay.add(m); this.trainMeshes.push(m); }
    this.scene.add(this.overlay);
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    for (const tr of this.trains) {
      const L = tr.L;
      if (tr.wait > 0) { tr.wait -= dt; continue; }
      const prev = tr.s;
      const nxt = L.stationS.reduce((best, ss) => { const d = (ss - tr.s) * tr.dir; return d > 0.5 && d < best ? d : best; }, Math.min(tr.dir > 0 ? L.len - tr.s : tr.s, 1e9));
      tr.v = Math.min(22, nxt < (tr.v || 0) ** 2 / 2.0 + 5 ? Math.max(2, (tr.v || 0) - 1.0 * dt) : (tr.v || 0) + 0.9 * dt);
      tr.s += tr.dir * tr.v * dt;
      if (tr.s >= L.len || tr.s <= 0) { tr.dir *= -1; tr.s = Math.max(0, Math.min(L.len, tr.s)); tr.wait = 20; tr.v = 0; continue; }
      for (const ss of L.stationS) if ((prev - ss) * (tr.s - ss) <= 0) { tr.s = ss; tr.wait = 15; tr.v = 0; break; }
    }
    // above-ground trains (4 coaches, 20 m each)
    for (const tr of this.trains) {
      tr.cars.forEach((m, c) => {
        const sc = tr.s - tr.dir * c * 21;
        if (sc < 0 || sc > tr.L.len) { m.visible = false; return; }
        const [x, z] = this.pointAt(tr.L, sc), [x2, z2] = this.pointAt(tr.L, sc + 3);
        const y = this.heightAt(tr.L, sc), y2 = this.heightAt(tr.L, sc + 3);
        m.position.set(x, y, z); m.rotation.set(-Math.atan2(y2 - y, 3), Math.atan2(x2 - x, z2 - z), 0, 'YXZ');
        m.visible = y > -11.5 || this.overlay.visible;     // underground cars are only shown in the x-ray view
      });
    }
    if (this.overlay.visible) {
      this.trains.forEach((tr, i) => {
        const m = this.trainMeshes[i]; if (!m) return;
        const [x, z] = this.pointAt(tr.L, tr.s - tr.dir * 60), [x2, z2] = this.pointAt(tr.L, tr.s - tr.dir * 60 + 5);
        m.material.color.set(tr.L.c); m.position.set(x, 1.6, z); m.rotation.y = Math.atan2(x2 - x, z2 - z); m.visible = true;
      });
    }
  }
  trainPositions() { return this.trains.map(tr => { const [x, z] = this.pointAt(tr.L, tr.s); return { x, z, c: tr.L.c }; }); }

  // ------------------------------------------------------------ riding
  openPanel(fromSi) {
    this.from = fromSi;
    const st = this.stations[fromSi];
    $('metroFrom').textContent = this.stName(fromSi);
    const body = $('metroLines'); body.innerHTML = '';
    for (const L of this.lines) {
      if (L.uc || !L.stn?.length) continue;
      const div = document.createElement('div'); div.className = 'mline';
      div.innerHTML = `<div class="mlname" style="--c:${L.c}">${tn(L.ni)}</div>`;
      const list = document.createElement('div'); list.className = 'mstations'; list.style.setProperty('--c', L.c);
      for (const si of L.stn) {
        const b = document.createElement('button');
        const inter = this.stations[si].lines.length > 1 ? ' ⇄' : '';
        b.textContent = this.stName(si) + inter;
        if (si === fromSi) { b.disabled = true; b.classList.add('here'); }
        b.onclick = () => this.ride(fromSi, si);
        list.appendChild(b);
      }
      div.appendChild(list); body.appendChild(div);
    }
    const uc = this.lines.find(L => L.uc);
    $('metroNote').textContent = uc ? tn(uc.ni) : '';
    $('metroPanel').classList.remove('hidden'); this.hud.open = 'metro';
    if (document.pointerLockElement) document.exitPointerLock();
    void st;
  }
  closePanel() { $('metroPanel').classList.add('hidden'); if (this.hud.open === 'metro') this.hud.open = null; }

  // plan: list of legs [{L, from, to}] — breadth-first search over stations, changing lines at shared stations
  plan(a, b) {
    const usable = this.lines.filter(L => !L.uc && L.stn?.length);
    const prev = new Map([[a, null]]), queue = [a];
    while (queue.length) {
      const u = queue.shift(); if (u === b) break;
      for (const L of usable) {
        const i = L.stn.indexOf(u); if (i < 0) continue;
        for (const j of [i - 1, i + 1]) {
          const v = L.stn[j]; if (v === undefined || prev.has(v)) continue;
          prev.set(v, { u, L }); queue.push(v);
        }
      }
    }
    if (!prev.has(b)) return null;
    const steps = [];
    for (let v = b; prev.get(v); v = prev.get(v).u) steps.unshift({ from: prev.get(v).u, to: v, L: prev.get(v).L });
    const legs = [];
    for (const st of steps) {
      const last = legs[legs.length - 1];
      if (last && last.L === st.L) last.to = st.to; else legs.push({ L: st.L, from: st.from, to: st.to });
    }
    return legs;
  }

  ride(a, b) {
    const legs = this.plan(a, b); if (!legs) return;
    this.closePanel();
    const seq = [];
    for (const leg of legs) {
      const order = leg.L.stn, i0 = order.indexOf(leg.from), i1 = order.indexOf(leg.to), step = i1 > i0 ? 1 : -1;
      for (let i = i0 + step; step > 0 ? i <= i1 : i >= i1; i += step) seq.push({ si: order[i], L: leg.L, change: i === i1 && leg !== legs[legs.length - 1] });
    }
    this.riding = { seq, k: 0, timer: 0.5, b };
    const ov = $('metroRide'); ov.classList.remove('hidden');
    $('rideLine').style.setProperty('--c', legs[0].L.c);
    $('rideTitle').textContent = tn(legs[0].L.ni);
    this.hud.say(line('metro_board', { from: this.stName(a), to: this.stName(b) }), 3, '🚇 ');
    this.renderRide();
  }
  renderRide() {
    const r = this.riding; if (!r) return;
    const el = $('rideStops'); el.innerHTML = '';
    r.seq.forEach((s, i) => {
      const d = document.createElement('div'); d.className = 'rstop' + (i < r.k ? ' done' : i === r.k ? ' next' : '');
      d.style.setProperty('--c', s.L.c); d.textContent = this.stName(s.si) + (s.change ? ' ⇄' : ''); el.appendChild(d);
    });
  }
  /** returns destination [x,z] when the ride ends */
  updateRide(dt) {
    const r = this.riding; if (!r) return null;
    r.timer -= dt;
    $('rideTrain').style.left = (Math.min(1, r.k / Math.max(1, r.seq.length - 1)) * 100) + '%';
    if (r.timer > 0) return null;
    if (r.k >= r.seq.length) {
      this.riding = null; $('metroRide').classList.add('hidden');
      const st = this.stations[r.b];
      const e = this.entrances.find(e => e.si === r.b) || st;
      this.hud.say(line('metro_arrive', { station: this.stName(r.b) }), 3, '🚇 ');
      return [e.x + 3, e.z + 3];
    }
    const s = r.seq[r.k];
    $('rideTitle').textContent = tn(s.L.ni); $('rideLine').style.setProperty('--c', s.L.c);
    const txt = s.change ? line('metro_change', { station: this.stName(s.si) }) : line('metro_next', { station: this.stName(s.si) });
    $('rideNext').textContent = txt; speak(txt);
    this.renderRide();
    r.k++; r.timer = 3.2;
    return null;
  }
}

function offsetLine(p, off) {
  const n = p.length / 2, out = [];
  for (let i = 0; i < n; i++) {
    const pi = Math.max(0, i - 1), ni = Math.min(n - 1, i + 1);
    let tx = p[ni * 2] - p[pi * 2], tz = p[ni * 2 + 1] - p[pi * 2 + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.push(p[i * 2] - tz * off, p[i * 2 + 1] + tx * off);
  }
  return out;
}
// Kolkata Metro coach: stainless steel with a coloured band
function trainCar(stripe = 0x2b6cd4) {
  const parts = [], col = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; };
  const P = (g, hex, x, y, z) => { g.translate(x, y, z); parts.push(col(g, hex)); };
  P(new THREE.BoxGeometry(3.0, 3.4, 20), 0xd9dde2, 0, 2.0, 0);
  P(new THREE.BoxGeometry(3.04, 1.0, 18.5), 0x1d2630, 0, 2.6, 0);
  P(new THREE.BoxGeometry(3.06, 0.35, 20.02), stripe, 0, 1.4, 0);
  P(new THREE.BoxGeometry(3.06, 0.18, 20.02), stripe, 0, 3.45, 0);
  for (const z of [-6, 0, 6]) for (const x of [-1.53, 1.53]) P(new THREE.BoxGeometry(0.05, 2.2, 1.3), 0x9aa0a8, x, 1.75, z);   // sliding doors
  for (const z of [-7, 7]) for (const x of [-0.9, 0.9]) { const w = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10); w.rotateZ(Math.PI / 2); P(w, 0x222222, x, 0.42, z); }
  P(new THREE.BoxGeometry(2.6, 0.2, 19.6), 0xb0b4ba, 0, 3.8, 0);
  return mergeGeometries(parts);
}
