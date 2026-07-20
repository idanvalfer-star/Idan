/**
 * biomes.js — procedural prop builders ("scatter kinds") used by Level.
 *
 * Each builder receives (ctx, opts) where ctx = {scene, physics, size,
 * exclude(p, r), blockers, updatables} and adds meshes + static physics.
 * To support a new biome, add a builder here and reference its kind from
 * levels.config.js. Builders push LOS/bullet blockers into ctx.blockers
 * and per-frame animated objects into ctx.updatables.
 */
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

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

export const SCATTER_BUILDERS = {
  // ---- Forest ------------------------------------------------------------
  trees(ctx, opts) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 });
    const canopyMats = [0x2e5d34, 0x25502c, 0x387042].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })
    );
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx);
      if (!p) continue;
      const h = rand(6, 11);
      const r = rand(0.25, 0.5);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 7), trunkMat);
      trunk.position.y = h / 2;
      trunk.castShadow = true;
      tree.add(trunk);
      // layered cones read as dense canopy
      const layers = 2 + Math.floor(Math.random() * 2);
      for (let l = 0; l < layers; l++) {
        const cr = rand(1.8, 3) * (1 - l * 0.25);
        const canopy = new THREE.Mesh(
          new THREE.ConeGeometry(cr, rand(2.5, 4), 8),
          canopyMats[Math.floor(Math.random() * canopyMats.length)]
        );
        canopy.position.y = h * 0.65 + l * 1.8;
        canopy.castShadow = true;
        tree.add(canopy);
      }
      tree.position.set(p[0], 0, p[1]);
      ctx.scene.add(tree);
      ctx.blockers.push(trunk);
      ctx.physics.addStaticCylinder([p[0], h / 2, p[1]], r, h);
    }
  },

  rocks(ctx, opts) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.95 });
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx);
      if (!p) continue;
      const s = rand(0.8, 2.4);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
      rock.position.set(p[0], s * 0.4, p[1]);
      rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
      rock.castShadow = true;
      rock.receiveShadow = true;
      ctx.scene.add(rock);
      ctx.blockers.push(rock);
      ctx.physics.addStaticBox([p[0], s * 0.4, p[1]], [s * 1.4, s, s * 1.4]);
    }
  },

  /** Fake volumetric god-rays: tilted additive translucent shafts. */
  godrays(ctx, opts) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffeebb, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx, 15);
      if (!p) continue;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rand(1.5, 3), rand(3, 6), 30, 8, 1, true), mat);
      shaft.position.set(p[0], 15, p[1]);
      shaft.rotation.z = 0.25; // lean along the sun
      ctx.scene.add(shaft);
    }
  },

  // ---- Desert ------------------------------------------------------------
  dunes(ctx, opts) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4ad64, roughness: 1 });
    for (let i = 0; i < opts.count; i++) {
      const r = rand(10, 20);
      const p = scatterPoint(ctx, 10, r); // keep whole dune clear of key spots
      if (!p) continue;
      const dune = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), mat);
      dune.scale.y = rand(0.05, 0.08); // low rolling mounds, visual only
      dune.position.set(p[0], -r * dune.scale.y * 0.35, p[1]);
      dune.receiveShadow = true;
      ctx.scene.add(dune);
    }
  },

  ruins(ctx, opts) {
    const stone = new THREE.MeshStandardMaterial({ color: 0xc0a97e, roughness: 0.9 });
    for (let i = 0; i < opts.count; i++) {
      const p = scatterPoint(ctx, 8);
      if (!p) continue;
      if (Math.random() < 0.5) {
        // broken wall
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
        // pillar (sometimes toppled)
        const h = rand(3, 6);
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, h, 10), stone);
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
  /** Animated water sheet with simple vertex waves + fresnel-ish tint. */
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
        varying vec3 vPos;
        void main() {
          vec3 p = position;
          float w = sin(p.x * 0.15 + uTime * 1.2) * 0.35
                  + sin(p.y * 0.2 + uTime * 0.8) * 0.25
                  + sin((p.x + p.y) * 0.08 + uTime * 1.7) * 0.2;
          p.z += w;
          vWave = w;
          vPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColorDeep;
        uniform vec3 uColorShallow;
        varying float vWave;
        void main() {
          vec3 c = mix(uColorDeep, uColorShallow, vWave * 0.6 + 0.5);
          // sparkle crests
          c += smoothstep(0.55, 0.8, vWave) * vec3(0.35);
          gl_FragColor = vec4(c, 0.88);
        }`,
    });
    const sheet = new THREE.Mesh(geo, mat);
    sheet.rotation.x = -Math.PI / 2;
    // water occupies the far half of the map (beyond the shore line)
    sheet.position.set(0, 0.25, -ctx.size * 0.55);
    ctx.scene.add(sheet);
    ctx.updatables.push((dt) => { mat.uniforms.uTime.value += dt; });
  },

  shipwrecks(ctx, opts) {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 });
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

  /** Dock platforming: raised planks with gaps, jumping path over the shallows. */
  docks(ctx) {
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 0.9 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3f2f20, roughness: 0.95 });
    let z = -18;
    let x = 14;
    for (let i = 0; i < 8; i++) {
      const w = rand(3, 4.5), d = rand(3, 4.5);
      const y = 1.2 + (i % 3) * 0.4; // slight height variation
      const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), plankMat);
      plank.position.set(x, y, z);
      plank.castShadow = true;
      plank.receiveShadow = true;
      ctx.scene.add(plank);
      ctx.blockers.push(plank);
      ctx.physics.addStaticBox([x, y, z], [w, 0.3, d]);
      ctx.groundMeshes.push(plank); // player jump ground-check
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, y, 6), postMat);
        post.position.set(x + sx * (w / 2 - 0.2), y / 2, z + sz * (d / 2 - 0.2));
        ctx.scene.add(post);
      }
      z -= d + rand(1.6, 2.4); // the gap you jump
      x += rand(-2, 2);
    }
  },
};
