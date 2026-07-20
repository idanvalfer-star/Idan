/**
 * Enemy — glowing-core mech, fully config-driven (enemies.config.js).
 *
 * AI state machine:  patrol → detect (LOS within detectRange, or anything
 * within proximity) → chase → attack → (dead).
 *
 * Meshes are assembled from primitives per the art direction: dark metal
 * body (high metalness) + emissive red-orange cores/eyes. Core meshes carry
 * userData.isCore so hitscan applies bonus damage — the art style IS the
 * weak-point mechanic. Enemies are pooled: reset() re-initializes.
 */
import * as THREE from 'three';
import { ENEMIES } from '../config/enemies.config.js';
import { THEME } from '../config/theme.config.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export class Enemy {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;       // rebuilt per type on reset
    this.meshType = null;
    this.dead = true;
    this.hitMeshes = [];
  }

  /** (Re)initialize from pool. */
  reset(type, pos, difficulty = 1, ctx = {}) {
    this.type = type;
    this.cfg = ENEMIES[type];
    this.ctx = ctx; // {player, audio, effects, blockers()}
    this.difficulty = difficulty;
    this.maxHp = Math.round(this.cfg.hp * difficulty);
    this.hp = this.maxHp;
    this.dead = false;
    this.dying = 0;
    this.state = 'patrol';
    this.attackTimer = 1 + Math.random();
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.lungeTimer = 0;
    this.flashTimer = 0;
    this.home = new THREE.Vector3(pos.x, 0, pos.z);
    this.patrolTarget = this.pickPatrolPoint();

    if (this.meshType !== type) {
      if (this.mesh) this.scene.remove(this.mesh);
      this.mesh = this.buildMesh(this.cfg.body);
      this.meshType = type;
      this.scene.add(this.mesh);
    }
    this.mesh.visible = true;
    this.mesh.scale.setScalar(this.cfg.body.scale);
    this.mesh.position.set(pos.x, 0, pos.z);
    this.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.setCoreIntensity(THEME.materials.enemyCore.emissiveIntensity);
  }

  buildMesh(body) {
    const g = new THREE.Group();
    g.userData.enemyRef = this;
    const metal = new THREE.MeshStandardMaterial({
      color: THEME.colors.enemyMetal, ...THEME.materials.enemyBody,
    });
    // biome tint layer — moss/sand/barnacle wear over the same tech language
    const tint = new THREE.MeshStandardMaterial({ color: body.tint, roughness: 0.9, metalness: 0.2 });
    const coreMat = () => new THREE.MeshStandardMaterial({
      color: 0x220a05, emissive: THEME.colors.enemyCore,
      emissiveIntensity: THEME.materials.enemyCore.emissiveIntensity,
      metalness: THEME.materials.enemyCore.metalness, roughness: THEME.materials.enemyCore.roughness,
    });
    this.coreMats = [];
    this.bodyMats = [metal, tint];
    this.cores = [];
    const addCore = (r, x, y, z) => {
      const m = coreMat();
      this.coreMats.push(m);
      const core = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
      core.position.set(x, y, z);
      core.userData.isCore = true;
      core.userData.enemyRef = this;
      g.add(core);
      this.cores.push(core);
      return core;
    };
    const box = (w, h, d, x, y, z, mat = metal) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.enemyRef = this;
      g.add(m);
      return m;
    };

    if (body.form === 'quad') {
      // wolf-like: low horizontal body, 4 legs, head with eyes, core on back
      box(0.9, 0.5, 1.4, 0, 0.65, 0);                 // body
      box(0.7, 0.12, 1.1, 0, 0.95, 0, tint);          // wear plating
      box(0.45, 0.4, 0.5, 0, 0.75, 0.9); // head
      for (const s of [-1, 1]) { // glowing eyes (not weak points — the back core is)
        const eyeMat = new THREE.MeshStandardMaterial({
          color: 0x220a05, emissive: THEME.colors.enemyCore, emissiveIntensity: 2,
        });
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), eyeMat);
        eye.position.set(s * 0.12, 0.8, 1.16);
        eye.userData.enemyRef = this;
        g.add(eye);
        this.coreMats.push(eyeMat);
      }
      for (const [x, z] of [[-0.35, 0.5], [0.35, 0.5], [-0.35, -0.5], [0.35, -0.5]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.65, 6), metal);
        leg.position.set(x, 0.32, z);
        leg.castShadow = true;
        leg.userData.enemyRef = this;
        g.add(leg);
      }
      addCore(0.16, 0, 1.05, -0.2); // exposed power core on the back
    } else if (body.form === 'biped') {
      // humanoid ranged mech: chest core, eye visor
      box(0.8, 1.0, 0.5, 0, 1.35, 0);                 // torso
      box(0.85, 0.25, 0.55, 0, 1.85, 0, tint);        // shoulder wear
      box(0.5, 0.35, 0.45, 0, 2.15, 0);               // head
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.08, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x220a05, emissive: THEME.colors.enemyCore, emissiveIntensity: 2 })
      );
      visor.position.set(0, 2.18, 0.24);
      visor.userData.enemyRef = this;
      g.add(visor);
      this.coreMats.push(visor.material);
      for (const s of [-1, 1]) {
        box(0.22, 0.9, 0.3, s * 0.28, 0.45, 0);       // legs
        box(0.18, 0.7, 0.25, s * 0.55, 1.3, 0);       // arms
      }
      // gun barrel on right arm
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), metal);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(0.55, 1.25, 0.45);
      gun.userData.enemyRef = this;
      g.add(gun);
      this.muzzle = new THREE.Object3D();
      this.muzzle.position.set(0.55, 1.25, 0.8);
      g.add(this.muzzle);
      addCore(0.18, 0, 1.35, 0.3);                    // chest core weak point
    } else {
      this.buildBossBody(g, box, addCore, metal, tint);
    }
    this.hitMeshes = [g];
    return g;
  }

  /** Overridden by Boss for the big multi-core frame. */
  buildBossBody(g, box, addCore, metal, tint) {
    box(1.2, 1.4, 0.9, 0, 1.6, 0);
    addCore(0.2, 0, 1.6, 0.5);
  }

  pickPatrolPoint() {
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 8;
    return new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
  }

  hasLineOfSight(player, blockers) {
    _v1.copy(this.mesh.position).setY(1.4);
    _v2.copy(player.position).setY(1.2).sub(_v1);
    const dist = _v2.length();
    if (dist < 0.5) return true;
    _ray.set(_v1, _v2.normalize());
    _ray.far = dist;
    return _ray.intersectObjects(blockers, true).length === 0;
  }

  takeDamage(amount, isCore) {
    if (this.dead) return;
    this.hp -= amount;
    this.flashTimer = 0.12;
    // getting shot always alerts
    if (this.state === 'patrol') this.state = 'chase';
    if (this.hp <= 0) this.die();
  }

  die() {
    this.dead = true;
    this.dying = 0.6; // short death anim before release
    this.ctx.audio?.playAt('explode', this.mesh.position, 0.8);
    this.ctx.onDeath?.(this);
  }

  /** @returns true while alive/dying; false → pool may release */
  update(dt) {
    if (this.dying > 0) {
      // collapse: sink + shrink, cores dim
      this.dying -= dt;
      this.mesh.scale.multiplyScalar(Math.max(0.0, 1 - dt * 2.2));
      this.mesh.position.y -= dt * 0.6;
      this.setCoreIntensity(Math.max(0, this.dying * 4));
      return this.dying > 0;
    }
    if (this.dead) return false;

    const { player, blockers } = this.ctx;
    const toPlayer = _v1.copy(player.position).sub(this.mesh.position).setY(0);
    const dist = toPlayer.length();

    // hit flash on body materials
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const f = this.flashTimer > 0 ? 1 : 0;
      for (const m of this.bodyMats) m.emissive?.setHex(f ? 0x662211 : 0x000000);
    }

    switch (this.state) {
      case 'patrol': {
        this.moveToward(this.patrolTarget, this.cfg.speed * 0.4, dt);
        if (this.mesh.position.distanceTo(this.patrolTarget) < 1) this.patrolTarget = this.pickPatrolPoint();
        const sees = dist < this.cfg.proximity ||
          (dist < this.cfg.detectRange && this.hasLineOfSight(player, blockers()));
        if (sees && !player.dead) {
          this.state = 'chase';
          this.ctx.audio?.playAt('enemyShot', this.mesh.position, 0.3);
        }
        break;
      }
      case 'chase': {
        if (player.dead) { this.state = 'patrol'; break; }
        if (dist <= this.cfg.attackRange) {
          this.state = 'attack';
        } else {
          this.moveToward(player.position, this.cfg.speed * this.speedMul(), dt);
          if (dist > this.cfg.detectRange * 2.2) this.state = 'patrol'; // lost him
        }
        break;
      }
      case 'attack': {
        if (player.dead) { this.state = 'patrol'; break; }
        this.faceToward(player.position, dt);
        if (dist > this.cfg.attackRange * 1.25) { this.state = 'chase'; break; }
        this.attackTimer -= dt;
        if (this.cfg.kind === 'melee') this.updateMelee(dt, dist, player);
        else this.updateRanged(dt, dist, player);
        break;
      }
    }
    // enemies live on flat ground (y=0); lunge adds a hop
    if (this.lungeTimer > 0) {
      this.lungeTimer -= dt;
      this.mesh.position.y = Math.sin((1 - this.lungeTimer / 0.3) * Math.PI) * 0.5;
    } else {
      this.mesh.position.y = 0;
    }
    // core pulse — menace you can read at a distance
    const pulse = 2.2 + Math.sin(performance.now() * 0.004 + this.home.x) * 0.6;
    if (this.flashTimer <= 0 && this.dying <= 0) this.setCoreIntensity(pulse);
    return true;
  }

  speedMul() { return 1; }
  cooldownMul() { return 1; }

  updateMelee(dt, dist, player) {
    if (this.attackTimer <= 0) {
      this.attackTimer = this.cfg.attackCooldown * this.cooldownMul();
      this.lungeTimer = 0.3;
      if (dist < this.cfg.attackRange * 1.2) {
        player.takeDamage(Math.round(this.cfg.damage * this.difficulty));
      }
      this.ctx.audio?.playAt('hit', this.mesh.position, 0.6);
    }
  }

  updateRanged(dt, dist, player) {
    // telegraph then fire an N-shot burst
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstLeft--;
        this.burstTimer = this.cfg.burstGap;
        this.fireShot(player);
      }
    } else if (this.attackTimer <= 0) {
      this.attackTimer = this.cfg.attackCooldown * this.cooldownMul();
      this.burstLeft = this.cfg.burst;
      this.burstTimer = 0.25; // brief windup — core flares as the telegraph
      this.setCoreIntensity(5);
    }
  }

  fireShot(player) {
    const from = new THREE.Vector3();
    (this.muzzle || this.mesh).getWorldPosition(from);
    if (!this.muzzle) from.y += 1.2;

    // aim at chest with angular error; rolling/sprinting is harder to hit
    const target = _v2.copy(player.position).setY(player.position.y + 0.9);
    const dist = from.distanceTo(target);
    const evasion = player.rollTimer > 0 ? 3.5 : (player.input?.sprint ? 1.8 : 1);
    const err = this.cfg.aimError * evasion * dist;
    target.x += (Math.random() - 0.5) * 2 * err;
    target.y += (Math.random() - 0.5) * 2 * err * 0.5;
    target.z += (Math.random() - 0.5) * 2 * err;

    this.ctx.audio?.playAt('enemyShot', from, 0.5);
    this.ctx.effects?.enemyTracer(from, target);

    // did the perturbed aim line still pass close enough to the player?
    const closest = new THREE.Line3(from, target).closestPointToPoint(
      _v1.copy(player.position).setY(player.position.y + 0.9), true, new THREE.Vector3()
    );
    if (closest.distanceTo(_v1) < 0.55 && this.hasLineOfSight(player, this.ctx.blockers())) {
      player.takeDamage(Math.round(this.cfg.damage * this.difficulty));
    }
  }

  moveToward(target, speed, dt) {
    _v2.copy(target).sub(this.mesh.position).setY(0);
    const d = _v2.length();
    if (d < 0.05) return;
    _v2.normalize();
    // simple separation from other enemies is handled by Level
    this.mesh.position.addScaledVector(_v2, Math.min(speed * dt, d));
    this.faceToward(target, dt);
  }

  faceToward(target, dt) {
    const want = Math.atan2(target.x - this.mesh.position.x, target.z - this.mesh.position.z);
    let d = want - this.mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.mesh.rotation.y += d * Math.min(1, dt * 8);
  }

  setCoreIntensity(v) {
    for (const m of this.coreMats) m.emissiveIntensity = v;
  }

  onRelease() {
    if (this.mesh) this.mesh.visible = false;
    this.dead = true;
  }
}
