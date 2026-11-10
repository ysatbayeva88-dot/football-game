import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * strength * 2.2; gl_FragColor = vec4(c.rgb * clamp(v, 0.0, 1.0), c.a); }`,
};

/** GTAO, который считается в половинном разрешении (экономия на видеокарте). */
class HalfGTAOPass extends GTAOPass {
  setSize(w: number, h: number) { super.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2))); }
}

/** Пост-обработка для высокого качества графики: GTAO, bloom прожекторов, виньетка, SMAA. */
export class PostFX {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, night: boolean) {
    const w = window.innerWidth, h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    const ao = new HalfGTAOPass(scene, camera, w, h);
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    ao.blendIntensity = 0.85;
    this.composer.addPass(ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), night ? 0.4 : 0.16, 0.4, night ? 0.94 : 0.98);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(VignetteShader));
    this.composer.addPass(new SMAAPass());
    this.setSize(w, h, renderer.getPixelRatio());
  }

  setSize(w: number, h: number, pr: number) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render(dt: number) { this.composer.render(dt); }

  dispose() {
    for (const p of this.composer.passes) (p as unknown as { dispose?: () => void }).dispose?.();
    this.composer.dispose();
  }
}
