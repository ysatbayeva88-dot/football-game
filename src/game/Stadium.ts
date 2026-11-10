import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRANDS, CIRCLE_R, GA_D, GA_HW, GOAL_D, GOAL_H, GOAL_HW, HALF_L, HALF_W, PEN_D, PEN_HW, PEN_SPOT, POST_R } from './constants';
import type { StadiumId } from './types';
import { LOW_QUALITY } from './quality';

const LINE_W = 0.12;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Stadium {
  group = new THREE.Group();
  private uniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
  private boardTex: THREE.Texture[] = [];
  private rain: THREE.LineSegments | null = null;
  private rainVel: Float32Array | null = null;
  private disposables: { dispose(): void }[] = [];
  sun!: THREE.DirectionalLight;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, public id: StadiumId, homeColors: string[], awayColors: string[]) {
    scene.add(this.group);
    this.buildEnvironment();
    this.buildPitch();
    this.buildGoals();
    this.buildBoards();
    this.buildStands(homeColors, awayColors);
    if (id !== 'day') this.buildFloodlights();
    if (id === 'rain') this.buildRain();
  }

  private track<T extends { dispose(): void }>(o: T) { this.disposables.push(o); return o; }

  // ───────────── небо и свет ─────────────
  private buildEnvironment() {
    const r = this.renderer;
    const scene = this.scene;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const sun = new THREE.DirectionalLight('#ffffff', 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.target.position.set(0, 0, 0);
    this.group.add(sun, sun.target);
    this.sun = sun;

    if (this.id === 'day') {
      r.toneMappingExposure = 0.62;
      const sky = new Sky();
      sky.scale.setScalar(4000);
      const u = sky.material.uniforms;
      u['turbidity'].value = 3;
      u['rayleigh'].value = 1.4;
      u['mieCoefficient'].value = 0.004;
      u['mieDirectionalG'].value = 0.85;
      const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(-35));
      u['sunPosition'].value.copy(sunDir);
      this.group.add(sky);
      sun.position.copy(sunDir).multiplyScalar(140);
      sun.intensity = 3.2;
      sun.color.set('#fff3e0');
      this.group.add(new THREE.HemisphereLight('#bcd8ff', '#3d6b2a', 1.3));
      scene.fog = new THREE.Fog('#c9dcef', 250, 900);
    } else {
      const night = this.id === 'night';
      r.toneMappingExposure = night ? 0.85 : 0.8;
      const top = night ? '#02040d' : '#3c434c';
      const bottom = night ? '#14213d' : '#7b858f';
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
      });
      const skyMesh = new THREE.Mesh(this.track(new THREE.SphereGeometry(2000, 32, 16)), this.track(skyMat));
      this.group.add(skyMesh);
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
      sun.intensity = night ? 0.55 : 0.9;
      sun.color.set(night ? '#dfe8ff' : '#e6ecf2');
      this.group.add(new THREE.HemisphereLight(night ? '#2a3a6a' : '#a6b0ba', night ? '#0c1a0c' : '#2d3b2a', night ? 0.38 : 1.15));
      scene.fog = night ? new THREE.Fog('#0a1020', 220, 700) : new THREE.Fog('#7d8792', 45, 260);
    }
  }

  // ───────────── поле ─────────────
  private buildPitch() {
    const wet = this.id === 'rain';
    const c1 = wet ? '#2f6b2b' : '#3f8f35';
    const c2 = wet ? '#28602a' : '#357d2e';
    const stripes = canvasTex(1024, 512, g => {
      const n = 18;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? c1 : c2;
        g.fillRect((i * 1024) / n, 0, 1024 / n + 1, 512);
      }
      for (let i = 0; i < 22000; i++) {
        const v = Math.random();
        g.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${0.025 + Math.random() * 0.04})`;
        g.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2);
      }
    });
    stripes.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.track(stripes);
    const pitchMat = this.track(new THREE.MeshStandardMaterial({ map: stripes, roughness: wet ? 0.62 : 0.95, metalness: 0 }));
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
    const lineMat = this.track(new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.8 }));
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
      const face = new THREE.Mesh(this.track(new THREE.PlaneGeometry(len, H)), this.track(new THREE.MeshBasicMaterial({ map: t })));
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
    const concrete = this.track(new THREE.MeshStandardMaterial({ color: this.id === 'night' ? '#4a4f5a' : '#80858f', roughness: 0.9 }));
    const seatColor = this.id === 'night' ? '#26355e' : '#2f4d8f';
    const seatMat = this.track(new THREE.MeshStandardMaterial({ color: seatColor, roughness: 0.8 }));
    const bodyGeo = this.track(new THREE.BoxGeometry(0.44, 0.62, 0.3));
    const headGeo = this.track(new THREE.BoxGeometry(0.2, 0.22, 0.2));
    headGeo.translate(0, 0.44, 0);

    const injectBob = (m: THREE.Material) => {
      m.onBeforeCompile = sh => {
        sh.uniforms.uTime = this.uniforms.uTime;
        sh.uniforms.uExcite = this.uniforms.uExcite;
        sh.vertexShader = 'uniform float uTime;\nuniform float uExcite;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.71 + instanceMatrix[3].y * 2.13;
            float sp = 3.0 + fract(ph * 0.37) * 4.0;
            float j = abs(sin(uTime * sp + ph));
            transformed.y += j * (0.025 + uExcite * 0.5 * step(0.25, fract(ph * 0.53)));
          #endif`,
        );
      };
      return m;
    };
    const bodyMat = this.track(injectBob(new THREE.MeshLambertMaterial()));
    const headMat = this.track(injectBob(new THREE.MeshLambertMaterial()));
    const skins = ['#f1c9a5', '#e0ac85', '#c68c63', '#8d5a3b', '#5a3520'].map(c => new THREE.Color(c));
    const palette = [
      ...homeColors.map(c => ({ c: new THREE.Color(c), w: 0.6 / homeColors.length })),
      ...awayColors.map(c => ({ c: new THREE.Color(c), w: 0.25 / awayColors.length })),
      { c: new THREE.Color('#222831'), w: 0.05 }, { c: new THREE.Color('#e0e0e0'), w: 0.05 }, { c: new THREE.Color('#5c677d'), w: 0.05 },
    ];
    const pick = () => {
      let r = Math.random();
      for (const p of palette) { r -= p.w; if (r <= 0) return p.c; }
      return palette[0].c;
    };

    const stands = [
      { len: 134, rows: 24, front: HALF_W + 8, rot: 0, roof: false },
      { len: 134, rows: 26, front: HALF_W + 8, rot: Math.PI, roof: true },
      { len: 84, rows: 20, front: HALF_L + 9, rot: Math.PI / 2, roof: true },
      { len: 84, rows: 20, front: HALF_L + 9, rot: -Math.PI / 2, roof: true },
    ];
    const rise = 0.55, depth = 0.85, base = 1.4;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const st of stands) {
      const g = new THREE.Group();
      const stepGeos: THREE.BufferGeometry[] = [];
      for (let r = 0; r < st.rows; r++) {
        const h = base + r * rise;
        const bg = new THREE.BoxGeometry(st.len, h, depth);
        bg.translate(0, h / 2, st.front + r * depth + depth / 2);
        stepGeos.push(bg);
      }
      const steps = new THREE.Mesh(this.track(mergeGeometries(stepGeos)), seatMat);
      stepGeos.forEach(s => s.dispose());
      steps.receiveShadow = true;
      g.add(steps);
      // задняя стена
      const topH = base + st.rows * rise;
      const wall = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len, topH + 4, 1)), concrete);
      wall.position.set(0, (topH + 4) / 2, st.front + st.rows * depth + 0.5);
      g.add(wall);
      // фронтальный бортик
      const lip = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len, base + 0.2, 0.3)), concrete);
      lip.position.set(0, (base + 0.2) / 2, st.front - 0.15);
      g.add(lip);
      if (st.roof) {
        const roofD = st.rows * depth + 6;
        const roof = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len + 4, 0.6, roofD)), concrete);
        roof.position.set(0, topH + 6, st.front + st.rows * depth - roofD / 2 + 1);
        roof.rotation.x = -0.06;
        g.add(roof);
        if (this.id !== 'day') {
          const strip = new THREE.Mesh(this.track(new THREE.BoxGeometry(st.len, 0.35, 0.35)), this.track(new THREE.MeshBasicMaterial({ color: '#fff6dd' })));
          strip.position.set(0, topH + 5.4, st.front + st.rows * depth - roofD + 1.2);
          g.add(strip);
        }
      }
      // болельщики
      const cols = Math.floor(st.len / 0.72);
      const max = cols * st.rows;
      const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, max);
      const heads = new THREE.InstancedMesh(headGeo, headMat, max);
      let n = 0;
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      for (let r = 0; r < st.rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > (LOW_QUALITY ? 0.35 : 0.84)) continue;
          pos.set(-st.len / 2 + (c + 0.5) * 0.72 + (Math.random() - 0.5) * 0.15, base + r * rise + 0.31, st.front + r * depth + 0.35);
          q.setFromAxisAngle(up, (Math.random() - 0.5) * 0.4 + Math.PI);
          const s = 0.9 + Math.random() * 0.2;
          scl.set(s, s, s);
          m4.compose(pos, q, scl);
          bodies.setMatrixAt(n, m4);
          heads.setMatrixAt(n, m4);
          bodies.setColorAt(n, pick());
          heads.setColorAt(n, skins[Math.floor(Math.random() * skins.length)]);
          n++;
        }
      }
      bodies.count = n; heads.count = n;
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      g.add(bodies, heads);
      g.rotation.y = st.rot;
      this.group.add(g);
    }
    // угловые блоки
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const b = new THREE.Mesh(this.track(new THREE.BoxGeometry(18, 12, 18)), concrete);
      b.position.set(sx * (HALF_L + 17), 6, sz * (HALF_W + 17));
      this.group.add(b);
    }
  }

  // ───────────── прожекторы ─────────────
  private buildFloodlights() {
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: '#5c6370', metalness: 0.5, roughness: 0.5 }));
    const lampMat = this.track(new THREE.MeshBasicMaterial({ color: '#fffbe8' }));
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
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const x = sx * (HALF_L + 16), z = sz * (HALF_W + 22);
      const pole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.5, 0.9, 42, 8)), poleMat);
      pole.position.set(x, 21, z);
      this.group.add(pole);
      const panel = new THREE.Mesh(this.track(new THREE.BoxGeometry(8, 4, 0.6)), lampMat);
      panel.position.set(x, 43, z);
      panel.lookAt(0, 0, 0);
      this.group.add(panel);
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

  // ───────────── дождь ─────────────
  private buildRain() {
    const n = LOW_QUALITY ? 2000 : 7000;
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
  }
}
