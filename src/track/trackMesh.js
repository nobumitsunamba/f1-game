// Builds all static world geometry for Suzuka: road ribbon with asphalt
// texture, red/white kerbs, terrain heightfield following the road elevation,
// barriers, the figure-8 bridge, start/finish gantry, grandstands, the famous
// Ferris wheel, trees and signage.
import * as THREE from 'three';
import {
  SAMPLES, TOTAL_LENGTH, CORNERS, UNDERPASS_S, BRIDGE_S, wallDistance,
  nearestIndex,
} from './suzuka.js';

const N = SAMPLES.length;

// ---------- procedural textures ----------
function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tx = new THREE.CanvasTexture(cv);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat[0], repeat[1]);
  tx.anisotropy = 8;
  return tx;
}

function asphaltTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3c3c40';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = 46 + Math.random() * 28;
      ctx.fillStyle = `rgb(${v},${v},${v + 3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    // tire groove (racing line darkening)
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.25, 'rgba(20,20,22,0)');
    grad.addColorStop(0.5, 'rgba(20,20,22,0.35)');
    grad.addColorStop(0.75, 'rgba(20,20,22,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

function grassTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3e7a2e';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4200; i++) {
      const g = 100 + Math.random() * 60;
      ctx.fillStyle = `rgb(${g * 0.45},${g},${g * 0.3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, [80, 80]);
}

function wallTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2255aa';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px Arial';
    ctx.fillText('SUZUKA  CIRCUIT', 8, 42);
  }, [12, 1]);
}

function sampleAt(s) {
  s = ((s % TOTAL_LENGTH) + TOTAL_LENGTH) % TOTAL_LENGTH;
  let lo = 0, hi = N - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (SAMPLES[mid].s < s) lo = mid + 1; else hi = mid;
  }
  return SAMPLES[Math.max(0, lo - 0)];
}

function distToS(s, s2) {
  let d = Math.abs(s - s2);
  return Math.min(d, TOTAL_LENGTH - d);
}

/**
 * Plan-view distance from (x,z) to the nearest centerline point on track
 * sections OTHER than the one the object belongs to (|Δs| > excl). The
 * figure-8 layout means "beside my section" can be "on top of another".
 */
function clearanceFromOtherSections(x, z, ownS, excl = 150) {
  let best = Infinity;
  for (const p of SAMPLES) {
    if (distToS(p.s, ownS) < excl) continue;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ---------- road ribbon ----------
function buildRoad() {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = SAMPLES[i % N];
    pos.push(p.x + p.nrmX * p.wL, p.y + 0.02, p.z + p.nrmZ * p.wL);
    pos.push(p.x - p.nrmX * p.wR, p.y + 0.02, p.z - p.nrmZ * p.wR);
    const v = p.s / 8 + (i === N ? TOTAL_LENGTH / 8 : 0);
    uv.push(0, v, 1, v);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({
    map: asphaltTexture(), roughness: 0.96, metalness: 0,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

// start/finish line + grid boxes
function buildStartLine() {
  const group = new THREE.Group();
  const p = SAMPLES[0];
  const tex = canvasTexture(128, 32, (ctx, w, h) => {
    const sq = 8;
    for (let y = 0; y < h / sq; y++) for (let x = 0; x < w / sq; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#eeeeee' : '#111111';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  });
  const width = p.wL + p.wR;
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 1.2),
    new THREE.MeshBasicMaterial({ map: tex }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(p.tanZ, p.tanX) + Math.PI / 2;
  const cx = p.x + p.nrmX * (p.wL - p.wR) / 2;
  const cz = p.z + p.nrmZ * (p.wL - p.wR) / 2;
  line.position.set(cx, p.y + 0.04, cz);
  group.add(line);

  // grid slots behind the line (spacing matches race.js GRID_GAP)
  const slotMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
  for (let i = 0; i < 22; i++) {
    const sp = sampleAt(TOTAL_LENGTH - 14 - i * 13);
    const lat = (i % 2 === 0 ? 3.2 : -3.2);
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.18), slotMat);
    slot.rotation.x = -Math.PI / 2;
    slot.rotation.z = Math.atan2(sp.tanZ, sp.tanX);
    slot.position.set(sp.x + sp.nrmX * lat, sp.y + 0.04, sp.z + sp.nrmZ * lat);
    group.add(slot);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 1.2), slotMat);
    bar.rotation.x = -Math.PI / 2;
    bar.rotation.z = Math.atan2(sp.tanZ, sp.tanX);
    bar.position.set(sp.x + sp.nrmX * lat + sp.tanX * 1.2, sp.y + 0.04, sp.z + sp.nrmZ * lat + sp.tanZ * 1.2);
    group.add(bar);
  }
  return group;
}

// ---------- kerbs ----------
function buildKerbs() {
  const pos = [], col = [], idx = [];
  const red = [0.85, 0.08, 0.08], white = [0.92, 0.92, 0.92];
  let vi = 0;
  const KW = 1.5; // kerb width

  // kerb wherever local curvature (smoothed) is significant
  const curv = SAMPLES.map((p, i) => {
    let c = 0;
    for (let k = -4; k <= 4; k++) c += SAMPLES[(i + k + N) % N].curv;
    return c / 9;
  });

  for (const side of [1, -1]) {
    let run = [];
    for (let i = 0; i <= N; i++) {
      const k = curv[i % N];
      const need = Math.abs(k) > 0.0045;
      if (need) run.push(i % N);
      if ((!need || i === N) && run.length) {
        if (run.length > 3) {
          // extend a little before/after the corner
          const ext = 4;
          const start = run[0] - ext, end = run[run.length - 1] + ext;
          let stripe = 0;
          for (let j = start; j <= end; j++) {
            const p = SAMPLES[(j + N) % N];
            const w = side > 0 ? p.wL : p.wR;
            const inX = p.x + p.nrmX * side * w, inZ = p.z + p.nrmZ * side * w;
            const outX = p.x + p.nrmX * side * (w + KW), outZ = p.z + p.nrmZ * side * (w + KW);
            pos.push(inX, p.y + 0.045, inZ, outX, p.y + 0.10, outZ);
            const c = (stripe >> 1) % 2 ? red : white;
            col.push(...c, ...c);
            if (j > start) {
              const a = vi - 2, b = vi - 1, c2 = vi, d = vi + 1;
              idx.push(a, b, c2, b, d, c2);
            }
            vi += 2;
            stripe++;
          }
        }
        run = [];
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.6,
  }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- terrain heightfield ----------
function buildTerrain() {
  // grid covering the circuit; height follows the nearest road sample so the
  // landscape rises and falls with the circuit (real Suzuka sits in a valley
  // park). Near the bridge the terrain follows the lower road.
  const margin = 160;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of SAMPLES) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
  const res = 14;
  const nx = Math.ceil((maxX - minX) / res), nz = Math.ceil((maxZ - minZ) / res);

  // coarse spatial grid of road samples for fast nearest lookup
  const cell = 60;
  const grid = new Map();
  SAMPLES.forEach((p, i) => {
    if (distToS(p.s, BRIDGE_S) < 70) return; // terrain ignores the bridge deck
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)).push(i);
  });
  const nearestRoad = (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= 6; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const list = grid.get(`${cx + i},${cz + j}`);
        if (!list) continue;
        for (const k of list) {
          const p = SAMPLES[k];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bestD) { bestD = d; best = p; }
        }
      }
      if (best && bestD < ((r * cell) ** 2)) break;
    }
    return { p: best, d: Math.sqrt(bestD) };
  };

  const g = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, nx, nz);
  g.rotateX(-Math.PI / 2);
  const posA = g.attributes.position;
  for (let i = 0; i < posA.count; i++) {
    const x = posA.getX(i) + (minX + maxX) / 2;
    const z = posA.getZ(i) + (minZ + maxZ) / 2;
    const { p, d } = nearestRoad(x, z);
    let y = 0;
    if (p) {
      const fall = Math.min(1, Math.max(0, (d - 12) / 140));
      // rolling hills further from the track
      const hill = (Math.sin(x * 0.011) + Math.cos(z * 0.013)) * 2.2 * fall;
      y = p.y * (1 - fall * 0.55) + hill - 0.12;
    }
    posA.setY(i, y);
    posA.setX(i, x); posA.setZ(i, z);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: grassTexture(), roughness: 1, metalness: 0,
  }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- barriers ----------
function buildWalls() {
  const pos = [], uv = [], idx = [];
  let vi = 0;
  const wallH = 1.0;
  for (const side of [1, -1]) {
    for (let i = 0; i <= N; i++) {
      const p = SAMPLES[i % N];
      let off = wallDistance(i % N, side);
      // bridge deck parapet & underpass tunnel walls hug the road
      if (distToS(p.s, BRIDGE_S) < 60) off = (side > 0 ? p.wL : p.wR) + 1.2;
      else if (distToS(p.s, UNDERPASS_S) < 30) off = (side > 0 ? p.wL : p.wR) + 2.5;
      const bx = p.x + p.nrmX * side * off, bz = p.z + p.nrmZ * side * off;
      pos.push(bx, p.y, bz, bx, p.y + wallH, bz);
      // mirror U on the right-hand wall so the lettering reads correctly
      uv.push(side * p.s / 20, 0, side * p.s / 20, 1);
      if (i > 0) {
        const a = vi - 2, b = vi - 1, c = vi, d = vi + 1;
        idx.push(a, b, c, b, d, c);
      }
      vi += 2;
    }
    vi = pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: wallTexture(), roughness: 0.8, side: THREE.DoubleSide,
  }));
  return mesh;
}

// ---------- bridge structure at the crossover ----------
function buildBridge() {
  const group = new THREE.Group();
  const over = sampleAt(BRIDGE_S);
  const under = sampleAt(UNDERPASS_S);
  const conc = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.9 });

  // deck slab under the over-road
  const span = 90;
  const pos = [], idx = [];
  let vi = 0;
  for (let s = BRIDGE_S - span / 2; s <= BRIDGE_S + span / 2; s += 6) {
    const p = sampleAt(s);
    const w = Math.max(p.wL, p.wR) + 1.6;
    pos.push(p.x + p.nrmX * w, p.y - 0.02, p.z + p.nrmZ * w);
    pos.push(p.x - p.nrmX * w, p.y - 0.02, p.z - p.nrmZ * w);
    pos.push(p.x + p.nrmX * w, p.y - 1.4, p.z + p.nrmZ * w);
    pos.push(p.x - p.nrmX * w, p.y - 1.4, p.z - p.nrmZ * w);
    if (vi > 0) {
      const o = vi - 4;
      // top is the road itself; build sides + soffit
      idx.push(o, o + 2, o + 4, o + 2, o + 6, o + 4);         // left side
      idx.push(o + 1, o + 5, o + 3, o + 3, o + 5, o + 7);     // right side
      idx.push(o + 2, o + 3, o + 6, o + 3, o + 7, o + 6);     // soffit
    }
    vi += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  group.add(new THREE.Mesh(g, conc));

  // pillars beside the under-road
  for (const side of [1, -1]) {
    const px = under.x + under.nrmX * side * (Math.max(under.wL, under.wR) + 4);
    const pz = under.z + under.nrmZ * side * (Math.max(under.wL, under.wR) + 4);
    const hgt = over.y - under.y;
    const pil = new THREE.Mesh(new THREE.BoxGeometry(2.2, hgt, 2.2), conc);
    pil.position.set(px, under.y + hgt / 2, pz);
    group.add(pil);
  }
  return group;
}

// ---------- trackside objects ----------
function billboardText(text, w, h, opts = {}) {
  const tex = canvasTexture(512, Math.round(512 * h / w), (ctx, cw, ch) => {
    ctx.fillStyle = opts.bg ?? '#0a2f6b';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = opts.fg ?? '#ffffff';
    ctx.font = `bold ${Math.round(ch * (opts.fontScale ?? 0.5))}px 'Arial'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  return m;
}

/**
 * Place obj beside the track. orient:
 *  'along'  — board parallel to the track, readable face towards the road
 *  'facing' — board perpendicular, facing oncoming cars
 */
function placeAt(obj, s, lateral, yOff = 0, orient = 'along') {
  const p = sampleAt(s);
  obj.position.set(p.x + p.nrmX * lateral, p.y + yOff, p.z + p.nrmZ * lateral);
  const a = Math.atan2(p.tanZ, p.tanX);
  if (orient === 'facing') obj.rotation.y = Math.atan2(-p.tanX, -p.tanZ);
  else obj.rotation.y = -a + (lateral > 0 ? 0 : Math.PI);
  return obj;
}

function buildGantry() {
  const group = new THREE.Group();
  const p = SAMPLES[2];
  const steel = new THREE.MeshStandardMaterial({ color: 0x333a44, roughness: 0.5, metalness: 0.7 });
  // legs clear the kerbs by a good margin on both sides
  const legOff = Math.max(p.wL, p.wR) + 4.5;
  const w = legOff * 2 + 2;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, w), steel);
  const ang = -Math.atan2(p.tanZ, p.tanX);
  beam.rotation.y = ang;
  const cx = p.x + p.nrmX * (p.wL - p.wR) / 2;
  const cz = p.z + p.nrmZ * (p.wL - p.wR) / 2;
  beam.position.set(cx, p.y + 7.5, cz);
  group.add(beam);
  for (const side of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.0, 7.5, 1.0), steel);
    leg.position.set(cx + p.nrmX * side * legOff, p.y + 3.75, cz + p.nrmZ * side * legOff);
    group.add(leg);
  }
  // panel faces the approaching cars (normal opposing travel direction)
  const panel = billboardText('SUZUKA  ―  JAPANESE GP 2026', 16, 1.8, { bg: '#cc0000' });
  panel.position.set(cx, p.y + 5.9, cz);
  panel.rotation.y = Math.atan2(-p.tanX, -p.tanZ);
  group.add(panel);

  // start lights rig (5 pairs) — referenced by the game for the start sequence
  const lights = [];
  const lightGeom = new THREE.SphereGeometry(0.22, 10, 8);
  for (let i = 0; i < 5; i++) {
    const offMat = new THREE.MeshStandardMaterial({ color: 0x220000, roughness: 0.4 });
    const top = new THREE.Mesh(lightGeom, offMat);
    const lateral = (i - 2) * 1.1;
    top.position.set(cx + p.tanX * 0 + p.nrmX * lateral, p.y + 6.7, cz + p.nrmZ * lateral);
    group.add(top);
    lights.push(top);
  }
  group.userData.startLights = lights;
  return group;
}

function buildGrandstand(s, lateral, len = 120) {
  // bright tilted crowd slab + white roof — avoids large unlit walls
  const group = new THREE.Group();
  const p = sampleAt(s);
  const side = Math.sign(lateral);

  // push the stand outward until its full footprint clears the barriers of
  // every part of the circuit (a straight stand beside a curving road, or
  // another limb of the figure-8, can otherwise end up on the racing surface)
  for (let guard = 0; guard < 12; guard++) {
    let ok = true;
    for (let f = -len / 2; f <= len / 2 && ok; f += len / 6) {
      for (const zLocal of [1, -14]) {  // front edge .. back of roof
        const off = lateral - side * zLocal;
        const lx = p.x + p.nrmX * off + p.tanX * f;
        const lz = p.z + p.nrmZ * off + p.tanZ * f;
        // nearest centerline point anywhere, with its own wall offset
        let best = Infinity, bq = null;
        for (const q of SAMPLES) {
          const d = (q.x - lx) ** 2 + (q.z - lz) ** 2;
          if (d < best) { best = d; bq = q; }
        }
        const runoff = Math.abs(bq.curv) > 0.008 ? 26 : 14;
        if (Math.sqrt(best) < Math.max(bq.wL, bq.wR) + runoff + 2) { ok = false; break; }
      }
    }
    if (ok) break;
    lateral += side * 5;
  }
  const yaw = Math.atan2(p.tanX, p.tanZ) + Math.PI / 2; // local x along track

  const crowdTex = canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#8a93a6'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = `hsl(${Math.random() * 360},45%,${48 + Math.random() * 26}%)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 6, 7);
    }
    // aisle stripes
    ctx.fillStyle = '#777f90';
    for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 8, h);
  }, [Math.max(1, len / 80), 1]);

  const local = new THREE.Group();
  // tilted seating slab, low edge towards the track
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(len, 13),
    new THREE.MeshBasicMaterial({ map: crowdTex, side: THREE.DoubleSide }));
  slab.rotation.x = -Math.PI / 2 + 0.62;      // rises away from the track
  slab.position.set(0, 4.4, -5.0);
  local.add(slab);
  // side skirt below the slab front edge
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.6),
    new THREE.MeshStandardMaterial({ color: 0xb9bfca, roughness: 0.9, side: THREE.DoubleSide }));
  skirt.position.set(0, 0.8, 0.6);
  local.add(skirt);
  // roof on slim columns
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 15),
    new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.5 }));
  roof.position.set(0, 11.2, -5.0);
  roof.rotation.x = 0.12;
  local.add(roof);
  const colM = new THREE.MeshStandardMaterial({ color: 0xcacfd8, roughness: 0.6 });
  for (let i = 0; i <= Math.floor(len / 30); i++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 11, 6), colM);
    col.position.set(-len / 2 + i * 30 + 15, 5.5, -10.5);
    local.add(col);
  }

  // orient: local -z points away from the track
  local.rotation.y = yaw + (side > 0 ? Math.PI : 0);
  local.position.set(p.x + p.nrmX * lateral, p.y, p.z + p.nrmZ * lateral);
  group.add(local);
  return group;
}

function buildFerrisWheel() {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xeeeeff, roughness: 0.4, metalness: 0.6 });
  const R = 38;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 1.0, 8, 40), steel);
  group.add(rim);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, R * 2, 6), steel);
    spoke.rotation.z = a;
    group.add(spoke);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(3, 3.4, 3),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 12, 0.7, 0.55), roughness: 0.5 }));
    pod.position.set(Math.cos(a) * R, Math.sin(a) * R - 1.4, 0.5);
    group.add(pod);
  }
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, R + 6, 8), steel);
    leg.position.set(side * 10, -(R + 6) / 2 + 2, 0);
    leg.rotation.z = side * 0.22;
    group.add(leg);
  }
  group.userData.wheelRim = rim;
  return group;
}

function buildPitBuilding() {
  // The pit straight in the real data curves gently, so one long box drifts
  // onto the road. Build the complex as short segments that each follow the
  // local road tangent at a constant lateral offset, and verify every corner
  // against the WHOLE circuit (the previous check excluded the own straight,
  // which is exactly where a drifting box ends up).
  const group = new THREE.Group();
  const garageTex = canvasTexture(512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#cfd4da'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a4450';
    for (let x = 8; x < w - 8; x += 64) ctx.fillRect(x, h * 0.45, 48, h * 0.5); // garage doors
    ctx.fillStyle = '#9fb6c8';
    ctx.fillRect(0, 6, w, h * 0.2);                                            // glass band
  }, [3, 1]);
  const faceMat = new THREE.MeshStandardMaterial({ map: garageTex, roughness: 0.7 });
  const plainMat = new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.7 });

  const segLen = 62, depth = 20, height = 9;
  for (let k = -2; k <= 2; k++) {
    const segS = TOTAL_LENGTH - 160 + k * segLen;
    const p = sampleAt(segS);
    let lateral = -(p.wR + 24);   // front face ~13 m off the road edge (pit lane)
    // push out until all 4 plan corners clear every part of the circuit
    for (let guard = 0; guard < 10; guard++) {
      let ok = true;
      for (const f of [-segLen / 2, segLen / 2]) {
        for (const d of [depth / 2, -depth / 2]) {
          const cx = p.x + p.nrmX * (lateral + d) + p.tanX * f;
          const cz = p.z + p.nrmZ * (lateral + d) + p.tanZ * f;
          let best = Infinity, bq = null;
          for (const q of SAMPLES) {
            const dd = (q.x - cx) ** 2 + (q.z - cz) ** 2;
            if (dd < best) { best = dd; bq = q; }
          }
          if (Math.sqrt(best) < Math.max(bq.wL, bq.wR) + 12) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) break;
      lateral -= 4;
    }
    const seg = new THREE.Mesh(new THREE.BoxGeometry(segLen + 0.8, height, depth),
      [plainMat, plainMat, plainMat, plainMat, faceMat, faceMat]);
    seg.rotation.y = -Math.atan2(p.tanZ, p.tanX);
    seg.position.set(p.x + p.nrmX * lateral, p.y + height / 2, p.z + p.nrmZ * lateral);
    group.add(seg);
    if (k === 0) {
      const sign = billboardText('SUZUKA CIRCUIT', 50, 4.5, { bg: '#13294b' });
      sign.rotation.y = Math.PI - Math.atan2(p.tanZ, p.tanX); // face the track
      sign.position.set(
        p.x + p.nrmX * (lateral + depth / 2 + 0.3), p.y + height + 2.5,
        p.z + p.nrmZ * (lateral + depth / 2 + 0.3));
      group.add(sign);
    }
  }
  return group;
}

function buildTrees(terrain) {
  const count = 420;
  const trunkG = new THREE.CylinderGeometry(0.35, 0.5, 4, 5);
  const crownG = new THREE.ConeGeometry(3.2, 7.5, 7);
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
  const crownM = new THREE.MeshStandardMaterial({ color: 0x2d6022, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkG, trunkM, count);
  const crowns = new THREE.InstancedMesh(crownG, crownM, count);
  const m4 = new THREE.Matrix4();
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let placed = 0, tries = 0;
  // place trees away from the road using rejection sampling on the terrain
  while (placed < count && tries < count * 30) {
    tries++;
    const i = Math.floor(Math.random() * N);
    const p = SAMPLES[i];
    const side = Math.random() > 0.5 ? 1 : -1;
    const dist = 34 + Math.random() * 110;
    const x = p.x + p.nrmX * side * dist + (Math.random() - 0.5) * 30;
    const z = p.z + p.nrmZ * side * dist + (Math.random() - 0.5) * 30;
    // reject if close to ANY part of the circuit (figure-8 sections cross!)
    const ni = nearestIndex(x, z, -1);
    const np = SAMPLES[ni];
    if ((np.x - x) ** 2 + (np.z - z) ** 2 < 32 * 32) continue;
    ray.set(new THREE.Vector3(x, 200, z), down);
    const hit = ray.intersectObject(terrain, false)[0];
    const y = hit ? hit.point.y : 0;
    const sc = 0.8 + Math.random() * 0.9;
    m4.makeScale(sc, sc, sc).setPosition(x, y + 2 * sc, z);
    trunks.setMatrixAt(placed, m4);
    m4.makeScale(sc, sc, sc).setPosition(x, y + (4 + 3.75) * sc * 0.9, z);
    crowns.setMatrixAt(placed, m4);
    placed++;
  }
  trunks.count = placed; crowns.count = placed;
  const g = new THREE.Group();
  g.add(trunks, crowns);
  return g;
}

function buildSignage() {
  const group = new THREE.Group();
  // helper: place a board on the preferred side, flip to the other side or
  // skip entirely if it would sit on/over another section of the figure-8
  const tryPlace = (obj, s, lat, yOff, orient) => {
    const p = sampleAt(s);
    for (const l of [lat, -lat]) {
      const x = p.x + p.nrmX * l, z = p.z + p.nrmZ * l;
      if (clearanceFromOtherSections(x, z, s) > 15) {
        placeAt(obj, s, l, yOff, orient);
        group.add(obj);
        return true;
      }
    }
    return false;
  };

  // corner name boards
  for (const [s, name] of CORNERS) {
    const board = billboardText(name.replace(/^T\d+ ?/, '') || name, 9, 1.6,
      { bg: '#ffffff', fg: '#cc2200', fontScale: 0.55 });
    const p = sampleAt(s - 60);
    const side = p.curv > 0 ? 1 : -1; // inside of the corner
    tryPlace(board, s - 60, side * (Math.max(p.wL, p.wR) + 6), 2.2, 'facing');
  }
  // braking markers before the heavy stops
  for (const stop of [695, 2920, 3850, 5395]) {
    for (const d of [100, 50]) {
      const b = billboardText(String(d), 1.6, 1.6, { bg: '#ffdd00', fg: '#cc0000', fontScale: 0.7 });
      const p = sampleAt(stop - 110 - d);
      tryPlace(b, stop - 110 - d, p.wL + 3.5, 1.2, 'facing');
    }
  }
  // ad boards along the straights
  const ads = ['SUZUKA CIRCUIT', 'JAPANESE GP', 'F1 2026', 'MOBILITYLAND', 'Rd.4 SUZUKA'];
  for (let i = 0; i < 26; i++) {
    const s = (i * 223) % TOTAL_LENGTH;
    const p = sampleAt(s);
    if (Math.abs(p.curv) > 0.004) continue;
    const ad = billboardText(ads[i % ads.length], 14, 1.4,
      { bg: i % 2 ? '#0a2f6b' : '#0c6b2f' });
    tryPlace(ad, s, (i % 2 ? 1 : -1) * (Math.max(p.wL, p.wR) + 9), 1.0, 'along');
  }
  return group;
}

// ---------- assembly ----------
export function buildTrackWorld() {
  const world = new THREE.Group();
  const terrain = buildTerrain();
  world.add(terrain);
  world.add(buildRoad());
  world.add(buildStartLine());
  world.add(buildKerbs());
  world.add(buildWalls());
  world.add(buildBridge());

  const gantry = buildGantry();
  world.add(gantry);

  // grandstands: main straight (left), T1, hairpin, chicane
  world.add(buildGrandstand(150, 28, 300));
  world.add(buildGrandstand(760, -48, 90));
  world.add(buildGrandstand(2920, 42, 90));
  world.add(buildGrandstand(5420, 36, 110));

  // Ferris wheel: search the paddock side of the pit straight for a spot
  // that clears the whole circuit (it is 80+ m across)
  const wheel = buildFerrisWheel();
  {
    let bestSpot = null, bestClear = 0;
    for (let ds = -700; ds <= -100; ds += 60) {
      for (const lat of [-160, -200, -240, 160, 200, 240]) {
        const p = sampleAt(TOTAL_LENGTH + ds);
        const x = p.x + p.nrmX * lat, z = p.z + p.nrmZ * lat;
        const clear = clearanceFromOtherSections(x, z, 0, 0); // vs ANY section
        if (clear > bestClear) { bestClear = clear; bestSpot = { x, z, y: p.y }; }
        if (clear > 80) break;
      }
      if (bestClear > 80) break;
    }
    wheel.position.set(bestSpot.x, bestSpot.y + 44, bestSpot.z);
    wheel.rotation.y = 0.8;
  }
  world.add(wheel);

  world.add(buildPitBuilding());
  world.add(buildTrees(terrain));
  world.add(buildSignage());

  return { world, startLights: gantry.userData.startLights, ferrisWheel: wheel };
}
