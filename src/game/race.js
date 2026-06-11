// Race mode: manages AI opponents (physics + visuals + autopilot control),
// grid placement, lap counting, standings and simple car-to-car collisions.
import { CarPhysics } from '../car/physics.js';
import { buildCar } from '../car/carModel.js';
import { autopilotControl } from './autopilot.js';
import { TOTAL_LENGTH } from '../track/suzuka.js';

const AI_ASSISTS = { tc: true, abs: true, stability: true, autoGear: true, autoX: true };
const CAR_RADIUS = 1.7;            // collision circle

export class RaceManager {
  /**
   * scene: THREE scene; entries: [{team, driver}] opponents;
   * lapTarget: laps to race; difficulty: pace multiplier (~0.85..1.05)
   */
  constructor(scene, entries, lapTarget, difficulty) {
    this.scene = scene;
    this.lapTarget = lapTarget;
    this.started = false;
    this.raceTime = 0;
    this.cars = entries.map((e, i) => {
      const physics = new CarPhysics();
      const vis = buildCar(e.team, e.driver.num);
      scene.add(vis.group);
      return {
        team: e.team, driver: e.driver, physics, vis,
        pace: (e.driver.pace ?? 0.96) * difficulty,
        bias: ((i % 5) - 2) * 1.1,           // preferred line offset
        reaction: 0.15 + Math.random() * 0.35,
        lap: 0, prevS: 0, progress: 0, stuck: 0,
      };
    });
  }

  /** Place AI on the grid by pace order from P1; player takes the LAST slot.
   *  Returns the player's grid slot index. */
  placeGrid(playerPhysics) {
    this.cars.sort((a, b) => b.pace - a.pace);
    this.cars.forEach((c, i) => {
      const slotS = TOTAL_LENGTH - 14 - i * 9;
      c.physics.reset(slotS, i % 2 === 0 ? 3.2 : -3.2);
      c.prevS = c.physics.trackS();
      c.lap = 0; c.progress = this.progressOf(c.physics, 0);
      c.vis.group.position.set(c.physics.x, c.physics.y, c.physics.z);
      c.vis.group.rotation.set(0, -c.physics.heading, 0);
    });
    const playerSlot = this.cars.length;
    playerPhysics.reset(TOTAL_LENGTH - 14 - playerSlot * 9, playerSlot % 2 === 0 ? 3.2 : -3.2);
    return playerSlot;
  }

  progressOf(physics, lap) {
    let s = physics.trackS();
    // grid positions before the line count as negative progress on lap 0
    if (lap === 0 && s > TOTAL_LENGTH - 200) s -= TOTAL_LENGTH;
    return lap * TOTAL_LENGTH + s;
  }

  start() { this.started = true; }

  /** Fixed-step update for all AI cars. */
  step(dt, playerPhysics) {
    this.raceTime += dt;
    // snapshot for avoidance (includes the player)
    const snapshot = this.cars.map(c => ({
      x: c.physics.x, z: c.physics.z, s: c.physics.trackS(), speed: c.physics.speed,
    }));
    snapshot.push({
      x: playerPhysics.x, z: playerPhysics.z,
      s: playerPhysics.trackS(), speed: playerPhysics.speed,
    });

    this.cars.forEach((c, i) => {
      if (!this.started || this.raceTime < c.reaction) {
        c.physics.step(dt, { throttle: 0, brake: 1, steer: 0 }, AI_ASSISTS);
        return;
      }
      const others = snapshot.filter((_, j) => j !== i);
      const ctl = autopilotControl(c.physics, { pace: c.pace, bias: c.bias, others });
      c.physics.step(dt, ctl, AI_ASSISTS);

      // lap counting
      const s = c.physics.trackS();
      if (c.prevS > TOTAL_LENGTH - 60 && s < 60) c.lap++;
      c.prevS = s;
      c.progress = this.progressOf(c.physics, c.lap);

      // auto-recover an AI that is stuck off track
      if (!c.physics.onTrack && c.physics.speed < 2) {
        c.stuck += dt;
        if (c.stuck > 3) {
          c.physics.reset(s, 0);
          c.physics.u = 10;
          c.stuck = 0;
        }
      } else c.stuck = 0;
    });

    this.resolveCollisions(playerPhysics);
  }

  /** Simple circle push-apart between all cars (including the player). */
  resolveCollisions(playerPhysics) {
    const all = [...this.cars.map(c => c.physics), playerPhysics];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > CAR_RADIUS * 2 || d < 1e-4) continue;
        const push = (CAR_RADIUS * 2 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
        // scrub a little speed off both cars
        a.u *= 0.985; b.u *= 0.985;
        a.wallHit = Math.max(a.wallHit, 0.25);
        b.wallHit = Math.max(b.wallHit, 0.25);
      }
    }
  }

  /** Per-frame visual sync. */
  updateVisuals() {
    for (const c of this.cars) {
      c.vis.group.position.set(c.physics.x, c.physics.y, c.physics.z);
      c.vis.group.rotation.set(0, -c.physics.heading, 0);
      c.vis.update({
        steerAngle: c.physics.steerAngle, xMode: c.physics.xMode,
        pitch: c.physics.pitch, roll: c.physics.roll,
        wheelSpin: c.physics.u / 0.36 / 120,
      });
    }
  }

  /** Standings including the player; sorted by race progress. */
  standings(playerPhysics, playerLap, playerAbbr, playerTeam) {
    const rows = this.cars.map(c => ({
      abbr: c.driver.abbr, team: c.team, lap: c.lap,
      progress: c.progress, isPlayer: false,
    }));
    rows.push({
      abbr: playerAbbr, team: playerTeam, lap: playerLap,
      progress: this.progressOf(playerPhysics, playerLap), isPlayer: true,
    });
    rows.sort((a, b) => b.progress - a.progress);
    return rows;
  }

  dispose() {
    for (const c of this.cars) this.scene.remove(c.vis.group);
    this.cars = [];
  }
}
