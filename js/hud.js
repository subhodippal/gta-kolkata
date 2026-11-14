// HUD: minimap, location labels, prompts, info panels, full map with fast travel
import { KIND_STYLE } from './pois.js';
import { phaseOf } from './daynight.js';
import { t, num, speak, onLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const FONT = '"Hind Siliguri", sans-serif';

export class HUD {
  constructor(world, pois, landmarks) {
    this.world = world; this.pois = pois; this.landmarks = landmarks;
    this.mm = $('minimap'); this.mmc = this.mm.getContext('2d');
    this.t = 0; this.toastT = 0;
    this.open = null; // 'panel' | 'map' | 'help'
    this.gameMinutes = 10 * 60;
    onLang(() => { this.lastPhase = null; });
    $('pclose').onclick = () => this.close();
    $('hclose').onclick = () => this.close();
    $('pgo').onclick = () => { const g = this.goTarget; this.close(); if (g) this.onGo && this.onGo(g); };
    onLang(() => { this.t = 0.29; });
  }

  show() { $('hud').classList.remove('hidden'); }

  update(dt, focus, camYaw, facing) {
    this.t += dt;
    this.gameMinutes += dt; // 1 real second = 1 game minute
    if (this.t % 0.3 < dt) {
      $('district').textContent = this.world.districtAt(focus.x, focus.z);
      $('street').textContent = this.world.streetAt(focus.x, focus.z) || '';
      const m = Math.floor(this.gameMinutes) % 1440;
      const ph = phaseOf(m / 60); if (ph !== this.lastPhase) { this.lastPhase = ph; $('phase').textContent = ['ph_sunrise', 'ph_sunset'].includes(ph) ? (ph === 'ph_sunrise' ? '🌅 ' : '🌇 ') + t(ph) : ((m / 60 >= 19 || m / 60 < 5) ? '🌙 ' : '☀️ ') + t(ph); }
      $('clock').textContent = num(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
      $('visited').textContent = t('visited', { n: num(this.pois.visited.size) });
    }
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').classList.add('hidden');
    this.drawMinimap(focus, camYaw, facing);
  }

  drawMinimap(focus, camYaw, facing) {
    const c = this.mmc, W = this.mm.width, S = 1.15, R = W / 2 / S * 1.45, fx = focus.x, fz = focus.z, Wd = this.world;
    c.save();
    c.fillStyle = '#3d3b35'; c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2); c.rotate(camYaw); c.scale(S, S); c.translate(-fx, -fz);
    const poly = (p) => { c.beginPath(); for (let i = 0; i < p.length; i += 2) i ? c.lineTo(p[i], p[i + 1]) : c.moveTo(p[i], p[i + 1]); c.closePath(); };
    const near = (p) => { for (let i = 0; i < p.length; i += 2) if (Math.abs(p[i] - fx) < R && Math.abs(p[i + 1] - fz) < R) return true; return p.length > 400; };
    c.fillStyle = '#2f6d8a'; for (const r of Wd.d.river) { poly(r.p); c.fill(); }
    const tiles = Wd.tilesAt(fx, fz, R);
    for (const tile of tiles) {
      c.fillStyle = '#3f6a35'; for (const pk of (tile.d.parks || [])) if (near(pk.p)) { poly(pk.p); c.fill(); }
      c.fillStyle = '#2f6d8a'; for (const w of (tile.d.water || [])) if (near(w.p)) { poly(w.p); c.fill(); }
    }
    c.fillStyle = '#5c5a53';
    for (const tile of tiles) for (const b of tile.bldGrid.queryRadius(fx, fz, R)) if (Math.abs(b.cx - fx) < R && Math.abs(b.cz - fz) < R) { poly(b.p); c.fill(); }
    c.lineCap = 'round';
    const RC = ['#f0c74a', '#f0c74a', '#ece6d2', '#ddd7c4', '#c9c4b3', '#c9c4b3', '#aaa597', '#8f8b80', '#7d7568', '#7d7568'];
    const segs = new Set();
    for (const tile of tiles) tile.roadGrid.queryRadius(fx, fz, R, segs);
    if (!tiles.length) Wd.netStreetGrid.queryRadius(fx, fz, R, segs);
    const sorted = [...segs].sort((a, b) => b[5] - a[5]);
    for (const s of sorted) { c.strokeStyle = RC[s[5]] || '#888'; c.lineWidth = Math.max(2, s[6]); c.beginPath(); c.moveTo(s[0], s[1]); c.lineTo(s[2], s[3]); c.stroke(); }
    if (this.metro) {
      c.setLineDash([8, 5]); c.lineWidth = 3;
      for (const L of this.metro.lines) { c.strokeStyle = L.c; for (const sg of L.segs) { const p = sg.p; c.beginPath(); for (let i = 0; i < p.length; i += 2) i ? c.lineTo(p[i], p[i + 1]) : c.moveTo(p[i], p[i + 1]); c.stroke(); } }
      c.setLineDash([]);
      for (const st of this.metro.stations) if (Math.abs(st.x - fx) < R && Math.abs(st.z - fz) < R) { c.fillStyle = '#fff'; c.strokeStyle = '#d4202a'; c.lineWidth = 2.5; c.beginPath(); c.arc(st.x, st.z, 6, 0, 7); c.fill(); c.stroke(); }
    }
    for (const p of this.pois.grid.queryRadius(fx, fz, R)) { c.fillStyle = (KIND_STYLE[p.k] || KIND_STYLE.shop).col; c.beginPath(); c.arc(p.x, p.z, 3.5, 0, 7); c.fill(); }
    for (const l of this.landmarks) { c.fillStyle = '#ffcf3f'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(l.x, l.z, 7, 0, 7); c.fill(); c.stroke(); }
    if (this.routePts) {
      const rp = this.routePts; c.strokeStyle = '#b388ff'; c.lineWidth = 5; c.lineJoin = 'round'; c.beginPath();
      for (let i = 0; i < rp.length; i += 3) i ? c.lineTo(rp[i], rp[i + 2]) : c.moveTo(rp[i], rp[i + 2]);
      c.stroke();
      const d = this.routeDest; if (d) { c.fillStyle = '#7b3fe4'; c.beginPath(); c.arc(d.x, d.z, 8, 0, 7); c.fill(); }
    }
    c.restore();
    c.save(); c.translate(W / 2, W / 2); c.rotate(-(facing - camYaw) + Math.PI);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke();
    c.restore();
    const n = $('north'), r = W / 2 - 10;
    n.style.left = (W / 2 + Math.sin(camYaw) * r) + 'px'; n.style.top = (W / 2 - Math.cos(camYaw) * r - 8) + 'px'; n.style.transform = 'translateX(-50%)';
  }

  prompt(html) { const p = $('prompt'); if (html) { p.innerHTML = html; p.classList.remove('hidden'); } else p.classList.add('hidden'); }
  toast(text, time = 2.5) { const el = $('toast'); el.innerHTML = text; el.classList.remove('hidden'); this.toastT = time; }
  /** show + read aloud (lines from comment.json) */
  say(text, time = 3.5, icon = '') { this.toast(icon + text, time); speak(text); }

  panel(info) {
    $('pkind').textContent = info.kind; $('pname').textContent = info.name; $('pstreet').textContent = info.street || '';
    $('pbody').innerHTML = info.body; $('panel').classList.remove('hidden'); this.open = 'panel';
    this.goTarget = info.go || null; $('pgo').classList.toggle('hidden', !info.go);
    if (document.pointerLockElement) document.exitPointerLock();
    if (info.say) speak(info.say);
  }
  help() { $('help').classList.remove('hidden'); this.open = 'help'; if (document.pointerLockElement) document.exitPointerLock(); }
  close() {
    for (const id of ['panel', 'help']) $(id).classList.add('hidden');
    if (this.open === 'map' && this.mapui) this.mapui.close();
    if (this.open === 'metro' && this.metro) this.metro.closePanel();
    this.open = null;
  }

}
