// Race mode: manages AI opponents (physics + visuals + autopilot control),
// grid placement, lap counting, standings and simple car-to-car collisions.
import { CarPhysics } from '../car/physics.js';
import { buildCar } from '../car/carModel.js';
import { autopilotControl } from './autopilot.js';
import { TOTAL_LENGTH } from '../track/suzuka.js';

const AI_ASSISTS = { tc: true, abs: true, stability: true, autoGear: true, autoX: true };
// Collision body: two circles per car (front/rear), matching the real ~2 m
// width — a single fat circle made cars "touch" while merely running
// side-by-side on the grid, invisibly scrubbing speed at every pass.
const COLL_R = 1.0;
const COLL_OFF = 1.3;
const GRID_GAP = 13;               // distance between grid slots (m)

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
      const slotS = TOTAL_LENGTH - 14 - i * GRID_GAP;
      c.physics.reset(slotS, i % 2 === 0 ? 3.2 : -3.2);
      c.prevS = c.physics.trackS();
      c.lap = 0; c.progress = this.progressOf(c.physics, 0);
      c.vis.group.position.set(c.physics.x, c.physics.y, c.physics.z);
      c.vis.group.rotation.set(0, -c.physics.heading, 0);
    });
    const playerSlot = this.cars.length;
    playerPhysics.reset(TOTAL_LENGTH - 14 - playerSlot * GRID_GAP,
      playerSlot % 2 === 0 ? 3.2 : -3.2);
    return playerSlot;
  }

  progressOf(physics, lap) {
    // lap counts line crossings (0 on the grid, 1 right after the start),
    // so continuous race distance is (lap-1) laps plus the current s —
    // the grid stretch before the line comes out negative as it should.
    return (lap - 1) * TOTAL_LENGTH + physics.trackS();
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

  /** Car-to-car contact: two circles per car, push apart, and damp only the
   *  closing velocity — side-by-side running and resting contact must not
   *  bleed speed, and a stopped car must be able to drive away again. */
  resolveCollisions(playerPhysics) {
    const all = [...this.cars.map(c => c.physics), playerPhysics];
    const dirs = all.map(p => [Math.cos(p.heading), Math.sin(p.heading)]);
    for (let i = 0; i < all.length; i++) {
      const a = all[i], [axd, azd] = dirs[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j], [bxd, bzd] = dirs[j];
        const cdx = b.x - a.x, cdz = b.z - a.z;
        if (cdx * cdx + cdz * cdz > 49) continue;          // > 7 m apart
        for (const sa of [-COLL_OFF, COLL_OFF]) {
          for (const sb of [-COLL_OFF, COLL_OFF]) {
            const dx = (b.x + bxd * sb) - (a.x + axd * sa);
            const dz = (b.z + bzd * sb) - (a.z + azd * sa);
            const d = Math.hypot(dx, dz);
            if (d > COLL_R * 2 || d < 1e-4) continue;
            const nx = dx / d, nz = dz / d;
            const push = (COLL_R * 2 - d) / 2 + 0.02;
            a.x -= nx * push; a.z -= nz * push;
            b.x += nx * push; b.z += nz * push;
            // closing speed along the contact normal (fwd velocity only)
            const vax = a.u * axd, vaz = a.u * azd;
            const vbx = b.u * bxd, vbz = b.u * bzd;
            const closing = (vbx - vax) * nx + (vbz - vaz) * nz;
            if (closing < -0.2) {
              const k = Math.min(0.06, -closing * 0.012);
              if (vax * nx + vaz * nz > 0) a.u *= 1 - k;   // a drives into b
              if (vbx * nx + vbz * nz < 0) b.u *= 1 - k;   // b drives into a
              a.wallHit = Math.max(a.wallHit, 0.15);
              b.wallHit = Math.max(b.wallHit, 0.15);
            }
          }
        }
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
