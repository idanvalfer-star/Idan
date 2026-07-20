/**
 * Particles — pooled dust puffs for footfalls, landings and dodge rolls.
 * Soft radial-gradient sprites that rise, expand and fade. One shared pool,
 * no allocation during play.
 */
import * as THREE from 'three';
import { ObjectPool } from '../core/ObjectPool.js';

function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class Puff {
  constructor(scene, texture) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, opacity: 0,
    }));
    this.sprite.visible = false;
    scene.add(this.sprite);
    this.life = 0;
  }
  reset(pos, color, scale) {
    this.sprite.material.color.setHex(color);
    this.sprite.position.copy(pos);
    this.sprite.position.x += (Math.random() - 0.5) * 0.25;
    this.sprite.position.z += (Math.random() - 0.5) * 0.25;
    this.baseScale = scale * (0.8 + Math.random() * 0.5);
    this.maxLife = 0.55;
    this.life = this.maxLife;
    this.rise = 0.4 + Math.random() * 0.4;
    this.sprite.visible = true;
  }
  update(dt) {
    this.life -= dt;
    const t = 1 - this.life / this.maxLife; // 0→1
    this.sprite.position.y += this.rise * dt;
    const s = this.baseScale * (0.5 + t * 1.3);
    this.sprite.scale.set(s, s, 1);
    this.sprite.material.opacity = (1 - t) * 0.55;
    return this.life > 0;
  }
  onRelease() { this.sprite.visible = false; }
}

// per-surface dust tints
const DUST_COLOR = { grass: 0x8a9a6a, sand: 0xd8c090, wood: 0xa08862 };

export class Particles {
  constructor(scene) {
    const tex = makePuffTexture();
    this.pool = new ObjectPool(() => new Puff(scene, tex), 24);
  }

  /** One dust puff at a foot position. surface: 'grass' | 'sand' | 'wood' */
  dust(pos, surface = 'grass', scale = 0.5) {
    this.pool.acquire(pos, DUST_COLOR[surface] ?? DUST_COLOR.grass, scale);
  }

  /** Bigger burst for landings and rolls. */
  burst(pos, surface, count = 5, scale = 0.7) {
    for (let i = 0; i < count; i++) this.dust(pos, surface, scale);
  }

  update(dt) {
    this.pool.forEachActive((p) => { if (!p.update(dt)) this.pool.release(p); });
  }
}
