/**
 * Player — treasure hunter controller.
 *
 * Locomotion (all tunables in LOCOMOTION, theme.config.js):
 *   · velocity ramps with accel/decel — no instant starts or stops
 *   · body turns toward travel direction over turnResponse seconds and
 *     leans into turns and sprint
 *   · jump has takeoff → airborne → landing (camera dip, dust, thud)
 *   · dodge-roll with i-frames; sprint drains stamina
 *
 * Camera: spring-damped over-the-shoulder follow with walk sway, subtle
 * head-bob, aim tighten (FOV + shoulder), and a landing dip.
 *
 * Visuals live in CharacterRig (rigged glTF + animation blend tree, or a
 * primitive fallback) — this class never touches clips directly, it just
 * reports {speed, backpedal, grounded, airborne, rolling} each frame.
 */
import * as THREE from 'three';
import { THEME, LOCOMOTION } from '../config/theme.config.js';
import { CharacterRig } from './CharacterRig.js';

const L = LOCOMOTION;

export class Player {
  constructor({ scene, physics, input, camera, audio }) {
    this.scene = scene;
    this.physics = physics;
    this.input = input;
    this.camera = camera;
    this.audio = audio;
    this.particles = null;    // injected by GameManager
    this.surface = 'grass';   // per-level footstep surface

    this.maxHealth = 100;
    this.health = 100;
    this.maxStamina = 100;
    this.stamina = 100;
    this.fragments = 0;
    this.score = 0;

    this.yaw = 0;
    this.pitch = -0.12;
    this.aiming = false;
    this.onGround = false;
    this.wasGround = true;
    this.rollTimer = 0;
    this.rollDir = new THREE.Vector3();
    this.invulnTimer = 0;
    this.hurtCallback = null;
    this.dead = false;

    this.vel = new THREE.Vector3();      // smoothed horizontal velocity
    this.facing = 0;                      // current body yaw
    this.lean = 0;
    this.dipTimer = 0;                    // landing camera dip
    this.bobPhase = 0;
    this.lastGait = 0;

    this.body = physics.createPlayerBody([0, 2, 0]);
    this.mesh = this.buildMesh();
    scene.add(this.mesh);

    this._camTarget = new THREE.Vector3();
    this._camPos = null;
    this._lookPos = null;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
  }

  buildMesh() {
    const g = new THREE.Group();

    // weapon anchor — re-parented onto the rig's hand bone once it loads
    this.weaponAnchor = new THREE.Group();
    this.weaponAnchor.position.set(0.42, 1.15, 0.25);
    g.add(this.weaponAnchor);

    // torch — warm friendly light, rides the spine bone when available
    const torch = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), leather);
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({
        color: THEME.colors.friendlyLight, emissive: THEME.colors.friendlyLight, emissiveIntensity: 0.9,
      })
    );
    flame.position.y = 0.3;
    this.torchLight = new THREE.PointLight(THEME.colors.friendlyLight, 1.1, 5, 2);
    this.torchLight.position.y = 0.32;
    torch.add(stick, flame, this.torchLight);
    torch.position.set(-0.52, 1.0, -0.35);
    torch.rotation.z = 0.35;
    this.torch = torch;
    g.add(torch);

    // Mixamo armatures are cm-scaled (bone world scale ≈ 0.01) — attachments
    // must invert that or they render at 1% size.
    const attach = (bone, obj, posMeters) => {
      bone.add(obj);
      const inv = 1 / bone.getWorldScale(new THREE.Vector3()).x;
      obj.scale.setScalar(inv);
      obj.position.copy(posMeters).multiplyScalar(inv);
    };
    this.rig = new CharacterRig(g, {
      onHandBone: (bone) => {
        attach(bone, this.weaponAnchor, new THREE.Vector3(0.03, 0.12, 0.02));
        this.weaponAnchor.rotation.set(Math.PI / 2, 0, 0);
      },
      onSpineBone: (bone) => {
        attach(bone, this.torch, new THREE.Vector3(-0.22, 0.1, -0.14));
      },
    });
    return g;
  }

  setSpawn(x, z) {
    this.body.position.set(x, 1.5, z);
    this.body.velocity.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.mesh.position.set(x, 1.05, z);
    this.dead = false;
  }

  /** @param {Array<THREE.Object3D>} groundMeshes platform meshes for the jump-check ray */
  update(dt, groundMeshes) {
    if (this.dead) return;
    const input = this.input;

    // ---- look ----
    const sens = 0.0023 * (this.aiming ? 0.6 : 1);
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch));
    this.aiming = input.aim;

    // ---- ground check (platforms via ray, terrain via height) ----
    this._ray.set(
      new THREE.Vector3(this.body.position.x, this.body.position.y + 0.1, this.body.position.z),
      new THREE.Vector3(0, -1, 0)
    );
    this._ray.far = 0.75;
    const platformHit = groundMeshes?.length
      ? this._ray.intersectObjects(groundMeshes, true).length > 0 : false;
    this.onGround = this.body.position.y < 1.0 || platformHit;
    this.groundSurface = platformHit ? 'wood' : this.surface;

    // ---- landing ----
    if (this.onGround && !this.wasGround && this.body.velocity.y <= 0.5) {
      this.dipTimer = L.camera.landDip;
      this.audio?.play('land', 0.7);
      this.particles?.burst(this.feetPos(), this.groundSurface, 5, 0.8);
    }
    this.wasGround = this.onGround;

    // ---- movement basis (camera-relative, flattened) ----
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(this._fwd.z, 0, -this._fwd.x);
    this._move.set(0, 0, 0);
    if (input.forward) this._move.add(this._fwd);
    if (input.back) this._move.sub(this._fwd);
    if (input.right) this._move.add(this._right);
    if (input.left) this._move.sub(this._right);
    const hasInput = this._move.lengthSq() > 0;
    if (hasInput) this._move.normalize();

    // ---- dodge roll ----
    if (this.rollTimer > 0) {
      this.rollTimer -= dt;
      this.vel.copy(this.rollDir).multiplyScalar(L.rollSpeed);
      if (this.rollTimer <= 0) this.particles?.burst(this.feetPos(), this.groundSurface, 3, 0.6);
    } else {
      if (input.dodge && this.stamina >= L.rollStamina && this.onGround) {
        this.rollTimer = L.rollTime;
        this.invulnTimer = L.rollTime + 0.1;
        this.stamina -= L.rollStamina;
        this.rollDir.copy(hasInput ? this._move : this._fwd);
        this.audio?.play('roll');
        this.particles?.burst(this.feetPos(), this.groundSurface, 4, 0.7);
      }

      // ---- accelerate / decelerate toward the wish velocity ----
      const sprinting = input.sprint && hasInput && this.stamina > 1 && !this.aiming;
      const targetSpeed = !hasInput ? 0 : this.aiming ? L.aimSpeed : (sprinting ? L.sprintSpeed : L.runSpeed);
      if (sprinting) this.stamina = Math.max(0, this.stamina - L.sprintDrain * dt);
      else this.stamina = Math.min(this.maxStamina, this.stamina + L.staminaRegen * dt);

      const target = this._move.clone().multiplyScalar(targetSpeed);
      const rate = hasInput ? L.accel : L.decel;
      const delta = target.sub(this.vel);
      const maxStep = rate * dt;
      if (delta.length() > maxStep) delta.setLength(maxStep);
      this.vel.add(delta);
      if (!hasInput && this.vel.length() < 0.05) this.vel.set(0, 0, 0);

      if (input.jump && this.onGround) {
        this.body.velocity.y = L.jumpVelocity;
        this.audio?.play('jump');
      }
    }

    this.body.velocity.x = this.vel.x;
    this.body.velocity.z = this.vel.z;

    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.body.position.y < -20) this.setSpawn(this.mesh.position.x, this.mesh.position.z);

    // ---- sync visual root ----
    this.mesh.position.set(this.body.position.x, this.body.position.y - 0.45, this.body.position.z);

    // ---- facing with turn-lag + lean into turns/sprint ----
    const speed = Math.hypot(this.vel.x, this.vel.z);
    let wantFacing = this.facing;
    if (this.aiming) {
      wantFacing = this.yaw;
    } else if (this.rollTimer > 0) {
      wantFacing = Math.atan2(this.rollDir.x, this.rollDir.z);
    } else if (speed > 0.3) {
      wantFacing = Math.atan2(this.vel.x, this.vel.z);
    }
    let dYaw = wantFacing - this.facing;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const turnStep = dYaw * Math.min(1, dt / L.turnResponse);
    this.facing += turnStep;
    this.mesh.rotation.y = this.facing;

    // lean: into turns (roll axis) proportional to turn rate + speed
    const turnRate = dt > 0 ? turnStep / dt : 0;
    const leanTarget = THREE.MathUtils.clamp(
      -turnRate * (speed / L.sprintSpeed) * 0.12, -1, 1
    ) * THREE.MathUtils.degToRad(L.leanAmount);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 10);
    this.mesh.rotation.z = this.lean;
    // slight forward pitch at sprint
    const pitchTarget = speed > L.runSpeed + 0.5 && this.onGround ? -0.06 : 0;
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, pitchTarget, Math.min(1, dt * 6));

    // ---- animation state ----
    const backpedal = this.aiming && hasInput && this._move.dot(this._fwd) < -0.5;
    this.rig.update(dt, {
      speed,
      backpedal,
      grounded: this.onGround,
      airborne: !this.onGround,
      rolling: this.rollTimer > 0 ? 1 - this.rollTimer / L.rollTime : 0,
    });

    // ---- footsteps from gait phase (falls back to bob phase) ----
    if (this.onGround && speed > 0.5 && this.rollTimer <= 0) {
      let phase = this.rig.gaitPhase();
      if (phase === null) {
        this.bobPhase += dt * (speed / L.runSpeed) * L.headBob.freq;
        phase = this.bobPhase % 1;
      }
      // two footfalls per cycle
      const crossed = (a, b, mark) => (a < mark && b >= mark) || (a > b && (b >= mark || a < mark));
      if (crossed(this.lastGait, phase, 0.05) || crossed(this.lastGait, phase, 0.55)) {
        const stepSound = { grass: 'stepGrass', sand: 'stepSand', wood: 'stepWood' }[this.groundSurface];
        this.audio?.play(stepSound, speed > L.runSpeed ? 0.8 : 0.45);
        if (speed > L.runSpeed) this.particles?.dust(this.feetPos(), this.groundSurface, 0.45);
      }
      this.lastGait = phase;
    }

    // torch flicker
    this.torchLight.intensity = 1.0 + Math.sin(performance.now() * 0.02) * 0.2 + Math.random() * 0.15;

    if (this.dipTimer > 0) this.dipTimer -= dt;
    this.updateCamera(dt, speed);
  }

  feetPos() {
    return new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + 0.05, this.mesh.position.z);
  }

  updateCamera(dt, speed = 0) {
    const CAM_OFFSET = this._off1 ||= new THREE.Vector3(0.85, 1.75, 4.1);
    const CAM_OFFSET_AIM = this._off2 ||= new THREE.Vector3(0.65, 1.55, 1.9);
    const wanted = this.aiming ? CAM_OFFSET_AIM : CAM_OFFSET;
    this._camOffset ||= CAM_OFFSET.clone();
    this._camOffset.lerp(wanted, Math.min(1, dt * 10));

    const fovWanted = this.aiming ? L.camera.aimFov : L.camera.hipFov;
    if (Math.abs(this.camera.fov - fovWanted) > 0.1) {
      this.camera.fov += (fovWanted - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }

    const pivot = this._camTarget.set(
      this.body.position.x, this.body.position.y + 0.9, this.body.position.z
    );
    const off = new THREE.Vector3(this._camOffset.x, 0, this._camOffset.z)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const desired = pivot.clone().add(off).add(new THREE.Vector3(0, this._camOffset.y - 0.9, 0));

    // landing dip + subtle head-bob/walk sway
    if (this.dipTimer > 0) {
      desired.y -= Math.sin((1 - this.dipTimer / L.camera.landDip) * Math.PI) * 0.22;
    }
    if (this.onGround && speed > 0.5) {
      this.bobPhase += dt * (speed / L.runSpeed) * L.headBob.freq;
      const b = this.bobPhase * Math.PI * 2;
      desired.y += Math.sin(b * 2) * L.headBob.amp * Math.min(1, speed / L.runSpeed);
      desired.x += Math.cos(b) * L.headBob.amp * 0.5;
    }

    // spring-damped follow (frame-rate independent)
    const followK = 1 - Math.pow(1 - L.camera.followLerp, dt * 60);
    this._camPos ||= desired.clone();
    this._camPos.lerp(desired, this.aiming ? Math.min(1, followK * 2.5) : followK);
    this.camera.position.copy(this._camPos);
    if (this.camera.position.y < 0.3) this.camera.position.y = 0.3;

    const lookDesired = pivot.clone()
      .add(new THREE.Vector3(0, Math.sin(this.pitch) * 2, 0))
      .add(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(6));
    const lookK = 1 - Math.pow(1 - L.camera.lookLerp, dt * 60);
    this._lookPos ||= lookDesired.clone();
    this._lookPos.lerp(lookDesired, this.aiming ? 1 : lookK);
    this.camera.lookAt(this._lookPos);
  }

  takeDamage(amount) {
    if (this.dead || this.invulnTimer > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnTimer = Math.max(this.invulnTimer, 0.15);
    this.audio?.play('hurt');
    this.hurtCallback?.(amount);
    if (this.health <= 0) this.dead = true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  get position() { return this.mesh.position; }
}
