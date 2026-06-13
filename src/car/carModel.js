// Procedural 2026-style F1 car model. Built from primitives — narrower and
// shorter than 2022-25 cars per the 2026 regulations, with wheel covers,
// halo, and team livery colors. +X is forward in car local space.
import * as THREE from 'three';

const Y = 0.0; // ground reference; wheel radius lifts the body

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.35, metalness: opts.metalness ?? 0.55,
    ...opts,
  });
}

function numberTexture(num, fg = '#ffffff', bg = null) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 128, 128); }
  ctx.fillStyle = fg;
  ctx.font = 'bold 84px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6;
  ctx.strokeText(String(num), 64, 70);
  ctx.fillText(String(num), 64, 70);
  const tx = new THREE.CanvasTexture(cv);
  tx.anisotropy = 4;
  return tx;
}

/**
 * Build a car. team: entry from grid2026, num: race number.
 * opts.ghost: translucent ghost rendering.
 */
export function buildCar(team, num, opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const ghost = !!opts.ghost;
  const gOpts = ghost
    ? { transparent: true, opacity: 0.35, depthWrite: false }
    : {};
  const liv = mat(team.color, { roughness: 0.3, metalness: 0.6, ...gOpts });
  const acc = mat(team.accent, { roughness: 0.35, metalness: 0.5, ...gOpts });
  const carbon = mat(0x141414, { roughness: 0.55, metalness: 0.3, ...gOpts });
  const tire = mat(0x161616, { roughness: 0.92, metalness: 0.05, ...gOpts });

  const wheelR = 0.355, wheelW = 0.30; // 2026: narrower tires
  const ride = wheelR;

  // ---- floor ----
  {
    const g = new THREE.BoxGeometry(3.4, 0.05, 1.5);
    const m = new THREE.Mesh(g, carbon);
    m.position.set(-0.3, 0.06, 0);
    body.add(m);
  }

  // ---- monocoque / nose (tapered segments along +X) ----
  const spineSegs = [
    // [x-center, len, width, height, y-center, material]
    [-1.55, 0.9, 0.86, 0.55, 0.42, liv],   // engine cover / rear
    [-0.70, 0.9, 0.92, 0.46, 0.36, liv],   // mid chassis
    [0.25, 1.0, 0.78, 0.38, 0.34, liv],    // cockpit front
    [1.10, 0.8, 0.46, 0.26, 0.30, liv],    // nose transition
    [1.78, 0.7, 0.26, 0.16, 0.27, acc],    // nose tip
  ];
  for (const [x, len, w, hgt, y, m] of spineSegs) {
    const g = new THREE.BoxGeometry(len, hgt, w);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, 0);
    body.add(mesh);
  }

  // dorsal fin / airbox
  {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.34, 0.10), liv);
    fin.position.set(-1.35, 0.78, 0);
    body.add(fin);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.34), carbon);
    intake.position.set(-0.78, 0.82, 0);
    body.add(intake);
  }

  // ---- sidepods ----
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 0.42), liv);
    pod.position.set(-0.75, 0.30, side * 0.62);
    body.add(pod);
    const inlet = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.3), carbon);
    inlet.position.set(-0.02, 0.32, side * 0.60);
    body.add(inlet);
  }

  // ---- halo ----
  {
    const tube = new THREE.TorusGeometry(0.42, 0.04, 8, 24, Math.PI);
    const hoop = new THREE.Mesh(tube, carbon);
    hoop.rotation.x = Math.PI / 2;
    hoop.rotation.z = Math.PI;
    hoop.position.set(0.30, 0.72, 0);
    body.add(hoop);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.36, 8), carbon);
    pillar.position.set(0.66, 0.58, 0);
    pillar.rotation.z = 0.5;
    body.add(pillar);
  }

  // ---- driver helmet ----
  {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), acc);
    helmet.position.set(0.08, 0.62, 0);
    body.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.18),
      mat(0x222233, { roughness: 0.1, metalness: 0.9, ...gOpts }));
    visor.position.set(0.21, 0.63, 0);
    body.add(visor);
  }

  // ---- front wing ----
  {
    const main = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 1.78), acc);
    main.position.set(2.05, 0.12, 0);
    body.add(main);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.03, 1.7), liv);
    flap.position.set(1.92, 0.20, 0);
    flap.rotation.z = 0.25;
    body.add(flap);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.03), carbon);
      plate.position.set(2.0, 0.18, side * 0.89);
      body.add(plate);
    }
  }

  // ---- rear wing (movable flap = 2026 active aero) ----
  const rearFlap = new THREE.Group();
  {
    const main = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 1.0), liv);
    main.position.set(-2.05, 0.78, 0);
    body.add(main);
    const flapMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.98), acc);
    flapMesh.position.set(-0.10, 0, 0);
    rearFlap.add(flapMesh);
    rearFlap.position.set(-2.0, 0.93, 0);
    rearFlap.rotation.z = -0.45;
    body.add(rearFlap);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.03), carbon);
      plate.position.set(-2.05, 0.74, side * 0.5);
      body.add(plate);
    }
    // beam wing / diffuser hint
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.9), carbon);
    beam.position.set(-2.0, 0.45, 0);
    body.add(beam);
  }

  // ---- race number on nose & engine cover ----
  if (!ghost) {
    const numTex = numberTexture(num);
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), numMat);
    plate.rotation.x = -Math.PI / 2;
    plate.rotation.z = -Math.PI / 2;
    plate.position.set(1.45, 0.395, 0);
    body.add(plate);
    for (const side of [-1, 1]) {
      const sideN = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), numMat);
      sideN.position.set(-1.45, 0.5, side * 0.44);
      sideN.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(sideN);
    }
  }

  // ---- wheels (with 2026 partial covers) ----
  const wheels = [];
  const wheelPos = [
    [1.70, 0.78, true], [1.70, -0.78, true],     // front (steerable)
    [-1.70, 0.80, false], [-1.70, -0.80, false], // rear
  ];
  for (const [wx, wz, front] of wheelPos) {
    const wg = new THREE.Group();
    const tyre = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 20), tire);
    tyre.rotation.x = Math.PI / 2;
    wg.add(tyre);
    const cover = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, wheelW + 0.012, 16),
      mat(0x888888, { roughness: 0.25, metalness: 0.85, ...gOpts }));
    cover.rotation.x = Math.PI / 2;
    wg.add(cover);
    wg.position.set(wx, ride, wz);
    wg.userData.front = front;
    root.add(wg);
    wheels.push(wg);
  }

  body.position.y = 0.06;
  root.traverse(o => { if (o.isMesh && !ghost) { o.castShadow = true; } });

  return {
    group: root,
    wheels,
    rearFlap,
    /** steer: rad, xMode: bool, rollPitch from physics */
    update(state) {
      for (const w of wheels) {
        // physics steerAngle is "+ = right"; three.js +y rotation is CCW
        if (w.userData.front) w.rotation.y = -(state.steerAngle ?? 0);
        w.children.forEach(ch => { ch.rotation.y -= (state.wheelSpin ?? 0); });
      }
      rearFlap.rotation.z = state.xMode ? -0.04 : -0.45;
      // no visual body roll/pitch: all four wheels stay planted on the road
      body.rotation.z = 0;
      body.rotation.x = 0;
    },
  };
}
