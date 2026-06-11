// F1 2026 Suzuka Simulator — entry point.
// Wires together: scene/lighting, track world, car physics & model, cameras,
// HUD, audio, timing/ghost, driver-select UI and the race start sequence.
import * as THREE from 'three';
import { buildTrackWorld } from './track/trackMesh.js';
import { TOTAL_LENGTH, TRACK_NAME } from './track/suzuka.js';
import { buildCar } from './car/carModel.js';
import { CarPhysics, CAR } from './car/physics.js';
import { TEAMS } from './data/grid2026.js';
import { Input } from './game/input.js';
import { CameraRig, CAMERA_MODES } from './game/cameras.js';
import { Hud } from './game/hud.js';
import { Timing, fmtTime } from './game/timing.js';
import { EngineAudio } from './game/audio.js';
import { Ghost } from './game/ghost.js';
import { autopilotControl } from './game/autopilot.js';
import { RaceManager } from './game/race.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4d7ee, 600, 2600);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 6000);
camera.position.set(0, 40, 80);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// sky dome (vertex-color gradient)
{
  const skyG = new THREE.SphereGeometry(4500, 24, 14);
  const pos = skyG.attributes.position;
  const col = [];
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) / 4500 + 0.12) / 0.9));
    const top = new THREE.Color(0x2f6fd1), hor = new THREE.Color(0xdce9f7);
    const c = hor.clone().lerp(top, Math.pow(t, 0.7));
    col.push(c.r, c.g, c.b);
  }
  skyG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(skyG, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false,
  }));
  scene.add(sky);
}

// lighting: afternoon sun
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.position.set(500, 700, -300);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 100; sun.shadow.camera.far = 1800;
const SHADOW_R = 60;
sun.shadow.camera.left = -SHADOW_R; sun.shadow.camera.right = SHADOW_R;
sun.shadow.camera.top = SHADOW_R; sun.shadow.camera.bottom = -SHADOW_R;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbdd5f2, 0x55683f, 1.25));

// ---------- world ----------
const { world, startLights, ferrisWheel } = buildTrackWorld();
scene.add(world);

// ---------- game state ----------
const state = {
  phase: 'menu',              // menu | countdown | race | finished
  team: TEAMS[0],
  driver: TEAMS[0].drivers[0],
  countT: 0,
  lightsOut: 0,
  race: null,                 // RaceManager when opponents selected
  lapTarget: 3,
};
const assists = { tc: true, abs: true, stability: true, autoGear: true, autoX: true };
let muted = false;

const input = new Input();
const rig = new CameraRig(camera);
const hud = new Hud(document.getElementById('hud'));
const timing = new Timing();
const audio = new EngineAudio();
const ghost = new Ghost();

const physics = new CarPhysics();
let carVis = null;            // player car model
let ghostVis = null;          // ghost car model
let wheelSpinAcc = 0;
let stuckTimer = 0;           // off-track-and-stopped auto-respawn countdown
const RESPAWN_AFTER = 3;      // seconds

// ---------- driver select menu ----------
const menuEl = document.getElementById('menu');
function buildMenu() {
  menuEl.innerHTML = `
    <h1>F1 2026 RACING SIMULATOR</h1>
    <h2>${TRACK_NAME} — 全長 ${(TOTAL_LENGTH / 1000).toFixed(3)} km ｜ ドライバーを選択してください</h2>
    <div id="teams"></div>
    <div id="race-setup">
      <h3>AI対戦</h3>
      <div class="hint">対戦したい相手を選んでください(0台ならタイムアタック)。あなたは最後尾グリッドからスタートします。</div>
      <div id="opp-chips"></div>
      <div class="opt-row">
        <span class="lbl"></span>
        <button class="opt-btn" id="opp-all">全選択</button>
        <button class="opt-btn" id="opp-none">クリア</button>
      </div>
      <div class="opt-row"><span class="lbl">周回数</span>
        <button class="opt-btn lap-btn" data-laps="1">1</button>
        <button class="opt-btn lap-btn sel" data-laps="3">3</button>
        <button class="opt-btn lap-btn" data-laps="5">5</button>
      </div>
      <div class="opt-row"><span class="lbl">AIの速さ</span>
        <button class="opt-btn diff-btn" data-diff="0.88">易しい</button>
        <button class="opt-btn diff-btn sel" data-diff="0.96">普通</button>
        <button class="opt-btn diff-btn" data-diff="1.04">速い</button>
      </div>
    </div>
    <button id="start-race" disabled>SELECT DRIVER</button>
    <div class="controls-help">
      <b>操作:</b> ↑/W アクセル ｜ ↓/S ブレーキ ｜ ←→/A D ステアリング ｜ Space オーバーテイクブースト(ERS)<br>
      X アクティブエアロ(Xモード) ｜ E/Q または Shift/Ctrl ギア ｜ C カメラ切替 ｜ R リスポーン ｜ M ミュート<br>
      <b>アシスト切替:</b> F1 トラクション ｜ F2 ABS ｜ F3 スタビリティ ｜ F4 オートシフト ｜ F5 自動エアロ ｜ ゲームパッド対応
    </div>`;
  const teamsEl = menuEl.querySelector('#teams');
  const startBtn = menuEl.querySelector('#start-race');
  const setupEl = menuEl.querySelector('#race-setup');
  const chipsEl = menuEl.querySelector('#opp-chips');
  let selected = null;
  const opponents = new Set();   // keys "teamId:driverIndex"
  let lapTarget = 3, difficulty = 0.96;

  const keyOf = (team, di) => `${team.id}:${di}`;

  const refreshStart = () => {
    if (!selected) return;
    startBtn.disabled = false;
    startBtn.textContent = opponents.size
      ? `${selected.drv.abbr} で ${opponents.size} 台とレース開始(${lapTarget}周)`
      : `${selected.drv.abbr} でタイムアタック開始`;
  };

  const renderChips = () => {
    chipsEl.innerHTML = '';
    for (const team of TEAMS) {
      const c = '#' + team.color.toString(16).padStart(6, '0');
      team.drivers.forEach((drv, di) => {
        if (selected && selected.team.id === team.id && selected.di === di) return;
        const key = keyOf(team, di);
        const chip = document.createElement('button');
        chip.className = 'opp-chip' + (opponents.has(key) ? ' sel' : '');
        chip.innerHTML = `<i style="background:${c}"></i>${drv.abbr} ${drv.name}`;
        chip.onclick = () => {
          opponents.has(key) ? opponents.delete(key) : opponents.add(key);
          chip.classList.toggle('sel');
          refreshStart();
        };
        chipsEl.appendChild(chip);
      });
    }
  };

  for (const team of TEAMS) {
    const c = '#' + team.color.toString(16).padStart(6, '0');
    const div = document.createElement('div');
    div.className = 'team';
    div.innerHTML = `<div class="tname"><i style="background:${c}"></i>${team.name} <small>${team.fullName} ・ ${team.pu}</small></div>`;
    team.drivers.forEach((drv, di) => {
      const btn = document.createElement('button');
      btn.className = 'drv';
      btn.innerHTML = `<span class="dnum" style="color:${c}">${drv.num}</span> ${drv.name} <small>${drv.abbr}</small>`;
      btn.onclick = () => {
        menuEl.querySelectorAll('.drv.sel').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        selected = { team, drv, di };
        opponents.delete(keyOf(team, di));   // can't race yourself
        setupEl.style.display = 'block';
        renderChips();
        refreshStart();
      };
      div.appendChild(btn);
    });
    teamsEl.appendChild(div);
  }

  menuEl.querySelector('#opp-all').onclick = () => {
    for (const team of TEAMS) team.drivers.forEach((drv, di) => {
      if (selected && selected.team.id === team.id && selected.di === di) return;
      opponents.add(keyOf(team, di));
    });
    renderChips(); refreshStart();
  };
  menuEl.querySelector('#opp-none').onclick = () => {
    opponents.clear(); renderChips(); refreshStart();
  };
  menuEl.querySelectorAll('.lap-btn').forEach(b => b.onclick = () => {
    menuEl.querySelectorAll('.lap-btn').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    lapTarget = Number(b.dataset.laps);
    refreshStart();
  });
  menuEl.querySelectorAll('.diff-btn').forEach(b => b.onclick = () => {
    menuEl.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    difficulty = Number(b.dataset.diff);
  });

  startBtn.onclick = () => {
    if (!selected) return;
    const entries = [];
    for (const team of TEAMS) team.drivers.forEach((drv, di) => {
      if (opponents.has(keyOf(team, di))) entries.push({ team, driver: drv });
    });
    startRace(selected.team, selected.drv, { entries, lapTarget, difficulty });
  };
}
buildMenu();

// ---------- race lifecycle ----------
function startRace(team, driver, opts = {}) {
  state.team = team;
  state.driver = driver;
  state.lapTarget = opts.lapTarget ?? 3;

  if (carVis) { scene.remove(carVis.group); }
  carVis = buildCar(team, driver.num);
  scene.add(carVis.group);
  if (!ghostVis) {
    ghostVis = buildCar(team, driver.num, { ghost: true });
    scene.add(ghostVis.group);
  }
  ghostVis.group.visible = false;

  state.race?.dispose();
  state.race = null;
  if (opts.entries?.length) {
    state.race = new RaceManager(scene, opts.entries, state.lapTarget, opts.difficulty ?? 0.96);
    state.race.placeGrid(physics);   // AI by pace from P1, player at the back
  } else {
    physics.reset(TOTAL_LENGTH - 14, 3.2);   // time attack: P1 grid slot
  }
  stuckTimer = 0;
  timing.reset();
  ghost.beginLap();
  hud.setDriver(team, driver);
  hud.hideRace();
  document.getElementById('results').style.display = 'none';

  menuEl.style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  audio.resume();
  rig.snapBehind(physics);

  // formation: lights sequence (wall-clock based so low fps can't stretch it)
  state.phase = 'countdown';
  state.countStart = performance.now();
  buildLightsOverlay();
  hud.showMsg(state.race
    ? `${driver.name} ― ${state.race.cars.length}台と${state.lapTarget}周レース`
    : `${driver.name} ― 鈴鹿サーキット タイムアタック`, 3000);
}

const lightsEl = document.getElementById('lights');
function buildLightsOverlay() {
  lightsEl.innerHTML = '';
  lightsEl.style.display = 'flex';
  for (let i = 0; i < 5; i++) {
    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = '<div class="bulb"></div><div class="bulb"></div>';
    lightsEl.appendChild(col);
  }
}

function setStartLights(n, out) {
  [...lightsEl.children].forEach((col, i) => col.classList.toggle('on', !out && i < n));
  startLights.forEach((m, i) => {
    m.material.color.set(!out && i < n ? 0xff1801 : 0x220000);
    m.material.emissive?.set?.(!out && i < n ? 0xff1801 : 0x000000);
  });
  if (out) setTimeout(() => { lightsEl.style.display = 'none'; }, 900);
}

function backToMenu() {
  state.phase = 'menu';
  state.race?.dispose();
  state.race = null;
  hud.hideRace();
  document.getElementById('results').style.display = 'none';
  menuEl.style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
  lightsEl.style.display = 'none';
  audio.setMuted(true);
}

function finishRace() {
  state.phase = 'finished';
  timing.running = false;
  const standings = state.race.standings(
    physics, state.lapTarget + 1, state.driver.abbr, state.team);
  const meIdx = standings.findIndex(r => r.isPlayer);
  const el = document.getElementById('results');
  el.innerHTML = `
    <h2>🏁 FINISH — P${meIdx + 1}</h2>
    <div class="sub">${state.driver.name} ｜ ${state.lapTarget}周 ｜ ベストラップ ${fmtTime(timing.bestLap)}</div>
    <div class="list">${standings.map((r, i) => {
      const c = '#' + r.team.color.toString(16).padStart(6, '0');
      return `<div class="row${r.isPlayer ? ' me' : ''}">` +
        `<span class="p">P${i + 1}</span><i style="background:${c}"></i>` +
        `<span>${r.abbr}</span><small>${r.team.name}</small></div>`;
    }).join('')}</div>
    <div class="esc">Esc でメニューに戻る</div>`;
  el.style.display = 'flex';
}

// ---------- main loop ----------
let last = performance.now();
const FIXED = 1 / 120;
let acc = 0;
let lastBoard = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  input.update(dt);
  handleGlobalKeys();

  ferrisWheel.userData.wheelRim.rotation.z += dt * 0.05; // idle scenery motion

  if (state.phase === 'countdown') {
    const countT = (now - state.countStart) / 1000;
    const n = Math.min(5, Math.floor(countT / 0.9));
    if (countT < 4.5) setStartLights(n, false);
    else if (state.phase === 'countdown') {
      setStartLights(5, true);          // lights out!
      state.phase = 'race';
      timing.start();
      state.race?.start();
      hud.showMsg('IT\'S LIGHTS OUT AND AWAY WE GO!', 2200);
    }
    state.race?.updateVisuals();
    rig.update(physics, dt);
  }

  if (state.phase === 'race' || state.phase === 'finished') {
    acc += dt;
    const frameInput = state.phase === 'finished'
      ? { throttle: 0, brake: 0.3, steer: input.steer }   // coast to a stop
      : window.__sim?.autopilot
        ? autopilotControl(physics)
        : {
          throttle: input.throttle, brake: input.brake, steer: input.steer,
          boost: input.boost, xModeRequest: input.xModeRequest,
          gearUp: input.gearUp, gearDown: input.gearDown,
        };
    while (acc >= FIXED) {
      physics.step(FIXED, frameInput, assists);
      state.race?.step(FIXED, physics);
      frameInput.gearUp = frameInput.gearDown = false;
      acc -= FIXED;
    }
    physics._boosting = input.boost;
    state.race?.updateVisuals();

    // timing / ghost (ghost car only in time attack)
    const s = physics.trackS();
    if (state.phase === 'race') {
      timing.update(dt, s);
      if (timing.running && timing.lap > 0 && !state.race) ghost.record(timing.lapTime, physics);
      if (timing.lapJustCompleted != null) {
        const t = timing.lapJustCompleted;
        const isBest = timing.bestLap === t;
        if (!state.race) {
          ghost.lapDone(t, isBest);
          ghost.beginLap();
        }
        if (state.race && timing.lap > state.lapTarget) {
          finishRace();
        } else {
          hud.showMsg(`LAP ${fmtTime(t)}${isBest ? '  ― ベストラップ!' : ''}`, 3000);
        }
      }
    }

    rig.update(physics, dt);
    audio.update(physics, state.phase === 'finished' ? 0 : input.throttle);

    // ---- auto-respawn: stopped off track -> 3 s countdown near the car ----
    if (state.phase === 'race' && !physics.onTrack && physics.speed < 2.0) stuckTimer += dt;
    else stuckTimer = 0;
    if (stuckTimer > 0) {
      const remain = RESPAWN_AFTER - stuckTimer;
      if (remain <= 0) {
        physics.reset(physics.trackS(), 0);   // nearest centerline point
        physics.u = 8;
        rig.snapBehind(physics);
        stuckTimer = 0;
        hud.hideRespawn();
        hud.showMsg('コースに復帰しました', 1200);
      } else {
        // anchor the countdown above the car in screen space
        const p = new THREE.Vector3(physics.x, physics.y + 1.9, physics.z).project(camera);
        const sx = (p.x * 0.5 + 0.5) * innerWidth;
        const sy = (-p.y * 0.5 + 0.5) * innerHeight;
        const visible = p.z < 1 && p.z > -1;
        hud.showRespawn(visible ? sx : innerWidth / 2, visible ? sy : innerHeight * 0.4,
          Math.ceil(remain));
      }
    } else {
      hud.hideRespawn();
    }
  }

  // car visuals
  if (carVis) {
    // driver-eye mode hides the player's car body entirely
    carVis.group.visible = rig.mode !== 3;
    carVis.group.position.set(physics.x, physics.y, physics.z);
    carVis.group.rotation.set(0, -physics.heading, 0);
    wheelSpinAcc += physics.u / CAR.wheelRadius * dt;
    carVis.update({
      steerAngle: physics.steerAngle, xMode: physics.xMode,
      pitch: physics.pitch, roll: physics.roll,
      wheelSpin: physics.u / CAR.wheelRadius * dt,
    });
    // sun shadow follows the car
    sun.target.position.set(physics.x, physics.y, physics.z);
    sun.position.set(physics.x + 250, physics.y + 350, physics.z - 150);
  }

  // ghost visuals
  let ghostPose = null;
  if (ghostVis && state.phase === 'race' && timing.running) {
    ghostPose = ghost.poseAt(timing.lapTime);
    if (ghostPose && timing.lap > 0) {
      ghostVis.group.visible = true;
      ghostVis.group.position.set(ghostPose.x, ghostPose.y, ghostPose.z);
      ghostVis.group.rotation.set(0, -ghostPose.h, 0);
    } else ghostVis.group.visible = false;
  }

  if (state.phase !== 'menu') {
    hud.update(physics, timing, assists,
      ghostPose, '#' + state.team.color.toString(16).padStart(6, '0'));
    if (state.race && now - lastBoard > 250) {
      lastBoard = now;
      const standings = state.race.standings(
        physics, timing.lap, state.driver.abbr, state.team);
      hud.updateRace(standings, state.lapTarget, physics.speed);
    }
  }

  renderer.render(scene, camera);
  input.endFrame();
}

function handleGlobalKeys() {
  if (input.pressed('KeyC')) {
    rig.cycle();
    hud.showMsg(`カメラ: ${CAMERA_MODES[rig.mode]}`, 1200);
  }
  if (input.pressed('KeyR') && state.phase === 'race') {
    // respawn at the nearest centerline point, rolling slowly
    const s = physics.trackS();
    physics.reset(s, 0);
    physics.u = 8;
    hud.showMsg('リスポーン', 1000);
  }
  if (input.pressed('KeyM')) { muted = !muted; audio.setMuted(muted); }
  if (input.pressed('Escape') && state.phase !== 'menu') backToMenu();
  if (input.pressed('F1')) { assists.tc = !assists.tc; hud.showMsg(`トラクションコントロール: ${assists.tc ? 'ON' : 'OFF'}`, 1200); }
  if (input.pressed('F2')) { assists.abs = !assists.abs; hud.showMsg(`ABS: ${assists.abs ? 'ON' : 'OFF'}`, 1200); }
  if (input.pressed('F3')) { assists.stability = !assists.stability; hud.showMsg(`スタビリティ: ${assists.stability ? 'ON' : 'OFF'}`, 1200); }
  if (input.pressed('F4')) { assists.autoGear = !assists.autoGear; hud.showMsg(`オートシフト: ${assists.autoGear ? 'ON' : 'OFF'}`, 1200); }
  if (input.pressed('F5')) { assists.autoX = !assists.autoX; hud.showMsg(`自動アクティブエアロ: ${assists.autoX ? 'ON' : 'OFF'}`, 1200); }
}

// prevent F1-F5 browser defaults
window.addEventListener('keydown', (e) => {
  if (['F1', 'F2', 'F3', 'F4', 'F5'].includes(e.code)) e.preventDefault();
});

requestAnimationFrame(frame);
// reveal
requestAnimationFrame(() => { document.getElementById('fade').style.opacity = 0; });

// debug handle (used by automated verification; harmless in production)
window.__sim = {
  physics, rig, timing, state, autopilot: false,
  teleport: (s, speed = 40) => {
    physics.reset(s, 0);
    physics.u = speed;
    timing.prevS = physics.trackS();  // don't count the jump as a line crossing
    rig.snapBehind(physics);
  },
  // synchronous fast-forward with autopilot (no rendering); in race mode the
  // AI field, standings and the finish are simulated too
  simulate: (seconds) => {
    const laps = [];
    for (let t = 0; t < seconds; t += FIXED) {
      const ctl = autopilotControl(physics);
      physics.step(FIXED, ctl, assists);
      state.race?.step(FIXED, physics);
      timing.update(FIXED, physics.trackS());
      if (timing.lapJustCompleted != null) {
        laps.push(timing.lapJustCompleted);
        if (state.race && timing.lap > state.lapTarget) { finishRace(); break; }
      }
    }
    return {
      laps, s: physics.trackS(), kmh: physics.speedKmh, onTrack: physics.onTrack,
      phase: state.phase,
      standings: state.race
        ? state.race.standings(physics, timing.lap, state.driver.abbr, state.team)
          .map((r, i) => `P${i + 1} ${r.abbr}${r.isPlayer ? '*' : ''} lap${r.lap}`)
        : null,
    };
  },
};
