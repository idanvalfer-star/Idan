/**
 * PostFX — EffectComposer chain:
 *   render → GTAO (contact shadows) → UnrealBloom (cores + sun only) →
 *   heat-shimmer (desert) → grade (per-biome tint, saturation, vignette,
 *   film grain) → Output (tone map) → FXAA.
 *
 * All tunables come from RENDER / BIOMES in theme.config.js.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RENDER } from '../config/theme.config.js';

/** Screen-space heat haze: wobbling uv distortion, strongest near the horizon. */
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
      float band = smoothstep(0.25, 0.5, vUv.y) * (1.0 - smoothstep(0.5, 0.8, vUv.y));
      float wob = sin(vUv.y * 90.0 + uTime * 3.5) * sin(vUv.x * 40.0 - uTime * 2.0);
      vec2 uv = vUv + vec2(wob * 0.0035, wob * 0.0015) * band * uStrength;
      gl_FragColor = texture2D(tDiffuse, uv);
    }`,
};

/** Per-biome color grade + saturation + vignette + film grain in one pass. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1.0 },
    uVignette: { value: RENDER.vignette },
    uGrain: { value: RENDER.filmGrain },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb *= uTint;
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      // vignette
      float d = distance(vUv, vec2(0.5)) * 1.4142;
      c.rgb *= 1.0 - smoothstep(0.55, 1.05, d) * uVignette;
      // film grain
      c.rgb += (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // GTAO grounds objects with contact shadows; skipped gracefully if the
    // platform can't support it (e.g. software GL in tests).
    try {
      this.gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = RENDER.ssao.intensity;
      this.gtao.updateGtaoMaterial({ radius: RENDER.ssao.radius, scale: 1, thickness: 1 });
      this.composer.addPass(this.gtao);
    } catch (e) {
      console.warn('GTAO unavailable, continuing without AO:', e.message);
      this.gtao = null;
    }

    const b = RENDER.bloom;
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), b.strength, b.radius, b.threshold
    );
    this.composer.addPass(this.bloom);

    this.shimmer = new ShaderPass(HeatShimmerShader);
    this.composer.addPass(this.shimmer);

    // tone map first, then grade in display space — keeps grain/vignette
    // perceptually uniform instead of exploding in the shadows
    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.fxaa = new ShaderPass(FXAAShader);
    this.setFXAASize();
    this.composer.addPass(this.fxaa);
  }

  setFXAASize() {
    const pr = Math.min(window.devicePixelRatio, 2);
    this.fxaa.material.uniforms.resolution.value.set(
      1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr)
    );
  }

  /** @param {boolean} on desert heat haze */
  setShimmer(on) {
    this.shimmer.uniforms.uStrength.value = on ? 1.0 : 0.0;
  }

  /** Apply a biome's grade (tint + saturation) from BIOMES config. */
  setBiome(biome) {
    const t = biome?.gradeTint ?? [1, 1, 1];
    this.grade.uniforms.uTint.value.set(t[0], t[1], t[2]);
    this.grade.uniforms.uSaturation.value = biome?.saturation ?? 1.0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.gtao?.setSize(w, h);
    this.setFXAASize();
  }

  render(dt) {
    this.shimmer.uniforms.uTime.value += dt;
    this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt) % 100;
    this.composer.render(dt);
  }
}
