// Diagnoses cornering stability: step-steer tests across speed / throttle /
// steer combinations, reporting rear slip and spin behavior.
import { CarPhysics } from '../src/car/physics.js';

const assists = { tc: true, abs: true, stability: true, autoGear: true, autoX: false };

function test(kmh, steer, throttle, seconds = 3, opts = {}) {
  const car = new CarPhysics();
  car.reset(100, 0);
  car.u = kmh / 3.6;
  const input = { throttle, brake: 0, steer, boost: false, xModeRequest: false, gearUp: false, gearDown: false };
  let maxSlipR = 0, maxSlipF = 0, maxR = 0, spun = false, tOff = null;
  const a = { ...assists, ...opts };
  for (let t = 0; t < seconds; t += 1 / 120) {
    car.step(1 / 120, input, a);
    if (!car.onTrack) { tOff = t; break; }      // evaluate on-track behavior only
    maxSlipR = Math.max(maxSlipR, Math.abs(car.slipRear));
    maxSlipF = Math.max(maxSlipF, Math.abs(car.slipFront));
    maxR = Math.max(maxR, Math.abs(car.r));
    // spin = big rear slip while still carrying speed on the track
    if (Math.abs(car.slipRear) > 0.6 && car.speed > 5) spun = true;
  }
  const deg = (x) => (x * 180 / Math.PI).toFixed(1);
  return `v=${kmh}km/h steer=${steer} thr=${throttle}: slipF ${deg(maxSlipF)}° slipR ${deg(maxSlipR)}° r ${maxR.toFixed(2)} ${spun ? '*** SPIN ***' : 'ok'}${tOff != null ? ` (off-track @${tOff.toFixed(1)}s, ${Math.round(car.speedKmh)}km/h)` : ` (end ${Math.round(car.speedKmh)}km/h)`}`;
}

console.log('--- full assists, step steer, no throttle ---');
for (const v of [80, 120, 160, 200, 250]) console.log(test(v, 1, 0));
console.log('--- full assists, step steer + half throttle ---');
for (const v of [80, 120, 160, 200]) console.log(test(v, 1, 0.5));
console.log('--- full assists, step steer + FULL throttle ---');
for (const v of [80, 120, 160, 200]) console.log(test(v, 1, 1));
console.log('--- moderate steer (0.4) + full throttle ---');
for (const v of [80, 120, 160, 200]) console.log(test(v, 0.4, 1));
console.log('--- TC OFF, steer 0.4 + full throttle ---');
for (const v of [80, 120, 160]) console.log(test(v, 0.4, 1, 3, { tc: false }));
console.log('--- low speed launch: steer 1 + full throttle from 40 km/h ---');
console.log(test(40, 1, 1));
console.log(test(60, 1, 1));
