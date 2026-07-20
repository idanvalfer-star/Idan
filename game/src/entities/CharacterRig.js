/**
 * CharacterRig — the player's visual body + animation state machine.
 *
 * Loads a rigged humanoid glTF (public/models/Soldier.glb — Mixamo-compatible
 * skeleton with Idle/Walk/Run clips) and drives it with an AnimationMixer:
 *
 *   MOVE blend tree (by |velocity|):  0 → idle,  →1.4 walk,  →4+ run
 *   backpedal   : walk clip reversed (timeScale < 0)
 *   sprint      : run clip, playback scaled up
 *   foot-lock   : playback speed follows real ground speed — no skating
 *   airborne    : procedural tilt (no jump clip in the set)
 *   dodge roll  : procedural tuck-and-spin on the rig root
 *
 * All cross-fades use LOCOMOTION.crossfade. If the glTF is missing or fails,
 * a primitive adventurer is built instead and the same procedural motions
 * apply — the controller API is identical either way, so a richer Mixamo
 * clip set can drop in without touching Player.js.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LOCOMOTION, THEME } from '../config/theme.config.js';

// real-world speeds the source clips were authored at (m/s) — used to scale
// playback so feet match the ground (tuned for the Mixamo Soldier clips)
const CLIP_REF_SPEED = { Walk: 1.6, Run: 4.2 };

export class CharacterRig {
  /**
   * @param {THREE.Group} container parent group (the Player's mesh root)
   * @param {object} o {onHandBone(bone), onSpineBone(bone)} attachment hooks
   */
  constructor(container, o = {}) {
    this.container = container;
    this.opts = o;
    this.mixer = null;
    this.actions = {};
    this.current = null;      // name of the dominant action
    this.loaded = false;
    this.airTilt = 0;

    this.root = new THREE.Group(); // procedural roll/lean applied here
    container.add(this.root);

    this.buildPlaceholder(); // instant visual; swapped out when glTF lands
    new GLTFLoader().load(
      'models/Soldier.glb',
      (gltf) => this.onLoaded(gltf),
      undefined,
      (err) => console.warn('CharacterRig: glTF load failed, keeping placeholder.', err)
    );
  }

  buildPlaceholder() {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: THEME.colors.playerGold, ...THEME.materials.playerArmor });
    const leather = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98e63, roughness: 0.8 });
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
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skin);
    head.position.y = 1.75;
    head.castShadow = true;
    g.add(head);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 8), leather);
      leg.position.set(s * 0.15, 0.4, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    this.placeholder = g;
    this.root.add(g);
  }

  onLoaded(gltf) {
    const model = gltf.scene;
    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.frustumCulled = false; // skinned bounds are unreliable
        // give the soldier the adventurer's warm-gold armor read
        if (obj.material?.isMeshStandardMaterial) {
          obj.material.color.multiply(new THREE.Color(1.15, 1.02, 0.82));
          obj.material.metalness = Math.min(0.4, obj.material.metalness ?? 0);
          obj.material.roughness = 0.7;
        }
      }
    });
    this.root.remove(this.placeholder);
    this.root.add(model);
    this.model = model;

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      if (clip.name === 'TPose') continue;
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.actions.Idle?.play();
    this.current = 'Idle';

    // hand/spine bones for weapon + torch attachment (world matrices must be
    // current so attachment code can read real bone scales)
    this.root.updateMatrixWorld(true);
    model.traverse((obj) => {
      if (obj.isBone) {
        if (/RightHand$/.test(obj.name)) this.opts.onHandBone?.(obj);
        if (/Spine2$/.test(obj.name)) this.opts.onSpineBone?.(obj);
      }
    });
    this.loaded = true;
  }

  /** Cross-fade helper — never snaps between clips. */
  fadeTo(name, timeScale = 1) {
    const next = this.actions[name];
    if (!next) return;
    if (this.current === name) {
      next.timeScale = timeScale;
      return;
    }
    const prev = this.actions[this.current];
    next.enabled = true;
    next.timeScale = timeScale;
    next.setEffectiveWeight(1);
    next.play();
    if (prev) next.crossFadeFrom(prev, LOCOMOTION.crossfade, true);
    this.current = name;
  }

  /**
   * @param {object} s per-frame state from the Player:
   *   speed        horizontal m/s (actual, post-accel)
   *   backpedal    moving mostly backwards (aiming backstep)
   *   grounded, rolling (0..1 progress or 0), airborne
   */
  update(dt, s) {
    // ---- procedural root motion (works with or without the glTF) ----
    if (s.rolling > 0) {
      this.root.rotation.x = s.rolling * Math.PI * 2; // tuck-and-spin
    } else {
      this.root.rotation.x *= Math.max(0, 1 - dt * 12); // settle out
    }
    const tiltTarget = s.airborne ? -0.18 : 0;          // slight air lean-back
    this.airTilt += (tiltTarget - this.airTilt) * Math.min(1, dt * 8);
    this.root.position.y = 0;

    if (!this.mixer) {
      // placeholder-only bob so even the capsule doesn't feel frozen
      if (this.placeholder && s.speed > 0.1 && s.grounded) {
        this.placeholder.rotation.z = Math.sin(performance.now() * 0.012 * s.speed) * 0.04;
      }
      return;
    }

    // ---- blend tree by actual velocity magnitude ----
    if (s.rolling > 0) {
      // roll is procedural; keep run cycling underneath for leg motion
      this.fadeTo('Run', 1.4);
    } else if (s.airborne) {
      this.fadeTo('Idle', 1); // no falling clip in the set — tilt carries it
      this.root.rotation.x = this.airTilt;
    } else if (s.speed < 0.25) {
      this.fadeTo('Idle', 1);
    } else if (s.backpedal) {
      // reversed walk = believable backpedal without a dedicated clip
      this.fadeTo('Walk', -Math.max(0.6, s.speed / CLIP_REF_SPEED.Walk));
    } else if (s.speed < (LOCOMOTION.walkSpeed + LOCOMOTION.runSpeed) / 2) {
      this.fadeTo('Walk', Math.max(0.5, s.speed / CLIP_REF_SPEED.Walk));   // foot-lock
    } else {
      this.fadeTo('Run', Math.max(0.6, s.speed / CLIP_REF_SPEED.Run));     // covers sprint too
    }

    this.mixer.update(dt);
  }

  /** Normalized gait phase (0..1) of the active cycle — drives footsteps. */
  gaitPhase() {
    const action = this.actions[this.current];
    if (!action || (this.current !== 'Walk' && this.current !== 'Run')) return null;
    const clip = action.getClip();
    return (action.time % clip.duration) / clip.duration;
  }
}
