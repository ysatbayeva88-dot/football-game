import * as THREE from 'three';
import { GameAudio } from './Audio';
import { CameraRig } from './CameraRig';
import { Input } from './Input';
import { Match } from './Match';
import type { MatchEvent } from './Match';
import { POSE_SIZE } from './PlayerModel';
import { Replay } from './Replay';
import { Stadium } from './Stadium';
import type { MatchConfig, MatchResult } from './types';
import { HUD } from '../ui/HUD';
import { TouchControls } from '../ui/TouchControls';
import { IS_MOBILE, SHOW_TOUCH } from './quality';
import { PostFX } from './PostFX';

export interface GameCallbacks {
  onEnd(result: MatchResult): void;
  onQuit(): void;
}

const tick = () => new Promise<void>(r => setTimeout(r, 16));

export class Game {
  scene = new THREE.Scene();
  rig: CameraRig;
  match!: Match;
  stadium!: Stadium;
  hud!: HUD;
  input = new Input();
  replay!: Replay;
  private raf = 0;
  private last = 0;
  private paused = false;
  private introT = 0;
  private excite = 0;
  private replayActive = false;
  private ended = false;
  private endTimer = -1;
  private marker!: THREE.Mesh;
  private ballFocus = new THREE.Vector3();
  private touch: TouchControls | null = null;
  private post: PostFX | null = null;
  private passMarker!: THREE.Mesh;
  private fps = { t: 0, n: 0, value: 60 };
  private onResize = () => this.resize();

  constructor(private renderer: THREE.WebGLRenderer, private hudRoot: HTMLElement, private cfg: MatchConfig, private audio: GameAudio, private cb: GameCallbacks) {
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
  }

  async build(progress: (p: number, label: string) => void) {
    progress(0.05, 'Создание составов');
    await tick();
    this.match = new Match(this.cfg);
    const m = this.match;
    progress(0.2, 'Строим стадион');
    await tick();
    const gfx = this.cfg.graphics ?? 'high';
    const r = this.renderer;
    const dpr = window.devicePixelRatio || 1;
    r.setPixelRatio(gfx === 'low' ? Math.min(dpr, IS_MOBILE ? 1 : 1.25) : gfx === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    r.shadowMap.enabled = gfx !== 'low';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const h = m.teams[0].kit, a = m.teams[1].kit;
    this.stadium = new Stadium(this.scene, r, this.cfg.stadium, [h.shirt, h.stripe, h.shorts], [a.shirt, a.stripe], gfx, {
      home: { short: m.teams[0].data.short, color: h.shirt },
      away: { short: m.teams[1].data.short, color: a.shirt },
    });
    progress(0.55, 'Выход команд');
    await tick();
    for (const p of m.players) this.scene.add(p.model.root);
    this.scene.add(m.ball.mesh);
    const ring = new THREE.RingGeometry(0.55, 0.72, 32);
    ring.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.renderOrder = 2;
    this.scene.add(this.marker);
    // индикатор адресата паса
    const cone = new THREE.ConeGeometry(0.22, 0.42, 4);
    cone.rotateX(Math.PI);
    this.passMarker = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: '#38e1ff', transparent: true, opacity: 0.95, depthTest: false }));
    this.passMarker.renderOrder = 3;
    this.passMarker.visible = false;
    this.scene.add(this.passMarker);
    if (gfx === 'high') this.post = new PostFX(r, this.scene, this.rig.cam, this.cfg.stadium !== 'day');
    this.replay = new Replay(m);
    this.hud = new HUD(this.hudRoot, m, {
      onResume: () => this.setPaused(false),
      onQuit: () => this.quit(),
      onSub: (slot, bench) => {
        const r = m.substitute(slot, bench);
        if (r) this.hud.showMessage('ЗАМЕНА', `${r.incoming.name} ↔ ${r.outgoing.name}`);
      },
    });
    if (SHOW_TOUCH) {
      this.touch = new TouchControls(this.hudRoot);
      this.input.touch = this.touch;
    }
    m.on(e => this.onEvent(e));
    m.start();
    this.poseAll();
    progress(0.8, 'Компиляция шейдеров');
    await tick();
    this.rig.setMode('intro');
    this.rig.snap(m.ball.pos);
    this.renderer.compile(this.scene, this.rig.cam);
    progress(1, 'Готово');
    await tick();
  }

  start() {
    this.audio.startAmbience(this.cfg.stadium === 'rain');
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.rig.cam.aspect = w / h;
    this.rig.cam.updateProjectionMatrix();
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.hud.showPause(p);
    this.touch?.setVisible(!p);
  }

  private quit() {
    this.cb.onQuit();
  }

  private onEvent(e: MatchEvent) {
    const a = this.audio;
    switch (e.type) {
      case 'whistle': a.whistle(e.kind); break;
      case 'kick': a.kick(e.power); break;
      case 'excite': a.excite(e.v); this.excite = Math.max(this.excite, e.v * 0.6); break;
      case 'message': this.hud.showMessage(e.text, e.sub); break;
      case 'post': a.post(); this.hud.showMessage('ШТАНГА!'); break;
      case 'save': this.hud.showMessage('СЕЙВ!', e.name); break;
      case 'goal':
        a.goal();
        this.excite = 1.5;
        this.rig.shake = 0.6;
        this.hud.showGoal(e.team, e.scorer, e.own, e.minute);
        this.rig.setMode('celebrate');
        break;
      case 'replay':
        this.hud.hideGoal();
        if (this.replay.start(e.t0, e.t1)) {
          this.replayActive = true;
          this.hud.setReplay(true);
          this.rig.setMode('replay', Math.sign(this.match.ball.pos.x) || 1);
        } else this.endReplay();
        break;
      case 'halftime': {
        const t = this.match.teams;
        this.hud.showMessage('ПЕРЕРЫВ', `${t[0].data.name} ${t[0].score} : ${t[1].score} ${t[1].data.name}`);
        break;
      }
      case 'secondhalf': this.hud.showMessage('2-Й ТАЙМ', 'Команды поменялись воротами'); break;
      case 'fulltime': {
        const t = this.match.teams;
        this.hud.showMessage('МАТЧ ОКОНЧЕН', `${t[0].data.name} ${t[0].score} : ${t[1].score} ${t[1].data.name}`);
        this.endTimer = 3.5;
        this.excite = 1;
        break;
      }
    }
  }

  private endReplay() {
    this.replay.stop();
    this.replayActive = false;
    this.hud.setReplay(false);
    this.rig.setMode('broadcast');
    this.match.afterReplay();
    this.rig.snap(this.match.ball.pos);
  }

  private poseAll(dt = 1 / 60) {
    const tmp = new Float32Array(POSE_SIZE);
    for (const p of this.match.players) {
      p.writePose(tmp, 0);
      p.model.pose(tmp, 0, dt);
    }
  }

  private draw(dt: number) {
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.rig.cam);
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const m = this.match;
    this.input.defending = m.state === 'play' && m.humanDefending();
    const inp = this.input.poll();
    this.fps.t += dt; this.fps.n++;
    if (this.fps.t >= 1) { this.fps.value = this.fps.n / this.fps.t; this.fps.t = 0; this.fps.n = 0; }

    if (inp.pause && !this.ended && this.introT >= 3) this.setPaused(!this.paused);
    if (this.paused) { this.draw(dt); return; }

    if (this.replayActive) {
      if (inp.skip) this.endReplay();
      else {
        const f = this.replay.update(dt);
        if (!f) this.endReplay();
        else {
          m.ball.mesh.position.set(f[0], f[1], f[2]);
          m.ball.mesh.rotation.x += dt * 4;
          m.players.forEach((p, i) => p.model.pose(f, 3 + i * POSE_SIZE, dt));
          this.passMarker.visible = false;
          this.ballFocus.set(f[0], f[1], f[2]);
          this.rig.update(dt, this.ballFocus);
          this.marker.visible = false;
        }
      }
    } else {
      if (this.introT < 3) {
        this.introT += dt;
        if (inp.any && this.introT > 0.4) this.introT = 3;
        if (this.introT >= 3) { this.rig.setMode('broadcast'); }
        this.rig.update(dt, m.ball.pos);
      } else {
        m.update(dt, inp);
        this.replay.record(dt);
        if (m.state === 'goal') {
          const cel = m.players.find(p => p.celebrate);
          this.rig.update(dt, cel ? cel.pos : m.ball.pos);
        } else {
          if (this.rig.mode !== 'broadcast') this.rig.setMode('broadcast');
          const poss = m.ball.owner?.team ?? m.ball.intended?.team ?? null;
          this.rig.attack = poss ? poss.dir * 0.8 : 0;
          this.ballFocus.lerp(m.ball.pos, Math.min(1, dt * 6));
          this.rig.update(dt, this.ballFocus);
        }
      }
      this.poseAll(dt);
      m.ball.updateVisual(dt);
      const pv = m.state === 'play' ? m.passPreview : null;
      this.passMarker.visible = !!pv;
      if (pv) this.passMarker.position.set(pv.pos.x, pv.pos.y + 2.35 + Math.sin(now * 0.01) * 0.07, pv.pos.z);
      const c = m.controlled;
      const showMarker = this.introT >= 3 && m.state !== 'goal' && m.state !== 'fulltime' && m.state !== 'halftime';
      this.marker.visible = showMarker;
      this.marker.position.set(c.pos.x, 0.03, c.pos.z);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(now * 0.008) * 0.25;
    }

    // трибуны оживляются, когда мяч у ворот
    if (m.state === 'play' && Math.abs(m.ball.pos.x) > 36 && Math.abs(m.ball.pos.z) < 22) this.audio.excite(0.3);
    this.excite = Math.max(0, this.excite - dt * 0.3);
    this.stadium.update(dt, now / 1000, Math.min(1, this.excite));
    this.stadium.updateScoreboard(m.teams[0].score, m.teams[1].score, m.clock);
    this.audio.update(dt);
    this.hud.update(dt, this.rig.cam, window.innerWidth, window.innerHeight, this.introT >= 3 ? m.controlled : null, this.replayActive);

    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && !this.ended) {
        this.ended = true;
        this.cb.onEnd(m.result());
      }
    }
    this.draw(dt);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.input.dispose();
    this.touch?.dispose();
    this.audio.stopAmbience();
    this.hud?.dispose();
    this.stadium?.dispose();
    this.post?.dispose();
    this.passMarker?.geometry.dispose();
    this.match?.dispose();
    this.marker?.geometry.dispose();
    (this.marker?.material as THREE.Material | undefined)?.dispose();
    this.match?.ball.mesh.geometry.dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
  }
}
