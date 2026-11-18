// Kolkata City 3D — entry point
import * as THREE from 'three';
import { World } from './world.js';
import { Landmarks } from './landmarks.js';
import { POIs } from './pois.js';
import { People, parkedCarsTile } from './npc.js';
import { Boats } from './boats.js';
import { DayNight, phaseOf } from './daynight.js';
import { Trains } from './trains.js';
import { SatelliteGround, satEnabled } from './satellite.js';
import { StreetDetails } from './details.js';
import { Traffic } from './traffic.js';
import { Metro } from './metro.js';
import { Search } from './search.js';
import { Nav } from './nav.js';
import { MapUI } from './mapui.js';
import { Player } from './player.js';
import { Weather, realMinutes } from './weather.js';
import { Home } from './home.js';
import { NightLights } from './nightlights.js';
import { Controls } from './controls.js';
import { HUD } from './hud.js';
import { ViewMode } from './viewmode.js';
import { tn, loadI18n, t, num, line, landmarkLine, setLang, getLang, onLang, speak, setVoice, voiceEnabled, hasVoice } from './i18n.js';

const $ = (id) => document.getElementById(id);
const progress = (f, msg) => { $('loadbar').style.width = Math.round(f * 100) + '%'; if (msg) $('loadmsg').textContent = msg; };

const canvas = $('game');
const controls = new Controls(canvas);
const mobile = controls.touch;
const params = new URLSearchParams(location.search);
const low = mobile || params.get('q') === 'low';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1.25 : 1.75) * (+params.get('scale') || 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !low; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG = 0xd8ccb2;
scene.fog = new THREE.Fog(FOG, low ? 90 : 160, low ? 700 : 1300);
scene.background = new THREE.Color(FOG);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, low ? 900 : 3500);

// lights: warm hazy Kolkata afternoon
const hemi = new THREE.HemisphereLight(0xdde8f0, 0x8a7a5a, 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffeccc, 2.4);
const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 500 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

let daynight, trains, world, landmarks, pois, people, player, hud, view, details, traffic, metro, nav, mapui, boats, weather, home, nightLights;
let liveTime = true, spawnNote = null, homeArmed = false, stormNag = 0;
let maxDist = 22, camYaw = Math.PI, camPitch = 0.28, camDist = 7.5, camDistCur = 7.5;
const camTarget = new THREE.Vector3();
let started = false;

async function loadJSON(url) {
  const res = await fetch(url);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return res.json();
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (; ;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length; progress(Math.min(0.05, 0.05 * got / total), t('load_download', { mb: (got / 1e6).toFixed(1) }));
  }
  const all = new Uint8Array(got); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

// names in kolkata.json are indices into strings.json "names": keep the index (ni / sti) for display
// and the English name (n / st) for internal matching
function resolveNames(data) {
  const names = window.__strings.names;
  const tr = data.transit || {};
  const colls = [data.roads, data.pois, data.places || [], data.bus || [], tr.metro || [], tr.stations || [], tr.rail || []];
  for (const coll of colls) for (const o of coll) {
    if (typeof o.n === 'number') { o.ni = o.n; o.n = names[o.n]?.en || ''; }
    if (typeof o.st === 'number') { o.sti = o.st; o.st = names[o.st]?.en || ''; }
  }
}

// the player's real GPS position (asks the browser; null if refused, unavailable or slow)
function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 7000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout: 6500, maximumAge: 60000 });
  });
}

async function init() {
  const geoP = locate();
  await loadI18n();
  window.__strings = (await import('./i18n.js')).strings();
  setupLangButtons();
  progress(0, t('load_map'));
  if (mobile) checkOrientation();
  const data = await loadJSON('data/region.json');
  resolveNames(data);
  world = new World(scene, data, { mobile: low });
  world.names = window.__strings.names;
  await world.build(progress);
  progress(0.3, t('load_buildings', { i: 0, n: 9 }));
  // detail tiles around Esplanade (spawn)
  await world.ensureAround(40, 214, 900);
  progress(0.6, t('load_landmarks'));
  await new Promise(r => setTimeout(r));
  landmarks = new Landmarks(scene, world);
  const lms = landmarks.build();
  pois = new POIs(scene, world, data.pois);
  world.hooks.push((tile) => landmarks.decorateTile(tile, pois.list));
  world.hooks.push((tile) => parkedCarsTile(world, tile));
  for (const tile of world.tiles.values()) { landmarks.decorateTile(tile, pois.list); parkedCarsTile(world, tile); }
  progress(0.8, t('load_traffic'));
  await new Promise(r => setTimeout(r));
  details = new StreetDetails(scene, world, data);
  traffic = new Traffic(scene, world, details, { cars: mobile ? 30 : 80, buses: mobile ? 6 : 16 });
  for (const tile of world.tiles.values()) traffic.addTileTrams(tile);
  traffic.hornCb = (v) => { horn(v.type === 'bus'); if (!hud.toastT) hud.toast((v.type === 'bus' ? '🚌 ' : '🚕 ') + '“' + line('horn') + '”', 1.6); };
  trains = new Trains(scene, world, data, { max: mobile ? 12 : 26 });
  boats = new Boats(scene, world, mobile ? { big: 4, small: 12, ferries: 6 } : {});
  people = new People(scene, world, mobile ? 18 : 42);
  player = new Player(scene, world);
  // spawn at the player's real location when it is inside the map, otherwise at Esplanade next to Shaheed Minar
  let [sx, sz] = world.findSafeSpot(40, 214, false), real = false;
  const loc = await geoP;
  if (loc) {
    const m = world.d.meta, b = world.bounds, gx = (loc.lon - m.lon0) * m.kx, gz = -(loc.lat - m.lat0) * m.kz;
    if (gx > b.x0 + 30 && gx < b.x1 - 30 && gz > b.z0 + 30 && gz < b.z1 - 30) {
      progress(0.85, t('load_map'));
      await world.ensureAround(gx, gz, 700);
      [sx, sz] = world.findSafeSpot(gx, gz, false); real = true; spawnNote = 'spawn_real';
    } else spawnNote = 'spawn_outside';
  }
  player.place(sx, sz);
  camYaw = real ? Math.PI : Math.atan2(sx - 26.9, sz - 234.7); // look towards the Minar
  home = new Home(scene, world);
  homeArmed = !(home.isSet && home.dist(sx, sz) < 40);
  hud = new HUD(world, pois, lms);
  hud.home = home;
  hud.gameMinutes = realMinutes(); hud.timeScale = 1 / 60;       // real Kolkata time, running at real speed
  metro = new Metro(scene, world, data, hud);
  hud.metro = metro;
  nav = new Nav(scene, world, hud);
  const search = new Search({ world, pois, landmarks: lms, metro, busStops: details.busStops });
  hud.onTravel = async (x, z, name, exact) => {
    if (view.active) toggleView(false);
    hud.toast('⏳ ' + t('load_map'), 2);
    await world.ensureAround(x, z, 400);
    const [tx, tz] = exact ? [x, z] : world.findSafeSpot(x, z); player.place(tx, tz);
    updateCamera(0.016, true);
    hud.say(line('travel', { place: name || world.streetAt(tx, tz) || world.districtAt(tx, tz) }), 3, '📍 ');
  };
  hud.onGo = ([x, z]) => hud.onTravel(x, z, null); // "Go here" from an info card in view mode
  mapui = new MapUI({
    world, pois, landmarks: lms, metro, details, search, nav, hud,
    getPlayer: () => ({ pos: player.pos, yaw: player.yaw }),
    onTravel: (x, z, label) => hud.onTravel(x, z, label),
    onDirections: (x, z, label) => { if (view.active) toggleView(false); nav.set(x, z, label, player.pos); },
  });
  hud.mapui = mapui;
  view = new ViewMode({ camera, canvas, scene, world, pois, landmarks: lms, hud, sun, controls, low });
  view.onExit = () => toggleView(false);
  weather = new Weather(scene, { low });
  weather.onChange = onWeatherChange;
  nightLights = new NightLights(scene, world, { low });
  daynight = new DayNight({ scene, renderer, hemi, sun, world, low, weather });
  setupHomeWeatherButtons();
  const sat = new SatelliteGround(world);
  const satChk = document.getElementById('satChk'); satChk.checked = satEnabled();
  satChk.onchange = (e) => sat.setEnabled(e.target.checked);
  document.getElementById('metroChk').onchange = (e) => { metro.overlay.visible = view.active && e.target.checked; };
  progress(1, t('load_ready'));
  updateCamera(0.016, true);
  renderer.compile(scene, camera);
  updateWxText();
  $('startBtn').classList.remove('hidden'); $('exploreBtn').classList.remove('hidden');
  $('startBtn').onclick = () => start(false);
  $('exploreBtn').onclick = () => start(true);
}

// ---------------------------------------------------------------- home & live weather
const wxLabel = () => t(weather.state === 'clear' && daynight && daynight.night > 0.5 ? 'wx_clear_night' : 'wx_' + weather.state);
const atHome = () => home.isSet && home.dist(player.pos.x, player.pos.z) < 12;
const nearestNote = () => (home.isSet ? t('storm_still', { d: num(Math.round(home.dist(player.pos.x, player.pos.z))) }) : t('storm_set_home'));
function updateWxText() { hud.wxText = wxLabel() + (weather.live && weather.info ? ' · ' + num(weather.info.temp) + '°C' : ''); }

function onWeatherChange(state, prev) {
  if (!started) return;
  if (state === 'storm') {
    if (atHome()) hud.notify('⛈', t('storm_title'), t('storm_home_body'), { voice: line('storm_home') });
    else hud.notify('⛈', t('storm_title'), t('storm_out_body') + '<br>' + nearestNote(), { time: 10, voice: line('storm_start') });
    stormNag = 60;
  } else if (state === 'rain' && prev !== 'storm') hud.notify('🌧', t('rain_title'), t('rain_body'), { voice: line('rain_start') });
  updateWxText();
}

function setHome() {
  if (view.active || hud.open) return;
  home.set(player.pos.x, player.pos.z, player.yaw); homeArmed = false;
  hud.askNotifyPermission();
  hud.notify('🏠', t('home_set_title'), t('home_set_body'), { voice: line('home_set') });
}
function goHome() {
  if (!home.isSet) { hud.notify('🏠', t('home'), t('home_none')); return; }
  const d = home.pos; hud.onTravel(d.x, d.z, t('home'), true).then(() => { player.yaw = home.yaw; camYaw = home.yaw + Math.PI; updateCamera(0.016, true); });
}
function homeRoute() {
  if (!home.isSet) { hud.notify('🏠', t('home'), t('home_none')); return; }
  if (view.active) toggleView(false);
  nav.set(home.pos.x, home.pos.z, t('home'), player.pos);
}
function enterHome() {
  const h = Math.floor(hud.gameMinutes / 60) % 24, m = Math.floor(hud.gameMinutes) % 60;
  const sleep = () => { const cur = hud.gameMinutes % 1440; hud.gameMinutes += cur < 360 ? 360 - cur : 1440 - cur + 360; hud.say(t(phaseOf((hud.gameMinutes / 60) % 24)), 2.5, '🌅 '); };
  hud.panel({
    kind: t('home_panel_kind'), name: t('home_panel_name'), street: world.streetAt(player.pos.x, player.pos.z) || world.districtAt(player.pos.x, player.pos.z),
    body: t('home_panel_body', { time: num(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')), phase: t(phaseOf(h + m / 60)), wx: wxLabel() }),
    actions: [
      { label: t('home_sleep'), fn: sleep },
      { label: t('home_wait'), fn: () => { hud.gameMinutes += 120; hud.say(t(phaseOf((hud.gameMinutes / 60) % 24)), 2, '🕑 '); } },
      { label: t('home_weather'), fn: () => syncLive(true) },
    ],
  });
}

/** fetch the real weather + clock of Kolkata and make the game match it */
async function syncLive(user) {
  if (user) { hud.askNotifyPermission(); hud.toast('⏳ ' + t('btn_live'), 2); }
  try {
    const info = await weather.fetchLive();
    hud.gameMinutes = info.minutes; hud.timeScale = 1 / 60; liveTime = true;
    weather.applyLive(info); updateWxText();
    const ph = phaseOf(info.minutes / 60), clock = num(String(Math.floor(info.minutes / 60)).padStart(2, '0') + ':' + String(info.minutes % 60).padStart(2, '0'));
    hud.notify(info.isDay ? '☀️' : '🌙', t('wx_live_title') + ' · ' + clock, t('wx_live_body', { temp: num(info.temp), feels: num(info.feels), wx: wxLabel(), phase: t(ph), hum: num(info.humidity), wind: num(info.wind) }), { time: 10 });
  } catch (e) {
    console.warn('live weather', e);
    hud.gameMinutes = realMinutes(); hud.timeScale = 1 / 60; liveTime = true; weather.live = false; weather.auto = true;
    if (user) hud.notify('⚠️', t('wx_live_title'), t('wx_live_fail'));
  }
}

function setupHomeWeatherButtons() {
  $('homeBtn').onclick = setHome; $('goHomeBtn').onclick = goHome; $('routeBtn').onclick = homeRoute;
  $('liveBtn').onclick = () => { weather.unlock(); syncLive(true); };
}

// storm / arrival alerts, umbrella
function alerts(dt) {
  const p = player.pos, d = home.dist(p.x, p.z);
  if (d > 40) homeArmed = true;
  if (homeArmed && d < 9) { homeArmed = false; hud.notify('🏠', t('home_reached_title'), t('home_reached_body'), { voice: line('home_reached') }); }
  const safe = d < 12;
  weather.indoors = safe;
  player.umbrella = weather.rain > 0.35 && !safe;
  if (weather.state === 'storm') {
    stormNag -= dt;
    if (stormNag <= 0) { stormNag = 60; if (!safe) hud.notify('⚡', t('storm_title'), t('storm_out_body') + '<br>' + nearestNote(), { time: 9 }); }
  }
}

function setupLangButtons() {
  const flip = () => { setLang(getLang() === 'bn' ? 'en' : 'bn'); if (started) hud.say(line('lang_changed'), 2.5, '🌐 '); };
  $('langBtn').onclick = flip; $('langBtn2').onclick = flip;
  const vb = $('voiceBtn');
  const showVoice = () => { vb.textContent = voiceEnabled() ? '🔊' : '🔇'; vb.title = voiceEnabled() ? t('voice_on') : t('voice_off'); };
  vb.onclick = () => toggleVoice(); showVoice();
  onLang(showVoice);
  window.__showVoice = showVoice;
}
function toggleVoice() {
  setVoice(!voiceEnabled()); window.__showVoice();
  if (voiceEnabled()) { if (!hasVoice()) hud.toast(t('voice_missing'), 4); else hud.say(line('voice_on'), 2, '🔊 '); }
  else hud.toast('🔇 ' + t('voice_off'), 2);
}

// two-tone horn with WebAudio
let actx;
function horn(bus) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime, g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.connect(actx.destination);
    for (const [i, f] of (bus ? [[0, 220], [1, 277]] : [[0, 392], [1, 494]])) {
      const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(g);
      o.start(t0 + i * 0.28); o.stop(t0 + i * 0.28 + 0.22);
    }
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02); g.gain.setValueAtTime(0.06, t0 + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  } catch { /* no audio */ }
}

function toggleView(on) {
  if (on) {
    view.enter(player.pos.x, player.pos.z, camYaw);
    metro.overlay.visible = document.getElementById('metroChk').checked;
    hud.close(); hud.prompt(null);
    hud.say(line('view_on'), 3.5, '🦅 ');
  } else {
    view.exit(); metro.overlay.visible = false;
    updateCamera(0.016, true);
    if (!mobile) canvas.requestPointerLock?.();
    hud.say(line('view_off'), 2, '🚶 ');
  }
}

function start(explore) {
  if (started) return;
  started = true;
  $('loader').classList.add('hidden'); hud.show();
  if (mobile) { $('touch').classList.remove('hidden'); document.documentElement.requestFullscreen?.().catch(() => { }); screen.orientation?.lock?.('landscape').catch(() => { }); }
  if (explore) {
    view.enter(player.pos.x, player.pos.z, camYaw); metro.overlay.visible = true;
    view.dist = 420; view.pitch = 0.65;
    hud.say(line('welcome_view'), 6, '🦅 ');
  } else {
    if (!mobile) canvas.requestPointerLock?.();
    hud.say(line('welcome'), 7);
  }
  if (voiceEnabled() && !hasVoice()) setTimeout(() => hud.toast(t('voice_missing'), 4), 7000);
  // real environment: unlock audio (rain / thunder), then match the real Kolkata weather and time
  weather.unlock();
  if (spawnNote) hud.notify('📍', t(spawnNote), '', { time: 6 });
  syncLive(false);
  setInterval(() => { if (weather.live && liveTime) syncLive(false); }, 10 * 60 * 1000);
}

function checkOrientation() {
  const f = () => $('rotate').classList.toggle('hidden', innerWidth > innerHeight);
  addEventListener('resize', f); f();
}

const ray = new THREE.Vector3();
function updateCamera(dt, snap = false) {
  const lk = controls.look;
  camYaw -= lk.dx * 0.0032; camPitch += lk.dy * 0.0026;
  camPitch = Math.max(-1.3, Math.min(1.25, camPitch));   // below ~0.1 the camera stops orbiting and tilts up to look at the sky
  camDist = Math.max(2.5, Math.min(maxDist, camDist + controls.zoom * 0.9));
  const tgt = player.pos.clone(); tgt.y += 1.55;
  if (snap) camTarget.copy(tgt); else camTarget.lerp(tgt, Math.min(1, dt * 12));
  // keep camera out of buildings
  const pe = Math.max(camPitch, 0.1), lookUp = Math.max(0, 0.1 - camPitch);
  ray.set(Math.sin(camYaw) * Math.cos(pe), Math.sin(pe), Math.cos(camYaw) * Math.cos(pe));
  let want = camDist;
  for (let d = 0.6; d <= camDist; d += 0.5) {
    const x = camTarget.x + ray.x * d, y = camTarget.y + ray.y * d, z = camTarget.z + ray.z * d;
    const b = world.insideBuilding(x, z);
    if (b && y < b.ht + 0.5) { want = Math.max(1.2, d - 0.6); break; }
  }
  camDistCur = snap ? want : (want < camDistCur ? want : camDistCur + (want - camDistCur) * Math.min(1, dt * 3));
  camera.position.copy(camTarget).addScaledVector(ray, camDistCur);
  const gy = world.groundAt(camera.position.x, camera.position.z, camera.position.y) + 0.4;
  if (camera.position.y < gy) camera.position.y = gy;
  if (lookUp > 0) {                                  // look up at the sky: clouds, birds, rain, lightning
    const c = Math.cos(lookUp), s = Math.sin(lookUp);
    camera.lookAt(camera.position.x - Math.sin(camYaw) * c * 40, camera.position.y + s * 40, camera.position.z - Math.cos(camYaw) * c * 40);
  } else camera.lookAt(camTarget);
}

// ---------------------------------------------------------------- interaction
let nearThing = null;
function findInteractable() {
  const p = player.pos;
  const me = metro.nearestEntrance(p.x, p.z, 3.5);
  if (me) return { type: 'metro', e: me, label: t('prompt_metro', { name: tn(metro.stations[me.si].ni) }) };
  const n = people.nearest(p.x, p.z, 2.2);
  if (n) return { type: 'npc', n, label: t('prompt_talk') };
  if (home.isSet && home.dist(p.x, p.z) < 3.4) return { type: 'home', label: '<b>[E]</b> ' + t('home_door') };
  const poi = pois.nearest(p.x, p.z, 4.5);
  if (poi) return { type: 'poi', poi, label: t('prompt_enter', { name: escapeHtml(tn(poi.ni)) }) };
  for (const l of hud.landmarks) {
    let d;
    if (l.seg) { const [ax, az, bx, bz] = l.seg; const dx = bx - ax, dz = bz - az; const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz))); d = Math.hypot(p.x - ax - dx * t, p.z - az - dz * t) - 20; }
    else d = Math.hypot(p.x - l.x, p.z - l.z) - l.r;
    if (d < 0) return { type: 'landmark', l, label: t('prompt_about', { name: l.name }) };
  }
  return null;
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const visitedLandmarks = new Set();
function interact() {
  if (!nearThing) return;
  if (nearThing.type === 'metro') { metro.openPanel(nearThing.e.si); return; }
  if (nearThing.type === 'home') { enterHome(); return; }
  if (nearThing.type === 'npc') { hud.say('“' + people.talk(nearThing.n) + '”', 3, '🗣 '); }
  else if (nearThing.type === 'poi') { hud.panel(pois.visit(nearThing.poi)); }
  else if (nearThing.type === 'landmark') {
    const l = nearThing.l; visitedLandmarks.add(l.id);
    hud.panel({ kind: l.kind, name: l.name, street: t('kolkata'), body: l.body, say: landmarkLine(l.id) });
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  if (!world || !player) return;
  const viewing = view && view.active;
  if (started) {
    // UI keys
    if (controls.take('help')) { hud.open === 'help' ? hud.close() : (hud.close(), hud.help()); }
    if (controls.take('map')) { if (hud.open === 'map') hud.close(); else { hud.close(); mapui.open(viewing ? view.target : player.pos); } }
    if (controls.take('search')) { hud.close(); mapui.open(viewing ? view.target : player.pos, true); }
    if (controls.take('view')) { hud.close(); toggleView(!view.active); }
    if (controls.take('voice')) toggleVoice();
    if (controls.take('time')) { hud.timeScale = 1; liveTime = false; weather.live = false; weather.auto = true; hud.gameMinutes = (Math.floor(hud.gameMinutes / 120) + 1) * 120; hud.say(t(phaseOf((hud.gameMinutes / 60) % 24)), 2, '🕑 '); }
    if (controls.take('sethome')) setHome();
    if (controls.take('gohome')) goHome();
    if (controls.take('homeroute')) homeRoute();
    if (controls.take('live')) { weather.unlock(); syncLive(true); }
    if (controls.take('wx')) { weather.unlock(); weather.cycle(); updateWxText(); hud.toast(t('wx_manual', { wx: wxLabel() }), 2.5); }
    if (controls.take('lang')) { setLang(getLang() === 'bn' ? 'en' : 'bn'); hud.say(line('lang_changed'), 2.5, '🌐 '); }
    if (controls.take('esc') && hud.open) hud.close();
    if (metro.riding) {
      const dest = metro.updateRide(dt);
      if (dest) { world.ensureAround(dest[0], dest[1], 400).then(() => { const [tx, tz] = world.findSafeSpot(dest[0], dest[1], false); player.place(tx, tz); updateCamera(0.016, true); }); }
      controls.pressed.clear();
    } else if (hud.open) {
      if (controls.take('use') && hud.open === 'panel') hud.close();
      controls.pressed.clear(); controls.keys.forEach(k => { if (k.startsWith('Key') || k.startsWith('Arrow')) controls.keys.delete(k); });
    } else if (viewing) {
      view.update(dt);
    } else {
      if (controls.take('use')) interact();
      const res = player.update(dt, controls, camYaw, (type) => {
        const [fx, fz] = player.front(0.4);
        const said = people.hit(fx, fz, player.yaw, type === 'kick' ? 1.6 : 1.3, type === 'kick' ? 1.6 : 0.8);
        if (said) hud.say('“' + said + '”', 1.8, '😠 ');
      });
      traffic.collide(player.pos);
      if (res === 'river' && !hud.toastT) hud.say(line('river'), 2.5, '🌊 ');
      nav.update(dt, player.pos);
    }
    const focus = viewing ? view.target : player.pos;
    world.update(focus, viewing ? Math.min(low ? 2200 : 3200, Math.max(world.radius, view.dist * 1.6)) : world.radius);
    boats.update(dt, elapsed, focus);
    trains.update(dt);
    people.update(dt, { pos: focus });
    traffic.update(dt, focus, viewing ? null : player.pos);
    details.update(traffic.time);
    metro.update(dt);
    mapui.update();
    weather.update(dt, camera, focus, elapsed, daynight ? 1 - daynight.night : 1);
    alerts(dt);
    pois.update(dt, focus, camera);
    landmarks.update(elapsed);
    if (elapsed % 1 < dt) updateWxText();
    if (!viewing && elapsed % 0.2 < dt) { nearThing = findInteractable(); hud.prompt(hud.open ? null : nearThing && nearThing.label); }
    hud.update(dt, focus, viewing ? view.yaw : camYaw, viewing ? view.yaw + Math.PI : player.yaw);
  }
  if (!viewing) updateCamera(dt);
  // shadows follow the focus point
  const focus = viewing ? view.target : player.pos;
  const sd = viewing ? view.shadowSize * 2 + 250 : 250;
  const lightDir = daynight ? daynight.update(hud ? hud.gameMinutes : 600, focus, camera, elapsed) : SUN_DIR;
  sun.position.copy(focus).addScaledVector(lightDir, sd); sun.target.position.copy(focus);
  if (daynight && started) {
    nightLights.update(dt, viewing ? 0 : daynight.level, player.pos, home.porch ? [{ x: home.porch.x, y: home.porch.y, z: home.porch.z }] : []);
    traffic.setLights(daynight.level);
    home.update(daynight.level, elapsed);
  }
  world.waterMat.normalMap.offset.set(elapsed * 0.004, elapsed * 0.01);
  renderer.render(scene, camera);
  controls.endFrame();
}

// dev helper: __dbg(x, z, yaw, pitch, dist) teleports & frames the camera
window.__scene = scene; window.__game = () => ({ weather, home, nightLights, landmarks, trains, daynight, hud, player, world, people, controls, traffic, metro, nav, view, mapui });
window.__metroTest = () => { const e = metro.entrances.find(e => metro.stations[e.si].n === 'Esplanade'); player.place(e.x + 1, e.z + 1); metro.openPanel(e.si); };
window.__dbg = (x, z, yaw, pitch, dist) => {
  if (dist > 22) maxDist = dist;
  const [tx, tz] = world.findSafeSpot(x, z); player.place(tx, tz);
  if (yaw !== undefined) camYaw = yaw; if (pitch !== undefined) camPitch = pitch; if (dist !== undefined) camDist = dist;
  updateCamera(0.016, true);
};
let fpsN = 0;
setInterval(() => { window.__fps = fpsN / 2; fpsN = 0; }, 2000);
(function cnt() { fpsN++; requestAnimationFrame(cnt); })();

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

init().catch(e => { console.error(e); $('loadmsg').textContent = 'Error: ' + e.message; });
frame();
