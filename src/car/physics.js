// Vehicle dynamics for a 2026-regulation F1 car.
// Planar two-track-simplified ("bicycle") model with:
//  - Pacejka-style tire curves with load sensitivity and a friction circle
//  - aero downforce/drag with 2026 active aero (Z-mode / X-mode) and
//    manual ERS override boost with per-lap energy budget
//  - longitudinal load transfer, 8-speed gearbox, surface-dependent grip
// Integrated at a fixed 240 Hz substep for stability.

import { queryTrack, wallDistance, SAMPLES, TOTAL_LENGTH } from '../track/suzuka.js';

const G = 9.81;
const RHO = 1.2;

export const CAR = {
  mass: 800,                 // kg incl. driver + fuel (2026 min 768 + fuel)
  inertiaYaw: 1000,          // kg m^2
  wheelbase: 3.40,           // 2026 max wheelbase
  cgToFront: 1.62,
  cgToRear: 1.78,
  cgHeight: 0.30,
  wheelRadius: 0.36,
  // aero (Z-mode = high downforce; X-mode = low drag on straights)
  cdAZ: 1.30, clAZ: 3.6,
  cdAX: 0.78, clAX: 1.9,
  aeroBalanceFront: 0.43,
  // power unit: ~400 kW ICE + 350 kW ERS deployment (2026 regs), capped
  // here to a drivable combined figure + manual override boost
  powerBase: 560e3,          // W
  powerBoost: 120e3,         // W extra with override
  ersCapacity: 4.0e6,        // J per lap of override energy
  ersRegen: 250e3,           // W harvested under braking
  revLimit: 11500,
  idleRpm: 4000,
  gears: [2.85, 2.28, 1.86, 1.56, 1.33, 1.15, 1.01, 0.90],
  finalDrive: 3.6,
  brakeForceMax: 62e3,       // N total at full pedal (before grip limit)
  muTire: 1.85,              // peak tire friction coefficient
  loadSensitivity: 0.08,     // mu falls with load: mu*(Fz0/Fz)^ls
  steerLockLow: 0.34,        // rad max road-wheel angle at low speed
  steerLockHigh: 0.045,      // rad at vMax
  rollingResist: 320,        // N constant
};

const SLIP_PEAK = 0.105;     // rad slip angle at peak lateral force

// Normalized lateral force vs slip. Shape constant C controls post-peak
// falloff: the front falls off harder than the rear so the limit behavior
// is stabilizing understeer instead of an unconditional spin.
const CURVE_B = 1.45;
const CURVE_C_FRONT = 1.60;
const CURVE_C_REAR = 1.22;

function tireForceCurve(slipRatio, C = CURVE_C_REAR) {
  return Math.sin(C * Math.atan(CURVE_B * slipRatio));
}

export class CarPhysics {
  constructor() {
    this.reset(0, 0);
  }

  /** Place the car at track distance s, stationary, facing along the track. */
  reset(s = 0, lateral = 0) {
    const n = SAMPLES.length;
    let idx = 0;
    while (idx < n - 1 && SAMPLES[idx + 1].s < s) idx++;
    const p = SAMPLES[idx];
    this.x = p.x + p.nrmX * lateral;
    this.z = p.z + p.nrmZ * lateral;
    this.heading = Math.atan2(p.tanZ, p.tanX);
    this.u = 0; this.v = 0; this.r = 0;       // body-frame fwd/lat vel, yaw rate
    this.gear = 0;                            // index into CAR.gears
    this.rpm = CAR.idleRpm;
    this.trackIdx = idx;
    this.ers = CAR.ersCapacity;
    this.xMode = false;
    this.onTrack = true;
    this.surfaceGrip = 1;
    this.aLat = 0; this.aLong = 0;
    this.slipFront = 0; this.slipRear = 0;
    this.steerAngle = 0;
    this.throttleOut = 0; this.brakeOut = 0;
    this.lockF = false; this.lockR = false;
    this.wallHit = 0;
    this.y = p.y;
    this.pitch = 0; this.roll = 0;
    this.grade = 0;
  }

  get speed() { return Math.hypot(this.u, this.v); }
  get speedKmh() { return this.speed * 3.6; }

  /**
   * Advance physics.
   * input: { throttle 0..1, brake 0..1, steer -1..1 (left+), boost bool,
   *          xModeRequest bool, gearUp, gearDown (edge-triggered booleans) }
   * assists: { abs, tc, stability, autoGear, autoX }
   */
  step(dt, input, assists) {
    const SUB = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / SUB;
    for (let i = 0; i < SUB; i++) this.substep(h, input, assists);
    if (input.gearUp) this.shift(1);
    if (input.gearDown) this.shift(-1);
  }

  shift(d) {
    this.gear = Math.min(CAR.gears.length - 1, Math.max(0, this.gear + d));
  }

  substep(h, input, assists) {
    const c = CAR;
    const q = queryTrack(this.x, this.z, this.trackIdx);
    this.trackIdx = q.idx;
    this.onTrack = q.onTrack;
    this.grade = q.grade;

    // ---- surface ----
    const lat = q.lateral;
    const sample = q.sample;
    const kerbL = sample.wL + 1.4, kerbR = sample.wR + 1.4;
    let grip, extraDrag = 0;
    if (lat <= sample.wL && lat >= -sample.wR) {
      grip = 1;                                   // asphalt
    } else if (lat <= kerbL && lat >= -kerbR) {
      grip = 0.92; extraDrag = 200;               // kerb
    } else {
      grip = 0.52; extraDrag = 1800 + 18 * this.speed; // grass / gravel
    }
    this.surfaceGrip = grip;

    // ---- active aero (2026): X-mode on demand, auto-managed if assist on ----
    let xMode = input.xModeRequest;
    if (assists.autoX) {
      // open on straights at speed & low lateral demand, close when turning/braking
      xMode = this.speed > 55 && Math.abs(this.aLat) < 4 && input.brake < 0.05 &&
        Math.abs(this.steerAngle) < 0.03;
    }
    // X-mode physically closes under braking or steering
    if (input.brake > 0.15 || Math.abs(input.steer) > 0.4) xMode = false;
    this.xMode = xMode && this.speed > 25;
    const cdA = this.xMode ? c.cdAX : c.cdAZ;
    const clA = this.xMode ? c.clAX : c.clAZ;

    const vSq = this.u * this.u;
    const downforce = 0.5 * RHO * clA * vSq;
    const dragN = 0.5 * RHO * cdA * vSq + c.rollingResist + extraDrag;

    // ---- steering with speed-sensitive lock ----
    // input.steer is "+ = left"; internal convention is "+ = right"
    // (heading increases clockwise seen from above), hence the negation.
    const lockBlend = Math.min(1, this.speed / 75);
    const lock = c.steerLockLow + (c.steerLockHigh - c.steerLockLow) * lockBlend;
    const steerTarget = -input.steer * lock;
    // driver-arm rate limit keeps keyboard input controllable
    const steerRate = 4.2 * lock;
    const dS = steerTarget - this.steerAngle;
    this.steerAngle += Math.sign(dS) * Math.min(Math.abs(dS), steerRate * h * 60 * 0.06);
    // steering assist (part of stability): clamp the road-wheel angle so the
    // front slip angle stays near its grip peak — a saturated front otherwise
    // keeps yawing the car until the rear lets go (instant spin on keyboard)
    if (assists.stability && this.u > 8) {
      const flow = Math.atan2(this.v + c.cgToFront * this.r, this.u);
      const lim = 1.25 * SLIP_PEAK;
      this.steerAngle = Math.max(flow - lim, Math.min(flow + lim, this.steerAngle));
    }

    // ---- axle loads (static + aero + longitudinal transfer) ----
    const m = c.mass;
    const wStaticF = m * G * (c.cgToRear / c.wheelbase);
    const wStaticR = m * G * (c.cgToFront / c.wheelbase);
    const transfer = m * this.aLong * (c.cgHeight / c.wheelbase);
    let fzF = Math.max(200, wStaticF + downforce * c.aeroBalanceFront - transfer);
    let fzR = Math.max(200, wStaticR + downforce * (1 - c.aeroBalanceFront) + transfer);

    // front fractionally weaker than the rear: mild limit understeer
    const muF = 0.965 * grip * c.muTire * Math.pow(wStaticF / fzF, c.loadSensitivity);
    const muR = grip * c.muTire * Math.pow(wStaticR / fzR, c.loadSensitivity);

    // ---- longitudinal forces ----
    const speed = Math.max(0.5, this.u);
    // engine
    let power = c.powerBase;
    if (input.boost && this.ers > 0) power += c.powerBoost;
    let throttle = input.throttle;
    let driveForce = throttle * power / Math.max(8, this.u);
    // traction control: friction-circle budget + hard cut on rear slip
    const rearCap = muR * fzR;
    if (assists.tc) {
      const latDemandR = Math.abs(this.slipRear) / SLIP_PEAK;
      const longBudget = rearCap * Math.sqrt(Math.max(0.06, 1 - Math.min(1, latDemandR) ** 2 * 0.88));
      driveForce = Math.min(driveForce, longBudget);
      const over = (Math.abs(this.slipRear) - 1.2 * SLIP_PEAK) / SLIP_PEAK;
      if (over > 0) driveForce *= Math.max(0, 1 - over * 1.5);
    }
    this.throttleOut = throttle;

    // brakes — per-axle, grip-limited. Without ABS an over-braked axle locks:
    // less retardation and a collapse of lateral grip on that axle.
    const brakeDemand = input.brake * c.brakeForceMax;
    let brakeF = brakeDemand * 0.58, brakeR = brakeDemand * 0.42;
    const capF = muF * fzF, capR = muR * fzR;
    let lockF = false, lockR = false;
    if (assists.abs) {
      brakeF = Math.min(brakeF, capF * 0.96);
      brakeR = Math.min(brakeR, capR * 0.94);
    } else {
      if (brakeF > capF) { lockF = true; brakeF = capF * 0.78; }
      if (brakeR > capR) { lockR = true; brakeR = capR * 0.78; }
    }
    this.lockF = lockF && this.u > 3;
    this.lockR = lockR && this.u > 3;
    this.brakeOut = input.brake;

    // ERS energy accounting
    if (input.boost && input.throttle > 0.2 && this.ers > 0) {
      this.ers = Math.max(0, this.ers - c.powerBoost * h);
    }
    if (input.brake > 0.3 && this.u > 15) {
      this.ers = Math.min(c.ersCapacity, this.ers + c.ersRegen * h);
    }

    // ---- slip angles & lateral tire forces ----
    const u = Math.max(2.0, this.u);
    const alphaF = Math.atan2(this.v + c.cgToFront * this.r, u) - this.steerAngle;
    const alphaR = Math.atan2(this.v - c.cgToRear * this.r, u);
    this.slipFront = alphaF; this.slipRear = alphaR;

    // friction circle: longitudinal use reduces lateral capacity
    const fxR = driveForce - (brakeR + dragN * 0.5) * Math.sign(this.u);
    const fxF = -(brakeF + dragN * 0.5) * Math.sign(this.u);
    const latCapF = Math.sqrt(Math.max(0.02, 1 - Math.min(1, Math.abs(fxF) / (muF * fzF)) ** 2));
    const latCapR = Math.sqrt(Math.max(0.02, 1 - Math.min(1, Math.abs(fxR) / (muR * fzR)) ** 2));

    let fyF = -muF * fzF * latCapF * tireForceCurve(alphaF / SLIP_PEAK, CURVE_C_FRONT);
    let fyR = -muR * fzR * latCapR * tireForceCurve(alphaR / SLIP_PEAK, CURVE_C_REAR);

    // locked wheels slide: steering (front) / stability (rear) collapse
    if (this.lockF) fyF *= 0.25;
    if (this.lockR) fyR *= 0.25;

    // ---- equations of motion (body frame) ----
    const fLong = fxR + fxF * Math.cos(this.steerAngle) - fyF * Math.sin(this.steerAngle)
      - m * G * this.grade;                     // gravity along slope
    const fLat = fyR + fyF * Math.cos(this.steerAngle) + fxF * Math.sin(this.steerAngle);
    let yawM = c.cgToFront * (fyF * Math.cos(this.steerAngle) + fxF * Math.sin(this.steerAngle))
      - c.cgToRear * fyR;

    // stability assist (ESC): corrective yaw moment towards the yaw rate the
    // driver is asking for, capped by available grip — catches the rear
    // stepping out instead of merely damping rotation
    if (assists.stability && this.u > 6) {
      const ayMax = (muF * fzF + muR * fzR) / m;
      let rDes = this.u * this.steerAngle / (c.wheelbase + 0.0030 * this.u * this.u);
      const rCap = 1.15 * ayMax / this.u;
      rDes = Math.max(-rCap, Math.min(rCap, rDes));
      yawM += 6500 * (rDes - this.r);
    }

    this.aLong = fLong / m;
    this.aLat = fLat / m;

    this.u += (this.aLong + this.r * this.v) * h;
    this.v += (this.aLat - this.r * this.u) * h;
    this.r += (yawM / c.inertiaYaw) * h;

    // low-speed sanitation: prevent reverse creep and lateral jitter
    if (this.u < 0.4 && input.throttle < 0.05) { this.u = Math.max(0, this.u); }
    if (this.u < 3) { this.v *= 0.86; this.r *= 0.86; }
    if (this.u < 0) this.u = 0;

    // ---- integrate pose ----
    const cosH = Math.cos(this.heading), sinH = Math.sin(this.heading);
    this.x += (this.u * cosH - this.v * sinH) * h;
    this.z += (this.u * sinH + this.v * cosH) * h;
    this.heading += this.r * h;

    // ---- wall collision (clamp lateral offset) ----
    const q2 = queryTrack(this.x, this.z, this.trackIdx);
    this.trackIdx = q2.idx;
    const wallL = wallDistance(q2.idx, 1), wallR = wallDistance(q2.idx, -1);
    if (q2.lateral > wallL || q2.lateral < -wallR) {
      const p = q2.sample;
      const lim = q2.lateral > wallL ? wallL : -wallR;
      this.x = p.x + p.nrmX * lim + p.tanX * (q2.s - p.s);
      this.z = p.z + p.nrmZ * lim + p.tanZ * (q2.s - p.s);
      // kill outward velocity; tangential speed loses a one-off hit
      // proportional to impact severity plus light per-substep rubbing —
      // a continuous heavy scrub here pinned cars against the wall forever
      const wx = this.u * cosH - this.v * sinH, wz = this.u * sinH + this.v * cosH;
      const outSign = Math.sign(q2.lateral);
      const nDot = wx * p.nrmX * outSign + wz * p.nrmZ * outSign;
      let nwx = wx - Math.max(0, nDot) * p.nrmX * outSign;
      let nwz = wz - Math.max(0, nDot) * p.nrmZ * outSign;
      const impact = Math.max(0, nDot);
      const keep = Math.max(0.55, 1 - impact * 0.03) * 0.998;
      nwx *= keep; nwz *= keep;
      this.u = nwx * cosH + nwz * sinH;
      this.v = -nwx * sinH + nwz * cosH;
      this.r *= 0.9;
      this.wallHit = Math.min(1.5, impact * 0.05 + (impact > 0.5 ? 0.3 : 0.05));
    } else {
      this.wallHit = Math.max(0, this.wallHit - h * 2);
    }

    // ---- vertical pose from track surface ----
    this.y = q2.y;
    const ahead = SAMPLES[(q2.idx + 3) % SAMPLES.length];
    const behind = SAMPLES[(q2.idx - 3 + SAMPLES.length) % SAMPLES.length];
    const ds = Math.max(1, Math.abs(ahead.s - behind.s));
    this.pitch = -Math.atan2(ahead.y - behind.y, ds);
    this.roll = this.aLat * 0.004;

    // ---- gearbox / rpm ----
    if (assists.autoGear) {
      const upRpm = 11200, downRpm = 8200;
      let rpm = this.rpmFor(this.gear);
      while (rpm > upRpm && this.gear < c.gears.length - 1) { this.gear++; rpm = this.rpmFor(this.gear); }
      while (rpm < downRpm && this.gear > 0) { this.gear--; rpm = this.rpmFor(this.gear); }
    }
    const target = Math.max(c.idleRpm, Math.min(c.revLimit, this.rpmFor(this.gear)));
    this.rpm += (target - this.rpm) * Math.min(1, h * 28);
  }

  rpmFor(g) {
    return this.u / CAR.wheelRadius * CAR.gears[g] * CAR.finalDrive * 60 / (2 * Math.PI);
  }

  /** Lap progress in meters along the centerline. */
  trackS() {
    const p = SAMPLES[this.trackIdx];
    const dx = this.x - p.x, dz = this.z - p.z;
    let s = p.s + dx * p.tanX + dz * p.tanZ;
    if (s < 0) s += TOTAL_LENGTH;
    return s % TOTAL_LENGTH;
  }
}
