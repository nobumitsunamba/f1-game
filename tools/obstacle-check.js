// Diagnoses trackside object placements: distance from each object footprint
// to track sections OTHER than the one it belongs to (figure-8 crossings!).
import { SAMPLES, TOTAL_LENGTH, CORNERS } from '../src/track/suzuka.js';

function sampleAt(s) {
  s = ((s % TOTAL_LENGTH) + TOTAL_LENGTH) % TOTAL_LENGTH;
  let lo = 0, hi = SAMPLES.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (SAMPLES[m].s < s) lo = m + 1; else hi = m; }
  return SAMPLES[lo];
}
function nearestOther(x, z, ownS, excl = 150) {
  let best = Infinity, bs = -1;
  for (const p of SAMPLES) {
    let ds = Math.abs(p.s - ownS); ds = Math.min(ds, TOTAL_LENGTH - ds);
    if (ds < excl) continue;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) { best = d; bs = p.s; }
  }
  return { d: Math.sqrt(best), atS: bs };
}
function nearestAny(x, z) {
  let best = Infinity, bs = -1;
  for (const p of SAMPLES) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) { best = d; bs = p.s; }
  }
  return { d: Math.sqrt(best), atS: bs };
}
const at = (s, lat, fwd = 0) => {
  const p = sampleAt(s);
  return { x: p.x + p.nrmX * lat + p.tanX * fwd, z: p.z + p.nrmZ * lat + p.tanZ * fwd, p };
};

console.log('=== Ferris wheel (s=L-420, lat -120, R~40) ===');
{
  const c = at(TOTAL_LENGTH - 420, -120);
  const o = nearestAny(c.x, c.z);
  console.log(`center clearance to ANY track: ${o.d.toFixed(0)} m (at s=${o.atS.toFixed(0)}) — need > 55`);
}

console.log('=== grandstands (footprint front corners & center) ===');
for (const [s, lat, len] of [[150, 28, 300], [760, -42, 140], [2920, 42, 90], [5420, 36, 110]]) {
  for (const f of [-len / 2, 0, len / 2]) {
    for (const depth of [0, -16 * Math.sign(lat)]) {
      const c = at(s, lat + depth, f);
      const o = nearestOther(c.x, c.z, s, 120);
      if (o.d < 25) console.log(`stand s=${s} lat=${lat} pt(f=${f},d=${depth}): ${o.d.toFixed(0)} m to other section s=${o.atS.toFixed(0)}  *** TOO CLOSE`);
    }
  }
  console.log(`stand s=${s} checked`);
}

console.log('=== pit building (s=L-150, lat -32, 320x22, fwd+60) ===');
for (const f of [-100, 0, 100, 220]) {
  for (const lat of [-21, -43]) {
    const c = at(TOTAL_LENGTH - 150, lat, 60 + f);
    const o = nearestOther(c.x, c.z, (TOTAL_LENGTH - 150 + 60 + f + TOTAL_LENGTH) % TOTAL_LENGTH, 200);
    if (o.d < 20) console.log(`pit corner f=${f} lat=${lat}: ${o.d.toFixed(0)} m to other section s=${o.atS.toFixed(0)}  *** TOO CLOSE`);
  }
}
console.log('pit building checked');

console.log('=== ad boards (every 223 m, lat ±(w+9)) ===');
for (let i = 0; i < 26; i++) {
  const s = (i * 223) % TOTAL_LENGTH;
  const p = sampleAt(s);
  if (Math.abs(p.curv) > 0.004) continue;
  const lat = (i % 2 ? 1 : -1) * (Math.max(p.wL, p.wR) + 9);
  const c = at(s, lat);
  const o = nearestOther(c.x, c.z, s, 150);
  if (o.d < 14) console.log(`ad #${i} s=${s.toFixed(0)} lat=${lat.toFixed(0)}: ${o.d.toFixed(1)} m to other section s=${o.atS.toFixed(0)}  *** ON/NEAR OTHER TRACK`);
}
console.log('ads checked');

console.log('=== corner boards & brake markers ===');
for (const [s] of CORNERS) {
  const p = sampleAt(s - 60);
  const side = p.curv > 0 ? 1 : -1;
  const c = at(s - 60, side * (Math.max(p.wL, p.wR) + 6));
  const o = nearestOther(c.x, c.z, s - 60, 120);
  if (o.d < 12) console.log(`corner board s=${s}: ${o.d.toFixed(1)} m to other section s=${o.atS.toFixed(0)}  *** TOO CLOSE`);
}
for (const stop of [695, 2920, 3850, 5395]) {
  for (const d of [100, 50]) {
    const s = stop - 110 - d;
    const p = sampleAt(s);
    const c = at(s, p.wL + 3.5);
    const o = nearestOther(c.x, c.z, s, 120);
    if (o.d < 10) console.log(`brake marker s=${s.toFixed(0)}: ${o.d.toFixed(1)} m to other section s=${o.atS.toFixed(0)}  *** TOO CLOSE`);
  }
}
console.log('boards checked');
