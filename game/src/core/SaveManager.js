/**
 * SaveManager — progress persistence in localStorage.
 * Saved: current level index, health, unlocked weapons + ammo, fragments.
 */
const KEY = 'lost-treasure-hunter-save-v1';

export class SaveManager {
  hasSave() {
    try { return localStorage.getItem(KEY) !== null; } catch { return false; }
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {object} data {levelIndex, health, weapons:[{id, ammo, reserve}],
   *                       currentWeapon, fragments}
   */
  save(data) {
    try { localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch { /* storage full/blocked — play on */ }
  }

  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
}
