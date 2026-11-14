// Day / night cycle driven by the game clock (1 real second = 1 game minute, a full day = 24 minutes).
// The scene changes every two game hours: night → dawn → sunrise → morning → noon → afternoon → evening/sunset →
// dusk → night. Sun follows Kolkata's path (rises east, passes to the south at 22.5° N, sets west); the moon rises
// opposite; stars fade in at dusk. At night windows, shopfronts and street lamps light up.
import * as THREE from 'three';

// keyframes by hour: zenith, horizon, fog, sun colour, sun intensity, hemi sky, hemi ground, hemi intensity, exposure, night(0..1)
const K = [
  [0, '#060a18', '#141b30', '#10162a', '#9fb4ff', 0.30, '#3a4a78', '#141820', 0.35, 1.25, 1],
  [2, '#060a18', '#131a2e', '#0f1528', '#9fb4ff', 0.30, '#3a4a78', '#141820', 0.35, 1.25, 1],
  [4, '#0b1430', '#28304e', '#1e2540', '#a9b8ff', 0.25, '#44507a', '#1a1c22', 0.40, 1.2, 1],
  [5, '#2a3a6a', '#d88a64', '#8a7480', '#ff9a60', 0.6, '#7a7aa0', '#3a3028', 0.6, 1.1, 0.6],
  [6, '#4a78b8', '#ffb070', '#e0a888', '#ffb27a', 1.4, '#a8b4cc', '#5a4a38', 0.9, 1.05, 0.15],
  [8, '#4f86c8', '#e8d8bc', '#dccdb0', '#ffe2b8', 2.1, '#cfdcec', '#7a6a50', 1.15, 1.05, 0],
  [10, '#4a84cc', '#e6dcc4', '#d8ccb2', '#ffeccc', 2.4, '#dde8f0', '#8a7a5a', 1.25, 1.05, 0],
  [12, '#4682cc', '#e8e0cc', '#dad0b8', '#fff4dc', 2.6, '#e4ecf4', '#8e805e', 1.3, 1.0, 0],
  [14, '#4a84ca', '#e6dcc4', '#d8ccb2', '#ffeccc', 2.4, '#dde8f0', '#8a7a5a', 1.25, 1.05, 0],
  [16, '#5583bf', '#ecc898', '#dcc2a0', '#ffd49a', 2.0, '#d4d8e0', '#7e6a4e', 1.1, 1.05, 0],
  [17.5, '#46639c', '#f2a070', '#d89c7c', '#ff8040', 1.3, '#b09aa8', '#5a4030', 0.85, 1.1, 0.2],
  [18.5, '#1e2a58', '#a8506a', '#5a4058', '#ff6a50', 0.45, '#6a6090', '#2a2026', 0.55, 1.15, 0.75],
  [20, '#0a1024', '#1e2440', '#161c32', '#9fb4ff', 0.30, '#3e4c7a', '#161820', 0.4, 1.2, 1],
  [22, '#070b1a', '#161c32', '#11172b', '#9fb4ff', 0.30, '#3a4a78', '#141820', 0.35, 1.25, 1],
  [24, '#060a18', '#141b30', '#10162a', '#9fb4ff', 0.30, '#3a4a78', '#141820', 0.35, 1.25, 1],
];
const PHASES = [[4, 'ph_night'], [5.5, 'ph_dawn'], [7, 'ph_sunrise'], [10, 'ph_morning'], [14, 'ph_noon'], [16, 'ph_afternoon'],
  [17.4, 'ph_evening'], [18.6, 'ph_sunset'], [20, 'ph_dusk'], [24, 'ph_night']];
const C = (h) => new THREE.Color(h);
const KC = K.map(k => ({ h: k[0], zen: C(k[1]), hor: C(k[2]), fog: C(k[3]), sun: C(k[4]), si: k[5], hs: C(k[6]), hg: C(k[7]), hi: k[8], ex: k[9], night: k[10] }));

export function phaseOf(hour) { for (const [h, id] of PHASES) if (hour < h) return id; return 'ph_night'; }

export class DayNight {
  constructor({ scene, renderer, hemi, sun, world, low }) {
    Object.assign(this, { scene, renderer, hemi, sun, world, low });
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3(); this.lightDir = new THREE.Vector3();
    this.cur = { zen: C('#000'), hor: C('#000'), fog: C('#000'), sun: C('#000'), hs: C('#000'), hg: C('#000') };
    this.buildSky();
    this.buildNightTextures();
    this.hour = 10;
  }

  buildSky() {
    const g = new THREE.SphereGeometry(3000, 48, 24);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        sunDir: { value: this.sunDir }, moonDir: { value: this.moonDir }, zen: { value: this.cur.zen }, hor: { value: this.cur.hor },
        sunCol: { value: new THREE.Color() }, stars: { value: 0 }, sunVis: { value: 1 }, time: { value: 0 },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `varying vec3 vP; uniform vec3 sunDir, moonDir, zen, hor, sunCol; uniform float stars, sunVis, time;
        float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vP); float h = max(d.y, 0.0);
          vec3 c = mix(hor, zen, pow(h, 0.5));
          // warm band around the sun near the horizon at sunrise / sunset
          float s = max(dot(d, sunDir), 0.0);
          float low = 1.0 - smoothstep(0.0, 0.35, sunDir.y + 0.05);
          c += sunCol * pow(s, 6.0) * 0.3 * low * (1.0 - h);
          // sun disc + halo
          c += sunCol * (smoothstep(0.9993, 0.9997, s) * 3.0 + pow(s, 600.0) * 1.5 + pow(s, 24.0) * 0.12) * sunVis;
          // moon disc with a soft glow and a few maria
          float m = max(dot(d, moonDir), 0.0);
          float disc = smoothstep(0.99955, 0.9998, m);
          float maria = 0.85 + 0.15 * hash(floor(d * 900.0));
          c += vec3(0.95, 0.95, 0.88) * disc * maria * (0.4 + stars) + vec3(0.5, 0.55, 0.7) * pow(m, 200.0) * 0.35 * stars;
          // stars: hashed cells on the dome, twinkling
          if (stars > 0.01 && d.y > 0.0) {
            vec3 q = d * 260.0; vec3 cell = floor(q); float r = hash(cell);
            if (r > 0.985) { vec3 f = fract(q) - 0.5; float st = smoothstep(0.12, 0.0, length(f));
              float tw = 0.7 + 0.3 * sin(time * (2.0 + r * 5.0) + r * 40.0);
              c += vec3(0.9, 0.93, 1.0) * st * tw * stars * smoothstep(0.0, 0.15, d.y) * (1.0 - disc); }
          }
          if (d.y < 0.0) c = hor;
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(g, this.skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  // emissive maps matching the window / shopfront textures (lit window panes)
  buildNightTextures() {
    const W = this.world, cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, 256, 256);
    const lit = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    lit(34, 22, 60, 82, '#ffcf7a');                // bay 0: lit shutters
    lit(158, 28, 68, 66, '#fff0c0');               // bay 1: tube-light white
    lit(38, 144, 52, 60, '#3a2a10');               // bay 2: mostly dark
    c.fillStyle = '#ffd890'; c.beginPath(); c.moveTo(164, 234); c.lineTo(164, 178); c.arc(192, 178, 28, Math.PI, 0); c.lineTo(220, 234); c.closePath(); c.fill(); // bay 3 arched
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    const M = W.mat;
    M.walls.emissiveMap = t; M.walls.emissive = new THREE.Color(0x000000); M.walls.needsUpdate = true;
    M.shops.emissiveMap = M.shops.map; M.shops.emissive = new THREE.Color(0x000000); M.shops.needsUpdate = true;
    this.lampBase = M.lampHead.emissive.clone();
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; }

  update(gameMinutes, focus, camera, elapsed) {
    const hour = (gameMinutes / 60) % 24; this.hour = hour;
    // keyframe blend
    let i = 0; while (i < KC.length - 2 && KC[i + 1].h <= hour) i++;
    const a = KC[i], b = KC[i + 1], f = (hour - a.h) / (b.h - a.h || 1);
    const L = (k) => this.cur[k].copy(a[k]).lerp(b[k], f), n = (k) => a[k] + (b[k] - a[k]) * f;
    L('zen'); L('hor'); L('fog'); L('sun'); L('hs'); L('hg');
    const night = n('night');
    // sun path: east (+x) at 06:00, high in the south (+z) at noon, west at 18:00
    const ang = (hour - 6) / 12 * Math.PI;
    this.sunDir.set(Math.cos(ang), Math.sin(ang) * 0.92, Math.sin(ang) * 0.39).normalize();
    // moon roughly opposite, a little offset so it is not a mirror image
    const ma = ang + Math.PI + 0.25;
    this.moonDir.set(Math.cos(ma), Math.sin(ma) * 0.9, Math.sin(ma) * 0.43 + 0.1).normalize();
    // the directional light comes from the sun by day, from the moon by night
    const useMoon = this.sunDir.y < 0.02;
    this.lightDir.copy(useMoon ? this.moonDir : this.sunDir);
    if (this.lightDir.y < 0.12) this.lightDir.y = 0.12; this.lightDir.normalize();
    this.sun.color.copy(this.cur.sun); this.sun.intensity = n('si');
    this.hemi.color.copy(this.cur.hs); this.hemi.groundColor.copy(this.cur.hg); this.hemi.intensity = n('hi');
    this.renderer.toneMappingExposure = n('ex');
    this.scene.fog.color.copy(this.cur.fog); this.scene.background.copy(this.cur.fog);
    // sky uniforms
    const U = this.skyMat.uniforms;
    U.sunCol.value.copy(this.cur.sun); U.stars.value = night; U.sunVis.value = THREE.MathUtils.clamp((this.sunDir.y + 0.04) * 12, 0, 1); U.time.value = elapsed;
    this.sky.position.copy(camera.position);
    // night lights
    const M = this.world.mat, lights = THREE.MathUtils.smoothstep(night, 0.1, 0.7);
    M.walls.emissive.setScalar(0.85 * lights);
    M.shops.emissive.setScalar(0.55 * lights);
    M.lampHead.emissive.copy(this.lampBase).lerp(new THREE.Color(0xffd27a), lights).multiplyScalar(1 + lights * 1.5);
    if (this.world.waterMat) this.world.waterMat.color.setRGB(0.37, 0.46, 0.39).multiplyScalar(1 - night * 0.6);
    this.night = night;
    return this.lightDir;
  }
}
