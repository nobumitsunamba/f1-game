// Engine / wind / surface audio built on WebAudio oscillators.
// 2026 power units: turbo V6 hybrid timbre — saw fundamental + harmonics
// + induction noise, pitch tracking RPM.
export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  ensure() {
    if (this.started) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // engine: 3 detuned saws through a lowpass
    this.oscs = [];
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.20;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 1200;
    this.engGain.connect(this.lp); this.lp.connect(this.master);
    for (const [mult, det, amp] of [[1, 0, 0.5], [2, 6, 0.3], [3, -8, 0.18], [0.5, 3, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const g = ctx.createGain();
      g.gain.value = amp;
      o.detune.value = det;
      o.connect(g); g.connect(this.engGain);
      o.start();
      this.oscs.push({ o, mult });
    }

    // wind / road noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf; this.noise.loop = true;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    this.noiseLp = ctx.createBiquadFilter();
    this.noiseLp.type = 'bandpass'; this.noiseLp.frequency.value = 700;
    this.noise.connect(this.noiseLp); this.noiseLp.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noise.start();

    this.started = true;
  }

  resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(0.8, this.ctx.currentTime, 0.3);
  }

  setMuted(m) {
    if (!this.started) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  update(car, throttle) {
    if (!this.started || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    // firing fundamental: V6 at rpm → 3 pulses/rev
    const f = Math.max(60, car.rpm / 60 * 3);
    for (const { o, mult } of this.oscs) {
      o.frequency.setTargetAtTime(f * mult, t, 0.02);
    }
    const load = 0.32 + throttle * 0.68;
    this.engGain.gain.setTargetAtTime(0.13 + 0.13 * load, t, 0.05);
    this.lp.frequency.setTargetAtTime(700 + car.rpm * 0.32 + throttle * 900, t, 0.05);
    // wind & surface noise with speed; rumble on grass/kerbs
    const sp = Math.min(1, car.speed / 95);
    const off = car.surfaceGrip < 0.95 ? 0.25 : 0;
    this.noiseGain.gain.setTargetAtTime(sp * sp * 0.16 + off * sp, t, 0.08);
    this.noiseLp.frequency.setTargetAtTime(car.surfaceGrip < 0.95 ? 220 : 600 + sp * 900, t, 0.1);
  }
}
