/**
 * biomes.js — terrain + procedural prop builders ("scatter kinds").
 *
 * Realism pass: textured noise-displaced terrain, InstancedMesh trees with
 * alpha-tested foliage cards, instanced grass and rocks, PBR-textured ruins,
 * wrecks and docks. Gameplay contracts are unchanged: builders still push
 * LOS/bullet blockers into ctx.blockers, physics colliders into the physics
 * world, and animated props into ctx.updatables.
 *
 * To support a new biome, add a builder here and reference its kind from
 * levels.config.js.
 */
import * as THREE from 'three';
import { Tex } from '../fx/Textures.js';

const rand = (a, b) => a + Math.random() * (b - a);

// deterministic 2D fbm for terrain relief (shared by all levels)
function terrainNoise(x, z) {
  const n = Math.sin(x * 0.043 + z * 0.071) * 0.5
    + Math.sin(x * 0.11 - z * 0.052 + 1.7) * 0.3
    + Math.sin((x + z) * 0.021 + 4.2) * 0.2;
  return n * 0.5 + 0.5; // 0..1
}

/**
 * Textured, gently displaced ground. Bumps rise only (never dip below the
 * y=0 physics plane) and stay < ~0.5 m so collision and enemy grounding
 * remain honest. The normal-mapped texture carries the small-scale detail.
 */
export function buildTerrain(cfg, biome) {
  const span = cfg.size * 2.5;
  const geo = new THREE.PlaneGeometry(span, span, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // smooth ramp above the flat floor — no derivative kink, so vertex
    // normals stay clean (a hard max() here reads as a crack in the ground)
    const t = Math.max(0, (terrainNoise(x, z) - 0.35) / 0.65);
    pos.setY(i, t * t * (3 - 2 * t) * 0.75);
  }
  geo.computeVertexNormals();
  const set = Tex[biome.ground]();
  // the texture already carries the base color — only a light tint on top,
  // otherwise the double multiply over-saturates (mars-red desert syndrome)
  const tint = new THREE.Color(biome.groundTint).lerp(new THREE.Color('#ffffff'), 0.55);
  const mat = new THREE.MeshStandardMaterial({
    color: tint,
    map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    metalness: 0,
  });
  return new THREE.Mesh(geo, mat);
}

/** Scatter helper: random point in the level square, away from excluded spots.
 *  `clearance` widens the exclusion for large props (dunes, wrecks). */
function scatterPoint(ctx, margin = 5, clearance = 0) {
  const half = ctx.size / 2 - margin;
  for (let tries = 0; tries < 30; tries++) {
    const x = rand(-half, half);
    const z = rand(-half, half);
    if (!ctx.exclude(x, z, clearance)) return [x, z];
  }
  return null;
}

/** Shared instanced-mesh scatter: places `count` copies via `place(i, dummy)`. */
function instanced(ctx, geo, mat, count, place, { shadow = true, blocker = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < count; i++) {
    if (place(i, dummy) === false) continue;
    dummy.updateMatrix();
    mesh.setMatrixAt(placed++, dummy.matrix);
  }
  mesh.count = placed;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  if (blocker) ctx.blockers.push(mesh);
  return mesh;
}

export const SCATTER_BUILDERS = {
  // ---- Forest ------------------------------------------------------------
  trees(ctx, opts) {
    const bark = Tex.bark();
    const trunkMat = new THREE.MeshStandardMaterial({
      map: bark.map, normalMap: bark.normalMap, roughnessMap: bark.roughnessMap,
      color: '#8a7355',
    });
    // choose spots first so trunk + canopy + physics agree
    const spots = [];
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx);
      if (!p) continue;
      spots.push({ x: p[0], z: p[1], h: rand(6, 11), r: rand(0.28, 0.5), rot: Math.random() * Math.PI * 2 });
    }
    instanced(ctx,
      new THREE.CylinderGeometry(0.75, 1, 1, 7),
      trunkMat, spots.length,
      (i, d) => {
        const s = spots[i];
        d.position.set(s.x, s.h / 2, s.z);
        d.scale.set(s.r, s.h, s.r);
        d.rotation.set(0, s.rot, 0);
      }, { blocker: true });
    // layered foliage cards — crossed alpha-tested planes read as canopy depth
    const leafTints = ['#2e5d34', '#25502c', '#387042'];
    for (let layer = 0; layer < 3; layer++) {
      const mat = new THREE.MeshStandardMaterial({
        map: Tex.leafCard(leafTints[layer]),
        alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
      });
      instanced(ctx, new THREE.PlaneGeometry(1, 1), mat, spots.length * 2,
        (i, d) => {
          const s = spots[i >> 1];
          const size = rand(3.6, 5.6) * (1 - layer * 0.16);
          d.position.set(
            s.x + rand(-0.5, 0.5),
            s.h * 0.62 + layer * 1.7 + rand(-0.3, 0.3),
            s.z + rand(-0.5, 0.5)
          );
          d.rotation.set(rand(-0.25, 0.25), (i % 2) * Math.PI / 2 + s.rot + layer * 0.7, rand(-0.15, 0.15));
          d.scale.set(size, size * 0.8, 1);
        }, { shadow: layer === 0 }); // only densest layer casts — keeps shadows cheap
    }
    for (const s of spots) ctx.physics.addStaticCylinder([s.x, s.h / 2, s.z], s.r, s.h);
  },

  /** Instanced grass blades — pure ground detail, no collision. */
  grass(ctx, opts) {
    // bent-quad blade: two triangles, tinted per instance
    const geo = new THREE.PlaneGeometry(0.09, 0.55, 1, 2);
    geo.translate(0, 0.27, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { // slight arc
      const y = p.getY(i);
      p.setX(i, p.getX(i) + y * y * 0.35);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: '#517a3d', roughness: 0.95, side: THREE.DoubleSide,
    });
    const half = ctx.size / 2 - 3;
    const mesh = instanced(ctx, geo, mat, opts.count, (i, d) => {
      d.position.set(rand(-half, half), 0, rand(-half, half));
      d.rotation.set(rand(-0.15, 0.15), Math.random() * Math.PI, rand(-0.15, 0.15));
      const s = rand(0.7, 1.6);
      d.scale.set(s, s, s);
    }, { shadow: false });
    // per-instance green variation
    const color = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) {
      color.setHSL(0.26 + Math.random() * 0.05, 0.45, 0.3 + Math.random() * 0.14);
      mesh.setColorAt(i, color);
    }
    mesh.instanceColor.needsUpdate = true;
  },

  rocks(ctx, opts) {
    const stone = Tex.stone();
    const mat = new THREE.MeshStandardMaterial({
      map: stone.map, normalMap: stone.normalMap, roughnessMap: stone.roughnessMap,
      color: '#b8b2a6',
    });
    const spots = [];
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx);
      if (!p) continue;
      spots.push({ x: p[0], z: p[1], s: rand(0.8, 2.4) });
    }
    instanced(ctx, new THREE.DodecahedronGeometry(1, 0), mat, spots.length, (i, d) => {
      const s = spots[i];
      d.position.set(s.x, s.s * 0.4, s.z);
      d.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
      d.scale.setScalar(s.s);
    }, { blocker: true });
    for (const s of spots) ctx.physics.addStaticBox([s.x, s.s * 0.4, s.z], [s.s * 1.4, s.s, s.s * 1.4]);
  },

  /** Fake volumetric god-rays: layered additive translucent shafts along the sun. */
  godrays(ctx, opts) {
    // vertical alpha gradient — bright aloft, dissolving before the ground,
    // so no hard rim where a shaft meets the floor
    const gradCanvas = document.createElement('canvas');
    gradCanvas.width = 4; gradCanvas.height = 128;
    const gctx = gradCanvas.getContext('2d');
    // canvas y=0 maps to texture v=1 (flipY) = the shaft TOP
    const grad = gctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,1)');    // top of shaft
    grad.addColorStop(0.55, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');    // fades out at the ground
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 4, 128);
    const alphaTex = new THREE.CanvasTexture(gradCanvas);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffeebb, transparent: true, opacity: 0.05, alphaMap: alphaTex,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      fog: false,
    });
    const inner = mat.clone();
    inner.opacity = 0.08;
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx, 15);
      if (!p) continue;
      const g = new THREE.Group();
      const r1 = rand(1.5, 3);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(r1 * 1.4, r1 * 2.6, 34, 24, 1, true), mat));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(r1 * 0.7, r1 * 1.4, 34, 24, 1, true), inner));
      g.position.set(p[0], 16, p[1]);
      g.rotation.z = 0.28; // lean along the sun
      g.rotation.y = Math.random() * Math.PI;
      ctx.scene.add(g);
    }
  },

  // ---- Desert ------------------------------------------------------------
  dunes(ctx, opts) {
    const sand = Tex.sand();
    const mat = new THREE.MeshStandardMaterial({
      map: sand.map, normalMap: sand.normalMap, roughnessMap: sand.roughnessMap,
      color: new THREE.Color('#d4ad64').lerp(new THREE.Color('#ffffff'), 0.55),
    });
    for (let i = 0; i < opts.count; i++) {
      const r = rand(10, 20);
      const p = scatterPoint(ctx, 10, r); // keep whole dune clear of key spots
      if (!p) continue;
      const dune = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), mat);
      dune.scale.y = rand(0.05, 0.08); // low rolling mounds, visual only
      dune.position.set(p[0], -r * dune.scale.y * 0.35, p[1]);
      dune.receiveShadow = true;
      ctx.scene.add(dune);
    }
  },

  ruins(ctx, opts) {
    const t = Tex.sandstone();
    const stone = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, color: '#d8c49a',
    });
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx, 8);
      if (!p) continue;
      if (Math.random() < 0.5) {
        const w = rand(4, 9), h = rand(1.5, 3.5);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.8), stone);
        wall.position.set(p[0], h / 2, p[1]);
        wall.rotation.y = Math.random() * Math.PI;
        wall.castShadow = true;
        wall.receiveShadow = true;
        ctx.scene.add(wall);
        ctx.blockers.push(wall);
        const b = ctx.physics.addStaticBox([p[0], h / 2, p[1]], [w, h, 0.8]);
        b.quaternion.setFromEuler(0, wall.rotation.y, 0);
      } else {
        const h = rand(3, 6);
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, h, 12), stone);
        const fallen = Math.random() < 0.3;
        if (fallen) {
          pillar.rotation.z = Math.PI / 2;
          pillar.position.set(p[0], 0.7, p[1]);
        } else {
          pillar.position.set(p[0], h / 2, p[1]);
          ctx.physics.addStaticCylinder([p[0], h / 2, p[1]], 0.7, h);
        }
        pillar.castShadow = true;
        ctx.scene.add(pillar);
        ctx.blockers.push(pillar);
      }
    }
  },

  /** Heat shimmer — just flags the post-processing chain. */
  shimmer(ctx) {
    ctx.flags.shimmer = true;
  },

  // ---- Sea / Coast -------------------------------------------------------
  /** Animated water sheet with vertex waves + crest sparkle. */
  water(ctx) {
    const geo = new THREE.PlaneGeometry(ctx.size * 2, ctx.size, 60, 40);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uColorDeep: { value: new THREE.Color(0x0e3742) },
        uColorShallow: { value: new THREE.Color(0x3d8b96) },
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        varying float vWave;
        void main() {
          vec3 p = position;
          float w = sin(p.x * 0.15 + uTime * 1.2) * 0.35
                  + sin(p.y * 0.2 + uTime * 0.8) * 0.25
                  + sin((p.x + p.y) * 0.08 + uTime * 1.7) * 0.2;
          p.z += w;
          vWave = w;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColorDeep;
        uniform vec3 uColorShallow;
        varying float vWave;
        void main() {
          vec3 c = mix(uColorDeep, uColorShallow, vWave * 0.6 + 0.5);
          c += smoothstep(0.55, 0.8, vWave) * vec3(0.35);
          gl_FragColor = vec4(c, 0.88);
        }`,
    });
    const sheet = new THREE.Mesh(geo, mat);
    sheet.rotation.x = -Math.PI / 2;
    // water starts past the shoreline (z ≈ -size/5) and runs to the horizon,
    // leaving the combat arena on dry sand
    sheet.position.set(0, 0.25, -ctx.size / 5 - ctx.size / 2);
    ctx.scene.add(sheet);
    ctx.updatables.push((dt) => { mat.uniforms.uTime.value += dt; });
  },

  shipwrecks(ctx, opts) {
    const planks = Tex.planks();
    const hullMat = new THREE.MeshStandardMaterial({
      map: planks.map, normalMap: planks.normalMap, roughnessMap: planks.roughnessMap, color: '#7a6248',
    });
    const rotMat = new THREE.MeshStandardMaterial({ color: 0x354143, roughness: 0.9, metalness: 0.3 });
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx, 12, 8);
      if (!p) continue;
      const wreck = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(rand(8, 14), rand(2.5, 4), rand(3, 4.5)), hullMat);
      hull.position.y = 1;
      hull.rotation.z = rand(-0.35, 0.35); // beached list
      hull.castShadow = true;
      wreck.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, rand(6, 10), 6), rotMat);
      mast.position.set(rand(-3, 3), 4, 0);
      mast.rotation.z = rand(-0.5, 0.5);
      wreck.add(mast);
      wreck.position.set(p[0], 0, p[1]);
      wreck.rotation.y = Math.random() * Math.PI * 2;
      ctx.scene.add(wreck);
      ctx.blockers.push(hull);
      ctx.physics.addStaticBox([p[0], 1.5, p[1]], [9, 3, 4]);
    }
  },

  /**
   * Dock platforming: a deterministic line of planks with jumpable gaps,
   * running from the shore out over the water. Level configs can place
   * reward pickups on the far platform (see the sea level's dock pickups).
   */
  docks(ctx) {
    const planks = Tex.planks();
    const plankMat = new THREE.MeshStandardMaterial({
      map: planks.map, normalMap: planks.normalMap, roughnessMap: planks.roughnessMap, color: '#8a6f50',
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3f2f20, roughness: 0.95 });
    const x = 14, w = 4, d = 4, y = 1.0, gap = 2;
    for (let i = 0; i < 8; i++) {
      const z = -18 - i * (d + gap);
      const last = i === 7;
      const pw = last ? 6 : w, pd = last ? 6 : d; // wider end platform for the reward
      const plank = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.3, pd), plankMat);
      plank.position.set(x, y, z);
      plank.castShadow = true;
      plank.receiveShadow = true;
      ctx.scene.add(plank);
      ctx.blockers.push(plank);
      ctx.physics.addStaticBox([x, y, z], [pw, 0.3, pd]);
      ctx.groundMeshes.push(plank); // player jump ground-check
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, y, 6), postMat);
        post.position.set(x + sx * (pw / 2 - 0.2), y / 2, z + sz * (pd / 2 - 0.2));
        ctx.scene.add(post);
      }
    }
  },
};
