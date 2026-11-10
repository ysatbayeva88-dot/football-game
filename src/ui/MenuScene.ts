import * as THREE from 'three';
import { Stadium } from '../game/Stadium';
import { KitMaterials, PlayerModel, POSE_SIZE } from '../game/PlayerModel';
import { hashStr } from '../game/constants';
import { IS_MOBILE } from '../game/quality';
import type { GraphicsLevel, Kit, TeamData } from '../game/types';

type Kind = 'jog' | 'pass' | 'stretch';
interface Warm { model: PlayerModel; kind: Kind; phase: number; base: THREE.Vector3; facing: number; kickT: number }

/**
 * 3D-фон главного меню: ночной стадион, облёт камеры, разминка игроков
 * и «витринный» игрок в форме выбранного клуба для экрана выбора команд.
 */
export class MenuScene {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(42, 1, 0.3, 5000);
  private stadium: Stadium;
  private warm: Warm[] = [];
  private kit: KitMaterials;
  private gkKit: KitMaterials;
  private showcase: PlayerModel;
  private ball: THREE.Mesh;
  private raf = 0;
  private t = 0;
  private last = 0;
  private mode: 'orbit' | 'showcase' = 'orbit';
  private camPos = new THREE.Vector3(60, 25, 50);
  private camLook = new THREE.Vector3();
  private pose = new Float32Array(POSE_SIZE);
  private passFrom = 0;
  private passT = 0;
  private onResize = () => this.resize();
  private teamName = '';

  constructor(private renderer: THREE.WebGLRenderer, team: TeamData, gfx: GraphicsLevel) {
    const g: GraphicsLevel = gfx === 'high' ? 'medium' : gfx;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, g === 'low' ? 1 : IS_MOBILE ? 1.25 : 1.5));
    renderer.shadowMap.enabled = g !== 'low';
    const k = team.home;
    this.stadium = new Stadium(this.scene, renderer, 'night', [k.shirt, k.stripe, k.shorts], ['#e0e0e0', '#222831'], g, {
      home: { short: team.short, color: k.shirt }, away: { short: 'UF26', color: '#00f0a8' },
    });
    this.kit = new KitMaterials(team.home, team.emblem);
    this.gkKit = new KitMaterials(team.gk, team.emblem);
    this.teamName = team.id;

    const ballGeo = new THREE.SphereGeometry(0.11, 20, 14);
    this.ball = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    const players = team.starters;
    const add = (i: number, kind: Kind, base: THREE.Vector3, facing = 0) => {
      const pd = players[i % players.length];
      const m = new PlayerModel(i === 0 ? this.gkKit : this.kit, pd.number, hashStr(pd.name), pd.name, i === 0);
      this.scene.add(m.root);
      this.warm.push({ model: m, kind, phase: i * 1.7, base, facing, kickT: -1 });
    };
    add(9, 'jog', new THREE.Vector3(-18, 0, -6));
    add(10, 'jog', new THREE.Vector3(-18, 0, -6));
    add(8, 'jog', new THREE.Vector3(-18, 0, -6));
    add(5, 'pass', new THREE.Vector3(4, 0, -2), Math.PI / 2);
    add(7, 'pass', new THREE.Vector3(16, 0, -2), -Math.PI / 2);
    add(2, 'stretch', new THREE.Vector3(-4, 0, 6), 0.4);
    add(3, 'stretch', new THREE.Vector3(-2, 0, 8), -0.3);
    add(0, 'stretch', new THREE.Vector3(30, 0, 4), -1.2);

    const star = players.slice().sort((a, b) => b.ovr - a.ovr)[0];
    this.showcase = new PlayerModel(this.kit, star.number, hashStr(star.name), star.name);
    this.showcase.root.position.set(-6, 0, 24);
    this.scene.add(this.showcase.root);
  }

  /** Сменить клуб (форма на всех игроках и на витрине). */
  setTeam(team: TeamData, kitName: 'home' | 'away' = 'home') {
    const key = team.id + kitName;
    if (key === this.teamName) return;
    this.teamName = key;
    const old = [this.kit, this.gkKit];
    this.kit = new KitMaterials(team[kitName] as Kit, team.emblem);
    this.gkKit = new KitMaterials(team.gk, team.emblem);
    const players = team.starters;
    this.warm.forEach((w, i) => {
      const idx = [9, 10, 8, 5, 7, 2, 3, 0][i];
      const pd = players[idx];
      w.model.setKit(idx === 0 ? this.gkKit : this.kit, pd.number, pd.name);
    });
    const star = players.slice().sort((a, b) => b.ovr - a.ovr)[0];
    this.showcase.setKit(this.kit, star.number, star.name);
    old.forEach(k => k.dispose());
  }

  setMode(m: 'orbit' | 'showcase') { this.mode = m; }

  /** Мгновенно перенести камеру в целевую точку (для отладки/тестов). */
  snapCamera() { this.snap = true; }
  private snap = false;

  start() {
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.renderer.render(this.scene, this.cam);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  private setPose(m: PlayerModel, x: number, z: number, facing: number, phase: number, speed: number, kick = -1, kind = 0, dt = 1 / 60) {
    const p = this.pose;
    p.fill(0);
    p[0] = x; p[2] = z; p[3] = facing; p[4] = phase; p[5] = speed;
    p[6] = kick; p[8] = -1; p[9] = 1; p[12] = kind;
    m.pose(p, 0, dt);
  }

  private update(dt: number) {
    this.t += dt;
    const t = this.t;
    // разминка
    const passers = this.warm.filter(w => w.kind === 'pass');
    for (const w of this.warm) {
      if (w.kind === 'jog') {
        const a = t * 0.55 + w.phase;
        const r = 7;
        const x = w.base.x + Math.cos(a) * r, z = w.base.z + Math.sin(a) * r * 0.6;
        const facing = Math.atan2(-Math.sin(a) * r, Math.cos(a) * r * 0.6);
        this.setPose(w.model, x, z, facing, t * 7.5 + w.phase, 0.5, -1, 0, dt);
      } else if (w.kind === 'stretch') {
        this.setPose(w.model, w.base.x, w.base.z, w.facing + Math.sin(t * 0.4 + w.phase) * 0.3, t * 1.2 + w.phase, 0.02, -1, 0, dt);
      } else {
        if (w.kickT >= 0) { w.kickT += dt / 0.4; if (w.kickT > 1) w.kickT = -1; }
        this.setPose(w.model, w.base.x, w.base.z, w.facing, t + w.phase, 0.03, w.kickT, 0, dt);
      }
    }
    // пас между двумя игроками
    this.passT += dt / 1.1;
    const a = passers[this.passFrom], b = passers[1 - this.passFrom];
    if (this.passT >= 1) {
      this.passT = 0;
      this.passFrom = 1 - this.passFrom;
      passers[this.passFrom].kickT = 0;
    }
    const k = Math.min(1, this.passT);
    const ax = a.base.x + Math.sign(b.base.x - a.base.x) * 0.5, bx = b.base.x - Math.sign(b.base.x - a.base.x) * 0.5;
    this.ball.position.set(ax + (bx - ax) * k, 0.11 + Math.sin(k * Math.PI) * 0.25, a.base.z + 0.15);
    this.ball.rotation.z -= dt * 12 * Math.sign(bx - ax);

    // витрина
    this.setPose(this.showcase, -6, 24, Math.PI * 0.08 + Math.sin(t * 0.5) * 0.35, t * 1.3, 0.02, -1, 0, dt);

    // камера
    const want = new THREE.Vector3(), look = new THREE.Vector3();
    if (this.mode === 'orbit') {
      const ang = t * 0.045 + 0.6;
      want.set(Math.sin(ang) * 62, 18 + Math.sin(t * 0.13) * 4, Math.cos(ang) * 46);
      look.set(0, 2, 0);
    } else {
      // игрок в правой части экрана: камера смотрит левее него
      // смещение подобрано так, чтобы игрок оказался в правой ~15–20% экрана при любом соотношении сторон
      const asp = this.cam.aspect;
      const off = asp > 1.2 ? 1.9 * Math.max(1, asp / 1.78) : 0.4;
      want.set(-6 + 0.4, 1.45, 24 + 4.2);
      look.set(-6 - off, 1.1, 24);
    }
    const kk = this.snap ? 1 : 1 - Math.exp(-dt * (this.mode === 'orbit' ? 0.8 : 3.5));
    this.snap = false;
    this.camPos.lerp(want, kk);
    this.camLook.lerp(look, kk);
    this.cam.position.copy(this.camPos);
    this.cam.lookAt(this.camLook);
    this.stadium.update(dt, t, 0.15 + Math.max(0, Math.sin(t * 0.3)) * 0.2);
  }

  dispose() {
    this.stop();
    this.stadium.dispose();
    for (const w of this.warm) w.model.dispose();
    this.showcase.dispose();
    this.kit.dispose();
    this.gkKit.dispose();
    this.ball.geometry.dispose();
    (this.ball.material as THREE.Material).dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
  }
}
