/**
 * PhysicsWorld — thin wrapper around cannon-es.
 *
 * The player is a dynamic sphere body (gravity, jumping, sliding along
 * obstacles). Level geometry registers static boxes/cylinders. Enemies are
 * *not* physics bodies (they steer kinematically and ray-clamp to ground) —
 * cheaper, and lets us pool hundreds of them.
 */
import * as CANNON from 'cannon-es';

export const GROUP_WORLD = 1;
export const GROUP_PLAYER = 2;

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.groundMaterial = new CANNON.Material('ground');
    this.playerMaterial = new CANNON.Material('player');
    // Low friction so the player doesn't stick to walls; movement is force-free
    // (we set velocity directly), so friction mostly matters against walls.
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.groundMaterial, this.playerMaterial, { friction: 0.0, restitution: 0.0 }
    ));
    this.staticBodies = [];
  }

  step(dt) {
    this.world.step(1 / 60, dt, 3);
  }

  /** Static axis-aligned box. pos = center. */
  addStaticBox(pos, size, { collisionFilterGroup = GROUP_WORLD } = {}) {
    const body = new CANNON.Body({
      mass: 0,
      material: this.groundMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)),
      position: new CANNON.Vec3(pos[0], pos[1], pos[2]),
      collisionFilterGroup,
    });
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  /** Static vertical cylinder (tree trunks, pillars). */
  addStaticCylinder(pos, radius, height) {
    const body = new CANNON.Body({
      mass: 0,
      material: this.groundMaterial,
      shape: new CANNON.Cylinder(radius, radius, height, 8),
      position: new CANNON.Vec3(pos[0], pos[1], pos[2]),
    });
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  /** Infinite ground plane at y=0. */
  addGroundPlane() {
    const body = new CANNON.Body({ mass: 0, material: this.groundMaterial, shape: new CANNON.Plane() });
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  createPlayerBody(pos, radius = 0.45) {
    const body = new CANNON.Body({
      mass: 70,
      material: this.playerMaterial,
      shape: new CANNON.Sphere(radius),
      position: new CANNON.Vec3(pos[0], pos[1], pos[2]),
      fixedRotation: true,
      collisionFilterGroup: GROUP_PLAYER,
      allowSleep: false,
    });
    body.linearDamping = 0.0;
    this.world.addBody(body);
    return body;
  }

  removeBody(body) {
    this.world.removeBody(body);
  }

  /** Remove all static level geometry (used when switching levels). */
  clearStatics() {
    for (const b of this.staticBodies) this.world.removeBody(b);
    this.staticBodies.length = 0;
  }
}
