import * as THREE from 'three';
import { BALL_R, GOAL_H, GOAL_HW, HALF_L, HALF_W, PEN_D, PEN_HW, clamp, rand } from './constants';
import type { Match } from './Match';
import type { Player } from './Player';
import type { Team } from './Team';

export interface TeamCtx {
  chaser: Player | null;
  chaseT: number;
  chasePoint: THREE.Vector3;
  pressers: Player[];
  offsideLine: number; // в координатах команды
  defLine: number; // линия обороны (координаты команды)
  attacking: boolean;
}

export function newCtx(): TeamCtx {
  return { chaser: null, chaseT: 9, chasePoint: new THREE.Vector3(), pressers: [], offsideLine: 0, defLine: -30, attacking: false };
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const PATH_STEP = 0.1;

/** Время перехвата мяча игроком по предсказанной траектории. */
export function interceptTime(m: Match, p: Player, out?: THREE.Vector3) {
  const path = m.ballPath;
  const sp = p.sprintSpeed();
  const react = m.ball.intended && m.ball.intended !== p && m.ball.intended.team !== p.team ? 0.4 : 0.15;
  for (let i = 0; i < path.length; i++) {
    const t = i * PATH_STEP;
    const b = path[i];
    if (b.y > 2.2) continue;
    const reach = sp * Math.max(0, t - react) + 0.7;
    if (Math.hypot(b.x - p.pos.x, b.z - p.pos.z) <= reach) {
      if (out) out.copy(b);
      return t;
    }
  }
  const last = path[path.length - 1];
  if (out) out.copy(last);
  return path.length * PATH_STEP + p.dist2D(last) / sp;
}

export function computeContext(m: Match) {
  const ball = m.ball;
  m.ball.predict(m.ballPath, PATH_STEP);
  for (const team of m.teams) {
    const c = m.ctx[team.idx];
    const owner = ball.owner;
    c.attacking = (!!owner && owner.team === team) || (!!ball.intended && ball.intended.team === team);
    // линия офсайда: второй последний защитник соперника
    const xs = team.opp.players.map(o => o.pos.x * team.dir).sort((a, b) => b - a);
    c.offsideLine = Math.max(0, xs[1] ?? 0, ball.pos.x * team.dir);
    let lx = 0;
    for (let i = 1; i <= 4; i++) lx += formationTarget(team, i, false, ball.pos, _v).x * team.dir;
    c.defLine = lx / 4;

    c.chaser = null;
    c.chaseT = 99;
    if (!owner) {
      if (ball.intended && ball.intended.team === team && !ball.intended.busy) {
        c.chaser = ball.intended;
        c.chaseT = interceptTime(m, ball.intended, c.chasePoint);
      } else {
        for (const p of team.players) {
          if (p.busy) continue;
          if (p.isGK && !inOwnBox(p.team, ball.pos, 4)) continue;
          const t = interceptTime(m, p, _v) + (p.isGK ? 0.4 : 0);
          if (t < c.chaseT) { c.chaseT = t; c.chaser = p; c.chasePoint.copy(_v); }
        }
      }
    }
    // прессинг
    c.pressers.length = 0;
    if (owner && owner.team !== team && !ball.heldByGK) {
      // контрпрессинг: сразу после потери мяча в отбор идут больше игроков
      const counter = m.time - m.lossTime[team.idx] < 3 ? team.ai.counterPress : 0;
      const n = team.isHuman ? 1 : team.ai.pressers + counter;
      const sorted = team.players.filter(p => !p.isGK && !p.busy && (!team.isHuman || p !== m.controlled))
        .sort((a, b) => a.dist2D(owner.pos) - b.dist2D(owner.pos));
      for (let i = 0; i < n && i < sorted.length; i++) {
        // у игрока ИИ-напарник прессингует только если управляемый игрок далеко
        if (team.isHuman && m.controlled && m.controlled.dist2D(owner.pos) < 9 && !m.humanPress) break;
        c.pressers.push(sorted[i]);
      }
    }
  }
}

export function inOwnBox(team: Team, pos: THREE.Vector3, margin = 0) {
  return pos.x * team.dir < -HALF_L + PEN_D + margin && Math.abs(pos.z) < PEN_HW + margin;
}

export function inOppBox(team: Team, pos: THREE.Vector3) {
  return pos.x * team.dir > HALF_L - PEN_D && Math.abs(pos.z) < PEN_HW;
}

/** Базовая позиция в расстановке с учётом положения мяча. */
export function formationTarget(team: Team, slot: number, attack: boolean, ballPos: THREE.Vector3, out: THREE.Vector3) {
  const s = team.slots[slot];
  const bx = clamp((ballPos.x * team.dir) / HALF_L, -1, 1);
  const bz = clamp((ballPos.z * team.dir) / HALF_W, -1, 1);
  let nx: number, nz: number;
  if (attack) {
    nx = s.x + 0.3 + bx * 0.36;
    nz = s.z * 1.12 + bz * 0.15;
    if (s.role === 'DEF') nx -= 0.06;
  } else {
    nx = s.x + 0.06 + bx * 0.38;
    nz = s.z * 0.8 + bz * 0.28;
    if (s.role === 'FWD') nx = Math.max(nx, -0.15);
  }
  nx = clamp(nx, -0.9, 0.86);
  nz = clamp(nz, -0.94, 0.94);
  return team.toWorld(nx * HALF_L, nz * HALF_W, out);
}

function moveTo(p: Player, target: THREE.Vector3, sprint: boolean, stopDist = 0.5) {
  const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < stopDist) { p.desired.set(0, 0, 0); return; }
  const max = sprint ? p.sprintSpeed() : p.jogSpeed();
  const sp = Math.min(max, d * 1.8);
  p.desired.set((dx / d) * sp, 0, (dz / d) * sp);
}

function nearestOpp(p: Player, pos = p.pos) {
  let best: Player | null = null, bd = 1e9;
  for (const o of p.team.opp.players) {
    const d = Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z);
    if (d < bd) { bd = d; best = o; }
  }
  return { p: best, d: bd };
}

/** Запас безопасности линии паса: расстояние соперника до линии минус то, что он успеет пробежать, пока летит мяч. */
export function laneOpen(team: Team, a: THREE.Vector3, b: THREE.Vector3, ballSpeed = 15) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const len = Math.sqrt(len2);
  let best = 99;
  for (const o of team.opp.players) {
    const t = ((o.pos.x - a.x) * abx + (o.pos.z - a.z) * abz) / len2;
    if (t < -0.02 || t > 1.1) continue;
    const tc = Math.min(1, Math.max(0, t));
    const cx = a.x + abx * tc, cz = a.z + abz * tc;
    const flight = (tc * len) / ballSpeed;
    const d = Math.hypot(o.pos.x - cx, o.pos.z - cz) - Math.max(0, flight - 0.3) * 6.5;
    if (d < best) best = d;
  }
  return best;
}

export function bestPass(m: Match, p: Player, minLane: number) {
  let best: Player | null = null, bs = -1e9, lob = false;
  const dir = p.team.dir;
  for (const t of p.team.players) {
    if (t === p || t.busy) continue;
    const d = p.dist2D(t.pos);
    if (d < 5 || d > 42) continue;
    if (t.isGK && (p.pos.x * dir > -10)) continue;
    if (m.isOffside(t)) continue;
    const lane = laneOpen(p.team, p.pos, t.pos);
    const isLob = d > 26 || (lane < minLane && d > 14);
    if (!isLob && lane < minLane) continue;
    const prog = (t.pos.x - p.pos.x) * dir;
    const press = nearestOpp(t).d;
    let score = prog * 0.42 + Math.min(lane, 5) * 0.8 + Math.min(press, 9) * 0.55 - Math.abs(d - 16) * 0.06 + rand(0, 1.6);
    if (inOppBox(p.team, t.pos)) score += 2.5;
    if (t.isGK) score -= 6;
    if (isLob) score -= 1.5;
    if (score > bs) { bs = score; best = t; lob = isLob; }
  }
  return best ? { to: best, score: bs, lob } : null;
}

/** Решения ИИ для владеющего мячом игрока. */
export function aiCarrier(m: Match, p: Player, dt: number) {
  const team = p.team;
  const diff = team.ai;
  const dir = team.dir;
  const gx = dir * HALF_L;
  const dGoal = Math.hypot(gx - p.pos.x, p.pos.z);
  const press = nearestOpp(p).d;
  const tx = p.pos.x * dir;

  p.aiTimer -= dt;
  if (p.aiTimer <= 0) {
    p.aiTimer = diff.react * rand(0.7, 1.3);
    // удар
    if (dGoal < diff.shootRange && (Math.abs(p.pos.z) < 15 || dGoal < 13)) {
      _v.set(gx, 0, 0);
      const clear = laneOpen(team, p.pos, _v) > 1.3;
      let ch = dGoal < 11 ? 0.85 : dGoal < 17 ? 0.5 : 0.28;
      if (clear) ch += 0.2;
      if (press < 1.5) ch += 0.1;
      if (Math.random() < ch) { aiShoot(m, p, dGoal); return; }
    }
    // навес с фланга
    if (tx > HALF_L - 20 && Math.abs(p.pos.z) > 17 && Math.random() < 0.55) {
      const targets = team.players.filter(t => t !== p && inOppBox(team, t.pos));
      if (targets.length) {
        const t = targets[Math.floor(Math.random() * targets.length)];
        m.passTo(p, t, null, true, diff.passErr);
        return;
      }
    }
    // пас
    const bp = bestPass(m, p, diff.passLane);
    const pp = press < 2.2 ? 0.9 : press < 4.5 ? 0.45 + diff.passBias * 0.5 : 0.1 + diff.passBias;
    const progress = bp ? (bp.to.pos.x - p.pos.x) * dir : 0;
    if (bp && bp.score > (press < 3 ? -1 : 3) && (press < 3 || progress > 4 || tx < -25) && Math.random() < pp) {
      m.passTo(p, bp.to, null, bp.lob, diff.passErr);
      return;
    }
  }

  // дриблинг к воротам с обходом соперников
  _v.set(gx - dir * 6 - p.pos.x, 0, p.pos.z * 0.55 - p.pos.z);
  if (tx > HALF_L - 22) _v.set(gx - p.pos.x, 0, -p.pos.z * 0.7);
  _v.normalize();
  _w.set(0, 0, 0);
  let blocked = false;
  for (const o of team.opp.players) {
    const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 7 || d < 0.01) continue;
    const ahead = (o.pos.x - p.pos.x) * dir > -1;
    if (!ahead) continue;
    if (d < 4) blocked = true;
    const w = (7 - d) / 7;
    _w.x += (dx / d) * w; _w.z += (dz / d) * w;
  }
  _v.addScaledVector(_w, 0.9 * diff.dribble + 0.3);
  if (Math.abs(p.pos.z) > HALF_W - 4) _v.z -= Math.sign(p.pos.z) * 0.8;
  _v.y = 0;
  _v.normalize();
  const sprint = !blocked || Math.random() < diff.dribble * 0.5;
  const sp = sprint ? p.sprintSpeed() : p.jogSpeed();
  p.desired.copy(_v).multiplyScalar(sp);
}

function aiShoot(m: Match, p: Player, dGoal: number) {
  const team = p.team;
  const gk = team.opp.players[0];
  const gx = team.dir * HALF_L;
  const side = gk.pos.z >= p.pos.z * 0.2 ? -1 : 1;
  const tz = side * (GOAL_HW - rand(0.4, 1.1));
  const ty = rand(0.25, 1.9);
  const power = clamp(0.45 + dGoal / 40, 0.45, 0.92);
  m.shootAt(p, new THREE.Vector3(gx, ty, tz), power, team.ai.shootErr);
}

/** Поведение полевого игрока без мяча. */
export function aiOffBall(m: Match, p: Player, dt: number) {
  const team = p.team;
  const ball = m.ball;
  const c = m.ctx[team.idx];
  const diff = team.ai;
  p.lookAt = ball.pos;

  // реакция (задержка) для бота
  if (c.chaser === p) {
    moveTo(p, c.chasePoint, true, 0.1);
    return;
  }
  if (c.pressers.includes(p) && ball.owner) {
    const o = ball.owner;
    const ownGoalX = -team.dir * HALF_L;
    const d = p.dist2D(o.pos);
    if (d > 3.2) {
      // подбегает к позиции между соперником и воротами
      _v.set(ownGoalX - o.pos.x, 0, -o.pos.z).normalize();
      _w.copy(o.pos).addScaledVector(o.vel, 0.35).addScaledVector(_v, 1.4);
      const sprint = team.isHuman || Math.random() < diff.pressSprint + 0.25;
      moveTo(p, _w, sprint, 0.2);
    } else {
      // сопровождает и не пробегает мимо
      m.contain(p, o, 1.3);
    }
    if (d < 1.9 && p.tackleCD <= 0 && p.tackleT <= 0) {
      if (Math.random() < 0.45) m.tryTackle(p);
      else p.tackleCD = 0.25;
    }
    return;
  }

  if (c.attacking) {
    formationTarget(team, p.slotIndex, true, ball.pos, _v);
    const role = p.slot.role;
    // поиск свободного пространства
    p.spaceTimer -= dt;
    if (p.spaceTimer <= 0) {
      p.spaceTimer = rand(0.5, 0.9);
      let best = -1e9;
      for (let i = 0; i < 7; i++) {
        const ox = i === 0 ? 0 : rand(-5, 5), oz = i === 0 ? 0 : rand(-5, 5);
        _w.set(_v.x + ox, 0, _v.z + oz);
        const sc = nearestOpp(p, _w).d - Math.hypot(ox, oz) * 0.25;
        if (sc > best) { best = sc; p.aiSpot.set(ox, 0, oz); }
      }
    }
    _v.add(p.aiSpot);
    // забегания нападающих
    p.runT -= dt;
    if (p.runT <= 0) {
      p.runT = rand(2.5, 5);
      p.runTarget = null;
      const bx = ball.pos.x * team.dir, bz = ball.pos.z * team.dir;
      const fullback = role === 'DEF' && (p.slotIndex === 1 || p.slotIndex === 4);
      if ((role === 'FWD' || (role === 'MID' && Math.random() < 0.3)) && Math.random() < diff.runFreq) {
        // забегание за спину защитникам
        const rx = Math.min(c.offsideLine + rand(2, 9), HALF_L - 6);
        p.runTarget = team.toWorld(rx, clamp(p.pos.z * team.dir * 0.6 + rand(-8, 8), -22, 22));
      } else if (fullback && bx > -5 && Math.sign(bz) === Math.sign(p.slot.z) && Math.random() < diff.runFreq * 0.8) {
        // крайний защитник идёт в обгон по флангу
        const rx = Math.min(bx + rand(6, 12), c.offsideLine - 0.5, HALF_L - 10);
        p.runTarget = team.toWorld(rx, Math.sign(p.slot.z) * HALF_W * 0.85);
      }
    }
    let sprint = false;
    if (p.runTarget && ball.owner && ball.owner.team === team) {
      _v.copy(p.runTarget);
      sprint = true;
    }
    // не уходить в офсайд, пока мяч не отдан
    const tx = _v.x * team.dir;
    const limit = c.offsideLine - 0.6;
    if (tx > limit && !(ball.intended === p)) {
      const ownerFacingPass = p.runTarget && ball.owner && ball.owner.team === team && Math.random() < 0.02;
      if (!ownerFacingPass) _v.x = limit * team.dir;
    }
    _v.z = clamp(_v.z, -HALF_W + 1.5, HALF_W - 1.5);
    const d = p.dist2D(_v);
    moveTo(p, _v, sprint || d > 9, 0.6);
    return;
  }

  // оборона
  formationTarget(team, p.slotIndex, false, ball.pos, _v);
  const role = p.slot.role;
  // персональная опека ближайшего соперника в своей зоне
  let mark: Player | null = null, md = role === 'DEF' ? 11 : 8;
  for (const o of team.opp.players) {
    if (o.isGK || o === ball.owner) continue;
    const d = Math.hypot(o.pos.x - _v.x, o.pos.z - _v.z);
    if (d < md) { md = d; mark = o; }
  }
  if (mark) {
    const ownGoalX = -team.dir * HALF_L;
    _w.set(ownGoalX - mark.pos.x, 0, -mark.pos.z).normalize();
    _w.multiplyScalar(1.8).add(mark.pos);
    _v.lerp(_w, role === 'DEF' ? 0.6 : 0.45);
  }
  // защитники держат общую линию (и ловят в офсайд), кроме опеки соперника за спиной
  if (role === 'DEF') {
    const lineWorld = c.defLine * team.dir;
    const markDeep = mark && (mark.pos.x * team.dir) < c.defLine - 2;
    if (!markDeep) _v.x = lineWorld;
  }
  // если мяч за спиной — быстро возвращаться
  const behind = (ball.pos.x - p.pos.x) * team.dir < -4;
  const d = p.dist2D(_v);
  moveTo(p, _v, behind || d > 10, 0.5);
}

/** Вратарь. */
export function aiGK(m: Match, p: Player, dt: number) {
  const team = p.team;
  const ball = m.ball;
  const gx = -team.dir * HALF_L;
  p.lookAt = ball.pos;

  if (ball.owner === p) {
    p.desired.set(0, 0, 0);
    if (ball.heldByGK) {
      p.holdT += dt;
      if (p.holdT > (team.isHuman ? 1.6 : 1.2 + team.ai.react)) m.gkDistribute(p, null, Math.random() < 0.5);
    } else {
      // мяч в ногах — выбить / отдать
      p.aiTimer -= dt;
      if (p.aiTimer <= 0) {
        const bp = bestPass(m, p, 1.5);
        if (bp) m.passTo(p, bp.to, null, bp.lob, 1);
        else m.passTo(p, null, team.toWorld(1, 0).normalize(), true, 1);
      }
    }
    return;
  }
  if (p.busy) { p.desired.set(0, 0, 0); return; }

  const skill = (p.data.defending + (team.isHuman ? 0 : team.ai.gkSkill * 100)) / 100;

  // летит удар?
  const towards = ball.vel.x * -team.dir; // скорость в сторону своих ворот
  if (!ball.owner && towards > 6) {
    const t = (p.pos.x - ball.pos.x) / ball.vel.x;
    if (t > 0 && t < 1.4) {
      const zAt = ball.pos.z + ball.vel.z * t;
      const yAt = Math.max(BALL_R, ball.pos.y + ball.vel.y * t - 4.9 * t * t);
      const lineT = (gx - ball.pos.x) / ball.vel.x;
      const zLine = ball.pos.z + ball.vel.z * lineT;
      if (Math.abs(zLine) < GOAL_HW + 1.2 && yAt < GOAL_H + 0.6) {
        const dz = zAt - p.pos.z;
        p.reactT += dt;
        const reaction = 0.1 + (1 - skill) * 0.35;
        if (Math.abs(dz) > 0.9 && t < 0.75 && p.reactT > reaction) {
          // прыжок
          const reachSpeed = 5.5 + skill * 3.5;
          const need = Math.abs(dz) / Math.max(0.15, t);
          const vz = Math.sign(dz) * Math.min(need, reachSpeed);
          p.startDive(0, vz, Math.max(0, Math.min(1.3, yAt - 0.6)), sideFor(p, dz), 0.8);
          p.reactT = 0;
          return;
        }
        _v.set(p.pos.x, 0, clamp(zAt, -GOAL_HW, GOAL_HW));
        moveTo(p, _v, true, 0.05);
        return;
      }
    }
  } else p.reactT = 0;

  // выход на мяч в штрафной
  const c = m.ctx[team.idx];
  if (!ball.owner && c.chaser === p && inOwnBox(team, ball.pos, 1)) {
    moveTo(p, c.chasePoint, true, 0.05);
    return;
  }
  // соперник с мячом один на один
  if (ball.owner && ball.owner.team !== team && inOwnBox(team, ball.pos)) {
    const d = p.dist2D(ball.pos);
    if (d < 7 && Math.abs(ball.pos.z) < 12) {
      moveTo(p, ball.pos, true, 0.2);
      if (d < 1.5 && p.tackleCD <= 0) m.tryTackle(p);
      return;
    }
  }
  // позиционирование: на линии между мячом и центром ворот
  const bd = Math.hypot(ball.pos.x - gx, ball.pos.z);
  const off = clamp(bd * 0.12, 0.6, 5);
  _v.set(ball.pos.x - gx, 0, ball.pos.z).normalize();
  _w.set(gx + _v.x * off, 0, clamp(_v.z * off * 1.6, -GOAL_HW + 0.4, GOAL_HW - 0.4));
  moveTo(p, _w, false, 0.15);
}

/** Сторона прыжка в локальных координатах модели (+1 — к локальному +x). */
function sideFor(p: Player, dzWorld: number) {
  // локальная ось +x модели в мире: (cos f, 0, -sin f); проекция (0,0,dz) на неё
  const proj = dzWorld * -Math.sin(p.facing);
  return proj >= 0 ? 1 : -1;
}

/** Цель для игрока во время розыгрыша стандарта (стоят на местах). */
export function aiHold(p: Player, target: THREE.Vector3) {
  moveTo(p, target, true, 0.3);
}

export const AI_PATH_STEP = PATH_STEP;
