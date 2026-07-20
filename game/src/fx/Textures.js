/**
 * Textures.js — procedural PBR texture maker (albedo + normal + roughness).
 *
 * Everything is generated on canvases at boot: no downloads, no asset files,
 * but real normal-mapped micro-detail so surfaces catch light like PBR
 * materials should. Swap any entry for loaded ambientCG textures later by
 * returning THREE.TextureLoader results from the same functions.
 */
import * as THREE from 'three';

const SIZE = 256;

// ---- small tileable value-noise + fbm --------------------------------------
// The lattice wraps at `period`, so a texture sampled over 0..period tiles
// seamlessly — otherwise every RepeatWrapping boundary shows up as a crease
// line across the terrain.
function makeNoise(seed = 1) {
  const rand = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const lerp = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
  const value = (x, y, period) => {
    const wrap = (v) => ((v % period) + period) % period;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = wrap(xi), x1 = wrap(xi + 1);
    const y0 = wrap(yi), y1 = wrap(yi + 1);
    return lerp(
      lerp(rand(x0, y0), rand(x1, y0), xf),
      lerp(rand(x0, y1), rand(x1, y1), xf),
      yf
    );
  };
  /** noise(x, y) where x,y span 0..basePeriod across one tile */
  return (x, y, octaves = 4, basePeriod = 0) => {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < octaves; o++) {
      const p = (basePeriod || 1e9) * f;
      sum += value(x * f, y * f, p) * amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum;
  };
}

function canvasTexture(draw, { repeat = 8, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Normal map computed from a height function via central differences. */
function normalFromHeight(heightFn, { repeat = 8, strength = 2.5 } = {}) {
  return canvasTexture((ctx) => {
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // wrap-around sampling keeps the map tileable
        const h = (px, py) => heightFn(((px + SIZE) % SIZE), ((py + SIZE) % SIZE));
        const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
        const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
        const inv = 1 / Math.hypot(dx, dy, 1);
        const i = (y * SIZE + x) * 4;
        img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
        img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
        img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat, srgb: false });
}

function paintNoise(ctx, noise, { base, lo, hi, scale = 12, speckle = 0 }) {
  const img = ctx.createImageData(SIZE, SIZE);
  const b = new THREE.Color(base), l = new THREE.Color(lo), h = new THREE.Color(hi);
  const out = new THREE.Color();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = noise((x / SIZE) * scale, (y / SIZE) * scale, 4, scale);
      out.copy(b).lerp(n < 0.5 ? l : h, Math.abs(n - 0.5) * 2);
      if (speckle && ((x * 31 + y * 17) % 97) / 97 < speckle) out.multiplyScalar(0.75);
      const i = (y * SIZE + x) * 4;
      img.data[i] = out.r * 255;
      img.data[i + 1] = out.g * 255;
      img.data[i + 2] = out.b * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Build a full PBR set {map, normalMap, roughnessMap} from recipe params. */
function pbrSet(seed, albedo, heightScale, repeat, roughRange = [0.75, 1.0]) {
  const noise = makeNoise(seed);
  const map = canvasTexture((ctx) => paintNoise(ctx, noise, albedo), { repeat });
  const normalMap = normalFromHeight(
    (x, y) => noise((x / SIZE) * albedo.scale, (y / SIZE) * albedo.scale, 4, albedo.scale) * heightScale,
    { repeat }
  );
  const roughnessMap = canvasTexture((ctx) => {
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = noise((x / SIZE) * albedo.scale, (y / SIZE) * albedo.scale, 4, albedo.scale);
        const r = (roughRange[0] + n * (roughRange[1] - roughRange[0])) * 255;
        const i = (y * SIZE + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = r;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat, srgb: false });
  return { map, normalMap, roughnessMap };
}

// ---- public texture sets (lazily built, cached) ----------------------------
const cache = {};
export const Tex = {
  grass: () => cache.grass ??= pbrSet(11,
    { base: '#4a6b3a', lo: '#35502a', hi: '#5d8046', scale: 14, speckle: 0.04 }, 22, 40),
  sand: () => cache.sand ??= pbrSet(23,
    { base: '#cfb98a', lo: '#b39c66', hi: '#e2d3a8', scale: 10, speckle: 0.02 }, 14, 34, [0.85, 1.0]),
  dirt: () => cache.dirt ??= pbrSet(31,
    { base: '#5d4a33', lo: '#48371f', hi: '#6f5c40', scale: 12, speckle: 0.05 }, 18, 24),
  bark: () => cache.bark ??= pbrSet(43,
    { base: '#4a3826', lo: '#332618', hi: '#5c4a33', scale: 6, speckle: 0.03 }, 30, 3),
  stone: () => cache.stone ??= pbrSet(57,
    { base: '#77726a', lo: '#5c5850', hi: '#8d887e', scale: 8, speckle: 0.04 }, 26, 4, [0.7, 0.95]),
  planks: () => cache.planks ??= pbrSet(71,
    { base: '#5c4630', lo: '#463322', hi: '#6d563c', scale: 5, speckle: 0.02 }, 22, 3),
  sandstone: () => cache.sandstone ??= pbrSet(83,
    { base: '#c0a97e', lo: '#a08a5e', hi: '#d4c096', scale: 7, speckle: 0.03 }, 20, 4),

  /** RGBA leaf-cluster card for alpha-tested foliage planes. */
  leafCard(tint = '#2e5d34') {
    const key = 'leaf' + tint;
    if (cache[key]) return cache[key];
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    const noise = makeNoise(97);
    const base = new THREE.Color(tint);
    // clumps of overlapping leaf blobs, denser toward the center
    for (let i = 0; i < 420; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.6) * SIZE * 0.44;
      const x = SIZE / 2 + Math.cos(a) * r;
      const y = SIZE / 2 + Math.sin(a) * r * 0.85;
      const s = 5 + Math.random() * 11;
      const shade = 0.65 + noise(x / 40, y / 40) * 0.7;
      ctx.fillStyle = `rgb(${base.r * 255 * shade | 0},${base.g * 255 * shade | 0},${base.b * 255 * shade | 0})`;
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * (0.5 + Math.random() * 0.5), a, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    cache[key] = tex;
    return tex;
  },
};
