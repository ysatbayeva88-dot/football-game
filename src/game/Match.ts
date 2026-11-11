import * as THREE from 'three';
import { Ball, ROLL_K } from './Ball';
import {
  AI_ASSISTS, ALLY_AI, ASSISTS, BALL_R, CIRCLE_R, DIFFICULTIES, GOAL_HW, GRAVITY, HALF_L, HALF_W, KICKOFF_PARTNER, PEN_D, PEN_HW, PEN_SPOT,
  angleLerp, clamp, gauss, hashStr, rand,
} from './constants';
import { aiCarrier, aiGK, aiHold, aiOffBall, bestPass, computeContext, formationTarget, inOppBox, inOwnBox, interceptTime, laneOpen, newCtx } from './AI';
import type { TeamCtx } from './AI';
import type { InputFrame } from './Input';
import type { Player } from './Player';
import { Team } from './Team';
import type { GoalRecord, MatchConfig, MatchResult } from './types';

export type MatchState = 'setpiece' | 'play' | 'stoppage' | 'goal' | 'replay' | 'halftime' | 'fulltime';
export type SetPieceType = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'freekick' | 'penalty';

export interface SetPiece {
  type: SetPieceType;
  team: Team;
  pos: THREE.Vector3;
  taker: Player;
  aim: number;
  spots: Map<Player, THREE.Vector3>;
  botDelay: number;
}

export type MatchEvent =
  | { type: 'whistle'; kind: 'short' | 'long' | 'end' }
  | { type: 'kick'; power: number }
  | { type: 'goal'; team: number; scorer: string; own: boolean; minute: number }
  | { type: 'message'; text: string; sub?: string }
  | { type: 'post' }
  | { type: 'save'; name: string }
  | { type: 'excite'; v: number }
  | { type: 'halftime' }
  | { type: 'secondhalf' }
  | { type: 'fulltime' }
  | { type: 'replay'; t0: number; t1: number };

const HALF_SECONDS = 45 * 60;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function facingTo(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export class Match {
  ball = new Ball();
  teams: [Team, Team];
  players: Player[];
  ctx: TeamCtx[] = [newCtx(), newCtx()];
  ballPath = Array.from({ length: 30 }, () => new THREE.Vector3());
  state: MatchState = 'setpiece';
  stateT = 0;
  time = 0;
  clock = 0;
  half = 1;
  clockRate: number;
  firstKickoff = 0;
  setPiece: SetPiece | null = null;
  private stopDelay = 0;
  private nextSetPiece: (() => void) | null = null;
  controlled: Player;
  private lastSwitch = -9;
  shootPower = 0;
  charging = false;
  private pending: { type: 'shoot' | 'pass' | 'lob'; power: number; t: number; dir: THREE.Vector3 } | null = null;
  private lastInput: InputFrame | null = null;
  goals: GoalRecord[] = [];
  goalTime = 0;
  private lastPasser: Player | null = null;
  private shotPending: { team: Team; t: number } | null = null;
  private celebrant: Player | null = null;
  private scoringTeam: Team | null = null;
  private listeners: ((e: MatchEvent) => void)[] = [];
  difficulty: number;
  /** ИИ управляет и командой игрока (для тестов/демо). */
  autoplay = false;
  assist: (typeof ASSISTS)[keyof typeof ASSISTS];
  aiAssist: (typeof AI_ASSISTS)[keyof typeof AI_ASSISTS];
  /** Адресат паса, которого ИИ сейчас ведёт к мячу (ввод игрока игнорируется). */
  autoRecv: Player | null = null;
  private recvOverrideT = 0;
  private recvReleased: Player | null = null;
  private pokeT = 0;
  /** Сейчас игроком управляет ИИ-ассист (для HUD/тестов). */
  aiDriving = false;
  /** Партнёр, которому уйдёт пас при нажатии (для индикатора). */
  passPreview: Player | null = null;
  /** Игрок зажал «Прессинг» — партнёр тоже идёт в отбор. */
  humanPress = false;
  /** Когда команда последний раз потеряла мяч (для контрпрессинга). */
  lossTime = [-99, -99];
  private possTeam: Team | null = null;

  constructor(public cfg: MatchConfig) {
    this.difficulty = cfg.difficulty;
    this.assist = ASSISTS[cfg.assist ?? 'full'];
    this.aiAssist = AI_ASSISTS[cfg.aiAssist ?? 'full'];
    const home = new Team(0, cfg.home, cfg.homeKit, cfg.formation, 1, true, ALLY_AI);
    const away = new Team(1, cfg.away, cfg.awayKit, cfg.away.formation, -1, false, DIFFICULTIES[cfg.difficulty]);
    home.opp = away; away.opp = home;
    this.teams = [home, away];
    this.players = [...home.players, ...away.players];
    this.controlled = home.players[9];
    this.clockRate = HALF_SECONDS / (cfg.halfMinutes * 60);
    if (cfg.stadium === 'rain') { this.ball.friction = 1.7; this.ball.bounce = 0.45; }
  }

  on(fn: (e: MatchEvent) => void) { this.listeners.push(fn); }
  private emit(e: MatchEvent) { for (const l of this.listeners) l(e); }

  get minute() { return Math.min(90, Math.floor(this.clock / 60) + 1); }

  start() {
    this.firstKickoff = Math.random() < 0.5 ? 0 : 1;
    this.setupKickoff(this.firstKickoff);
    this.emit({ type: 'whistle', kind: 'long' });
  }

  result(): MatchResult {
    return {
      cfg: this.cfg,
      score: [this.teams[0].score, this.teams[1].score],
      stats: [this.teams[0].stats, this.teams[1].stats],
      goals: this.goals,
    };
  }

  // ───────────────────────── главный цикл ─────────────────────────
  update(dt: number, inp: InputFrame) {
    this.lastInput = inp;
    this.time += dt;
    this.stateT += dt;
    switch (this.state) {
      case 'setpiece':
        if (this.setPiece && this.setPiece.type !== 'kickoff') this.clock += dt * this.clockRate;
        this.updateSetPiece(dt, inp);
        break;
      case 'play':
        this.clock += dt * this.clockRate;
        this.updatePlay(dt, inp);
        this.checkHalfEnd();
        break;
      case 'stoppage':
        this.clock += dt * this.clockRate;
        this.updateIdle(dt, true);
        if (this.stateT > this.stopDelay) {
          const fn = this.nextSetPiece;
          this.nextSetPiece = null;
          if (!this.checkHalfEnd() && fn) fn();
        }
        break;
      case 'goal':
        this.updateGoal(dt);
        break;
      case 'replay':
        break;
      case 'halftime':
        this.updateIdle(dt, true);
        if (this.stateT > 4) this.startSecondHalf();
        break;
      case 'fulltime':
        this.updateIdle(dt, true);
        break;
    }
  }

  private checkHalfEnd() {
    const limit = this.half * HALF_SECONDS;
    if (this.clock < limit) return false;
    this.clock = limit;
    this.pending = null;
    this.charging = false;
    if (this.half === 1) {
      this.state = 'halftime';
      this.stateT = 0;
      this.emit({ type: 'whistle', kind: 'long' });
      this.emit({ type: 'halftime' });
    } else {
      this.state = 'fulltime';
      this.stateT = 0;
      this.emit({ type: 'whistle', kind: 'end' });
      this.emit({ type: 'fulltime' });
    }
    return true;
  }

  private startSecondHalf() {
    this.half = 2;
    for (const t of this.teams) t.dir = -t.dir;
    this.setupKickoff(1 - this.firstKickoff);
    this.emit({ type: 'whistle', kind: 'long' });
    this.emit({ type: 'secondhalf' });
  }

  private updatePlay(dt: number, inp: InputFrame) {
    for (const p of this.players) p.jockey = false;
    computeContext(this);
    if (!this.autoplay) this.updateHuman(dt, inp);
    for (const p of this.players) {
      if (p === this.controlled && !this.autoplay) continue;
      if (p.isGK) aiGK(this, p, dt);
      else if (this.ball.owner === p) aiCarrier(this, p, dt);
      else aiOffBall(this, p, dt);
    }
    // выпад при отборе: игрок сам тянется к мячу
    for (const p of this.players) {
      p.accelMul = p === this.controlled && !this.autoplay ? 1.2 : 1;
      if (p.tackleT > 0 && !p.busy && !p.tackleDone) {
        // выпад с автонаведением на мяч
        _w.subVectors(this.ball.pos, p.pos).setY(0);
        const d = _w.length();
        if (d > 0.05) p.desired.copy(_w.multiplyScalar(Math.min(p.sprintSpeed(), 7.5) / d));
        if (d < 1.1) { p.tackleDone = true; this.resolveTackle(p); p.vel.multiplyScalar(0.35); p.desired.set(0, 0, 0); }
        else if (p.tackleT <= 0.02) { p.tackleDone = true; p.stunT = 0.18; p.vel.multiplyScalar(0.4); }
      } else if (p.tackleT > 0 && p.tackleDone) p.desired.set(0, 0, 0);
    }
    this.stepPlayers(dt);
    this.slideChecks();
    if (!this.ball.owner) {
      const ev = this.ball.step(dt);
      if (ev === 'post') { this.emit({ type: 'post' }); this.emit({ type: 'excite', v: 0.7 }); }
    }
    this.checkPossession(dt);
    this.checkOut();
    if (this.ball.owner) this.ball.owner.team.stats.possession += dt;
  }

  private stepPlayers(dt: number) {
    for (const p of this.players) p.step(dt, this.ball.owner === p && !this.ball.heldByGK);
    // раздвигаем игроков
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.62 && d2 > 1e-6) {
          // плечом к плечу: сильный игрок отталкивает слабого
          const d = Math.sqrt(d2);
          const push = 0.79 - d;
          const nx = dx / d, nz = dz / d;
          const sa = a.data.physical + (a.busy ? -40 : 0), sb = b.data.physical + (b.busy ? -40 : 0);
          const wa = Math.max(0.15, Math.min(0.85, sb / Math.max(1, sa + sb)));
          a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa;
          b.pos.x += nx * push * (1 - wa); b.pos.z += nz * push * (1 - wa);
          if (a.team !== b.team) {
            const slow = (q: Player) => { q.vel.multiplyScalar(0.985); };
            if (sa < sb) slow(a); else slow(b);
          }
        }
      }
    }
  }

  private updateIdle(dt: number, ballFree: boolean) {
    for (const p of this.players) {
      p.desired.multiplyScalar(0.9);
      if (p.desired.lengthSq() < 0.5) p.desired.set(0, 0, 0);
      p.lookAt = this.ball.pos;
    }
    this.stepPlayers(dt);
    if (ballFree && !this.ball.owner) this.ball.step(dt);
    else if (this.ball.owner) this.holdBall(dt);
  }

  // ───────────────────────── управление игроком ─────────────────────────
  /** Команда игрока обороняется (мяч у соперника). */
  humanDefending() {
    const o = this.ball.owner;
    return !!o && o.team !== this.teams[0];
  }

  private pickDefender(team: Team, exclude: Player | null) {
    // ближайший к мячу, кто успевает на перехват: со стороны своих ворот — приоритет
    const ball = this.ball;
    const ref = ball.owner ? ball.owner.pos : ball.pos;
    let best: Player | null = null, bs = 1e9;
    for (const p of team.players) {
      if (p.isGK || p === exclude || p.busy) continue;
      let sc: number;
      if (ball.owner) {
        const goalSide = (p.pos.x - ref.x) * -team.dir > -0.5;
        sc = p.dist2D(ref) + (goalSide ? -1.5 : 3);
      } else sc = interceptTime(this, p) * 6;
      if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  }

  private updateHuman(dt: number, inp: InputFrame) {
    const team = this.teams[0];
    const ball = this.ball;
    const owner = ball.owner;
    const defending = !!owner && owner.team !== team;
    const AI = this.aiAssist;
    _v.set(inp.mx, 0, -inp.my);
    const mag = Math.min(1, _v.length());
    const stick = mag > 0.2;

    // ── автоприём паса: адресат под управлением ИИ до касания мяча
    const intended = ball.intended && ball.intended.team === team && !ball.intended.isGK && !owner ? ball.intended : null;
    if (intended && AI.autoReceive && this.recvReleased !== intended) {
      if (this.autoRecv !== intended) { this.autoRecv = intended; this.recvOverrideT = 0; }
    } else {
      this.autoRecv = null;
      if (!intended) this.recvReleased = null;
    }

    // ── выбор управляемого игрока
    if (owner && owner.team === team && !owner.isGK) {
      this.controlled = owner;
    } else if (this.autoRecv) {
      if (this.controlled !== this.autoRecv) { this.controlled = this.autoRecv; this.lastSwitch = this.time; }
    } else if (inp.switchP) {
      const cand = defending ? this.pickDefender(team, this.controlled)
        : team.players.filter(p => !p.isGK && p !== this.controlled).sort((a, b) => a.dist2D(ball.pos) - b.dist2D(ball.pos))[0];
      if (cand) { this.controlled = cand; this.lastSwitch = this.time; }
    } else if (this.controlled.isGK || this.time - this.lastSwitch > 0.5) {
      let cand: Player | null = null;
      if (intended) cand = intended;
      else if (defending || !owner) cand = this.pickDefender(team, null);
      if (cand && cand !== this.controlled && !this.controlled.busy && this.controlled.tackleT <= 0) {
        const ref = owner ? owner.pos : ball.pos;
        const better = !owner
          ? interceptTime(this, cand) + 0.35 < interceptTime(this, this.controlled)
          : cand.dist2D(ref) + 2.5 < this.controlled.dist2D(ref);
        if (this.controlled.isGK || cand === intended || better) {
          this.controlled = cand;
          this.lastSwitch = this.time;
        }
      }
    }

    const c = this.controlled;
    c.lookAt = ball.pos;
    this.humanPress = defending && (inp.press || AI.secondPress);
    this.aiDriving = false;
    if (!c.busy && c.tackleT <= 0) {
      const spd = inp.sprint ? c.sprintSpeed() : c.jogSpeed();
      const manual = () => {
        if (mag > 0.05) c.desired.copy(_v).normalize().multiplyScalar(spd * mag);
        else c.desired.set(0, 0, 0);
      };
      if (this.autoRecv === c) {
        // ИИ ведёт к точке встречи; управление вернётся после касания
        // или если стик долго (>0.3 с) сильно отклонён в другую сторону
        const cp = this.ctx[0].chasePoint;
        _w.subVectors(cp, c.pos).setY(0);
        const dl = _w.length() || 1;
        const against = mag > 0.6 && (_v.x * _w.x + _v.z * _w.z) / (dl * mag) < -0.2;
        this.recvOverrideT = against ? this.recvOverrideT + dt : Math.max(0, this.recvOverrideT - dt);
        if (this.recvOverrideT > 0.3) { this.recvReleased = c; this.autoRecv = null; manual(); }
        else { this.steer(c, cp, dl > 2.5, 0.12); this.aiDriving = true; }
      } else if (!owner && AI.autoChase && !stick && !(ball.intended && ball.intended.team === team)) {
        // свободный мяч или пас соперника: сам бежит на перехват
        const t = interceptTime(this, c, _w);
        if (t < 3) { this.steer(c, _w, true, 0.1); this.aiDriving = true; }
        else manual();
      } else if (defending && owner) {
        const d = c.dist2D(owner.pos);
        const auto = inp.contain || AI.defend === 'always' || (AI.defend === 'near' && d < 10);
        if (auto) {
          if (d > 3.2 && !inp.contain) {
            // сближение: бежит к точке между соперником и воротами
            _w.set(-team.dir * HALF_L - owner.pos.x, 0, -owner.pos.z).normalize();
            const tgt = owner.pos.clone().addScaledVector(owner.vel, 0.35).addScaledVector(_w, 1.4);
            this.steer(c, tgt, d > 5 || inp.sprint, 0.2);
          } else this.contain(c, owner);
          if (stick && !inp.contain) {
            // джойстик лишь корректирует
            c.desired.addScaledVector(_v.clone().normalize(), c.jogSpeed() * 0.5 * mag);
            const l = c.desired.length(), max = c.sprintSpeed();
            if (l > max) c.desired.multiplyScalar(max / l);
          }
          this.aiDriving = !stick;
          // автовыпад при плотном сопровождении спереди
          this.pokeT -= dt;
          if (AI.autoPoke && !stick && d < 1.6 && this.pokeT <= 0 && c.tackleCD <= 0) {
            this.pokeT = 0.7;
            const f = owner.forward(_w);
            const front = (f.x * (c.pos.x - owner.pos.x) + f.z * (c.pos.z - owner.pos.z)) / Math.max(0.1, d) > 0.2;
            if (front && Math.random() < [0.22, 0.12, 0.07][this.difficulty]) this.tryTackle(c);
          }
        } else manual();
      } else manual();
    }
    const dirHint = mag > 0.2 ? _v.clone().normalize() : null;
    this.passPreview = owner === c && dirHint ? this.chooseReceiver(c, dirHint, false) : null;

    if (inp.shootHeld && !defending) { this.shootPower = Math.min(1, this.shootPower + dt * 1.0); this.charging = true; }
    if (inp.shootReleased && this.charging) {
      const power = Math.max(0.2, this.shootPower);
      this.charging = false;
      this.shootPower = 0;
      if (owner === c) this.humanShoot(c, power, inp);
      else this.pending = { type: 'shoot', power, t: this.time, dir: dirHint ?? c.forward() };
    }
    if (inp.pass) {
      if (owner === c) this.humanPass(c, dirHint, false);
      else if (owner && owner.team === team && owner.isGK && ball.heldByGK) this.gkDistribute(owner, dirHint, false);
      else if (!owner) this.pending = { type: 'pass', power: 0, t: this.time, dir: dirHint ?? c.forward() };
    }
    if (inp.lob) {
      if (owner === c) this.humanPass(c, dirHint, true);
      else if (owner && owner.team === team && owner.isGK && ball.heldByGK) this.gkDistribute(owner, dirHint, true);
      else if (!owner) this.pending = { type: 'lob', power: 0, t: this.time, dir: dirHint ?? c.forward() };
    }
    if (inp.tackle && defending && owner && c.dist2D(ball.pos) <= 2.4) this.tryTackle(c);
    if (inp.slide && owner !== c) this.startSlide(c);
  }

  private steer(p: Player, target: THREE.Vector3, sprint: boolean, stopDist: number) {
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stopDist) { p.desired.set(0, 0, 0); return; }
    const sp = Math.min(sprint ? p.sprintSpeed() : p.jogSpeed(), d * 2.2);
    p.desired.set((dx / d) * sp, 0, (dz / d) * sp);
  }

  /**
   * Сопровождение (contain): держится между соперником и своими воротами на ~1.5 м,
   * лицом к нему, повторяет его движения и не пробегает мимо.
   */
  contain(c: Player, o: Player, gap = 1.5) {
    const team = c.team;
    _w.set(-team.dir * HALF_L - o.pos.x, 0, -o.pos.z).normalize();
    const tx = o.pos.x + o.vel.x * 0.25 + _w.x * gap, tz = o.pos.z + o.vel.z * 0.25 + _w.z * gap;
    const ex = tx - c.pos.x, ez = tz - c.pos.z;
    let vx = o.vel.x + ex * 3.2, vz = o.vel.z + ez * 3.2;
    // не подходить ближе 1 м спереди и не «проскакивать» за спину
    const toO = Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z);
    if (toO < 1.0) { vx -= ((o.pos.x - c.pos.x) / (toO || 1)) * 2; vz -= ((o.pos.z - c.pos.z) / (toO || 1)) * 2; }
    const l = Math.hypot(vx, vz), max = c.sprintSpeed();
    if (l > max) { vx *= max / l; vz *= max / l; }
    c.desired.set(vx, 0, vz);
    c.jockey = true;
    c.lookAt = o.pos;
  }

  /** Пас игрока с учётом уровня ассиста. */
  private humanPass(c: Player, dir: THREE.Vector3 | null, lob: boolean) {
    const A = this.assist;
    if (this.cfg.assist === 'manual') {
      // ручной: строго по направлению, сила — по ближайшему партнёру на этой линии
      const d = dir ?? c.forward();
      const r = this.chooseReceiver(c, d, lob);
      const dist = r ? c.dist2D(r.pos) : lob ? 25 : 15;
      this.passTo(c, null, d, lob, A.passErr, { power: dist });
      if (r) { this.controlled = r; this.lastSwitch = this.time; this.ball.intended = r; }
      return;
    }
    this.passTo(c, this.chooseReceiver(c, dir, lob), dir, lob, A.passErr);
  }

  private humanShoot(p: Player, power: number, inp: InputFrame | null) {
    const gx = p.team.dir * HALF_L;
    const wz = inp ? -inp.my : 0;
    const mode = this.cfg.assist ?? 'full';
    if (mode === 'manual') {
      // куда смотрит стик/игрок — туда и удар
      const d = inp && Math.hypot(inp.mx, inp.my) > 0.2 ? new THREE.Vector3(inp.mx, 0, -inp.my).normalize() : p.forward();
      const s = Math.abs(d.x) > 0.05 ? (gx - this.ball.pos.x) / d.x : -1;
      const tz = s > 0 ? clamp(this.ball.pos.z + d.z * s, -12, 12) : this.ball.pos.z;
      const ty = 0.3 + power * 1.7 + Math.max(0, power - 0.85) * 8;
      this.shootAt(p, new THREE.Vector3(gx, ty, tz), power, this.assist.shotErr);
      return;
    }
    const full = mode === 'full';
    const edge = full ? GOAL_HW - 0.5 : GOAL_HW - 0.25;
    const tz = Math.abs(wz) > 0.3 ? clamp(Math.sign(wz) * edge * Math.min(1, Math.abs(wz) * 1.2), -edge, edge) : -Math.sign(p.pos.z || 1) * (edge - 0.3);
    const ty = full ? Math.min(2.1, 0.35 + power * 1.6) : 0.3 + power * 1.7 + Math.max(0, power - 0.88) * 7;
    this.shootAt(p, new THREE.Vector3(gx, ty, tz), power, this.assist.shotErr);
  }

  // ───────────────────────── действия ─────────────────────────
  shootAt(p: Player, target: THREE.Vector3, power: number, errMul: number, header = false) {
    const ball = this.ball;
    const from = ball.pos;
    const dx = target.x - from.x, dz = target.z - from.z;
    const dist = Math.hypot(dx, dz);
    const acc = p.data.shooting / 100;
    let speed = (15 + power * 18) * (0.78 + 0.32 * acc);
    if (header) speed = 11 + power * 7;
    speed = Math.min(speed, 34);
    const t = (dist / speed) * (1 + 0.006 * dist);
    let vy = (target.y - from.y) / t + 0.5 * GRAVITY * t;
    vy = clamp(vy, -3, 11);
    const spread = ((1 - acc) * 0.12 + power * power * 0.03 + 0.012) * errMul;
    const ang = Math.atan2(dx, dz) + gauss() * spread;
    const vel = new THREE.Vector3(Math.sin(ang) * speed, vy + gauss() * spread * speed * 0.22, Math.cos(ang) * speed);
    const spin = gauss() * 1.5 * (1 - acc);
    ball.kick(vel, p, spin);
    ball.intended = null;
    ball.offsidePlayer = null;
    p.kickAnim = 0;
    p.kickType = header ? 0 : 1;
    p.kickCD = 0.35;
    this.lastPasser = null;
    const st = p.team.stats;
    st.shots++;
    const on = ball.willBeOnTarget(p.team.dir);
    if (on) st.onTarget++;
    this.shotPending = { team: p.team, t: this.time };
    this.pending = null;
    this.emit({ type: 'kick', power: 0.5 + power * 0.5 });
    this.emit({ type: 'excite', v: on ? 0.6 : 0.35 });
  }

  passTo(p: Player, receiver: Player | null, dirHint: THREE.Vector3 | null, lob: boolean, errMul: number, opts: { throwIn?: boolean; offside?: boolean; cross?: boolean; power?: number } = {}) {
    const ball = this.ball;
    const from = ball.pos.clone();
    const vel = new THREE.Vector3();
    const acc = p.data.passing / 100;
    let target: THREE.Vector3;
    let ang: number;
    const throwIn = !!opts.throwIn;

    if (receiver) {
      target = receiver.pos.clone();
      let d = Math.hypot(target.x - from.x, target.z - from.z);
      let tt: number;
      if (!lob && !throwIn) {
        // мяч приходит в ноги: стоящему — точно в него, бегущему — на ход
        const fast = (p.team.isHuman && !this.autoplay && this.cfg.assist === 'full') || (!p.team.isHuman && this.difficulty >= 1);
        const vend = fast ? Math.min(16, 11.5 + d * 0.15) : Math.min(13, 8 + d * 0.15);
        const aEff = ball.friction + ROLL_K * (vend + 12) * 0.5;
        let v0 = clamp(Math.sqrt(vend * vend + 2 * aEff * d), 7, 28);
        tt = (2 * d) / (v0 + vend);
        if (receiver.speed() > 2) target.addScaledVector(receiver.vel, tt * 0.85);
        clampInField(target);
        d = Math.hypot(target.x - from.x, target.z - from.z);
        v0 = clamp(Math.sqrt(vend * vend + 2 * aEff * d), 7, 28);
        ang = Math.atan2(target.x - from.x, target.z - from.z);
        vel.set(Math.sin(ang) * v0, 0.4, Math.cos(ang) * v0);
      } else {
        const ty = opts.cross || (lob && inOppBox(p.team, receiver.pos)) ? 1.5 : 0.3;
        const vhOf = (dd: number) => (throwIn ? clamp(7 + dd * 0.35, 8, 15) : clamp(8 + dd * 0.3, 10, 22));
        let vh = vhOf(d);
        tt = (d / vh) * (1 + 0.008 * d);
        target.addScaledVector(receiver.vel, tt * 0.7);
        clampInField(target);
        d = Math.hypot(target.x - from.x, target.z - from.z);
        vh = vhOf(d);
        tt = (d / vh) * (1 + 0.008 * d);
        const vy = clamp((ty - from.y) / tt + 0.5 * GRAVITY * tt, 1, 16);
        ang = Math.atan2(target.x - from.x, target.z - from.z);
        vel.set(Math.sin(ang) * vh, vy, Math.cos(ang) * vh);
      }
    } else {
      const dir = dirHint ? dirHint.clone() : p.forward();
      ang = Math.atan2(dir.x, dir.z);
      const dd = opts.power ?? (lob ? 25 : 15);
      if (lob || throwIn) {
        const vh = throwIn ? 12 : clamp(8 + dd * 0.3, 10, 22);
        const tt = dd / vh;
        vel.set(Math.sin(ang) * vh, throwIn ? 3 : clamp(0.5 * GRAVITY * tt, 3, 14), Math.cos(ang) * vh);
      } else {
        const vend = Math.min(13, 8 + dd * 0.15);
        const v0 = clamp(Math.sqrt(vend * vend + 2 * (ball.friction + ROLL_K * 10) * dd), 7, 28);
        vel.set(Math.sin(ang) * v0, 0.4, Math.cos(ang) * v0);
      }
    }
    // ошибка паса
    const err = gauss() * ((1 - acc) * 0.14 + 0.015) * errMul;
    const h = Math.hypot(vel.x, vel.z) * (1 + gauss() * 0.05 * errMul);
    const a2 = Math.atan2(vel.x, vel.z) + err;
    vel.x = Math.sin(a2) * h;
    vel.z = Math.cos(a2) * h;

    const offsideCheck = opts.offside !== false;
    const offPlayer = receiver && offsideCheck && this.isOffside(receiver) ? receiver : null;
    ball.kick(vel, p, 0);
    ball.intended = receiver;
    ball.offsidePlayer = offPlayer;
    this.passSeq++;
    p.kickAnim = 0;
    p.kickType = lob ? 1 : 0;
    p.kickCD = 0.3;
    this.lastPasser = p;
    this.shotPending = null;
    this.pending = null;
    p.team.stats.passes++;
    if (receiver && p.team.isHuman && !receiver.isGK) { this.controlled = receiver; this.lastSwitch = this.time; }
    this.emit({ type: 'kick', power: lob ? 0.55 : 0.32 });
  }

  /**
   * Ассистированный выбор адресата паса: партнёр в конусе ~45° по направлению,
   * с учётом расстояния и открытости линии. Без направления — ближайший открытый впереди.
   */
  chooseReceiver(p: Player, dir: THREE.Vector3 | null, lob: boolean): Player | null {
    const maxD = lob ? 60 : 45;
    const team = p.team;
    const cone = p.team.isHuman ? this.assist.cone : 0.8;
    const safe = team.isHuman && !this.autoplay && this.cfg.assist === 'full' && (this.cfg.aiAssist ?? 'full') === 'full';
    const laneMin = safe ? 1.1 : 0.6, oppMin = safe ? 2.0 : 1.4;
    const pass = (maxAng: number, needOpen: boolean) => {
      let best: Player | null = null, bs = -1e9;
      for (const t of team.players) {
        if (t === p || t.busy) continue;
        const vx = t.pos.x - p.pos.x, vz = t.pos.z - p.pos.z;
        const d = Math.hypot(vx, vz);
        if (d < 3 || d > maxD) continue;
        const lane = lob ? 3 : laneOpen(team, p.pos, t.pos, 18);
        if (needOpen && lane < laneMin) continue;
        let score: number;
        if (dir) {
          const ang = Math.acos(clamp((vx * dir.x + vz * dir.z) / d, -1, 1));
          if (ang > maxAng) continue;
          score = -ang * 9 - Math.abs(d - (lob ? 26 : 14)) * 0.1 + Math.min(lane, 4) * 1.4;
        } else {
          const prog = (t.pos.x - p.pos.x) * team.dir;
          score = -d * 0.18 + Math.min(lane, 4) * 1.4 + (prog > -2 ? 3 : 0) + Math.min(prog, 15) * 0.08;
        }
        if (t.isGK) score -= 10;
        const opp = this.nearestOppDist(t);
        if (needOpen && opp < oppMin) continue;
        score += Math.min(opp, 6) * 0.6;
        if (score > bs) { bs = score; best = t; }
      }
      return best;
    };
    const full = team.isHuman && this.cfg.assist === 'full' && !this.autoplay;
    if (dir) {
      // полный ассист предпочитает открытого партнёра чуть шире конуса, чем закрытого точно по направлению
      if (full) return pass(cone, true) ?? pass(1.25, true) ?? pass(cone, false) ?? pass(Math.PI, true);
      return pass(cone, true) ?? pass(cone, false) ?? pass(Math.max(cone, 1.3), true) ?? pass(Math.PI, true);
    }
    return pass(Math.PI, true) ?? pass(Math.PI, false);
  }

  private nearestOppDist(t: Player) {
    let bd = 99;
    for (const o of t.team.opp.players) bd = Math.min(bd, o.dist2D(t.pos));
    return bd;
  }

  isOffside(r: Player) {
    const t = r.team;
    const rx = r.pos.x * t.dir;
    if (rx <= 0) return false;
    if (rx <= this.ball.pos.x * t.dir) return false;
    const xs = t.opp.players.map(o => o.pos.x * t.dir).sort((a, b) => b - a);
    return rx > (xs[1] ?? 0) + 0.3;
  }

  /** Обычный отбор: игрок делает выпад к мячу (без падения), исход — при касании. */
  tryTackle(p: Player) {
    const ball = this.ball;
    const c = ball.owner;
    if (!c || c.team === p.team || ball.heldByGK || this.state !== 'play' || p.busy || p.tackleT > 0 || p.tackleCD > 0) return;
    p.tackleCD = p === this.controlled ? 0.55 : p.team.ai.tackleCD;
    p.kickAnim = 0;
    p.kickType = 2;
    if (p.dist2D(ball.pos) > 2.6) return; // слишком далеко — только замах
    p.tackleT = 0.32;
    p.tackleDone = false;
  }

  /** Последний исход отбора — для статистики/тестов. */
  lastTackle: { angle: 'front' | 'side' | 'behind'; won: boolean; foul: boolean; human: boolean } | null = null;

  private resolveTackle(p: Player) {
    const ball = this.ball;
    const c = ball.owner;
    if (!c || c.team === p.team || ball.heldByGK) return;
    const d = Math.max(0.01, p.dist2D(c.pos));
    const rx = (p.pos.x - c.pos.x) / d, rz = (p.pos.z - c.pos.z) / d;
    const f = c.forward(_w);
    const dot = f.x * rx + f.z * rz;
    const angle = dot > 0.3 ? 'front' : dot > -0.45 ? 'side' : 'behind';
    const sprinting = c.speed() > c.jogSpeed() * 1.08;
    let prob = (angle === 'front' ? 0.66 : angle === 'side' ? 0.52 : 0.2) + ((p.data.defending - c.data.dribbling) / 100) * 0.8 + (sprinting ? 0.08 : 0);
    if (p.team.isHuman && p === this.controlled) prob += this.assist.tackleBonus - (this.difficulty - 1) * 0.05;
    else if (!p.team.isHuman) prob += p.team.ai.tackleBonus;
    if (p.data.physical > c.data.physical) prob += 0.04;
    prob = clamp(prob, 0.12, 0.92);
    p.tackleT = 0;
    const human = p.team.isHuman && p === this.controlled;
    if (angle === 'behind' && Math.random() < 0.6) {
      this.lastTackle = { angle, won: false, foul: true, human };
      c.stunT = 0.6; c.fallen = 2;
      this.foul(p, c, true);
      return;
    }
    if (Math.random() < prob) {
      this.lastTackle = { angle, won: true, foul: false, human };
      c.stunT = 0.2;
      if (Math.random() < 0.65) this.setOwner(p);
      else {
        const fw = p.forward();
        ball.kick(new THREE.Vector3(fw.x * 3.5 + rand(-1.5, 1.5), 0.2, fw.z * 3.5 + rand(-1.5, 1.5)), p);
        p.kickCD = 0.12;
      }
      this.emit({ type: 'kick', power: 0.2 });
    } else {
      this.lastTackle = { angle, won: false, foul: false, human };
      p.stunT = 0.2; // промах — короткая заминка, без падения
      if (Math.random() < 0.03) this.foul(p, c, false);
    }
  }

  /** Подкат: сам доворачивает в сторону мяча, скольжение ~3 м, затем вставание. */
  startSlide(p: Player) {
    if (p.busy || this.ball.owner === p || this.state !== 'play') return;
    const ball = this.ball;
    const f = p.forward();
    const aim = ball.pos.clone().addScaledVector(ball.vel, 0.22).sub(p.pos).setY(0);
    const d = aim.length();
    const maxTurn = p.team.isHuman && p === this.controlled ? (this.cfg.assist === 'manual' ? 0.4 : 1.9) : 1.4;
    if (d > 0.1 && d < 5.5) {
      aim.multiplyScalar(1 / d);
      const ang = Math.acos(clamp(aim.x * f.x + aim.z * f.z, -1, 1));
      if (ang < maxTurn) f.copy(aim);
    }
    p.facing = Math.atan2(f.x, f.z);
    p.slideT = 0.55;
    p.slideWon = false;
    const sp = Math.max(p.speed() * 0.4, 0) + 7.5;
    p.vel.set(f.x * sp, 0, f.z * sp);
    p.kickAnim = -1;
    p.tackleT = 0;
  }

  private slideChecks() {
    const ball = this.ball;
    for (const p of this.players) {
      if (p.slideT <= 0 || p.slideWon) continue;
      const f = p.forward(_w);
      const fx = p.pos.x + f.x * 0.75, fz = p.pos.z + f.z * 0.75;
      const c = ball.owner;
      if (ball.heldByGK) continue;
      if (ball.pos.y < 0.7 && Math.hypot(ball.pos.x - fx, ball.pos.z - fz) < 0.95 && (!c || c.team !== p.team)) {
        // чисто сыграл в мяч
        if (c) { c.stunT = 0.45; c.fallen = 2; }
        ball.owner = null;
        ball.kick(new THREE.Vector3(p.vel.x * 0.85 + rand(-2, 2), 0.4, p.vel.z * 0.85 + rand(-2, 2)), p);
        ball.intended = null;
        p.slideWon = true;
        p.kickCD = 0.2;
        this.emit({ type: 'kick', power: 0.35 });
      } else if (c && c.team !== p.team && p.dist2D(c.pos) < 0.9) {
        // попал по ногам, не задев мяч — фол
        p.slideWon = true;
        c.stunT = 1.0;
        c.fallen = 2;
        if (Math.random() < 0.9) this.foul(p, c, true);
        else {
          ball.owner = null;
          ball.kick(new THREE.Vector3(rand(-3, 3), 0.3, rand(-3, 3)), p);
        }
      }
    }
  }

  private foul(off: Player, victim: Player, hard: boolean) {
    if (this.state !== 'play') return;
    off.team.stats.fouls++;
    const spot = victim.pos.clone();
    spot.x = clamp(spot.x, -HALF_L + 1, HALF_L - 1);
    spot.z = clamp(spot.z, -HALF_W + 1, HALF_W - 1);
    spot.y = 0;
    const t = victim.team;
    const pen = inOppBox(t, spot);
    this.emit({ type: 'whistle', kind: 'short' });
    const card = Math.random() < (hard ? 0.35 : 0.1);
    this.emit({ type: 'message', text: pen ? 'ПЕНАЛЬТИ!' : 'ФОЛ', sub: card ? `Жёлтая карточка — ${off.data.name}` : `Нарушил ${off.data.name}` });
    if (pen) this.emit({ type: 'excite', v: 0.8 });
    this.stoppage(1.5, () => this.setupSetPiece(pen ? 'penalty' : 'freekick', t, spot));
  }

  private offside(p: Player) {
    p.team.stats.offsides++;
    this.emit({ type: 'whistle', kind: 'short' });
    this.emit({ type: 'message', text: 'ОФСАЙД', sub: p.data.name });
    const spot = p.pos.clone();
    spot.x = clamp(spot.x, -HALF_L + 1, HALF_L - 1);
    spot.z = clamp(spot.z, -HALF_W + 1, HALF_W - 1);
    this.ball.owner = null;
    this.ball.intended = null;
    this.ball.offsidePlayer = null;
    this.stoppage(1.3, () => this.setupSetPiece('freekick', p.team.opp, spot));
  }

  private stoppage(delay: number, fn: () => void) {
    this.state = 'stoppage';
    this.stateT = 0;
    this.stopDelay = delay;
    this.nextSetPiece = fn;
    this.ball.intended = null;
    this.pending = null;
    this.charging = false;
    this.shootPower = 0;
  }

  gkDistribute(gk: Player, dir: THREE.Vector3 | null, long: boolean) {
    const ball = this.ball;
    ball.heldByGK = false;
    gk.holdT = 0;
    // вброс рукой ближнему партнёру или выбивание далеко
    if (dir) {
      const r = this.chooseReceiver(gk, dir, long);
      const far = !!r && gk.dist2D(r.pos) > 30;
      if (r && !long && !far) this.passTo(gk, r, dir, true, 0.5, { throwIn: true, offside: false });
      else this.passTo(gk, r, dir, true, 1);
      return;
    }
    if (long) {
      const far = gk.team.players.filter(p => p.slot.role !== 'DEF' && !p.isGK);
      const r = far[Math.floor(Math.random() * far.length)];
      this.passTo(gk, r, null, true, 1);
    } else {
      const bp = bestPass(this, gk, 2);
      if (bp && gk.dist2D(bp.to.pos) < 30) this.passTo(gk, bp.to, null, true, 0.5, { throwIn: true, offside: false });
      else if (bp) this.passTo(gk, bp.to, null, true, 1);
      else this.passTo(gk, null, gk.team.toWorld(1, 0).normalize(), true, 1);
    }
  }

  // ───────────────────────── владение мячом ─────────────────────────
  private setOwner(p: Player) {
    const ball = this.ball;
    if (ball.offsidePlayer === p && this.state === 'play') { this.offside(p); return; }
    ball.offsidePlayer = null;
    if (this.possTeam && this.possTeam !== p.team) this.lossTime[this.possTeam.idx] = this.time;
    this.possTeam = p.team;
    ball.owner = p;
    ball.lastTouch = p;
    ball.intended = null;
    ball.spin = 0;
    ball.heldByGK = false;
    if (this.lastPasser && this.lastPasser.team === p.team && this.lastPasser !== p) p.team.stats.passesDone++;
    this.lastPasser = null;
    this.shotPending = null;
    p.aiTimer = p.team.ai.react * rand(0.8, 1.5);
    if (p.team.isHuman && !p.isGK) this.controlled = p;
    const pa = this.pending;
    if (p === this.controlled && pa && this.time - pa.t < 0.6) {
      this.pending = null;
      if (pa.type === 'shoot') this.humanShoot(p, pa.power, this.lastInput);
      else this.passTo(p, this.chooseReceiver(p, pa.dir, pa.type === 'lob'), pa.dir, pa.type === 'lob', 1);
    }
  }

  private gkSave(gk: Player, diving: boolean) {
    const ball = this.ball;
    const skill = (gk.data.defending + (gk.team.isHuman ? 0 : gk.team.ai.gkSkill * 100)) / 100;
    const sp = ball.speed;
    const wasShot = !!this.shotPending && this.shotPending.team !== gk.team;
    const catchProb = sp < 11 ? 0.97 : clamp(skill * 1.15 - (sp - 11) / 40 - (diving ? 0.12 : 0), 0.15, 0.95);
    if (Math.random() < catchProb) {
      ball.owner = gk;
      ball.heldByGK = true;
      ball.vel.set(0, 0, 0);
      ball.lastTouch = gk;
      ball.intended = null;
      ball.offsidePlayer = null;
      gk.holdT = 0;
      this.lastPasser = null;
    } else {
      const sz = Math.sign(ball.pos.z - gk.pos.z) || 1;
      if (Math.random() < 0.4) {
        // переводит мяч на угловой
        ball.kick(new THREE.Vector3(-gk.team.dir * sp * 0.22, 2.5 + Math.random() * 3, sz * sp * 0.35), gk);
      } else ball.kick(new THREE.Vector3(gk.team.dir * sp * 0.3, 2 + Math.random() * 3, sz * sp * 0.25), gk);
      gk.kickCD = 0.6;
    }
    if (wasShot) {
      gk.team.stats.saves++;
      this.emit({ type: 'save', name: gk.data.name });
      this.emit({ type: 'excite', v: 0.55 });
    }
    this.shotPending = null;
  }

  private doHeader(p: Player) {
    const ball = this.ball;
    if (ball.offsidePlayer === p) { this.offside(p); return; }
    ball.offsidePlayer = null;
    p.jumpT = 0.45;
    p.kickCD = 0.4;
    const gx = p.team.dir * HALF_L;
    const dG = Math.hypot(gx - p.pos.x, p.pos.z);
    const pa = p === this.controlled && this.pending && this.time - this.pending.t < 0.7 ? this.pending : null;
    const ai = p !== this.controlled;
    if ((pa && pa.type === 'shoot') || (ai && dG < 16 && Math.random() < 0.75) || (!pa && !ai && dG < 12)) {
      this.shootAt(p, new THREE.Vector3(gx, rand(0.3, 2.2), rand(-3, 3)), 0.55, 1.4, true);
    } else if (p.pos.x * p.team.dir < -HALF_L + 25) {
      const v = new THREE.Vector3(p.team.dir, 0, Math.sign(p.pos.z || 1) * 0.6 + rand(-0.4, 0.4)).normalize().multiplyScalar(14);
      v.y = 7;
      ball.kick(v, p);
      ball.intended = null;
    } else {
      const dir = pa ? pa.dir : p.forward();
      const r = this.chooseReceiver(p, dir, false);
      if (r) { _v.subVectors(r.pos, p.pos).setY(0).normalize(); } else _v.copy(dir);
      ball.kick(new THREE.Vector3(_v.x * 9, 2.5, _v.z * 9), p);
      ball.intended = r;
      this.lastPasser = p;
    }
    this.pending = null;
    this.emit({ type: 'kick', power: 0.4 });
  }

  private holdBall(dt: number) {
    const ball = this.ball;
    const o = ball.owner!;
    const f = o.forward(_w);
    if (ball.heldByGK) {
      ball.pos.set(o.pos.x + f.x * 0.35, o.pos.y + 1.1, o.pos.z + f.z * 0.35);
      ball.vel.set(0, 0, 0);
      return;
    }
    const sp = o.speed();
    const sprinting = sp > o.jogSpeed() * o.ballMul() * 1.06;
    // обычный дриблинг — мяч у ног; на спринте игрок отпускает мяч дальше (накат)
    const touch = sprinting
      ? 0.65 + 0.55 * Math.max(0, Math.sin(o.phase * 0.5)) * (1.3 - o.data.dribbling / 100)
      : 0.3 + sp * 0.022 * (1.25 - o.data.dribbling / 100);
    const tx = o.pos.x + f.x * touch, tz = o.pos.z + f.z * touch;
    const k = 1 - Math.exp(-(sprinting ? 14 : 28) * dt);
    const nx = ball.pos.x + (tx - ball.pos.x) * k;
    const nz = ball.pos.z + (tz - ball.pos.z) * k;
    ball.vel.set((nx - ball.pos.x) / Math.max(dt, 1e-4), 0, (nz - ball.pos.z) / Math.max(dt, 1e-4));
    ball.pos.set(nx, BALL_R, nz);
  }

  private checkPossession(dt: number) {
    const ball = this.ball;
    if (ball.owner) {
      if (ball.owner.busy && !ball.heldByGK) {
        // владелец упал — мяч свободен
        ball.owner = null;
      } else { this.holdBall(dt); return; }
    }
    // «магнит» приёма: адресат паса принимает мяч мягко, мяч не проскакивает мимо
    const r = ball.intended;
    if (r && !r.busy && r.kickCD <= 0 && r.team === ball.lastTouch?.team && ball.pos.y < 1.7) {
      const R = this.magnetFor(r);
      const dSeg = segDist2D(ball.prev, ball.pos, r.pos);
      if (dSeg < R) {
        if (ball.offsidePlayer === r) { this.offside(r); return; }
        ball.pos.set(r.pos.x + (ball.pos.x - r.pos.x) * 0.5, BALL_R, r.pos.z + (ball.pos.z - r.pos.z) * 0.5);
        ball.vel.multiplyScalar(0.15);
        this.setOwner(r);
        return;
      }
    }
    let best: Player | null = null, bd = 9, header = false;
    for (const p of this.players) {
      if (p.kickCD > 0 || p.stunT > 0 || p.slideT > 0) continue;
      if (p.diveT > 0) {
        const skill = p.data.defending / 100;
        const d3 = Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - (p.pos.y + 0.7), ball.pos.z - p.pos.z);
        if (d3 < 0.95 + skill * 0.3) { this.gkSave(p, true); return; }
        continue;
      }
      const d = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      if (p.isGK && inOwnBox(p.team, p.pos, 0.5) && ball.pos.y < 2.5 && d < 1.0 && ball.lastTouch?.team !== p.team) {
        this.gkSave(p, false);
        return;
      }
      if (d < 0.85 && ball.pos.y < 0.95) {
        if (this.passSlipsBy(p)) continue;
        if (d < bd) { bd = d; best = p; header = false; }
      } else if (d < 0.9 && ball.pos.y >= 0.95 && ball.pos.y < 2.4 && !p.isGK) {
        if (d < bd) { bd = d; best = p; header = true; }
      }
    }
    if (!best) return;
    if (header) { this.doHeader(best); return; }
    const rel = Math.hypot(ball.vel.x - best.vel.x, ball.vel.z - best.vel.z);
    if (best !== ball.intended && rel > 17 && Math.random() > 0.45 + best.data.dribbling / 220) {
      ball.vel.multiplyScalar(-0.3);
      ball.vel.x += rand(-2, 2); ball.vel.z += rand(-2, 2);
      ball.lastTouch = best;
      ball.intended = null;
      best.kickCD = 0.25;
      this.emit({ type: 'kick', power: 0.25 });
      return;
    }
    this.setOwner(best);
  }

  private passRoll = new Map<Player, number>();
  private passSeq = 0;
  /**
   * Полный ассист: быстрый пас игрока проходит мимо защитника, оказавшегося у мяча,
   * с шансом 70% (один бросок на защитника за пас) — как «проникающий» пас в FC.
   */
  private passSlipsBy(p: Player) {
    const ball = this.ball, r = ball.intended;
    if (!r || r.team === p.team || !r.team.isHuman || this.autoplay) return false;
    if (this.cfg.assist !== 'full' || (this.cfg.aiAssist ?? 'full') !== 'full' || ball.speed < 11) return false;
    const seen = this.passRoll.get(p);
    if (seen === this.passSeq) return true; // уже пропустил этот пас
    if (seen === -this.passSeq - 1) return false;
    const slip = Math.random() < 0.7;
    this.passRoll.set(p, slip ? this.passSeq : -this.passSeq - 1);
    return slip;
  }

  private magnetFor(p: Player) {
    if (p.team.isHuman && !this.autoplay) return Math.max(this.assist.magnet, this.aiAssist.magnet);
    return p.team.isHuman ? 1.4 : [1.0, 1.25, 1.45][this.difficulty];
  }

  private checkOut() {
    if (this.state !== 'play') return;
    const b = this.ball.pos;
    const lt = this.ball.lastTouch?.team ?? this.teams[0];
    if (this.ball.inGoalSide !== 0 && Math.abs(b.x) > HALF_L + BALL_R) {
      this.goal(this.ball.inGoalSide);
      return;
    }
    if (Math.abs(b.z) > HALF_W + BALL_R) {
      const pos = new THREE.Vector3(clamp(b.x, -HALF_L + 1, HALF_L - 1), 0, Math.sign(b.z) * HALF_W);
      this.emit({ type: 'whistle', kind: 'short' });
      this.emit({ type: 'message', text: 'АУТ' });
      const t = lt.opp;
      this.stoppage(1.2, () => this.setupSetPiece('throw', t, pos));
      return;
    }
    if (Math.abs(b.x) > HALF_L + BALL_R) {
      const s = Math.sign(b.x);
      const defending = this.teams.find(t => t.dir === -s)!;
      const attacking = defending.opp;
      if (this.shotPending) this.emit({ type: 'excite', v: 0.45 });
      this.emit({ type: 'whistle', kind: 'short' });
      if (lt === defending) {
        attacking.stats.corners++;
        const pos = new THREE.Vector3(s * HALF_L, 0, Math.sign(b.z || 1) * HALF_W);
        this.emit({ type: 'message', text: 'УГЛОВОЙ' });
        this.stoppage(1.4, () => this.setupSetPiece('corner', attacking, pos));
      } else {
        const pos = new THREE.Vector3(s * (HALF_L - 5.5), 0, Math.sign(b.z || 1) * 4);
        this.emit({ type: 'message', text: 'УДАР ОТ ВОРОТ' });
        this.stoppage(1.4, () => this.setupSetPiece('goalkick', defending, pos));
      }
    }
  }

  // ───────────────────────── голы ─────────────────────────
  private goal(side: number) {
    const team = this.teams.find(t => t.dir === side)!;
    const scorer = this.ball.lastTouch;
    const own = !!scorer && scorer.team !== team;
    team.score++;
    const penalty = this.lastSetPieceType === 'penalty' && this.time - this.lastSetPieceTime < 4;
    const name = scorer ? scorer.data.name : team.players[9].data.name;
    this.goals.push({ team: team.idx, name, minute: this.minute, own, penalty });
    this.state = 'goal';
    this.stateT = 0;
    this.goalTime = this.time;
    this.scoringTeam = team;
    this.celebrant = scorer && !own ? scorer : team.players[9];
    this.celebrant.celebrate = true;
    this.celebrant.celebrateType = 1 + (hashStr(this.celebrant.data.name) % 3);
    this.ball.owner = null;
    this.pending = null;
    this.charging = false;
    this.shootPower = 0;
    this.emit({ type: 'goal', team: team.idx, scorer: name, own, minute: this.minute });
  }

  private updateGoal(dt: number) {
    const cel = this.celebrant!;
    const team = this.scoringTeam!;
    const corner = new THREE.Vector3(team.dir * (HALF_L - 3), 0, Math.sign(cel.pos.z || 1) * (HALF_W - 3));
    for (const p of this.players) {
      p.lookAt = cel.pos;
      if (p.busy) continue;
      if (p === cel) {
        _v.subVectors(corner, p.pos).setY(0);
        const d = _v.length();
        if (d > 1) p.desired.copy(_v.normalize().multiplyScalar(Math.min(p.sprintSpeed() * 0.85, d)));
        else p.desired.set(0, 0, 0);
      } else if (p.team === team && !p.isGK) {
        _v.subVectors(cel.pos, p.pos).setY(0);
        const d = _v.length();
        if (d > 2.2) p.desired.copy(_v.normalize().multiplyScalar(Math.min(p.sprintSpeed() * 0.8, d)));
        else p.desired.set(0, 0, 0);
      } else {
        p.desired.multiplyScalar(0.92);
      }
    }
    this.stepPlayers(dt);
    if (!this.ball.owner) this.ball.step(dt);
    if (this.stateT > 3.3) {
      this.state = 'replay';
      this.stateT = 0;
      this.emit({ type: 'replay', t0: this.goalTime - 5.5, t1: this.goalTime + 1.3 });
    }
  }

  afterReplay() {
    for (const p of this.players) p.celebrate = false;
    const conceding = this.scoringTeam ? this.scoringTeam.opp.idx : 0;
    this.scoringTeam = null;
    this.celebrant = null;
    this.setupKickoff(conceding);
    this.emit({ type: 'whistle', kind: 'short' });
  }

  // ───────────────────────── стандарты ─────────────────────────
  private lastSetPieceType: SetPieceType | null = null;
  private lastSetPieceTime = -99;

  private resetPlayer(p: Player, pos: THREE.Vector3, facing: number) {
    p.pos.set(pos.x, 0, pos.z);
    p.vel.set(0, 0, 0);
    p.desired.set(0, 0, 0);
    p.facing = facing;
    p.stunT = 0; p.slideT = 0; p.diveT = 0; p.fallen = 0; p.kickAnim = -1; p.jumpT = 0;
    p.celebrate = false;
    p.runTarget = null;
    p.holdT = 0;
    p.kickCD = 0;
  }

  setupKickoff(teamIdx: number) {
    const kt = this.teams[teamIdx];
    const center = new THREE.Vector3(0, 0, 0);
    const spots = new Map<Player, THREE.Vector3>();
    for (const t of this.teams) {
      for (const p of t.players) {
        const v = formationTarget(t, p.slotIndex, false, center, new THREE.Vector3());
        if (p.isGK) t.toWorld(-HALF_L + 1.5, 0, v);
        const tx = v.x * t.dir;
        if (tx > -1.2) v.x = -1.2 * t.dir;
        if (t !== kt && v.length() < CIRCLE_R + 0.8) v.setLength(CIRCLE_R + 0.8);
        spots.set(p, v);
      }
    }
    const taker = kt.players[9];
    const partner = kt.players[KICKOFF_PARTNER[kt.formation]];
    spots.set(taker, kt.toWorld(-0.35, 0.25));
    spots.set(partner, kt.toWorld(-6, 4));
    this.ball.place(0, 0);
    this.ball.lastTouch = null;
    const sp: SetPiece = { type: 'kickoff', team: kt, pos: center, taker, aim: facingTo(spots.get(taker)!, spots.get(partner)!), spots, botDelay: rand(1.0, 1.8) };
    for (const p of this.players) {
      const s = spots.get(p)!;
      this.resetPlayer(p, s, t2f(p.team.dir));
    }
    taker.facing = sp.aim;
    this.beginSetPiece(sp);
  }

  private setupSetPiece(type: SetPieceType, team: Team, pos: THREE.Vector3) {
    const opp = team.opp;
    const dir = team.dir;
    const spots = new Map<Player, THREE.Vector3>();
    const ballPos = pos.clone();
    if (type === 'penalty') ballPos.copy(team.toWorld(HALF_L - PEN_SPOT, 0));
    for (const t of this.teams) {
      for (const p of t.players) {
        const v = formationTarget(t, p.slotIndex, t === team, ballPos, new THREE.Vector3());
        if (p.isGK) {
          // вратарь на месте с учётом мяча
          const bx = ballPos.x * t.dir;
          t.toWorld(-HALF_L + (bx < -20 ? 1 : 5), clamp(ballPos.z * t.dir * 0.1, -2, 2), v);
        }
        spots.set(p, v);
      }
    }
    const outfield = team.players.filter(p => !p.isGK);
    const nearest = (list: Player[], to: THREE.Vector3) => list.slice().sort((a, b) => a.pos.distanceTo(to) - b.pos.distanceTo(to))[0];
    let taker: Player;
    let aim = 0;
    const oppGoal = new THREE.Vector3(dir * HALF_L, 0, 0);
    const dGoal = Math.hypot(oppGoal.x - ballPos.x, ballPos.z);

    switch (type) {
      case 'throw': {
        taker = nearest(outfield, ballPos);
        const sz = Math.sign(ballPos.z);
        spots.set(taker, new THREE.Vector3(ballPos.x, 0, sz * (HALF_W + 0.4)));
        aim = facingTo(ballPos, new THREE.Vector3(ballPos.x + dir * 8, 0, ballPos.z - sz * 12));
        break;
      }
      case 'corner': {
        taker = nearest(outfield.filter(p => p.slotIndex >= 5), ballPos);
        const sx = Math.sign(ballPos.x), sz = Math.sign(ballPos.z);
        spots.set(taker, new THREE.Vector3(ballPos.x + sx * 0.6, 0, ballPos.z + sz * 0.6));
        aim = facingTo(ballPos, team.toWorld(HALF_L - 10, 0));
        const boxSpots = [[HALF_L - 5, sz * dir * 2.5], [HALF_L - 7, -sz * dir * 3], [HALF_L - 11, 0.5], [HALF_L - 9, -sz * dir * 7], [HALF_L - 13, sz * dir * 5], [HALF_L - 19, 0]];
        const attackers = [2, 3, 9, 10, 8, 6].map(i => team.players[i]).filter(p => p !== taker);
        attackers.forEach((p, i) => {
          const b = boxSpots[i % boxSpots.length];
          spots.set(p, team.toWorld(b[0] + rand(-1, 1), b[1] + rand(-1, 1)));
        });
        const defenders = [1, 2, 3, 4, 5, 6, 7].map(i => opp.players[i]);
        defenders.forEach((p, i) => {
          const b = boxSpots[i % boxSpots.length];
          spots.set(p, team.toWorld(b[0] + 1.2, b[1] + rand(-0.8, 0.8)));
        });
        spots.set(opp.players[0], team.toWorld(HALF_L - 0.6, 0));
        break;
      }
      case 'goalkick': {
        taker = team.players[0];
        spots.set(taker, ballPos.clone());
        aim = facingTo(ballPos, team.toWorld(0, ballPos.z * dir * 2));
        for (const p of opp.players) {
          const s = spots.get(p)!;
          if (inOwnBox(team, s, 1)) s.x = (-HALF_L + PEN_D + 3) * dir;
        }
        break;
      }
      case 'freekick': {
        const near = outfield.slice().sort((a, b) => a.pos.distanceTo(ballPos) - b.pos.distanceTo(ballPos)).slice(0, 4);
        taker = dGoal < 32 ? near.reduce((a, b) => (b.data.shooting > a.data.shooting ? b : a)) : near[0];
        aim = dGoal < 35 ? facingTo(ballPos, oppGoal) : facingTo(ballPos, team.toWorld(ballPos.x * dir + 20, ballPos.z * dir * 0.5));
        if (dGoal < 32) {
          // стенка
          _v.subVectors(oppGoal, ballPos).setY(0).normalize();
          const perp = new THREE.Vector3(-_v.z, 0, _v.x);
          const wall = opp.players.filter(p => !p.isGK).sort((a, b) => a.pos.distanceTo(ballPos) - b.pos.distanceTo(ballPos)).slice(0, dGoal < 24 ? 4 : 3);
          wall.forEach((p, i) => {
            const off = (i - (wall.length - 1) / 2) * 0.7;
            spots.set(p, ballPos.clone().addScaledVector(_v, CIRCLE_R).addScaledVector(perp, off));
          });
        }
        break;
      }
      case 'penalty': {
        taker = outfield.reduce((a, b) => (b.data.shooting > a.data.shooting ? b : a));
        aim = facingTo(ballPos, oppGoal);
        spots.set(opp.players[0], team.toWorld(HALF_L - 0.3, 0));
        for (const t of this.teams) {
          for (const p of t.players) {
            if (p === taker || p === opp.players[0]) continue;
            if (p.isGK) continue;
            spots.set(p, team.toWorld(HALF_L - PEN_D - rand(2, 9), rand(-18, 18)));
          }
        }
        break;
      }
      default:
        taker = nearest(outfield, ballPos);
    }

    // соперники на дистанции
    const minD = type === 'throw' ? 2.5 : CIRCLE_R;
    if (type !== 'penalty' && type !== 'corner') {
      for (const p of opp.players) {
        const s = spots.get(p)!;
        const d = Math.hypot(s.x - ballPos.x, s.z - ballPos.z);
        if (d < minD - 0.05) {
          if (d < 0.01) s.x += 0.1;
          _w.set(s.x - ballPos.x, 0, s.z - ballPos.z).setLength(minD);
          s.set(ballPos.x + _w.x, 0, ballPos.z + _w.z);
        }
      }
    }
    for (const [p, s] of spots) {
      if (p === taker) continue;
      s.x = clamp(s.x, -HALF_L + 0.5, HALF_L - 0.5);
      s.z = clamp(s.z, -HALF_W + 0.5, HALF_W - 0.5);
    }
    // исполнитель за мячом
    if (type !== 'throw' && type !== 'corner') {
      const back = new THREE.Vector3(Math.sin(aim), 0, Math.cos(aim)).multiplyScalar(-0.7);
      spots.set(taker, ballPos.clone().add(back));
    }
    this.ball.place(ballPos.x, ballPos.z, type === 'throw' ? 2.0 : BALL_R);
    this.ball.lastTouch = taker;
    for (const p of this.players) this.resetPlayer(p, spots.get(p)!, facingTo(spots.get(p)!, ballPos));
    taker.facing = aim;
    this.beginSetPiece({ type, team, pos: ballPos, taker, aim, spots, botDelay: rand(1.3, 2.2) });
    const labels: Record<SetPieceType, string> = { kickoff: '', throw: 'Вбрасывание', corner: 'Угловой', goalkick: 'Удар от ворот', freekick: 'Штрафной удар', penalty: 'Пенальти' };
    if (type === 'penalty') this.emit({ type: 'message', text: 'ПЕНАЛЬТИ', sub: taker.data.name });
    else if (type === 'freekick' && dGoal < 32) this.emit({ type: 'message', text: labels[type], sub: taker.data.name });
  }

  private beginSetPiece(sp: SetPiece) {
    this.setPiece = sp;
    this.state = 'setpiece';
    this.stateT = 0;
    this.pending = null;
    this.charging = false;
    this.shootPower = 0;
    this.lastSetPieceType = sp.type;
    this.lastSetPieceTime = this.time;
    if (sp.team.isHuman) this.controlled = sp.taker;
    else if (this.controlled.isGK) this.controlled = this.teams[0].players[9];
  }

  private updateSetPiece(dt: number, inp: InputFrame) {
    const sp = this.setPiece!;
    const ball = this.ball;
    const t = sp.taker;
    for (const p of this.players) {
      if (p === t) continue;
      aiHold(p, sp.spots.get(p)!);
      p.lookAt = ball.pos;
    }
    t.desired.set(0, 0, 0);
    this.stepPlayers(dt);
    // исполнитель неподвижен
    const ts = sp.spots.get(t)!;
    t.pos.set(ts.x, 0, ts.z);
    t.vel.set(0, 0, 0);
    t.facing = angleLerp(t.facing, sp.aim, Math.min(1, 10 * dt));
    if (sp.type === 'throw') {
      const f = t.forward(_w);
      ball.pos.set(t.pos.x + f.x * 0.15, 2.05, clamp(t.pos.z + f.z * 0.15, -HALF_W + 0.15, HALF_W - 0.15));
    }
    if (this.stateT < 0.7) return;

    if (sp.team.isHuman && !this.autoplay) {
      const mag = Math.hypot(inp.mx, inp.my);
      if (mag > 0.25) {
        const target = Math.atan2(inp.mx, -inp.my);
        sp.aim = angleLerp(sp.aim, target, Math.min(1, 3.5 * dt));
      }
      if (inp.shootHeld) { this.shootPower = Math.min(1, this.shootPower + dt); this.charging = true; }
      if (inp.pass) this.executeSetPiece('pass', 0);
      else if (inp.lob) this.executeSetPiece('lob', 0);
      else if (inp.shootReleased && this.charging) {
        const pw = Math.max(0.25, this.shootPower);
        this.charging = false; this.shootPower = 0;
        this.executeSetPiece('shoot', pw);
      } else if (this.stateT > 15) this.executeSetPiece('pass', 0);
    } else if (this.stateT > sp.botDelay) {
      this.aiSetPiece(sp);
    }
  }

  private executeSetPiece(kind: 'pass' | 'lob' | 'shoot', power: number) {
    const sp = this.setPiece!;
    const t = sp.taker;
    const aimDir = new THREE.Vector3(Math.sin(sp.aim), 0, Math.cos(sp.aim));
    this.state = 'play';
    this.stateT = 0;
    const noOff = sp.type === 'throw' || sp.type === 'corner' || sp.type === 'goalkick';
    if (sp.type === 'throw') {
      this.ball.pos.z = clamp(this.ball.pos.z, -HALF_W + 0.15, HALF_W - 0.15);
      const r = this.chooseReceiver(t, aimDir, kind !== 'pass');
      const rr = r && t.dist2D(r.pos) < 30 ? r : null;
      this.passTo(t, rr, aimDir, true, 1, { throwIn: true, offside: false });
      return;
    }
    if (kind === 'shoot' && (sp.type === 'freekick' || sp.type === 'penalty' || sp.type === 'kickoff')) {
      const gx = t.team.dir * HALF_L;
      const b = this.ball.pos;
      const s = Math.abs(aimDir.x) > 0.05 ? (gx - b.x) / aimDir.x : -1;
      const tz = s > 0 ? clamp(b.z + aimDir.z * s, -GOAL_HW - 1.5, GOAL_HW + 1.5) : 0;
      const ty = 0.3 + power * 1.7 + Math.max(0, power - 0.88) * 7;
      this.shootAt(t, new THREE.Vector3(gx, ty, tz), power, sp.type === 'penalty' ? 0.6 : 1);
      if (sp.type === 'freekick') this.ball.spin = -Math.sign(aimDir.z * t.team.dir || 1) * 2.5 * power;
      return;
    }
    const lob = kind !== 'pass';
    const r = this.chooseReceiver(t, aimDir, lob);
    this.passTo(t, r, aimDir, lob, 1, { offside: !noOff, cross: sp.type === 'corner' });
  }

  private aiSetPiece(sp: SetPiece) {
    const t = sp.taker;
    const team = sp.team;
    const diff = team.ai;
    this.state = 'play';
    this.stateT = 0;
    switch (sp.type) {
      case 'kickoff': {
        const r = team.players[KICKOFF_PARTNER[team.formation]];
        this.passTo(t, r, null, false, 0.5, { offside: false });
        break;
      }
      case 'throw': {
        const cands = team.players.filter(p => p !== t && !p.isGK && t.dist2D(p.pos) < 22 && t.dist2D(p.pos) > 4);
        cands.sort((a, b) => laneOpen(team, t.pos, b.pos) - laneOpen(team, t.pos, a.pos));
        this.passTo(t, cands[0] ?? null, null, true, diff.passErr, { throwIn: true, offside: false });
        break;
      }
      case 'corner': {
        const targets = team.players.filter(p => p !== t && inOppBox(team, p.pos));
        const r = targets[Math.floor(Math.random() * targets.length)] ?? null;
        this.passTo(t, r, null, true, diff.passErr, { offside: false, cross: true });
        break;
      }
      case 'goalkick': {
        const short = Math.random() < 0.3 + this.difficulty * 0.2;
        const cbs = [2, 3, 1, 4].map(i => team.players[i]).filter(p => laneOpen(team, t.pos, p.pos) > 3);
        if (short && cbs.length) this.passTo(t, cbs[0], null, false, diff.passErr, { offside: false });
        else {
          const far = team.players.filter(p => p.slot.role !== 'DEF' && !p.isGK);
          this.passTo(t, far[Math.floor(Math.random() * far.length)], null, true, diff.passErr, { offside: false });
        }
        break;
      }
      case 'freekick': {
        const gx = team.dir * HALF_L;
        const d = Math.hypot(gx - sp.pos.x, sp.pos.z);
        if (d < 28) {
          const side = Math.random() < 0.5 ? -1 : 1;
          this.shootAt(t, new THREE.Vector3(gx, rand(1.4, 2.2), side * (GOAL_HW - rand(0.4, 1.2))), 0.72, diff.shootErr);
          this.ball.spin = -side * team.dir * 2;
        } else {
          const bp = bestPass(this, t, diff.passLane);
          this.passTo(t, bp?.to ?? null, team.toWorld(1, 0).normalize(), bp ? bp.lob : true, diff.passErr);
        }
        break;
      }
      case 'penalty': {
        const gx = team.dir * HALF_L;
        const r = Math.random();
        const tz = r < 0.15 ? 0 : (r < 0.57 ? -1 : 1) * (GOAL_HW - rand(0.5, 1.1));
        this.shootAt(t, new THREE.Vector3(gx, rand(0.3, 1.7), tz), 0.75, diff.shootErr * 0.7);
        break;
      }
    }
  }

  /** Замена у команды игрока. */
  substitute(slotIndex: number, benchIndex: number) {
    const team = this.teams[0];
    if (team.subsUsed >= 5) return null;
    return team.substitute(slotIndex, benchIndex);
  }

  dispose() {
    for (const t of this.teams) t.dispose();
    this.listeners.length = 0;
  }
}

/** Расстояние в плоскости XZ от точки p до отрезка a–b. */
function segDist2D(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 1e-8 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

function clampInField(v: THREE.Vector3) {
  v.x = clamp(v.x, -HALF_L + 2, HALF_L - 2);
  v.z = clamp(v.z, -HALF_W + 2, HALF_W - 2);
}

function t2f(dir: number) { return dir > 0 ? Math.PI / 2 : -Math.PI / 2; }

export { PEN_HW };
