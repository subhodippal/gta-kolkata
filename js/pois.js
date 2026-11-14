// Points of interest (real shops, restaurants, petrol pumps, hotels... from OpenStreetMap)
import * as THREE from 'three';
import { Grid } from './geo.js';
import { t, tn, tt, tk, tfamous, tmenu, line, onLang, num, getLang } from './i18n.js';

// colours/icons per kind; labels come from data/strings.json ("kinds")
export const KIND_STYLE = {
  food: { col: '#ff9d2e', icon: '🍛' }, shop: { col: '#4fc3f7', icon: '🛍' }, fuel: { col: '#ffd54f', icon: '⛽' },
  hotel: { col: '#ef5350', icon: '🏨' }, sight: { col: '#ab47bc', icon: '📷' }, bank: { col: '#66bb6a', icon: '🏦' },
  health: { col: '#e57373', icon: '✚' }, police: { col: '#5c6bc0', icon: '🚓' }, worship: { col: '#ffb74d', icon: '🛕' },
  cinema: { col: '#f06292', icon: '🎬' }, transport: { col: '#90a4ae', icon: '🚉' },
  edu: { col: '#8d6e63', icon: '🎓' }, office: { col: '#78909c', icon: '🏢' },
  sweets: { col: '#ec407a', icon: '🍬' }, hospital: { col: '#d32f2f', icon: '🏥' }, ghat: { col: '#0288d1', icon: '🛶' },
  stadium: { col: '#2e7d32', icon: '🏟' }, mall: { col: '#7e57c2', icon: '🏬' }, market: { col: '#ff7043', icon: '🧺' },
  museum: { col: '#6d4c41', icon: '🏛' }, park: { col: '#43a047', icon: '🌳' }, wonder: { col: '#8e24aa', icon: '🗿' },
  building: { col: '#546e7a', icon: '🏙' }, residential: { col: '#a1887f', icon: '🏘' },
};
for (const k in KIND_STYLE) Object.defineProperty(KIND_STYLE[k], 'label', { get: () => tk(k) });

export class POIs {
  constructor(scene, world, list) {
    this.scene = scene; this.world = world; this.list = list; this.grid = new Grid(40);
    list.forEach(p => this.grid.addBox(p, p.x, p.z, p.x, p.z));
    this.visited = new Set();
    // ground marker rings
    const g = new THREE.RingGeometry(0.8, 1.2, 24); g.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
    const im = new THREE.InstancedMesh(g, this.ringMat, list.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    list.forEach((p, i) => {
      p.y = this.world.groundAt(p.x, p.z, 0) + 0.08;
      m.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m);
      c.set((KIND_STYLE[p.k] || KIND_STYLE.shop).col); im.setColorAt(i, c);
    });
    im.frustumCulled = false; scene.add(im); this.rings = im;
    // pooled signboards
    this.boards = [];
    for (let i = 0; i < 14; i++) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      mesh.visible = false; mesh.renderOrder = 2; scene.add(mesh);
      this.boards.push({ mesh, cv, tex, poi: null });
    }
    this.t = 0;
    onLang(() => { for (const b of this.boards) { b.poi = null; b.mesh.visible = false; } });
  }

  drawBoard(b, p) {
    const c = b.cv.getContext('2d'), st = KIND_STYLE[p.k] || KIND_STYLE.shop;
    c.clearRect(0, 0, 512, 128);
    c.fillStyle = 'rgba(15,10,6,0.82)'; roundRect(c, 4, 8, 504, 112, 18); c.fill();
    c.fillStyle = st.col; roundRect(c, 4, 8, 20, 112, 10); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 44px "Hind Siliguri", sans-serif'; c.textBaseline = 'middle';
    const full = tn(p.ni); let name = full; while (c.measureText(name).width > 440 && name.length > 4) name = name.slice(0, -2);
    if (name !== full) name += '…';
    c.fillText(name, 40, 52);
    c.fillStyle = st.col; c.font = '26px "Hind Siliguri", sans-serif'; c.fillText(st.icon + '  ' + (p.t ? tt(p.t) : st.label), 40, 96);
    b.tex.needsUpdate = true;
  }

  update(dt, player, camera) {
    this.t += dt;
    this.ringMat.opacity = 0.55 + Math.sin(this.t * 4) * 0.25;
    if ((this.t % 0.5) < dt) {
      const near = [...this.grid.queryRadius(player.x, player.z, 70)]
        .map(p => [p, Math.hypot(p.x - player.x, p.z - player.z)]).filter(a => a[1] < 70).sort((a, b) => a[1] - b[1]).slice(0, this.boards.length).map(a => a[0]);
      const keep = new Set(near);
      for (const b of this.boards) if (b.poi && !keep.has(b.poi)) { b.poi = null; b.mesh.visible = false; }
      for (const p of near) {
        if (this.boards.some(b => b.poi === p)) continue;
        const b = this.boards.find(b => !b.poi); if (!b) break;
        b.poi = p; this.drawBoard(b, p); b.mesh.position.set(p.x, p.y + 4.2, p.z); b.mesh.visible = true;
      }
    }
    for (const b of this.boards) if (b.poi) {
      b.mesh.rotation.y = Math.atan2(camera.position.x - b.mesh.position.x, camera.position.z - b.mesh.position.z);
      const d = camera.position.distanceTo(b.mesh.position); const s = Math.min(2.2, Math.max(0.8, d / 25)); b.mesh.scale.setScalar(s);
    }
  }

  nearest(x, z, r = 4) {
    let best = null, bd = r;
    for (const p of this.grid.queryRadius(x, z, r)) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  visit(p) {
    this.visited.add(p);
    const st = KIND_STYLE[p.k] || KIND_STYLE.shop;
    const type = p.t ? tt(p.t) : st.label;
    let body = '';
    const fam = tfamous(p.n);
    if (fam) body += `<p>${fam}</p>`;
    const desc = (getLang() === 'bn' ? p.db : p.d) || p.d;
    if (desc) body += `<p>${p.f ? '⭐ ' : ''}${desc}</p>`;
    if (p.k === 'food') {
      const menu = tmenu(p.t === 'fast_food' || p.t === 'cafe' ? p.t : 'food');
      body += `<p><b>${t('menu')}</b> <span class="small">${t('menu_note')}</span></p><ul>` +
        pick(menu, p.n, 5).map(m => `<li>${m.name}<span class="price">₹${num(m.price)}</span></li>`).join('') + '</ul>';
    } else if (p.k === 'fuel') {
      body += `<p>${t('body_fuel')}</p><p class="small">${t('body_fuel_note')}</p>`;
    } else if (p.k === 'shop') {
      body += `<p>${t('body_shop', { type })}</p>`;
    } else if (p.k === 'hotel') body += `<p>${t('body_hotel')}</p>`;
    else if (p.k === 'bank') body += `<p>${t('body_bank')}</p>`;
    else if (p.k === 'worship') body += `<p>${t('body_worship')}</p>`;
    else if (!body) body += `<p>${st.label}</p>`;
    const greet = ['food', 'shop'].includes(p.k) ? line('shop_greet') : null;
    return { kind: st.icon + ' ' + type, name: tn(p.ni), street: p.sti !== undefined ? t('address', { street: tn(p.sti) }) : t('kolkata'), body, say: greet };
  }
}

function pick(arr, seed, n) {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = arr.slice(); const out = [];
  while (out.length < n && a.length) { h = (h * 1103515245 + 12345) >>> 0; out.push(a.splice(h % a.length, 1)[0]); }
  return out;
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
