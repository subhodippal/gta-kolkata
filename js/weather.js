// Weather: clear / cloudy / rain / thunderstorm. Drives cloud cover and darkness in the sky shader (daynight.js),
// falling rain streaks, lightning + thunder, and daytime birds circling overhead.
// "Live" mode fetches the real current weather and local time for Kolkata from Open-Meteo (free, no key).
import * as THREE from 'three';

export const STATES = ['clear', 'cloudy', 'rain', 'storm'];
const TARGET = {                       // cloud cover, rain, storm (0..1)
  clear: [0.12, 0, 0], cloudy: [0.72, 0, 0], rain: [0.92, 0.75, 0], storm: [1, 1, 1],
};
const KOLKATA = { lat: 22.5726, lon: 88.3639 };
const API = `https://api.open-meteo.com/v1/forecast?latitude=${KOLKATA.lat}&longitude=${KOLKATA.lon}`
  + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m&timezone=Asia%2FKolkata';

/** current clock time in Kolkata (minutes since midnight), from the device clock */
export function realMinutes() {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const h = +p.find(x => x.type === 'hour').value % 24, m = +p.find(x => x.type === 'minute').value;
    return h * 60 + m;
  } catch { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
}

/** Open-Meteo WMO weather code -> our state */
export function stateFromCode(code, cover) {
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code === 85 || code === 86) return 'rain';
  if (code === 45 || code === 48 || code === 3) return 'cloudy';
  if (code === 2 || cover > 60) return 'cloudy';
  return 'clear';
}

export class Weather {
  constructor(scene, { low = false } = {}) {
    this.scene = scene; this.low = low;
    this.state = 'clear'; this.live = false; this.auto = true;
    this.cloud = 0.12; this.rain = 0; this.storm = 0;           // smoothed current values
    this.tgt = TARGET.clear.slice();
    this.autoT = 120 + Math.random() * 120;
    this.flash = 0; this.flashSeq = null; this.nextBolt = 8;
    this.indoors = false;
    this.onChange = null;                                       // (state, prevState) => void
    this.info = null;                                           // last live reading
    this.buildRain(); this.buildBolt(); this.buildBirds();
  }

  /** 0..1: how overcast the sky looks (drives grey sky + dimmer sun) */
  get overcast() { return Math.min(1, this.cloud * 0.5 + this.rain * 0.3 + this.storm * 0.25); }
  /** extra darkness during heavy weather (street lamps come on in the daytime storm) */
  get dark() { return Math.min(1, this.rain * 0.45 + this.storm * 0.55); }

  set(state, cover) {
    if (!STATES.includes(state)) return;
    const prev = this.state; this.state = state;
    this.tgt = TARGET[state].slice();
    if (cover !== undefined && state !== 'rain' && state !== 'storm') this.tgt[0] = state === 'clear' ? Math.min(0.4, Math.max(0.05, cover / 100)) : Math.max(0.55, cover / 100);
    this.nextBolt = 3 + Math.random() * 5;
    if (prev !== state && this.onChange) this.onChange(state, prev);
  }
  cycle() { this.live = false; this.auto = false; this.set(STATES[(STATES.indexOf(this.state) + 1) % STATES.length]); return this.state; }

  /** fetch the real weather in Kolkata; returns { state, temp, feels, humidity, wind, minutes, code, cover } */
  async fetchLive() {
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const c = (await res.json()).current;
    const [hh, mm] = (c.time.split('T')[1] || '12:00').split(':').map(Number);
    const info = {
      state: stateFromCode(c.weather_code, c.cloud_cover), code: c.weather_code, cover: c.cloud_cover,
      temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m), minutes: hh * 60 + mm, isDay: !!c.is_day,
    };
    this.info = info; return info;
  }
  applyLive(info) { this.live = true; this.auto = false; this.set(info.state, info.cover); }

  // ------------------------------------------------------------ audio
  unlock() {
    try {
      this.actx = this.actx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.actx.state === 'suspended') this.actx.resume();
      if (!this.rainGain) {
        const ac = this.actx, len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
        const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
        this.rainGain = ac.createGain(); this.rainGain.gain.value = 0;
        src.connect(hp); hp.connect(lp); lp.connect(this.rainGain); this.rainGain.connect(ac.destination); src.start();
      }
    } catch { /* no audio */ }
  }
  thunder(delay) {
    if (!this.actx || !this.noiseBuf) return;
    const ac = this.actx, t0 = ac.currentTime + delay;
    const src = ac.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t0); lp.frequency.exponentialRampToValueAtTime(70, t0 + 2.6);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(this.indoors ? 0.35 : 0.9, t0 + 0.12);
    g.gain.setTargetAtTime(0.0001, t0 + 0.4, 0.8);
    src.connect(lp); lp.connect(g); g.connect(ac.destination); src.start(t0, Math.random()); src.stop(t0 + 3.5);
  }

  // ------------------------------------------------------------ rain streaks (GPU-animated, wrapped around the camera)
  buildRain() {
    const N = this.low ? 900 : 2600, pos = new Float32Array(N * 6), rnd = new Float32Array(N * 2), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random(), r = Math.random();
      for (let k = 0; k < 2; k++) { pos.set([x, y, z], i * 6 + k * 3); rnd[i * 2 + k] = r; end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 1));
    g.setAttribute('endp', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { cam: { value: new THREE.Vector3() }, time: { value: 0 }, inten: { value: 0 }, light: { value: 1 } },
      vertexShader: `attribute float rnd; attribute float endp; uniform vec3 cam; uniform float time, inten; varying float vA;
        void main(){
          vec3 box = vec3(70.0, 45.0, 70.0);
          vec3 p = position * box;
          float sp = 22.0 + rnd * 8.0;
          float x = cam.x + mod(p.x - cam.x + box.x * 0.5, box.x) - box.x * 0.5;
          float z = cam.z + mod(p.z - cam.z + box.z * 0.5, box.z) - box.z * 0.5;
          float y = cam.y - 12.0 + mod(p.y - time * sp, box.y);
          y += endp * 1.1; x += endp * 0.18; z += endp * 0.1;
          float d = length(vec2(x - cam.x, z - cam.z));
          vA = (rnd < inten ? 1.0 : 0.0) * (1.0 - smoothstep(22.0, 34.0, d)) * 0.5;
          gl_Position = projectionMatrix * viewMatrix * vec4(x, y, z, 1.0);
        }`,
      fragmentShader: 'uniform float light; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(vec3(0.72, 0.8, 0.9) * light, vA); }',
    });
    this.rainMesh = new THREE.LineSegments(g, this.rainMat);
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false; this.rainMesh.renderOrder = 5;
    this.scene.add(this.rainMesh);
  }

  // ------------------------------------------------------------ lightning bolt in the distant sky
  buildBolt() {
    this.boltMat = new THREE.LineBasicMaterial({ color: 0xe8f0ff, fog: false, transparent: true, depthTest: false });
    this.bolt = new THREE.LineSegments(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.frustumCulled = false; this.bolt.visible = false; this.bolt.renderOrder = 6; this.scene.add(this.bolt);
  }
  strike(cam) {
    const ang = Math.random() * Math.PI * 2, dist = 500 + Math.random() * 900, cx = cam.x + Math.cos(ang) * dist, cz = cam.z + Math.sin(ang) * dist;
    const pts = []; let x = cx, y = 520 + Math.random() * 120, z = cz;
    while (y > 0) {
      const ny = y - (28 + Math.random() * 36), nx = x + (Math.random() - 0.5) * 60, nz = z + (Math.random() - 0.5) * 60;
      pts.push(x, y, z, nx, Math.max(0, ny), nz);
      if (Math.random() < 0.18) pts.push(nx, Math.max(0, ny), nz, nx + (Math.random() - 0.5) * 140, Math.max(0, ny - 90), nz + (Math.random() - 0.5) * 140);
      x = nx; y = ny; z = nz;
    }
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry(); this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.flashSeq = [[0.0, 1], [0.07, 0.15], [0.12, 0.85], [0.2, 0.3], [0.32, 0]]; this.flashT = 0;
    this.thunder(dist / 343 * 0.6 + Math.random() * 0.8);
  }

  // ------------------------------------------------------------ birds (kites & crows circling by day)
  buildBirds() {
    const g = new THREE.BufferGeometry();
    // wings (x = distance from the body, used to flap), body and tail; faces +z
    const v = [
      0, 0, 0.30, 0, 0, -0.22, -1.0, 0, -0.05,   0, 0, 0.30, 1.0, 0, -0.05, 0, 0, -0.22,
      -0.07, 0, 0.18, 0.07, 0, 0.18, 0, 0, 0.55,
      -0.1, 0, -0.2, 0.1, 0, -0.2, 0, 0, -0.55,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    this.birdMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, tone: { value: 1 }, ...THREE.UniformsLib.fog },
      vertexShader: `uniform float time;
        #include <fog_pars_vertex>
        void main(){
          vec4 ip = instanceMatrix[3];
          float ph = ip.x * 0.13 + ip.z * 0.07;
          vec3 p = position;
          p.y += sin(time * 7.0 + ph) * 0.45 * abs(p.x) + abs(p.x) * 0.12;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float tone;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(vec3(0.09, 0.075, 0.065) * tone, 1.0);
          #include <fog_fragment>
        }`,
      fog: true,
    });
    const N = this.low ? 10 : 26;
    this.birds = [];
    this.birdMesh = new THREE.InstancedMesh(g, this.birdMat, N);
    this.birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.birdMesh.frustumCulled = false;
    for (let i = 0; i < N; i++) this.birds.push({ cx: 0, cz: 0, r: 0, w: 0, a: Math.random() * 6.28, h: 0, bob: Math.random() * 6, set: false, k: 1 + Math.random() * 0.6 });
    this.scene.add(this.birdMesh);
  }
  updateBirds(dt, focus, elapsed, day, hideAmt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qr = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fw = new THREE.Vector3(0, 0, 1);
    const N = this.birds.length, shown = day > 0.2 ? Math.round(N * (1 - hideAmt)) : 0;
    this.birdMat.uniforms.time.value = elapsed; this.birdMat.uniforms.tone.value = 0.4 + 0.6 * day;
    this.birds.forEach((b, i) => {
      if (i >= shown) { m.makeScale(0, 0, 0); this.birdMesh.setMatrixAt(i, m); return; }
      if (!b.set || Math.hypot(b.cx - focus.x, b.cz - focus.z) > 320) {
        const a = Math.random() * 6.28, d = 20 + Math.random() * 200;
        b.cx = focus.x + Math.cos(a) * d; b.cz = focus.z + Math.sin(a) * d;
        b.r = 18 + Math.random() * 55; b.w = (0.12 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1); b.h = 38 + Math.random() * 80; b.set = true;
      }
      b.a += b.w * dt;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r, y = b.h + Math.sin(elapsed * 0.4 + b.bob) * 5;
      const hx = -Math.sin(b.a) * Math.sign(b.w), hz = Math.cos(b.a) * Math.sign(b.w);
      q.setFromAxisAngle(up, Math.atan2(hx, hz));
      qr.setFromAxisAngle(fw, -0.4 * Math.sign(b.w));                 // bank into the turn
      q.multiply(qr);
      m.compose(p.set(x, y, z), q, s.setScalar(1.7 * b.k)); this.birdMesh.setMatrixAt(i, m);
    });
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ per frame
  update(dt, camera, focus, elapsed, daylight) {
    // random weather changes unless following the live feed or set by hand
    if (this.auto) {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = 150 + Math.random() * 200;
        const r = Math.random(), next = r < 0.45 ? 'clear' : r < 0.75 ? 'cloudy' : r < 0.92 ? 'rain' : 'storm';
        if (next !== this.state) this.set(next);
      }
    }
    const k = Math.min(1, dt * 0.35), T = this.tgt;
    this.cloud += (T[0] - this.cloud) * k; this.rain += (T[1] - this.rain) * k; this.storm += (T[2] - this.storm) * k;

    // rain
    const U = this.rainMat.uniforms;
    this.rainMesh.visible = this.rain > 0.03;
    U.cam.value.copy(camera.position); U.time.value = elapsed; U.inten.value = this.rain; U.light.value = 0.35 + 0.65 * daylight;
    if (this.rainGain) this.rainGain.gain.value += ((this.rain * (this.indoors ? 0.03 : 0.11)) - this.rainGain.gain.value) * Math.min(1, dt * 2);

    // lightning
    if (this.storm > 0.6) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.nextBolt = 6 + Math.random() * 12; this.strike(camera.position); }
    }
    if (this.flashSeq) {
      this.flashT += dt;
      const sq = this.flashSeq; let f = 0;
      if (this.flashT >= sq[sq.length - 1][0]) { this.flashSeq = null; this.bolt.visible = false; }
      else { for (let i = 0; i < sq.length - 1; i++) if (this.flashT >= sq[i][0] && this.flashT < sq[i + 1][0]) { const u = (this.flashT - sq[i][0]) / (sq[i + 1][0] - sq[i][0]); f = sq[i][1] + (sq[i + 1][1] - sq[i][1]) * u; } this.bolt.visible = f > 0.1; this.boltMat.opacity = Math.min(1, f); }
      this.flash = f;
    } else this.flash = 0;

    // birds stay away in heavy weather
    this.updateBirds(dt, focus, elapsed, daylight, Math.min(1, this.rain * 1.4 + (this.cloud > 0.9 ? 0.2 : 0)));
  }
}
