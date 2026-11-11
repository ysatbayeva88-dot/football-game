import { AI_ASSISTS, ASSISTS, DIFFICULTIES, FORMATIONS, STADIUMS } from '../game/constants';
import { teamOvr } from '../game/Team';
import type { AiAssistLevel, AssistLevel, FormationName, GraphicsLevel, Kit, MatchConfig, MatchResult, PlayerData, StadiumId, TeamData } from '../game/types';
import { colorDistance, crestHTML, esc } from './emblem';
import { CONTROLS_HTML } from './HUD';
import { SHOW_TOUCH, defaultGraphics, saveGraphics } from '../game/quality';

export interface MenuCallbacks {
  onStart(cfg: MatchConfig): void;
  onClick(): void;
  onHover(): void;
  /** Показать клуб в 3D-фоне (витрина на экране выбора команд). */
  onPreview(team: TeamData, kit: 'home' | 'away', showcase: boolean): void;
  onGraphics(g: GraphicsLevel): void;
  onMusic(v: number): void;
  onSfx(v: number): void;
  getVolumes(): { music: number; sfx: number };
}

const ICONS = {
  ball: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 6.5l4 2.9-1.5 4.7h-5L8 9.4z" fill="currentColor"/><path d="M12 2v4.5M16 9.4l5-1.4M14.5 14.1l3 4.3M9.5 14.1l-3 4.3M8 9.4l-5-1.4" stroke="currentColor" stroke-width="1.4"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>',
  pad: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 7h10a5 5 0 0 1 4.9 6l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14.5 16h-5l-2.3 2.2A2.5 2.5 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7zm0 3v1.5H5.5V13H7v1.5h1.5V13H10v-1.5H8.5V10zm9 .5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2.5 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
  exit: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9v-2h9V5h-9zm-1.6 5.4L5.8 11H15v2H5.8l2.6 2.6L7 17l-5-5 5-5z"/></svg>',
};

function kitSVG(k: Kit, size = 70) {
  let pattern = '';
  if (k.pattern === 'stripes') pattern = [22, 40, 58, 76].map(x => `<rect x="${x}" y="10" width="9" height="90" fill="${k.stripe}" clip-path="url(#kitbody)"/>`).join('');
  if (k.pattern === 'band') pattern = `<rect x="41" y="10" width="18" height="90" fill="${k.stripe}" clip-path="url(#kitbody)"/>`;
  if (k.pattern === 'hoops') pattern = [30, 52, 74].map(y => `<rect x="0" y="${y}" width="100" height="9" fill="${k.stripe}" clip-path="url(#kitbody)"/>`).join('');
  return `<svg viewBox="0 0 100 110" width="${size}" height="${size * 1.1}">
    <defs><clipPath id="kitbody"><path d="M28 12 L40 6 Q50 14 60 6 L72 12 L72 100 L28 100 Z"/></clipPath></defs>
    <path d="M28 12 L8 26 L16 44 L28 38 Z" fill="${k.sleeves}" stroke="#0006"/>
    <path d="M72 12 L92 26 L84 44 L72 38 Z" fill="${k.sleeves}" stroke="#0006"/>
    <path d="M28 12 L40 6 Q50 14 60 6 L72 12 L72 100 L28 100 Z" fill="${k.shirt}" stroke="#0006"/>
    ${pattern}
    <text x="50" y="62" text-anchor="middle" font-size="22" font-weight="800" fill="${k.number}" font-family="Arial">10</text>
    <rect x="30" y="100" width="40" height="8" fill="${k.shorts}" stroke="#0006"/>
  </svg>`;
}

function stars(ovr: number) {
  const v = Math.max(1, Math.min(5, (ovr - 66) / 4.4));
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<i class="star ${v >= i ? 'full' : v >= i - 0.5 ? 'half' : ''}">★</i>`;
  return `<span class="stars" title="${v.toFixed(1)} из 5">${out}</span>`;
}

function surname(n: string) {
  const p = n.split(' ');
  return p.length > 1 ? p.slice(-1)[0] : n;
}

export class Menu {
  el: HTMLElement;
  private userIdx = 0;
  private botIdx = 1;
  private focus: 'u' | 'b' = 'u';
  private homeKit: 'home' | 'away' = 'home';
  private awayKit: 'home' | 'away' = 'home';
  private stadium: StadiumId = 'night';
  private difficulty: 0 | 1 | 2 = 1;
  private halfMinutes: 2 | 4 | 6 = 4;
  private formation: FormationName = '4-3-3';
  private assist: AssistLevel = (lsGet('uf26-assist') as AssistLevel) || 'full';
  private graphics: GraphicsLevel = defaultGraphics();
  private aiAssist: AiAssistLevel = (lsGet('uf26-aiassist') as AiAssistLevel) || 'full';
  private lineup: { starters: PlayerData[]; subs: PlayerData[] } | null = null;
  private sel: { where: 's' | 'b'; i: number } | null = null;
  private loadingBar: HTMLElement | null = null;
  private loadingLabel: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(root: HTMLElement, private teams: TeamData[], private cb: MenuCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    root.appendChild(this.el);
    this.formation = this.user.formation;
    this.el.addEventListener('click', e => { if ((e.target as HTMLElement).closest('button,.card,.opt,.tile,.pcard')) this.cb.onClick(); });
    this.el.addEventListener('pointerover', e => {
      const t = (e.target as HTMLElement).closest('button,.tile,.opt,.pcard');
      if (t && !t.contains(e.relatedTarget as Node)) this.cb.onHover();
    });
  }

  get user() { return this.teams[this.userIdx]; }
  get bot() { return this.teams[this.botIdx]; }
  get graphicsLevel() { return this.graphics; }

  show() { this.el.style.display = 'flex'; }
  hide() { this.el.style.display = 'none'; this.el.innerHTML = ''; this.setKeys(null); this.lastScreen = ''; }

  private lastScreen = '';
  private screen(inner: string, cls = '') {
    // анимация появления — только при переходе на другой экран, не при перерисовке того же
    const still = cls === this.lastScreen ? ' still' : '';
    this.lastScreen = cls;
    this.el.innerHTML = `<div class="menu-shade ${cls}"></div><div class="screen ${cls}${still}">${inner}</div>`;
    this.show();
  }

  private bind(sel: string, fn: (el: HTMLElement) => void) {
    this.el.querySelectorAll(sel).forEach(e => e.addEventListener('click', () => fn(e as HTMLElement)));
  }

  private setKeys(fn: ((e: KeyboardEvent) => void) | null) {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = fn;
    if (fn) window.addEventListener('keydown', fn);
  }

  /** Стрелки перемещают фокус по кнопкам, Enter — нажатие. */
  private arrowNav(selector: string) {
    this.setKeys(e => {
      const items = Array.from(this.el.querySelectorAll<HTMLElement>(selector));
      if (!items.length) return;
      const cur = items.indexOf(document.activeElement as HTMLElement);
      if (['ArrowDown', 'ArrowRight'].includes(e.code)) { e.preventDefault(); items[(cur + 1 + items.length) % items.length].focus(); this.cb.onHover(); }
      if (['ArrowUp', 'ArrowLeft'].includes(e.code)) { e.preventDefault(); items[(cur - 1 + items.length * 2) % items.length].focus(); this.cb.onHover(); }
      if (e.code === 'Escape') (this.el.querySelector('[data-a="back"]') as HTMLElement | null)?.click();
    });
    setTimeout(() => this.el.querySelector<HTMLElement>(selector)?.focus(), 50);
  }

  // ───────────── главный экран ─────────────
  showMain() {
    this.cb.onPreview(this.user, 'home', false);
    this.screen(`
      <div class="main-layout">
        <div class="brand">
          <div class="logo"><span>ULTRA</span> FOOTBALL <em>26</em></div>
          <div class="tag">Быстрый матч · 12 топ-клубов</div>
        </div>
        <nav class="tiles">
          <button class="tile hero" data-a="quick"><div class="ico">${ICONS.ball}</div><div class="tx"><b>Быстрый матч</b><span>Выберите клубы и выходите на поле</span></div><i class="arrow">›</i></button>
          <button class="tile" data-a="settings"><div class="ico">${ICONS.gear}</div><div class="tx"><b>Настройки</b><span>Графика, ассист, звук</span></div></button>
          <button class="tile" data-a="controls"><div class="ico">${ICONS.pad}</div><div class="tx"><b>Управление</b><span>${SHOW_TOUCH ? 'Сенсор, клавиатура, геймпад' : 'Клавиатура и геймпад'}</span></div></button>
          <button class="tile" data-a="exit"><div class="ico">${ICONS.exit}</div><div class="tx"><b>Выход</b><span>Закончить игру</span></div></button>
        </nav>
        <div class="footer-note">Эмблемы клубов — из папки public/crests · составы — src/data/teams.json</div>
      </div>`, 'main');
    this.bind('[data-a="quick"]', () => this.showTeams());
    this.bind('[data-a="settings"]', () => this.showSettings());
    this.bind('[data-a="controls"]', () => this.showControls());
    this.bind('[data-a="exit"]', () => this.exit());
    this.arrowNav('.tile');
  }

  private exit() {
    window.close();
    setTimeout(() => {
      this.screen(`<div class="panel center-panel"><h2>До встречи!</h2><p>Браузер не даёт закрыть вкладку из игры — просто закройте её.</p><div class="row-btns"><button class="btn primary" data-a="back">В меню</button></div></div>`);
      this.bind('[data-a="back"]', () => this.showMain());
      this.arrowNav('.btn');
    }, 250);
  }

  private showControls() {
    this.screen(`<div class="panel center-panel wide"><h2>Управление</h2>${CONTROLS_HTML}<div class="row-btns"><button class="btn" data-a="back">Назад</button></div></div>`);
    this.bind('[data-a="back"]', () => this.showMain());
    this.arrowNav('.btn');
  }

  // ───────────── настройки ─────────────
  private showSettings() {
    const vol = this.cb.getVolumes();
    const opt = (g: string, v: string, label: string, on: boolean, sub = '') =>
      `<button class="opt ${on ? 'on' : ''}" data-g="${g}" data-v="${v}"><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
    this.screen(`
      <h1 class="screen-title">Настройки</h1>
      <div class="settings one-col">
        <section class="panel"><h3>Графика</h3>
          <div class="opts">${(['low', 'medium', 'high'] as GraphicsLevel[]).map(g => opt('gfx', g, { low: 'Низкая', medium: 'Средняя', high: 'Высокая' }[g], this.graphics === g, { low: 'Без теней, для слабых устройств', medium: 'Тени, без пост-обработки', high: 'Тени, SSAO, bloom, SMAA' }[g])).join('')}</div>
        </section>
        <section class="panel"><h3>Ассист управления</h3>
          <div class="opts">${(Object.keys(ASSISTS) as AssistLevel[]).map(a => opt('assist', a, ASSISTS[a].name, this.assist === a, { full: 'Пасы и удары с наведением', semi: 'Частичная помощь', manual: 'Всё вручную' }[a])).join('')}</div>
        </section>
        <section class="panel"><h3>Ассист ИИ</h3>
          <div class="opts">${(Object.keys(AI_ASSISTS) as AiAssistLevel[]).map(a => opt('aiassist', a, AI_ASSISTS[a].name, this.aiAssist === a, { full: 'Сам принимает пасы, бежит к мячу, сопровождает и отбирает', semi: 'Приём паса и подбор мяча, помощь вблизи', off: 'Без помощи ИИ' }[a])).join('')}</div>
        </section>
        <section class="panel"><h3>Звук</h3>
          <label class="slider"><span>Музыка в меню</span><input type="range" min="0" max="100" value="${Math.round(vol.music * 100)}" data-s="music"><b>${Math.round(vol.music * 100)}</b></label>
          <label class="slider"><span>Эффекты и трибуны</span><input type="range" min="0" max="100" value="${Math.round(vol.sfx * 100)}" data-s="sfx"><b>${Math.round(vol.sfx * 100)}</b></label>
        </section>
      </div>
      <div class="row-btns bottom"><button class="btn primary" data-a="back">Готово</button></div>`, 'settings-screen');
    this.bind('.opt', el => {
      const g = el.dataset.g!, v = el.dataset.v!;
      if (g === 'gfx') { this.graphics = v as GraphicsLevel; saveGraphics(this.graphics); this.cb.onGraphics(this.graphics); }
      if (g === 'assist') { this.assist = v as AssistLevel; lsSet('uf26-assist', v); }
      if (g === 'aiassist') { this.aiAssist = v as AiAssistLevel; lsSet('uf26-aiassist', v); }
      this.showSettings();
    });
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(inp => inp.addEventListener('input', () => {
      const v = +inp.value / 100;
      (inp.nextElementSibling as HTMLElement).textContent = inp.value;
      if (inp.dataset.s === 'music') this.cb.onMusic(v); else this.cb.onSfx(v);
    }));
    this.bind('[data-a="back"]', () => this.showMain());
    this.arrowNav('.opt, .btn');
  }

  // ───────────── выбор команд ─────────────
  private teamCard(side: 'u' | 'b') {
    const t = side === 'u' ? this.user : this.bot;
    const r = teamOvr(t);
    const best = t.starters.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 3);
    return `<div class="tcard ${this.focus === side ? 'focus' : ''}" data-side="${side}" style="--c1:${t.home.shirt};--c2:${t.emblem.border}">
      <div class="tc-label">${side === 'u' ? 'ВЫ' : 'КОМПЬЮТЕР'}</div>
      <div class="tc-row">
        <button class="arrow-btn" data-nav="${side}" data-d="-1" aria-label="Предыдущий клуб">‹</button>
        <div class="tc-crest" data-team="${t.id}">${crestHTML(t, 110)}</div>
        <button class="arrow-btn" data-nav="${side}" data-d="1" aria-label="Следующий клуб">›</button>
      </div>
      <div class="tc-name">${esc(t.name)}</div>
      <div class="tc-stars">${stars(r.ovr)}</div>
      <div class="tc-ovr"><b>${r.ovr}</b><span>OVR</span></div>
      <div class="tc-bars">
        ${[['АТК', r.atk], ['ПЗ', r.mid], ['ЗАЩ', r.def]].map(([n, v]) => `<div class="bar"><span>${n}</span><i><em style="width:${Math.max(4, (+v - 60) * 2.6)}%"></em></i><b>${v}</b></div>`).join('')}
      </div>
      <div class="tc-best">${best.map(p => `<span><b>${p.ovr}</b> ${esc(surname(p.name))}</span>`).join('')}</div>
      <div class="tc-dots">${this.teams.map((_, i) => `<i class="${i === (side === 'u' ? this.userIdx : this.botIdx) ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
  }

  private showTeams() {
    const focusTeam = this.focus === 'u' ? this.user : this.bot;
    this.cb.onPreview(focusTeam, 'home', true);
    this.screen(`
      <h1 class="screen-title">Выбор команд</h1>
      <div class="teams-v2">
        <div class="tcards">${this.teamCard('u')}<div class="vs">VS</div>${this.teamCard('b')}</div>
        <div class="showcase-space"><div class="showcase-label">${esc(focusTeam.name)}<span>${esc(focusTeam.city)}</span></div></div>
      </div>
      <div class="hint-row">${SHOW_TOUCH ? 'Листайте свайпом или стрелками ‹ ›' : '← → — сменить клуб · ↑ ↓ — переключить сторону · Enter — далее'}</div>
      <div class="row-btns bottom">
        <button class="btn" data-a="back">Назад</button>
        <button class="btn" data-a="random">Случайно</button>
        <button class="btn primary" data-a="next">Далее</button>
      </div>`, 'teams');
    const nav = (side: 'u' | 'b', d: number) => {
      const n = this.teams.length;
      if (side === 'u') { do { this.userIdx = (this.userIdx + d + n) % n; } while (this.userIdx === this.botIdx); this.formation = this.user.formation; this.lineup = null; }
      else { do { this.botIdx = (this.botIdx + d + n) % n; } while (this.botIdx === this.userIdx); }
      this.focus = side;
      this.showTeams();
    };
    this.el.querySelectorAll<HTMLElement>('.arrow-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); nav(b.dataset.nav as 'u' | 'b', +b.dataset.d!); }));
    this.el.querySelectorAll<HTMLElement>('.tcard').forEach(card => {
      card.addEventListener('click', () => { if (this.focus !== card.dataset.side) { this.focus = card.dataset.side as 'u' | 'b'; this.showTeams(); } });
      let sx = 0, sy = 0;
      card.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
      card.addEventListener('pointerup', e => {
        const dx = e.clientX - sx;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - sy)) { this.cb.onClick(); nav(card.dataset.side as 'u' | 'b', dx < 0 ? 1 : -1); }
      });
    });
    this.bind('[data-a="random"]', () => {
      const n = this.teams.length;
      this.userIdx = Math.floor(Math.random() * n);
      do { this.botIdx = Math.floor(Math.random() * n); } while (this.botIdx === this.userIdx);
      this.formation = this.user.formation; this.lineup = null;
      this.showTeams();
    });
    this.bind('[data-a="back"]', () => this.showMain());
    this.bind('[data-a="next"]', () => { this.autoKits(); this.showMatchSettings(); });
    this.setKeys(e => {
      if (e.code === 'ArrowLeft') { e.preventDefault(); this.cb.onClick(); nav(this.focus, -1); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); this.cb.onClick(); nav(this.focus, 1); }
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); this.focus = this.focus === 'u' ? 'b' : 'u'; this.cb.onHover(); this.showTeams(); }
      else if (e.code === 'Enter') { e.preventDefault(); this.cb.onClick(); this.autoKits(); this.showMatchSettings(); }
      else if (e.code === 'Escape') this.showMain();
    });
  }

  private autoKits() {
    this.homeKit = 'home';
    this.awayKit = 'home';
    if (colorDistance(this.user.home.shirt, this.bot.home.shirt) < 80) this.awayKit = 'away';
    if (colorDistance(this.user.home.shirt, this.bot[this.awayKit].shirt) < 80) this.homeKit = 'away';
  }

  // ───────────── настройки матча ─────────────
  private showMatchSettings() {
    const u = this.user, b = this.bot;
    this.cb.onPreview(u, this.homeKit, false);
    const clash = colorDistance(u[this.homeKit].shirt, b[this.awayKit].shirt) < 70;
    const opt = (group: string, val: string, label: string, active: boolean, sub = '') =>
      `<button class="opt ${active ? 'on' : ''}" data-g="${group}" data-v="${val}"><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
    const kitPick = (t: TeamData, side: 'u' | 'b', cur: 'home' | 'away') => `
      <div class="kit-pick">
        <div class="kit-team">${crestHTML(t, 34)}<span>${esc(t.name)}</span></div>
        <div class="kits">
          <button class="opt kit ${cur === 'home' ? 'on' : ''}" data-g="kit${side}" data-v="home">${kitSVG(t.home)}<span>Домашняя</span></button>
          <button class="opt kit ${cur === 'away' ? 'on' : ''}" data-g="kit${side}" data-v="away">${kitSVG(t.away)}<span>Выездная</span></button>
        </div>
      </div>`;
    this.screen(`
      <h1 class="screen-title">Настройки матча</h1>
      <div class="settings">
        <section class="panel s-kits"><h3>Форма</h3>
          <div class="kits-row">${kitPick(u, 'u', this.homeKit)}${kitPick(b, 'b', this.awayKit)}</div>
          ${clash ? '<div class="warn">⚠ Формы похожи по цвету — выберите другую</div>' : ''}
        </section>
        <section class="panel"><h3>Стадион</h3>
          <div class="opts stadiums">${STADIUMS.map(s => `<button class="opt stad ${s.id} ${this.stadium === s.id ? 'on' : ''}" data-g="stadium" data-v="${s.id}"><div class="stad-pic"></div><b>${s.name}</b><span>${s.desc}</span></button>`).join('')}</div>
        </section>
        <section class="panel"><h3>Сложность бота</h3>
          <div class="opts">${DIFFICULTIES.map((d, i) => opt('diff', String(i), d.name, this.difficulty === i, ['Ошибается, думает медленно', 'Сбалансированная игра', 'Быстрые комбинации, удары издали'][i])).join('')}</div>
        </section>
        <section class="panel"><h3>Длительность тайма</h3>
          <div class="opts">${[2, 4, 6].map(n => opt('half', String(n), `${n} мин`, this.halfMinutes === n)).join('')}</div>
          <h3>Ассист управления</h3>
          <div class="opts">${(Object.keys(ASSISTS) as AssistLevel[]).map(a => opt('assist', a, ASSISTS[a].name, this.assist === a)).join('')}</div>
          <h3>Ассист ИИ</h3>
          <div class="opts">${(Object.keys(AI_ASSISTS) as AiAssistLevel[]).map(a => opt('aiassist', a, AI_ASSISTS[a].name, this.aiAssist === a)).join('')}</div>
        </section>
      </div>
      <div class="row-btns bottom">
        <button class="btn" data-a="back">Назад</button>
        <button class="btn primary" data-a="next">Состав ›</button>
      </div>`, 'settings-screen');
    this.bind('.opt', el => {
      const g = el.dataset.g!, v = el.dataset.v!;
      if (g === 'kitu') this.homeKit = v as 'home' | 'away';
      if (g === 'kitb') this.awayKit = v as 'home' | 'away';
      if (g === 'stadium') this.stadium = v as StadiumId;
      if (g === 'diff') this.difficulty = +v as 0 | 1 | 2;
      if (g === 'half') this.halfMinutes = +v as 2 | 4 | 6;
      if (g === 'assist') { this.assist = v as AssistLevel; lsSet('uf26-assist', v); }
      if (g === 'aiassist') { this.aiAssist = v as AiAssistLevel; lsSet('uf26-aiassist', v); }
      this.showMatchSettings();
    });
    this.bind('[data-a="back"]', () => this.showTeams());
    this.bind('[data-a="next"]', () => this.showLineup());
    this.arrowNav('.opt, .btn');
  }

  // ───────────── состав ─────────────
  private showLineup() {
    const t = this.user;
    if (!this.lineup) this.lineup = { starters: t.starters.map(p => ({ ...p })), subs: t.subs.map(p => ({ ...p })) };
    const L = this.lineup;
    const slots = FORMATIONS[this.formation];
    const card = (p: PlayerData, where: 's' | 'b', i: number, label: string, style = '') => {
      const s = this.sel && this.sel.where === where && this.sel.i === i;
      return `<button class="pcard ${s ? 'sel' : ''} ${where === 'b' ? 'bench' : ''}" data-w="${where}" data-i="${i}" style="${style};--c1:${t[this.homeKit].shirt};--c2:${t[this.homeKit].number}">
        <span class="pc-ovr">${p.ovr}</span><span class="pc-pos">${label}</span><span class="pc-num">${p.number}</span><span class="pc-name">${esc(surname(p.name))}</span></button>`;
    };
    const pitch = L.starters.map((p, i) => {
      const s = slots[i];
      const left = ((s.x + 1) / 2) * 84 + 8, top = ((s.z + 1) / 2) * 76 + 12;
      return card(p, 's', i, s.label, `left:${left}%;top:${top}%`);
    }).join('');
    const avg = Math.round(L.starters.reduce((a, p) => a + p.ovr, 0) / 11);
    this.screen(`
      <h1 class="screen-title">Состав: ${esc(t.name)}</h1>
      <div class="lineup-v2">
        <div class="board"><div class="board-lines"><i class="half"></i><i class="circle"></i><i class="box l"></i><i class="box r"></i></div>${pitch}</div>
        <div class="bench-col">
          <div class="panel">
            <h3>Схема</h3>
            <div class="opts">${(Object.keys(FORMATIONS) as FormationName[]).map(f => `<button class="opt ${this.formation === f ? 'on' : ''}" data-f="${f}"><b>${f}</b></button>`).join('')}</div>
            <h3>Запасные</h3>
            <div class="bench-list">${L.subs.map((p, i) => card(p, 'b', i, p.pos)).join('')}</div>
            <div class="lu-ovr">Средний рейтинг состава: <b>${avg}</b></div>
            <p class="hint-small">Нажмите на двух игроков, чтобы поменять их местами (в том числе со скамейкой).</p>
          </div>
        </div>
      </div>
      <div class="row-btns bottom">
        <button class="btn" data-a="back">Назад</button>
        <button class="btn" data-a="reset">Сбросить</button>
        <button class="btn primary" data-a="play">ИГРАТЬ</button>
      </div>`, 'lineup-screen');
    this.el.querySelectorAll<HTMLElement>('.pcard').forEach(b => b.addEventListener('click', () => {
      const where = b.dataset.w as 's' | 'b', i = +b.dataset.i!;
      if (!this.sel) { this.sel = { where, i }; this.showLineup(); return; }
      const a = this.sel;
      this.sel = null;
      if (!(a.where === where && a.i === i)) {
        const arr = (w: 's' | 'b') => (w === 's' ? L.starters : L.subs);
        const pa = arr(a.where)[a.i], pb = arr(where)[i];
        arr(a.where)[a.i] = pb;
        arr(where)[i] = pa;
      }
      this.showLineup();
    }));
    this.el.querySelectorAll<HTMLElement>('[data-f]').forEach(b => b.addEventListener('click', () => { this.formation = b.dataset.f as FormationName; this.showLineup(); }));
    this.bind('[data-a="reset"]', () => { this.lineup = null; this.sel = null; this.formation = t.formation; this.showLineup(); });
    this.bind('[data-a="back"]', () => this.showMatchSettings());
    this.bind('[data-a="play"]', () => this.cb.onStart(this.config()));
    this.setKeys(e => { if (e.code === 'Escape') this.showMatchSettings(); });
  }

  private config(): MatchConfig {
    const L = this.lineup;
    const home: TeamData = L ? { ...this.user, starters: L.starters.map(p => ({ ...p })), subs: L.subs.map(p => ({ ...p })) } : this.user;
    return {
      home, away: this.bot,
      homeKit: this.homeKit, awayKit: this.awayKit,
      stadium: this.stadium, difficulty: this.difficulty,
      halfMinutes: this.halfMinutes, formation: this.formation,
      assist: this.assist, aiAssist: this.aiAssist, graphics: this.graphics,
    };
  }

  // ───────────── загрузка ─────────────
  showLoading(cfg: MatchConfig) {
    this.setKeys(null);
    const lineup = (t: TeamData, form: FormationName, kit: Kit) => {
      const slots = FORMATIONS[form];
      return `<div class="lineup" style="--c1:${kit.shirt}">
        <div class="lu-head">${crestHTML(t, 54)}<div><b>${esc(t.name)}</b><span>${form} · OVR ${teamOvr(t).ovr}</span></div></div>
        <div class="lu-list">${t.starters.map((p, i) => `<div class="lu-row"><span class="pos">${slots[i].label}</span><span class="num" style="background:${kit.shirt};color:${kit.number}">${p.number}</span><span class="nm">${esc(p.name)}</span><span class="ovr">${p.ovr}</span></div>`).join('')}</div>
        <div class="lu-subs">Запасные: ${t.subs.map(p => esc(p.name)).join(', ')}</div>
      </div>`;
    };
    const st = STADIUMS.find(s => s.id === cfg.stadium)!;
    this.screen(`
      <div class="loading">
        ${lineup(cfg.home, cfg.formation, cfg.home[cfg.homeKit])}
        <div class="lo-mid">
          <div class="lo-vs">VS</div>
          <div class="lo-info"><b>${st.name}</b><span>${st.desc}</span><span>Сложность: ${DIFFICULTIES[cfg.difficulty].name}</span><span>Тайм: ${cfg.halfMinutes} мин · Ассист: ${ASSISTS[cfg.assist].name} · ИИ: ${AI_ASSISTS[cfg.aiAssist ?? 'full'].name}</span></div>
          <div class="lo-bar"><i></i></div>
          <div class="lo-label">Загрузка…</div>
        </div>
        ${lineup(cfg.away, cfg.away.formation, cfg.away[cfg.awayKit])}
      </div>`, 'loading-screen solid');
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
    this.screen(`
      <div class="stats-screen">
        <div class="result-tag ${res === 'ПОБЕДА' ? 'win' : res === 'ПОРАЖЕНИЕ' ? 'lose' : 'draw'}">${res}</div>
        <div class="final">
          <div class="f-team">${crestHTML(h, 70)}<b>${esc(h.name)}</b><div class="scorers">${scorers(0)}</div></div>
          <div class="f-score">${r.score[0]} : ${r.score[1]}<span>Финальный свисток</span></div>
          <div class="f-team">${crestHTML(a, 70)}<b>${esc(a.name)}</b><div class="scorers">${scorers(1)}</div></div>
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
      </div>`, 'stats solid');
    this.bind('[data-a="menu"]', () => this.showMain());
    this.bind('[data-a="rematch"]', () => this.cb.onStart(r.cfg));
    this.arrowNav('.btn');
  }
}

function lsGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* приватный режим */ }
}
