// Keyboard + mouse (pointer lock) + touch (virtual joystick & buttons)
export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // one-shot actions this frame
    this.look = { dx: 0, dy: 0 };
    this.zoom = 0;
    this.joy = { x: 0, y: 0, active: false };
    this.touchRun = false;
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.enabled = true;
    this.mouseDown = false;
    this.freeMouse = false; // true in view mode: no pointer lock, mouse used for map-style navigation

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.repeat) { if (['Space'].includes(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      const map = { Space: 'jump', KeyJ: 'punch', KeyK: 'kick', KeyE: 'use', KeyM: 'map', KeyH: 'help', Escape: 'esc', KeyF: 'use', KeyV: 'view', KeyN: 'voice', KeyL: 'lang', Slash: 'search', KeyT: 'time' };
      if (map[e.code]) this.pressed.add(map[e.code]);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // mouse
    canvas.addEventListener('mousedown', (e) => {
      if (this.touch || this.freeMouse) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); this.mouseDown = true; this.lastX = e.clientX; this.lastY = e.clientY; return; }
      if (e.button === 0) this.pressed.add('punch');
      if (e.button === 2) this.pressed.add('kick');
    });
    addEventListener('mouseup', () => { this.mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.freeMouse) return;
      if (document.pointerLockElement === canvas) { this.look.dx += e.movementX; this.look.dy += e.movementY; }
      else if (this.mouseDown) { this.look.dx += e.clientX - this.lastX; this.look.dy += e.clientY - this.lastY; this.lastX = e.clientX; this.lastY = e.clientY; }
    });
    canvas.addEventListener('wheel', (e) => { if (!this.freeMouse) this.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    if (this.touch) this.setupTouch();
  }

  setupTouch() {
    document.body.classList.add('touch');
    const joy = document.getElementById('joy'), knob = document.getElementById('joyKnob');
    let jid = null, cx = 0, cy = 0;
    const R = 60;
    joy.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; jid = t.identifier; const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(t); e.preventDefault();
    }, { passive: false });
    const move = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px,${dy}px)`; this.joy.x = dx / R; this.joy.y = -dy / R; this.joy.active = true;
    };
    joy.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === jid) move(t); e.preventDefault(); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === jid) { jid = null; this.joy.x = this.joy.y = 0; this.joy.active = false; knob.style.transform = ''; } };
    joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end);

    // camera drag anywhere else on the canvas
    let lid = null, lx = 0, ly = 0;
    this.canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } e.preventDefault(); }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === lid) { this.look.dx += (t.clientX - lx) * 1.6; this.look.dy += (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY; }
      e.preventDefault();
    }, { passive: false });
    const lend = (e) => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; };
    this.canvas.addEventListener('touchend', lend); this.canvas.addEventListener('touchcancel', lend);

    for (const b of document.querySelectorAll('#tbtns .tb')) {
      const k = b.dataset.k;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (k === 'run') { this.touchRun = !this.touchRun; b.classList.toggle('on', this.touchRun); }
        else { this.pressed.add(k); if (k === 'jump') this.keys.add('TouchJump'); }
      }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); if (k === 'jump') this.keys.delete('TouchJump'); }, { passive: false });
    }
  }

  // movement axes: x = right, y = forward
  axes() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (this.joy.active) { x += this.joy.x; y += this.joy.y; }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m) };
  }
  running() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun || (this.joy.active && Math.hypot(this.joy.x, this.joy.y) > 0.95 && this.touchRun); }
  take(a) { const h = this.pressed.has(a); this.pressed.delete(a); return h; }
  endFrame() { this.pressed.clear(); this.look.dx = this.look.dy = 0; this.zoom = 0; }
}
