/**
 * Menus — main / pause / level-complete / game-over / victory screens.
 * Pure DOM overlays; GameManager drives which one is visible and receives
 * button events via the callbacks map passed to the constructor.
 */
import { THEME } from '../config/theme.config.js';
import { TOTAL_FRAGMENTS } from '../config/levels.config.js';

const C = THEME.colors;

export class Menus {
  /**
   * @param {HTMLElement} uiRoot
   * @param {object} on {newGame, continueGame, resume, restart, quitToMenu, nextLevel, retry}
   */
  constructor(uiRoot, on) {
    this.on = on;
    this.root = document.createElement('div');
    this.root.id = 'menus';
    this.root.innerHTML = `
      <style>
        #menus .screen { position:absolute; inset:0; display:none; flex-direction:column;
                         align-items:center; justify-content:center; text-align:center;
                         background:radial-gradient(ellipse at center, rgba(10,18,14,.82), rgba(4,8,6,.95)); }
        #menus .screen.visible { display:flex; }
        #menus h1 { font-size:52px; letter-spacing:6px; color:${C.uiWarm};
                    text-shadow:0 0 24px rgba(232,182,76,.5), 0 3px 6px #000; margin-bottom:6px; }
        #menus h2 { font-size:34px; letter-spacing:4px; color:${C.uiWarm}; text-shadow:0 2px 6px #000; }
        #menus .sub { color:${C.uiCool}; letter-spacing:2px; margin-bottom:36px; font-size:15px; }
        #menus button { pointer-events:auto; display:block; width:260px; margin:9px auto; padding:13px 0;
                        font-size:16px; letter-spacing:2px; font-family:inherit; cursor:pointer;
                        color:${C.uiText}; background:rgba(232,182,76,.08);
                        border:1px solid ${C.uiWarm}; border-radius:4px; transition:all .15s; }
        #menus button:hover { background:rgba(232,182,76,.28); box-shadow:0 0 14px rgba(232,182,76,.35); }
        #menus button:disabled { opacity:.35; cursor:default; }
        #menus .controls { margin-top:34px; color:#9db; font-size:13px; line-height:1.9; }
        #menus .controls b { color:${C.uiWarm}; }
        #menus .stats { color:#cdb; font-size:16px; line-height:2; margin-bottom:24px; }
        #menus .gameover h2 { color:${C.uiHot}; text-shadow:0 0 20px rgba(255,85,51,.6); }
        #menus .treasure { font-size:70px; margin-bottom:10px; filter:drop-shadow(0 0 18px ${C.uiWarm}); }
      </style>

      <div class="screen" id="screen-main">
        <h1>LOST TREASURE HUNTER</h1>
        <div class="sub">THREE BIOMES · THREE GUARDIANS · ONE LEGENDARY TREASURE</div>
        <button id="btn-start">NEW EXPEDITION</button>
        <button id="btn-continue">CONTINUE</button>
        <div class="controls">
          <b>WASD</b> move &nbsp; <b>Mouse</b> look &nbsp; <b>LMB</b> fire &nbsp; <b>RMB</b> aim<br>
          <b>Shift</b> sprint &nbsp; <b>Space</b> jump &nbsp; <b>Ctrl</b> dodge-roll &nbsp; <b>R</b> reload &nbsp; <b>1-3</b> weapons &nbsp; <b>Esc</b> pause
        </div>
      </div>

      <div class="screen" id="screen-pause">
        <h2>PAUSED</h2>
        <div class="sub" id="pause-level"></div>
        <button id="btn-resume">RESUME</button>
        <button id="btn-restart">RESTART LEVEL</button>
        <button id="btn-quit">QUIT TO MENU</button>
      </div>

      <div class="screen" id="screen-complete">
        <h2>AREA CLEARED</h2>
        <div class="stats" id="complete-stats"></div>
        <button id="btn-next">NEXT AREA</button>
        <button id="btn-quit2">QUIT TO MENU</button>
      </div>

      <div class="screen gameover" id="screen-gameover">
        <h2>EXPEDITION FAILED</h2>
        <div class="sub">The mechs guard their treasure still…</div>
        <button id="btn-retry">RETRY LEVEL</button>
        <button id="btn-quit3">QUIT TO MENU</button>
      </div>

      <div class="screen" id="screen-victory">
        <div class="treasure">🏆</div>
        <h2>THE LEGENDARY TREASURE IS YOURS</h2>
        <div class="stats" id="victory-stats"></div>
        <button id="btn-menu-victory">RETURN TO MENU</button>
      </div>
    `;
    uiRoot.appendChild(this.root);
    const q = (id) => this.root.querySelector('#' + id);
    q('btn-start').onclick = () => on.newGame();
    q('btn-continue').onclick = () => on.continueGame();
    q('btn-resume').onclick = () => on.resume();
    q('btn-restart').onclick = () => on.restart();
    q('btn-next').onclick = () => on.nextLevel();
    q('btn-retry').onclick = () => on.retry();
    for (const id of ['btn-quit', 'btn-quit2', 'btn-quit3']) q(id).onclick = () => on.quitToMenu();
    q('btn-menu-victory').onclick = () => on.quitToMenu();
    this.$ = q;
  }

  showOnly(name) {
    for (const s of this.root.querySelectorAll('.screen')) s.classList.remove('visible');
    if (name) this.$('screen-' + name).classList.add('visible');
  }

  showMain(hasSave) {
    this.$('btn-continue').disabled = !hasSave;
    this.showOnly('main');
  }
  showPause(levelName) {
    this.$('pause-level').textContent = levelName.toUpperCase();
    this.showOnly('pause');
  }
  showComplete({ levelName, fragments, score, isLast }) {
    this.$('complete-stats').innerHTML =
      `${levelName} secured<br>💠 Fragments: ${fragments} / ${TOTAL_FRAGMENTS}<br>Score: ${score}`;
    this.$('btn-next').textContent = isLast ? 'CLAIM THE TREASURE' : 'NEXT AREA';
    this.showOnly('complete');
  }
  showGameOver() { this.showOnly('gameover'); }
  showVictory({ score }) {
    this.$('victory-stats').innerHTML =
      `All ${TOTAL_FRAGMENTS} fragments united reveal the lost hoard.<br>Final score: ${score}`;
    this.showOnly('victory');
  }
  hideAll() { this.showOnly(null); }
}
