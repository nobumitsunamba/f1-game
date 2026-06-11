// Suzuka Circuit runtime model: sampled centerline with elevation, widths,
// tangents/normals, fast nearest-point queries and corner metadata.
// Geometry from real centerline data (see suzukaData.js); elevation profile
// modeled after the real circuit (~40 m of elevation change, underpass after
// Degner 2 below the back-straight bridge).
import { SUZUKA_POINTS } from './suzukaData.js';

export const TRACK_NAME = '鈴鹿サーキット — Suzuka Circuit';

// Elevation control points (s in meters from S/F line, y in meters).
// S/F is the reference 0. Lowest point ~T2, climb through the esses to
// Dunlop/Degner, dip under the bridge, climb again to Spoon, then the back
// straight descends over the bridge (+8 m clearance) towards 130R and home.
const ELEVATION = [
  [0, 0], [340, -2.5], [640, -5], [900, -8], [1100, -6.5], [1300, -2],
  [1500, 4], [1700, 12], [1830, 18], [2100, 24], [2300, 27], [2484, 23],
  [2544, 20],            // underpass below the bridge
  [2700, 21], [2980, 22], [3300, 25], [3640, 28], [3900, 31], [4100, 33],
  [4500, 31],
  [4923, 28],            // bridge deck, 8 m above the underpass
  [5100, 24], [5300, 15], [5450, 8], [5650, 2], [5798, 0],
];

// Corner markers: [s, name] — used for signboards, HUD and braking boards.
export const CORNERS = [
  [695, 'T1 第1コーナー'],
  [855, 'T2 第2コーナー'],
  [1112, 'T3 S字'],
  [1225, 'T4 S字'],
  [1390, 'T5 S字'],
  [1560, 'T6 逆バンク'],
  [1765, 'T7 ダンロップ'],
  [2300, 'T8 デグナー1'],
  [2455, 'T9 デグナー2'],
  [2785, 'T10'],
  [2920, 'T11 ヘアピン'],
  [3230, 'T12'],
  [3850, 'T13 スプーン入口'],
  [4050, 'T14 スプーン出口'],
  [4975, 'T15 130R'],
  [5395, 'T16 カシオトライアングル'],
  [5530, 'T18 最終コーナー'],
];

// Sector boundaries (s meters): S1 ends after the esses, S2 after Spoon.
export const SECTORS = [1650, 4100];

// Underpass / bridge s-positions (centers) for mesh building.
export const UNDERPASS_S = 2544;
export const BRIDGE_S = 4923;

function elevationAt(s) {
  const E = ELEVATION;
  if (s <= E[0][0]) return E[0][1];
  for (let i = 0; i < E.length - 1; i++) {
    if (s >= E[i][0] && s <= E[i + 1][0]) {
      const t = (s - E[i][0]) / (E[i + 1][0] - E[i][0]);
      const tt = t * t * (3 - 2 * t);
      return E[i][1] + (E[i + 1][1] - E[i][1]) * tt;
    }
  }
  return E[E.length - 1][1];
}

function buildSamples() {
  const raw = SUZUKA_POINTS;
  const n = raw.length;
  // cumulative arc length
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    s[i] = s[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  }
  const total = s[n - 1] + Math.hypot(raw[0][0] - raw[n - 1][0], raw[0][1] - raw[n - 1][1]);

  const samples = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = raw[i];
    const prev = raw[(i - 1 + n) % n];
    const next = raw[(i + 1) % n];
    let tx = next[0] - prev[0], tz = next[1] - prev[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    // curvature (signed, 1/m): angle change between segments / mean length
    const v1x = p[0] - prev[0], v1z = p[1] - prev[1];
    const v2x = next[0] - p[0], v2z = next[1] - p[1];
    const cross = v1x * v2z - v1z * v2x;
    const dot = v1x * v2x + v1z * v2z;
    const dAng = Math.atan2(cross, dot);
    const meanLen = tl / 2;
    samples[i] = {
      x: p[0], z: p[1], y: elevationAt(s[i]), s: s[i],
      tanX: tx, tanZ: tz,
      // left normal in x-z plane (left of travel direction)
      nrmX: tz, nrmZ: -tx,
      wR: Math.max(4.5, p[2]),   // width to the right of centerline
      wL: Math.max(4.5, p[3]),   // width to the left
      curv: dAng / Math.max(0.5, meanLen),
    };
  }
  return { samples, total };
}

const built = buildSamples();
export const SAMPLES = built.samples;
export const TOTAL_LENGTH = built.total;

// ---- spatial hash for nearest-sample lookup ----
const CELL = 40;
const hash = new Map();
SAMPLES.forEach((p, i) => {
  const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
  if (!hash.has(key)) hash.set(key, []);
  hash.get(key).push(i);
});

/**
 * Find index of nearest centerline sample to (x, z).
 * hint: previous index for fast local search (player car); pass -1 for global.
 */
export function nearestIndex(x, z, hint = -1) {
  const n = SAMPLES.length;
  if (hint >= 0) {
    // local walk from hint — robust for continuous motion
    let best = hint, bestD = d2(SAMPLES[hint], x, z);
    for (let off = 1; off <= 30; off++) {
      const a = (hint + off) % n, b = (hint - off + n) % n;
      const da = d2(SAMPLES[a], x, z), db = d2(SAMPLES[b], x, z);
      if (da < bestD) { bestD = da; best = a; }
      if (db < bestD) { bestD = db; best = b; }
    }
    // accept if reasonably close, else fall through to global
    if (bestD < 120 * 120) return best;
  }
  let best = 0, bestD = Infinity;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let r = 0; r < 50; r++) {
    let found = false;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const list = hash.get(`${cx + i},${cz + j}`);
      if (!list) continue;
      found = true;
      for (const idx of list) {
        const d = d2(SAMPLES[idx], x, z);
        if (d < bestD) { bestD = d; best = idx; }
      }
    }
    if (found && r > 1 && bestD < ((r - 1) * CELL) ** 2) break;
  }
  return best;
}

function d2(p, x, z) { const dx = p.x - x, dz = p.z - z; return dx * dx + dz * dz; }

/**
 * Query the track at world position (x, z).
 * Returns { idx, s, lateral, onTrack, y, grade, sample } where lateral is the
 * signed offset from centerline (+ = left of travel direction).
 */
export function queryTrack(x, z, hint = -1) {
  const idx = nearestIndex(x, z, hint);
  const p = SAMPLES[idx];
  const dx = x - p.x, dz = z - p.z;
  const lateral = dx * p.nrmX + dz * p.nrmZ;
  const along = dx * p.tanX + dz * p.tanZ;
  const onTrack = lateral <= p.wL + 0.6 && lateral >= -(p.wR + 0.6);
  // interpolate elevation along tangent
  const n = SAMPLES.length;
  const next = SAMPLES[(idx + 1) % n];
  const grade = (next.y - p.y) / Math.max(0.5, next.s - p.s || 5);
  const y = p.y + along * grade;
  return { idx, s: p.s + along, lateral, onTrack, y, grade, sample: p };
}

/** Distance from centerline to the barrier wall at sample idx, per side. */
export function wallDistance(idx, side /* +1 = left, -1 = right */) {
  const p = SAMPLES[idx];
  const w = side > 0 ? p.wL : p.wR;
  // generous run-off at fast corners, tighter elsewhere
  const k = Math.abs(p.curv);
  const runoff = k > 0.008 ? 26 : 14;
  return w + runoff;
}

/** Corner name at/just ahead of s, within lookahead meters (for HUD). */
export function upcomingCorner(s, lookahead = 220) {
  for (const [cs, name] of CORNERS) {
    let d = cs - s;
    if (d < -30) d += TOTAL_LENGTH;
    if (d >= -30 && d < lookahead) return { name, dist: Math.max(0, d) };
  }
  return null;
}
