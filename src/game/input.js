// Keyboard + mouse + gamepad input with smoothing for keyboard steering.
// Mouse: hold left button = throttle, hold right button = brake, horizontal
// position steers (center of the window = straight). Mouse mode engages on
// a mouse press and hands back to the keyboard when a steering key is hit.
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
    this.mouseMode = false;
    this.mouseModeChanged = false;   // edge flag for a HUD hint
    this._mouseX = 0.5;              // 0..1 across the window
    this._mouseL = false;
    this._mouseR = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._edges.add(e.code);
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code) && this.mouseMode) {
        this.mouseMode = false;
        this.mouseModeChanged = true;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this._mouseL = this._mouseR = false;
    });

    window.addEventListener('mousemove', (e) => {
      this._mouseX = e.clientX / window.innerWidth;
    });
    window.addEventListener('mousedown', (e) => {
      // ignore clicks on UI (menus, buttons) — only the canvas drives the car
      if (e.target.closest?.('button, #menu, #results')) return;
      if (e.button === 0) this._mouseL = true;
      if (e.button === 2) this._mouseR = true;
      if (!this.mouseMode) { this.mouseMode = true; this.mouseModeChanged = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseL = false;
      if (e.button === 2) this._mouseR = false;
    });
    window.addEventListener('contextmenu', (e) => {
      if (!e.target.closest?.('#menu, #results')) e.preventDefault();
    });
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
    if (this.mouseMode) {
      // window center = straight; full lock at 70 % of the way to the edge
      const n = (this._mouseX - 0.5) * 2;          // -1 (left) .. +1 (right)
      target = Math.max(-1, Math.min(1, -n / 0.7));
      analog = true;
    }
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
    if (this._mouseL) th = 1;
    if (this._mouseR) br = 1;
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
