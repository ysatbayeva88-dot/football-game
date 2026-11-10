import type { TouchControls } from '../ui/TouchControls';

export interface InputFrame {
  mx: number; // вправо по экрану
  my: number; // вверх по экрану
  sprint: boolean;
  shootHeld: boolean;
  shootReleased: boolean;
  pass: boolean;
  lob: boolean;
  tackle: boolean;
  switchP: boolean;
  pause: boolean;
  skip: boolean;
  any: boolean;
}

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private padPrev: boolean[] = [];
  private padShootHeld = false;
  enabled = true;
  touch: TouchControls | null = null;
  usingPad = false;

  private onDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (PREVENT.has(e.code)) e.preventDefault();
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
    this.usingPad = false;
  };
  private onUp = (e: KeyboardEvent) => {
    if (this.keys.has(e.code)) this.released.add(e.code);
    this.keys.delete(e.code);
  };
  private onBlur = () => { this.keys.clear(); };

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private k(c: string) { return this.keys.has(c); }
  private p(c: string) { return this.pressed.has(c); }

  poll(): InputFrame {
    let mx = (this.k('KeyD') || this.k('ArrowRight') ? 1 : 0) - (this.k('KeyA') || this.k('ArrowLeft') ? 1 : 0);
    let my = (this.k('KeyW') || this.k('ArrowUp') ? 1 : 0) - (this.k('KeyS') || this.k('ArrowDown') ? 1 : 0);
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const f: InputFrame = {
      mx, my,
      sprint: this.k('ShiftLeft') || this.k('ShiftRight'),
      shootHeld: this.k('Space'),
      shootReleased: this.released.has('Space'),
      pass: this.p('KeyE'),
      lob: this.p('KeyQ'),
      tackle: this.p('KeyF'),
      switchP: this.p('Tab'),
      pause: this.p('Escape') || this.p('KeyP'),
      skip: this.p('Enter') || this.p('Space'),
      any: this.pressed.size > 0,
    };

    // геймпад (раскладка Xbox: A пас, B удар, X навес, Y подкат, LB смена, RT спринт)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const b = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
      const edge = (i: number) => b(i) && !this.padPrev[i];
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const mag = Math.hypot(ax, ay);
      if (mag > 0.22) {
        const m = Math.min(1, (mag - 0.22) / 0.7);
        f.mx = (ax / mag) * m; f.my = (-ay / mag) * m;
        this.usingPad = true;
      }
      if (b(12)) f.my = 1; if (b(13)) f.my = -1; if (b(14)) f.mx = -1; if (b(15)) f.mx = 1;
      if (b(7) || b(5)) f.sprint = true;
      if (edge(0)) f.pass = true;
      if (b(1)) f.shootHeld = true;
      if (!b(1) && this.padShootHeld) f.shootReleased = true;
      this.padShootHeld = b(1);
      if (edge(2)) f.lob = true;
      if (edge(3)) f.tackle = true;
      if (edge(4)) f.switchP = true;
      if (edge(9)) f.pause = true;
      if (edge(0) || edge(9) || edge(1)) f.skip = true;
      for (let i = 0; i < pad.buttons.length; i++) { if (edge(i)) { f.any = true; this.usingPad = true; } }
      this.padPrev = pad.buttons.map((_, i) => b(i));
      break;
    }

    // сенсорное управление
    if (this.touch) {
      const t = this.touch.poll();
      if (Math.hypot(t.mx, t.my) > 0.01) { f.mx = t.mx; f.my = t.my; }
      f.sprint ||= t.sprint;
      f.shootHeld ||= t.shootHeld;
      f.shootReleased ||= t.shootReleased;
      f.pass ||= t.pass;
      f.lob ||= t.lob;
      f.tackle ||= t.tackle;
      f.switchP ||= t.switchP;
      f.pause ||= t.pause;
      f.skip ||= t.pass || t.shootReleased || t.lob;
      f.any ||= t.any;
    }

    this.pressed.clear();
    this.released.clear();
    return f;
  }
}
