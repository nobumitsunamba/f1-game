// Validates the Suzuka runtime track model: length, bridge clearance,
// elevation continuity, width sanity, query round-trips, and an ASCII map.
import { SAMPLES, TOTAL_LENGTH, UNDERPASS_S, BRIDGE_S, queryTrack, CORNERS } from '../src/track/suzuka.js';

console.log(`samples: ${SAMPLES.length}  length: ${TOTAL_LENGTH.toFixed(0)} m (real: 5807 m)`);

let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9;
for (const p of SAMPLES) {
  minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
  minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
}
console.log(`bbox: x [${minX.toFixed(0)}, ${maxX.toFixed(0)}] z [${minZ.toFixed(0)}, ${maxZ.toFixed(0)}]  elevation [${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);

// bridge clearance
const at = (s) => SAMPLES.reduce((b, p) => Math.abs(p.s - s) < Math.abs(b.s - s) ? p : b);
const under = at(UNDERPASS_S), over = at(BRIDGE_S);
const planDist = Math.hypot(under.x - over.x, under.z - over.z);
console.log(`crossing: plan distance ${planDist.toFixed(1)} m, clearance ${(over.y - under.y).toFixed(1)} m (want >= 6)`);

// elevation continuity (max grade)
let maxGrade = 0;
for (let i = 0; i < SAMPLES.length; i++) {
  const a = SAMPLES[i], b = SAMPLES[(i + 1) % SAMPLES.length];
  const ds = Math.abs(b.s - a.s) || 5;
  if (ds < 50) maxGrade = Math.max(maxGrade, Math.abs(b.y - a.y) / ds);
}
console.log(`max grade: ${(maxGrade * 100).toFixed(1)} % (real Suzuka max ~10 %)`);

// query round-trip checks
let ok = true;
for (let i = 0; i < SAMPLES.length; i += 37) {
  const p = SAMPLES[i];
  const q = queryTrack(p.x + p.nrmX * 2, p.z + p.nrmZ * 2, -1);
  if (Math.abs(q.lateral - 2) > 0.5 || !q.onTrack) { ok = false; console.log(`  query mismatch at i=${i}: lateral=${q.lateral.toFixed(2)}`); }
}
console.log(`query round-trip: ${ok ? 'OK' : 'FAILED'}`);

// corner s sanity
for (const [s, name] of CORNERS) if (s < 0 || s > TOTAL_LENGTH) console.log(`corner out of range: ${name}`);

// ASCII map
const W = 110, H = 42;
const grid = Array.from({ length: H }, () => Array(W).fill(' '));
const scale = Math.min((W - 1) / (maxX - minX), (H - 1) / (maxZ - minZ));
const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
for (const p of SAMPLES) {
  const cx = Math.round((p.x - minX) * scale);
  const cy = Math.round((p.z - minZ) * scale);
  if (grid[cy]?.[cx] !== undefined) grid[cy][cx] = chars[Math.floor(p.s / TOTAL_LENGTH * chars.length) % chars.length];
}
{
  const p = SAMPLES[0];
  grid[Math.round((p.z - minZ) * scale)][Math.round((p.x - minX) * scale)] = 'S';
}
console.log('\nmap (S=start, 0-9a-z lap progress, north up):');
console.log(grid.map(r => r.join('')).join('\n'));
