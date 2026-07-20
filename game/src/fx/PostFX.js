/**
 * PostFX — EffectComposer chain: render → UnrealBloom (emissive cores glow)
 * → optional heat-shimmer (desert) → output. Per-biome color grading is a
 * cheap CSS tint overlay (THEME.biomes[x].grade) set by GameManager.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { THEME } from '../config/theme.config.js';

/** Screen-space heat haze: wobbling uv distortion, stronger near the horizon. */
const HeatShimmerShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uStrength: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      // horizon band: strongest around mid-screen, fading up/down
      float band = smoothstep(0.25, 0.5, vUv.y) * (1.0 - smoothstep(0.5, 0.8, vUv.y));
      float wob = sin(vUv.y * 90.0 + uTime * 3.5) * sin(vUv.x * 40.0 - uTime * 2.0);
      vec2 uv = vUv + vec2(wob * 0.0035, wob * 0.0015) * band * uStrength;
      gl_FragColor = texture2D(tDiffuse, uv);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const b = THEME.post.bloom;
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), b.strength, b.radius, b.threshold
    );
    this.composer.addPass(this.bloom);

    this.shimmer = new ShaderPass(HeatShimmerShader);
    this.composer.addPass(this.shimmer);

    this.composer.addPass(new OutputPass());
  }

  /** @param {boolean} on desert heat haze */
  setShimmer(on) {
    this.shimmer.uniforms.uStrength.value = on ? 1.0 : 0.0;
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  render(dt) {
    this.shimmer.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
