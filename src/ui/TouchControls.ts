/**
 * Сенсорное управление: виртуальный джойстик слева и кнопки справа.
 * Показывается только на сенсорных экранах. Работает через Pointer Events (мультитач).
 */
type Btn = 'shoot' | 'pass' | 'lob' | 'tackle' | 'sprint' | 'switch' | 'pause';

export interface TouchState {
  mx: number;
  my: number;
  sprint: boolean;
  shootHeld: boolean;
  shootReleased: boolean;
  shootPressed: boolean;
  pass: boolean;
  passHeld: boolean;
  lob: boolean;
  slide: boolean;
  switchP: boolean;
  pause: boolean;
  any: boolean;
}

const JOY_R = 56; // радиус хода джойстика в CSS-пикселях

export class TouchControls {
  el: HTMLElement;
  private zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private joyId: number | null = null;
  private joyCx = 0;
  private joyCy = 0;
  private mx = 0;
  private my = 0;
  private held = new Set<Btn>();
  private pressed = new Set<Btn>();
  private released = new Set<Btn>();

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="joy-zone"><div class="joy-base"><div class="joy-knob"></div></div></div>
      <button class="tbtn t-pause" data-b="pause" aria-label="Пауза">❚❚</button>
      <div class="tbtns">
        <button class="tbtn t-switch" data-b="switch">Смена</button>
        <button class="tbtn t-sprint" data-b="sprint">Спринт</button>
        <button class="tbtn t-tackle" data-b="tackle">Подкат</button>
        <button class="tbtn t-lob" data-b="lob">Навес</button>
        <button class="tbtn t-pass" data-b="pass">Пас</button>
        <button class="tbtn t-shoot" data-b="shoot">Удар</button>
      </div>`;
    root.appendChild(this.el);
    this.zone = this.el.querySelector('.joy-zone')!;
    this.base = this.el.querySelector('.joy-base')!;
    this.knob = this.el.querySelector('.joy-knob')!;

    this.zone.addEventListener('pointerdown', this.joyDown);
    this.zone.addEventListener('pointermove', this.joyMove);
    this.zone.addEventListener('pointerup', this.joyUp);
    this.zone.addEventListener('pointercancel', this.joyUp);
    this.zone.addEventListener('lostpointercapture', this.joyUp);

    this.el.querySelectorAll<HTMLElement>('.tbtn').forEach(b => {
      const name = b.dataset.b as Btn;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* нет активного указателя */ }
        if (!this.held.has(name)) this.pressed.add(name);
        this.held.add(name);
        b.classList.add('on');
        navigator.vibrate?.(8);
      };
      const up = (e: PointerEvent) => {
        e.preventDefault();
        if (this.held.has(name)) this.released.add(name);
        this.held.delete(name);
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
    this.el.addEventListener('contextmenu', e => e.preventDefault());
  }

  private joyDown = (e: PointerEvent) => {
    if (this.joyId !== null) return;
    e.preventDefault();
    this.joyId = e.pointerId;
    try { this.zone.setPointerCapture(e.pointerId); } catch { /* нет активного указателя */ }
    const r = this.zone.getBoundingClientRect();
    // база джойстика появляется под пальцем (но не ближе радиуса к краю)
    this.joyCx = Math.max(r.left + JOY_R + 10, Math.min(r.right - JOY_R - 10, e.clientX));
    this.joyCy = Math.max(r.top + JOY_R + 10, Math.min(r.bottom - JOY_R - 10, e.clientY));
    this.base.style.left = `${this.joyCx - r.left}px`;
    this.base.style.top = `${this.joyCy - r.top}px`;
    this.base.classList.add('active');
    this.anyTouch = true;
    this.joyMove(e);
  };

  private anyTouch = false;

  private joyMove = (e: PointerEvent) => {
    if (e.pointerId !== this.joyId) return;
    e.preventDefault();
    let dx = e.clientX - this.joyCx, dy = e.clientY - this.joyCy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx = (dx / d) * JOY_R; dy = (dy / d) * JOY_R; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / JOY_R);
    const dead = 0.15;
    if (m < dead) { this.mx = 0; this.my = 0; return; }
    const k = Math.min(1, (m - dead) / (1 - dead)) / (Math.min(d, JOY_R) || 1);
    this.mx = dx * k;
    this.my = -dy * k;
    const l = Math.hypot(this.mx, this.my);
    if (l > 1) { this.mx /= l; this.my /= l; }
  };

  private joyUp = (e: PointerEvent) => {
    if (e.pointerId !== this.joyId) return;
    this.joyId = null;
    this.mx = 0; this.my = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('active');
  };

  /** Снимок состояния за кадр (нажатия сбрасываются). */
  poll(): TouchState {
    const s: TouchState = {
      mx: this.mx,
      my: this.my,
      sprint: this.held.has('sprint'),
      shootHeld: this.held.has('shoot'),
      shootReleased: this.released.has('shoot'),
      shootPressed: this.pressed.has('shoot'),
      pass: this.pressed.has('pass'),
      passHeld: this.held.has('pass'),
      lob: this.pressed.has('lob'),
      slide: this.pressed.has('tackle'),
      switchP: this.pressed.has('switch'),
      pause: this.pressed.has('pause'),
      any: this.pressed.size > 0 || this.anyTouch,
    };
    this.pressed.clear();
    this.released.clear();
    this.anyTouch = false;
    return s;
  }

  private defending = false;
  /** В защите кнопки меняют смысл: «Удар» → «Отбор», «Пас» → «Прессинг». */
  setDefending(d: boolean) {
    if (d === this.defending) return;
    this.defending = d;
    const q = (c: string) => this.el.querySelector(c) as HTMLElement;
    q('.t-shoot').textContent = d ? 'Отбор' : 'Удар';
    q('.t-pass').textContent = d ? 'Прессинг' : 'Пас';
    q('.t-lob').classList.toggle('dim', d);
    this.el.classList.toggle('defending', d);
  }

  setVisible(v: boolean) { this.el.style.display = v ? '' : 'none'; }

  dispose() { this.el.remove(); }
}
