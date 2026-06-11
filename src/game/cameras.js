// Camera rigs: cockpit (with halo framing), chase, and trackside TV cameras.
import * as THREE from 'three';
import { SAMPLES, TOTAL_LENGTH } from '../track/suzuka.js';

export const CAMERA_MODES = ['チェイス', 'コックピット', 'TV中継', 'ドライバー視点'];

// trackside TV camera positions every ~350 m, offset from the racing line
const TV_CAMS = [];
for (let s = 100; s < TOTAL_LENGTH; s += 350) {
  let idx = 0;
  while (idx < SAMPLES.length - 1 && SAMPLES[idx + 1].s < s) idx++;
  const p = SAMPLES[idx];
  TV_CAMS.push(new THREE.Vector3(
    p.x + p.nrmX * (p.wL + 16), p.y + 7, p.z + p.nrmZ * (p.wL + 16)));
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
  }

  cycle() { this.mode = (this.mode + 1) % CAMERA_MODES.length; }

  update(car, dt) {
    const sinH = Math.sin(car.heading), cosH = Math.cos(car.heading);
    const fwd = new THREE.Vector3(cosH, 0, sinH);
    const carPos = new THREE.Vector3(car.x, car.y, car.z);
    const speed = car.speed;

    // shake from kerbs / grass / wall hits
    const wantShake =
      (car.surfaceGrip < 1 && speed > 8 ? (car.surfaceGrip < 0.9 ? 0.05 : 0.02) : 0)
      + car.wallHit * 0.06;
    this.shake += (wantShake - this.shake) * Math.min(1, dt * 10);
    const jx = (Math.random() - 0.5) * this.shake, jy = (Math.random() - 0.5) * this.shake;

    let target, look, fovT;
    if (this.mode === 1) {            // cockpit (driver eye, halo/wheels visible)
      target = carPos.clone()
        .addScaledVector(fwd, 0.42)
        .add(new THREE.Vector3(0, 1.02 - car.pitch * 0.4, 0));
      look = carPos.clone().addScaledVector(fwd, 30).add(new THREE.Vector3(0, 0.7, 0));
      fovT = 72 + speed * 0.10;
      this.camera.position.copy(target).add(new THREE.Vector3(jx, jy, 0));
      this.camera.lookAt(look);
      // roll about the LOCAL view axis — assigning rotation.z after lookAt
      // corrupts the euler decomposition and flips the view at some headings
      this.camera.rotateZ(car.roll * 2 + car.r * -0.02);
    } else if (this.mode === 2) {     // TV
      let best = TV_CAMS[0], bd = Infinity;
      for (const c of TV_CAMS) {
        const d = c.distanceToSquared(carPos);
        if (d < bd) { bd = d; best = c; }
      }
      this.camera.position.copy(best);
      this.camera.lookAt(carPos.x, carPos.y + 0.6, carPos.z);
      fovT = THREE.MathUtils.clamp(2600 / Math.sqrt(bd + 1), 9, 55);
    } else if (this.mode === 3) {     // driver eye, car body hidden
      target = carPos.clone().addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, 1.0, 0));
      look = carPos.clone().addScaledVector(fwd, 40).add(new THREE.Vector3(0, 0.75, 0));
      this.camera.position.copy(target).add(new THREE.Vector3(jx, jy, 0));
      this.camera.lookAt(look);
      this.camera.rotateZ(car.roll * 1.8 + car.r * -0.02);
      fovT = 76 + speed * 0.11;
    } else {                          // chase
      const dist = 9.5 + speed * 0.045;
      const height = 3.0 + speed * 0.012;
      target = carPos.clone().addScaledVector(fwd, -dist).add(new THREE.Vector3(0, height, 0));
      // lazy follow for a sense of yaw
      this.pos.lerp(target, Math.min(1, dt * 7));
      // never let the chase camera go below the road surface behind the car
      this.pos.y = Math.max(this.pos.y, car.y + 1.4);
      this.camera.position.copy(this.pos).add(new THREE.Vector3(jx, jy, 0));
      this.camera.lookAt(carPos.x, carPos.y + 1.1, carPos.z);
      fovT = 62 + speed * 0.13;
    }
    this.camera.fov += (Math.min(110, fovT) - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();
  }

  snapBehind(car) {
    const fwd = new THREE.Vector3(Math.cos(car.heading), 0, Math.sin(car.heading));
    this.pos.set(car.x, car.y + 3, car.z).addScaledVector(fwd, -10);
  }
}
