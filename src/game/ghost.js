// Best-lap ghost: records the player's lap and replays the fastest one.
export class Ghost {
  constructor() {
    this.recording = [];           // {t, x, y, z, heading}
    this.best = this.loadStored();
    this.playT = 0;
  }

  loadStored() {
    try {
      const raw = localStorage.getItem('suzuka-ghost');
      if (!raw) return null;
      const g = JSON.parse(raw);
      return Array.isArray(g) && g.length > 10 ? g : null;
    } catch { return null; }
  }

  beginLap() {
    this.recording = [];
  }

  record(t, car) {
    const last = this.recording[this.recording.length - 1];
    if (!last || t - last.t >= 0.08) {
      this.recording.push({
        t: Math.round(t * 1000) / 1000,
        x: Math.round(car.x * 100) / 100,
        y: Math.round(car.y * 100) / 100,
        z: Math.round(car.z * 100) / 100,
        h: Math.round(car.heading * 1000) / 1000,
      });
    }
  }

  /** Call when a lap completes; keeps it as ghost if it's the best. */
  lapDone(lapTime, isBest) {
    if (isBest && this.recording.length > 10) {
      this.best = this.recording;
      try { localStorage.setItem('suzuka-ghost', JSON.stringify(this.best)); } catch { /* full */ }
    }
    this.recording = [];
  }

  /** Sample ghost pose at lap-time t; returns null when no ghost. */
  poseAt(t) {
    const g = this.best;
    if (!g || g.length < 2) return null;
    if (t <= g[0].t) return g[0];
    if (t >= g[g.length - 1].t) return null; // ghost finished
    let lo = 0, hi = g.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (g[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = g[lo], b = g[hi];
    const u = (t - a.t) / (b.t - a.t || 1);
    let dh = b.h - a.h;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
      h: a.h + dh * u,
    };
  }

  clear() {
    this.best = null;
    localStorage.removeItem('suzuka-ghost');
    localStorage.removeItem('suzuka-best');
  }
}
