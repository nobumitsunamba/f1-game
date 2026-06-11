// Lap & sector timing with best-lap delta.
import { TOTAL_LENGTH, SECTORS } from '../track/suzuka.js';

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export class Timing {
  constructor() {
    this.reset();
    const stored = localStorage.getItem('suzuka-best');
    this.allTimeBest = stored ? Number(stored) : null;
  }

  reset() {
    this.lap = 0;            // 0 = outlap from the grid
    this.lapTime = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.sector = 0;
    this.sectorTimes = [null, null, null];
    this.lastSectors = [null, null, null];
    this.bestSectors = [null, null, null];
    this.prevS = 0;
    this.running = false;
    // delta reference: time at each 10 m of the best lap
    this.ref = null;
    this.cur = new Float32Array(Math.ceil(TOTAL_LENGTH / 10) + 1).fill(NaN);
    this.delta = null;
    this.lapJustCompleted = null;
  }

  start() { this.running = true; }

  update(dt, s) {
    this.lapJustCompleted = null;
    if (!this.running) { this.prevS = s; return; }
    this.lapTime += dt;

    // record progress for delta
    const bin = Math.floor(s / 10);
    if (bin >= 0 && bin < this.cur.length && isNaN(this.cur[bin])) this.cur[bin] = this.lapTime;
    if (this.ref && bin < this.ref.length && !isNaN(this.ref[bin]) && !isNaN(this.cur[bin])) {
      this.delta = this.cur[bin] - this.ref[bin];
    }

    // sector crossings
    const crossed = (mark) => this.prevS < mark && s >= mark;
    if (this.sector === 0 && crossed(SECTORS[0])) {
      this.sectorTimes[0] = this.lapTime; this.sector = 1;
    } else if (this.sector === 1 && crossed(SECTORS[1])) {
      this.sectorTimes[1] = this.lapTime; this.sector = 2;
    }

    // start/finish crossing (s wraps from high to low)
    if (this.prevS > TOTAL_LENGTH - 60 && s < 60) {
      if (this.lap > 0) {
        this.sectorTimes[2] = this.lapTime;
        this.lastLap = this.lapTime;
        this.lastSectors = this.sectorTimes.map((t, i) =>
          i === 0 ? t : (t != null && this.sectorTimes[i - 1] != null ? t - this.sectorTimes[i - 1] : null));
        this.lastSectors.forEach((t, i) => {
          if (t != null && (this.bestSectors[i] == null || t < this.bestSectors[i])) this.bestSectors[i] = t;
        });
        if (this.bestLap == null || this.lapTime < this.bestLap) {
          this.bestLap = this.lapTime;
          this.ref = this.cur.slice();
          if (this.allTimeBest == null || this.lapTime < this.allTimeBest) {
            this.allTimeBest = this.lapTime;
            localStorage.setItem('suzuka-best', String(this.lapTime));
          }
        }
        this.lapJustCompleted = this.lapTime;
      }
      this.lap++;
      this.lapTime = 0;
      this.sector = 0;
      this.sectorTimes = [null, null, null];
      this.cur.fill(NaN);
      this.delta = null;
    }
    this.prevS = s;
  }
}
