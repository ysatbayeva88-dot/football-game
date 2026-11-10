import * as THREE from 'three';
import './style.css';
import teamsJson from './data/teams.json';
import { GameAudio } from './game/Audio';
import { Game } from './game/Game';
import type { MatchConfig, TeamData } from './game/types';
import { Menu } from './ui/Menu';
import { IS_TOUCH, LOW_QUALITY, SHOW_TOUCH } from './game/quality';

const teams = (teamsJson as unknown as { teams: TeamData[] }).teams;

if (SHOW_TOUCH) document.documentElement.classList.add('touch-ui');
const app = document.getElementById('app')!;
const canvasWrap = document.createElement('div');
canvasWrap.className = 'game-canvas';
app.appendChild(canvasWrap);
const hudRoot = document.createElement('div');
hudRoot.className = 'hud-root';
app.appendChild(hudRoot);

const renderer = new THREE.WebGLRenderer({ antialias: !LOW_QUALITY, powerPreference: 'high-performance' });
renderer.setPixelRatio(LOW_QUALITY ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !LOW_QUALITY;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvasWrap.appendChild(renderer.domElement);

const audio = new GameAudio();
let game: Game | null = null;

const menu = new Menu(app, teams, {
  onClick: () => audio.ensure(),
  onStart: cfg => startMatch(cfg),
});
menu.showMain();
(window as unknown as { __menu: Menu }).__menu = menu;

async function startMatch(cfg: MatchConfig) {
  audio.ensure();
  menu.showLoading(cfg);
  canvasWrap.style.visibility = 'hidden';
  game?.dispose();
  const g = new Game(renderer, hudRoot, cfg, audio, {
    onEnd: result => {
      endGame();
      menu.showStats(result);
    },
    onQuit: () => {
      endGame();
      menu.showMain();
    },
  });
  game = g;
  try {
    await g.build((p, label) => menu.setProgress(p, label));
  } catch (e) {
    console.error(e);
    menu.setProgress(1, 'Ошибка загрузки: ' + (e as Error).message);
    return;
  }
  await menu.waitStart();
  if (game !== g) return;
  if (IS_TOUCH) enterFullscreenLandscape();
  menu.hide();
  canvasWrap.style.visibility = 'visible';
  g.start();
  (window as unknown as { __game: Game }).__game = g;
}

function endGame() {
  game?.dispose();
  game = null;
  canvasWrap.style.visibility = 'hidden';
}

/** На телефоне: полный экран и фиксация горизонтальной ориентации (если браузер позволяет). */
function enterFullscreenLandscape() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen?.(), Promise.resolve());
    Promise.resolve(req).then(() => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return o?.lock?.('landscape');
    }).catch(() => { /* не поддерживается — остаётся подсказка «Поверни телефон» */ });
  } catch { /* игнорируем */ }
}
