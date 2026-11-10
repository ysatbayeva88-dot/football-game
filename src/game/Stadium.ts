import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRANDS, CIRCLE_R, GA_D, GA_HW, GOAL_D, GOAL_H, GOAL_HW, HALF_L, HALF_W, PEN_D, PEN_HW, PEN_SPOT, POST_R } from './constants';
import type { GraphicsLevel, StadiumId } from './types';

const LINE_W = 0.12;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface BoardInfo {
  home: { short: string; color: string };
  away: { short: string; color: string };
}

export class Stadium {
  group = new THREE.Group();
  private uniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
  private boardTex: THREE.Texture[] = [];
  private rain: THREE.LineSegments | null = null;
  private rainVel: Float32Array | null = null;
  private disposables: { dispose(): void }[] = [];
  private density: number;
  private screens: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  private lastBoard = '';
  sun!: THREE.DirectionalLight;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    public id: StadiumId,
    homeColors: string[],
    awayColors: string[],
    public gfx: GraphicsLevel = 'high',
    private board?: BoardInfo,
  ) {
    this.density = { low: 0.38, medium: 0.7, high: 0.9 }[gfx];
    scene.add(this.group);
    this.buildEnvironment();
    this.buildPitch();
    this.buildGoals();
    this.buildBoards();
    this.buildStands(homeColors, awayColors);
    this.buildFloodlights(id !== 'day');
    this.buildScoreboards();
    if (id === 'rain') this.buildRain();
  }

  private track<T extends { dispose(): void }>(o: T) { this.disposables.push(o); return o; }

  // ───────────── небо, свет и окружение ─────────────
  private buildEnvironment() {
    const r = this.renderer;
    const scene = this.scene;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const sun = new THREE.DirectionalLight('#ffffff', 2.6);
    sun.castShadow = this.gfx !== 'low';
    const sm = this.gfx === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.target.position.set(0, 0, 0);
    this.group.add(sun, sun.target);
    this.sun = sun;

    // сцена для карты окружения (отражения и рассеянный свет)
    const envScene = new THREE.Scene();
    const groundEnv = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: this.id === 'rain' ? '#1f3a20' : '#2c5a26' }));
    groundEnv.rotation.x = -Math.PI / 2;
    groundEnv.position.y = -8;
    envScene.add(groundEnv);

    if (this.id === 'day') {
      r.toneMappingExposure = 0.6;
      const mkSky = () => {
        const sky = new Sky();
        sky.scale.setScalar(4000);
        const u = sky.material.uniforms;
        u['turbidity'].value = 3;
        u['rayleigh'].value = 1.4;
        u['mieCoefficient'].value = 0.004;
        u['mieDirectionalG'].value = 0.85;
        return sky;
      };
      const sky = mkSky();
      const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(-35));
      sky.material.uniforms['sunPosition'].value.copy(sunDir);
      this.group.add(sky);
      const envSky = mkSky();
      envSky.scale.setScalar(800);
      envSky.material.uniforms['sunPosition'].value.copy(sunDir);
      envScene.add(envSky);
      sun.position.copy(sunDir).multiplyScalar(140);
      sun.intensity = 3.0;
      sun.color.set('#fff3e0');
      this.group.add(new THREE.HemisphereLight('#bcd8ff', '#3d6b2a', 0.9));
      scene.fog = new THREE.Fog('#c9dcef', 250, 900);
    } else {
      const night = this.id === 'night';
      r.toneMappingExposure = night ? 0.9 : 0.85;
      const top = night ? '#02040d' : '#3c434c';
      const bottom = night ? '#14213d' : '#7b858f';
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
      });
      this.track(skyMat);
      const skyMesh = new THREE.Mesh(this.track(new THREE.SphereGeometry(2000, 32, 16)), skyMat);
      this.group.add(skyMesh);
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), skyMat));
      // яркие «прожекторы» в карте окружения дают блики на мокром газоне и форме
      const lampEnv = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(night ? 30 : 3) });
      for (const sx of [1, -1]) for (const sz of [1, -1]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 1), lampEnv);
        b.position.set(sx * 70, 45, sz * 56);
        b.lookAt(0, 0, 0);
        envScene.add(b);
      }
      if (night) {
        const n = 1500, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const v = new THREE.Vector3().setFromSphericalCoords(1800, Math.random() * Math.PI * 0.45, Math.random() * Math.PI * 2);
          pos.set([v.x, v.y, v.z], i * 3);
        }
        const g = this.track(new THREE.BufferGeometry());
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.group.add(new THREE.Points(g, this.track(new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false }))));
      }
      sun.position.set(20, 120, 40);
      sun.intensity = night ? 0.6 : 0.9;
      sun.color.set(night ? '#dfe8ff' : '#e6ecf2');
      this.group.add(new THREE.HemisphereLight(night ? '#2a3a6a' : '#a6b0ba', night ? '#0c1a0c' : '#2d3b2a', night ? 0.3 : 0.85));
      scene.fog = night ? new THREE.Fog('#0a1020', 220, 700) : new THREE.Fog('#7d8792', 45, 260);
    }
    const pmrem = new THREE.PMREMGenerator(r);
    const envRT = pmrem.fromScene(envScene, 0.03);
    pmrem.dispose();
    this.track(envRT);
    envScene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) m.geometry.dispose(); });
    scene.environment = envRT.texture;
    scene.environmentIntensity = this.id === 'day' ? 0.5 : this.id === 'night' ? 0.4 : 0.5;
  }

  // ───────────── поле ─────────────
  private buildPitch() {
    const wet = this.id === 'rain';
    const map = this.makeGrassMap(wet);
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.track(map);
    const normal = this.makeGrassNormal();
    normal.repeat.set(52, 34);
    this.track(normal);
    const pitchMat = this.track(wet
      ? new THREE.MeshPhysicalMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.6, clearcoat: 0.45, clearcoatRoughness: 0.35 })
      : new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 }));
    const pitch = new THREE.Mesh(this.track(new THREE.PlaneGeometry(HALF_L * 2 + 0.01, HALF_W * 2 + 0.01)), pitchMat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.group.add(pitch);

    const outer = canvasTex(256, 256, g => {
      g.fillStyle = wet ? '#28572a' : '#357a2d';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
    });
    outer.wrapS = outer.wrapT = THREE.RepeatWrapping;
    outer.repeat.set(20, 14);
    this.track(outer);
    const ground = new THREE.Mesh(this.track(new THREE.PlaneGeometry(260, 200)), this.track(new THREE.MeshStandardMaterial({ map: outer, roughness: 0.95 })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);

    // разметка
    const lineMat = this.track(new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const geos: THREE.BufferGeometry[] = [];
    const line = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const g = new THREE.PlaneGeometry(len + LINE_W, LINE_W);
      g.rotateX(-Math.PI / 2);
      g.rotateY(-Math.atan2(z2 - z1, x2 - x1));
      g.translate((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
      geos.push(g);
    };
    const arc = (cx: number, cz: number, r: number, start: number, len: number) => {
      const g = new THREE.RingGeometry(r - LINE_W / 2, r + LINE_W / 2, 64, 1, start, len);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, 0.012, cz);
      geos.push(g);
    };
    line(-HALF_L, -HALF_W, HALF_L, -HALF_W);
    line(-HALF_L, HALF_W, HALF_L, HALF_W);
    line(-HALF_L, -HALF_W, -HALF_L, HALF_W);
    line(HALF_L, -HALF_W, HALF_L, HALF_W);
    line(0, -HALF_W, 0, HALF_W);
    arc(0, 0, CIRCLE_R, 0, Math.PI * 2);
    arc(0, 0, 0.12, 0, Math.PI * 2);
    for (const s of [1, -1]) {
      const bx = s * (HALF_L - PEN_D);
      line(bx, -PEN_HW, bx, PEN_HW);
      line(s * HALF_L, -PEN_HW, bx, -PEN_HW);
      line(s * HALF_L, PEN_HW, bx, PEN_HW);
      const gx = s * (HALF_L - GA_D);
      line(gx, -GA_HW, gx, GA_HW);
      line(s * HALF_L, -GA_HW, gx, -GA_HW);
      line(s * HALF_L, GA_HW, gx, GA_HW);
      const spot = s * (HALF_L - PEN_SPOT);
      arc(spot, 0, 0.12, 0, Math.PI * 2);
      const a = Math.acos((PEN_D - PEN_SPOT) / CIRCLE_R);
      arc(spot, 0, CIRCLE_R, (s > 0 ? Math.PI : 0) - a, a * 2);
      for (const zs of [1, -1]) {
        const center = Math.atan2(zs, -s);
        arc(s * HALF_L, zs * HALF_W, 1, center - Math.PI / 4, Math.PI / 2);
      }
    }
    const lines = new THREE.Mesh(this.track(mergeGeometries(geos)), lineMat);
    lines.receiveShadow = true;
    this.group.add(lines);
    geos.forEach(g => g.dispose());

    // угловые флажки
    const poleGeo = this.track(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6));
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: '#f5f5f5' }));
    const flagGeo = this.track(new THREE.PlaneGeometry(0.4, 0.3));
    const flagMat = this.track(new THREE.MeshStandardMaterial({ color: '#ffcc00', side: THREE.DoubleSide }));
    for (const s of [1, -1]) for (const zs of [1, -1]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(s * HALF_L, 0.75, zs * HALF_W);
      pole.castShadow = true;
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(s * HALF_L + 0.2, 1.35, zs * HALF_W);
      this.group.add(pole, flag);
    }
  }

  /** Процедурный газон: полосы покоса, поперечный рисунок, пятна, вытоптанные зоны. */
  private makeGrassMap(wet: boolean) {
    const W = this.gfx === 'low' ? 1024 : 2048, H = W / 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    const A = wet ? [44, 104, 40] : [66, 146, 54];
    const B = wet ? [37, 92, 38] : [54, 126, 46];
    // низкочастотный шум
    const GW = 64, GH = 32;
    const grid = new Float32Array((GW + 1) * (GH + 1)).map(() => Math.random());
    const lf = (x: number, y: number) => {
      const gx = (x / W) * GW, gy = (y / H) * GH;
      const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const at = (a: number, b: number) => grid[b * (GW + 1) + a];
      const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
      const bot = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
      return top * (1 - fy) + bot * fy;
    };
    const wear = [[0.02, 0.5, 0.05], [0.98, 0.5, 0.05], [0.5, 0.5, 0.06], [0.105, 0.5, 0.03], [0.895, 0.5, 0.03]];
    const stripeW = W / 18;
    for (let y = 0; y < H; y++) {
      const cross = Math.floor(y / (H / 8)) % 2 ? 1.025 : 0.975;
      for (let x = 0; x < W; x++) {
        const base = Math.floor(x / stripeW) % 2 ? A : B;
        let k = cross * (0.9 + lf(x, y) * 0.2) + (Math.random() - 0.5) * 0.12;
        let r = base[0] * k, gg = base[1] * k, b = base[2] * k;
        for (const [wx, wy, wr] of wear) {
          const dx = x / W - wx, dy = (y / H - wy) * 0.5;
          const d = Math.sqrt(dx * dx + dy * dy) / wr;
          if (d < 1) { const t = (1 - d) * (1 - d) * 0.35; r += (110 - r) * t; gg += (112 - gg) * t; b += (62 - b) * t; }
        }
        const o = (y * W + x) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Повторяющаяся карта нормалей «травинок». */
  private makeGrassNormal() {
    const N = 256;
    const h = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) h[i] = Math.random();
    // размытие для мягкости + штрихи травинок
    const tmp = new Float32Array(N * N);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + N) % N) * N + ((x + dx + N) % N)];
        tmp[y * N + x] = s / 9;
      }
      h.set(tmp);
    }
    for (let i = 0; i < 2600; i++) {
      const x = Math.floor(Math.random() * N), y = Math.floor(Math.random() * N), len = 2 + Math.floor(Math.random() * 5);
      for (let k = 0; k < len; k++) h[((y + k) % N) * N + x] += 0.35;
    }
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const g = c.getContext('2d')!;
    const img = g.createImageData(N, N);
    const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * 2.2, ny = (at(x, y - 1) - at(x, y + 1)) * 2.2;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * N + x) * 4;
      img.data[o] = (nx / l * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ───────────── ворота ─────────────
  private buildGoals() {
    const postMat = this.track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }));
    const backMat = this.track(new THREE.MeshStandardMaterial({ color: '#bfc4c9', roughness: 0.5 }));
    const netTex = canvasTex(64, 64, g => {
      g.clearRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 3;
      g.strokeRect(0, 0, 64, 64);
    });
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    this.track(netTex);
    const netMat = (w: number, h: number) => {
      const t = netTex.clone();
      t.repeat.set(w / 0.14, h / 0.14);
      t.needsUpdate = true;
      this.track(t);
      return this.track(new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1 }));
    };
    const postGeo = this.track(new THREE.CylinderGeometry(POST_R, POST_R, GOAL_H, 12));
    const barGeo = this.track(new THREE.CylinderGeometry(POST_R, POST_R, GOAL_HW * 2 + POST_R * 2, 12));
    const thin = this.track(new THREE.CylinderGeometry(0.025, 0.025, 1, 6));
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      for (const zs of [1, -1]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(0, GOAL_H / 2, zs * GOAL_HW);
        p.castShadow = true;
        g.add(p);
        // задние стойки
        const bp = new THREE.Mesh(thin, backMat);
        bp.scale.y = GOAL_H * 0.75;
        bp.position.set(s * GOAL_D, GOAL_H * 0.375, zs * GOAL_HW);
        g.add(bp);
        const top = new THREE.Mesh(thin, backMat);
        top.scale.y = Math.hypot(GOAL_D, GOAL_H * 0.25);
        top.position.set((s * GOAL_D) / 2, GOAL_H * 0.875, zs * GOAL_HW);
        top.rotation.z = s * Math.atan2(GOAL_D, GOAL_H * 0.25);
        g.add(top);
      }
      const bar = new THREE.Mesh(barGeo, postMat);
      bar.rotation.x = Math.PI / 2;
      bar.position.y = GOAL_H;
      bar.castShadow = true;
      g.add(bar);
      // сетка
      const backH = GOAL_H * 0.75;
      const back = new THREE.Mesh(this.track(new THREE.PlaneGeometry(GOAL_HW * 2, backH)), netMat(GOAL_HW * 2, backH));
      back.rotation.y = Math.PI / 2;
      back.position.set(s * GOAL_D, backH / 2, 0);
      const roofLen = Math.hypot(GOAL_D, GOAL_H - backH);
      const roof = new THREE.Mesh(this.track(new THREE.PlaneGeometry(roofLen, GOAL_HW * 2)), netMat(roofLen, GOAL_HW * 2));
      roof.rotation.x = -Math.PI / 2;
      roof.rotation.y = s * Math.atan2(GOAL_H - backH, GOAL_D);
      roof.position.set((s * GOAL_D) / 2, (GOAL_H + backH) / 2, 0);
      g.add(back, roof);
      const sideShape = new THREE.Shape();
      sideShape.moveTo(0, 0); sideShape.lineTo(s * GOAL_D, 0); sideShape.lineTo(s * GOAL_D, backH); sideShape.lineTo(0, GOAL_H); sideShape.closePath();
      const sideGeo = this.track(new THREE.ShapeGeometry(sideShape));
      const uv = sideGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i));
      const sideMat = netMat(1, 1);
      for (const zs of [1, -1]) {
        const side = new THREE.Mesh(sideGeo, sideMat);
        side.position.z = zs * GOAL_HW;
        g.add(side);
      }
      g.position.x = s * HALF_L;
      this.group.add(g);
    }
  }

  // ───────────── рекламные щиты ─────────────
  private buildBoards() {
    const colors = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#7b2cbf', '#0077b6', '#d00000', '#ffb703', '#06d6a0', '#3a0ca3'];
    const tex = canvasTex(2048, 64, g => {
      const w = 2048 / BRANDS.length;
      BRANDS.forEach((b, i) => {
        g.fillStyle = colors[i % colors.length];
        g.fillRect(i * w, 0, w, 64);
        g.fillStyle = i % 3 === 0 ? '#111' : '#fff';
        g.font = 'bold 38px Arial Black, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b, i * w + w / 2, 34);
      });
    });
    tex.wrapS = THREE.RepeatWrapping;
    this.track(tex);
    const darkMat = this.track(new THREE.MeshStandardMaterial({ color: '#15171b' }));
    const H = 0.95;
    const mk = (len: number, x: number, z: number, rotY: number, rep: number) => {
      const t = tex.clone();
      t.repeat.set(rep, 1);
      t.needsUpdate = true;
      this.boardTex.push(t);
      this.track(t);
      const face = new THREE.Mesh(this.track(new THREE.PlaneGeometry(len, H)), this.track(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.85, 0.85, 0.85) })));
      face.position.set(0, H / 2, 0.06);
      const box = new THREE.Mesh(this.track(new THREE.BoxGeometry(len, H, 0.1)), darkMat);
      box.position.y = H / 2;
      box.castShadow = true;
      const g = new THREE.Group();
      g.add(box, face);
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.group.add(g);
    };
    mk(HALF_L * 2 + 8, 0, -(HALF_W + 4), 0, 3);
    mk(HALF_L * 2 + 8, 0, HALF_W + 4, Math.PI, 3);
    mk(HALF_W * 2 + 6, HALF_L + 4.5, 0, -Math.PI / 2, 2);
    mk(HALF_W * 2 + 6, -(HALF_L + 4.5), 0, Math.PI / 2, 2);
  }

  // ───────────── трибуны ─────────────
  private buildStands(homeColors: string[], awayColors: string[]) {
    const night = this.id === 'night';
    const concrete = this.track(new THREE.MeshStandardMaterial({ color: night ? '#4a4f5a' : '#80858f', roughness: 0.9 }));
    const steel = this.track(new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.45, metalness: 0.6 }));
    const roofMat = this.track(new THREE.MeshStandardMaterial({ color: night ? '#2c313b' : '#d5d9de', roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }));
    const seatMat = this.track(new THREE.MeshStandardMaterial({ color: night ? '#26355e' : '#2f4d8f', roughness: 0.8 }));

    // болельщик: туловище + руки (поднимаются в шейдере) и голова
    const body = new THREE.BoxGeometry(0.44, 0.6, 0.3);
    const armL = new THREE.BoxGeometry(0.09, 0.42, 0.09); armL.translate(0.27, 0.5, 0);
    const armR = new THREE.BoxGeometry(0.09, 0.42, 0.09); armR.translate(-0.27, 0.5, 0);
    const setArm = (g: THREE.BufferGeometry, v: number) => g.setAttribute('aArm', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(v), 1));
    setArm(body, 0); setArm(armL, 1); setArm(armR, 1);
    const fanGeo = this.track(mergeGeometries([body, armL, armR])!);
    body.dispose(); armL.dispose(); armR.dispose();
    const headGeo = this.track(new THREE.SphereGeometry(0.12, 8, 6));
    headGeo.translate(0, 0.43, 0);

    const inject = (m: THREE.Material, arms: boolean) => {
      m.onBeforeCompile = sh => {
        sh.uniforms.uTime = this.uniforms.uTime;
        sh.uniforms.uExcite = this.uniforms.uExcite;
        sh.vertexShader = 'uniform float uTime;\nuniform float uExcite;\n' + (arms ? 'attribute float aArm;\n' : '') + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.71 + instanceMatrix[3].y * 2.13;
            float fanAct = step(0.3, fract(ph * 0.53));
            float sp = 3.0 + fract(ph * 0.37) * 4.0;
            float j = abs(sin(uTime * sp + ph));
            ${arms ? `float raise = clamp(uExcite * 1.7 - fract(ph * 0.73) * 0.7 + 0.12 * step(0.93, fract(ph * 0.19)), 0.0, 1.0);
            if (aArm > 0.5) { transformed.y = 0.29 + (transformed.y - 0.29) * mix(-1.0, 1.0, raise); transformed.x *= mix(1.0, 0.85, raise); }` : ''}
            transformed.y += j * (0.02 + uExcite * 0.45 * fanAct);
          #endif`,
        );
      };
      return m;
    };
    const fanMat = this.track(inject(new THREE.MeshLambertMaterial(), true));
    const headMat = this.track(inject(new THREE.MeshLambertMaterial(), false));
    const skins = ['#f1c9a5', '#e0ac85', '#c68c63', '#8d5a3b', '#5a3520'].map(c => new THREE.Color(c));
    const neutral = ['#222831', '#e0e0e0', '#5c677d', '#1d3557', '#7a5c3e'].map(c => new THREE.Color(c));
    const homeC = homeColors.map(c => new THREE.Color(c)), awayC = awayColors.map(c => new THREE.Color(c));
    const pick = (homeShare: number) => {
      const r = Math.random();
      if (r < homeShare) return homeC[Math.floor(Math.random() * homeC.length)];
      if (r < homeShare + (1 - homeShare) * 0.8) return awayC[Math.floor(Math.random() * awayC.length)];
      return neutral[Math.floor(Math.random() * neutral.length)];
    };

    interface Tier { rows: number; front: number; base: number }
    const rise = 0.55, depth = 0.85;
    const far1: Tier = { rows: 11, front: HALF_W + 8, base: 1.4 };
    const far1Top = far1.base + far1.rows * rise;
    const far2: Tier = { rows: 16, front: far1.front + far1.rows * depth + 1.2, base: far1Top + 2.4 };
    const stands = [
      { len: 136, tiers: [{ rows: 24, front: HALF_W + 8, base: 1.4 }], rot: 0, roof: false, home: 0.7, led: false },
      { len: 136, tiers: [far1, far2], rot: Math.PI, roof: true, home: 0.62, led: true },
      { len: 86, tiers: [{ rows: 20, front: HALF_L + 9, base: 1.4 }], rot: -Math.PI / 2, roof: true, home: 0.9, led: false },
      { len: 86, tiers: [{ rows: 20, front: HALF_L + 9, base: 1.4 }], rot: Math.PI / 2, roof: true, home: 0.15, led: false },
    ];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (const st of stands) {
      const g = new THREE.Group();
      const stepGeos: THREE.BufferGeometry[] = [];
      let maxTop = 0, maxBack = 0;
      const fanSlots: [number, number, number][] = [];
      for (const t of st.tiers) {
        for (let r = 0; r < t.rows; r++) {
          const h = t.base + r * rise;
          const bg = new THREE.BoxGeometry(st.len, h, depth);
          bg.translate(0, h / 2, t.front + r * depth + depth / 2);
          stepGeos.push(bg);
          fanSlots.push([h, t.front + r * depth + 0.35, r]);
        }
        maxTop = Math.max(maxTop, t.base + t.rows * rise);
        maxBack = Math.max(maxBack, t.front + t.rows * depth);
        const lip = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len, 0.9, 0.3)), concrete);
        lip.position.set(0, t.base + 0.45 - (t === st.tiers[0] ? 0 : 0.2), t.front - 0.15);
        g.add(lip);
      }
      const steps = new THREE.Mesh(this.track(mergeGeometries(stepGeos)), seatMat);
      stepGeos.forEach(s => s.dispose());
      steps.receiveShadow = true;
      g.add(steps);
      const wall = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len, maxTop + 4, 1)), concrete);
      wall.position.set(0, (maxTop + 4) / 2, maxBack + 0.5);
      g.add(wall);
      if (st.led) {
        // LED-лента на козырьке между ярусами
        const t = this.ledTexture();
        t.repeat.set(4, 1);
        this.boardTex.push(t);
        const led = new THREE.Mesh(this.track(new THREE.PlaneGeometry(st.len, 1.3)), this.track(new THREE.MeshBasicMaterial({ map: t })));
        led.position.set(0, far1Top + 1.05, far2.front - 1.16);
        led.rotation.y = Math.PI; // лицом к полю
        const facia = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len, 2.2, 1.0)), concrete);
        facia.position.set(0, far1Top + 1.1, far2.front - 0.65);
        g.add(facia, led);
      }
      if (st.roof) {
        const roofD = maxBack - st.tiers[0].front + 6;
        const roofY = maxTop + 6;
        const roof = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len + 4, 0.5, roofD)), roofMat);
        roof.position.set(0, roofY, maxBack - roofD / 2 + 1);
        roof.rotation.x = -0.05;
        g.add(roof);
        // фермы под крышей
        const beam = this.track(new THREE.BoxGeometry(0.35, 0.35, roofD));
        for (let x = -st.len / 2; x <= st.len / 2 + 0.1; x += 12) {
          const b = new THREE.Mesh(beam, steel);
          b.position.set(x, roofY - 0.5, maxBack - roofD / 2 + 1);
          b.rotation.x = -0.05;
          g.add(b);
        }
        const edge = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len + 4, 1.2, 0.5)), steel);
        edge.position.set(0, roofY - 0.2 + roofD * 0.05 * 0.5, maxBack - roofD + 1.2);
        g.add(edge);
        if (this.id !== 'day') {
          const strip = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len, 0.3, 0.3)), this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6dd').multiplyScalar(2.2) })));
          strip.position.set(0, roofY - 1.0, maxBack - roofD + 1.6);
          g.add(strip);
        }
      }
      // болельщики
      const cols = Math.floor(st.len / 0.66);
      const max = cols * fanSlots.length;
      const fans = new THREE.InstancedMesh(fanGeo, fanMat, max);
      const heads = new THREE.InstancedMesh(headGeo, headMat, max);
      let n = 0;
      for (const [h, z] of fanSlots) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > this.density) continue;
          pos.set(-st.len / 2 + (c + 0.5) * 0.66 + (Math.random() - 0.5) * 0.18, h + 0.3, z);
          q.setFromAxisAngle(up, (Math.random() - 0.5) * 0.5 + Math.PI);
          const s = 0.88 + Math.random() * 0.24;
          scl.set(s * (0.9 + Math.random() * 0.25), s, s);
          m4.compose(pos, q, scl);
          fans.setMatrixAt(n, m4);
          heads.setMatrixAt(n, m4);
          fans.setColorAt(n, pick(st.home));
          heads.setColorAt(n, skins[Math.floor(Math.random() * skins.length)]);
          n++;
        }
      }
      fans.count = n; heads.count = n;
      fans.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      g.add(fans, heads);
      g.rotation.y = st.rot;
      this.group.add(g);
    }
    // угловые блоки
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const b = new THREE.Mesh(this.track(new THREE.BoxGeometry(18, 13, 18)), concrete);
      b.position.set(sx * (HALF_L + 17), 6.5, sz * (HALF_W + 17));
      this.group.add(b);
    }
  }

  private ledTexture() {
    const colors = ['#ff2d55', '#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff375f'];
    const t = canvasTex(2048, 64, g => {
      g.fillStyle = '#05070c';
      g.fillRect(0, 0, 2048, 64);
      const w = 2048 / BRANDS.length;
      BRANDS.forEach((b, i) => {
        const grd = g.createLinearGradient(i * w, 0, i * w + w, 0);
        grd.addColorStop(0, colors[i % colors.length]);
        grd.addColorStop(1, colors[(i + 3) % colors.length]);
        g.fillStyle = grd;
        g.fillRect(i * w + 4, 6, w - 8, 52);
        g.fillStyle = '#fff';
        g.font = 'italic 900 36px Arial Black, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b, i * w + w / 2, 34);
      });
    });
    t.wrapS = THREE.RepeatWrapping;
    return this.track(t);
  }

  // ───────────── мачты прожекторов ─────────────
  private buildFloodlights(lit: boolean) {
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: '#5c6370', metalness: 0.6, roughness: 0.45 }));
    const lampMat = this.track(lit ? new THREE.MeshBasicMaterial({ color: new THREE.Color('#fffbe8').multiplyScalar(2.5) }) : new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.3, roughness: 0.4 }));
    const glowTex = canvasTex(128, 128, g => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,250,230,1)');
      gr.addColorStop(0.25, 'rgba(255,240,200,0.5)');
      gr.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    });
    this.track(glowTex);
    const glowMat = this.track(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const poleGeo = this.track(new THREE.CylinderGeometry(0.5, 0.9, 42, 8));
    const panelGeo = this.track(new THREE.BoxGeometry(8, 4, 0.6));
    const frameGeo = this.track(new THREE.BoxGeometry(8.6, 4.6, 0.4));
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const x = sx * (HALF_L + 16), z = sz * (HALF_W + 22);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 21, z);
      pole.castShadow = false;
      this.group.add(pole);
      const head = new THREE.Group();
      head.position.set(x, 43, z);
      head.add(new THREE.Mesh(frameGeo, poleMat));
      const panel = new THREE.Mesh(panelGeo, lampMat);
      panel.position.z = 0.15;
      head.add(panel);
      head.lookAt(0, 0, 0);
      this.group.add(head);
      if (!lit) continue;
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(x * 0.98, 43, z * 0.98);
      glow.scale.set(28, 28, 1);
      this.group.add(glow);
      const spot = new THREE.SpotLight('#fff4dc', this.id === 'night' ? 2.4 : 0.8, 0, Math.PI / 4.6, 0.85, 0);
      spot.position.set(x, 43, z);
      spot.target.position.set(sx * -12, 0, sz * -6);
      this.group.add(spot, spot.target);
    }
  }

  // ───────────── табло стадиона ─────────────
  private buildScoreboards() {
    const frame = this.track(new THREE.MeshStandardMaterial({ color: '#1a1d24', roughness: 0.5, metalness: 0.4 }));
    for (const sx of [1, -1]) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 192;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.track(tex);
      this.screens.push({ canvas: c, tex });
      const g = new THREE.Group();
      const box = new THREE.Mesh(this.track(new THREE.BoxGeometry(17, 7, 0.8)), frame);
      const screen = new THREE.Mesh(this.track(new THREE.PlaneGeometry(16, 6)), this.track(new THREE.MeshBasicMaterial({ map: tex })));
      screen.position.z = 0.41;
      const leg = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.6, 8, 0.6)), frame);
      leg.position.y = -7.5;
      g.add(box, screen, leg);
      g.position.set(sx * (HALF_L + 17), 16.5, -(HALF_W + 17));
      g.lookAt(0, 12, 0);
      this.group.add(g);
    }
    this.updateScoreboard(0, 0, 0);
  }

  /** Обновить большое табло (вызывается игрой). */
  updateScoreboard(home: number, away: number, clockSec: number) {
    const key = `${home}:${away}:${Math.floor(clockSec / 60)}`;
    if (key === this.lastBoard || !this.screens.length) return;
    this.lastBoard = key;
    const b = this.board ?? { home: { short: 'HOM', color: '#ffffff' }, away: { short: 'AWY', color: '#ff4040' } };
    for (const { canvas, tex } of this.screens) {
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#04060c';
      g.fillRect(0, 0, 512, 192);
      g.fillStyle = '#0b1a3a';
      g.fillRect(0, 0, 512, 38);
      g.fillStyle = '#00f0a8';
      g.font = 'bold 26px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${Math.min(90, Math.floor(clockSec / 60))}'`, 256, 20);
      g.fillStyle = b.home.color; g.fillRect(16, 60, 12, 110);
      g.fillStyle = b.away.color; g.fillRect(484, 60, 12, 110);
      g.fillStyle = '#ffffff';
      g.font = 'bold 54px Arial, sans-serif';
      g.fillText(b.home.short, 110, 115);
      g.fillText(b.away.short, 402, 115);
      g.font = 'bold 92px Arial, sans-serif';
      g.fillStyle = '#ffd23f';
      g.fillText(`${home}-${away}`, 256, 118);
      tex.needsUpdate = true;
    }
  }

  // ───────────── дождь ─────────────
  private buildRain() {
    const n = this.gfx === 'low' ? 2000 : this.gfx === 'medium' ? 4500 : 7000;
    const pos = new Float32Array(n * 6);
    this.rainVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 160, y = Math.random() * 45, z = (Math.random() - 0.5) * 110;
      pos.set([x, y, z, x + 0.05, y + 0.6, z + 0.02], i * 6);
      this.rainVel[i] = 18 + Math.random() * 8;
    }
    const g = this.track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = this.track(new THREE.LineBasicMaterial({ color: '#b8c6d6', transparent: true, opacity: 0.45 }));
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  update(dt: number, time: number, excite: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uExcite.value += (excite - this.uniforms.uExcite.value) * Math.min(1, dt * 4);
    for (const t of this.boardTex) t.offset.x = (t.offset.x + dt * 0.02) % 1;
    if (this.rain && this.rainVel) {
      const a = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < this.rainVel.length; i++) {
        const o = i * 6;
        const dy = this.rainVel[i] * dt;
        arr[o + 1] -= dy; arr[o + 4] -= dy;
        if (arr[o + 1] < 0) { arr[o + 1] += 45; arr[o + 4] += 45; }
      }
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.scene.fog = null;
    this.scene.environment = null;
  }
}
