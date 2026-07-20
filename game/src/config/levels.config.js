/**
 * levels.config.js — every level is pure data consumed by the Level class.
 *
 * To add a 5th level (swamp / cave / temple):
 *   1. Add a biome entry in theme.config.js (fog/sky/sun colors).
 *   2. (Optional) add a scatter kind in levels/biomes.js for its props.
 *   3. Append a level object here. Done — menus, save, portals all follow.
 *
 * Fields:
 *   biome        : key into THEME.biomes
 *   size         : playable square (meters); walls auto-placed at edges
 *   scatter[]    : procedural prop groups {kind, count, ...opts} (visual + collision)
 *   playerSpawn  : [x,z]
 *   waves[]      : sequential — next wave spawns when previous is cleared.
 *                  Each: {enemies: [{type, count}], area: [x,z,radius]}
 *   pickups[]    : {kind: 'health'|'ammo'|'weapon', weapon?, pos: [x,z]}
 *   boss         : {type, pos: [x,z]} — spawns after all waves cleared
 *   exit         : [x,z] portal position — unlocks when boss dies
 *   difficulty   : multiplies enemy hp & damage (per-level scaling)
 *   objectives   : shown in the quest tracker, advanced by the Level
 */
export const LEVELS = [
  {
    id: 'forest', name: 'Verdant Hollow', biome: 'forest',
    size: 140, difficulty: 1.0,
    scatter: [
      { kind: 'trees', count: 130 },
      { kind: 'rocks', count: 25 },
      { kind: 'godrays', count: 6 },
    ],
    playerSpawn: [0, 55],
    waves: [
      { enemies: [{ type: 'stalker', count: 3 }], area: [0, 25, 12] },
      { enemies: [{ type: 'stalker', count: 3 }, { type: 'sentinel', count: 2 }], area: [-20, -5, 15] },
      { enemies: [{ type: 'sentinel', count: 3 }, { type: 'stalker', count: 2 }], area: [15, -30, 15] },
    ],
    pickups: [
      { kind: 'health', pos: [8, 30] },
      { kind: 'ammo', pos: [-14, 5] },
      { kind: 'weapon', weapon: 'shotgun', pos: [18, -12] },
      { kind: 'health', pos: [-10, -35] },
      { kind: 'ammo', pos: [5, -45] },
    ],
    boss: { type: 'forestGuardian', pos: [0, -50] },
    exit: [0, -62],
    objectives: [
      'Push into the hollow and clear the mech patrols',
      'Defeat the Thornback Guardian',
      'Claim the treasure fragment',
      'Reach the exit portal',
    ],
  },

  {
    id: 'desert', name: 'Sunscar Dunes', biome: 'desert',
    size: 180, difficulty: 1.35,
    scatter: [
      { kind: 'dunes', count: 14 },
      { kind: 'ruins', count: 10 },
      { kind: 'rocks', count: 18 },
      { kind: 'shimmer', count: 1 },   // heat-shimmer post effect flag
    ],
    playerSpawn: [0, 75],
    waves: [
      { enemies: [{ type: 'scarab', count: 4 }], area: [0, 40, 15] },
      { enemies: [{ type: 'duneRaider', count: 3 }, { type: 'scarab', count: 2 }], area: [-30, 0, 18] },
      { enemies: [{ type: 'duneRaider', count: 3 }, { type: 'scarab', count: 4 }], area: [25, -35, 18] },
    ],
    pickups: [
      { kind: 'health', pos: [10, 45] },
      { kind: 'ammo', pos: [-18, 20] },
      { kind: 'weapon', weapon: 'rifle', pos: [-30, -5] },
      { kind: 'health', pos: [20, -20] },
      { kind: 'ammo', pos: [0, -50] },
      { kind: 'health', pos: [-15, -60] },
    ],
    boss: { type: 'duneColossus', pos: [0, -65] },
    exit: [0, -80],
    objectives: [
      'Cross the dunes and destroy the raider packs',
      'Defeat the Dune Colossus',
      'Claim the treasure fragment',
      'Reach the exit portal',
    ],
  },

  {
    id: 'sea', name: 'Wreckwater Coast', biome: 'sea',
    size: 160, difficulty: 1.7,
    scatter: [
      { kind: 'water', count: 1 },     // animated water plane past the shore
      { kind: 'shipwrecks', count: 4 },
      { kind: 'docks', count: 1 },     // platforming path over the water
      { kind: 'rocks', count: 20 },
    ],
    playerSpawn: [0, 65],
    waves: [
      { enemies: [{ type: 'corsair', count: 4 }], area: [0, 30, 14] },
      { enemies: [{ type: 'harpooner', count: 3 }, { type: 'corsair', count: 2 }], area: [-25, -5, 16] },
      { enemies: [{ type: 'harpooner', count: 4 }, { type: 'corsair', count: 3 }], area: [20, -35, 16] },
    ],
    pickups: [
      { kind: 'health', pos: [12, 40] },
      { kind: 'ammo', pos: [-15, 15] },
      { kind: 'health', pos: [25, -25] },
      { kind: 'ammo', pos: [-8, -45] },
    ],
    boss: { type: 'krakenHull', pos: [0, -55] },
    exit: [0, -70],
    objectives: [
      'Fight through the wreckage and clear the pirate mechs',
      'Defeat the Kraken Hull',
      'Claim the treasure fragment',
      'Reach the exit portal',
    ],
  },
];

/** Fragments needed to reveal the final treasure (one per level). */
export const TOTAL_FRAGMENTS = LEVELS.length;
