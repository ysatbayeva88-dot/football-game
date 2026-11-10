import { ASSISTS, DIFFICULTIES, FORMATIONS, STADIUMS } from '../game/constants';
import { teamOvr } from '../game/Team';
import type { AssistLevel, FormationName, GraphicsLevel, Kit, MatchConfig, MatchResult, StadiumId, TeamData } from '../game/types';
import { colorDistance, emblemHTML, esc } from './emblem';
import { CONTROLS_HTML } from './HUD';
import { SHOW_TOUCH, defaultGraphics, saveGraphics } from '../game/quality';

export interface MenuCallbacks {
  onStart(cfg: MatchConfig): void;
  onClick(): void;
}

function kitSVG(k: Kit, size = 70) {
  let pattern = '';
  if (k.pattern === 'stripes') pattern = [22, 40, 58, 76].map(x => `<rect x="${x}" y="10" width="9" height="90" fill="${k.stripe}" clip-path="url(#body)"/>`).join('');
  if (k.pattern === 'band') pattern = `<rect x="41" y="10" width="18" height="90" fill="${k.stripe}" clip-path="url(#body)"/>`;
  if (k.pattern === 'hoops') pattern = [30, 52, 74].map(y => `<rect x="0" y="${y}" width="100" height="9" fill="${k.stripe}" clip-path="url(#body)"/>`).join('');
  return `<svg viewBox="0 0 100 110" width="${size}" height="${size * 1.1}">
    <defs><clipPath id="body"><path d="M28 12 L40 6 Q50 14 60 6 L72 12 L72 100 L28 100 Z"/></clipPath></defs>
    <path d="M28 12 L8 26 L16 44 L28 38 Z" fill="${k.sleeves}" stroke="#0006"/>
    <path d="M72 12 L92 26 L84 44 L72 38 Z" fill="${k.sleeves}" stroke="#0006"/>
    <path d="M28 12 L40 6 Q50 14 60 6 L72 12 L72 100 L28 100 Z" fill="${k.shirt}" stroke="#0006"/>
    ${pattern}
    <text x="50" y="62" text-anchor="middle" font-size="22" font-weight="800" fill="${k.number}" font-family="Arial">10</text>
    <rect x="30" y="100" width="40" height="8" fill="${k.shorts}" stroke="#0006"/>
  </svg>`;
}

export class Menu {
  el: HTMLElement;
  private userTeam: TeamData;
  private botTeam: TeamData;
  private homeKit: 'home' | 'away' = 'home';
  private awayKit: 'home' | 'away' = 'home';
  private stadium: StadiumId = 'night';
  private difficulty: 0 | 1 | 2 = 1;
  private halfMinutes: 2 | 4 | 6 = 4;
  private formation: FormationName = '4-3-3';
  private assist: AssistLevel = (localStorageGet('uf26-assist') as AssistLevel) || 'full';
  private graphics: GraphicsLevel = defaultGraphics();
  private loadingBar: HTMLElement | null = null;
  private loadingLabel: HTMLElement | null = null;

  constructor(root: HTMLElement, private teams: TeamData[], private cb: MenuCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    root.appendChild(this.el);
    this.userTeam = teams[0];
    this.botTeam = teams[1];
    this.formation = this.userTeam.formation;
    this.el.addEventListener('click', e => { if ((e.target as HTMLElement).closest('button,.card,.opt')) this.cb.onClick(); });
  }

  show() { this.el.style.display = 'flex'; }
  hide() { this.el.style.display = 'none'; this.el.innerHTML = ''; }

  private bg(inner: string, cls = '') {
    this.el.innerHTML = `<div class="menu-bg"><div class="glow g1"></div><div class="glow g2"></div><div class="pitch-lines"></div></div><div class="screen ${cls}">${inner}</div>`;
    this.show();
  }

  private bind(sel: string, fn: (el: HTMLElement) => void) {
    this.el.querySelectorAll(sel).forEach(e => e.addEventListener('click', () => fn(e as HTMLElement)));
  }

  // ───────────── главный экран ─────────────
  showMain() {
    this.bg(`
      <div class="title-wrap">
        <div class="logo"><span>ULTRA</span> FOOTBALL <em>26</em></div>
        <div class="tag">Быстрый матч против компьютера</div>
      </div>
      <div class="main-tiles">
        <button class="tile big" data-a="quick"><div class="tile-ico">⚽</div><div><b>БЫСТРЫЙ МАТЧ</b><span>Выберите клубы и играйте 11×11</span></div></button>
        <button class="tile" data-a="controls"><div class="tile-ico">🎮</div><div><b>УПРАВЛЕНИЕ</b><span>${SHOW_TOUCH ? 'Сенсор, клавиатура, геймпад' : 'Клавиатура и геймпад'}</span></div></button>
      </div>
      <div class="footer-note">12 клубов · 3 стадиона · 3 уровня сложности · составы в src/data/teams.json</div>`, 'main');
    this.bind('[data-a="quick"]', () => this.showTeams());
    this.bind('[data-a="controls"]', () => this.showControls());
  }

  private showControls() {
    this.bg(`<div class="panel"><h2>УПРАВЛЕНИЕ</h2>${CONTROLS_HTML}<div class="row-btns"><button class="btn" data-a="back">Назад</button></div></div>`);
    this.bind('[data-a="back"]', () => this.showMain());
  }

  // ───────────── выбор команд ─────────────
  private teamCard(t: TeamData, selected: boolean, disabled: boolean, side: string) {
    const r = teamOvr(t);
    return `<div class="card ${selected ? 'sel' : ''} ${disabled ? 'dis' : ''}" data-side="${side}" data-id="${t.id}" style="--c1:${t.home.shirt};--c2:${t.emblem.border}">
      <div class="card-ovr">${r.ovr}</div>
      ${emblemHTML(t.emblem, 44)}
      <div class="card-name">${esc(t.name)}</div>
      <div class="card-stats"><span>АТК <b>${r.atk}</b></span><span>ПЗ <b>${r.mid}</b></span><span>ЗАЩ <b>${r.def}</b></span></div>
    </div>`;
  }

  private showTeams() {
    const big = (t: TeamData, label: string) => {
      const r = teamOvr(t);
      return `<div class="team-hero" style="--c1:${t.home.shirt};--c2:${t.emblem.border}">
        <div class="hero-label">${label}</div>
        ${emblemHTML(t.emblem, 86)}
        <div class="hero-name">${esc(t.name)}</div>
        <div class="hero-ovr"><b>${r.ovr}</b><span>OVR</span></div>
        <div class="hero-bars">
          ${[['АТАКА', r.atk], ['ПОЛУЗАЩИТА', r.mid], ['ЗАЩИТА', r.def]].map(([n, v]) => `<div class="bar"><span>${n}</span><i><em style="width:${(+v - 60) * 2.5}%"></em></i><b>${v}</b></div>`).join('')}
        </div>
        <div class="hero-stars">${esc(t.starters.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 3).map(p => `${p.name} ${p.ovr}`).join(' · '))}</div>
      </div>`;
    };
    this.bg(`
      <h1 class="screen-title">ВЫБОР КОМАНД</h1>
      <div class="teams-layout">
        <div class="team-col">
          ${big(this.userTeam, 'ВЫ')}
          <div class="cards">${this.teams.map(t => this.teamCard(t, t === this.userTeam, t === this.botTeam, 'u')).join('')}</div>
        </div>
        <div class="vs">VS</div>
        <div class="team-col">
          ${big(this.botTeam, 'КОМПЬЮТЕР')}
          <div class="cards">${this.teams.map(t => this.teamCard(t, t === this.botTeam, t === this.userTeam, 'b')).join('')}</div>
        </div>
      </div>
      <div class="row-btns bottom">
        <button class="btn" data-a="back">Назад</button>
        <button class="btn" data-a="random">Случайно</button>
        <button class="btn primary" data-a="next">Далее</button>
      </div>`, 'teams');
    this.bind('.card', el => {
      const t = this.teams.find(x => x.id === el.dataset.id)!;
      if (el.dataset.side === 'u' && t !== this.botTeam) { this.userTeam = t; this.formation = t.formation; }
      if (el.dataset.side === 'b' && t !== this.userTeam) this.botTeam = t;
      this.showTeams();
    });
    this.bind('[data-a="random"]', () => {
      const s = this.teams.slice().sort(() => Math.random() - 0.5);
      this.userTeam = s[0]; this.botTeam = s[1]; this.formation = s[0].formation;
      this.showTeams();
    });
    this.bind('[data-a="back"]', () => this.showMain());
    this.bind('[data-a="next"]', () => { this.autoKits(); this.showSettings(); });
  }

  private autoKits() {
    this.homeKit = 'home';
    this.awayKit = 'home';
    if (colorDistance(this.userTeam.home.shirt, this.botTeam.home.shirt) < 80) this.awayKit = 'away';
    if (colorDistance(this.userTeam.home.shirt, this.botTeam[this.awayKit].shirt) < 80) this.homeKit = 'away';
  }

  // ───────────── настройки матча ─────────────
  private showSettings() {
    const u = this.userTeam, b = this.botTeam;
    const clash = colorDistance(u[this.homeKit].shirt, b[this.awayKit].shirt) < 70;
    const opt = (group: string, val: string, label: string, active: boolean, sub = '') =>
      `<button class="opt ${active ? 'on' : ''}" data-g="${group}" data-v="${val}"><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
    const kitPick = (t: TeamData, side: 'u' | 'b', cur: 'home' | 'away') => `
      <div class="kit-pick">
        <div class="kit-team">${emblemHTML(t.emblem, 34)}<span>${esc(t.name)}</span></div>
        <div class="kits">
          <button class="opt kit ${cur === 'home' ? 'on' : ''}" data-g="kit${side}" data-v="home">${kitSVG(t.home)}<span>Домашняя</span></button>
          <button class="opt kit ${cur === 'away' ? 'on' : ''}" data-g="kit${side}" data-v="away">${kitSVG(t.away)}<span>Выездная</span></button>
        </div>
      </div>`;
    this.bg(`
      <h1 class="screen-title">НАСТРОЙКИ МАТЧА</h1>
      <div class="settings">
        <section class="panel s-kits"><h3>Форма</h3>
          <div class="kits-row">${kitPick(u, 'u', this.homeKit)}${kitPick(b, 'b', this.awayKit)}</div>
          ${clash ? '<div class="warn">⚠ Формы похожи по цвету — выберите другую</div>' : ''}
        </section>
        <section class="panel"><h3>Стадион</h3>
          <div class="opts stadiums">${STADIUMS.map(s => `<button class="opt stad ${s.id} ${this.stadium === s.id ? 'on' : ''}" data-g="stadium" data-v="${s.id}"><div class="stad-pic"></div><b>${s.name}</b><span>${s.desc}</span></button>`).join('')}</div>
        </section>
        <section class="panel"><h3>Сложность бота</h3>
          <div class="opts">${DIFFICULTIES.map((d, i) => opt('diff', String(i), d.name, this.difficulty === i, ['Спокойный соперник', 'Сбалансированная игра', 'Жёсткий прессинг, точные удары'][i])).join('')}</div>
        </section>
        <section class="panel"><h3>Длительность тайма</h3>
          <div class="opts">${[2, 4, 6].map(n => opt('half', String(n), `${n} мин`, this.halfMinutes === n)).join('')}</div>
          <h3>Ваша расстановка</h3>
          <div class="opts">${(Object.keys(FORMATIONS) as FormationName[]).map(f => opt('form', f, f, this.formation === f)).join('')}</div>
        </section>
        <section class="panel"><h3>Ассист управления</h3>
          <div class="opts">${(Object.keys(ASSISTS) as AssistLevel[]).map(a => opt('assist', a, ASSISTS[a].name, this.assist === a, { full: 'Пасы и удары с наведением', semi: 'Частичная помощь', manual: 'Всё вручную' }[a])).join('')}</div>
        </section>
        <section class="panel"><h3>Графика</h3>
          <div class="opts">${(['low', 'medium', 'high'] as GraphicsLevel[]).map(g => opt('gfx', g, { low: 'Низкая', medium: 'Средняя', high: 'Высокая' }[g], this.graphics === g, { low: 'Для слабых телефонов', medium: 'Тени, без эффектов', high: 'Тени и пост-обработка' }[g])).join('')}</div>
        </section>
      </div>
      <div class="row-btns bottom">
        <button class="btn" data-a="back">Назад</button>
        <button class="btn primary" data-a="play">ИГРАТЬ</button>
      </div>`, 'settings-screen');
    this.bind('.opt', el => {
      const g = el.dataset.g!, v = el.dataset.v!;
      if (g === 'kitu') this.homeKit = v as 'home' | 'away';
      if (g === 'kitb') this.awayKit = v as 'home' | 'away';
      if (g === 'stadium') this.stadium = v as StadiumId;
      if (g === 'diff') this.difficulty = +v as 0 | 1 | 2;
      if (g === 'half') this.halfMinutes = +v as 2 | 4 | 6;
      if (g === 'form') this.formation = v as FormationName;
      if (g === 'assist') { this.assist = v as AssistLevel; localStorageSet('uf26-assist', v); }
      if (g === 'gfx') { this.graphics = v as GraphicsLevel; saveGraphics(this.graphics); }
      this.showSettings();
    });
    this.bind('[data-a="back"]', () => this.showTeams());
    this.bind('[data-a="play"]', () => this.cb.onStart(this.config()));
  }

  private config(): MatchConfig {
    return {
      home: this.userTeam, away: this.botTeam,
      homeKit: this.homeKit, awayKit: this.awayKit,
      stadium: this.stadium, difficulty: this.difficulty,
      halfMinutes: this.halfMinutes, formation: this.formation,
      assist: this.assist, graphics: this.graphics,
    };
  }

  // ───────────── загрузка ─────────────
  showLoading(cfg: MatchConfig) {
    const lineup = (t: TeamData, form: FormationName, kit: Kit) => {
      const slots = FORMATIONS[form];
      return `<div class="lineup" style="--c1:${kit.shirt}">
        <div class="lu-head">${emblemHTML(t.emblem, 54)}<div><b>${esc(t.name)}</b><span>${form} · OVR ${teamOvr(t).ovr}</span></div></div>
        <div class="lu-list">${t.starters.map((p, i) => `<div class="lu-row"><span class="pos">${slots[i].label}</span><span class="num" style="background:${kit.shirt};color:${kit.number}">${p.number}</span><span class="nm">${esc(p.name)}</span><span class="ovr">${p.ovr}</span></div>`).join('')}</div>
        <div class="lu-subs">Запасные: ${t.subs.map(p => esc(p.name)).join(', ')}</div>
      </div>`;
    };
    const st = STADIUMS.find(s => s.id === cfg.stadium)!;
    this.bg(`
      <div class="loading">
        ${lineup(cfg.home, cfg.formation, cfg.home[cfg.homeKit])}
        <div class="lo-mid">
          <div class="lo-vs">VS</div>
          <div class="lo-info"><b>${st.name}</b><span>${st.desc}</span><span>Сложность: ${DIFFICULTIES[cfg.difficulty].name}</span><span>Тайм: ${cfg.halfMinutes} мин</span></div>
          <div class="lo-bar"><i></i></div>
          <div class="lo-label">Загрузка…</div>
        </div>
        ${lineup(cfg.away, cfg.away.formation, cfg.away[cfg.awayKit])}
      </div>`, 'loading-screen');
    this.loadingBar = this.el.querySelector('.lo-bar i');
    this.loadingLabel = this.el.querySelector('.lo-label');
  }

  setProgress(p: number, label: string) {
    if (this.loadingBar) this.loadingBar.style.width = `${Math.round(p * 100)}%`;
    if (this.loadingLabel) this.loadingLabel.textContent = label;
  }

  waitStart(): Promise<void> {
    if (this.loadingLabel) this.loadingLabel.innerHTML = `<span class="blink">${SHOW_TOUCH ? 'Коснитесь экрана, чтобы начать' : 'Нажмите любую клавишу или кликните, чтобы начать'}</span>`;
    return new Promise(res => {
      const go = () => {
        window.removeEventListener('keydown', go);
        this.el.removeEventListener('click', go);
        clearInterval(padTimer);
        res();
      };
      const padTimer = window.setInterval(() => {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads) if (p && p.buttons.some(b => b.pressed)) go();
      }, 100);
      setTimeout(() => {
        window.addEventListener('keydown', go);
        this.el.addEventListener('click', go);
      }, 300);
    });
  }

  // ───────────── итоги ─────────────
  showStats(r: MatchResult) {
    const [h, a] = [r.cfg.home, r.cfg.away];
    const [sh, sa] = r.stats;
    const total = sh.possession + sa.possession || 1;
    const ph = Math.round((sh.possession / total) * 100);
    const rows: [string, number | string, number | string, number, number][] = [
      ['Владение', `${ph}%`, `${100 - ph}%`, ph, 100 - ph],
      ['Удары', sh.shots, sa.shots, sh.shots, sa.shots],
      ['Удары в створ', sh.onTarget, sa.onTarget, sh.onTarget, sa.onTarget],
      ['Сейвы', sh.saves, sa.saves, sh.saves, sa.saves],
      ['Пасы', sh.passes, sa.passes, sh.passes, sa.passes],
      ['Точность пасов', `${sh.passes ? Math.round((sh.passesDone / sh.passes) * 100) : 0}%`, `${sa.passes ? Math.round((sa.passesDone / sa.passes) * 100) : 0}%`, sh.passesDone / (sh.passes || 1), sa.passesDone / (sa.passes || 1)],
      ['Угловые', sh.corners, sa.corners, sh.corners, sa.corners],
      ['Фолы', sh.fouls, sa.fouls, sh.fouls, sa.fouls],
      ['Офсайды', sh.offsides, sa.offsides, sh.offsides, sa.offsides],
    ];
    const scorers = (t: number) => r.goals.filter(g => g.team === t).map(g => `<div>⚽ ${esc(g.name)} ${g.minute}'${g.own ? ' (АГ)' : ''}${g.penalty ? ' (пен.)' : ''}</div>`).join('') || '<div class="muted">—</div>';
    const res = r.score[0] > r.score[1] ? 'ПОБЕДА' : r.score[0] < r.score[1] ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';
    this.bg(`
      <div class="stats-screen">
        <div class="result-tag ${res === 'ПОБЕДА' ? 'win' : res === 'ПОРАЖЕНИЕ' ? 'lose' : 'draw'}">${res}</div>
        <div class="final">
          <div class="f-team">${emblemHTML(h.emblem, 70)}<b>${esc(h.name)}</b><div class="scorers">${scorers(0)}</div></div>
          <div class="f-score">${r.score[0]} : ${r.score[1]}<span>Финальный свисток</span></div>
          <div class="f-team">${emblemHTML(a.emblem, 70)}<b>${esc(a.name)}</b><div class="scorers">${scorers(1)}</div></div>
        </div>
        <div class="panel stat-table">
          ${rows.map(([n, va, vb, na, nb]) => {
            const s = na + nb || 1;
            return `<div class="st-row"><b>${va}</b><div class="st-mid"><span>${n}</span><div class="st-bar"><i style="width:${(na / s) * 100}%;background:${h[r.cfg.homeKit].shirt}"></i><i style="width:${(nb / s) * 100}%;background:${a[r.cfg.awayKit].shirt}"></i></div></div><b>${vb}</b></div>`;
          }).join('')}
        </div>
        <div class="row-btns">
          <button class="btn" data-a="rematch">Реванш</button>
          <button class="btn primary" data-a="menu">В главное меню</button>
        </div>
      </div>`, 'stats');
    this.bind('[data-a="menu"]', () => this.showMain());
    this.bind('[data-a="rematch"]', () => this.cb.onStart(r.cfg));
  }
}

function localStorageGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* приватный режим */ }
}
