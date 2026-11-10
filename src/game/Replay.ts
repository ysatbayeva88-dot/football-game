import { POSE_SIZE } from './PlayerModel';
import type { Match } from './Match';
import { angleLerp } from './constants';

const RATE = 30;
const CAP = RATE * 14;

/** Запись последних секунд матча и их воспроизведение (повтор гола). */
export class Replay {
  private frames: Float32Array[] = [];
  private times = new Float64Array(CAP);
  private head = 0;
  private count = 0;
  private acc = 0;
  private size: number;
  playing = false;
  cursor = 0;
  private t1 = 0;
  speed = 0.6;
  private out: Float32Array;

  constructor(private match: Match) {
    this.size = 3 + match.players.length * POSE_SIZE;
    for (let i = 0; i < CAP; i++) this.frames.push(new Float32Array(this.size));
    this.out = new Float32Array(this.size);
  }

  record(dt: number) {
    this.acc += dt;
    if (this.acc < 1 / RATE) return;
    this.acc = 0;
    const f = this.frames[this.head];
    const m = this.match;
    f[0] = m.ball.pos.x; f[1] = m.ball.pos.y; f[2] = m.ball.pos.z;
    m.players.forEach((p, i) => p.writePose(f, 3 + i * POSE_SIZE));
    this.times[this.head] = m.time;
    this.head = (this.head + 1) % CAP;
    this.count = Math.min(CAP, this.count + 1);
  }

  private idx(i: number) { return (this.head - this.count + i + CAP) % CAP; }

  start(t0: number, t1: number) {
    if (this.count < 2) return false;
    const first = this.times[this.idx(0)];
    this.cursor = Math.max(t0, first);
    this.t1 = Math.min(t1, this.times[this.idx(this.count - 1)]);
    this.playing = true;
    return true;
  }

  /** Возвращает интерполированный кадр или null, если повтор закончился. */
  update(dt: number): Float32Array | null {
    if (!this.playing) return null;
    this.cursor += dt * this.speed;
    if (this.cursor >= this.t1) { this.playing = false; return null; }
    // бинарный поиск
    let lo = 0, hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[this.idx(mid)] <= this.cursor) lo = mid; else hi = mid;
    }
    const ia = this.idx(lo), ib = this.idx(hi);
    const ta = this.times[ia], tb = this.times[ib];
    const t = tb > ta ? Math.min(1, Math.max(0, (this.cursor - ta) / (tb - ta))) : 0;
    const a = this.frames[ia], b = this.frames[ib], o = this.out;
    for (let i = 0; i < 3; i++) o[i] = a[i] + (b[i] - a[i]) * t;
    const n = this.match.players.length;
    for (let p = 0; p < n; p++) {
      const k = 3 + p * POSE_SIZE;
      o[k] = a[k] + (b[k] - a[k]) * t;
      o[k + 1] = a[k + 1] + (b[k + 1] - a[k + 1]) * t;
      o[k + 2] = a[k + 2] + (b[k + 2] - a[k + 2]) * t;
      o[k + 3] = angleLerp(a[k + 3], b[k + 3], t);
      o[k + 4] = Math.abs(b[k + 4] - a[k + 4]) < 3 ? a[k + 4] + (b[k + 4] - a[k + 4]) * t : b[k + 4];
      o[k + 5] = a[k + 5] + (b[k + 5] - a[k + 5]) * t;
      const near = t < 0.5 ? a : b;
      for (let j = 6; j < POSE_SIZE; j++) o[k + j] = near[k + j];
      if (a[k + 6] >= 0 && b[k + 6] >= 0) o[k + 6] = a[k + 6] + (b[k + 6] - a[k + 6]) * t;
      if (a[k + 8] >= 0 && b[k + 8] >= 0) o[k + 8] = a[k + 8] + (b[k + 8] - a[k + 8]) * t;
    }
    return o;
  }

  stop() { this.playing = false; }
}
