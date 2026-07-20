/**
 * Level — one biome, fully driven by its entry in levels.config.js.
 *
 * Lifecycle: build() → update(dt) each frame → dispose().
 * Progression inside a level:
 *   waves (sequential) → boss → fragment drop → exit portal unlocks →
 *   player steps into portal → onComplete().
 *
 * The Level owns terrain, scatter props, pickups, the exit portal, and
 * orchestrates enemy spawns out of shared pools (GameManager owns pools).
 */
import * as THREE from 'three';
import { THEME } from '../config/theme.config.js';
import { SCATTER_BUILDERS } from './biomes.js';
import { Pickup } from '../entities/Pickup.js';

export class Level {
  /**
   * @param {object} o
   *  config   : one entry of LEVELS
   *  scene, physics, audio
   *  pools    : {enemy, boss} ObjectPools
   *  player   : Player
   *  effects  : {enemyTracer(from,to)}
   *  events   : {onObjective(i,text), onWaveStart(n,total), onBossSpawn(boss),
   *              onBossPhase(boss,phase), onFragment(), onPortalOpen(),
   *              onComplete(), onKill(enemy)}
   */
  constructor(o) {
    Object.assign(this, o);
    this.cfg = o.config;
    this.enemies = [];       // active enemies (from pool)
    this.pickups = [];
    this.blockers = [];      // LOS + bullet blockers
    this.groundMeshes = [];  // for player jump ray (platforms)
    this.updatables = [];    // animated props (water, portal)
    this.flags = {};         // set by scatter builders (e.g. shimmer)
    this.meshes = [];        // everything to remove on dispose
    this.waveIndex = -1;
    this.phase = 'waves';    // waves → boss → fragment → exit → done
    this.boss = null;
    this.portal = null;
    this.portalOpen = false;
    this.objectiveIndex = 0;
  }

  build() {
    const { scene, physics, cfg } = this;
    const biome = THEME.biomes[cfg.biome];
    scene.background = new THREE.Color(biome.sky);
    scene.fog = new THREE.Fog(biome.fogColor, biome.fogNear, biome.fogFar);

    // ---- lights ----
    this.sun = new THREE.DirectionalLight(biome.sunColor, biome.sunIntensity);
    this.sun.position.set(...biome.sunPos);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = cfg.size * 0.6;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, far: 250 });
    this.hemi = new THREE.HemisphereLight(biome.hemiSky, biome.hemiGround, biome.hemiIntensity);
    scene.add(this.sun, this.hemi);
    this.meshes.push(this.sun, this.hemi);

    // ---- ground + arena walls ----
    physics.addGroundPlane();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.size * 2.5, cfg.size * 2.5),
      new THREE.MeshStandardMaterial({ color: biome.groundColor, ...THEME.materials.ground })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    this.meshes.push(ground);
    this.blockers.push(ground); // bullets hit the floor
    const half = cfg.size / 2;
    for (const [x, z, w, d] of [
      [0, -half, cfg.size, 1], [0, half, cfg.size, 1],
      [-half, 0, 1, cfg.size], [half, 0, 1, cfg.size],
    ]) {
      physics.addStaticBox([x, 2.5, z], [w, 5, d]); // invisible bounds
    }

    // ---- scatter props (exclude spawn/boss/exit + pickup spots) ----
    const keep = [
      { p: cfg.playerSpawn, r: 6 }, { p: cfg.boss.pos, r: 10 }, { p: cfg.exit, r: 6 },
      ...cfg.pickups.map((pk) => ({ p: pk.pos, r: 3 })),
      ...cfg.waves.map((w) => ({ p: [w.area[0], w.area[1]], r: 4 })),
      ...(cfg.exclusions ?? []), // extra keep-clear zones (e.g. the dock corridor)
    ];
    const ctx = {
      scene, physics, size: cfg.size,
      blockers: this.blockers, updatables: this.updatables,
      groundMeshes: this.groundMeshes, flags: this.flags,
      exclude: (x, z, extra = 0) =>
        keep.some((k) => (x - k.p[0]) ** 2 + (z - k.p[1]) ** 2 < (k.r + extra) ** 2),
    };
    // track scene children added by builders so dispose can remove them
    const before = new Set(scene.children);
    for (const sc of cfg.scatter) SCATTER_BUILDERS[sc.kind]?.(ctx, sc);
    for (const child of scene.children) if (!before.has(child)) this.meshes.push(child);

    // ---- pickups ----
    for (const pk of cfg.pickups) {
      this.pickups.push(new Pickup(scene, pk.kind, { x: pk.pos[0], z: pk.pos[1] }, { weapon: pk.weapon, y: pk.y }));
    }

    // ---- exit portal (locked until boss dies) ----
    this.portal = this.buildPortal(cfg.exit);

    // ---- kick off ----
    this.player.setSpawn(cfg.playerSpawn[0], cfg.playerSpawn[1]);
    this.events.onObjective?.(0, this.cfg.objectives[0]);
    this.nextWave();
  }

  buildPortal([x, z]) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x333333, emissive: 0x222222, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.4,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.25, 10, 32), ringMat);
    ring.position.y = 2.4;
    g.add(ring);
    const diskMat = new THREE.MeshBasicMaterial({
      color: THEME.colors.treasure, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24), diskMat);
    disk.position.y = 2.4;
    g.add(disk);
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.8, 0.5), ringMat);
      pillar.position.set(sx * 2.4, 2.4, 0);
      g.add(pillar);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.meshes.push(g);
    this._portalRing = ringMat;
    this._portalDisk = diskMat;
    this.updatables.push((dt) => {
      if (this.portalOpen) {
        g.rotation.y += dt * 0.4;
        this._portalDisk.opacity = Math.min(0.75, this._portalDisk.opacity + dt * 0.5);
      }
    });
    return g;
  }

  openPortal() {
    this.portalOpen = true;
    this._portalRing.emissive.setHex(THEME.colors.treasure);
    this._portalRing.emissiveIntensity = 1.6;
    this.audio.play('portal');
    this.events.onPortalOpen?.();
  }

  // ---- combat orchestration ------------------------------------------------

  get aliveEnemies() { return this.enemies.filter((e) => !e.dead); }

  nextWave() {
    this.waveIndex++;
    if (this.waveIndex >= this.cfg.waves.length) {
      this.spawnBoss();
      return;
    }
    const wave = this.cfg.waves[this.waveIndex];
    const [ax, az, ar] = wave.area;
    for (const spec of wave.enemies) {
      for (let i = 0; i < spec.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * ar;
        const pos = { x: ax + Math.cos(a) * r, z: az + Math.sin(a) * r };
        const enemy = this.pools.enemy.acquire(spec.type, pos, this.cfg.difficulty, this.enemyCtx());
        this.enemies.push(enemy);
      }
    }
    this.events.onWaveStart?.(this.waveIndex + 1, this.cfg.waves.length);
  }

  spawnBoss() {
    this.phase = 'boss';
    const [x, z] = this.cfg.boss.pos;
    this.boss = this.pools.boss.acquire(this.cfg.boss.type, { x, z }, this.cfg.difficulty, this.enemyCtx(true));
    this.enemies.push(this.boss);
    this.setObjective(1);
    this.events.onBossSpawn?.(this.boss);
  }

  enemyCtx(isBoss = false) {
    return {
      player: this.player,
      audio: this.audio,
      effects: this.effects,
      blockers: () => this.blockers,
      onBossPhase: (b, p) => this.events.onBossPhase?.(b, p),
      onDeath: (e) => this.onEnemyDeath(e, isBoss),
    };
  }

  onEnemyDeath(enemy, isBoss) {
    this.events.onKill?.(enemy);
    if (isBoss) {
      // fragment drops where the guardian fell
      const p = enemy.mesh.position;
      this.fragmentPickup = new Pickup(this.scene, 'fragment', { x: p.x, z: p.z });
      this.pickups.push(this.fragmentPickup);
      this.phase = 'fragment';
      this.setObjective(2);
      this.openPortal();
    } else if (Math.random() < 0.3) {
      // mooks sometimes drop supplies
      const kind = Math.random() < 0.5 ? 'health' : 'ammo';
      this.pickups.push(new Pickup(this.scene, kind, { x: enemy.mesh.position.x, z: enemy.mesh.position.z }));
    }
  }

  setObjective(i) {
    if (i <= this.objectiveIndex && i !== 0) return;
    this.objectiveIndex = i;
    this.events.onObjective?.(i, this.cfg.objectives[i]);
  }

  /** Supplies the Arsenal's raycast targets. */
  getTargets() {
    return {
      hitMeshes: this.aliveEnemies.map((e) => e.mesh),
      blockers: this.blockers,
    };
  }

  update(dt) {
    for (const fn of this.updatables) fn(dt);

    // enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.update(dt)) {
        this.enemies.splice(i, 1);
        (e === this.boss ? this.pools.boss : this.pools.enemy).release(e);
      }
    }
    // cheap pairwise separation so mobs don't stack
    const alive = this.aliveEnemies;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i].mesh.position, b = alive[j].mesh.position;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < 2.25) {
          const d = Math.sqrt(d2);
          const push = (1.5 - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
        }
      }
    }

    // wave progression
    if (this.phase === 'waves' && this.waveIndex >= 0 && alive.length === 0) this.nextWave();

    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (!pk.update(dt, this.player.position)) {
        this.pickups.splice(i, 1);
        if (pk.collected) this.onPickup(pk);
        pk.dispose();
      }
    }

    // exit portal
    if (this.portalOpen && this.phase === 'exit') {
      const p = this.portal.position;
      const d = this.player.position.distanceTo(p);
      if (d < 2.3) {
        this.phase = 'done';
        this.events.onComplete?.();
      }
    }
  }

  onPickup(pk) {
    switch (pk.kind) {
      case 'health':
        this.player.heal(35);
        this.audio.play('pickup');
        break;
      case 'ammo':
        this.events.onAmmoPickup?.();
        this.audio.play('pickup');
        break;
      case 'weapon':
        this.events.onWeaponPickup?.(pk.opts.weapon);
        this.audio.play('pickup');
        break;
      case 'fragment':
        this.player.fragments++;
        this.audio.play('fragment');
        this.phase = 'exit';
        this.setObjective(3);
        this.events.onFragment?.();
        break;
    }
  }

  dispose() {
    for (const e of this.enemies) (e === this.boss ? this.pools.boss : this.pools.enemy).release(e);
    this.enemies.length = 0;
    for (const pk of this.pickups) pk.dispose();
    this.pickups.length = 0;
    for (const m of this.meshes) this.scene.remove(m);
    this.meshes.length = 0;
    this.blockers.length = 0;
    this.groundMeshes.length = 0;
    this.updatables.length = 0;
    this.physics.clearStatics();
  }
}
