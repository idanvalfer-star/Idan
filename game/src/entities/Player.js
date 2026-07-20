/**
 * Player — treasure hunter controller.
 *
 * Movement: camera-relative WASD on a dynamic physics sphere (velocity set
 * directly, gravity handled by cannon). Sprint drains stamina, Space jumps
 * (ground-checked via downward ray), Ctrl dodge-rolls with brief i-frames.
 *
 * Camera: over-the-shoulder orbit driven by mouse (pointer lock). Right
 * mouse = aim mode → shoulder tightens + FOV narrows for precision.
 *
 * Visual: placeholder "tribal-tech adventurer" built from primitives —
 * gold-armored capsule, layered plates, braid, torch with warm point light.
 * Swap buildMesh() for a glTF rig later; the controller doesn't care.
 */
import * as THREE from 'three';
import { THEME } from '../config/theme.config.js';

const WALK_SPEED = 6.2;
const SPRINT_SPEED = 9.5;
const AIM_SPEED = 3.4;
const JUMP_VEL = 8.5;
const ROLL_SPEED = 13;
const ROLL_TIME = 0.42;
const ROLL_STAMINA = 25;
const SPRINT_DRAIN = 18;    // per second
const STAMINA_REGEN = 22;   // per second

const CAM_OFFSET = new THREE.Vector3(0.85, 1.75, 4.1);   // over right shoulder
const CAM_OFFSET_AIM = new THREE.Vector3(0.65, 1.55, 1.9);
const FOV_NORMAL = 62;
const FOV_AIM = 44;

export class Player {
  constructor({ scene, physics, input, camera, audio }) {
    this.scene = scene;
    this.physics = physics;
    this.input = input;
    this.camera = camera;
    this.audio = audio;

    this.maxHealth = 100;
    this.health = 100;
    this.maxStamina = 100;
    this.stamina = 100;
    this.fragments = 0;
    this.score = 0;

    this.yaw = 0;           // camera yaw (radians)
    this.pitch = -0.12;     // camera pitch
    this.aiming = false;
    this.onGround = false;
    this.rollTimer = 0;
    this.rollDir = new THREE.Vector3();
    this.invulnTimer = 0;
    this.hurtCallback = null; // HUD hooks in for damage flash
    this.dead = false;

    this.body = physics.createPlayerBody([0, 2, 0]);
    this.mesh = this.buildMesh();
    scene.add(this.mesh);

    this._camTarget = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
  }

  buildMesh() {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({
      color: THEME.colors.playerGold, ...THEME.materials.playerArmor,
    });
    const leather = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98e63, roughness: 0.8 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3a2417, roughness: 0.95 });

    // torso (capsule) with layered chest plates
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.6, 4, 12), leather);
    torso.position.y = 1.0;
    torso.castShadow = true;
    g.add(torso);
    for (let i = 0; i < 3; i++) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52 - i * 0.06, 0.14, 0.36), gold);
      plate.position.set(0, 1.25 - i * 0.16, 0.06);
      plate.castShadow = true;
      g.add(plate);
    }
    // shoulder pads
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold);
      pad.position.set(s * 0.38, 1.42, 0);
      pad.castShadow = true;
      g.add(pad);
    }
    // head + braid down the back
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skin);
    head.position.y = 1.75;
    head.castShadow = true;
    g.add(head);
    const braid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 0.55, 6), hair);
    braid.position.set(0, 1.5, -0.22);
    braid.rotation.x = 0.35;
    g.add(braid);
    // legs
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 8), leather);
      leg.position.set(s * 0.15, 0.4, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    // weapon anchor (right hand) — Weapon attaches its mesh here
    this.weaponAnchor = new THREE.Group();
    this.weaponAnchor.position.set(0.42, 1.15, 0.25);
    g.add(this.weaponAnchor);

    // torch on the back — warm friendly light source per art direction
    const torch = new THREE.Group();
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
    g.add(torch);

    return g;
  }

  setSpawn(x, z) {
    this.body.position.set(x, 1.5, z);
    this.body.velocity.set(0, 0, 0);
    this.mesh.position.set(x, 1.05, z);
    this.dead = false;
  }

  /** @param {Array<THREE.Object3D>} groundMeshes meshes the jump-check ray may hit */
  update(dt, groundMeshes) {
    if (this.dead) return;
    const input = this.input;

    // ---- look ----
    const sens = 0.0023 * (this.aiming ? 0.6 : 1);
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch));
    this.aiming = input.aim;

    // ---- ground check (short ray from feet) ----
    this._ray.set(
      new THREE.Vector3(this.body.position.x, this.body.position.y + 0.1, this.body.position.z),
      new THREE.Vector3(0, -1, 0)
    );
    this._ray.far = 0.75;
    this.onGround = this.body.position.y < 1.0 ||
      (groundMeshes?.length ? this._ray.intersectObjects(groundMeshes, true).length > 0 : false);

    // ---- movement basis (camera-relative, flattened) ----
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(this._fwd.z, 0, -this._fwd.x);
    this._move.set(0, 0, 0);
    if (input.forward) this._move.add(this._fwd);
    if (input.back) this._move.sub(this._fwd);
    if (input.right) this._move.add(this._right);
    if (input.left) this._move.sub(this._right);
    const moving = this._move.lengthSq() > 0;
    if (moving) this._move.normalize();

    // ---- dodge roll ----
    if (this.rollTimer > 0) {
      this.rollTimer -= dt;
      this.body.velocity.x = this.rollDir.x * ROLL_SPEED;
      this.body.velocity.z = this.rollDir.z * ROLL_SPEED;
    } else {
      if (input.dodge && this.stamina >= ROLL_STAMINA && this.onGround) {
        this.rollTimer = ROLL_TIME;
        this.invulnTimer = ROLL_TIME + 0.1;
        this.stamina -= ROLL_STAMINA;
        this.rollDir.copy(moving ? this._move : this._fwd);
        this.audio?.play('roll');
      }
      // ---- walk / sprint ----
      const sprinting = input.sprint && moving && this.stamina > 1 && !this.aiming;
      const speed = this.aiming ? AIM_SPEED : (sprinting ? SPRINT_SPEED : WALK_SPEED);
      if (sprinting) this.stamina = Math.max(0, this.stamina - SPRINT_DRAIN * dt);
      else this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * dt);

      this.body.velocity.x = this._move.x * speed;
      this.body.velocity.z = this._move.z * speed;

      if (input.jump && this.onGround) {
        this.body.velocity.y = JUMP_VEL;
        this.audio?.play('jump');
      }
    }

    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    // fell off the world → clamp back
    if (this.body.position.y < -20) this.setSpawn(this.mesh.position.x, this.mesh.position.z);

    // ---- sync visual ----
    this.mesh.position.set(this.body.position.x, this.body.position.y - 0.45, this.body.position.z);
    // face move direction; face camera direction when aiming
    if (this.aiming) {
      this.mesh.rotation.y = this.yaw;
    } else if (moving || this.rollTimer > 0) {
      const dir = this.rollTimer > 0 ? this.rollDir : this._move;
      const target = Math.atan2(dir.x, dir.z);
      let d = target - this.mesh.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.mesh.rotation.y += d * Math.min(1, dt * 12);
    }
    // roll tuck animation
    this.mesh.rotation.x = this.rollTimer > 0 ? (1 - this.rollTimer / ROLL_TIME) * Math.PI * 2 : 0;

    // torch flicker
    this.torchLight.intensity = 1.0 + Math.sin(performance.now() * 0.02) * 0.2 + Math.random() * 0.15;

    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const wanted = this.aiming ? CAM_OFFSET_AIM : CAM_OFFSET;
    this._camOffset ||= CAM_OFFSET.clone();
    this._camOffset.lerp(wanted, Math.min(1, dt * 10));

    const fovWanted = this.aiming ? FOV_AIM : FOV_NORMAL;
    if (Math.abs(this.camera.fov - fovWanted) > 0.1) {
      this.camera.fov += (fovWanted - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }

    // orbit around a point at chest height
    const pivot = this._camTarget.set(
      this.body.position.x, this.body.position.y + 0.9, this.body.position.z
    );
    const off = new THREE.Vector3(this._camOffset.x, 0, this._camOffset.z)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.camera.position.copy(pivot).add(off).add(new THREE.Vector3(0, this._camOffset.y - 0.9, 0));
    // keep camera above ground
    if (this.camera.position.y < 0.3) this.camera.position.y = 0.3;

    const lookAt = pivot.clone()
      .add(new THREE.Vector3(0, Math.sin(this.pitch) * 2, 0))
      .add(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(6));
    this.camera.lookAt(lookAt);
  }

  takeDamage(amount) {
    if (this.dead || this.invulnTimer > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnTimer = Math.max(this.invulnTimer, 0.15); // tiny grace vs. bursts
    this.audio?.play('hurt');
    this.hurtCallback?.(amount);
    if (this.health <= 0) this.dead = true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  get position() { return this.mesh.position; }
}
