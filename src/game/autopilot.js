// Racing autopilot: pure-pursuit steering on the centerline with
// curvature-based speed targets. Drives the AI opponents in race mode and
// the automated verification (window.__sim.autopilot / simulate()).
import { SAMPLES, TOTAL_LENGTH } from '../track/suzuka.js';

const N = SAMPLES.length;

function sampleAtS(s) {
  s = ((s % TOTAL_LENGTH) + TOTAL_LENGTH) % TOTAL_LENGTH;
  let lo = 0, hi = N - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (SAMPLES[mid].s < s) lo = mid + 1; else hi = mid;
  }
  return SAMPLES[lo];
}

// smoothed |curvature| lookup
const SMOOTH_CURV = SAMPLES.map((_, i) => {
  let c = 0;
  for (let k = -3; k <= 3; k++) c += Math.abs(SAMPLES[(i + k + N) % N].curv);
  return c / 7;
});

/** Max cornering speed for curvature k (m^-1). */
function cornerSpeed(k, pace) {
  const vMax = 95 * pace;
  if (k < 1e-5) return vMax;
  // aLat capacity grows with downforce: solve v^2*k = mu*(g + cz*v^2/m)
  const mu = 1.5 * pace, cz = 0.5 * 1.2 * 3.6 / 800, g = 9.81;
  const denom = k / mu - cz;
  if (denom <= 1e-6) return vMax;
  return Math.min(vMax, Math.sqrt(g / denom));
}

/**
 * Compute controls for one car.
 * opts: { pace: speed scale (~0.85..1.05), bias: preferred lateral offset m,
 *         others: [{x, z, s, speed}] other cars for avoidance }
 */
export function autopilotControl(car, opts = {}) {
  const pace = opts.pace ?? 1;
  const bias = opts.bias ?? 0;
  const s = car.trackS();
  const v = Math.max(5, car.u);

  // --- avoidance: nearest car ahead in my corridor ---
  let aheadGap = Infinity, aheadSpeed = 0, passSide = 0;
  if (opts.others) {
    for (const o of opts.others) {
      let ds = o.s - s;
      if (ds < -50) ds += TOTAL_LENGTH;
      if (ds < 2 || ds > 45) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 48) continue;
      // lateral separation in my frame
      const cosH = Math.cos(car.heading), sinH = Math.sin(car.heading);
      const lat = -dx * sinH + dz * cosH;
      if (Math.abs(lat) > 4.2) continue;
      if (ds < aheadGap) {
        aheadGap = ds;
        aheadSpeed = o.speed;
        passSide = lat >= 0 ? -1 : 1;   // go to the side with more room
      }
    }
  }

  // --- steering: pure pursuit on a lookahead point (with lateral bias) ---
  const look = 8 + v * 0.45;
  const tgt = sampleAtS(s + look);
  let lateral = bias;
  if (aheadGap < 30) lateral = Math.max(-4.5, Math.min(4.5, bias + passSide * 3.2));
  const maxLat = Math.min(tgt.wL, tgt.wR) - 2.2;
  lateral = Math.max(-maxLat, Math.min(maxLat, lateral));
  const tx = tgt.x + tgt.nrmX * lateral, tz = tgt.z + tgt.nrmZ * lateral;
  const dx = tx - car.x, dz = tz - car.z;
  const cosH = Math.cos(car.heading), sinH = Math.sin(car.heading);
  const localY = -dx * sinH + dz * cosH;       // lateral offset of target
  const localX = dx * cosH + dz * sinH;
  let steer = -2.2 * Math.atan2(localY, Math.max(1, localX));
  steer = Math.max(-1, Math.min(1, steer));

  // --- speed: minimum corner speed over braking horizon ---
  let vTarget = 95 * pace;
  const horizon = Math.max(60, v * v / (2 * 14) + 30); // ~braking distance @14 m/s²
  for (let d = 0; d < horizon; d += 10) {
    const p = sampleAtS(s + d);
    const idx = Math.max(0, Math.min(N - 1, Math.round(p.s / (TOTAL_LENGTH / N))));
    const vc = cornerSpeed(SMOOTH_CURV[idx], pace);
    // allowed speed now so that we can slow to vc over distance d
    const vAllow = Math.sqrt(vc * vc + 2 * 13 * Math.max(1, d));
    vTarget = Math.min(vTarget, vAllow);
  }
  // don't run into the car ahead: match its speed as the gap closes
  if (aheadGap < 22) {
    vTarget = Math.min(vTarget, aheadSpeed + (aheadGap - 7) * 0.6);
  }

  let throttle = 0, brake = 0;
  if (v < vTarget - 1.5) throttle = 1;
  else if (v > vTarget + 1) brake = Math.min(1, (v - vTarget) * 0.25);
  else throttle = 0.35;

  return {
    steer, throttle, brake,
    boost: false, xModeRequest: false, gearUp: false, gearDown: false,
  };
}
