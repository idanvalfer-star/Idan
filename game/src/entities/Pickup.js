/**
 * Pickup — floating collectibles: health, ammo, weapons, treasure fragments.
 * Collected by proximity; bobs and spins with a warm glow (friendly = gold
 * per the color language). Level owns and updates these.
 */
import * as THREE from 'three';
import { THEME } from '../config/theme.config.js';

export class Pickup {
  /**
   * @param {string} kind 'health' | 'ammo' | 'weapon' | 'fragment'
   * @param {object} opts {weapon} for kind 'weapon'; {y} floor offset for
   *                 pickups placed on platforms (docks etc.)
   */
  constructor(scene, kind, pos, opts = {}) {
    this.scene = scene;
    this.kind = kind;
    this.opts = opts;
    this.collected = false;
    this.mesh = this.buildMesh();
    this.baseY = 1 + (opts.y ?? 0);
    this.mesh.position.set(pos.x, this.baseY, pos.z);
    this.t = Math.random() * 10;
    scene.add(this.mesh);
  }

  buildMesh() {
    const g = new THREE.Group();
    let color, geo;
    switch (this.kind) {
      case 'health':
        color = 0x69e089;
        geo = new THREE.OctahedronGeometry(0.3);
        break;
      case 'ammo':
        color = 0xe8b64c;
        geo = new THREE.BoxGeometry(0.4, 0.3, 0.3);
        break;
      case 'weapon':
        color = 0xffd27f;
        geo = new THREE.CylinderGeometry(0.12, 0.12, 0.7, 6);
        break;
      case 'fragment':
        color = THEME.colors.treasure;
        geo = new THREE.IcosahedronGeometry(0.45);
        break;
    }
    const core = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: this.kind === 'fragment' ? 2.8 : 1.2,
      metalness: 0.3, roughness: 0.4,
    }));
    if (this.kind === 'weapon') core.rotation.z = Math.PI / 2.4;
    g.add(core);
    const light = new THREE.PointLight(color, this.kind === 'fragment' ? 8 : 3, 6, 2);
    light.position.y = 0.2;
    g.add(light);
    return g;
  }

  update(dt, playerPos) {
    if (this.collected) return false;
    this.t += dt;
    this.mesh.position.y = this.baseY + Math.sin(this.t * 2.2) * 0.18;
    this.mesh.rotation.y += dt * 1.5;
    const grabRange = this.kind === 'fragment' ? 2.2 : 1.6;
    if (this.mesh.position.distanceTo(playerPos) < grabRange) {
      this.collected = true;
      return false;
    }
    return true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
}
