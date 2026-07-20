/**
 * AudioManager — Howler-based sound with zero audio assets.
 *
 * All SFX are synthesized at boot into tiny WAV data-URIs (noise bursts,
 * chirps, chords) and handed to Howler, so the game ships silent-asset-free
 * but still routes everything through Howler's spatial audio. To swap in
 * real sounds later, replace the synth entries in SOUND_DEFS with file URLs.
 */
import { Howl, Howler } from 'howler';
import { Vector3 } from 'three';

// ---- tiny PCM synth -> WAV data URI ---------------------------------------
function synthWav({ duration = 0.2, sampleRate = 22050, gen }) {
  const n = Math.floor(duration * sampleRate);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = gen(i / sampleRate, i / n);
  // 16-bit PCM WAV
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:audio/wav;base64,' + btoa(bin);
}

const noise = () => Math.random() * 2 - 1;
const env = (p, k = 6) => Math.exp(-p * k);

const SOUND_DEFS = {
  pistol:  { duration: 0.16, gen: (t, p) => noise() * env(p, 9) * 0.9 + Math.sin(t * 2 * Math.PI * 220) * env(p, 14) * 0.4 },
  rifle:   { duration: 0.12, gen: (t, p) => noise() * env(p, 11) * 0.85 + Math.sin(t * 2 * Math.PI * 320) * env(p, 16) * 0.3 },
  shotgun: { duration: 0.3,  gen: (t, p) => noise() * env(p, 5) * 1.0 + Math.sin(t * 2 * Math.PI * 110) * env(p, 8) * 0.5 },
  enemyShot: { duration: 0.18, gen: (t, p) => Math.sin(t * 2 * Math.PI * (900 - p * 600)) * env(p, 7) * 0.6 + noise() * env(p, 10) * 0.2 },
  hit:     { duration: 0.08, gen: (t, p) => Math.sin(t * 2 * Math.PI * 1200) * env(p, 18) * 0.5 },
  coreHit: { duration: 0.14, gen: (t, p) => Math.sin(t * 2 * Math.PI * (1500 + p * 500)) * env(p, 10) * 0.6 },
  hurt:    { duration: 0.25, gen: (t, p) => Math.sin(t * 2 * Math.PI * (160 - p * 60)) * env(p, 6) * 0.7 },
  reload:  { duration: 0.25, gen: (t, p) => (p > 0.6 ? noise() * env((p - 0.6) / 0.4, 8) * 0.5 : Math.sin(t * 2 * Math.PI * 500) * env(p, 20) * 0.3) },
  pickup:  { duration: 0.35, gen: (t, p) => (Math.sin(t * 2 * Math.PI * 660) + Math.sin(t * 2 * Math.PI * 880) * (p > 0.4 ? 1 : 0)) * env(p, 4) * 0.35 },
  fragment:{ duration: 0.8,  gen: (t, p) => (Math.sin(t * 2 * Math.PI * 523) + Math.sin(t * 2 * Math.PI * 659) + Math.sin(t * 2 * Math.PI * 784) * (p > 0.3 ? 1 : 0)) * env(p, 2.5) * 0.28 },
  roll:    { duration: 0.2,  gen: (t, p) => noise() * env(p, 6) * 0.25 * (1 - p) },
  jump:    { duration: 0.15, gen: (t, p) => Math.sin(t * 2 * Math.PI * (300 + p * 200)) * env(p, 8) * 0.3 },
  bossRoar:{ duration: 0.9,  gen: (t, p) => (Math.sin(t * 2 * Math.PI * (80 + Math.sin(t * 30) * 20)) * 0.7 + noise() * 0.3) * env(p, 2) * 0.8 },
  explode: { duration: 0.6,  gen: (t, p) => noise() * env(p, 3.5) * 0.9 + Math.sin(t * 2 * Math.PI * 60) * env(p, 4) * 0.6 },
  portal:  { duration: 1.0,  gen: (t, p) => Math.sin(t * 2 * Math.PI * (200 + p * 700)) * env(p, 2) * 0.3 },
  click:   { duration: 0.05, gen: (t, p) => Math.sin(t * 2 * Math.PI * 900) * env(p, 25) * 0.4 },
  // footsteps — soft filtered thuds per surface, kept quiet under the mix
  stepGrass: { duration: 0.09, gen: (t, p) => (noise() * 0.4 + Math.sin(t * 2 * Math.PI * 95) * 0.6) * env(p, 22) * 0.28 },
  stepSand:  { duration: 0.12, gen: (t, p) => noise() * env(p, 16) * 0.2 },
  stepWood:  { duration: 0.08, gen: (t, p) => (Math.sin(t * 2 * Math.PI * 160) * 0.7 + noise() * 0.3) * env(p, 26) * 0.34 },
  land:    { duration: 0.22, gen: (t, p) => (Math.sin(t * 2 * Math.PI * 70) * 0.7 + noise() * 0.35) * env(p, 9) * 0.6 },
};

export class AudioManager {
  constructor() {
    this.sounds = {};
    this.muted = false;
    for (const [name, def] of Object.entries(SOUND_DEFS)) {
      this.sounds[name] = new Howl({ src: [synthWav(def)], format: ['wav'], volume: 0.5 });
    }
    Howler.volume(0.7);
  }

  /** Non-positional (player's own actions, UI). */
  play(name, volume = 1) {
    if (this.muted) return;
    const s = this.sounds[name];
    if (!s) return;
    const id = s.play();
    s.volume(0.5 * volume, id);
    s.pos(0, 0, 0, id);
  }

  /** Positional, relative to the listener (player). */
  playAt(name, pos, volume = 1) {
    if (this.muted) return;
    const s = this.sounds[name];
    if (!s) return;
    const id = s.play();
    s.volume(0.5 * volume, id);
    s.pos(pos.x, pos.y, pos.z, id);
    s.pannerAttr({ refDistance: 6, rolloffFactor: 1.2, distanceModel: 'inverse' }, id);
  }

  /** Keep Howler's listener glued to the camera. */
  updateListener(camera) {
    const p = camera.position;
    Howler.pos(p.x, p.y, p.z);
    const fwd = camera.getWorldDirection(this._fwd ||= new Vector3());
    Howler.orientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
  }

  setMuted(m) { this.muted = m; Howler.mute(m); }
}
