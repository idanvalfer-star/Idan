/**
 * theme.config.js — single source of truth for the game's look.
 *
 * Art direction: Horizon Zero Dawn-inspired. Lush saturated biomes,
 * hostile glowing-core mech enemies. Color triad:
 *   WARM  gold/amber  → player, friendly light, pickups
 *   COOL  blue-greens → environments
 *   HOT   red-orange  → enemy tech (eyes, cores, weak points)
 *
 * Tune the whole game's look from this one file.
 */

export const THEME = {
  // ---- The warm/cool/hot color triad -------------------------------------
  colors: {
    playerGold: 0xd4a437,       // player armor / friendly accents
    playerGoldEmissive: 0xffc94d,
    friendlyLight: 0xffd27f,    // torches, pickups glow
    enemyCore: 0xff3b14,        // hot red-orange emissive — ALL enemy tech
    enemyCoreHot: 0xff6a00,     // brighter variant for bosses / enraged
    enemyMetal: 0x1c2126,       // dark metallic mech bodies
    treasure: 0xffe08a,         // treasure fragments
    uiWarm: '#e8b64c',
    uiCool: '#7fd4c1',
    uiHot: '#ff5533',
    uiText: '#e8dcc0',
  },

  // ---- Material presets (feed into MeshStandardMaterial) -----------------
  materials: {
    enemyBody:   { metalness: 0.9, roughness: 0.35 },
    enemyCore:   { emissiveIntensity: 2.5, metalness: 0.1, roughness: 0.4 },
    playerArmor: { metalness: 0.55, roughness: 0.5 },
    ground:      { metalness: 0.0, roughness: 1.0 },
  },

  // ---- Post-processing ----------------------------------------------------
  post: {
    bloom: { strength: 0.85, radius: 0.6, threshold: 0.72 },
    vignette: 0.28, // 0..1 darkening at screen edges (applied via CSS overlay)
  },

  // ---- Per-biome atmosphere: fog, sky, sun, grading -----------------------
  // Each Level pulls its biome key from levels.config.js.
  biomes: {
    forest: {
      sky: 0x89b9a8, fogColor: 0x5d8a76, fogNear: 18, fogFar: 95,
      sunColor: 0xffe9b8, sunIntensity: 2.6, sunPos: [40, 65, 25],
      hemiSky: 0xa8d8c0, hemiGround: 0x2a3d2f, hemiIntensity: 0.55,
      groundColor: 0x2f4d33, grade: 'rgba(40,90,60,0.06)',
    },
    desert: {
      sky: 0xf2c98a, fogColor: 0xe8b877, fogNear: 30, fogFar: 160,
      sunColor: 0xfff0cc, sunIntensity: 3.4, sunPos: [55, 80, -20],
      hemiSky: 0xffe0b0, hemiGround: 0x8a6a3a, hemiIntensity: 0.7,
      groundColor: 0xc9a35e, grade: 'rgba(255,140,40,0.07)',
    },
    sea: {
      sky: 0x7fb8c9, fogColor: 0x6aa7bb, fogNear: 25, fogFar: 130,
      sunColor: 0xf5f0dd, sunIntensity: 2.9, sunPos: [-45, 60, 35],
      hemiSky: 0xbfe4ee, hemiGround: 0x2e4a52, hemiIntensity: 0.6,
      groundColor: 0xb8a06a, grade: 'rgba(30,140,160,0.07)',
    },
  },
};
