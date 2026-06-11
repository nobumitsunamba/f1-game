// Keyboard + gamepad input with smoothing for keyboard steering.
export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;          // -1..1 (+ = left)
    this.throttle = 0;
    this.brake = 0;
    this.boost = false;
    this.xModeRequest = false;
    this.gearUp = false;
    this.gearDown = false;
    this._edges = new Set();
    this.toggles = {};       // edge-triggered named keys

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._edges.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Edge-triggered: was this key pressed since last frame? */
  pressed(code) { return this._edges.has(code); }

  update(dt) {
    const k = this.keys;
    const pad = navigator.getGamepads?.()[0];

    // --- steering ---
    let target = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) target += 1;
    if (k.has('ArrowRight') || k.has('KeyD')) target -= 1;
    let analog = false;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.06) { target = -ax; analog = true; }
    }
    if (analog) {
      this.steer = target;
    } else {
      // keyboard: rate-based with strong self-centering
      const rate = 3.4, center = 5.2;
      if (target !== 0) {
        this.steer += target * rate * dt;
        if (Math.sign(this.steer) !== Math.sign(target)) this.steer += target * center * dt;
      } else {
        const back = Math.sign(this.steer) * center * dt;
        this.steer = Math.abs(back) > Math.abs(this.steer) ? 0 : this.steer - back;
      }
      this.steer = Math.max(-1, Math.min(1, this.steer));
    }

    // --- pedals ---
    let th = (k.has('ArrowUp') || k.has('KeyW')) ? 1 : 0;
    let br = (k.has('ArrowDown') || k.has('KeyS')) ? 1 : 0;
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.02) th = rt;
      if (lt > 0.02) br = lt;
    }
    // keyboard pedal ramp for smoother weight transfer
    const ramp = 6.5 * dt;
    this.throttle += Math.max(-ramp * 2.2, Math.min(ramp, th - this.throttle));
    this.brake += Math.max(-ramp * 3, Math.min(ramp * 1.6, br - this.brake));

    this.boost = k.has('Space') || !!(pad?.buttons[0]?.pressed);
    this.xModeRequest = k.has('KeyX') || !!(pad?.buttons[2]?.pressed);

    this.gearUp = this._edges.has('ShiftLeft') || this._edges.has('KeyE') ||
      !!(pad?.buttons[5]?.pressed && !this._padUp);
    this.gearDown = this._edges.has('ControlLeft') || this._edges.has('KeyQ') ||
      !!(pad?.buttons[4]?.pressed && !this._padDown);
    this._padUp = !!pad?.buttons[5]?.pressed;
    this._padDown = !!pad?.buttons[4]?.pressed;
  }

  endFrame() { this._edges.clear(); }
}
