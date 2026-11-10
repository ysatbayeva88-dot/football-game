import * as THREE from 'three';
import type { Emblem, Kit } from './types';

/** Размер записи позы игрока (используется и для повторов). */
export const POSE_SIZE = 13;
// 0 x, 1 y, 2 z, 3 facing, 4 phase, 5 speedN, 6 kick (−1 нет / 0..1), 7 slide (0 нет / 0..1),
// 8 dive (−1 / 0..1), 9 diveSide, 10 celebrate (0 нет / тип 1..3), 11 fallen, 12 kickType (0 пас, 1 удар, 2 отбор)

const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
const G = {
  pelvis: (() => { const g = new THREE.CylinderGeometry(0.165, 0.18, 0.22, 16); g.scale(1, 1, 0.72); return g; })(),
  torso: (() => { const g = new THREE.CylinderGeometry(0.205, 0.165, 0.52, 20, 1); g.scale(1, 1, 0.62); return g; })(),
  chest: (() => { const g = new THREE.SphereGeometry(0.205, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.38, 0.62); return g; })(),
  neck: new THREE.CylinderGeometry(0.052, 0.058, 0.12, 10),
  head: (() => { const g = new THREE.SphereGeometry(0.112, 18, 14); g.scale(0.93, 1.1, 1.0); return g; })(),
  hairCap: (() => { const g = new THREE.SphereGeometry(0.118, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52); g.scale(0.95, 1.08, 1.03); return g; })(),
  hairBuzz: (() => { const g = new THREE.SphereGeometry(0.114, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45); g.scale(0.94, 1.1, 1.01); return g; })(),
  afro: (() => { const g = new THREE.SphereGeometry(0.145, 16, 12); g.scale(1, 0.9, 1); return g; })(),
  hairBack: (() => { const g = new THREE.CylinderGeometry(0.1, 0.085, 0.16, 12, 1, true, Math.PI * 0.6, Math.PI * 0.8); return g; })(),
  shoulder: new THREE.SphereGeometry(0.07, 12, 10),
  sleeve: cap(0.062, 0.1),
  upperArm: cap(0.05, 0.14),
  forearm: cap(0.044, 0.2),
  hand: new THREE.SphereGeometry(0.05, 10, 8),
  shortsLeg: new THREE.CylinderGeometry(0.088, 0.082, 0.17, 12),
  thigh: cap(0.068, 0.26),
  shin: cap(0.056, 0.3),
  boot: (() => { const g = cap(0.052, 0.14); g.rotateX(Math.PI / 2); g.scale(1, 0.75, 1); return g; })(),
  number: new THREE.PlaneGeometry(0.3, 0.3),
};

const SKINS = ['#f1c9a5', '#e0ac85', '#c68c63', '#a86b45', '#7d4b2c', '#5a3520', '#f6d7bd'];
const HAIRS = ['#1b1410', '#3b2516', '#6b4423', '#a87a3d', '#d8b56a', '#111111', '#2a2a2a'];
const BOOTS = ['#141414', '#f4f4f4', '#ff4f1a', '#2fe07a', '#ffd400', '#2d7bff', '#e0218a'];

function patternTexture(kit: Kit) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = kit.shirt;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = kit.stripe;
  if (kit.pattern === 'stripes') for (let i = 0; i < 8; i++) g.fillRect(i * 16 + 8, 0, 8, 128);
  else if (kit.pattern === 'band') { g.fillRect(0, 0, 10, 128); g.fillRect(118, 0, 10, 128); g.fillRect(54, 0, 20, 128); }
  else if (kit.pattern === 'hoops') for (let i = 0; i < 4; i++) g.fillRect(0, i * 32 + 16, 128, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class KitMaterials {
  shirt: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  shorts: THREE.MeshStandardMaterial;
  socks: THREE.MeshStandardMaterial;
  constructor(public kit: Kit, public emblem?: Emblem) {
    this.shirt = new THREE.MeshStandardMaterial({ map: patternTexture(kit), roughness: 0.72 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: kit.sleeves, roughness: 0.72 });
    this.shorts = new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.78 });
    this.socks = new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.85 });
  }
  dispose() {
    this.shirt.map?.dispose();
    this.shirt.dispose(); this.sleeve.dispose(); this.shorts.dispose(); this.socks.dispose();
  }
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(c: string, rough = 0.7) {
  const k = c + rough;
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: rough }); matCache.set(k, m); }
  return m;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function surname(n: string) {
  const parts = n.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const particles = ['van', 'de', 'di', 'da', 'der', 'den', 'le', 'la', 'dos', 'du'];
  let i = parts.length - 1;
  while (i > 0 && particles.includes(parts[i - 1].toLowerCase())) i--;
  return parts.slice(i).join(' ');
}

/** Поворотные суставы скелета (x/y/z-углы). */
const JOINTS = ['hips', 'spine', 'head', 'shL', 'shR', 'elL', 'elR', 'legL', 'legR', 'knL', 'knR'] as const;
type JointName = typeof JOINTS[number];
type PoseT = Record<JointName, [number, number, number]> & { hipY: number };

function newPose(): PoseT {
  const p = {} as PoseT;
  for (const j of JOINTS) p[j] = [0, 0, 0];
  p.hipY = 0.98;
  return p;
}
function lerpPose(a: PoseT, b: PoseT, t: number, out: PoseT) {
  for (const j of JOINTS) for (let i = 0; i < 3; i++) out[j][i] = a[j][i] + (b[j][i] - a[j][i]) * t;
  out.hipY = a.hipY + (b.hipY - a.hipY) * t;
  return out;
}
function copyPose(a: PoseT, out: PoseT) { return lerpPose(a, a, 0, out); }
const smooth = (x: number) => x * x * (3 - 2 * x);

export class PlayerModel {
  root = new THREE.Group();
  private j: Record<JointName, THREE.Object3D>;
  private torso: THREE.Mesh;
  private chest: THREE.Mesh;
  private pelvis: THREE.Mesh;
  private shortsLegs: THREE.Mesh[] = [];
  private sleeves: THREE.Mesh[] = [];
  private socks: THREE.Mesh[] = [];
  private backMat: THREE.MeshBasicMaterial;
  private backTex: THREE.CanvasTexture;
  private backCanvas: HTMLCanvasElement;
  private cur = newPose();
  private tgt = newPose();
  private tmpA = newPose();
  private tmpB = newPose();
  private first = true;
  private name = '';

  constructor(kitMats: KitMaterials, number: number, seed: number, name = '', isGK = false) {
    const skin = mat(SKINS[seed % SKINS.length]);
    const hair = mat(HAIRS[(seed >>> 4) % HAIRS.length], 0.9);
    const boot = mat(BOOTS[(seed >>> 7) % BOOTS.length], 0.45);
    const glove = isGK ? mat('#f5f5f5', 0.6) : skin;
    const g = () => new THREE.Group();
    this.j = { hips: g(), spine: g(), head: g(), shL: g(), shR: g(), elL: g(), elR: g(), legL: g(), legR: g(), knL: g(), knR: g() };
    const J = this.j;
    this.root.add(J.hips);
    J.hips.position.y = 0.98;

    this.pelvis = mesh(G.pelvis, kitMats.shorts, 0, -0.03, 0);
    J.hips.add(this.pelvis);
    J.hips.add(J.spine);
    J.spine.position.y = 0.06;
    this.torso = mesh(G.torso, kitMats.shirt, 0, 0.27, 0);
    this.chest = mesh(G.chest, kitMats.sleeve, 0, 0.53, 0);
    J.spine.add(this.torso, this.chest);

    // фамилия и номер на спине
    this.backCanvas = document.createElement('canvas');
    this.backCanvas.width = 256; this.backCanvas.height = 256;
    this.backTex = new THREE.CanvasTexture(this.backCanvas);
    this.backTex.colorSpace = THREE.SRGBColorSpace;
    this.backTex.anisotropy = 4;
    this.backMat = new THREE.MeshBasicMaterial({ map: this.backTex, transparent: true, depthWrite: false, toneMapped: false });
    const back = new THREE.Mesh(G.number, this.backMat);
    back.position.set(0, 0.3, -0.118);
    back.rotation.y = Math.PI;
    J.spine.add(back);
    this.name = name;
    this.setNumber(number, kitMats.kit.number, name);

    J.spine.add(mesh(G.neck, skin, 0, 0.6, 0));
    J.spine.add(J.head);
    J.head.position.y = 0.64;
    J.head.add(mesh(G.head, skin, 0, 0.09, 0.005));
    const style = (seed >>> 10) % 6;
    if (style === 0 || style === 5) J.head.add(mesh(G.hairCap, hair, 0, 0.105, -0.008));
    else if (style === 1) J.head.add(mesh(G.hairBuzz, hair, 0, 0.1, -0.004));
    else if (style === 2) J.head.add(mesh(G.afro, hair, 0, 0.14, -0.02));
    else if (style === 3) { J.head.add(mesh(G.hairCap, hair, 0, 0.105, -0.008)); J.head.add(mesh(G.hairBack, hair, 0, 0.03, 0)); }
    // style 4 — бритая голова

    for (const [sh, el, sx] of [[J.shL, J.elL, 1], [J.shR, J.elR, -1]] as const) {
      sh.position.set(0.235 * sx, 0.5, 0);
      J.spine.add(sh);
      sh.add(mesh(G.shoulder, kitMats.sleeve));
      const sl = mesh(G.sleeve, kitMats.sleeve, 0, -0.08, 0);
      this.sleeves.push(sl);
      sh.add(sl, mesh(G.upperArm, skin, 0, -0.17, 0));
      el.position.y = -0.28;
      sh.add(el);
      el.add(mesh(G.forearm, skin, 0, -0.13, 0), mesh(G.hand, glove, 0, -0.28, 0));
    }
    for (const [leg, kn, sx] of [[J.legL, J.knL, 1], [J.legR, J.knR, -1]] as const) {
      leg.position.set(0.095 * sx, -0.07, 0);
      J.hips.add(leg);
      const sl = mesh(G.shortsLeg, kitMats.shorts, 0, -0.06, 0);
      this.shortsLegs.push(sl);
      leg.add(sl, mesh(G.thigh, skin, 0, -0.25, 0));
      kn.position.y = -0.43;
      leg.add(kn);
      const sock = mesh(G.shin, kitMats.socks, 0, -0.2, 0);
      this.socks.push(sock);
      kn.add(sock, mesh(G.boot, boot, 0, -0.4, 0.04));
    }
  }

  setKit(k: KitMaterials, number: number, name = this.name) {
    this.torso.material = k.shirt;
    this.chest.material = k.sleeve;
    this.pelvis.material = k.shorts;
    for (const s of this.shortsLegs) s.material = k.shorts;
    for (const s of this.sleeves) s.material = k.sleeve;
    for (const s of this.socks) s.material = k.socks;
    this.j.shL.children[0] && ((this.j.shL.children[0] as THREE.Mesh).material = k.sleeve);
    this.j.shR.children[0] && ((this.j.shR.children[0] as THREE.Mesh).material = k.sleeve);
    this.name = name;
    this.setNumber(number, k.kit.number, name);
  }

  setNumber(n: number, color: string, name = this.name) {
    const g = this.backCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 256);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    const sn = surname(name).toUpperCase();
    if (sn) {
      let fs = 34;
      g.font = `800 ${fs}px Arial, sans-serif`;
      while (g.measureText(sn).width > 230 && fs > 16) { fs -= 2; g.font = `800 ${fs}px Arial, sans-serif`; }
      g.lineWidth = 3;
      g.strokeText(sn, 128, 40);
      g.fillText(sn, 128, 40);
    }
    g.font = 'bold 150px Arial, sans-serif';
    g.lineWidth = 7;
    g.strokeText(String(n), 128, 148);
    g.fillText(String(n), 128, 148);
    this.backTex.needsUpdate = true;
  }

  /** Строит целевую позу из записи и плавно смешивает её с текущей. */
  pose(a: ArrayLike<number>, o: number, dt = 1 / 60) {
    const ph = a[o + 4], sp = a[o + 5], kick = a[o + 6], slide = a[o + 7];
    const dive = a[o + 8], side = a[o + 9], cel = a[o + 10], fallen = a[o + 11], kind = a[o + 12];
    this.root.position.set(a[o], a[o + 1], a[o + 2]);
    this.root.rotation.y = a[o + 3];

    const T = this.tgt;
    this.locomotion(ph, sp, T);
    let fast = false;

    if (dive >= 0) {
      const t = Math.min(1, dive * 2.5);
      T.hips[2] = -side * t * 1.35;
      T.hipY = 0.98 - t * 0.35;
      T.shL = [-2.9 * Math.min(1, dive * 3), 0, 0.2];
      T.shR = [-2.9 * Math.min(1, dive * 3), 0, -0.2];
      T.elL = [0, 0, 0]; T.elR = [0, 0, 0];
      T.legL = [0.2, 0, 0.15]; T.legR = [-0.2, 0, -0.15];
      T.knL = [0.3, 0, 0]; T.knR = [0.2, 0, 0];
      fast = true;
    } else if (fallen !== 0) {
      if (Math.abs(fallen) === 1) {
        T.hips = [0, 0, -fallen * 1.4]; T.hipY = 0.35;
        T.shL = [-2.5, 0, 0]; T.shR = [-2.5, 0, 0];
      } else if (fallen >= 3) {
        // встаёт после подката
        const t = smooth(Math.min(1, fallen - 3));
        this.slidePose(this.tmpA);
        lerpPose(this.tmpA, T, t, this.tmpB);
        copyPose(this.tmpB, T);
      } else {
        T.hips = [-1.45, 0, 0]; T.hipY = 0.27;
        T.shL = [0.4, 0, 1.2]; T.shR = [0.4, 0, -1.2];
        T.knL = [0.9, 0, 0]; T.legL = [-0.4, 0, 0]; T.legR = [0, 0, 0]; T.knR = [0.2, 0, 0];
      }
      fast = true;
    } else if (slide > 0) {
      this.slidePose(this.tmpA);
      lerpPose(T, this.tmpA, smooth(Math.min(1, slide * 5)), this.tmpB);
      copyPose(this.tmpB, T);
      fast = true;
    } else if (cel > 0) {
      this.celebrate(Math.round(cel), ph, sp, T);
    }

    if (kick >= 0 && dive < 0 && fallen === 0 && slide <= 0) {
      const w = kick < 0.15 ? smooth(kick / 0.15) : kick > 0.75 ? smooth((1 - kick) / 0.25) : 1;
      this.kickPose(kick, Math.round(kind), this.tmpA, T);
      lerpPose(T, this.tmpA, w, this.tmpB);
      copyPose(this.tmpB, T);
      fast = true;
    }

    // смешивание с прошлым кадром (сглаживает переходы между анимациями)
    const k = this.first ? 1 : 1 - Math.exp(-dt * (fast ? 40 : 22));
    this.first = false;
    lerpPose(this.cur, T, k, this.cur);
    const C = this.cur, J = this.j;
    for (const n of JOINTS) J[n].rotation.set(C[n][0], C[n][1], C[n][2]);
    J.hips.position.y = C.hipY;
  }

  private locomotion(ph: number, sp: number, T: PoseT) {
    const s = Math.min(1, sp);
    const sprint = Math.max(0, (s - 0.62) / 0.38);
    const sn = Math.sin(ph), cs = Math.cos(ph);
    const amp = 0.1 + s * 0.6 + sprint * 0.25;
    T.hipY = 0.98 - s * 0.03 + Math.abs(sn) * 0.05 * s;
    T.hips = [0.04 + s * 0.14 + sprint * 0.1, -sn * 0.09 * s, 0];
    T.spine = [0.02 + sprint * 0.06, sn * 0.16 * s, 0];
    T.head = [-(0.04 + s * 0.12 + sprint * 0.1), -sn * 0.1 * s, 0];
    T.legL = [sn * amp, 0, 0.02];
    T.legR = [-sn * amp, 0, -0.02];
    T.knL = [0.06 + Math.max(0, -cs) * amp * 1.5, 0, 0];
    T.knR = [0.06 + Math.max(0, cs) * amp * 1.5, 0, 0];
    const arm = amp * 0.95;
    T.shL = [-sn * arm, 0, 0.1 + s * 0.06];
    T.shR = [sn * arm, 0, -0.1 - s * 0.06];
    T.elL = [-(0.25 + s * 0.95), 0, 0];
    T.elR = [-(0.25 + s * 0.95), 0, 0];
    if (s < 0.08) {
      // стойка: лёгкое дыхание
      const b = Math.sin(ph * 2) * 0.02;
      T.spine[0] += b; T.shL[2] = 0.12; T.shR[2] = -0.12;
      T.knL[0] = T.knR[0] = 0.12; T.hipY = 0.965;
    }
  }

  private slidePose(T: PoseT) {
    for (const j of JOINTS) T[j] = [0, 0, 0];
    T.hips = [-1.15, 0, 0.12];
    T.hipY = 0.32;
    T.spine = [0.25, 0, 0];
    T.head = [0.5, 0, 0];
    T.legR = [-0.15, 0, -0.05]; T.knR = [0.05, 0, 0];
    T.legL = [0.55, 0, 0.12]; T.knL = [1.25, 0, 0];
    T.shL = [0.9, 0, 0.55]; T.elL = [-0.3, 0, 0];
    T.shR = [-1.4, 0, -0.5]; T.elR = [-0.5, 0, 0];
  }

  private kickPose(k: number, kind: number, T: PoseT, base: PoseT) {
    copyPose(base, T);
    T.legL = [-0.12, 0, 0.04]; T.knL = [0.25, 0, 0];
    if (kind === 2) {
      // выпад-отбор
      const t = smooth(Math.min(1, k * 2.5));
      T.hipY = 0.98 - 0.12 * t;
      T.hips = [0.3 * t, 0, 0];
      T.legR = [-1.0 * t, 0, 0]; T.knR = [0.1, 0, 0];
      T.legL = [0.45 * t, 0, 0]; T.knL = [0.7 * t, 0, 0];
      T.shL = [-0.5, 0, 0.5]; T.shR = [0.4, 0, -0.5];
      return;
    }
    const back = kind === 1 ? 1.1 : 0.55, fwd = kind === 1 ? -1.55 : -0.85;
    if (k < 0.42) {
      const t = smooth(k / 0.42);
      T.legR = [back * t, kind === 0 ? -0.5 * t : 0, 0];
      T.knR = [(kind === 1 ? 1.5 : 0.7) * t, 0, 0];
      T.spine = [0.05, 0.25 * t, 0];
    } else {
      const t = smooth(Math.min(1, (k - 0.42) / 0.4));
      T.legR = [back + (fwd - back) * t, kind === 0 ? -0.5 : 0, 0];
      T.knR = [(kind === 1 ? 1.5 : 0.7) * (1 - t) + 0.08, 0, 0];
      T.spine = [kind === 1 ? -0.12 * t : 0.02, 0.25 - 0.5 * t, 0];
    }
    T.hips = [kind === 1 ? -0.08 : 0.02, 0, 0];
    T.shL = [-0.25, 0, 0.85]; T.elL = [-0.4, 0, 0];
    T.shR = [0.45, 0, -0.55]; T.elR = [-0.3, 0, 0];
  }

  private celebrate(type: number, ph: number, sp: number, T: PoseT) {
    if (type === 2) {
      // «самолёт»
      T.shL = [0, 0, 1.45]; T.shR = [0, 0, -1.45];
      T.elL = [0, 0, 0]; T.elR = [0, 0, 0];
      T.hips[2] = Math.sin(ph * 0.5) * 0.28;
    } else if (type === 3 && sp < 0.15) {
      // на коленях, руки вверх
      T.hipY = 0.5;
      T.hips = [-0.25, 0, 0];
      T.legL = [-0.1, 0, 0.1]; T.legR = [-0.1, 0, -0.1];
      T.knL = [1.7, 0, 0]; T.knR = [1.7, 0, 0];
      T.shL = [-2.8, 0, 0.35]; T.shR = [-2.8, 0, -0.35];
      T.elL = [-0.2, 0, 0]; T.elR = [-0.2, 0, 0];
      T.head = [-0.4, 0, 0];
    } else {
      // руки вверх, кулаки
      const pump = Math.sin(ph * 1.5) * 0.25;
      T.shL = [-2.7 + pump, 0, 0.3]; T.shR = [-2.7 - pump, 0, -0.3];
      T.elL = [-0.5, 0, 0]; T.elR = [-0.5, 0, 0];
      T.head = [-0.25, 0, 0];
    }
  }

  dispose() {
    this.backTex.dispose();
    this.backMat.dispose();
  }
}

export { SKINS };
