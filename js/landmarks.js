// Hand-modelled famous Kolkata landmarks, placed at their real OpenStreetMap locations.
import * as THREE from 'three';
import { orientedRect, pointInPoly, distToSeg, canvasTexture } from './geo.js';
import { tland } from './i18n.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// collects box beams into one InstancedMesh per material
class Beams {
  constructor(mat) { this.mat = mat; this.list = []; }
  add(a, b, t, t2 = t) { this.list.push([a.clone(), b.clone(), t, t2]); }
  build(scene) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(g, this.mat, this.list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), z = V(0, 0, 1), d = new THREE.Vector3(), mid = new THREE.Vector3();
    this.list.forEach(([a, b, t, t2], i) => {
      d.subVectors(b, a); const L = d.length(); d.normalize();
      q.setFromUnitVectors(z, d); s.set(t, t2, L + t * 0.5); mid.addVectors(a, b).multiplyScalar(0.5);
      m.compose(mid, q, s); im.setMatrixAt(i, m);
    });
    im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true; scene.add(im); return im;
  }
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; parent && parent.add(m); return m;
}
function cyl(rt, rb, h, mat, x, y, z, parent, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; parent && parent.add(m); return m;
}
function dome(r, mat, x, y, z, parent, sy = 1, seg = 20) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2), mat); m.position.set(x, y, z); m.scale.y = sy; m.castShadow = true; parent && parent.add(m); return m;
}
function cone(r, h, mat, x, y, z, parent, seg = 8) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat); m.position.set(x, y + h / 2, z); m.castShadow = true; parent && parent.add(m); return m;
}
// rectangle polygon (flat array) for colliders
function rectPoly(cx, cz, ang, len, wid) {
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux, out = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(cx + ux * a * len / 2 + vx * b * wid / 2, cz + uz * a * len / 2 + vz * b * wid / 2);
  return out;
}

// Landmark names, descriptions and spoken intros live in data/strings.json ("landmarks") and data/comment.json.

export class Landmarks {
  constructor(scene, world) { this.scene = scene; this.world = world; this.list = []; }

  build() {
    this.howrahBridge();
    this.victoria();
    this.shaheedMinar();
    this.eden();
    this.decorateFootprints();
    return this.list;
  }
  register(id, x, z, r, travel) {
    const [tx, tz] = this.world.findSafeSpot(...(travel || [x, z + r + 8]));
    this.list.push({
      id, x, z, r, travel: [tx, tz],
      get name() { return tland(id, 'name'); }, get kind() { return tland(id, 'kind'); }, get body() { return tland(id, 'body'); },
    });
  }

  // ------------------------------------------------------------ Howrah Bridge
  howrahBridge() {
    const E = V(-23.9, 0, -2168.8), W = V(-402.2, 0, -2268.6);
    const u = W.clone().sub(E); const S = u.length(); u.normalize();
    const v = V(-u.z, 0, u.x);
    const a = 72, half = 11;
    const steel = M(0x9aa2a8);
    const beams = new Beams(steel), heavy = new Beams(steel);
    const top = (s) => s < 0 ? 24 + (70 - 24) * (s + a) / a : s > S ? 24 + (70 - 24) * (S + a - s) / a : 28 + 42 * ((s - S / 2) / (S / 2)) ** 2;
    const P = (s, y, side) => E.clone().addScaledVector(u, s).addScaledVector(v, side * half).setY(y);
    const nodes = []; const N = Math.round((S + 2 * a) / 14);
    for (let i = 0; i <= N; i++) nodes.push(-a + (S + 2 * a) * i / N);
    const yb = 0.7;
    for (const side of [-1, 1]) {
      for (let i = 0; i < nodes.length; i++) {
        const s0 = nodes[i];
        beams.add(P(s0, yb, side), P(s0, top(s0), side), 0.8);
        if (i < nodes.length - 1) {
          const s1 = nodes[i + 1];
          heavy.add(P(s0, yb, side), P(s1, yb, side), 1.4, 1.2);
          heavy.add(P(s0, top(s0), side), P(s1, top(s1), side), 1.6, 1.4);
          beams.add(P(s0, yb, side), P(s1, top(s1), side), 0.55);
          beams.add(P(s0, top(s0), side), P(s1, yb, side), 0.55);
          // mid-height stringer on tall panels
          const mh0 = top(s0) * 0.5, mh1 = top(s1) * 0.5; if (mh0 > 18) beams.add(P(s0, mh0, side), P(s1, mh1, side), 0.5);
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const s0 = nodes[i], t0 = top(s0);
      beams.add(P(s0, t0, -1), P(s0, t0, 1), 0.7);
      if (t0 > 14) beams.add(P(s0, 7.2, -1), P(s0, 7.2, 1), 0.5); // clearance portal
      if (i < nodes.length - 1) { const s1 = nodes[i + 1]; beams.add(P(s0, t0, -1), P(s1, top(s1), 1), 0.4); beams.add(P(s0, t0, 1), P(s1, top(s1), -1), 0.4); }
    }
    // towers on piers
    const concrete = M(0x8f8a7e);
    for (const s of [0, S]) {
      for (const side of [-1, 1]) heavy.add(P(s, -9, side), P(s, 76, side), 3.0, 3.0);
      for (const y of [20, 45, 74]) heavy.add(P(s, y, -1.1), P(s, y, 1.1), 1.8);
      heavy.add(P(s, 30, -1), P(s, 72, 1), 0.8); heavy.add(P(s, 30, 1), P(s, 72, -1), 0.8);
      const c = P(s, 0, 0);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 34), concrete);
      pier.position.set(c.x, -4.8, c.z); pier.rotation.y = Math.atan2(u.x, u.z); this.scene.add(pier);
      for (const side of [-1, 1]) { const tc = P(s, 76, side); cone(2.4, 4, steel, tc.x, 76, tc.z, this.scene, 4); }
    }
    beams.build(this.scene); heavy.build(this.scene);
    // colliders along the trusses (keep player on the carriageway/footpath)
    for (let s = -a; s <= S + a; s += 1.6) for (const side of [-1, 1]) { const p = P(s, 0, side); this.world.addCircle(p.x, p.z, 0.45); }
    const mid = E.clone().addScaledVector(u, S / 2);
    this.register('howrah', mid.x, mid.z, S / 2 + 30, [E.x + u.x * -90, E.z + u.z * -90]);
    this.list[this.list.length - 1].seg = [E.x - u.x * a, E.z - u.z * a, W.x + u.x * a, W.z + u.z * a];
  }

  // ------------------------------------------------------------ Victoria Memorial
  victoria() {
    const cx = -663.2, cz = 2217.5, ang = 10.6 * Math.PI / 180;
    const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = -ang;
    const marble = M(0xf4f1ea), marble2 = M(0xe4e0d6), dark = M(0x5c6269), bronze = M(0x2c2a26);
    box(118, 1.2, 92, marble2, 0, 0, 0, g);
    box(110, 2.4, 84, marble, 0, 1.2, 0, g);
    box(104, 13, 50, marble, 0, 3.6, 0, g);           // main wings
    box(34, 15, 80, marble, 0, 3.6, 0, g);            // central N-S block with porches
    box(46, 8, 46, marble, 0, 18.6, 0, g);            // raised centre
    for (const [x, z] of [[-46, -22], [46, -22], [-46, 22], [46, 22]]) { // corner pavilions
      box(14, 18, 14, marble, x, 3.6, z, g); dome(6, marble, x, 21.6, z, g, 1.15); cone(0.6, 3, bronze, x, 28.2, z, g, 6);
    }
    for (const [x, z] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) { // chhatris around the dome
      cyl(2.6, 2.6, 5, marble, x, 26.6, z, g, 8); dome(3, marble, x, 31.6, z, g, 1.2); cone(0.3, 1.8, bronze, x, 35, z, g, 6);
    }
    cyl(13, 13.5, 7, marble, 0, 26.6, 0, g, 24);       // drum
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const w = box(2.2, 4.2, 0.6, dark, Math.cos(a) * 13.4, 27.8, Math.sin(a) * 13.4, g); w.rotation.y = -a + Math.PI / 2; }
    dome(14.6, marble, 0, 33.6, 0, g, 1.22, 32);       // main dome
    cyl(2.4, 2.8, 3.2, marble, 0, 51.3, 0, g, 12); dome(2.6, marble, 0, 54.5, 0, g, 1.2, 12);
    // Angel of Victory (bronze)
    const angel = new THREE.Group(); angel.position.set(0, 57.3, 0); g.add(angel);
    cyl(0.25, 0.6, 1.2, bronze, 0, 0, 0, angel, 8); cyl(0.32, 0.45, 2.4, bronze, 0, 1.2, 0, angel, 8);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 8, 6), bronze); head.position.y = 3.9; angel.add(head);
    for (const s of [-1, 1]) { const w = box(0.15, 2.4, 1.3, bronze, s * 0.6, 2.2, -0.4, angel); w.rotation.z = s * 0.5; }
    const trumpet = box(0.15, 0.15, 1.4, bronze, 0.3, 3.4, 0.7, angel); trumpet.rotation.x = -0.6;
    this.angel = angel;
    // façade arches
    box(14, 10, 0.6, dark, 0, 4, -40.2, g); box(14, 10, 0.6, dark, 0, 4, 40.2, g);
    dome(7, marble, 0, 14, -40.1, g, 0.4, 16).rotation.x = -Math.PI / 2;
    for (let x = 22; x <= 40; x += 6) for (const s of [-1, 1]) { box(2.6, 5, 0.4, dark, s * x, 6.5, -25.2, g); box(2.6, 5, 0.4, dark, s * x, 6.5, 25.2, g); }
    // Queen Victoria statue in front (north)
    box(5, 4.5, 5, marble2, 0, 0, -68, g); cyl(0.9, 1.3, 3.2, bronze, 0, 4.5, -68, g, 10);
    const qh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), bronze); qh.position.set(0, 8.2, -68); g.add(qh);
    this.scene.add(g);
    g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    this.world.addCollider(rectPoly(cx, cz, ang, 118, 92), 30, 'Victoria Memorial');
    this.world.addCollider(rectPoly(cx + Math.sin(ang) * 68, cz - Math.cos(ang) * 68, ang, 5.5, 5.5), 8, 'Queen Victoria statue');
    this.register('victoria', cx, cz, 70, [cx + Math.sin(ang) * 95, cz - Math.cos(ang) * 95]);
  }

  // ------------------------------------------------------------ Shaheed Minar
  shaheedMinar() {
    const x = 26.9, z = 234.7;
    const g = new THREE.Group(); g.position.set(x, 0, z);
    // from photos: all-white; square Egyptian-style pedestal with cornice + medallion, fluted tapering shaft,
    // two railed balconies with an arcaded drum between them, Turkish cupola on top (48 m)
    const white = M(0xf1efe8), shade = M(0xd9d5ca), dark = M(0x6b6a66);
    box(13, 0.8, 13, shade, 0, 0, 0, g);
    box(8.4, 7.5, 8.4, white, 0, 0.8, 0, g); box(9.4, 0.8, 9.4, white, 0, 8.3, 0, g); box(7, 1.4, 7, white, 0, 9.1, 0, g);
    for (const [dx, dz, ry] of [[0, -4.25, 0], [0, 4.25, 0], [-4.25, 0, Math.PI / 2], [4.25, 0, Math.PI / 2]]) { const md = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.18, 6, 20), shade); md.position.set(dx, 4.6, dz); md.rotation.y = ry; g.add(md); }
    const fl = (r0, r1, h, y) => {                              // fluted (ribbed) shaft
      const geo = new THREE.CylinderGeometry(r1, r0, h, 32, 1), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const px = pos.getX(i), pz = pos.getZ(i), k = 1 + 0.045 * Math.cos(Math.atan2(pz, px) * 16); pos.setX(i, px * k); pos.setZ(i, pz * k); }
      geo.computeVertexNormals(); const m = new THREE.Mesh(geo, white); m.position.y = y + h / 2; g.add(m);
    };
    fl(2.0, 1.55, 25, 10.5);
    cyl(1.9, 1.6, 1.0, white, 0, 35.5, 0, g, 24);                 // capital
    const bal = (r, y) => { cyl(r, r - 0.3, 0.5, white, 0, y, 0, g, 24); const rl = new THREE.Mesh(new THREE.TorusGeometry(r - 0.05, 0.07, 4, 32), white); rl.rotation.x = Math.PI / 2; rl.position.y = y + 1.4; g.add(rl);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; cyl(0.05, 0.05, 0.9, white, Math.cos(a) * (r - 0.05), y + 0.5, Math.sin(a) * (r - 0.05), g, 4); } };
    bal(2.7, 36.5);
    cyl(1.35, 1.45, 4.5, white, 0, 37, 0, g, 16);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; box(0.5, 1.8, 0.1, dark, Math.cos(a) * 1.38, 38.2, Math.sin(a) * 1.38, g).rotation.y = -a + Math.PI / 2; }
    bal(2.2, 41.5);
    cyl(1.05, 1.15, 3.0, white, 0, 42, 0, g, 16);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; box(0.4, 1.4, 0.1, dark, Math.cos(a) * 1.08, 42.8, Math.sin(a) * 1.08, g).rotation.y = -a + Math.PI / 2; }
    cyl(1.4, 1.2, 0.4, white, 0, 45, 0, g, 16);
    dome(1.25, white, 0, 45.4, 0, g, 1.35, 16); cyl(0.12, 0.2, 1.6, white, 0, 47.0, 0, g, 6); dome(0.25, white, 0, 48.4, 0, g, 1.4, 8);
    this.scene.add(g); g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    this.world.addCollider(rectPoly(x, z, 0, 12, 12), 50, 'Shaheed Minar');
    this.world.removeBuildingsIn(rectPoly(x, z, 0, 12, 12));
    this.register('minar', x, z, 16, [x + 10, z + 18]);
  }

  // ------------------------------------------------------------ Eden Gardens
  eden() {
    const cx = -587.9, cz = 39.6, ang = 73.7 * Math.PI / 180;
    const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = -ang; g.scale.set(1.03, 1, 0.985);
    const seats = canvasTexture(64, 256, (c) => {
      const cols = ['#2e5ea8', '#e9e9e9', '#3b8a4a', '#d8b23a', '#2e5ea8', '#8a2f2f'];
      for (let i = 0; i < 32; i++) { c.fillStyle = cols[Math.floor(i / 5.4) % cols.length]; c.fillRect(0, i * 8, 64, 6); c.fillStyle = '#555'; c.fillRect(0, i * 8 + 6, 64, 2); }
    });
    seats.repeat.set(40, 1);
    const prof = [[74, 0], [74, 3], [86, 11], [98, 21], [108, 30], [116, 37], [121, 38], [122, 0]].map(([r, y]) => new THREE.Vector2(r, y));
    const stands = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), new THREE.MeshLambertMaterial({ map: seats, side: THREE.DoubleSide }));
    stands.castShadow = stands.receiveShadow = true; g.add(stands);
    // from photos: blue glass curtain-wall facade with white mullions and a white concrete base band (CAB)
    const ft = canvasTexture(256, 128, (c) => {
      c.fillStyle = '#e8e6e0'; c.fillRect(0, 0, 256, 128);
      const gr = c.createLinearGradient(0, 0, 0, 96); gr.addColorStop(0, '#3a8fd8'); gr.addColorStop(1, '#1e5ea8'); c.fillStyle = gr; c.fillRect(0, 8, 256, 88);
      c.fillStyle = 'rgba(255,255,255,0.9)'; for (let x = 0; x < 256; x += 32) c.fillRect(x, 8, 3, 88); for (let y = 8; y < 96; y += 22) c.fillRect(0, y, 256, 2);
      c.fillStyle = 'rgba(255,255,255,0.25)'; for (let x = 4; x < 256; x += 32) c.fillRect(x, 10, 10, 84);
      c.fillStyle = '#c9c4b8'; c.fillRect(0, 96, 256, 32); c.fillStyle = '#6b6b6b'; for (let x = 10; x < 256; x += 42) c.fillRect(x, 104, 20, 24);
    });
    ft.wrapS = THREE.RepeatWrapping; ft.repeat.set(24, 1);
    const facade = new THREE.Mesh(new THREE.CylinderGeometry(122.5, 122.5, 38, 96, 1, true), new THREE.MeshPhongMaterial({ map: ft, shininess: 60, specular: 0x557799, side: THREE.DoubleSide })); facade.position.y = 19; g.add(facade);
    const roof = new THREE.Mesh(new THREE.RingGeometry(90, 127, 96), M(0xf6f6f4, { side: THREE.DoubleSide })); roof.rotation.x = -Math.PI / 2; roof.position.y = 45; roof.castShadow = true; g.add(roof);
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; cyl(0.5, 0.5, 7, M(0xcccccc), Math.cos(a) * 123, 38, Math.sin(a) * 123, g, 6); }
    const fieldTex = canvasTexture(256, 256, (c) => { for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#4f9a3f' : '#5aa848'; c.fillRect(0, i * 16, 256, 16); } });
    const field = new THREE.Mesh(new THREE.CircleGeometry(75, 64), new THREE.MeshLambertMaterial({ map: fieldTex })); field.rotation.x = -Math.PI / 2; field.position.y = 0.2; g.add(field);
    box(3.2, 0.05, 20, M(0xc9b48a), 0, 0.21, 0, g);
    for (let i = 0; i < 6; i++) { // floodlights
      const a = i / 6 * Math.PI * 2 + 0.3, r = 132;
      cyl(0.8, 1.2, 62, M(0x777777), Math.cos(a) * r, 0, Math.sin(a) * r, g, 8);
      const panel = box(9, 5, 1.2, M(0xffffff, { emissive: 0x888866 }), Math.cos(a) * r, 60, Math.sin(a) * r, g); panel.lookAt(cx, 30, cz); panel.rotation.y = -a + Math.PI / 2;
    }
    this.scene.add(g);
    const poly = [], ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; const lx = Math.cos(a) * 124 * 1.03, lz = Math.sin(a) * 124 * 0.985; poly.push(cx + lx * ca - lz * sa, cz + lx * sa + lz * ca); }
    this.world.addCollider(poly, 45, 'Eden Gardens');
    this.world.removeBuildingsIn(poly);
    this.register('eden', cx, cz, 140);
  }

  // ------------------------------------------------------------ details on real footprints (rects exported by build_region.py)
  decorateFootprints() {
    const L = this.world.d.landmarks || {};
    const atRect = (r) => { const g = new THREE.Group(); g.position.set(r.cx, 0, r.cz); g.rotation.y = -r.ang; this.scene.add(g); return g; };
    // Writers' Building: white portico, pediment & statues on the south (Lal Dighi) façade
    if (L.writers) {
      const r = L.writers.rect, ht = 21;
      const nx = -Math.sin(r.ang), nz = Math.cos(r.ang), fz = nz > 0 ? 1 : -1;
      const fx = r.cx + nx * fz * r.wid / 2, fzP = r.cz + nz * fz * r.wid / 2;
      const g = new THREE.Group(); g.position.set(fx, 0, fzP); g.rotation.y = -r.ang; this.scene.add(g);
      const white = Mc(0xf1ece2), stat = Mc(0xd8d2c4);
      box(34, ht + 3, 3, white, 0, 0, 0, g);
      for (let i = -3; i <= 3; i++) cyl(0.6, 0.6, ht - 2, white, i * 4.6, 2, fz * 2.2, g, 10);
      const tri = new THREE.Shape([new THREE.Vector2(-17, 0), new THREE.Vector2(17, 0), new THREE.Vector2(0, 6)]);
      const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 3, bevelEnabled: false }), white); ped.position.set(0, ht + 3, -1.5); g.add(ped);
      for (let i = -10; i <= 10; i++) if (Math.abs(i) > 3) cyl(0.35, 0.45, 2.4, stat, i * 5.2, ht, 0, g, 8);
      this.register('writers', fx, fzP, r.len / 2 + 10, [fx + nx * fz * 25, fzP + nz * fz * 25]);
    }
    if (L.stpauls) {
      const r = L.stpauls.rect, white = Mc(0xe9e5db), dark = Mc(0x4d5258), g = atRect(r);
      box(12, 60, 12, white, 0, 0, 0, g);
      for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { box(1.6, 62, 1.6, white, x, 0, z, g); cone(0.9, 5, white, x, 62, z, g, 4); }
      for (const sd of [-1, 1]) { box(2.2, 9, 0.4, dark, 0, 42, sd * 6.1, g); box(0.4, 9, 2.2, dark, sd * 6.1, 42, 0, g); }
      this.register('stpauls', r.cx, r.cz, Math.max(r.len, r.wid) / 2 + 10);
    }
    if (L.newmarket) {
      const r = L.newmarket.rect, ht = 15;
      // clock tower at the northern corner
      let best = null;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = r.cx + Math.cos(r.ang) * a * r.len / 2 - Math.sin(r.ang) * b * r.wid / 2, z = r.cz + Math.sin(r.ang) * a * r.len / 2 + Math.cos(r.ang) * b * r.wid / 2;
        if (!best || z < best[1]) best = [x + (r.cx - x) * 0.08, z + (r.cz - z) * 0.08];
      }
      const brick = Mc(0xa34a32), white = Mc(0xf3efe6), g = new THREE.Group(); g.position.set(best[0], 0, best[1]); this.scene.add(g);
      box(8, ht + 18, 8, brick, 0, 0, 0, g);
      for (const [x, z, ry] of [[0, 4.05, 0], [0, -4.05, Math.PI], [4.05, 0, Math.PI / 2], [-4.05, 0, -Math.PI / 2]]) { const c = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20), white); c.position.set(x, ht + 13, z); c.rotation.y = ry; g.add(c); }
      cone(6.2, 7, Mc(0x5b3a2e), 0, ht + 18, 0, g, 4).rotation.y = Math.PI / 4;
      this.register('newmarket', r.cx, r.cz, 90);
    }
    if (L.station) {
      const r = L.station.rect, ht = 15, ux = Math.cos(r.ang), uz = Math.sin(r.ang);
      let nx = -uz, nz = ux; if (nx < 0) { nx = -nx; nz = -nz; }
      const brick = Mc(0xa5452f), roofM = Mc(0x3f4a3c);
      for (const f of [-0.36, -0.22, -0.08, 0.08, 0.22, 0.36]) {
        const x = r.cx + ux * f * r.len + nx * (r.wid / 2 - 6), z = r.cz + uz * f * r.len + nz * (r.wid / 2 - 6), big = Math.abs(f) < 0.1;
        box(big ? 11 : 8, ht + (big ? 16 : 11), big ? 11 : 8, brick, x, 0, z, this.scene).rotation.y = -r.ang;
        cone(big ? 8 : 6, 6, roofM, x, ht + (big ? 16 : 11), z, this.scene, 4).rotation.y = -r.ang + Math.PI / 4;
      }
      this.register('station', r.cx + nx * r.wid / 2, r.cz + nz * r.wid / 2, 60, [r.cx + nx * (r.wid / 2 + 25), r.cz + nz * (r.wid / 2 + 25)]);
    }
    { // GPO dome at BBD Bag
      const x = -123.4, z = -884.6, ht = 18, white = Mc(0xf1eee6);
      cyl(9, 9, 7, white, x, ht, z, this.scene, 24);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; cyl(0.5, 0.55, 7, white, x + Math.cos(a) * 10.2, ht, z + Math.sin(a) * 10.2, this.scene, 8); }
      cyl(10.8, 10.8, 0.8, white, x, ht + 7, z, this.scene, 24);
      dome(9.4, white, x, ht + 7.8, z, this.scene, 1.15, 24); cyl(1, 1.2, 2.5, white, x, ht + 18.4, z, this.scene, 8);
      this.register('gpo', x, z, 40);
    }
    if (L.museum) this.register('museum', L.museum.x, L.museum.z, 80);
    if (L.nakhoda) {
      const r = L.nakhoda.rect, redSand = Mc(0xa8432f), white = Mc(0xf2efe8), ux = Math.cos(r.ang), uz = Math.sin(r.ang);
      dome(9, redSand, r.cx, 20, r.cz, this.scene, 1.3, 16);
      for (const sd of [-1, 1]) { const mx = r.cx + ux * sd * (r.len / 2 - 2), mz = r.cz + uz * sd * (r.len / 2 - 2); cyl(1.1, 1.5, 46, redSand, mx, 0, mz, this.scene, 10); cyl(1.8, 1.8, 0.5, white, mx, 32, mz, this.scene, 10); dome(1.3, white, mx, 46, mz, this.scene, 1.4, 10); }
      this.register('nakhoda', r.cx, r.cz, Math.max(r.len, r.wid) / 2 + 12);
    }
    if (L.sealdah || L.sealdah_bld) {
      const s = L.sealdah_bld || L.sealdah;
      if (s.rect) {
        const r = s.rect, cream = Mc(0xe8d9b5), red = Mc(0xa5452f), ux = Math.cos(r.ang), uz = Math.sin(r.ang);
        for (const f of [-0.3, 0, 0.3]) { const x = r.cx + ux * f * r.len, z = r.cz + uz * f * r.len; box(9, 24, 9, cream, x, 0, z, this.scene).rotation.y = -r.ang; cone(7, 5, red, x, 24, z, this.scene, 4).rotation.y = -r.ang + Math.PI / 4; }
      }
      this.register('sealdah', s.x, s.z, 90);
    }
    // places of interest with info cards (no special model)
    for (const id of ['dumdum', 'belghoria', 'dankuni', 'hatibagan', 'ultadanga', 'borobazar', 'newtown', 'ecopark']) {
      const p = L[id]; if (p) this.register(id, p.x, p.z, id === 'newtown' || id === 'ecopark' ? 200 : 70);
    }
    this.dakshineswar(); this.biswaBanglaGate(); this.akankhaMore(); this.sevenWonders(); this.saltLakeStadium(); this.airport(); this.riverBridges();
  }

  // ------------------------------------------------------------ Dakshineswar Kali Temple (navaratna, 9 spires, 12 Shiva temples, ghat)
  // Modelled from photos: navaratna (nine-spired) temple, cream walls with rust-red curved Bengali roofs on every
  // storey, ribbed bulbous spires with gold finials, on a high plinth; 12 Shiva temples with red bell roofs in two rows
  // of six facing the Ganga, the bathing ghat (steps into the river) between them; red & cream courtyard ranges.
  dakshineswar() {
    const p = this.world.d.landmarks?.dakshineswar; if (!p) return;
    const r = p.rect || { cx: p.x, cz: p.z, ang: 0 };
    this.world.hideBuildingsIn(rectPoly(r.cx, r.cz, r.ang, Math.max(80, (r.len || 0) + 10), Math.max(80, (r.wid || 0) + 10)));
    this.world.addCollider(rectPoly(r.cx, r.cz, r.ang, 27, 27), 30, 'Dakshineswar Kali Temple');
    const g = new THREE.Group(); g.position.set(r.cx, 0, r.cz); this.scene.add(g);
    const rd = this.riverDir(r.cx, r.cz);                                 // local -x faces the Ganga (Shiva temples + ghat)
    g.rotation.y = rd ? Math.atan2(rd[1], -rd[0]) : -r.ang;
    const cream = Mc(0xf0e2c4), red = Mc(0xb4503a), stone = Mc(0xcfc6b2), dark = Mc(0x4a3a2e), rail = Mc(0xe9e1cc);
    box(76, 1.2, 76, stone, 0, 0, 0, g);                                // courtyard (chatal)
    // main temple: plinth, 3 storeys, each with a red curved roof skirt
    box(28, 3.2, 28, cream, 0, 1.2, 0, g);
    for (let i = -3; i <= 3; i++) box(0.5, 1.2, 0.5, rail, i * 4, 4.4, -13.8, g);
    box(22, 7, 22, cream, 0, 4.4, 0, g); this.chala(g, 0, 11.4, 0, 12.6, 2.4, red);
    box(15, 5, 15, cream, 0, 13.6, 0, g); this.chala(g, 0, 18.6, 0, 8.8, 2, red);
    box(7.5, 4, 7.5, cream, 0, 20.4, 0, g);
    for (let i = -2; i <= 2; i++) { box(2.2, 4.6, 0.4, dark, i * 3.8, 5, -11.1, g); dome(1.1, dark, i * 3.8, 9.6, -11.15, g, 0.9, 10); } // arched doorways
    for (const [x, z] of [[-9.5, -9.5], [9.5, -9.5], [-9.5, 9.5], [9.5, 9.5]]) { box(4.2, 2.2, 4.2, cream, x, 12.4, z, g); this.spire(g, x, 14.6, z, 2.0, 5.2); }
    for (const [x, z] of [[-6.2, -6.2], [6.2, -6.2], [-6.2, 6.2], [6.2, 6.2]]) { box(3.4, 1.8, 3.4, cream, x, 19.4, z, g); this.spire(g, x, 21.2, z, 1.7, 4.6); }
    this.spire(g, 0, 24.4, 0, 3.4, 8.5);                                // central spire, top ≈ 34 m
    // 12 Shiva temples (aatchala, red bell roofs) facing the river, 6 + 6 either side of the ghat
    for (let i = 0; i < 12; i++) {
      const zz = i < 6 ? -36 + i * 5.6 : 8 + (i - 6) * 5.6, x = -33;
      box(4.6, 1.2, 4.6, stone, x, 1.2, zz, g); box(4, 4.2, 4, cream, x, 2.4, zz, g); box(1.2, 2.4, 0.2, dark, x - 2.05, 2.6, zz, g).rotation.y = Math.PI / 2;
      this.aatchala(g, x, 6.6, zz, red);
    }
    // chandni (pillared ghat pavilion) + bathing steps down to the Ganga
    box(9, 6, 8, cream, -34, 1.2, 0, g); this.chala(g, -34, 7.2, 0, 6.2, 1.6, red);
    for (let k = 0; k < 10; k++) box(9, 0.6, 1.8, stone, -40 - k * 1.8, Math.max(-2.4, 0.6 - k * 0.6), 0, g);
    // red & cream courtyard ranges (offices, nahabat) on the other three sides
    for (const [x, z, w, d] of [[36, 0, 6, 70], [0, 36, 64, 6], [0, -36, 64, 6]]) {
      box(w, 4, d, cream, x, 1.2, z, g); box(w + 0.2, 0.7, d + 0.2, red, x, 5.2, z, g); box(w + 0.3, 1, d + 0.3, red, x, 1.2, z, g);
    }
    box(30, 6, 10, cream, 18, 1.2, -22, g); this.chala(g, 18, 7.2, -22, 11, 2, red);   // Radha-Krishna temple
    this.register('dakshineswar', r.cx, r.cz, 70);
  }
  // unit vector towards the nearest river water within 250 m (or null)
  riverDir(x, z) {
    for (let d = 20; d <= 250; d += 10) {
      let sx = 0, sz = 0, n = 0;
      for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; if (this.world.inRiver(px, pz)) { sx += Math.cos(a); sz += Math.sin(a); n++; } }
      if (n) { const L = Math.hypot(sx, sz) || 1; return [sx / L, sz / L]; }
    }
    return null;
  }
  // ribbed, bulbous Bengal rekha spire with a gold kalasa finial (cream with a red base band)
  spire(g, x, y, z, rr, h) {
    const prof = [[0, 0], [1, 0], [1, 0.12], [1.1, 0.3], [1.05, 0.5], [0.85, 0.7], [0.55, 0.85], [0.25, 0.96], [0.1, 1], [0, 1.02]].map(([a, b]) => new THREE.Vector2(a * rr, b * h));
    const geo = new THREE.LatheGeometry(prof, 24), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const px = pos.getX(i), pz = pos.getZ(i), k = 1 + 0.07 * Math.cos(Math.atan2(pz, px) * 12); pos.setX(i, px * k); pos.setZ(i, pz * k); }
    geo.computeVertexNormals();
    const s = new THREE.Mesh(geo, Mc(0xf3e7cc)); s.position.set(x, y, z); s.castShadow = true; g.add(s);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rr * 1.02, rr * 1.02, h * 0.1, 24), Mc(0xb4503a)); band.position.set(x, y + h * 0.05, z); g.add(band);
    const gold = Mc(0xd8a83a);
    const k1 = new THREE.Mesh(new THREE.SphereGeometry(rr * 0.2, 10, 8), gold); k1.position.set(x, y + h * 1.04, z); g.add(k1);
    const k2 = new THREE.Mesh(new THREE.ConeGeometry(rr * 0.07, h * 0.22, 6), gold); k2.position.set(x, y + h * 1.15, z); g.add(k2);
  }
  // curved Bengali roof skirt (chala): a square, concave-sided roof round a storey
  chala(g, x, y, z, half, h, col) {
    const R = half * Math.SQRT2, prof = [[R * 0.62, h], [R * 0.8, h * 0.75], [R * 0.93, h * 0.35], [R, 0], [R * 0.9, -0.15]].map(([a, b]) => new THREE.Vector2(a, b));
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 4), Mc(col.color.getHex(), { side: THREE.DoubleSide })); m.rotation.y = Math.PI / 4; m.position.set(x, y, z); m.castShadow = true; g.add(m);
  }
  // aat-chala Shiva temple roof: red bell / dome with a short finial
  aatchala(g, x, y, z, col) {
    const prof = [[0, 0], [2.6, 0], [2.6, 0.3], [2.4, 1.2], [1.8, 2.3], [0.9, 3.0], [0.3, 3.3], [0, 3.4]].map(([a, b]) => new THREE.Vector2(a, b));
    const roof = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), col); roof.position.set(x, y, z); roof.castShadow = true; g.add(roof);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1, 6), Mc(0xd8a83a)); f.position.set(x, y + 3.8, z); g.add(f);
  }

  // ------------------------------------------------------------ Biswa Bangla Gate (New Town): ring on two slanted legs
  // Modelled from photos: an elevated, slightly tilted elliptical ring (white underside, green-teal glass band with
  // truss lines and "biswa bangla gate" lettering), three slender arched steel legs crossing above the ring to a crown,
  // one massive white pillar through the ring, a square lift tower + spiral stairs, on a grass island with blue-white kerb.
  biswaBanglaGate() {
    const p = this.world.d.landmarks?.biswabangla; if (!p) return;
    const r = this.nearestRoadAng(p.x, p.z);
    this.world.hideBuildingsIn(rectPoly(p.x, p.z, r, 90, 90));
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = -r; this.scene.add(g);
    const white = Mc(0xeeeeea), concrete = Mc(0xd9d7d0), grey = Mc(0xb8b8b4);
    const H = 24, RX = 34, RZ = 27, BAND = 4.6;      // ring floor height, radii, glass band height
    // island + kerb painted in Kolkata blue & white
    const isl = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 0.35, 48), Mc(0x5d8f3c)); isl.scale.set(1.2, 1, 1); isl.position.y = 0.17; isl.receiveShadow = true; g.add(isl);
    const kt = canvasTexture(256, 8, (c) => { for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#2b56b8' : '#f4f4f4'; c.fillRect(i * 16, 0, 16, 8); } });
    kt.wrapS = THREE.RepeatWrapping; kt.repeat.set(14, 1);
    const kerb = new THREE.Mesh(new THREE.CylinderGeometry(40.3, 40.3, 0.45, 96, 1, true), new THREE.MeshLambertMaterial({ map: kt })); kerb.scale.set(1.2, 1, 1); kerb.position.y = 0.22; g.add(kerb);
    // ring (tilted ~5 deg)
    const ring = new THREE.Group(); ring.position.y = H; ring.rotation.x = 0.06; ring.rotation.z = -0.05; g.add(ring);
    const gt = canvasTexture(1024, 64, (c) => {
      const gr = c.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#2f8f86'); gr.addColorStop(0.5, '#46aa9c'); gr.addColorStop(1, '#2a7d76');
      c.fillStyle = gr; c.fillRect(0, 0, 1024, 64);
      c.strokeStyle = 'rgba(225,245,240,0.75)'; c.lineWidth = 2;
      for (let x = 0; x < 1024; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 64); c.stroke(); c.beginPath(); c.moveTo(x, 64); c.lineTo(x + 32, 0); c.stroke(); }
      c.fillStyle = 'rgba(235,250,248,.9)'; c.fillRect(0, 0, 1024, 3); c.fillRect(0, 61, 1024, 3);
      c.font = 'italic bold 34px Georgia, serif'; c.fillStyle = '#f5fbfa'; c.textBaseline = 'middle'; c.fillText('biswa bangla gate', 40, 33);
    });
    gt.wrapS = THREE.RepeatWrapping; gt.repeat.set(3, 1); gt.colorSpace = THREE.SRGBColorSpace;
    const glass = new THREE.MeshPhongMaterial({ map: gt, shininess: 110, specular: 0x99bbbb, side: THREE.DoubleSide });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(RZ, RZ, BAND, 96, 1, true), glass); band.scale.set(RX / RZ, 1, 1); band.position.y = BAND / 2 + 1.6; ring.add(band);
    // white underside: lathe of a rounded box section (outer belly -> inner lip)
    const sec = [[RZ - 0.1, 1.8], [RZ - 0.4, 0.6], [RZ - 1.6, 0], [RZ - 5.5, 0], [RZ - 6.3, 0.9], [RZ - 6.3, 2.6], [RZ - 5.8, 3.2], [RZ - 0.1, 1.8]].map(([a, b]) => new THREE.Vector2(a, b));
    const belly = new THREE.Mesh(new THREE.LatheGeometry(sec, 96), Mc(0xf1f0ea, { side: THREE.DoubleSide })); belly.scale.set(RX / RZ, 1, 1); belly.castShadow = true; ring.add(belly);
    const roof = new THREE.Mesh(new THREE.RingGeometry(RZ - 5.8, RZ + 0.2, 96), Mc(0xe6e6e0, { side: THREE.DoubleSide })); roof.rotation.x = -Math.PI / 2; roof.position.y = BAND + 1.7; roof.scale.set(RX / RZ, 1, 1); ring.add(roof);
    // little vent windows on the underside
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; box(1.6, 0.5, 0.2, Mc(0x55606a), Math.cos(a) * (RX - 3.2), 0.3, Math.sin(a) * (RZ - 3.2), ring).rotation.y = -a + Math.PI / 2; }
    // three slender arched steel legs: footing outside the ring -> past its rim -> crown above the ring
    const crown = V(-3, H + 21, 2);
    const tube = (pts, rad) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, rad, 10), white); m.castShadow = true; g.add(m); return m; };
    for (const [ax, az] of [[-48, -8], [44, -26], [20, 40]]) {
      const L = Math.hypot(ax, az), ux = ax / L, uz = az / L;
      tube([V(ax, 0, az), V(ux * (L - 5), H * 0.5, uz * (L - 5)), V(ux * (RX + 3), H + 7, uz * (RZ + 3)), V(ux * 16, H + 18, uz * 13), crown], 0.8);
      // strut holding the ring
      const rim = V(ux * RX, H + 3, uz * RZ), on = V(ux * (RX + 3), H + 7, uz * (RZ + 3));
      tube([rim, on], 0.25);
      this.world.addCircle(p.x + Math.cos(-r) * ax - Math.sin(-r) * az, p.z + Math.sin(-r) * ax + Math.cos(-r) * az, 1.2);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), white); knot.position.copy(crown); g.add(knot);
    tube([crown, V(-1, H + 6, 1)], 0.35);           // hanger rod down to the ring centre spokes
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; tube([V(-1, H + 6, 1), V(Math.cos(a) * (RX - 5), H + 5, Math.sin(a) * (RZ - 5))], 0.12); }
    // the massive white pillar through the ring rim
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.8, H + 16, 4), concrete); pil.rotation.y = Math.PI / 4; pil.position.set(RX - 2, (H + 16) / 2, -6); pil.castShadow = true; g.add(pil);
    // square lift tower with spiral stairs wrapped round a white core
    const tx = -RX + 2, tz = 6;
    box(7, H + 7, 7, grey, tx, 0, tz, g).castShadow = true;
    box(7.2, 0.6, 7.2, white, tx, H + 7, tz, g);
    const stair = (cx, cz, top, rr) => {
      const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, top, 10), white); core.position.set(cx, top / 2, cz); core.castShadow = true; g.add(core);
      const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.25, 1.4), white, Math.floor(top / 0.9));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let i = 0; i < steps.count; i++) { const a = i * 0.55, y = i * 0.9; q.setFromAxisAngle(V(0, 1, 0), -a); m.compose(V(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr), q, V(1, 1, 1)); steps.setMatrixAt(i, m); }
      steps.computeBoundingSphere(); steps.castShadow = true; g.add(steps);
      for (let y = 4; y < top; y += 4.5) { const rl = new THREE.Mesh(new THREE.TorusGeometry(rr + 1.2, 0.06, 4, 24), grey); rl.rotation.x = Math.PI / 2; rl.position.set(cx, y, cz); g.add(rl); }
      this.world.addCircle(p.x + Math.cos(-r) * cx - Math.sin(-r) * cz, p.z + Math.sin(-r) * cx + Math.cos(-r) * cz, rr + 1);
    };
    stair(tx + 6, tz - 2, H + 1, 2.2);
    stair(10, 20, H + 1, 2);
    // small entry kiosk with green roof at the foot of the tower
    box(12, 3.4, 6, Mc(0xe8e2d0), tx - 2, 0, tz + 10, g); box(13, 0.4, 7, Mc(0x3f7a3f), tx - 2, 3.4, tz + 10, g);
    this.world.addCircle(p.x + Math.cos(-r) * tx - Math.sin(-r) * tz, p.z + Math.sin(-r) * tx + Math.cos(-r) * tz, 5);
    this.register('biswabangla', p.x, p.z, 60);
  }
  // ------------------------------------------------------------ Eco Park "Seven Wonders" replicas (positions from OSM / Wikidata)
  sevenWonders() {
    const W = this.world, list = (W.d.pois || []).filter(p => p.k === 'wonder');
    const marble = Mc(0xf4f1ea), stone = Mc(0xc9a77c), sand = Mc(0xd8c08a), rock = Mc(0xc77b5a, { flatShading: true }), grey = Mc(0x9a948a, { flatShading: true }), green = Mc(0x5d8f3c), water = Mc(0x5aa6c8);
    const G = (x, z) => { const g = new THREE.Group(); g.position.set(x, 0, z); this.scene.add(g); return g; };
    for (const p of list) {
      const n = (p.n || '').toLowerCase(), g = G(p.x, p.z);
      W.hideBuildingsIn(rectPoly(p.x, p.z, 0, 34, 34));
      if (n.includes('taj')) {             // white marble mausoleum: plinth, iwan facade, onion dome, 4 minarets, water channel
        box(30, 1.5, 30, marble, 0, 0, 0, g); box(16, 11, 16, marble, 0, 1.5, 0, g);
        for (const [dx, dz, ry] of [[0, -8.05, 0], [0, 8.05, 0], [-8.05, 0, Math.PI / 2], [8.05, 0, Math.PI / 2]]) { const a = box(5, 8, 0.2, Mc(0x8a8a86), dx, 2, dz, g); a.rotation.y = ry; }
        cyl(4.2, 4.2, 2.5, marble, 0, 12.5, 0, g, 24);
        const prof = [[0, 0], [4.6, 0], [5.4, 2.2], [5.0, 4.6], [3.6, 6.4], [1.6, 7.6], [0.3, 8.4], [0, 8.6]].map(([a, b]) => new THREE.Vector2(a, b));
        const dm = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), marble); dm.position.y = 15; dm.castShadow = true; g.add(dm);
        cone(0.2, 2, Mc(0xd8a83a), 0, 23.4, 0, g, 6);
        for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { cyl(1.6, 1.6, 2, marble, dx, 12.5, dz, g, 12); dome(1.7, marble, dx, 14.5, dz, g, 1.2, 12); }
        for (const [dx, dz] of [[-13.5, -13.5], [13.5, -13.5], [-13.5, 13.5], [13.5, 13.5]]) { cyl(0.8, 1.0, 16, marble, dx, 1.5, dz, g, 10); dome(1.0, marble, dx, 17.5, dz, g, 1.2, 10); }
        box(3, 0.3, 34, water, 0, 0.05, 30, g);
      } else if (n.includes('colosseum')) {  // elliptical ring of arcades, partly broken top tier
        const tex = canvasTexture(256, 128, (c) => { c.fillStyle = '#cfae7f'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#5a4630';
          for (let r = 0; r < 3; r++) for (let x = 6; x < 256; x += 32) { c.beginPath(); c.moveTo(x, r * 42 + 38); c.lineTo(x, r * 42 + 18); c.arc(x + 10, r * 42 + 18, 10, Math.PI, 0); c.lineTo(x + 20, r * 42 + 38); c.fill(); } });
        tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(10, 1);
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(17, 17, 13, 64, 1, true, 0, Math.PI * 1.75), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
        wall.scale.set(1.2, 1, 1); wall.position.y = 6.5; wall.castShadow = true; g.add(wall);
        const inner = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 8, 48, 1, true), stone); inner.scale.set(1.2, 1, 1); inner.position.y = 4; g.add(inner);
        const fl = new THREE.Mesh(new THREE.CircleGeometry(12, 32), sand); fl.rotation.x = -Math.PI / 2; fl.scale.set(1.2, 1, 1); fl.position.y = 0.1; g.add(fl);
      } else if (n.includes('great wall')) {  // zig-zag crenellated wall with watch towers
        const pts = [[0, 0], [14, -8], [28, -2], [42, -12]];
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), a = Math.atan2(bx - ax, bz - az);
          const w = box(4, 5 + i, L, grey, (ax + bx) / 2, 0, (az + bz) / 2, g); w.rotation.y = a;
          for (let k = 0; k < L; k += 1.6) { const m = box(0.7, 0.8, 0.7, grey, ax + Math.sin(a) * k + Math.cos(a) * 1.6, 5 + i, az + Math.cos(a) * k - Math.sin(a) * 1.6, g); m.rotation.y = a; }
          box(6, 8 + i, 6, grey, bx, 0, bz, g);
        }
        box(6, 7, 6, grey, 0, 0, 0, g);
      } else if (n.includes('petra')) {       // rose-red rock with the Treasury facade carved in
        box(26, 18, 8, rock, 0, 0, -3, g);
        box(14, 0.8, 1, Mc(0xd99a7a), 0, 7, 1.2, g);
        for (let i = -2; i <= 2; i++) cyl(0.55, 0.55, 7, Mc(0xd99a7a), i * 2.8, 0, 1.4, g, 10);
        for (let i = -1; i <= 1; i++) cyl(0.45, 0.45, 6, Mc(0xd99a7a), i * 4.5, 7.8, 1.2, g, 10);
        cyl(1.6, 1.6, 4, Mc(0xd99a7a), 0, 8, 1.2, g, 14); cone(1.8, 1.6, Mc(0xd99a7a), 0, 12, 1.2, g, 14);
        box(2.4, 4, 0.3, Mc(0x2a1a14), 0, 0, 1.15, g);
      } else if (n.includes('christ')) {       // white statue with outstretched arms on a pedestal
        box(5, 7, 5, marble, 0, 0, 0, g); cyl(1.0, 1.6, 8, marble, 0, 7, 0, g, 12);
        box(11, 1.1, 1.0, marble, 0, 13.2, 0, g); cyl(0.9, 1.0, 2.2, marble, 0, 13, 0, g, 10); dome(0.75, marble, 0, 15.6, 0, g, 1.3, 10);
      } else if (n.includes('moai')) {         // row of big stone heads
        for (let i = 0; i < 5; i++) {
          const h = new THREE.Group(); h.position.set((i - 2) * 4.2, 0, 0); h.rotation.y = (i - 2) * 0.05; g.add(h);
          box(2.4, 3, 2, grey, 0, 0, 0, h); box(2.6, 4, 2.2, grey, 0, 3, 0, h); box(2.8, 0.8, 1.2, grey, 0, 5.6, 0.6, h);
          box(0.7, 1.6, 0.6, grey, 0, 4.4, 1.25, h); box(3, 0.6, 2.4, Mc(0x8a5a40), 0, 7, 0, h);
        }
      } else continue;
      g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      W.addCircle(p.x, p.z, 8);
    }
    void green;
  }

  // ------------------------------------------------------------ Akankha More: roundabout with a sculpture
  akankhaMore() {
    const p = this.world.d.landmarks?.akankha; if (!p) return;
    this.world.hideBuildingsIn(rectPoly(p.x, p.z, 0.5, 96, 70));   // island kept open so the sculpture reads from the roads
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); this.scene.add(g);
    // from photos: a tall rust-brown (weathering steel) sculpture of stacked, cantilevered angular plates
    const grass = Mc(0x5f8c3e), stone = Mc(0xd8d0c0), rust = Mc(0x9a5a33, { flatShading: true }), rust2 = Mc(0x7d4426, { flatShading: true });
    const isl = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 0.5, 32), grass); isl.position.y = 0.25; g.add(isl);
    box(5, 1.2, 5, stone, 0, 0.5, 0, g);
    box(1.4, 15, 1.4, rust2, 0, 1.7, 0, g);                                     // core stem
    const plate = (w, d, y, ry, tilt, mat) => {
      const sh = new THREE.Shape([new THREE.Vector2(-w / 2, -d * 0.3), new THREE.Vector2(w / 2, -d / 2), new THREE.Vector2(w * 0.4, d / 2), new THREE.Vector2(-w * 0.35, d * 0.35)]);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat); m.position.y = y; m.rotation.set(tilt, ry, tilt * 0.6); m.castShadow = true; g.add(m);
    };
    [[7, 3.5, 4, 0.2, 0.25], [8, 3, 6.5, 1.3, -0.3], [6.5, 3.2, 9, 2.4, 0.35], [7.5, 2.8, 11.5, 0.7, -0.25], [5.5, 3, 14, 1.9, 0.3], [4, 2.4, 16.5, 3.0, -0.2]]
      .forEach(([w, d, y, ry, t], i) => plate(w, d, y, ry, t, i % 2 ? rust : rust2));
    const vt = (h, y, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 3), rust); m.position.set(0, y, 0); m.rotation.set(0, ry, 0.25); m.castShadow = true; g.add(m); };
    vt(5, 5.5, 0.6); vt(4, 12, 2.1);
    for (const o of g.children) if (o !== isl) { o.scale.multiplyScalar(1.3); o.position.y *= 1.3; }
    this.world.addCircle(p.x, p.z, 13.5);
    this.register('akankha', p.x, p.z, 40);
  }
  // ------------------------------------------------------------ Salt Lake Stadium (Yuva Bharati Krirangan)
  saltLakeStadium() {
    const p = this.world.d.landmarks?.saltlakestadium; if (!p || !p.rect) return;
    const r = p.rect, R = Math.min(r.len, r.wid) / 2;
    const g = new THREE.Group(); g.position.set(r.cx, 0, r.cz); g.rotation.y = -r.ang; g.scale.set(r.len / r.wid, 1, 1); this.scene.add(g);
    const prof = [[R * 0.55, 0], [R * 0.55, 3], [R * 0.75, 18], [R * 0.95, 34], [R, 34], [R, 0]].map(([a, b]) => new THREE.Vector2(a, b));
    const st = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), Mc(0xb9bec4, { side: THREE.DoubleSide })); st.castShadow = st.receiveShadow = true; g.add(st);
    const roof = new THREE.Mesh(new THREE.RingGeometry(R * 0.7, R * 1.02, 64), Mc(0xeeeeee, { side: THREE.DoubleSide })); roof.rotation.x = -Math.PI / 2; roof.position.y = 38; g.add(roof);
    const field = new THREE.Mesh(new THREE.CircleGeometry(R * 0.55, 48), Mc(0x4f9a3f)); field.rotation.x = -Math.PI / 2; field.position.y = 0.2; g.add(field);
    const poly = []; for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2, lx = Math.cos(a) * R * r.len / r.wid, lz = Math.sin(a) * R; poly.push(r.cx + lx * Math.cos(r.ang) - lz * Math.sin(r.ang), r.cz + lx * Math.sin(r.ang) + lz * Math.cos(r.ang)); }
    this.world.hideBuildingsIn(poly);
    this.world.addCollider(poly, 38, 'Salt Lake Stadium');
    this.register('saltlakestadium', r.cx, r.cz, R + 40);
  }

  // ------------------------------------------------------------ Airport: parked planes + one taxiing
  airport() {
    const A = this.world.d.airport, p = this.world.d.landmarks?.airport;
    if (!A || !A.runways?.length) { if (p) this.register('airport', p.x, p.z, 300); return; }
    const planeG = planeGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // parked aircraft at the real stands (OSM aeroway=parking_position), nose-in towards the nearest terminal
    const T = A.terminals || [], spots = [];
    for (const [x, z, ang] of (A.stands || [])) {
      if (spots.some(o => Math.hypot(o[0] - x, o[1] - z) < 48)) continue;
      let heading = ang;
      const t = T.reduce((b, t) => (!b || Math.hypot(t.cx - x, t.cz - z) < Math.hypot(b.cx - x, b.cz - z) ? t : b), null);
      if (t) heading = Math.atan2(t.cx - x, t.cz - z); else if (heading === null) heading = 0;
      spots.push([x, z, heading]);
    }
    if (!spots.length) for (const [x, z] of A.aprons) for (let k = -1; k <= 1; k++) spots.push([x + k * 55, z, 0.3]);
    const n = Math.min(spots.length, 48);
    const im = new THREE.InstancedMesh(planeG, mat, Math.max(1, n));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const LIVERY = [0xffffff, 0xdbe9ff, 0xfff1d6, 0xffe0e0, 0xe6f7ea, 0xffffff, 0xece6ff];
    spots.slice(0, n).forEach(([x, z, h], i) => { q.setFromAxisAngle(up, h); m.compose(new THREE.Vector3(x, 0, z), q, one); im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(LIVERY[i % LIVERY.length])); this.world.addCircle(x, z, 12); });
    im.computeBoundingSphere(); im.castShadow = true; this.scene.add(im);
    // moving aircraft: departures and arrivals on both runways
    const rws = A.runways.slice().sort((a, b) => len(b.p) - len(a.p)).slice(0, 2).map(r => {
      const p = r.p, ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1], L = Math.hypot(bx - ax, bz - az);
      return { ax, az, ux: (bx - ax) / L, uz: (bz - az) / L, L };
    });
    this.flights = [];
    const mk = (rw, kind, rev, off, cyc, tint) => { const f = new THREE.Mesh(planeG, mat.clone()); f.material.color.set(tint); f.castShadow = true; this.scene.add(f); this.flights.push({ f, rw, kind, rev, off, cyc }); };
    rws.forEach((rw, i) => {
      mk(rw, 'dep', i === 1, i * 37, 95, i ? 0xdbe9ff : 0xffffff);
      mk(rw, 'arr', i === 0, 20 + i * 51, 115, i ? 0xfff1d6 : 0xffe0e0);
    });
    const t0 = A.terminals?.[0];
    if (p || t0) this.register('airport', t0 ? t0.cx : p.x, t0 ? t0.cz : p.z, 260);
  }
  updateAirport(time) {
    for (const F of (this.flights || [])) {
      const { rw, f } = F, t = (time + F.off) % F.cyc;
      // runway frame (reverse = take the other end as the threshold)
      const ax = F.rev ? rw.ax + rw.ux * rw.L : rw.ax, az = F.rev ? rw.az + rw.uz * rw.L : rw.az, ux = F.rev ? -rw.ux : rw.ux, uz = F.rev ? -rw.uz : rw.uz;
      let s, y, pitch = 0;
      if (F.kind === 'dep') {
        if (t < 15) { s = 40; y = 0; }                                          // lined up, waiting for clearance
        else {
          const tt = t - 15, t1 = 75 / 2.6;
          s = 40 + (tt < t1 ? 1.3 * tt * tt : 1.3 * t1 * t1 + 75 * (tt - t1));
          y = Math.max(0, s - 1100) * 0.15; pitch = y > 0 ? 0.14 : 0;           // rotate and climb at ~8 degrees
        }
      } else {
        const td = 300, v0 = 72, tTouch = (td + 5000) / v0;
        if (t < tTouch) { s = -5000 + v0 * t; y = Math.max(0, td - s) * 0.0524; pitch = 0.05; }  // 3 degree glide slope
        else { const tt = t - tTouch, tb = (v0 - 14) / 2.2; s = td + (tt < tb ? v0 * tt - 1.1 * tt * tt : v0 * tb - 1.1 * tb * tb + 14 * (tt - tb)); y = 0; }
        if (s > rw.L - 60) s = rw.L - 60;
      }
      f.position.set(ax + ux * s, y + 0.1, az + uz * s);
      f.rotation.set(-pitch, Math.atan2(ux, uz), 0, 'YXZ');
      f.visible = y < 1400;
    }
  }

  // ------------------------------------------------------------ other Hooghly bridges
  riverBridges() {
    const B = this.world.d.bridges || {};
    if (B.vidyasagar) this.cableStayed('vidyasagar', B.vidyasagar, 128, 2, 0xd9d4c7);
    if (B.nivedita) this.cableStayed('nivedita', B.nivedita, 30, 7, 0xe9e5dc);
    if (B.vivekananda) this.archBridge('vivekananda', B.vivekananda);
  }
  /** cable-stayed bridge: `n` H-pylons of height h with fans of stay cables (Vidyasagar Setu: 2 pylons, 128 m) */
  cableStayed(id, b, h, n, colour) {
    const A = V(b.a[0], 0, b.a[1]), Bv = V(b.b[0], 0, b.b[1]);
    const u = Bv.clone().sub(A); const L = u.length(); u.normalize();
    const v = V(-u.z, 0, u.x), half = b.w / 2 + 3;
    const conc = Mc(colour), cable = new Beams(Mc(0xf0f0f0)), heavy = new Beams(conc);
    const towers = n === 2 ? [L * 0.27, L * 0.73] : Array.from({ length: n }, (_, i) => L * (i + 0.5) / n);
    for (const s of towers) {
      const P = (y, side) => A.clone().addScaledVector(u, s).addScaledVector(v, side * half).setY(y);
      for (const sd of [-1, 1]) heavy.add(P(-9, sd), P(h, sd * 0.4), 3.2, 3.2);
      heavy.add(P(h * 0.25, -1), P(h * 0.25, 1), 2.2); heavy.add(P(h * 0.75, -0.75), P(h * 0.75, 0.75), 2);
      const span = n === 2 ? L * 0.27 : L / n / 2;
      for (let k = 1; k <= (n === 2 ? 10 : 4); k++) for (const dir of [-1, 1]) for (const sd of [-1, 1]) {
        const d = span * k / (n === 2 ? 10 : 4) * 0.95;
        cable.add(A.clone().addScaledVector(u, s).addScaledVector(v, sd * half * 0.42).setY(h * (0.62 + 0.035 * k)), A.clone().addScaledVector(u, s + dir * d).addScaledVector(v, sd * half).setY(0.8), 0.18);
      }
    }
    heavy.build(this.scene); cable.build(this.scene);
    const mid = A.clone().addScaledVector(u, L / 2);
    this.register(id, mid.x, mid.z, L / 2 + 30, [A.x - u.x * 60, A.z - u.z * 60]);
    this.list[this.list.length - 1].seg = [A.x, A.z, Bv.x, Bv.z];
  }
  /** steel arch spans (Vivekananda Setu / Bally Bridge) */
  archBridge(id, b) {
    const A = V(b.a[0], 0, b.a[1]), Bv = V(b.b[0], 0, b.b[1]);
    const u = Bv.clone().sub(A); const L = u.length(); u.normalize();
    const v = V(-u.z, 0, u.x), half = b.w / 2 + 2, steel = new Beams(Mc(0x8d8f95));
    const spans = Math.max(3, Math.round(L / 110));
    for (let k = 0; k < spans; k++) {
      const s0 = L * k / spans, s1 = L * (k + 1) / spans, N = 10;
      for (const sd of [-1, 1]) {
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const s = s0 + (s1 - s0) * i / N, y = 1 + 22 * Math.sin(Math.PI * i / N);
          const pt = A.clone().addScaledVector(u, s).addScaledVector(v, sd * half).setY(y);
          if (prev) steel.add(prev, pt, 1.0);
          steel.add(pt, pt.clone().setY(0.6), 0.4);
          prev = pt;
        }
      }
      for (let i = 1; i < N; i += 2) { const s = s0 + (s1 - s0) * i / N, y = 1 + 22 * Math.sin(Math.PI * i / N); steel.add(A.clone().addScaledVector(u, s).addScaledVector(v, -half).setY(y), A.clone().addScaledVector(u, s).addScaledVector(v, half).setY(y), 0.5); }
    }
    steel.build(this.scene);
    const mid = A.clone().addScaledVector(u, L / 2);
    this.register(id, mid.x, mid.z, L / 2 + 30, [A.x - u.x * 60, A.z - u.z * 60]);
    this.list[this.list.length - 1].seg = [A.x, A.z, Bv.x, Bv.z];
  }
  nearestRoadAng(x, z) {
    let ang = 0, bd = 1e9;
    for (const s of this.world.netStreetGrid.query(x, z)) { const d = distToSeg(x, z, s[0], s[1], s[2], s[3]).d; if (d < bd) { bd = d; ang = Math.atan2(s[3] - s[1], s[2] - s[0]); } }
    return ang;
  }

  // ------------------------------------------------------------ per tile: temples / mosques / churches + petrol pumps
  decorateTile(tile, pois) {
    const G = tile.group;
    const white = Mc(0xf2efe8), green = Mc(0x3f8a5a), templeRed = Mc(0xb8442e), gold = Mc(0xd4a017), grey = Mc(0x6b6f73), black = Mc(0x333333);
    for (const b of tile.blds) {
      if (b.rel === undefined || b.s === 'cathedral' || b.n === 'Nakhoda Mosque') continue;
      const r = orientedRect(b.p); const size = Math.min(r.len, r.wid);
      if (size < 5) continue;
      const y = b.ht;
      if (b.rel === 'muslim') {
        dome(Math.min(size * 0.3, 5), white, r.cx, y, r.cz, G, 1.3, 12);
        cone(0.3, 2.5, green, r.cx, y + Math.min(size * 0.3, 5) * 1.3, r.cz, G, 6);
        if (size > 12) {
          const ux = Math.cos(r.ang), uz = Math.sin(r.ang);
          for (const sd of [-1, 1]) { const mx = r.cx + ux * sd * (r.len / 2 - 2), mz = r.cz + uz * sd * (r.len / 2 - 2); cyl(1.1, 1.5, y + 10, white, mx, 0, mz, G, 8); dome(1.3, white, mx, y + 10, mz, G, 1.4, 8); }
        }
      } else if (b.rel === 'hindu') {
        const h = Math.min(18, size * 1.2);
        cone(size * 0.33, h, templeRed, r.cx, y, r.cz, G, 8);
        cone(0.8, 1.2, gold, r.cx, y + h, r.cz, G, 8);
        cyl(0.04, 0.04, 3, white, r.cx, y + h, r.cz, G, 4);
      } else if (b.rel === 'christian') {
        const ux = Math.cos(r.ang), uz = Math.sin(r.ang), x = r.cx + ux * (r.len / 2 - 3), z = r.cz + uz * (r.len / 2 - 3);
        box(5, y + 6, 5, white, x, 0, z, G);
        cone(3.4, 10, grey, x, y + 6, z, G, 4).rotation.y = Math.PI / 4;
        box(0.3, 2.4, 0.3, black, x, y + 16, z, G); box(1.4, 0.3, 0.3, black, x, y + 17.4, z, G);
      }
    }
    if (!tile.lite) for (const p of pois) if (p.k === 'fuel' && p.x >= tile.x0 && p.x < tile.x1 && p.z >= tile.z0 && p.z < tile.z1) this.fuelStation(p, tile);
  }

  fuelStation(p, tile) {
    const W = this.world;
    const nm = (p.n + ' ' + (p.br || '')).toLowerCase();
    let c1 = 0x2e7d32, c2 = 0xffffff;
    if (/indian ?oil|ioc/.test(nm)) { c1 = 0xf26522; c2 = 0x1b2a6b; }
    else if (/\bhp\b|hindustan/.test(nm)) { c1 = 0x004a8f; c2 = 0xe11b22; }
    else if (/bharat|bpcl/.test(nm)) { c1 = 0xffd200; c2 = 0x0055a5; }
    else if (/shell/.test(nm)) { c1 = 0xffd500; c2 = 0xdd1d21; }
    else if (/reliance|jio|nayara|essar/.test(nm)) { c1 = 0x1d4fa0; c2 = 0xf5a623; }
    const ang = this.nearestRoadAng(p.x, p.z);
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = -ang; tile.group.add(g);
    const white = Mc(0xf4f4f4);
    box(15, 0.9, 9, white, 0, 5.2, 0, g); box(15.2, 0.8, 9.2, Mc(c1), 0, 5.9, 0, g); box(15.25, 0.25, 9.25, Mc(c2), 0, 5.75, 0, g);
    for (const [x, z] of [[-5, -2.5], [5, -2.5], [-5, 2.5], [5, 2.5]]) cyl(0.22, 0.22, 5.2, white, x, 0, z, g, 8);
    for (const x of [-3, 3]) { box(3.6, 0.25, 1.4, Mc(0xbbbbbb), x, 0.1, 0, g); box(0.9, 1.8, 0.6, Mc(c1), x, 0.35, 0, g); box(0.7, 0.5, 0.62, Mc(0x111111), x, 1.5, 0, g); }
    cyl(0.15, 0.15, 6, Mc(0x888888), 8.5, 0, 5, g, 6); box(2.2, 2.6, 0.3, Mc(c1), 8.5, 6, 5, g);
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    for (const [x, z] of [[-5, -2.5], [5, -2.5], [-5, 2.5], [5, 2.5], [-3, 0], [3, 0]]) W.tileAddCircle(tile, p.x + x * ca + z * sa, p.z - x * sa + z * ca, 0.5);
  }

  update(t) { if (this.angel) this.angel.rotation.y = t * 0.1; this.updateAirport(t); }
}

// shared materials (so per-tile meshes don't leak materials)
const MAT = new Map();
function Mc(c, o = {}) { const k = c + JSON.stringify(o); if (!MAT.has(k)) MAT.set(k, new THREE.MeshLambertMaterial({ color: c, ...o })); return MAT.get(k); }
function len(p) { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; }

function planeGeometry() {
  const parts = [], col = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; };
  const P = (g, hex, x, y, z) => { g.translate(x, y, z); parts.push(col(g, hex)); };
  const body = new THREE.CylinderGeometry(2, 2, 36, 14); body.rotateX(Math.PI / 2); P(body, 0xf4f6f8, 0, 4.5, 0);
  const nose = new THREE.SphereGeometry(2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); nose.rotateX(Math.PI / 2); nose.scale(1, 1, 1.6); P(nose, 0xf4f6f8, 0, 4.5, 18);
  const tail = new THREE.ConeGeometry(2, 7, 14); tail.rotateX(-Math.PI / 2); P(tail, 0xf4f6f8, 0, 4.5, -21.5);
  P(new THREE.BoxGeometry(34, 0.5, 6), 0xdfe3e8, 0, 3.8, 1);           // wings
  P(new THREE.BoxGeometry(12, 0.4, 3), 0xdfe3e8, 0, 5, -20);            // tail plane
  P(new THREE.BoxGeometry(0.4, 7, 4.5), 0x1d4fa0, 0, 9, -21);           // fin (blue livery)
  P(new THREE.BoxGeometry(4.04, 0.6, 30), 0x1d4fa0, 0, 4.4, 0);         // cheat line
  for (const x of [-7, 7]) { const e = new THREE.CylinderGeometry(1, 1, 3.4, 10); e.rotateX(Math.PI / 2); P(e, 0x9aa0a6, x, 2.8, 3); }
  for (const z of [10, -2]) P(new THREE.BoxGeometry(0.3, 2.4, 0.3), 0x333333, 0, 1.3, z);
  return mergeGeometries(parts);
}
