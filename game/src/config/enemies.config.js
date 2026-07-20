/**
 * enemies.config.js — every enemy & boss is data. Mesh is assembled from
 * primitives by Enemy.buildMesh() using the `body` descriptor; swap in a
 * glTF later by adding a `model` field and handling it in Enemy.
 *
 * AI fields:
 *   detectRange   : starts chasing if player seen (LOS) within this
 *   proximity     : always detects within this, LOS or not
 *   attackRange   : starts attacking within this
 *   speed         : chase speed (m/s); patrol is 40% of this
 *   attackKind    : 'melee' lunge | 'ranged' hitscan volley
 *
 * Biome variants reuse a base via `extends` and override colors/stats —
 * same mech language, different wear (moss / sand / barnacles).
 */
export const ENEMIES = {
  // ---- Forest -------------------------------------------------------------
  stalker: { // wolf-like quadruped mech, melee ambusher
    name: 'Moss Stalker', kind: 'melee',
    hp: 60, damage: 12, speed: 6.5, attackRange: 2.2, attackCooldown: 1.1,
    detectRange: 22, proximity: 6, xpFragments: 0,
    body: { form: 'quad', scale: 1.0, tint: 0x2c3b2e },   // moss-covered
    score: 10,
  },
  sentinel: { // bipedal ranged mech
    name: 'Grove Sentinel', kind: 'ranged',
    hp: 85, damage: 8, speed: 4.2, attackRange: 18, attackCooldown: 1.8,
    burst: 3, burstGap: 0.18, aimError: 0.06,
    detectRange: 28, proximity: 8,
    body: { form: 'biped', scale: 1.1, tint: 0x27342a },
    score: 15,
  },

  // ---- Desert -------------------------------------------------------------
  scarab: { // skittering melee mech, sand-worn
    name: 'Rust Scarab', kind: 'melee',
    hp: 50, damage: 10, speed: 7.5, attackRange: 2.0, attackCooldown: 0.9,
    detectRange: 26, proximity: 7,
    body: { form: 'quad', scale: 0.85, tint: 0x6b4a2a },  // rusted
    score: 10,
  },
  duneRaider: { // ranged, longer reach in open dunes
    name: 'Dune Raider', kind: 'ranged',
    hp: 95, damage: 10, speed: 4.6, attackRange: 26, attackCooldown: 2.0,
    burst: 4, burstGap: 0.15, aimError: 0.05,
    detectRange: 38, proximity: 8,
    body: { form: 'biped', scale: 1.15, tint: 0x7a5c33 },
    score: 15,
  },

  // ---- Sea / Coast --------------------------------------------------------
  corsair: { // barnacled boarding mech, melee
    name: 'Barnacle Corsair', kind: 'melee',
    hp: 75, damage: 14, speed: 6.0, attackRange: 2.4, attackCooldown: 1.2,
    detectRange: 24, proximity: 7,
    body: { form: 'quad', scale: 1.1, tint: 0x2e4a4e },   // corroded teal
    score: 12,
  },
  harpooner: { // ranged pirate mech
    name: 'Tide Harpooner', kind: 'ranged',
    hp: 90, damage: 11, speed: 4.0, attackRange: 22, attackCooldown: 2.2,
    burst: 2, burstGap: 0.3, aimError: 0.045,
    detectRange: 30, proximity: 8,
    body: { form: 'biped', scale: 1.1, tint: 0x33505a },
    score: 15,
  },
};

/**
 * Bosses — massive mechs with phase-gated glowing cores.
 * phases[]: hpFrac is where the phase *ends* (1 → 0.66 → 0.33 → 0).
 * Exposed core count drops per phase; each phase transition retracts a core,
 * speeds the boss up, and shortens its attack cooldown.
 */
export const BOSSES = {
  forestGuardian: {
    name: 'Thornback Guardian',
    hp: 600, speed: 3.2, attackRange: 3.5, meleeDamage: 20,
    rangedDamage: 9, burst: 5, burstGap: 0.14, aimError: 0.07, rangedRange: 24,
    detectRange: 60, proximity: 60,
    body: { form: 'boss', scale: 2.6, tint: 0x22301f },
    phases: [
      { until: 0.66, speedMul: 1.0, cooldown: 2.4, cores: 3 },
      { until: 0.33, speedMul: 1.25, cooldown: 1.8, cores: 2 },
      { until: 0.0,  speedMul: 1.5, cooldown: 1.2, cores: 1 },
    ],
    score: 100,
  },
  duneColossus: {
    name: 'Dune Colossus',
    hp: 800, speed: 3.0, attackRange: 4.0, meleeDamage: 24,
    rangedDamage: 11, burst: 6, burstGap: 0.12, aimError: 0.06, rangedRange: 30,
    detectRange: 70, proximity: 70,
    body: { form: 'boss', scale: 3.0, tint: 0x5c4326 },
    phases: [
      { until: 0.66, speedMul: 1.0, cooldown: 2.2, cores: 3 },
      { until: 0.33, speedMul: 1.3, cooldown: 1.6, cores: 2 },
      { until: 0.0,  speedMul: 1.6, cooldown: 1.0, cores: 1 },
    ],
    score: 150,
  },
  krakenHull: {
    name: 'Kraken Hull',
    hp: 1000, speed: 2.8, attackRange: 4.5, meleeDamage: 28,
    rangedDamage: 12, burst: 6, burstGap: 0.12, aimError: 0.055, rangedRange: 32,
    detectRange: 70, proximity: 70,
    body: { form: 'boss', scale: 3.2, tint: 0x1f3a40 },
    phases: [
      { until: 0.7, speedMul: 1.0, cooldown: 2.0, cores: 3 },
      { until: 0.35, speedMul: 1.3, cooldown: 1.5, cores: 2 },
      { until: 0.0, speedMul: 1.7, cooldown: 1.0, cores: 1 },
    ],
    score: 200,
  },
};
