/**
 * Boss — massive multi-phase mech guarding each level's treasure fragment.
 *
 * Phases come from BOSSES config: as hp crosses each phase's `until`
 * fraction, the boss retracts a core (fewer weak points), speeds up, and
 * attacks faster. It mixes melee slams (close) with ranged bursts (far).
 * The HUD renders its segmented multi-phase health bar.
 */
import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import { BOSSES } from '../config/enemies.config.js';
import { THEME } from '../config/theme.config.js';

export class Boss extends Enemy {
  reset(type, pos, difficulty = 1, ctx = {}) {
    // Bosses read from BOSSES, not ENEMIES — patch cfg after base reset.
    this.bossCfg = BOSSES[type];
    const saved = { ...this.bossCfg, kind: 'hybrid' };
    // Base Enemy update() reads this.cfg like an ENEMIES entry — synthesize one.
    this.type = type;
    this.cfg = {
      ...saved,
      damage: saved.meleeDamage,
      attackCooldown: saved.phases[0].cooldown,
      burst: saved.burst, burstGap: saved.burstGap, aimError: saved.aimError,
    };
    this.ctx = ctx;
    this.difficulty = difficulty;
    this.maxHp = Math.round(saved.hp * difficulty);
    this.hp = this.maxHp;
    this.dead = false;
    this.dying = 0;
    this.state = 'chase'; // bosses are always awake once spawned
    this.attackTimer = 2;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.lungeTimer = 0;
    this.flashTimer = 0;
    this.phaseIndex = 0;
    this.roared = false;
    this.home = new THREE.Vector3(pos.x, 0, pos.z);
    this.patrolTarget = this.home.clone();

    if (this.meshType !== type) {
      if (this.mesh) this.scene.remove(this.mesh);
      this.mesh = this.buildMesh(saved.body);
      this.meshType = type;
      this.scene.add(this.mesh);
    }
    this.mesh.visible = true;
    this.mesh.scale.setScalar(saved.body.scale);
    this.mesh.position.set(pos.x, 0, pos.z);
    this.applyPhase(0);
  }

  buildBossBody(g, box, addCore, metal, tint) {
    // hulking humanoid frame
    box(1.6, 1.6, 1.0, 0, 2.2, 0);                    // torso
    box(1.8, 0.4, 1.1, 0, 3.1, 0, tint);              // shoulder wear plating
    box(0.7, 0.6, 0.7, 0, 3.6, 0);                    // head
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.12, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x220a05, emissive: THEME.colors.enemyCoreHot, emissiveIntensity: 3 })
    );
    visor.position.set(0, 3.65, 0.36);
    visor.userData.enemyRef = this;
    g.add(visor);
    this.coreMats.push(visor.material);
    for (const s of [-1, 1]) {
      box(0.5, 1.6, 0.6, s * 0.55, 0.8, 0);           // legs
      box(0.45, 1.3, 0.55, s * 1.15, 2.2, 0);         // arms
      box(0.6, 0.5, 0.65, s * 1.15, 1.45, 0, tint);   // fists
    }
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(1.15, 2.0, 0.5);
    g.add(this.muzzle);
    // three weak-point cores: chest + both shoulders (retract per phase)
    addCore(0.24, 0, 2.3, 0.55);
    addCore(0.17, -0.85, 3.1, 0.45);
    addCore(0.17, 0.85, 3.1, 0.45);
  }

  get phases() { return this.bossCfg.phases; }

  applyPhase(i) {
    this.phaseIndex = i;
    const ph = this.phases[i];
    // retract cores beyond this phase's count — fewer weak points, harder fight
    this.cores.forEach((core, idx) => {
      const active = idx < ph.cores;
      core.visible = active;
      core.userData.isCore = active;
    });
    this.cfg.attackCooldown = ph.cooldown;
    this.ctx.audio?.playAt('bossRoar', this.mesh.position, 1);
    this.ctx.onBossPhase?.(this, i);
  }

  takeDamage(amount, isCore) {
    if (this.dead) return;
    this.hp -= amount;
    this.flashTimer = 0.12;
    const frac = this.hp / this.maxHp;
    // crossed into a later phase?
    let idx = this.phaseIndex;
    while (idx < this.phases.length - 1 && frac <= this.phases[idx].until) idx++;
    if (idx !== this.phaseIndex) this.applyPhase(idx);
    if (this.hp <= 0) this.die();
  }

  speedMul() { return this.phases[this.phaseIndex].speedMul; }
  cooldownMul() { return 1; } // cooldown already set per phase

  update(dt) {
    if (!this.dead && !this.roared) {
      this.roared = true;
      this.ctx.audio?.playAt('bossRoar', this.mesh.position, 1);
    }
    // hybrid attack pattern: melee slam close, ranged burst far
    if (!this.dead && this.state === 'attack') {
      const dist = this.mesh.position.distanceTo(this.ctx.player.position);
      this.cfg.kind = dist <= this.bossCfg.attackRange * 1.1 ? 'melee' : 'ranged';
      this.cfg.damage = this.cfg.kind === 'melee' ? this.bossCfg.meleeDamage : this.bossCfg.rangedDamage;
      this.cfg.attackRange = this.cfg.kind === 'melee' ? this.bossCfg.attackRange : this.bossCfg.rangedRange;
    } else if (!this.dead) {
      // chase until within ranged reach, then start attacking
      this.cfg.kind = 'ranged';
      this.cfg.attackRange = this.bossCfg.rangedRange;
    }
    return super.update(dt);
  }

  die() {
    this.dead = true;
    this.dying = 1.4; // longer, more dramatic collapse
    this.ctx.audio?.playAt('explode', this.mesh.position, 1);
    this.ctx.audio?.playAt('bossRoar', this.mesh.position, 0.8);
    this.ctx.onDeath?.(this);
  }
}
