import * as THREE from 'three';
import type { Kit } from './types';

/** Размер записи позы игрока (используется для повторов). */
export const POSE_SIZE = 12;
// 0 x, 1 y, 2 z, 3 facing, 4 phase, 5 speedN, 6 kick, 7 slide, 8 dive, 9 diveSide, 10 celebrate, 11 fallen

const G = {
  shorts: new THREE.BoxGeometry(0.4, 0.24, 0.24),
  torso: new THREE.BoxGeometry(0.44, 0.56, 0.25),
  number: new THREE.PlaneGeometry(0.26, 0.26),
  head: new THREE.SphereGeometry(0.12, 12, 10),
  hair: new THREE.SphereGeometry(0.127, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  sleeve: new THREE.BoxGeometry(0.13, 0.22, 0.13),
  forearm: new THREE.BoxGeometry(0.095, 0.32, 0.095),
  thigh: new THREE.BoxGeometry(0.15, 0.42, 0.15),
  shin: new THREE.BoxGeometry(0.13, 0.4, 0.13),
  shoe: new THREE.BoxGeometry(0.13, 0.08, 0.26),
};

const SKINS = ['#f1c9a5', '#e0ac85', '#c68c63', '#a86b45', '#7d4b2c', '#5a3520', '#f6d7bd'];
const HAIRS = ['#1b1410', '#3b2516', '#6b4423', '#a87a3d', '#d8b56a', '#111111', '#2a2a2a'];

function patternTexture(kit: Kit) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = kit.shirt;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = kit.stripe;
  if (kit.pattern === 'stripes') {
    for (let i = 0; i < 4; i++) g.fillRect(i * 32 + 16, 0, 16, 128);
  } else if (kit.pattern === 'band') {
    g.fillRect(44, 0, 40, 128);
  } else if (kit.pattern === 'hoops') {
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 32 + 16, 128, 14);
  }
  // воротник
  g.fillStyle = kit.sleeves;
  g.fillRect(0, 0, 128, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class KitMaterials {
  shirt: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  shorts: THREE.MeshStandardMaterial;
  socks: THREE.MeshStandardMaterial;
  constructor(public kit: Kit) {
    this.shirt = new THREE.MeshStandardMaterial({ map: patternTexture(kit), roughness: 0.75 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: kit.sleeves, roughness: 0.75 });
    this.shorts = new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.8 });
    this.socks = new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.85 });
  }
  dispose() {
    this.shirt.map?.dispose();
    this.shirt.dispose(); this.sleeve.dispose(); this.shorts.dispose(); this.socks.dispose();
  }
}

const shoeMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
const skinMats = new Map<string, THREE.MeshStandardMaterial>();
function skinMat(c: string) {
  let m = skinMats.get(c);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }); skinMats.set(c, m); }
  return m;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export class PlayerModel {
  root = new THREE.Group();
  body = new THREE.Group();
  private torso: THREE.Mesh;
  private shortsM: THREE.Mesh;
  private sleeves: THREE.Mesh[] = [];
  private socks: THREE.Mesh[] = [];
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private numberMat: THREE.MeshBasicMaterial;
  private numberTex: THREE.CanvasTexture;
  private numberCanvas: HTMLCanvasElement;

  constructor(kitMats: KitMaterials, number: number, seed: number) {
    const skin = skinMat(SKINS[seed % SKINS.length]);
    const hair = skinMat(HAIRS[(seed >>> 4) % HAIRS.length]);
    this.root.add(this.body);
    this.body.position.y = 0.95;

    this.shortsM = mesh(G.shorts, kitMats.shorts, 0, -0.05, 0);
    this.torso = mesh(G.torso, kitMats.shirt, 0, 0.33, 0);
    this.body.add(this.shortsM, this.torso);

    this.numberCanvas = document.createElement('canvas');
    this.numberCanvas.width = 128; this.numberCanvas.height = 128;
    this.numberTex = new THREE.CanvasTexture(this.numberCanvas);
    this.numberTex.colorSpace = THREE.SRGBColorSpace;
    this.numberMat = new THREE.MeshBasicMaterial({ map: this.numberTex, transparent: true, depthWrite: false });
    const num = new THREE.Mesh(G.number, this.numberMat);
    num.position.set(0, 0.36, -0.127);
    num.rotation.y = Math.PI;
    this.body.add(num);
    this.setNumber(number, kitMats.kit.number);

    this.body.add(mesh(G.head, skin, 0, 0.75, 0));
    const h = mesh(G.hair, hair, 0, 0.765, -0.01);
    this.body.add(h);

    for (const [arm, sx] of [[this.armL, 1], [this.armR, -1]] as const) {
      arm.position.set(0.285 * sx, 0.56, 0);
      const sl = mesh(G.sleeve, kitMats.sleeve, 0, -0.1, 0);
      this.sleeves.push(sl);
      arm.add(sl, mesh(G.forearm, skin, 0, -0.37, 0));
      this.body.add(arm);
    }
    for (const [leg, knee, sx] of [[this.legL, this.kneeL, 1], [this.legR, this.kneeR, -1]] as const) {
      leg.position.set(0.105 * sx, -0.08, 0);
      leg.add(mesh(G.thigh, skin, 0, -0.2, 0));
      knee.position.y = -0.42;
      const sock = mesh(G.shin, kitMats.socks, 0, -0.2, 0);
      this.socks.push(sock);
      knee.add(sock, mesh(G.shoe, shoeMat, 0, -0.43, 0.05));
      leg.add(knee);
      this.body.add(leg);
    }
  }

  setKit(k: KitMaterials, number: number) {
    this.torso.material = k.shirt;
    this.shortsM.material = k.shorts;
    for (const s of this.sleeves) s.material = k.sleeve;
    for (const s of this.socks) s.material = k.socks;
    this.setNumber(number, k.kit.number);
  }

  setNumber(n: number, color: string) {
    const g = this.numberCanvas.getContext('2d')!;
    g.clearRect(0, 0, 128, 128);
    g.font = 'bold 92px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.strokeText(String(n), 64, 68);
    g.fillStyle = color;
    g.fillText(String(n), 64, 68);
    this.numberTex.needsUpdate = true;
  }

  pose(a: ArrayLike<number>, o: number) {
    const ph = a[o + 4], sp = a[o + 5], kick = a[o + 6], slide = a[o + 7];
    const dive = a[o + 8], side = a[o + 9], cel = a[o + 10], fallen = a[o + 11];
    this.root.position.set(a[o], a[o + 1], a[o + 2]);
    this.root.rotation.y = a[o + 3];

    const b = this.body;
    b.rotation.set(0, 0, 0);
    b.position.y = 0.95;
    this.armL.rotation.set(0, 0, 0.08);
    this.armR.rotation.set(0, 0, -0.08);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.kneeL.rotation.set(0, 0, 0);
    this.kneeR.rotation.set(0, 0, 0);

    if (dive >= 0) {
      const t = Math.min(1, dive * 2.5);
      b.rotation.z = -side * t * 1.35;
      b.position.y = 0.95 - t * 0.35;
      this.armL.rotation.x = this.armR.rotation.x = -2.9 * Math.min(1, dive * 3);
      this.legL.rotation.x = 0.2; this.legR.rotation.x = -0.2;
      return;
    }
    if (fallen !== 0) {
      if (Math.abs(fallen) === 1) { b.rotation.z = -fallen * 1.4; b.position.y = 0.35; this.armL.rotation.x = this.armR.rotation.x = -2.5; }
      else { b.rotation.x = -1.45; b.position.y = 0.25; this.armL.rotation.z = 1.2; this.armR.rotation.z = -1.2; this.kneeL.rotation.x = 0.6; }
      return;
    }
    if (slide > 0) {
      b.rotation.x = -1.2;
      b.position.y = 0.38;
      this.legR.rotation.x = -0.25;
      this.legL.rotation.x = 0.5; this.kneeL.rotation.x = 1.0;
      this.armL.rotation.set(0.6, 0, 0.9); this.armR.rotation.set(0.6, 0, -0.9);
      return;
    }
    if (cel > 0) {
      this.armL.rotation.set(-2.7, 0, 0.3);
      this.armR.rotation.set(-2.7, 0, -0.3);
    }

    // бег
    const s = Math.sin(ph), c = Math.cos(ph);
    const amp = 0.12 + sp * 0.75;
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    this.kneeL.rotation.x = Math.max(0, -c) * amp * 1.3;
    this.kneeR.rotation.x = Math.max(0, c) * amp * 1.3;
    if (cel <= 0) {
      this.armL.rotation.x = -s * amp * 0.85;
      this.armR.rotation.x = s * amp * 0.85;
    }
    b.rotation.x = sp * 0.2;
    b.position.y = 0.95 + Math.abs(s) * 0.045 * sp;

    if (kick >= 0) {
      if (kick < 0.45) {
        const t = kick / 0.45;
        this.legR.rotation.x = t * 0.95;
        this.kneeR.rotation.x = t * 1.2;
      } else {
        const t = Math.min(1, (kick - 0.45) / 0.55);
        const e = 1 - (1 - t) * (1 - t);
        this.legR.rotation.x = 0.95 - e * 2.2;
        this.kneeR.rotation.x = 1.2 * (1 - e);
      }
      this.legL.rotation.x = -0.1;
      this.kneeL.rotation.x = 0.2;
      this.armL.rotation.set(-0.2, 0, 0.7);
      this.armR.rotation.set(0.3, 0, -0.5);
      b.rotation.x = -0.08;
    }
  }

  dispose() {
    this.numberTex.dispose();
    this.numberMat.dispose();
  }
}

export { SKINS };
