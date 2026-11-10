import * as THREE from 'three';
import { HALF_L, HALF_W, angleLerp } from './constants';
import type { Slot } from './constants';
import type { PlayerData } from './types';
import type { PlayerModel } from './PlayerModel';
import type { Team } from './Team';

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  desired = new THREE.Vector3();
  facing = 0;
  lookAt: THREE.Vector3 | null = null;

  // таймеры состояний
  kickCD = 0;
  stunT = 0;
  slideT = 0;
  slideWon = false;
  tackleCD = 0;
  kickAnim = -1;
  diveT = 0;
  diveDur = 0.75;
  diveVel = new THREE.Vector3();
  diveSide = 1;
  diveH = 0;
  jumpT = 0;
  fallen = 0;
  celebrate = false;
  phase = Math.random() * 6;
  holdT = 0;
  tackleT = 0; // выпад при отборе
  tackleDone = false;
  riseT = 0; // вставание после подката
  accelMul = 1; // управляемый игроком — отзывчивее

  // ИИ
  aiTimer = Math.random() * 0.5;
  spaceTimer = Math.random();
  aiSpot = new THREE.Vector3();
  runT = Math.random() * 4;
  runTarget: THREE.Vector3 | null = null;
  reactT = 0;
  speedMul = 1;

  constructor(public data: PlayerData, public team: Team, public slotIndex: number, public model: PlayerModel) {}

  get slot(): Slot { return this.team.slots[this.slotIndex]; }
  get isGK() { return this.slotIndex === 0; }
  get busy() { return this.stunT > 0 || this.slideT > 0 || this.diveT > 0; }

  jogSpeed() { return (4.4 + this.data.pace * 0.013) * this.speedMul; }
  sprintSpeed() { return (6.1 + this.data.pace * 0.036) * this.speedMul; }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  speed() { return Math.hypot(this.vel.x, this.vel.z); }

  dist2D(p: THREE.Vector3) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }

  startDive(vx: number, vz: number, height: number, side: number, dur = 0.75) {
    this.diveT = dur;
    this.diveDur = dur;
    this.diveVel.set(vx, 0, vz);
    this.diveH = height;
    this.diveSide = side;
    this.vel.set(0, 0, 0);
  }

  step(dt: number, hasBall: boolean) {
    this.kickCD -= dt;
    this.tackleCD -= dt;
    if (this.tackleT > 0) this.tackleT -= dt;
    if (this.jumpT > 0) this.jumpT -= dt;

    if (this.diveT > 0) {
      this.diveT -= dt;
      const t = 1 - this.diveT / this.diveDur;
      const k = Math.max(0, 1 - t * 1.1);
      this.pos.x += this.diveVel.x * dt * k * 1.6;
      this.pos.z += this.diveVel.z * dt * k * 1.6;
      this.pos.y = Math.max(0, Math.sin(Math.min(1, t * 1.3) * Math.PI) * this.diveH);
      if (this.diveT <= 0) {
        this.pos.y = 0;
        this.stunT = 0.55;
        this.fallen = this.diveSide;
      }
      return;
    }
    if (this.slideT > 0) {
      this.slideT -= dt;
      this.vel.multiplyScalar(Math.max(0, 1 - 1.9 * dt));
      if (this.slideT <= 0) { this.riseT = 0.5; this.stunT = 0.5; this.fallen = 3; this.slideWon = false; }
    } else if (this.stunT > 0) {
      this.stunT -= dt;
      this.vel.multiplyScalar(Math.max(0, 1 - 7 * dt));
      if (this.riseT > 0) { this.riseT -= dt; this.fallen = 3 + Math.min(0.999, 1 - this.riseT / 0.5); }
      if (this.stunT <= 0) { this.fallen = 0; this.riseT = 0; }
    } else {
      const dvx = this.desired.x - this.vel.x, dvz = this.desired.z - this.vel.z;
      const dl = Math.hypot(dvx, dvz);
      const acc = (14 + this.data.physical * 0.05 + this.data.pace * 0.04) * (hasBall ? 0.85 : 1) * this.accelMul * (this.tackleT > 0 ? 1.8 : 1);
      const maxDv = acc * dt;
      if (dl > maxDv) { this.vel.x += (dvx / dl) * maxDv; this.vel.z += (dvz / dl) * maxDv; }
      else { this.vel.x = this.desired.x; this.vel.z = this.desired.z; }
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.jumpT > 0) this.pos.y = Math.sin((this.jumpT / 0.45) * Math.PI) * 0.45;
    else if (this.celebrate) this.pos.y = Math.max(0, Math.sin(performance.now() * 0.009 + this.phase)) * 0.35;
    else this.pos.y = 0;
    this.pos.x = Math.max(-HALF_L - 4, Math.min(HALF_L + 4, this.pos.x));
    this.pos.z = Math.max(-HALF_W - 3, Math.min(HALF_W + 3, this.pos.z));

    const sp = this.speed();
    if (this.slideT <= 0 && this.stunT <= 0) {
      if (sp > 0.6) {
        const turn = (hasBall ? 5 + this.data.dribbling / 18 : 11) * (this.accelMul > 1 ? 1.4 : 1);
        this.facing = angleLerp(this.facing, Math.atan2(this.vel.x, this.vel.z), Math.min(1, turn * dt));
      } else if (this.lookAt) {
        const a = Math.atan2(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z);
        this.facing = angleLerp(this.facing, a, Math.min(1, 6 * dt));
      }
    }
    this.phase += (3 + sp * 0.85) * dt * (sp > 0.25 ? 1 : 0.15);
    if (this.phase > 6283) this.phase -= 6283.185;
    if (this.kickAnim >= 0) {
      this.kickAnim += dt / 0.32;
      if (this.kickAnim > 1) this.kickAnim = -1;
    }
  }

  writePose(out: Float32Array, o: number) {
    out[o] = this.pos.x;
    out[o + 1] = this.pos.y;
    out[o + 2] = this.pos.z;
    out[o + 3] = this.facing;
    out[o + 4] = this.phase;
    out[o + 5] = Math.min(1, this.speed() / 8.5);
    out[o + 6] = this.kickAnim;
    out[o + 7] = this.slideT > 0 ? 1 : 0;
    out[o + 8] = this.diveT > 0 ? 1 - this.diveT / this.diveDur : -1;
    out[o + 9] = this.diveSide;
    out[o + 10] = this.celebrate ? 1 : 0;
    out[o + 11] = this.fallen;
  }
}
