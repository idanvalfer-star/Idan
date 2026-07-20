/**
 * Weapon + Arsenal — config-driven hitscan shooting.
 *
 * Arsenal owns the player's weapon slots, fires rays from the camera
 * (crosshair-accurate), applies core-hit bonus damage, and drives pooled
 * tracer beams + a reusable muzzle flash light.
 *
 * Enemies are hit via their `hitMeshes` (userData.enemyRef set, and
 * userData.isCore=true on the glowing weak points).
 */
import * as THREE from 'three';
import { WEAPONS, CORE_HIT_MULTIPLIER } from '../config/weapons.config.js';
import { ObjectPool } from '../core/ObjectPool.js';

// ---- pooled tracer beam ----------------------------------------------------
class Tracer {
  constructor(scene) {
    this.scene = scene;
    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 1, 4, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.9 })
    );
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.life = 0;
  }
  reset(from, to, color) {
    this.mesh.material.color.setHex(color);
    const dir = to.clone().sub(from);
    const len = dir.length();
    this.mesh.scale.set(1, len, 1);
    this.mesh.position.copy(from).addScaledVector(dir, 0.5);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.mesh.visible = true;
    this.life = 0.07;
  }
  update(dt) {
    this.life -= dt;
    this.mesh.material.opacity = Math.max(0, this.life / 0.07) * 0.9;
    return this.life > 0;
  }
  onRelease() { this.mesh.visible = false; }
}

// ---- a single weapon's state ----------------------------------------------
export class Weapon {
  constructor(id) {
    this.cfg = WEAPONS[id];
    if (!this.cfg) throw new Error(`Unknown weapon: ${id}`);
    this.id = id;
    this.mag = this.cfg.magSize;
    this.reserve = this.cfg.reserveStart;
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.mesh = Weapon.buildMesh(id);
  }

  get reloading() { return this.reloadTimer > 0; }

  startReload() {
    if (this.reloading || this.mag >= this.cfg.magSize || this.reserve <= 0) return false;
    this.reloadTimer = this.cfg.reloadTime;
    return true;
  }

  finishReload() {
    const need = this.cfg.magSize - this.mag;
    const take = Math.min(need, this.reserve);
    this.mag += take;
    this.reserve -= take;
  }

  addAmmo(rounds) {
    this.reserve = Math.min(this.cfg.reserveMax, this.reserve + rounds);
  }

  /** Placeholder weapon meshes from primitives — one silhouette per class. */
  static buildMesh(id) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.8, roughness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    const g = new THREE.Group();
    if (id === 'pistol') {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.3), metal);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), wood);
      grip.position.set(0, -0.09, 0.1);
      grip.rotation.x = 0.3;
      g.add(barrel, grip);
    } else if (id === 'shotgun') {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), metal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.15;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.3), wood);
      stock.position.set(0, -0.03, 0.25);
      g.add(barrel, stock);
    } else { // rifle
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), metal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.35), metal);
      body.position.z = 0.12;
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), metal);
      mag.position.set(0, -0.1, 0.12);
      g.add(barrel, body, mag);
    }
    g.traverse((o) => { o.castShadow = true; });
    return g;
  }
}

// ---- the player's arsenal + firing logic ----------------------------------
export class Arsenal {
  /**
   * @param {object} o {scene, camera, player, audio, hud}
   * getTargets() → {hitMeshes: Object3D[], blockers: Object3D[]} supplied by Level
   */
  constructor({ scene, camera, player, audio, hud }) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.audio = audio;
    this.hud = hud;
    this.weapons = [new Weapon('pistol')];
    this.index = 0;
    this.getTargets = () => ({ hitMeshes: [], blockers: [] });
    this.onEnemyHit = null; // (enemy, damage, isCore, point)

    this.tracerPool = new ObjectPool(() => new Tracer(scene), 24);
    this.ray = new THREE.Raycaster();

    // one reusable muzzle flash light
    this.flash = new THREE.PointLight(0xffc94d, 0, 6);
    scene.add(this.flash);
    this.flashTimer = 0;

    this.attachCurrent();
  }

  get current() { return this.weapons[this.index]; }

  hasWeapon(id) { return this.weapons.some((w) => w.id === id); }

  addWeapon(id) {
    if (this.hasWeapon(id)) {
      this.weapons.find((w) => w.id === id).addAmmo(WEAPONS[id].magSize * 2);
      return false;
    }
    this.weapons.push(new Weapon(id));
    this.switchTo(this.weapons.length - 1);
    return true;
  }

  switchTo(i) {
    if (i < 0 || i >= this.weapons.length || i === this.index) return;
    this.current.reloadTimer = 0; // cancel reload on switch
    this.index = i;
    this.attachCurrent();
    this.hud?.refreshAmmo(this.current);
  }

  attachCurrent() {
    const anchor = this.player.weaponAnchor;
    anchor.clear();
    anchor.add(this.current.mesh);
  }

  update(dt, input) {
    const w = this.current;
    if (w.cooldown > 0) w.cooldown -= dt;
    if (w.reloadTimer > 0) {
      w.reloadTimer -= dt;
      if (w.reloadTimer <= 0) {
        w.finishReload();
        this.hud?.refreshAmmo(w);
      }
    }

    const slot = input.weaponSlot();
    if (slot >= 0) this.switchTo(slot);
    if (input.reload && w.startReload()) this.audio.play('reload');

    const wantFire = w.cfg.auto ? input.fire : input.fireJust;
    if (wantFire && !this.player.dead) this.tryFire();

    // tracers + flash decay
    this.tracerPool.forEachActive((t) => { if (!t.update(dt)) this.tracerPool.release(t); });
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flash.intensity = Math.max(0, this.flashTimer / 0.06) * 20;
    }
  }

  tryFire() {
    const w = this.current;
    if (w.cooldown > 0 || w.reloading) return;
    if (w.mag <= 0) {
      if (!w.startReload()) this.audio.play('click');
      else this.audio.play('reload');
      return;
    }
    w.cooldown = 1 / w.cfg.fireRate;
    w.mag--;
    this.audio.play(w.cfg.sound);
    this.hud?.refreshAmmo(w);

    const { hitMeshes, blockers } = this.getTargets();
    const spread = w.cfg.spread * (this.player.aiming ? 0.45 : 1);

    // muzzle world position for tracer origin
    const muzzle = new THREE.Vector3();
    w.mesh.getWorldPosition(muzzle);
    this.flash.position.copy(muzzle);
    this.flashTimer = 0.06;

    for (let p = 0; p < w.cfg.pellets; p++) {
      // ray through crosshair with per-pellet spread
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      if (spread > 0) {
        dir.x += (Math.random() - 0.5) * 2 * spread;
        dir.y += (Math.random() - 0.5) * 2 * spread;
        dir.z += (Math.random() - 0.5) * 2 * spread;
        dir.normalize();
      }
      this.ray.set(this.camera.position, dir);
      this.ray.far = w.cfg.range;

      const hits = this.ray.intersectObjects([...hitMeshes, ...blockers], true);
      let end = this.camera.position.clone().addScaledVector(dir, w.cfg.range);
      // first hit that isn't the player's own mesh
      const hit = hits.find((h) => !this.isOwn(h.object));
      if (hit) {
        end = hit.point;
        const enemy = this.findEnemyRef(hit.object);
        if (enemy && !enemy.dead) {
          const isCore = !!hit.object.userData.isCore;
          const dmg = Math.round(w.cfg.damage * (isCore ? CORE_HIT_MULTIPLIER : 1));
          this.onEnemyHit?.(enemy, dmg, isCore, hit.point);
        }
      }
      this.tracerPool.acquire(muzzle, end, w.cfg.tracerColor);
    }
  }

  isOwn(obj) {
    let o = obj;
    while (o) {
      if (o === this.player.mesh) return true;
      o = o.parent;
    }
    return false;
  }

  findEnemyRef(obj) {
    let o = obj;
    while (o) {
      if (o.userData?.enemyRef) return o.userData.enemyRef;
      o = o.parent;
    }
    return null;
  }

  /** For SaveManager. */
  serialize() {
    return {
      weapons: this.weapons.map((w) => ({ id: w.id, mag: w.mag, reserve: w.reserve })),
      current: this.index,
    };
  }

  restore(data) {
    if (!data?.weapons?.length) return;
    this.weapons = data.weapons.map((s) => {
      const w = new Weapon(s.id);
      w.mag = s.mag;
      w.reserve = s.reserve;
      return w;
    });
    this.index = Math.min(data.current ?? 0, this.weapons.length - 1);
    this.attachCurrent();
  }
}
