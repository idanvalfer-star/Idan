/**
 * weapons.config.js — all weapon stats. Add a weapon here + (optionally) a
 * mesh builder in Weapon.js and it becomes collectible/usable everywhere.
 *
 * damage      : per pellet
 * pellets     : rays per shot (shotgun > 1)
 * spread      : max radians of cone deviation (hip fire; aiming halves it)
 * fireRate    : shots per second (auto = hold to fire)
 * magSize     : rounds per magazine
 * reserveMax  : max carried reserve ammo
 */
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Scout Pistol',
    damage: 22, pellets: 1, spread: 0.012, fireRate: 3.5, auto: false,
    magSize: 12, reserveStart: 60, reserveMax: 120,
    reloadTime: 1.1, range: 80, sound: 'pistol',
    tracerColor: 0xffd27f,
  },
  shotgun: {
    id: 'shotgun', name: 'Wrecker Shotgun',
    damage: 11, pellets: 7, spread: 0.055, fireRate: 1.1, auto: false,
    magSize: 6, reserveStart: 24, reserveMax: 48,
    reloadTime: 1.9, range: 35, sound: 'shotgun',
    tracerColor: 0xffb056,
  },
  rifle: {
    id: 'rifle', name: 'Longclaw Rifle',
    damage: 16, pellets: 1, spread: 0.02, fireRate: 8, auto: true,
    magSize: 30, reserveStart: 90, reserveMax: 240,
    reloadTime: 1.6, range: 120, sound: 'rifle',
    tracerColor: 0xfff2a8,
  },
};

/** Damage multiplier when a shot lands on an enemy's glowing core. */
export const CORE_HIT_MULTIPLIER = 2.0;
