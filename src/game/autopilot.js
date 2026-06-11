// Simple racing autopilot: pure-pursuit steering on the centerline with
// curvature-based speed targets. Used for automated verification
// (window.__sim.autopilot) and as a base for future AI opponents.
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

/** Max cornering speed for curvature k (m^-1), conservative. */
function cornerSpeed(k) {
  if (k < 1e-5) return 95;
  // aLat capacity grows with downforce: solve v^2*k = mu*(g + cz*v^2/m)
  const mu = 1.5, cz = 0.5 * 1.2 * 3.6 / 800, g = 9.81;
  const denom = k / mu - cz;
  if (denom <= 1e-6) return 95;
  return Math.min(95, Math.sqrt(g / denom));
}

export function autopilotControl(car) {
  const s = car.trackS();
  const v = Math.max(5, car.u);

  // --- steering: pure pursuit on a lookahead point ---
  const look = 8 + v * 0.45;
  const tgt = sampleAtS(s + look);
  const dx = tgt.x - car.x, dz = tgt.z - car.z;
  const cosH = Math.cos(car.heading), sinH = Math.sin(car.heading);
  const localY = -dx * sinH + dz * cosH;       // lateral offset of target
  const localX = dx * cosH + dz * sinH;
  let steer = -2.2 * Math.atan2(localY, Math.max(1, localX));
  steer = Math.max(-1, Math.min(1, steer));

  // --- speed: minimum corner speed over braking horizon ---
  let vTarget = 95;
  const horizon = Math.max(60, v * v / (2 * 14) + 30); // ~braking distance @14 m/s²
  for (let d = 0; d < horizon; d += 10) {
    const p = sampleAtS(s + d);
    let idx = 0; // index of p
    idx = Math.max(0, Math.min(N - 1, Math.round(p.s / (TOTAL_LENGTH / N))));
    const vc = cornerSpeed(SMOOTH_CURV[idx]);
    // allowed speed now so that we can slow to vc over distance d
    const vAllow = Math.sqrt(vc * vc + 2 * 13 * Math.max(1, d));
    vTarget = Math.min(vTarget, vAllow);
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
