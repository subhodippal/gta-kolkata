// Street details: bus stops (real OSM + generated along main roads), traffic signals, zebra crossings.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './geo.js';
import { t, tn, onLang } from './i18n.js';
import { busGeometry } from './traffic.js';
import { ambassadorGeometry } from './npc.js';
import { pointInPoly } from './geo.js';

function colored(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}
const place = (g, m) => { g.applyMatrix4(m); return g; };

export class StreetDetails {
  constructor(scene, world, data) {
    this.scene = scene; this.world = world; this.d = data;
    this.busStops = this.buildBusStops();
    this.signals = this.buildSignals();
    this.buildStands();
  }

  // ------------------------------------------------------------ bus stands / depots with parked buses, taxi stands with yellow Ambassadors
  buildStands() {
    const W = this.world, buses = [], taxis = [], boards = [];
    this.standList = [];
    for (const b of (this.d.bstands || [])) {
      let ang = b.a || 0, cx = b.x, cz = b.z, slots = [];
      if (b.p && b.p.length >= 8) {
        // orient rows along the longest polygon edge
        let best = 0; const p = b.p;
        for (let i = 0; i < p.length - 2; i += 2) { const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); if (L > best) { best = L; ang = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]); } }
        const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
        for (let r = -6; r <= 6 && slots.length < 14; r++) for (let k = -4; k <= 4 && slots.length < 14; k++) {
          const x = cx + vx * r * 4.2 + ux * k * 12.5, z = cz + vz * r * 4.2 + uz * k * 12.5;
          if (pointInPoly(x, z, p) && pointInPoly(x + ux * 5.5, z + uz * 5.5, p) && pointInPoly(x - ux * 5.5, z - uz * 5.5, p)) slots.push([x, z]);
        }
      }
      if (slots.length < 3) {    // a point stand: a row of buses parked side by side at the kerb, angled in
        slots = []; const ux = Math.cos(ang), uz = Math.sin(ang);
        for (let k = -2; k <= 2; k++) slots.push([cx + ux * k * 4.4, cz + uz * k * 4.4]);
        ang += Math.PI / 2;
      }
      const n = Math.min(slots.length, 10);
      for (let i = 0; i < n; i++) {
        const [x, z] = slots[(i * 7) % slots.length];
        if (buses.some(o => Math.hypot(o[0] - x, o[1] - z) < 3.5)) continue;
        buses.push([x, z, Math.PI / 2 - ang + (i % 2 ? Math.PI : 0)]);   // bus length along the row direction
        const ux = Math.cos(ang), uz = Math.sin(ang);
        for (const k of [-3.5, 0, 3.5]) W.addCircle(x + ux * k, z + uz * k, 1.4);
      }
      boards.push([cx, cz, ang, b.ni]);
      this.standList.push({ x: cx, z: cz, ni: b.ni, kind: 'bus' });
    }
    for (const tx of (this.d.taxis || [])) {
      const ux = Math.cos(tx.a), uz = Math.sin(tx.a);
      for (let k = 0; k < 5; k++) { const x = tx.x + ux * (k - 2) * 5, z = tx.z + uz * (k - 2) * 5; taxis.push([x, z, Math.atan2(ux, uz)]); W.addCircle(x, z, 1.1); }
      boards.push([tx.x + ux * 13, tx.z + uz * 13, tx.a, -1]);
      this.standList.push({ x: tx.x, z: tx.z, kind: 'taxi' });
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const BUS_COLS = [0xffffff, 0xf2c94c, 0x9fd0ff, 0xe67e22, 0xffffff, 0x6fcf97];
    if (buses.length) {
      const im = new THREE.InstancedMesh(busGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), buses.length);
      buses.forEach(([x, z, a], i) => { q.setFromAxisAngle(up, a); m.compose(v.set(x, 0, z), q, one); im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(BUS_COLS[i % BUS_COLS.length])); });
      im.castShadow = true; im.computeBoundingSphere(); this.scene.add(im);
    }
    if (taxis.length) {
      const im = new THREE.InstancedMesh(ambassadorGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), taxis.length);
      taxis.forEach(([x, z, a], i) => { q.setFromAxisAngle(up, a); m.compose(v.set(x, 0, z), q, one); im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(0xf4c20d)); });
      im.castShadow = true; im.computeBoundingSphere(); this.scene.add(im);
    }
    // stand boards (name on a blue board on two posts; yellow TAXI board)
    this.boardTex = [];
    const postG = new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6); postG.translate(0, 1.7, 0);
    const posts = new THREE.InstancedMesh(postG, new THREE.MeshLambertMaterial({ color: 0x555555 }), Math.max(1, boards.length * 2));
    boards.forEach(([x, z, a, ni], i) => {
      const ux = Math.cos(a), uz = Math.sin(a);
      for (const k of [0, 1]) { m.makeTranslation(x + ux * (k ? 1.4 : -1.4), 0, z + uz * (k ? 1.4 : -1.4)); posts.setMatrixAt(i * 2 + k, m); }
      const taxi = ni === -1;
      const tex = canvasTexture(256, 96, () => { }, false);
      const draw = () => {
        const c = tex.image.getContext('2d');
        c.fillStyle = taxi ? '#f4c20d' : '#1f4f9c'; c.fillRect(0, 0, 256, 96); c.strokeStyle = '#fff'; c.lineWidth = 6; c.strokeRect(4, 4, 248, 88);
        c.fillStyle = taxi ? '#111' : '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = 'bold 34px "Hind Siliguri", sans-serif'; c.fillText(taxi ? '🚕 ' + t('taxi_stand') : '🚌 ' + t('bus_stand'), 128, 32);
        c.font = '24px "Hind Siliguri", sans-serif'; const nm = !taxi && ni !== undefined ? tn(ni) : ''; c.fillText(nm.length > 22 ? nm.slice(0, 21) + '…' : nm, 128, 70);
        tex.needsUpdate = true;
      };
      draw(); onLang(draw);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      sign.position.set(x, 3.6, z); sign.rotation.y = -a; this.scene.add(sign);
    });
    posts.computeBoundingSphere(); this.scene.add(posts);
  }

  // ------------------------------------------------------------ bus stops (real OSM + generated every ~420 m on main roads, placed by build_region.py)
  buildBusStops() {
    const stops = (this.d.bus || []).map(b => ({ x: b.x, z: b.z, face: b.f, ni: b.ni, real: !!b.r }));
    const parts = [], signs = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const s of stops) {
      q.setFromAxisAngle(up, s.face); m.compose(new THREE.Vector3(s.x, 0.1, s.z), q, one);
      const P = (g, hex, x, y, z) => { g.translate(x, y, z); parts.push(place(colored(g, hex), m)); };
      P(new THREE.BoxGeometry(4.2, 0.15, 2.0), 0x2f6fb5, 0, 2.7, 0);
      P(new THREE.BoxGeometry(4.0, 1.6, 0.08), 0x9fc3d9, 0, 1.6, -0.9);
      for (const x of [-1.95, 1.95]) P(new THREE.BoxGeometry(0.1, 2.7, 0.1), 0x666666, x, 1.35, -0.85);
      P(new THREE.BoxGeometry(3.2, 0.1, 0.5), 0x8a5a3a, 0, 0.5, -0.55);
      P(new THREE.BoxGeometry(0.08, 3.2, 0.08), 0x555555, 2.4, 1.6, 0.6);
      signs.push([new THREE.Vector3(2.4, 3.1, 0.6).applyMatrix4(m), s.face]);
      this.world.addCircle(s.x, s.z, 1.0);
    }
    // merge in chunks so far-away shelters can be culled
    for (let i = 0; i < parts.length; i += 600) {
      const mesh = new THREE.Mesh(mergeGeometries(parts.slice(i, i + 600)), new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    }
    const tex = canvasTexture(256, 128, () => { }, false);
    const draw = () => {
      const c = tex.image.getContext('2d');
      c.fillStyle = '#1f4f9c'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#fff'; c.fillRect(6, 6, 244, 116); c.fillStyle = '#1f4f9c'; c.fillRect(10, 10, 236, 108);
      c.fillStyle = '#fff'; c.font = 'bold 46px "Hind Siliguri", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('🚌 ' + t('bus_stop'), 128, 64); tex.needsUpdate = true;
    };
    draw(); onLang(draw);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), Math.max(1, signs.length));
    signs.forEach(([p, f], i) => { q.setFromAxisAngle(up, f); m.compose(p, q, one); im.setMatrixAt(i, m); });
    im.computeBoundingSphere(); this.scene.add(im);
    return stops;
  }

  // ------------------------------------------------------------ traffic signals [x, z, road angle, road width]
  buildSignals() {
    const W = this.world;
    const list = (this.d.signals || []).map(([x, z, ang, w]) => ({ x, z, ang, w, off: Math.abs(Math.round(x * 7 + z * 3)) % 24 }));
    const poleG = new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6); poleG.translate(0, 2.1, 0);
    const boxG = new THREE.BoxGeometry(0.35, 1.0, 0.3); boxG.translate(0, 4.1, 0);
    const lampG = new THREE.SphereGeometry(0.11, 8, 6);
    const n = Math.max(1, list.length * 2);
    const poles = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x333333 }), n);
    const boxes = new THREE.InstancedMesh(boxG, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), n);
    this.lamps = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    this.poleInfo = [];
    list.forEach((s, i) => {
      for (let k = 0; k < 2; k++) {
        const a = s.ang + (k ? Math.PI / 2 : 0), off = s.w / 2 + 1.2;
        const px = s.x + Math.cos(a + Math.PI / 2) * off * (k ? -1 : 1), pz = s.z + Math.sin(a + Math.PI / 2) * off * (k ? -1 : 1);
        q.setFromAxisAngle(up, -a + Math.PI / 2); m.compose(v.set(px, 0.1, pz), q, one);
        poles.setMatrixAt(i * 2 + k, m); boxes.setMatrixAt(i * 2 + k, m);
        const base = m.clone();
        for (let L = 0; L < 3; L++) { const lp = new THREE.Vector3(0, 4.45 - L * 0.33, 0.17).applyMatrix4(base); m.compose(lp, q, one); this.lamps.setMatrixAt((i * 2 + k) * 3 + L, m); }
        this.poleInfo.push({ sig: i, axis: k });
        W.addCircle(px, pz, 0.2);
      }
    });
    poles.castShadow = true;
    for (const o of [poles, boxes, this.lamps]) o.computeBoundingSphere();
    this.scene.add(poles, boxes, this.lamps);
    this.lastPhase = '';
    return list;
  }

  signalState(i, heading, time) {
    const s = this.signals[i];
    const d = Math.abs(((heading - s.ang) % Math.PI + Math.PI) % Math.PI);
    return this.axisState(i, (d > Math.PI / 4 && d < 3 * Math.PI / 4) ? 1 : 0, time);
  }
  axisState(i, axis, time) {
    const c = (time + this.signals[i].off) % 24;
    if (axis === 0) return c < 10 ? 'g' : c < 12 ? 'y' : 'r';
    return c >= 12 && c < 22 ? 'g' : c >= 22 ? 'y' : 'r';
  }
  update(time) {
    const key = Math.floor(time * 2);
    if (key === this.lastPhase || !this.poleInfo.length) return; this.lastPhase = key;
    const col = new THREE.Color(), off = new THREE.Color(0x222222);
    const cols = { r: new THREE.Color(0xff2a1a), y: new THREE.Color(0xffb300), g: new THREE.Color(0x19e05a) };
    this.poleInfo.forEach((p, j) => {
      const st = this.axisState(p.sig, p.axis, time);
      for (let L = 0; L < 3; L++) {
        const on = (L === 0 && st === 'r') || (L === 1 && st === 'y') || (L === 2 && st === 'g');
        col.copy(on ? cols[['r', 'y', 'g'][L]] : off); this.lamps.setColorAt(j * 3 + L, col);
      }
    });
    this.lamps.instanceColor.needsUpdate = true;
  }
}
