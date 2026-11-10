import * as THREE from 'three';
import './style.css';
import teamsJson from './data/teams.json';
import { GameAudio } from './game/Audio';
import { Game } from './game/Game';
import type { MatchConfig, TeamData } from './game/types';
import { Menu } from './ui/Menu';
import { MenuScene } from './ui/MenuScene';
import { IS_MOBILE, IS_TOUCH, SHOW_TOUCH } from './game/quality';

const teams = (teamsJson as unknown as { teams: TeamData[] }).teams;

if (SHOW_TOUCH) document.documentElement.classList.add('touch-ui');
const app = document.getElementById('app')!;
const canvasWrap = document.createElement('div');
canvasWrap.className = 'game-canvas';
app.appendChild(canvasWrap);
const hudRoot = document.createElement('div');
hudRoot.className = 'hud-root';
app.appendChild(hudRoot);

const renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvasWrap.appendChild(renderer.domElement);

const audio = new GameAudio();
let game: Game | null = null;
let menuScene: MenuScene | null = null;

const menu = new Menu(app, teams, {
  onClick: () => { audio.click(); audio.startMusic(); },
  onHover: () => audio.hover(),
  onStart: cfg => startMatch(cfg),
  onPreview: (team, kit, showcase) => {
    if (!menuScene) return;
    menuScene.setTeam(team, kit);
    menuScene.setMode(showcase ? 'showcase' : 'orbit');
  },
  onGraphics: () => { openMenuScene(true); },
  onMusic: v => audio.setMusicVolume(v),
  onSfx: v => audio.setSfxVolume(v),
  getVolumes: () => ({ music: audio.musicVolume, sfx: audio.sfxVolume }),
});

/** 3D-фон меню (ночной стадион с разминкой). */
function openMenuScene(rebuild = false) {
  if (menuScene && !rebuild) return;
  menuScene?.dispose();
  menuScene = null;
  try {
    menuScene = new MenuScene(renderer, menu.user, menu.graphicsLevel);
    menuScene.start();
    (window as unknown as { __menuScene: MenuScene }).__menuScene = menuScene;
    canvasWrap.style.visibility = 'visible';
  } catch (e) {
    console.error('Не удалось построить 3D-фон меню', e);
  }
}

function closeMenuScene() {
  menuScene?.dispose();
  menuScene = null;
}

openMenuScene();
menu.showMain();
// музыка запускается после первого взаимодействия (так требуют браузеры)
const firstGesture = () => { audio.startMusic(); window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture); };
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture);
(window as unknown as { __menu: Menu }).__menu = menu;

async function startMatch(cfg: MatchConfig) {
  audio.ensure();
  audio.stopMusic();
  menu.showLoading(cfg);
  closeMenuScene();
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
  openMenuScene(true);
  audio.startMusic();
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
