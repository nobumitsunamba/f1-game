// DOM HUD: speed/gear/RPM cluster, lap timing, delta, ERS, minimap.
import { SAMPLES, TOTAL_LENGTH, upcomingCorner } from '../track/suzuka.js';
import { fmtTime } from './timing.js';
import { CAR } from '../car/physics.js';

export class Hud {
  constructor(rootEl) {
    this.el = rootEl;
    rootEl.innerHTML = `
      <div id="hud-cluster">
        <div id="hud-rpm-lights"></div>
        <div id="hud-speed-row">
          <div id="hud-speed">0</div>
          <div id="hud-speed-unit">km/h</div>
          <div id="hud-gear">N</div>
        </div>
        <div id="hud-rpm-bar"><div id="hud-rpm-fill"></div></div>
        <div id="hud-ers-row">
          <span class="hud-tag" id="hud-x">X-MODE</span>
          <span class="hud-tag" id="hud-boost">OT</span>
          <div id="hud-ers-bar"><div id="hud-ers-fill"></div></div>
        </div>
      </div>
      <div id="hud-timing">
        <div id="hud-driver"></div>
        <div class="t-row"><span>LAP</span><b id="hud-lap">0</b></div>
        <div class="t-row"><span>TIME</span><b id="hud-time">0:00.000</b></div>
        <div class="t-row"><span>LAST</span><b id="hud-last">--:--.---</b></div>
        <div class="t-row"><span>BEST</span><b id="hud-best">--:--.---</b></div>
        <div class="t-row"><span>Δ</span><b id="hud-delta">--.---</b></div>
        <div id="hud-sectors">
          <span class="sec" id="sec0">S1</span><span class="sec" id="sec1">S2</span><span class="sec" id="sec2">S3</span>
        </div>
      </div>
      <canvas id="hud-map" width="230" height="230"></canvas>
      <div id="hud-corner"></div>
      <div id="hud-assists"></div>
      <div id="hud-msg"></div>
      <div id="hud-respawn">
        <div class="num">3</div>
        <div class="lbl">コースに復帰します (R: 即時)</div>
      </div>
    `;
    this.q = (id) => rootEl.querySelector('#' + id);
    this.lights = [];
    const lightsEl = this.q('hud-rpm-lights');
    for (let i = 0; i < 12; i++) {
      const d = document.createElement('span');
      d.className = 'rpm-light';
      lightsEl.appendChild(d);
      this.lights.push(d);
    }
    this.initMap();
    this.msgTimer = 0;
  }

  setDriver(team, driver) {
    const c = '#' + team.color.toString(16).padStart(6, '0');
    this.q('hud-driver').innerHTML =
      `<span class="num" style="border-color:${c}">${driver.num}</span> ${driver.abbr} <small>${team.name}</small>`;
  }

  initMap() {
    const cv = this.q('hud-map');
    const ctx = cv.getContext('2d');
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of SAMPLES) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14;
    const sc = Math.min((cv.width - pad * 2) / (maxX - minX), (cv.height - pad * 2) / (maxZ - minZ));
    this.mapXform = (x, z) => [
      pad + (x - minX) * sc + (cv.width - pad * 2 - (maxX - minX) * sc) / 2,
      pad + (z - minZ) * sc + (cv.height - pad * 2 - (maxZ - minZ) * sc) / 2,
    ];
    // pre-render the track path
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = cv.width; this.mapBase.height = cv.height;
    const b = this.mapBase.getContext('2d');
    b.strokeStyle = 'rgba(255,255,255,0.85)';
    b.lineWidth = 3.5;
    b.lineJoin = 'round';
    b.beginPath();
    SAMPLES.forEach((p, i) => {
      const [x, y] = this.mapXform(p.x, p.z);
      i === 0 ? b.moveTo(x, y) : b.lineTo(x, y);
    });
    b.closePath();
    b.stroke();
    // start/finish tick
    const p0 = SAMPLES[0];
    const [sx, sy] = this.mapXform(p0.x, p0.z);
    b.strokeStyle = '#ff3333'; b.lineWidth = 2;
    b.beginPath();
    b.moveTo(sx + p0.nrmX * 6 * 0 - p0.tanZ * 0, sy - 6);
    b.lineTo(sx, sy + 6);
    b.stroke();
    this.mapCtx = ctx;
  }

  /** Show the auto-respawn countdown anchored at screen position (px). */
  showRespawn(x, y, count) {
    const el = this.q('hud-respawn');
    el.style.display = 'block';
    // keep it on screen even in first-person views
    el.style.left = Math.max(70, Math.min(innerWidth - 70, x)) + 'px';
    el.style.top = Math.max(90, Math.min(innerHeight - 30, y)) + 'px';
    const num = el.querySelector('.num');
    if (num.textContent !== String(count)) num.textContent = count;
  }

  hideRespawn() {
    this.q('hud-respawn').style.display = 'none';
  }

  showMsg(text, ms = 2500) {
    const el = this.q('hud-msg');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { el.style.opacity = 0; }, ms);
  }

  update(car, timing, assists, ghostPose, teamColor) {
    this.q('hud-speed').textContent = Math.round(car.speedKmh);
    this.q('hud-gear').textContent = car.u < 0.5 && car.gear === 0 ? 'N' : (car.gear + 1);

    const rpmFrac = Math.min(1, car.rpm / CAR.revLimit);
    this.q('hud-rpm-fill').style.width = (rpmFrac * 100) + '%';
    this.q('hud-rpm-fill').style.background = rpmFrac > 0.94 ? '#ff2222' : rpmFrac > 0.82 ? '#ffaa00' : '#22cc66';
    this.lights.forEach((d, i) => {
      const on = rpmFrac > 0.55 + i * 0.038;
      d.className = 'rpm-light' + (on ? (i > 8 ? ' on-red' : i > 4 ? ' on-org' : ' on-grn') : '');
    });

    this.q('hud-x').classList.toggle('active', car.xMode);
    this.q('hud-boost').classList.toggle('active', car.ers > 0 && !!car._boosting);
    this.q('hud-ers-fill').style.width = (car.ers / CAR.ersCapacity * 100) + '%';

    this.q('hud-lap').textContent = Math.max(0, timing.lap);
    this.q('hud-time').textContent = fmtTime(timing.lapTime);
    this.q('hud-last').textContent = fmtTime(timing.lastLap);
    this.q('hud-best').textContent = fmtTime(timing.bestLap ?? timing.allTimeBest);
    const d = timing.delta;
    const dEl = this.q('hud-delta');
    if (d == null) { dEl.textContent = '--.---'; dEl.style.color = '#ccc'; }
    else {
      dEl.textContent = (d >= 0 ? '+' : '') + d.toFixed(3);
      dEl.style.color = d <= 0 ? '#33ff77' : '#ff5555';
    }
    for (let i = 0; i < 3; i++) {
      const el = this.q('sec' + i);
      const t = timing.sectorTimes[i] ?? (timing.sector > i ? 0 : null);
      el.className = 'sec' + (timing.sector === i ? ' cur' : t != null ? ' done' : '');
    }

    // corner callout
    const s = car.trackS();
    const corner = upcomingCorner(s);
    const cEl = this.q('hud-corner');
    if (corner && car.speed > 10) {
      cEl.textContent = corner.dist > 40 ? `${corner.name}  ${Math.round(corner.dist / 10) * 10}m` : corner.name;
      cEl.style.opacity = 1;
    } else cEl.style.opacity = 0;

    // assists readout
    this.q('hud-assists').innerHTML =
      `<span class="${assists.tc ? 'on' : ''}">TC</span>` +
      `<span class="${assists.abs ? 'on' : ''}">ABS</span>` +
      `<span class="${assists.stability ? 'on' : ''}">STB</span>` +
      `<span class="${assists.autoGear ? 'on' : ''}">AT</span>` +
      `<span class="${assists.autoX ? 'on' : ''}">aX</span>`;


    // minimap
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, 230, 230);
    ctx.drawImage(this.mapBase, 0, 0);
    if (ghostPose) {
      const [gx, gy] = this.mapXform(ghostPose.x, ghostPose.z);
      ctx.fillStyle = 'rgba(180,180,255,0.8)';
      ctx.beginPath(); ctx.arc(gx, gy, 3.4, 0, 7); ctx.fill();
    }
    const [cx, cy] = this.mapXform(car.x, car.z);
    ctx.fillStyle = teamColor;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill(); ctx.stroke();
  }
}
