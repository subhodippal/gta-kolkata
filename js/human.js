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

// ---------------------------------------------------------------- the player: a much more detailed, realistic body
const stdCache = {};
function sm(hex, rough = 0.85) { const k = hex + ':' + rough; if (!stdCache[k]) stdCache[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 }); return stdCache[k]; }

/**
 * Same joint hierarchy as makeHuman (so animateHuman drives it), but with a modelled face (eyes, brows, nose, ears,
 * mouth), neck, jaw, tapered limbs, hands with fingers, shirt with collar and buttons, belt, jeans, sneakers, a wrist
 * watch, a backpack and a fold-out umbrella (shown in the rain).
 */
export function makePlayerHuman(o = {}) {
  const skin = o.skin ?? 0x8a5636, shirt = o.shirt ?? 0xc62828, pants = o.pants ?? 0x1f3550, hair = o.hair ?? 0x120d0a;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  const shadowed = [];
  const mesh = (g, m, parent, x = 0, y = 0, z = 0) => { const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; parent.add(me); shadowed.push(me); return me; };
  const cyl = (r1, r2, h, seg = 14) => new THREE.CylinderGeometry(r1, r2, h, seg);
  const sph = (r, ws = 14, hs = 10, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest);

  // pelvis, belt and the top of the jeans
  mesh(cyl(0.19, 0.175, 0.22, 18), sm(pants), hips, 0, -0.03, 0).scale.z = 0.68;
  mesh(cyl(0.192, 0.192, 0.04, 18), sm(0x2a1a10, 0.5), hips, 0, 0.09, 0).scale.z = 0.7;
  mesh(new THREE.BoxGeometry(0.04, 0.032, 0.012), sm(0xc9b27a, 0.3), hips, 0, 0.09, 0.136);

  // torso: waist + chest + shoulders, shirt with collar, placket and buttons
  const torso = new THREE.Group(); hips.add(torso);
  mesh(cyl(0.19, 0.175, 0.3, 18), sm(shirt), torso, 0, 0.14, 0).scale.z = 0.66;
  mesh(cyl(0.215, 0.19, 0.3, 18), sm(shirt), torso, 0, 0.37, 0).scale.z = 0.7;
  mesh(sph(0.1, 12, 8), sm(shirt), torso, 0.2, 0.5, 0); mesh(sph(0.1, 12, 8), sm(shirt), torso, -0.2, 0.5, 0);
  const collar = mesh(new THREE.TorusGeometry(0.062, 0.02, 6, 14), sm(0xf3f3f3), torso, 0, 0.545, 0.01); collar.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) mesh(sph(0.009, 6, 4), sm(0xf5f5f5, 0.4), torso, 0, 0.47 - i * 0.1, 0.151 - i * 0.004);
  mesh(new THREE.BoxGeometry(0.07, 0.07, 0.012), sm(shirt, 0.9), torso, 0.09, 0.36, 0.152);   // chest pocket
  if (o.backpack !== false) {
    const bp = o.backpack ?? 0x1d6f6b;
    mesh(new THREE.BoxGeometry(0.3, 0.4, 0.13), sm(bp, 0.7), torso, 0, 0.3, -0.19);
    mesh(new THREE.BoxGeometry(0.2, 0.15, 0.04), sm(bp, 0.7), torso, 0, 0.2, -0.275);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.04, 0.4, 0.02), sm(0x111111, 0.6), torso, 0.09 * s, 0.35, 0.115).rotation.x = -0.06;
  }
  // neck + head
  const neck = new THREE.Group(); neck.position.y = 0.53; torso.add(neck);
  mesh(cyl(0.05, 0.057, 0.12, 12), sm(skin, 0.7), neck, 0, 0.04, 0);
  const head = new THREE.Group(); head.position.y = 0.17; neck.add(head);
  mesh(sph(0.113, 20, 16), sm(skin, 0.65), head).scale.set(0.93, 1.1, 1.02);
  mesh(sph(0.08, 14, 10), sm(skin, 0.65), head, 0, -0.065, 0.025).scale.set(1.05, 0.85, 0.95);   // jaw / chin
  for (const s of [-1, 1]) {
    mesh(sph(0.026, 8, 6), sm(skin, 0.65), head, 0.106 * s, -0.005, -0.004).scale.set(0.5, 1.2, 0.8); // ears
    mesh(sph(0.021, 10, 8), sm(0xf7f2ea, 0.3), head, 0.045 * s, 0.025, 0.098).scale.set(1, 0.8, 0.5); // eye whites
    mesh(sph(0.0115, 8, 6), sm(0x2a160c, 0.2), head, 0.045 * s, 0.025, 0.108);                         // irises
    const brow = mesh(new THREE.BoxGeometry(0.056, 0.012, 0.014), sm(hair, 0.8), head, 0.047 * s, 0.062, 0.1); brow.rotation.z = -0.12 * s;
  }
  const nose = mesh(new THREE.ConeGeometry(0.018, 0.05, 8), sm(skin, 0.65), head, 0, -0.012, 0.113); nose.rotation.x = Math.PI / 2 - 0.15;
  mesh(new THREE.BoxGeometry(0.05, 0.009, 0.012), sm(0x6e2f26, 0.5), head, 0, -0.066, 0.1);           // mouth
  mesh(sph(0.124, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), sm(hair, 0.55), head, 0, 0.022, -0.012).rotation.x = -0.3;   // hair
  const fringe = mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), sm(hair, 0.55), head, -0.01, 0.085, 0.085); fringe.rotation.x = 0.3;
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.02, 0.07, 0.06), sm(hair, 0.55), head, 0.105 * s, 0.03, 0.012); // sideburns
  if (o.beard) mesh(new THREE.BoxGeometry(0.15, 0.06, 0.05), sm(hair, 0.9), head, 0, -0.085, 0.075);

  // arms: shoulder -> elbow -> wrist, short sleeves, watch, hand with fingers
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(0.25 * s, 0.47, 0); torso.add(sh);
    mesh(cyl(0.052, 0.047, 0.3, 12), sm(skin, 0.7), sh, 0, -0.15, 0);
    mesh(cyl(0.07, 0.066, 0.18, 12), sm(shirt), sh, 0, -0.08, 0);                       // short sleeve
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    mesh(sph(0.047, 10, 8), sm(skin, 0.7), el);
    mesh(cyl(0.046, 0.034, 0.28, 12), sm(skin, 0.7), el, 0, -0.14, 0);
    if (s === 1) { const w = mesh(new THREE.TorusGeometry(0.037, 0.011, 6, 14), sm(0x141414, 0.3), el, 0, -0.245, 0); w.rotation.x = Math.PI / 2; mesh(new THREE.BoxGeometry(0.04, 0.012, 0.04), sm(0x9fb8c8, 0.1), el, 0, -0.245, 0.04); }
    const hand = new THREE.Group(); hand.position.y = -0.29; el.add(hand);
    mesh(new THREE.BoxGeometry(0.075, 0.085, 0.032), sm(skin, 0.7), hand, 0, -0.035, 0);
    mesh(new THREE.BoxGeometry(0.07, 0.06, 0.026), sm(skin, 0.7), hand, 0, -0.1, 0.002);
    const thumb = mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), sm(skin, 0.7), hand, 0.048 * -s, -0.045, 0.018); thumb.rotation.z = 0.35 * s;
    return { sh, el, hand };
  };
  const L = arm(1), R = arm(-1);

  // legs: tapered jeans, sneakers
  const leg = (s) => {
    const hp = new THREE.Group(); hp.position.set(0.1 * s, -0.04, 0); hips.add(hp);
    mesh(cyl(0.088, 0.062, 0.46, 14), sm(pants), hp, 0, -0.23, 0);
    const kn = new THREE.Group(); kn.position.y = -0.44; hp.add(kn);
    mesh(sph(0.062, 10, 8), sm(pants), kn);
    mesh(cyl(0.062, 0.05, 0.44, 14), sm(pants), kn, 0, -0.22, 0);
    mesh(cyl(0.056, 0.058, 0.03, 14), sm(0x14263d), kn, 0, -0.42, 0);                   // hem
    mesh(new THREE.BoxGeometry(0.1, 0.034, 0.27), sm(0xf2f2f2, 0.6), kn, 0, -0.463, 0.05);   // sole
    mesh(new THREE.BoxGeometry(0.095, 0.05, 0.21), sm(0xe9e9e9, 0.7), kn, 0, -0.425, 0.03);  // upper
    mesh(sph(0.05, 10, 8), sm(0xe9e9e9, 0.7), kn, 0, -0.438, 0.13).scale.set(1, 0.7, 1.1);   // toe cap
    mesh(new THREE.BoxGeometry(0.1, 0.012, 0.05), sm(0xc62828, 0.6), kn, 0, -0.405, 0.04);   // red lace patch
    return { hp, kn };
  };
  const LL = leg(1), RL = leg(-1);

  // umbrella (visible in the rain): canopy over the head, held in the right hand
  const um = new THREE.Group(); um.position.set(-0.14, 0.4, 0.26); um.rotation.x = -0.28; um.visible = false; torso.add(um);
  mesh(cyl(0.012, 0.012, 0.95, 6), sm(0x222222, 0.4), um, 0, 0.47, 0);
  mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 10, Math.PI), sm(0x222222, 0.4), um, 0, 0, 0).rotation.z = Math.PI;
  const canopy = mesh(new THREE.SphereGeometry(0.68, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), new THREE.MeshStandardMaterial({ color: o.umbrella ?? 0x1b2a4a, roughness: 0.6, side: THREE.DoubleSide }), um, 0, 0.86, 0);
  canopy.scale.y = 0.42;

  root.scale.setScalar(o.scale ?? 1);
  return { root, body, hips, torso, neck, head, L, R, LL, RL, umbrella: um, phase: Math.random() * 6, saree: false, meshes: shadowed };
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
  if (st.umbrella && !st.air) { tgt.rs = -1.0; tgt.rsz = -0.04; tgt.re = -1.3; if (sp < 0.2) tgt.le = -0.12; }
  if (h.umbrella) h.umbrella.visible = !!st.umbrella;
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
