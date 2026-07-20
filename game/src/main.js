/**
 * main.js — entry point. Boots the renderer and the game loop.
 * Step 1 scaffold: renderer + scene + flat test ground + orbit-ish camera.
 * (Replaced by GameManager wiring in later steps.)
 */
import * as THREE from 'three';
import { THEME } from './config/theme.config.js';

const app = document.getElementById('app');

// ---- Renderer --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
app.prepend(renderer.domElement);

// ---- Scene: forest-atmosphere test ground ---------------------------------
const biome = THEME.biomes.forest;
const scene = new THREE.Scene();
scene.background = new THREE.Color(biome.sky);
scene.fog = new THREE.Fog(biome.fogColor, biome.fogNear, biome.fogFar);

const sun = new THREE.DirectionalLight(biome.sunColor, biome.sunIntensity);
sun.position.set(...biome.sunPos);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(new THREE.HemisphereLight(biome.hemiSky, biome.hemiGround, biome.hemiIntensity));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: biome.groundColor, ...THEME.materials.ground })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Reference cube so motion/light are visible
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshStandardMaterial({ color: THEME.colors.playerGold, ...THEME.materials.playerArmor })
);
cube.position.y = 1;
cube.castShadow = true;
scene.add(cube);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(6, 4, 8);
camera.lookAt(0, 1, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Loop ------------------------------------------------------------------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  cube.rotation.y += dt * 0.8;
  renderer.render(scene, camera);
});
