/**
 * HUD — DOM overlay: health/stamina bars, ammo, fragment counter, crosshair,
 * hit markers, floating damage numbers (world→screen projected), boss bar
 * with phase pips, objective tracker, damage vignette.
 */
import * as THREE from 'three';
import { THEME } from '../config/theme.config.js';
import { TOTAL_FRAGMENTS } from '../config/levels.config.js';

const C = THEME.colors;

export class HUD {
  constructor(uiRoot, camera) {
    this.camera = camera;
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <style>
        #hud { position:absolute; inset:0; font-family:inherit; user-select:none; }
        #hud .bars { position:absolute; left:24px; bottom:24px; width:260px; }
        #hud .bar { height:14px; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.25);
                    border-radius:7px; overflow:hidden; margin-top:6px; }
        #hud .bar > div { height:100%; transition:width .15s; border-radius:6px; }
        #hud #health-fill { background:linear-gradient(90deg,#c0392b,#e67e22); width:100%; }
        #hud #stamina-fill { background:linear-gradient(90deg,#16a085,#7fd4c1); width:100%; }
        #hud .ammo { position:absolute; right:28px; bottom:24px; text-align:right;
                     text-shadow:0 2px 4px rgba(0,0,0,.8); }
        #hud .ammo .mag { font-size:38px; font-weight:700; color:${C.uiWarm}; }
        #hud .ammo .reserve { font-size:20px; color:#bbb; }
        #hud .ammo .wname { font-size:13px; color:#ddd; letter-spacing:1px; text-transform:uppercase; }
        #hud .ammo .reloading { color:${C.uiHot}; font-size:13px; height:16px; }
        #hud .frags { position:absolute; top:20px; right:28px; font-size:18px; color:${C.uiWarm};
                      text-shadow:0 2px 4px rgba(0,0,0,.8); }
        #hud .objective { position:absolute; top:20px; left:24px; max-width:340px; padding:10px 14px;
                          background:rgba(0,0,0,.4); border-left:3px solid ${C.uiWarm}; border-radius:4px;
                          font-size:14px; color:#eee; }
        #hud .objective .head { color:${C.uiWarm}; font-size:11px; letter-spacing:2px; margin-bottom:3px; }
        #hud .wave { position:absolute; top:90px; left:50%; transform:translateX(-50%);
                     font-size:26px; color:${C.uiCool}; text-shadow:0 2px 6px rgba(0,0,0,.9);
                     opacity:0; transition:opacity .4s; letter-spacing:3px; }
        #hud .crosshair { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
                          width:24px; height:24px; }
        #hud .crosshair span { position:absolute; background:#fff; opacity:.85;
                               box-shadow:0 0 3px rgba(0,0,0,.9); }
        #hud .crosshair .h { width:8px; height:2px; top:11px; }
        #hud .crosshair .v { width:2px; height:8px; left:11px; }
        #hud .crosshair.aim span { background:${C.uiWarm}; }
        #hud .hitmarker { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) rotate(45deg);
                          width:26px; height:26px; opacity:0; pointer-events:none; }
        #hud .hitmarker span { position:absolute; background:${C.uiWarm}; }
        #hud .hitmarker.core span { background:${C.uiHot}; }
        #hud .hitmarker .a { width:9px; height:2px; top:12px; left:0; }
        #hud .hitmarker .b { width:9px; height:2px; top:12px; right:0; }
        #hud .hitmarker .c { width:2px; height:9px; left:12px; top:0; }
        #hud .hitmarker .d { width:2px; height:9px; left:12px; bottom:0; }
        #hud .dmgnum { position:absolute; font-weight:700; font-size:16px; color:#fff;
                       text-shadow:0 2px 3px rgba(0,0,0,.9); pointer-events:none;
                       transition:transform .7s ease-out, opacity .7s; }
        #hud .dmgnum.core { color:${C.uiHot}; font-size:20px; }
        #hud .bossbar { position:absolute; top:46px; left:50%; transform:translateX(-50%);
                        width:min(560px,60vw); display:none; }
        #hud .bossbar .bname { text-align:center; font-size:15px; letter-spacing:3px; color:${C.uiHot};
                               text-shadow:0 2px 4px #000; margin-bottom:4px; text-transform:uppercase; }
        #hud .bossbar .bbar { height:16px; background:rgba(0,0,0,.55); border:1px solid ${C.uiHot};
                              border-radius:8px; overflow:hidden; }
        #hud .bossbar .bfill { height:100%; width:100%;
                               background:linear-gradient(90deg,#8e1b0d,${C.uiHot}); transition:width .2s; }
        #hud .bossbar .pips { display:flex; gap:6px; justify-content:center; margin-top:5px; }
        #hud .bossbar .pip { width:34px; height:5px; border-radius:3px; background:rgba(255,255,255,.25); }
        #hud .bossbar .pip.active { background:${C.uiHot}; box-shadow:0 0 6px ${C.uiHot}; }
        #hud .vignette { position:absolute; inset:0; pointer-events:none;
                         background:radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${THEME.post.vignette}) 100%); }
        #hud .painflash { position:absolute; inset:0; pointer-events:none; opacity:0;
                          background:radial-gradient(ellipse at center, transparent 40%, rgba(200,30,10,.55) 100%);
                          transition:opacity .35s; }
        #hud .toast { position:absolute; bottom:120px; left:50%; transform:translateX(-50%);
                      font-size:18px; color:${C.uiWarm}; text-shadow:0 2px 5px #000; opacity:0;
                      transition:opacity .4s; letter-spacing:1px; }
      </style>
      <div class="vignette"></div>
      <div class="painflash" id="painflash"></div>
      <div class="objective"><div class="head">OBJECTIVE</div><div id="objective-text">—</div></div>
      <div class="wave" id="wave-banner"></div>
      <div class="frags" id="frags">💠 0 / ${TOTAL_FRAGMENTS}</div>
      <div class="bossbar" id="bossbar">
        <div class="bname" id="boss-name"></div>
        <div class="bbar"><div class="bfill" id="boss-fill"></div></div>
        <div class="pips" id="boss-pips"></div>
      </div>
      <div class="crosshair" id="crosshair"><span class="h" style="left:0"></span><span class="h" style="right:0"></span><span class="v" style="top:0"></span><span class="v" style="bottom:0"></span></div>
      <div class="hitmarker" id="hitmarker"><span class="a"></span><span class="b"></span><span class="c"></span><span class="d"></span></div>
      <div class="bars">
        <div class="bar"><div id="health-fill"></div></div>
        <div class="bar"><div id="stamina-fill"></div></div>
      </div>
      <div class="ammo">
        <div class="wname" id="weapon-name">Scout Pistol</div>
        <div><span class="mag" id="ammo-mag">12</span> <span class="reserve" id="ammo-reserve">/ 60</span></div>
        <div class="reloading" id="reload-hint"></div>
      </div>
      <div class="toast" id="toast"></div>
    `;
    uiRoot.appendChild(this.root);
    this.$ = (id) => this.root.querySelector('#' + id);
    this.hitTimer = 0;
    this.dmgNums = [];
    this._proj = new THREE.Vector3();
    this.hide();
  }

  show() { this.root.style.display = 'block'; }
  hide() { this.root.style.display = 'none'; }

  update(dt, player, arsenal) {
    this.$('health-fill').style.width = `${(player.health / player.maxHealth) * 100}%`;
    this.$('stamina-fill').style.width = `${(player.stamina / player.maxStamina) * 100}%`;
    this.$('crosshair').classList.toggle('aim', player.aiming);
    const w = arsenal.current;
    this.$('reload-hint').textContent = w.reloading ? 'RELOADING…' : (w.mag === 0 && w.reserve === 0 ? 'OUT OF AMMO' : '');

    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.$('hitmarker').style.opacity = 0;
    }
    // sweep expired damage numbers
    const now = performance.now();
    this.dmgNums = this.dmgNums.filter((n) => {
      if (now - n.born > 750) { n.el.remove(); return false; }
      return true;
    });
  }

  refreshAmmo(weapon) {
    this.$('weapon-name').textContent = weapon.cfg.name;
    this.$('ammo-mag').textContent = weapon.mag;
    this.$('ammo-reserve').textContent = `/ ${weapon.reserve}`;
  }

  setFragments(n) { this.$('frags').textContent = `💠 ${n} / ${TOTAL_FRAGMENTS}`; }

  setObjective(text) { this.$('objective-text').textContent = text; }

  showWaveBanner(text) {
    const el = this.$('wave-banner');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(this._waveTO);
    this._waveTO = setTimeout(() => { el.style.opacity = 0; }, 2200);
  }

  toast(text) {
    const el = this.$('toast');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(this._toastTO);
    this._toastTO = setTimeout(() => { el.style.opacity = 0; }, 2600);
  }

  /** Hit marker + floating damage number at the world-space hit point. */
  showHit(damage, isCore, worldPoint) {
    const hm = this.$('hitmarker');
    hm.classList.toggle('core', isCore);
    hm.style.opacity = 1;
    this.hitTimer = 0.18;

    const el = document.createElement('div');
    el.className = 'dmgnum' + (isCore ? ' core' : '');
    el.textContent = isCore ? `${damage}!` : damage;
    this._proj.copy(worldPoint).project(this.camera);
    if (this._proj.z < 1) {
      const x = (this._proj.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-this._proj.y * 0.5 + 0.5) * window.innerHeight;
      el.style.left = `${x + (Math.random() - 0.5) * 30}px`;
      el.style.top = `${y - 10}px`;
      this.root.appendChild(el);
      requestAnimationFrame(() => {
        el.style.transform = `translateY(-${40 + Math.random() * 20}px)`;
        el.style.opacity = 0;
      });
      this.dmgNums.push({ el, born: performance.now() });
    }
  }

  flashPain() {
    const el = this.$('painflash');
    el.style.opacity = 1;
    clearTimeout(this._painTO);
    this._painTO = setTimeout(() => { el.style.opacity = 0; }, 180);
  }

  // ---- boss bar ----
  showBoss(boss) {
    this.$('bossbar').style.display = 'block';
    this.$('boss-name').textContent = boss.bossCfg.name;
    const pips = this.$('boss-pips');
    pips.innerHTML = '';
    for (let i = 0; i < boss.phases.length; i++) {
      const pip = document.createElement('div');
      pip.className = 'pip' + (i === 0 ? ' active' : '');
      pips.appendChild(pip);
    }
    this.bossRef = boss;
  }

  setBossPhase(i) {
    const pips = [...this.$('boss-pips').children];
    pips.forEach((p, idx) => p.classList.toggle('active', idx === i));
    this.showWaveBanner(`PHASE ${i + 1}`);
  }

  updateBoss() {
    if (!this.bossRef) return;
    this.$('boss-fill').style.width = `${Math.max(0, (this.bossRef.hp / this.bossRef.maxHp)) * 100}%`;
    if (this.bossRef.dead) this.hideBoss();
  }

  hideBoss() {
    this.$('bossbar').style.display = 'none';
    this.bossRef = null;
  }
}
