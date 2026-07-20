/**
 * theme.config.js — single source of truth for the whole look & feel.
 *
 * Art direction: cinematic Horizon Zero Dawn — lush saturated biomes,
 * volumetric sun shafts, dark metallic mechs with red-orange cores.
 * Color triad: WARM gold (player/friendly) · COOL blue-green (environment)
 * · HOT red-orange (enemy tech). Retune the entire game from this file.
 */

// ---- Renderer & post-processing -------------------------------------------
export const RENDER = {
  toneMapping: 'ACESFilmic',
  exposure: 1.05,
  bloom: { strength: 0.55, radius: 0.4, threshold: 0.85 }, // core glow + sun only
  ssao: { radius: 0.25, intensity: 0.9 },
  vignette: 0.35,
  filmGrain: 0.035,
  envIntensity: 0.55,       // image-based-lighting strength on PBR materials
};

// ---- Per-biome atmosphere --------------------------------------------------
// sun.azimuth/elevation are degrees; PostFX grades come from gradeTint.
export const BIOMES = {
  forest: {
    sky: '#8fb9c9', fogColor: '#9ec2c4', fogDensity: 0.018,
    sun: { color: '#fff2d6', intensity: 3.2, azimuth: 135, elevation: 42 },
    hemi: { sky: '#bcd6e0', ground: '#3a4a2a', intensity: 0.6 },
    groundTint: '#4a6b3a',
    godRays: true,
    gradeLUT: 'lush_green',
    gradeTint: [0.96, 1.06, 0.99], saturation: 1.12,   // saturated greens, cool shadows
    enemyCoreEmissive: '#ff3a12', enemyCoreIntensity: 4.0,
    ground: 'grass', footstep: 'grass',
  },
  desert: {
    sky: '#d9c9a0', fogColor: '#e6d3a8', fogDensity: 0.010,
    sun: { color: '#ffe6b0', intensity: 4.0, azimuth: 110, elevation: 60 },
    hemi: { sky: '#e8dcc0', ground: '#7a6238', intensity: 0.7 },
    groundTint: '#c2a35c',
    godRays: true,             // + heat-shimmer pass on top
    gradeLUT: 'hot_orange',
    gradeTint: [1.05, 1.0, 0.93], saturation: 1.06,
    enemyCoreEmissive: '#ff3a12', enemyCoreIntensity: 4.0,
    ground: 'sand', footstep: 'sand',
  },
  sea: {
    sky: '#7fa8b8', fogColor: '#8fb4bd', fogDensity: 0.014,
    sun: { color: '#eaf4ff', intensity: 3.0, azimuth: 150, elevation: 38 },
    hemi: { sky: '#a9cede', ground: '#2f4a52', intensity: 0.65 },
    groundTint: '#4a6d70',
    godRays: false,
    gradeLUT: 'cool_teal',
    gradeTint: [0.94, 1.02, 1.08], saturation: 1.05,
    enemyCoreEmissive: '#ff3a12', enemyCoreIntensity: 4.0,
    ground: 'sand', footstep: 'sand',
  },
};

// ---- Locomotion feel -------------------------------------------------------
export const LOCOMOTION = {
  walkSpeed: 1.4, runSpeed: 4.0, sprintSpeed: 6.5, aimSpeed: 2.2,
  accel: 18, decel: 24,          // m/s² ramp up / ease out
  turnResponse: 0.15,            // seconds to face move direction
  leanAmount: 6,                 // degrees into turns/sprint
  crossfade: 0.25,               // seconds between anim states
  jumpVelocity: 8.5,
  rollSpeed: 13, rollTime: 0.42, rollStamina: 25,
  sprintDrain: 18, staminaRegen: 22,
  headBob: { amp: 0.035, freq: 2.1 },  // kept low — no nausea
  camera: { followLerp: 0.12, lookLerp: 0.15, aimFov: 55, hipFov: 70, landDip: 0.18 },
};

// ---- Entity color language (combat readability — identical across biomes) --
export const THEME = {
  colors: {
    playerGold: 0xd4a437,
    playerGoldEmissive: 0xffc94d,
    friendlyLight: 0xffd27f,
    enemyCore: 0xff3a12,        // matches BIOMES.*.enemyCoreEmissive
    enemyCoreHot: 0xff6a00,
    enemyMetal: 0x1c2126,
    treasure: 0xffe08a,
    uiWarm: '#e8b64c',
    uiCool: '#7fd4c1',
    uiHot: '#ff5533',
    uiText: '#e8dcc0',
  },
  materials: {
    enemyBody:   { metalness: 0.9, roughness: 0.35 },
    enemyCore:   { emissiveIntensity: 4.0, metalness: 0.1, roughness: 0.4 },
    playerArmor: { metalness: 0.55, roughness: 0.5 },
    ground:      { metalness: 0.0, roughness: 1.0 },
  },
  post: { vignette: RENDER.vignette },
};

/** Sun direction from azimuth/elevation degrees → world position at radius. */
export function sunPosition(sun, radius = 90) {
  const az = (sun.azimuth * Math.PI) / 180;
  const el = (sun.elevation * Math.PI) / 180;
  return [
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    radius * Math.cos(el) * Math.cos(az),
  ];
}
