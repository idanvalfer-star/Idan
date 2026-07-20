/**
 * GameManager — top-level state machine and system wiring.
 *
 *   MENU → PLAYING ⇄ PAUSED
 *            ↓ player dies        → GAMEOVER  → retry / menu
 *            ↓ portal entered     → COMPLETE  → next level / menu
 *            ↓ last level cleared → VICTORY
 *
 * Owns every subsystem; per-frame flow is:
 *   physics.step → player.update → arsenal.update → level.update →
 *   hud.update → postfx.render → input.endFrame
 */
import * as THREE from 'three';
import { PhysicsWorld } from './PhysicsWorld.js';
import { InputManager } from './InputManager.js';
import { AudioManager } from './AudioManager.js';
import { SaveManager } from './SaveManager.js';
import { ObjectPool } from './ObjectPool.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { Boss } from '../entities/Boss.js';
import { Arsenal } from '../weapons/Weapon.js';
import { Level } from '../levels/Level.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { PostFX } from '../fx/PostFX.js';
import { Particles } from '../fx/Particles.js';
import { LEVELS } from '../config/levels.config.js';
import { BIOMES, RENDER } from '../config/theme.config.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const STATE = {
  MENU: 'MENU', PLAYING: 'PLAYING', PAUSED: 'PAUSED',
  GAMEOVER: 'GAMEOVER', COMPLETE: 'COMPLETE', VICTORY: 'VICTORY',
};

export class GameManager {
  constructor(appEl, uiEl) {
    this.state = STATE.MENU;
    this.levelIndex = 0;
    this.level = null;

    // ---- renderer ----
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    appEl.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);

    // image-based lighting so PBR materials get real reflections/ambient
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = RENDER.envIntensity;
    pmrem.dispose();

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    // ---- systems ----
    this.physics = new PhysicsWorld();
    this.input = new InputManager(this.renderer.domElement);
    this.audio = new AudioManager();
    this.save = new SaveManager();

    this.player = new Player({
      scene: this.scene, physics: this.physics, input: this.input,
      camera: this.camera, audio: this.audio,
    });
    this.hud = new HUD(uiEl, this.camera);
    this.player.hurtCallback = () => this.hud.flashPain();
    this.particles = new Particles(this.scene);
    this.player.particles = this.particles;

    this.arsenal = new Arsenal({
      scene: this.scene, camera: this.camera, player: this.player,
      audio: this.audio, hud: this.hud,
    });
    this.arsenal.onEnemyHit = (enemy, dmg, isCore, point) => {
      enemy.takeDamage(dmg, isCore);
      this.hud.showHit(dmg, isCore, point);
      this.audio.play(isCore ? 'coreHit' : 'hit', 0.7);
    };

    // shared pools — enemies & bosses are recycled across waves and levels
    this.pools = {
      enemy: new ObjectPool(() => new Enemy(this.scene), 8),
      boss: new ObjectPool(() => new Boss(this.scene), 1),
    };

    this.menus = new Menus(uiEl, {
      newGame: () => this.newGame(),
      continueGame: () => this.continueGame(),
      resume: () => this.resume(),
      restart: () => this.restartLevel(),
      retry: () => this.restartLevel(),
      nextLevel: () => this.nextLevel(),
      quitToMenu: () => this.toMenu(),
    });

    // losing pointer lock mid-game (e.g. Esc) pauses
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.state === STATE.PLAYING) this.pause();
    };

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postfx.setSize(window.innerWidth, window.innerHeight);
    });

    this.clock = new THREE.Clock();
    this.toMenu();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---- state transitions ---------------------------------------------------

  setState(s) { this.state = s; }

  toMenu() {
    this.disposeLevel();
    this.setState(STATE.MENU);
    this.hud.hide();
    this.hud.hideBoss();
    this.menus.showMain(this.save.hasSave());
    this.input.enabled = false;
    this.input.exitPointerLock();
    // idle backdrop
    this.scene.background = new THREE.Color(BIOMES.forest.sky);
    this.scene.fog = null;
    this.postfx.setBiome(null);
    this.camera.position.set(0, 3, 8);
    this.camera.lookAt(0, 1, 0);
  }

  newGame() {
    this.save.clear();
    this.levelIndex = 0;
    this.player.health = this.player.maxHealth;
    this.player.fragments = 0;
    this.player.score = 0;
    this.arsenal.restore({ weapons: [{ id: 'pistol', mag: 12, reserve: 60 }], current: 0 });
    this.startLevel(0);
  }

  continueGame() {
    const data = this.save.load();
    if (!data) return this.newGame();
    this.levelIndex = Math.min(data.levelIndex ?? 0, LEVELS.length - 1);
    this.player.health = data.health ?? this.player.maxHealth;
    this.player.fragments = data.fragments ?? 0;
    this.player.score = data.score ?? 0;
    this.arsenal.restore(data.arsenal);
    this.startLevel(this.levelIndex);
  }

  startLevel(index) {
    this.disposeLevel();
    this.levelIndex = index;
    const cfg = LEVELS[index];
    this.level = new Level({
      config: cfg,
      scene: this.scene, physics: this.physics, audio: this.audio,
      pools: this.pools, player: this.player,
      effects: {
        enemyTracer: (from, to) => this.arsenal.tracerPool.acquire(from, to, 0xff5533),
      },
      events: {
        onObjective: (i, text) => this.hud.setObjective(text),
        onWaveStart: (n, total) => this.hud.showWaveBanner(`WAVE ${n} / ${total}`),
        onBossSpawn: (boss) => { this.hud.showBoss(boss); this.hud.showWaveBanner('GUARDIAN AWAKENS'); },
        onBossPhase: (boss, phase) => this.hud.setBossPhase(phase),
        onFragment: () => {
          this.hud.setFragments(this.player.fragments);
          this.hud.toast('Treasure fragment claimed!');
        },
        onPortalOpen: () => this.hud.toast('The exit portal hums to life…'),
        onComplete: () => this.completeLevel(),
        onKill: (enemy) => { this.player.score += enemy.cfg.score ?? 10; },
        onAmmoPickup: () => {
          const w = this.arsenal.current;
          w.addAmmo(w.cfg.magSize * 2);
          this.hud.refreshAmmo(w);
          this.hud.toast('Ammo restocked');
        },
        onWeaponPickup: (id) => {
          const isNew = this.arsenal.addWeapon(id);
          this.hud.refreshAmmo(this.arsenal.current);
          this.hud.toast(isNew ? `${this.arsenal.current.cfg.name} acquired! (press ${this.arsenal.weapons.length})` : 'Ammo salvaged from duplicate weapon');
        },
      },
    });
    this.level.build();
    this.hud.setFragments(this.player.fragments);
    this.hud.refreshAmmo(this.arsenal.current);
    this.hud.show();
    this.menus.hideAll();
    this.postfx.setBiome(BIOMES[cfg.biome]);
    this.postfx.setShimmer(!!this.level.flags.shimmer);
    this.player.surface = BIOMES[cfg.biome].footstep;
    this.setState(STATE.PLAYING);
    this.input.enabled = true;
    this.input.requestPointerLock();
  }

  restartLevel() {
    this.player.health = this.player.maxHealth;
    this.player.dead = false;
    this.startLevel(this.levelIndex);
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.setState(STATE.PAUSED);
    this.input.enabled = false;
    this.menus.showPause(LEVELS[this.levelIndex].name);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.setState(STATE.PLAYING);
    this.menus.hideAll();
    this.input.enabled = true;
    this.input.requestPointerLock();
  }

  completeLevel() {
    this.setState(STATE.COMPLETE);
    this.input.enabled = false;
    this.input.exitPointerLock();
    const isLast = this.levelIndex >= LEVELS.length - 1;
    // persist progress pointing at the NEXT level
    if (!isLast) {
      this.save.save({
        levelIndex: this.levelIndex + 1,
        health: this.player.health,
        fragments: this.player.fragments,
        score: this.player.score,
        arsenal: this.arsenal.serialize(),
      });
    }
    this.menus.showComplete({
      levelName: LEVELS[this.levelIndex].name,
      fragments: this.player.fragments,
      score: this.player.score,
      isLast,
    });
  }

  nextLevel() {
    if (this.levelIndex >= LEVELS.length - 1) {
      // all fragments collected → the treasure is revealed
      this.save.clear();
      this.setState(STATE.VICTORY);
      this.menus.showVictory({ score: this.player.score });
      return;
    }
    this.startLevel(this.levelIndex + 1);
  }

  gameOver() {
    this.setState(STATE.GAMEOVER);
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.hud.hideBoss();
    this.menus.showGameOver();
  }

  disposeLevel() {
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
  }

  // ---- main loop -----------------------------------------------------------

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === STATE.PLAYING && this.level) {
      // Esc pauses directly; leaving pointer lock (browser Esc) also pauses
      // via onPointerLockChange — whichever fires first wins.
      if (this.input.pause) {
        this.pause();
        this.input.endFrame();
        this.postfx.render(dt);
        return;
      }
      this.physics.step(dt);
      this.player.update(dt, this.level.groundMeshes);
      this.arsenal.getTargets = () => this.level.getTargets();
      this.arsenal.update(dt, this.input);
      this.level.update(dt);
      this.particles.update(dt);
      this.hud.update(dt, this.player, this.arsenal);
      this.hud.updateBoss();
      this.audio.updateListener(this.camera);
      if (this.player.dead) this.gameOver();
    } else if (this.state === STATE.MENU) {
      // slow menu orbit
      const t = performance.now() * 0.0002;
      this.camera.position.set(Math.sin(t) * 8, 3, Math.cos(t) * 8);
      this.camera.lookAt(0, 1, 0);
    }

    this.postfx.render(dt);
    this.input.endFrame();
  }
}
