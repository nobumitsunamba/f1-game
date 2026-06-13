// Keyboard + mouse + gamepad input with smoothing for keyboard steering.
// Mouse: hold left button = throttle, hold right button = brake. Steering is
// "pointer-follow": the car turns towards the point on the road the cursor
// rests on (computed in main.js from the camera ray and fed back through
// mouseSteerOverride). Put the cursor on the apex and hold it there — no
// continuous dragging, and the car self-straightens when the cursor sits on
// the road ahead. [ / ] adjust how aggressively it follows. Mouse mode
// engages on a mouse press and hands back to the keyboard on a steering key.
// big high-visibility aiming cursor (yellow ring + center dot)
const AIM_CURSOR = `url('data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">' +
  '<circle cx="18" cy="18" r="11" fill="none" stroke="black" stroke-width="6" opacity="0.85"/>' +
  '<circle cx="18" cy="18" r="11" fill="none" stroke="#ffd400" stroke-width="3.5"/>' +
  '<circle cx="18" cy="18" r="2.6" fill="#ffd400" stroke="black" stroke-width="1.2"/>' +
  '</svg>')}') 18 18, crosshair`;

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
    this.mouseSens = Number(localStorage.getItem('mouse-sens')) || 1.0;
    this.mouseNX = 0;                // cursor in NDC -1..1
    this.mouseNY = 0;
    this.mouseSteerOverride = null;  // set by main.js (pointer-follow result)
    this._mouseL = false;
    this._mouseR = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._edges.add(e.code);
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code) && this.mouseMode) {
        this.setMouseMode(false);
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

    this._steerHold = false;         // respawn: go straight until mouse moves
    this._steerHoldT = 0;
    window.addEventListener('mousemove', (e) => {
      this.mouseNX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNY = -(e.clientY / window.innerHeight) * 2 + 1;
      this._steerHold = false;       // player repositioned: resume following
    });
    window.addEventListener('mousedown', (e) => {
      // ignore clicks on UI (menus, buttons) — only the canvas drives the car
      if (e.target.closest?.('button, #menu, #results')) return;
      if (e.button === 0) this._mouseL = true;
      if (e.button === 2) this._mouseR = true;
      if (!this.mouseMode) this.setMouseMode(true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseL = false;
      if (e.button === 2) this._mouseR = false;
    });
    window.addEventListener('contextmenu', (e) => {
      if (!e.target.closest?.('#menu, #results')) e.preventDefault();
    });
  }

  setMouseMode(on) {
    this.mouseMode = on;
    this.mouseModeChanged = true;
    this.mouseSteerOverride = null;
    document.body.style.cursor = on ? AIM_CURSOR : '';
  }

  /** After a respawn the wheel stays centered until the mouse moves
   *  (browsers cannot move the OS cursor for us), max 3 s. */
  holdSteerUntilMouseMoves() {
    this._steerHold = true;
    this._steerHoldT = performance.now();
  }

  get steerHeld() {
    return this._steerHold && performance.now() - this._steerHoldT < 3000;
  }

  /** Adjust mouse follow strength by steps of 0.2 within 0.4 .. 2.4. */
  bumpMouseSens(dir) {
    this.mouseSens = Math.round(
      Math.max(0.4, Math.min(2.4, this.mouseSens + dir * 0.2)) * 10) / 10;
    localStorage.setItem('mouse-sens', String(this.mouseSens));
    return this.mouseSens;
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
    if (this.mouseMode && this.mouseSteerOverride != null) {
      // pointer-follow steering computed against the camera ray in main.js
      target = this.mouseSteerOverride;
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
