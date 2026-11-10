import * as THREE from 'three';
import { HALF_L, HALF_W } from '../game/constants';
import type { Match } from '../game/Match';
import type { Player } from '../game/Player';
import { colorDistance, emblemHTML, esc } from './emblem';
import { SHOW_TOUCH } from '../game/quality';

export interface HUDCallbacks {
  onResume(): void;
  onQuit(): void;
  onSub(slot: number, bench: number): void;
}

export const CONTROLS_HTML = `
<table class="controls">
  <tr><th>Действие</th><th>Клавиатура</th><th>Геймпад</th></tr>
  <tr><td>Бег / спринт</td><td>W A S D, Shift</td><td>Левый стик, RT</td></tr>
  <tr><th colspan="3">Атака</th></tr>
  <tr><td>Пас (партнёру в направлении стика)</td><td>E</td><td>A</td></tr>
  <tr><td>Навес / длинный пас</td><td>Q</td><td>X</td></tr>
  <tr><td>Удар (держать — сильнее)</td><td>Пробел</td><td>B</td></tr>
  <tr><th colspan="3">Защита</th></tr>
  <tr><td>Отбор (выпад к мячу)</td><td>E или Пробел</td><td>B</td></tr>
  <tr><td>Прессинг + вызов партнёра (держать)</td><td>Q</td><td>A</td></tr>
  <tr><td>Подкат (наводится на мяч)</td><td>F</td><td>X / Y</td></tr>
  <tr><th colspan="3">Общее</th></tr>
  <tr><td>Смена игрока</td><td>Tab</td><td>LB</td></tr>
  <tr><td>Пауза / пропустить повтор</td><td>Esc / Enter</td><td>Start / A</td></tr>
</table>
<p class="hint-small">Голубая стрелка над партнёром показывает, кому уйдёт пас. Уровень ассиста (Полный / Средний / Ручной) — в настройках матча.</p>
<table class="controls touch-table">
  <tr><th>На телефоне</th><th>Сенсорное управление</th></tr>
  <tr><td>Бег</td><td>Джойстик слева (появляется под пальцем)</td></tr>
  <tr><td>Атака</td><td>«Удар» (держать — сильнее), «Пас», «Навес»</td></tr>
  <tr><td>Защита</td><td>«Отбор», «Прессинг» (держать), «Подкат»</td></tr>
  <tr><td>Спринт, смена игрока, пауза</td><td>«Спринт» (держать), «Смена», ❚❚</td></tr>
</table>`;

export class HUD {
  el: HTMLElement;
  private score: HTMLElement;
  private timeEl: HTMLElement;
  private tag: HTMLElement;
  private tagName: HTMLElement;
  private powerBar: HTMLElement;
  private powerFill: HTMLElement;
  private mini: HTMLCanvasElement;
  private msg: HTMLElement;
  private goalEl: HTMLElement;
  private replayEl: HTMLElement;
  private pauseEl: HTMLElement;
  private hintEl: HTMLElement;
  private spHint: HTMLElement;
  private msgT = 0;
  private colors: [string, string];
  private v = new THREE.Vector3();
  private subSel: { slot: number | null; bench: number | null } = { slot: null, bench: null };

  constructor(root: HTMLElement, private match: Match, private cb: HUDCallbacks) {
    const [h, a] = match.teams;
    this.colors = [h.kit.shirt, a.kit.shirt];
    if (colorDistance(this.colors[0], this.colors[1]) < 60) this.colors[1] = a.kit.stripe !== a.kit.shirt ? a.kit.stripe : '#ff4040';
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="scoreboard">
        <div class="sb-team">${emblemHTML(h.data.emblem, 30)}<span>${esc(h.data.short)}</span><i style="background:${this.colors[0]}"></i></div>
        <div class="sb-score">0 - 0</div>
        <div class="sb-team"><i style="background:${this.colors[1]}"></i><span>${esc(a.data.short)}</span>${emblemHTML(a.data.emblem, 30)}</div>
        <div class="sb-time">00:00</div>
      </div>
      <div class="ptag"><div class="ptag-name"></div><div class="ptag-arrow"></div><div class="power"><div></div></div></div>
      <canvas class="minimap" width="252" height="164"></canvas>
      <div class="msg"></div>
      <div class="goal-overlay"><div class="goal-text">ГОЛ!</div><div class="goal-sub"></div></div>
      <div class="replay-badge">● ПОВТОР <small>${SHOW_TOUCH ? 'Пас — пропустить' : 'Enter — пропустить'}</small></div>
      <div class="sp-hint"></div>
      <div class="start-hint">${SHOW_TOUCH ? 'Джойстик — бег · «Удар»: держите для силы · ❚❚ — пауза' : 'WASD — бег · E — пас · Q — навес · Пробел — удар · В защите: E — отбор, Q — прессинг, F — подкат · Tab — смена'}</div>
      <div class="pause"></div>`;
    root.appendChild(this.el);
    const q = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.score = q('.sb-score');
    this.timeEl = q('.sb-time');
    this.tag = q('.ptag');
    this.tagName = q('.ptag-name');
    this.powerBar = q('.power');
    this.powerFill = q('.power div');
    this.mini = q('.minimap') as HTMLCanvasElement;
    this.msg = q('.msg');
    this.goalEl = q('.goal-overlay');
    this.replayEl = q('.replay-badge');
    this.pauseEl = q('.pause');
    this.hintEl = q('.start-hint');
    this.spHint = q('.sp-hint');
    setTimeout(() => this.hintEl.classList.add('fade'), 9000);
  }

  showMessage(text: string, sub = '') {
    this.msg.innerHTML = `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    this.msg.classList.remove('show');
    void this.msg.offsetWidth;
    this.msg.classList.add('show');
    this.msgT = 2.4;
  }

  showGoal(team: number, scorer: string, own: boolean, minute: number) {
    const t = this.match.teams[team];
    this.goalEl.querySelector('.goal-sub')!.innerHTML =
      `${emblemHTML(t.data.emblem, 40)}<span>${esc(scorer)}${own ? ' (автогол)' : ''} · ${minute}'</span>`;
    this.goalEl.classList.remove('show');
    void this.goalEl.offsetWidth;
    this.goalEl.classList.add('show');
  }

  hideGoal() { this.goalEl.classList.remove('show'); }
  setReplay(on: boolean) { this.replayEl.classList.toggle('show', on); }

  update(dt: number, cam: THREE.Camera, w: number, h: number, controlled: Player | null, replay: boolean) {
    const m = this.match;
    this.score.textContent = `${m.teams[0].score} - ${m.teams[1].score}`;
    const secs = Math.floor(m.clock);
    this.timeEl.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg.classList.remove('show'); }

    // табличка над игроком
    const showTag = !!controlled && !replay && m.state !== 'goal' && m.state !== 'halftime' && m.state !== 'fulltime';
    if (showTag && controlled) {
      this.v.set(controlled.pos.x, controlled.pos.y + 2.25, controlled.pos.z).project(cam);
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
      this.tag.style.display = this.v.z < 1 ? 'flex' : 'none';
      this.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      const text = `${controlled.data.number} · ${controlled.data.name}`;
      if (this.tagName.textContent !== text) this.tagName.textContent = text;
      const charging = m.charging && m.shootPower > 0;
      this.powerBar.style.visibility = charging ? 'visible' : 'hidden';
      this.powerFill.style.width = `${Math.round(m.shootPower * 100)}%`;
      this.powerFill.style.background = m.shootPower > 0.88 ? '#ff4d4d' : m.shootPower > 0.6 ? '#ffd23f' : '#3ddc84';
    } else this.tag.style.display = 'none';

    // подсказка на стандартах
    const sp = m.state === 'setpiece' && m.setPiece && m.setPiece.team.isHuman ? m.setPiece : null;
    if (sp) {
      const map: Record<string, string> = {
        kickoff: 'Начальный удар: E — пас',
        throw: 'Вбрасывание: стрелки — направление, E — короткое, Q — дальнее',
        corner: 'Угловой: стрелки — направление, Q — навес, E — короткий пас',
        goalkick: 'Удар от ворот: E — короткий пас, Q — длинный',
        freekick: 'Штрафной: стрелки — прицел, Пробел — удар, E — пас, Q — навес',
        penalty: 'Пенальти: стрелки — угол, держите Пробел — сила удара',
      };
      const touchMap: Record<string, string> = {
        kickoff: 'Начальный удар: нажмите «Пас»',
        throw: 'Вбрасывание: джойстик — направление, «Пас» — коротко, «Навес» — далеко',
        corner: 'Угловой: джойстик — направление, «Навес» — подача, «Пас» — розыгрыш',
        goalkick: 'Удар от ворот: «Пас» — коротко, «Навес» — длинный',
        freekick: 'Штрафной: джойстик — прицел, «Удар», «Пас» или «Навес»',
        penalty: 'Пенальти: джойстик — угол, держите «Удар» — сила',
      };
      this.spHint.textContent = (SHOW_TOUCH ? touchMap : map)[sp.type];
      this.spHint.style.display = 'block';
    } else this.spHint.style.display = 'none';

    this.drawMinimap(controlled);
  }

  private drawMinimap(controlled: Player | null) {
    const c = this.mini, g = c.getContext('2d')!;
    const W = c.width, H = c.height, pad = 8;
    const sx = (W - pad * 2) / (HALF_L * 2), sz = (H - pad * 2) / (HALF_W * 2);
    const X = (x: number) => pad + (x + HALF_L) * sx;
    const Z = (z: number) => pad + (z + HALF_W) * sz;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,40,20,0.72)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 1;
    g.strokeRect(X(-HALF_L), Z(-HALF_W), HALF_L * 2 * sx, HALF_W * 2 * sz);
    g.beginPath(); g.moveTo(X(0), Z(-HALF_W)); g.lineTo(X(0), Z(HALF_W)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), 9.15 * sx, 0, Math.PI * 2); g.stroke();
    g.strokeRect(X(-HALF_L), Z(-20.16), 16.5 * sx, 40.32 * sz);
    g.strokeRect(X(HALF_L - 16.5), Z(-20.16), 16.5 * sx, 40.32 * sz);
    for (const t of this.match.teams) {
      for (const p of t.players) {
        g.beginPath();
        g.arc(X(p.pos.x), Z(p.pos.z), p === controlled ? 4.5 : 3.4, 0, Math.PI * 2);
        g.fillStyle = this.colors[t.idx];
        g.fill();
        g.lineWidth = p === controlled ? 2 : 1;
        g.strokeStyle = p === controlled ? '#ffe14d' : 'rgba(0,0,0,0.8)';
        g.stroke();
      }
    }
    const b = this.match.ball.pos;
    g.beginPath(); g.arc(X(b.x), Z(b.z), 2.6, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
  }

  // ───────────── пауза ─────────────
  showPause(on: boolean) {
    this.pauseEl.classList.toggle('show', on);
    if (on) this.renderPauseMain();
  }

  get pauseVisible() { return this.pauseEl.classList.contains('show'); }

  private renderPauseMain() {
    const m = this.match;
    this.pauseEl.innerHTML = `
      <div class="panel pause-panel">
        <h2>ПАУЗА</h2>
        <div class="pause-score">${esc(m.teams[0].data.name)} <b>${m.teams[0].score} : ${m.teams[1].score}</b> ${esc(m.teams[1].data.name)}</div>
        <button class="btn primary" data-a="resume">Продолжить</button>
        <button class="btn" data-a="subs">Замены (${m.teams[0].subsUsed}/5)</button>
        <button class="btn" data-a="controls">Управление</button>
        <button class="btn danger" data-a="quit">Выйти в меню</button>
      </div>`;
    this.pauseEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const a = (b as HTMLElement).dataset.a;
      if (a === 'resume') this.cb.onResume();
      else if (a === 'subs') this.renderSubs();
      else if (a === 'controls') this.renderControls();
      else if (a === 'quit') this.cb.onQuit();
    }));
  }

  private renderControls() {
    this.pauseEl.innerHTML = `<div class="panel pause-panel wide"><h2>УПРАВЛЕНИЕ</h2>${CONTROLS_HTML}<button class="btn" data-a="back">Назад</button></div>`;
    this.pauseEl.querySelector('button')!.addEventListener('click', () => this.renderPauseMain());
  }

  private renderSubs() {
    const team = this.match.teams[0];
    const sel = this.subSel;
    const row = (label: string, p: { number: number; name: string; ovr: number; pos: string }, cls: string, attr: string) =>
      `<div class="sub-row ${cls}" ${attr}><span class="pos">${label}</span><span class="num">${p.number}</span><span class="nm">${esc(p.name)}</span><span class="ovr">${p.ovr}</span></div>`;
    const left = team.players.map((p, i) => row(team.slots[i].label, p.data, sel.slot === i ? 'sel' : '', `data-slot="${i}"`)).join('');
    const right = team.bench.length
      ? team.bench.map((p, i) => row(p.pos, p, sel.bench === i ? 'sel' : '', `data-bench="${i}"`)).join('')
      : '<div class="empty">Запасных не осталось</div>';
    const can = sel.slot !== null && sel.bench !== null && team.subsUsed < 5;
    this.pauseEl.innerHTML = `
      <div class="panel pause-panel wide">
        <h2>ЗАМЕНЫ <small>${team.subsUsed}/5</small></h2>
        <div class="subs-grid"><div><h3>На поле</h3>${left}</div><div><h3>Скамейка</h3>${right}</div></div>
        <div class="row-btns">
          <button class="btn primary" data-a="do" ${can ? '' : 'disabled'}>Заменить</button>
          <button class="btn" data-a="back">Назад</button>
        </div>
      </div>`;
    this.pauseEl.querySelectorAll('[data-slot]').forEach(e => e.addEventListener('click', () => { sel.slot = +(e as HTMLElement).dataset.slot!; this.renderSubs(); }));
    this.pauseEl.querySelectorAll('[data-bench]').forEach(e => e.addEventListener('click', () => { sel.bench = +(e as HTMLElement).dataset.bench!; this.renderSubs(); }));
    this.pauseEl.querySelector('[data-a="do"]')!.addEventListener('click', () => {
      if (sel.slot !== null && sel.bench !== null) {
        this.cb.onSub(sel.slot, sel.bench);
        sel.slot = null; sel.bench = null;
        this.renderSubs();
      }
    });
    this.pauseEl.querySelector('[data-a="back"]')!.addEventListener('click', () => this.renderPauseMain());
  }

  dispose() { this.el.remove(); }
}
