# Lost Treasure Hunter

A third-person adventure shooter built with **Three.js + cannon-es + Howler + Vite**.
A treasure hunter crosses three fully playable biomes — forest, desert, and
coast — hunting a legendary treasure guarded by glowing-core mechs (Horizon
Zero Dawn-inspired art direction: warm gold player, cool biomes, hot red enemy
tech). The coast level adds dock platforming over an animated water shader,
with reward pickups at the end of the jump line.

All art is procedural placeholder geometry; the code is structured so real glTF
models can be dropped in later.

## Run it

```bash
cd game
npm install
npm run dev        # → http://localhost:5173
npm run build      # production build in dist/
```

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Look (click the screen once to lock the pointer) |
| Left click | Fire |
| Right click (hold) | Aim mode — tighter camera, narrower FOV, less spread |
| Shift | Sprint (drains stamina) |
| Space | Jump |
| Ctrl | Dodge-roll (i-frames, costs stamina) |
| R | Reload |
| 1 / 2 / 3 | Switch weapon |
| Esc | Pause |

## Gameplay loop

Each level: clear three sequential enemy waves → the level boss (a multi-phase
mech guardian) awakens → destroy it (shoot the glowing cores for **2× damage**;
the boss retracts cores and speeds up each phase) → grab the dropped treasure
fragment → exit through the portal that unlocks. Collect all three fragments to
reveal the legendary treasure. Progress (level, health, weapons, ammo,
fragments) auto-saves to localStorage at each level transition.

## Project structure

```
src/
  main.js                 entry — boots GameManager
  config/
    theme.config.js       ALL look & feel: color triad, materials, fog, bloom, per-biome atmosphere
    weapons.config.js     weapon stats (damage, spread, fire rate, mags…)
    enemies.config.js     enemy + boss stats, AI ranges, primitive body descriptors
    levels.config.js      level layouts: scatter props, waves, pickups, boss, portal, objectives
  core/
    GameManager.js        state machine (MENU→PLAYING⇄PAUSED→GAMEOVER/COMPLETE/VICTORY) + wiring
    InputManager.js       pointer-lock mouse + keyboard, action mapping
    PhysicsWorld.js       cannon-es wrapper (player body, static level geometry)
    ObjectPool.js         generic pool (tracers, enemies, bosses)
    AudioManager.js       Howler + runtime-synthesized WAV SFX (no audio assets needed)
    SaveManager.js        localStorage save/load
  entities/
    Player.js             controller, third-person camera, stamina, dodge, placeholder rig
    Enemy.js              patrol→detect→chase→attack AI, primitive mech bodies, weak-point cores
    Boss.js               multi-phase boss (extends Enemy), phase-gated cores
    Pickup.js             health/ammo/weapon/fragment collectibles
  weapons/Weapon.js       Weapon state + Arsenal: hitscan rays, tracer pool, muzzle flash
  levels/
    Level.js              data-driven level orchestration (waves, boss, portal, objectives)
    biomes.js             procedural scatter builders (trees, ruins, water shader, docks…)
  ui/
    HUD.js                bars, ammo, fragments, crosshair, hit markers, damage numbers, boss bar
    Menus.js              main/pause/complete/gameover/victory screens
  fx/PostFX.js            bloom + desert heat-shimmer pass
```

## Extension guide

### Add a level (e.g. swamp)
1. `theme.config.js` → add a `swamp` entry under `biomes` (sky/fog/sun/ground colors).
2. `levels.config.js` → append a level object (copy an existing one; set `biome:
   'swamp'`, waves, pickups, boss, exit). That's it — menus, saves, difficulty
   scaling, and the fragment counter all follow the `LEVELS` array.
3. Optional: new prop types → add a builder in `levels/biomes.js` under
   `SCATTER_BUILDERS` and reference its `kind` from the level's `scatter` list.
   Levels can also declare `exclusions: [{p: [x, z], r}]` to keep scattered
   props out of gameplay corridors, and pickups accept an optional `y` for
   placement on platforms.

### Add an enemy
1. `enemies.config.js` → add an entry (stats + `body: {form: 'quad'|'biped',
   scale, tint}`). Reference its key from any level's `waves`.
2. New silhouette? Add a `form` branch in `Enemy.buildMesh()`. Mark weak-point
   meshes with `userData.isCore = true`.

### Add a weapon
1. `weapons.config.js` → add an entry with stats.
2. Optional: a silhouette branch in `Weapon.buildMesh()`.
3. Place it in a level via a `{kind: 'weapon', weapon: '<id>', pos: [x, z]}` pickup.

### Swap in real art
- Player/enemies: replace `buildMesh()` bodies with loaded glTF scenes (add a
  `model` field to configs); keep `userData.enemyRef` / `userData.isCore` tags
  on hit meshes and the controllers work unchanged.
- Audio: replace the synthesized entries in `AudioManager`'s `SOUND_DEFS` with
  file URLs passed to Howler.
- The whole visual identity (colors, bloom, fog, materials) tunes from
  `theme.config.js`.

## Performance notes

- Bullets/tracers, enemies, and bosses are object-pooled.
- Enemies steer kinematically (no per-enemy physics bodies); only the player is
  a dynamic body.
- `dt` is clamped so slow machines slow down rather than break simulation.
