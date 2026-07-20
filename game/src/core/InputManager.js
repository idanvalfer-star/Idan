/**
 * InputManager — keyboard + mouse with pointer lock.
 *
 * Exposes:
 *   held state    : isDown('KeyW'), actions like .sprint/.aim/.fire
 *   edge events   : justPressed('Space') — true for exactly one frame
 *   mouse deltas  : .mouseDX/.mouseDY accumulated since last endFrame()
 *
 * GameManager calls endFrame() once per tick to clear per-frame state.
 */
export class InputManager {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressed = new Set();     // cleared each frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = [false, false, false];
    this.mouseJust = [false, false, false];
    this.pointerLocked = false;
    this.enabled = true;          // menus disable game input
    this.onPointerLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      // Keep the browser from scrolling / triggering shortcuts mid-game
      if (this.pointerLocked && ['Space', 'ControlLeft', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = [false, false, false]; });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDown[e.button] = true;
      this.mouseJust[e.button] = true;
    });
    document.addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    document.addEventListener('contextmenu', (e) => { if (this.pointerLocked) e.preventDefault(); });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (this.onPointerLockChange) this.onPointerLockChange(this.pointerLocked);
    });
  }

  requestPointerLock() {
    if (!this.pointerLocked) this.dom.requestPointerLock();
  }
  exitPointerLock() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  isDown(code) { return this.enabled && this.keys.has(code); }
  justPressed(code) { return this.enabled && this.pressed.has(code); }

  // Action mapping (kept in one place so rebinding is trivial)
  get forward() { return this.isDown('KeyW') || this.isDown('ArrowUp'); }
  get back()    { return this.isDown('KeyS') || this.isDown('ArrowDown'); }
  get left()    { return this.isDown('KeyA') || this.isDown('ArrowLeft'); }
  get right()   { return this.isDown('KeyD') || this.isDown('ArrowRight'); }
  get sprint()  { return this.isDown('ShiftLeft') || this.isDown('ShiftRight'); }
  get jump()    { return this.justPressed('Space'); }
  get dodge()   { return this.justPressed('ControlLeft') || this.justPressed('ControlRight'); }
  get reload()  { return this.justPressed('KeyR'); }
  get interact(){ return this.justPressed('KeyE'); }
  get pause()   { return this.pressed.has('Escape'); } // deliberately ignores `enabled`
  get fire()    { return this.enabled && this.mouseDown[0]; }
  get fireJust(){ return this.enabled && this.mouseJust[0]; }
  get aim()     { return this.enabled && this.mouseDown[2]; }
  weaponSlot()  {
    if (this.justPressed('Digit1')) return 0;
    if (this.justPressed('Digit2')) return 1;
    if (this.justPressed('Digit3')) return 2;
    return -1;
  }

  /** Call once per frame after all systems have read input. */
  endFrame() {
    this.pressed.clear();
    this.mouseJust = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
