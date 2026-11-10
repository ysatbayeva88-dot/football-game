import * as THREE from 'three';
import { HALF_L, clamp } from './constants';

export type CamMode = 'broadcast' | 'replay' | 'celebrate' | 'intro';

export class CameraRig {
  cam: THREE.PerspectiveCamera;
  private look = new THREE.Vector3();
  private pos = new THREE.Vector3(0, 23, 46);
  mode: CamMode = 'intro';
  private t = 0;
  private replaySide = 1;
  shake = 0;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(38, aspect, 0.3, 5000);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(0, 0, 0);
  }

  setMode(m: CamMode, side = 1) {
    this.mode = m;
    this.t = 0;
    this.replaySide = side;
  }

  snap(focus: THREE.Vector3) {
    this.update(1, focus, true);
  }

  update(dt: number, focus: THREE.Vector3, snap = false) {
    this.t += dt;
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    let k = 1 - Math.exp(-3.2 * dt);
    switch (this.mode) {
      case 'broadcast': {
        const tx = clamp(focus.x, -HALF_L + 14, HALF_L - 14);
        const tz = clamp(focus.z * 0.5, -14, 10);
        desiredPos.set(tx * 0.88, 17, 35 + tz);
        desiredLook.set(tx, 0, tz - 2.5);
        break;
      }
      case 'intro': {
        const a = this.t * 0.12 - 0.5;
        desiredPos.set(Math.sin(a) * 75, 26 - Math.min(this.t, 4), Math.cos(a) * 60);
        desiredLook.set(0, 0, 0);
        k = 1 - Math.exp(-1.5 * dt);
        break;
      }
      case 'celebrate': {
        desiredPos.set(focus.x - Math.sign(focus.x || 1) * 9, 3.2, focus.z + (focus.z > 0 ? -6 : 9));
        desiredLook.set(focus.x, 1.2, focus.z);
        k = 1 - Math.exp(-2 * dt);
        break;
      }
      case 'replay': {
        const s = this.replaySide;
        const a = this.t * 0.18;
        desiredPos.set(s * (HALF_L - 14) + Math.sin(a) * 4, 3.5 + this.t * 0.25, 16 + Math.cos(a) * 3);
        desiredPos.lerp(new THREE.Vector3(focus.x - s * 10, 4, focus.z + 12), 0.45);
        desiredLook.copy(focus);
        k = 1 - Math.exp(-4 * dt);
        break;
      }
    }
    if (snap) { this.pos.copy(desiredPos); this.look.copy(desiredLook); }
    else { this.pos.lerp(desiredPos, k); this.look.lerp(desiredLook, Math.min(1, k * 1.3)); }
    this.cam.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.cam.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      this.cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
    }
    this.cam.lookAt(this.look);
  }
}
