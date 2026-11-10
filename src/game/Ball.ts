import * as THREE from 'three';
import { BALL_R, GOAL_D, GOAL_H, GOAL_HW, GRAVITY, HALF_L, POST_R } from './constants';
import type { Player } from './Player';

const AIR_DRAG = 0.008;
export const ROLL_K = 0.12;
const _tmp = new THREE.Vector3();
const _axis = new THREE.Vector3();

function makeBallTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#16181d';
  const spots = [[32, 30], [96, 64], [160, 30], [224, 64], [32, 98], [160, 98], [96, 10], [224, 118], [0, 64], [256, 64]];
  for (const [x, y] of spots) {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * 14, py = y + Math.sin(a) * 12;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  g.strokeStyle = '#d23b3b'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Ball {
  pos = new THREE.Vector3(0, BALL_R, 0);
  /** Позиция на прошлом шаге — для непрерывной проверки приёма (мяч не проскакивает). */
  prev = new THREE.Vector3(0, BALL_R, 0);
  vel = new THREE.Vector3();
  spin = 0;
  owner: Player | null = null;
  lastTouch: Player | null = null;
  intended: Player | null = null;
  offsidePlayer: Player | null = null;
  heldByGK = false;
  inGoalSide = 0; // 0, 1 (ворота +x), -1 (ворота -x)
  friction = 1.6;
  bounce = 0.55;
  mesh: THREE.Mesh;

  constructor() {
    const geo = new THREE.SphereGeometry(BALL_R, 20, 14);
    const mat = new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.45 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
  }

  place(x: number, z: number, y = BALL_R) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.spin = 0;
    this.owner = null;
    this.heldByGK = false;
    this.inGoalSide = 0;
    this.intended = null;
    this.offsidePlayer = null;
  }

  kick(vel: THREE.Vector3, by: Player, spin = 0) {
    this.owner = null;
    this.heldByGK = false;
    this.vel.copy(vel);
    this.spin = spin;
    this.lastTouch = by;
    if (this.pos.y < BALL_R + 0.02) this.pos.y = BALL_R + 0.02;
  }

  get onGround() { return this.pos.y <= BALL_R + 0.01 && Math.abs(this.vel.y) < 0.05; }
  get speed() { return this.vel.length(); }

  /** Один шаг физики свободного мяча. Возвращает событие столкновения. */
  step(dt: number): 'post' | 'bounce' | 'net' | null {
    let ev: 'post' | 'bounce' | 'net' | null = null;
    const p = this.pos, v = this.vel;
    this.prev.copy(p);
    const prevX = p.x;
    integrate(p, v, dt, this.friction, this.bounce, this);
    if (this.lastBounce) { ev = 'bounce'; this.lastBounce = false; }

    // пересечение линии ворот
    for (const s of [1, -1]) {
      const lx = p.x * s, plx = prevX * s;
      if (plx <= HALF_L && lx > HALF_L && this.inGoalSide === 0) {
        if (Math.abs(p.z) < GOAL_HW && p.y < GOAL_H) this.inGoalSide = s;
      }
    }
    const pe = this.collideGoals();
    if (pe) ev = pe;
    return ev;
  }

  lastBounce = false;

  private collideGoals(): 'post' | 'net' | null {
    let ev: 'post' | 'net' | null = null;
    const p = this.pos, v = this.vel;
    for (const s of [1, -1]) {
      const gx = s * HALF_L;
      if (Math.abs(p.x - gx) < 3 && Math.abs(p.z) < GOAL_HW + 1 && p.y < GOAL_H + 1) {
        for (const zs of [1, -1]) {
          if (this.collideSeg(gx, 0, zs * GOAL_HW, gx, GOAL_H, zs * GOAL_HW)) ev = 'post';
        }
        if (this.collideSeg(gx, GOAL_H, -GOAL_HW, gx, GOAL_H, GOAL_HW)) ev = 'post';
      }
      const lx = p.x * s;
      if (lx > HALF_L && lx < HALF_L + GOAL_D + 0.6) {
        if (this.inGoalSide === s) {
          // мяч внутри сетки
          const back = HALF_L + GOAL_D - BALL_R;
          if (lx > back) { p.x = s * back; if (v.x * s > 0) { v.x = -v.x * 0.12; v.y *= 0.4; v.z *= 0.4; ev = 'net'; } }
          if (Math.abs(p.z) > GOAL_HW - BALL_R) { p.z = Math.sign(p.z) * (GOAL_HW - BALL_R); v.z *= -0.15; v.x *= 0.6; ev = ev || 'net'; }
          if (p.y > GOAL_H - BALL_R) { p.y = GOAL_H - BALL_R; if (v.y > 0) v.y *= -0.15; ev = ev || 'net'; }
        } else if (lx < HALF_L + GOAL_D && Math.abs(p.z) < GOAL_HW + BALL_R && p.y < GOAL_H + BALL_R) {
          // внешняя сторона сетки
          const dz = GOAL_HW + BALL_R - Math.abs(p.z);
          const dy = GOAL_H + BALL_R - p.y;
          if (dz < dy) { p.z = Math.sign(p.z || 1) * (GOAL_HW + BALL_R); v.z *= -0.2; }
          else { p.y = GOAL_H + BALL_R; v.y = Math.abs(v.y) * 0.2; }
          v.x *= 0.5;
          ev = 'net';
        }
      }
    }
    return ev;
  }

  private collideSeg(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const p = this.pos;
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = ((p.x - ax) * abx + (p.y - ay) * aby + (p.z - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
    _tmp.set(p.x - cx, p.y - cy, p.z - cz);
    const d = _tmp.length();
    const r = POST_R + BALL_R;
    if (d < r && d > 1e-6) {
      _tmp.multiplyScalar(1 / d);
      p.set(cx + _tmp.x * r, cy + _tmp.y * r, cz + _tmp.z * r);
      const vn = this.vel.dot(_tmp);
      if (vn < 0) { this.vel.addScaledVector(_tmp, -1.7 * vn); return true; }
    }
    return false;
  }

  /** Предсказание траектории (без столкновений) — для ИИ. */
  predict(out: THREE.Vector3[], step: number) {
    const p = this.pos.clone(), v = this.vel.clone();
    const dummy = { lastBounce: false, spin: this.spin };
    for (let i = 0; i < out.length; i++) {
      out[i].copy(p);
      const sub = 4;
      for (let k = 0; k < sub; k++) integrate(p, v, step / sub, this.friction, this.bounce, dummy);
    }
  }

  /** Попадёт ли мяч в створ ворот side (без учёта игроков). */
  willBeOnTarget(side: number) {
    const p = this.pos.clone(), v = this.vel.clone();
    const dummy = { lastBounce: false, spin: this.spin };
    for (let i = 0; i < 240; i++) {
      const px = p.x;
      integrate(p, v, 1 / 60, this.friction, this.bounce, dummy);
      if (px * side <= HALF_L && p.x * side > HALF_L) {
        return Math.abs(p.z) < GOAL_HW - 0.05 && p.y < GOAL_H - 0.05;
      }
      if (v.lengthSq() < 1) return false;
    }
    return false;
  }

  updateVisual(dt: number) {
    this.mesh.position.copy(this.pos);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.05) {
      _axis.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(_axis, (hs * dt) / BALL_R);
    }
  }
}

function integrate(p: THREE.Vector3, v: THREE.Vector3, dt: number, friction: number, bounce: number, state: { lastBounce: boolean; spin: number }) {
  // эффект Магнуса (подкрутка)
  if (Math.abs(state.spin) > 0.01 && p.y > BALL_R + 0.05) {
    const hs = Math.hypot(v.x, v.z);
    if (hs > 1) {
      const ax = (-v.z / hs) * state.spin, az = (v.x / hs) * state.spin;
      v.x += ax * dt;
      v.z += az * dt;
    }
    state.spin *= 1 - 0.7 * dt;
  }
  v.y -= GRAVITY * dt;
  const sp = v.length();
  v.multiplyScalar(Math.max(0, 1 - AIR_DRAG * sp * dt));
  p.addScaledVector(v, dt);
  if (p.y < BALL_R) {
    p.y = BALL_R;
    if (v.y < -1.4) {
      v.y = -v.y * bounce;
      v.x *= 0.86; v.z *= 0.86;
      state.lastBounce = true;
    } else v.y = 0;
  }
  if (p.y <= BALL_R + 0.001 && v.y === 0) {
    const hs = Math.hypot(v.x, v.z);
    const dec = (friction + ROLL_K * hs) * dt;
    if (hs <= dec) { v.x = 0; v.z = 0; }
    else { const k = (hs - dec) / hs; v.x *= k; v.z *= k; }
  }
}
