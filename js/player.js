// The player character: walk, run, jump, punch, kick
import * as THREE from 'three';
import { makeHuman, animateHuman } from './human.js';

export class Player {
  constructor(scene, world) {
    this.world = world;
    // red-and-white checked style shirt, jeans: our hero from Kolkata
    this.h = makeHuman({ skin: 0x8a5636, shirt: 0xc62828, pants: 0x1f3550, hair: 0x120d0a, shoes: 0xeeeeee });
    scene.add(this.h.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.onGround = true;
    this.attack = null;
    this.combo = 0;
    this.speed = 0;
    this.stamina = 1;
  }

  place(x, z) { this.pos.set(x, this.world.groundAt(x, z, 50), z); this.vel.set(0, 0, 0); }

  update(dt, ctl, camYaw, onHit) {
    const ax = ctl.axes();
    const run = ctl.running() && ax.mag > 0.1 && this.stamina > 0.05;
    const max = (run ? 7.2 : 3.0) * (ax.mag > 0.1 ? Math.max(0.45, ax.mag) : 0);
    // camera relative move direction
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * ax.y + rx * ax.x, dz = fz * ax.y + rz * ax.x;
    const dl = Math.hypot(dx, dz); if (dl > 0) { dx /= dl; dz /= dl; }
    const slow = this.attack ? 0.25 : 1;
    const accel = this.onGround ? 14 : 3;
    const tvx = dx * max * slow, tvz = dz * max * slow;
    this.vel.x += (tvx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (tvz - this.vel.z) * Math.min(1, accel * dt);
    if (run) this.stamina = Math.max(0, this.stamina - dt * 0.05); else this.stamina = Math.min(1, this.stamina + dt * 0.15);

    if (dl > 0 && !this.attack) {
      const target = Math.atan2(dx, dz);
      let d = target - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 12);
    }

    // jump
    if (ctl.take('jump') && this.onGround && !this.attack) { this.vel.y = 6.8; this.onGround = false; }
    // attacks
    if (!this.attack) {
      if (ctl.take('punch')) { this.combo = (this.combo + 1) % 2; this.attack = { type: 'punch', t: 0, dur: 0.36, side: this.combo ? 1 : -1, hit: false }; }
      else if (ctl.take('kick')) { this.attack = { type: 'kick', t: 0, dur: 0.58, side: 1, hit: false }; }
    }
    if (this.attack) {
      const a = this.attack; a.t += dt / a.dur;
      if (!a.hit && a.t > 0.32) { a.hit = true; onHit && onHit(a.type); }
      if (a.t >= 1) this.attack = null;
    }

    // integrate
    const prev = this.pos.clone();
    this.vel.y -= 22 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const hitRiver = this.world.collide(this.pos, 0.34, prev);
    const g = this.world.groundAt(this.pos.x, this.pos.z, prev.y);
    if (this.pos.y <= g) { this.pos.y = g; this.vel.y = 0; this.onGround = true; }
    else if (this.pos.y - g > 0.25 || this.vel.y > 0) this.onGround = false;
    else { this.pos.y = g; this.vel.y = 0; this.onGround = true; } // stick to ramps when walking down
    this.speed = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z) / Math.max(dt, 1e-4);

    this.h.root.position.copy(this.pos);
    this.h.root.rotation.y = this.yaw;
    animateHuman(this.h, { speed: this.speed, air: !this.onGround, vy: this.vel.y, attack: this.attack, dt });
    return hitRiver;
  }

  // world-space point in front of the player
  front(d) { return [this.pos.x + Math.sin(this.yaw) * d, this.pos.z + Math.cos(this.yaw) * d]; }
}
