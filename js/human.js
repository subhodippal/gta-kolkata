// Procedural low-poly humanoid with joint hierarchy + procedural animation.
import * as THREE from 'three';

const geoCache = {};
function cap(r, len) {
  const k = r + ':' + len;
  if (!geoCache[k]) { const g = new THREE.CapsuleGeometry(r, len, 3, 8); g.translate(0, -len / 2 - r * 0.6, 0); geoCache[k] = g; }
  return geoCache[k];
}
const matCache = {};
function mat(hex) { if (!matCache[hex]) matCache[hex] = new THREE.MeshLambertMaterial({ color: hex }); return matCache[hex]; }

/**
 * opts: {skin, shirt, pants, hair, shoes, saree (colour => draped skirt), scale, beard, cap}
 * Model faces +Z. Feet at y=0.
 */
export function makeHuman(o = {}) {
  const skin = o.skin ?? 0x8d5a3b, shirt = o.shirt ?? 0xd33a2c, pants = o.pants ?? 0x26324d, hair = o.hair ?? 0x1a1410, shoes = o.shoes ?? 0x2b2520;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body); // body tilts for lean / knockdown
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  const shadowed = [];
  const mesh = (g, m, parent, x = 0, y = 0, z = 0) => { const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); shadowed.push(me); return me; };

  // torso
  const torso = new THREE.Group(); hips.add(torso);
  const chestG = new THREE.BoxGeometry(0.38, 0.5, 0.22); chestG.translate(0, 0.27, 0);
  mesh(chestG, mat(shirt), torso);
  if (o.collar !== false) { const collar = new THREE.BoxGeometry(0.2, 0.05, 0.05); collar.translate(0, 0.5, 0.1); mesh(collar, mat(0xf2f2f2), torso); }
  const pelvisG = new THREE.BoxGeometry(0.34, 0.14, 0.2); pelvisG.translate(0, -0.02, 0);
  mesh(pelvisG, mat(o.saree ?? pants), hips);
  // head
  const neck = new THREE.Group(); neck.position.y = 0.53; torso.add(neck);
  mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6), mat(skin), neck, 0, 0.03, 0);
  const head = new THREE.Group(); head.position.y = 0.17; neck.add(head);
  mesh(new THREE.SphereGeometry(0.115, 12, 10), mat(skin), head).scale.set(1, 1.12, 1.05);
  const hairM = mesh(new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair), head, 0, 0.02, -0.01);
  hairM.rotation.x = -0.25;
  if (o.longHair) { const lh = new THREE.BoxGeometry(0.22, 0.28, 0.08); lh.translate(0, -0.1, -0.09); mesh(lh, mat(hair), head); }
  if (o.bindi) { mesh(new THREE.SphereGeometry(0.012, 6, 4), mat(0xd01010), head, 0, 0.05, 0.118); }
  if (o.beard) { const bg = new THREE.BoxGeometry(0.16, 0.08, 0.06); mesh(bg, mat(hair), head, 0, -0.08, 0.08); }
  if (o.cap) { mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.06, 12), mat(o.cap), head, 0, 0.1, 0); }
  // eyes
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.016, 6, 4), mat(0x111111), head, 0.042 * s, 0.025, 0.105);

  // arms
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(0.24 * s, 0.47, 0); torso.add(sh);
    mesh(cap(0.055, 0.2), mat(o.sleeves === false ? skin : shirt), sh);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    mesh(cap(0.047, 0.19), mat(skin), el);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mat(skin)); hand.position.y = -0.29; el.add(hand);
    return { sh, el, hand };
  };
  const L = arm(1), R = arm(-1);
  // legs
  const leg = (s) => {
    const hp = new THREE.Group(); hp.position.set(0.1 * s, -0.04, 0); hips.add(hp);
    mesh(cap(0.075, 0.3), mat(pants), hp);
    const kn = new THREE.Group(); kn.position.y = -0.44; hp.add(kn);
    mesh(cap(0.062, 0.3), mat(o.saree ? skin : pants), kn);
    const footG = new THREE.BoxGeometry(0.1, 0.07, 0.24); footG.translate(0, -0.44, 0.05);
    mesh(footG, mat(shoes), kn);
    return { hp, kn };
  };
  const LL = leg(1), RL = leg(-1);
  if (o.saree) {
    // draped saree: flared skirt + pallu over shoulder
    const sk = new THREE.CylinderGeometry(0.2, 0.34, 0.85, 10, 1, true); sk.translate(0, -0.45, 0);
    const skirt = mesh(sk, new THREE.MeshLambertMaterial({ color: o.saree, side: THREE.DoubleSide }), hips);
    const border = new THREE.CylinderGeometry(0.341, 0.345, 0.08, 10, 1, true); border.translate(0, -0.84, 0);
    mesh(border, new THREE.MeshLambertMaterial({ color: o.border ?? 0xd4a017, side: THREE.DoubleSide }), hips);
    const pallu = new THREE.BoxGeometry(0.16, 0.55, 0.24); pallu.translate(0, 0.25, 0); const pm = mesh(pallu, mat(o.saree), torso, 0.12, 0, 0); pm.rotation.z = 0.45;
    void skirt;
  }
  const s = o.scale ?? 1; root.scale.setScalar(s);
  const h = { root, body, hips, torso, neck, head, L, R, LL, RL, phase: Math.random() * 6, saree: !!o.saree, meshes: shadowed };
  return h;
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Pose the humanoid.
 * st: {speed (m/s), air (bool), vy, attack: {type:'punch'|'kick', t:0..1, side}, down: 0..1, dt, wave}
 */
export function animateHuman(h, st) {
  const dt = st.dt;
  const sp = st.speed || 0;
  const k = Math.min(1, dt * 14);
  h.phase += dt * (sp < 0.2 ? 0 : 2.2 + sp * 1.45);
  const run = Math.min(1, Math.max(0, (sp - 3.2) / 3));
  const walkAmt = Math.min(1, sp / 1.6);
  const ph = h.phase;
  const sw = Math.sin(ph), cw = Math.cos(ph);
  let tgt = {
    lh: -sw * (0.55 + run * 0.45) * walkAmt, rh: sw * (0.55 + run * 0.45) * walkAmt,
    lk: Math.max(0, Math.sin(ph + 1.6)) * (0.5 + run * 0.9) * walkAmt + 0.05,
    rk: Math.max(0, Math.sin(ph + 1.6 + Math.PI)) * (0.5 + run * 0.9) * walkAmt + 0.05,
    ls: sw * (0.5 + run * 0.4) * walkAmt, rs: -sw * (0.5 + run * 0.4) * walkAmt,
    le: -0.25 - run * 1.0, re: -0.25 - run * 1.0,
    lsz: 0.08, rsz: -0.08,
    lean: run * 0.28, bob: Math.abs(cw) * 0.05 * walkAmt * (1 + run), twist: sw * 0.12 * walkAmt,
  };
  if (h.saree) { tgt.lh *= 0.6; tgt.rh *= 0.6; }
  if (sp < 0.2) { // idle breathing
    const b = Math.sin(performance.now() / 700 + h.phase) * 0.02;
    tgt.ls = b; tgt.rs = -b; tgt.le = -0.12; tgt.re = -0.12; tgt.bob = b * 0.4;
  }
  if (st.air) {
    tgt.lh = -0.7; tgt.rh = 0.15; tgt.lk = 1.1; tgt.rk = 0.4; tgt.ls = -2.4; tgt.rs = -2.4; tgt.le = -0.3; tgt.re = -0.3; tgt.lsz = 0.3; tgt.rsz = -0.3; tgt.lean = 0.05; tgt.bob = 0;
    if (st.vy < 0) { tgt.ls = -1.2; tgt.rs = -1.2; tgt.lsz = 0.7; tgt.rsz = -0.7; }
  }
  if (st.wave) { tgt.rs = -2.6; tgt.rsz = -0.3; tgt.re = -0.6 + Math.sin(performance.now() / 120) * 0.4; }
  const a = st.attack;
  if (a) {
    const t = a.t; // 0..1
    const ext = t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / 0.65);
    if (a.type === 'punch') {
      // guard + extend one fist
      const right = a.side > 0;
      tgt.ls = right ? -1.1 : lerp(-1.1, -1.55, ext); tgt.le = right ? -1.9 : lerp(-1.9, -0.05, ext);
      tgt.rs = right ? lerp(-1.1, -1.55, ext) : -1.1; tgt.re = right ? lerp(-1.9, -0.05, ext) : -1.9;
      tgt.lsz = right ? 0.25 : 0.05; tgt.rsz = right ? -0.05 : -0.25;
      tgt.twist = (right ? -1 : 1) * 0.45 * ext;
      tgt.lean = 0.12 * ext;
    } else if (a.type === 'kick') {
      tgt.rh = lerp(-0.3, -1.55, ext); tgt.rk = lerp(1.2, 0.05, ext);
      tgt.lh = 0.1; tgt.lk = 0.15;
      tgt.ls = -0.6; tgt.rs = 0.5; tgt.le = -1.4; tgt.re = -0.6; tgt.lsz = 0.4; tgt.rsz = -0.4;
      tgt.lean = -0.25 * ext; tgt.twist = 0;
    }
  }
  // apply with smoothing
  const S = (obj, prop, v, kk = k) => { obj[prop] = lerp(obj[prop], v, kk); };
  const fast = a ? Math.min(1, dt * 30) : k;
  S(h.LL.hp.rotation, 'x', tgt.lh, fast); S(h.RL.hp.rotation, 'x', tgt.rh, fast);
  S(h.LL.kn.rotation, 'x', tgt.lk, fast); S(h.RL.kn.rotation, 'x', tgt.rk, fast);
  S(h.L.sh.rotation, 'x', tgt.ls, fast); S(h.R.sh.rotation, 'x', tgt.rs, fast);
  S(h.L.el.rotation, 'x', tgt.le, fast); S(h.R.el.rotation, 'x', tgt.re, fast);
  S(h.L.sh.rotation, 'z', tgt.lsz, fast); S(h.R.sh.rotation, 'z', tgt.rsz, fast);
  S(h.torso.rotation, 'x', tgt.lean, fast); S(h.torso.rotation, 'y', tgt.twist, fast);
  h.hips.position.y = 0.95 + tgt.bob - (st.air ? 0 : 0);
  // knock-down (fall on back)
  const down = st.down || 0;
  h.body.rotation.x = -down * Math.PI / 2 * 0.98;
  h.body.position.y = down * 0.18;
  h.body.position.z = -down * 0.6;
}
