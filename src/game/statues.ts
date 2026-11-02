import * as THREE from 'three';

/**
 * Procedural Buddha / Bodhisattva statues. Built from simple primitives but following the
 * classic iconography: lotus throne, lotus position, dhyāna mudrā, snail-shell curls,
 * uṣṇīṣa, long earlobes, closed eyes, ūrṇā, robe over the left shoulder, flame mandorla.
 * Everything is returned as a Group so the world can bake it into one draw call per material.
 */
export interface StatueMats {
  body: THREE.Material;
  trim: THREE.Material;
  glow: THREE.Material;
  dark: THREE.Material;
}

const Y = new THREE.Vector3(0, 1, 0);

/** Cylinder from a to b (for arms). */
function limb(g: THREE.Group, m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 12), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
  g.add(mesh);
  // rounded joints
  for (const p of [a, b]) {
    const j = new THREE.Mesh(new THREE.SphereGeometry(p === a ? r0 : r1, 10, 8), m);
    j.position.copy(p);
    g.add(j);
  }
}

function add(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

/** Fibonacci-distributed points on the upper part of a sphere (for hair curls). */
function capPoints(n: number, maxPolar: number) {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * (1 - Math.cos(maxPolar));
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return out;
}

/** Serene head with curls, uṣṇīṣa, long ears, closed eyes. Origin = centre of the head. */
function buddhaHead(g: THREE.Group, m: StatueMats, k: number, cx: number, cy: number, cz: number, detail: number, crown = false) {
  const R = 0.42 * k;
  add(g, new THREE.SphereGeometry(R, 22, 16), m.body, cx, cy, cz, 0.9, 1.08, 0.95);
  // face details
  const fz = cz + R * 0.9;
  const lid = new THREE.TorusGeometry(0.075 * k, 0.014 * k, 4, 10, Math.PI);
  for (const sx of [-1, 1]) {
    add(g, lid, m.dark, cx + sx * 0.15 * k, cy + 0.02 * k, fz - 0.02 * k, 1, 0.55, 1, 0, 0, Math.PI); // downcast lids
    add(g, new THREE.TorusGeometry(0.12 * k, 0.014 * k, 4, 12, Math.PI * 0.8), m.trim, cx + sx * 0.15 * k, cy + 0.08 * k, fz - 0.04 * k, 1, 0.5, 1, 0, 0, Math.PI * 0.1); // brows
    // long earlobes
    add(g, new THREE.SphereGeometry(0.1 * k, 10, 8), m.body, cx + sx * R * 0.92, cy - 0.12 * k, cz, 0.55, 2.4, 1);
  }
  add(g, new THREE.ConeGeometry(0.055 * k, 0.17 * k, 8), m.body, cx, cy - 0.06 * k, fz + 0.02 * k, 1, 1, 1, -0.25, 0, 0); // nose
  add(g, new THREE.SphereGeometry(0.06 * k, 10, 6), m.trim, cx, cy - 0.2 * k, fz - 0.03 * k, 1.3, 0.35, 0.6); // gentle smile
  add(g, new THREE.SphereGeometry(0.025 * k, 8, 6), m.glow, cx, cy + 0.14 * k, fz + 0.01 * k); // ūrṇā
  if (crown) {
    // bodhisattva crown instead of curls
    add(g, new THREE.CylinderGeometry(R * 0.85, R * 0.95, 0.14 * k, 16, 1, true), m.trim, cx, cy + 0.26 * k, cz);
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * 1.6;
      add(g, new THREE.ConeGeometry(0.07 * k, 0.26 * k, 6), m.trim, cx + Math.sin(a) * R * 0.8, cy + 0.42 * k, cz + Math.cos(a) * R * 0.8);
    }
    add(g, new THREE.SphereGeometry(R * 0.55, 14, 10), m.body, cx, cy + 0.42 * k, cz, 1, 1.1, 1); // top-knot
    return;
  }
  // snail-shell curls over the skull + the uṣṇīṣa
  const curl = new THREE.SphereGeometry(0.062 * k, 5, 4);
  for (const p of capPoints(detail, 1.15)) add(g, curl, m.trim, cx + p.x * R * 0.93, cy + 0.03 * k + p.y * R * 1.05, cz + p.z * R * 0.9 - 0.02 * k);
  const uy = cy + R * 1.1;
  add(g, new THREE.SphereGeometry(0.22 * k, 16, 12), m.body, cx, uy, cz - 0.03 * k);
  for (const p of capPoints(Math.round(detail * 0.3), 1.4)) add(g, curl, m.trim, cx + p.x * 0.21 * k, uy + p.y * 0.21 * k, cz - 0.03 * k + p.z * 0.21 * k);
}

/** Flame-shaped mandorla + head halo behind a figure (local origin at the base). */
function mandorla(g: THREE.Group, m: StatueMats, k: number, headY: number, bodyH: number, z: number) {
  const s = new THREE.Shape();
  const w = 1.5 * k;
  s.moveTo(-w, 0);
  s.bezierCurveTo(-w * 1.15, bodyH * 0.55, -w * 0.7, bodyH * 0.95, 0, bodyH * 1.12); // pointed flame tip
  s.bezierCurveTo(w * 0.7, bodyH * 0.95, w * 1.15, bodyH * 0.55, w, 0);
  s.lineTo(-w, 0);
  const geo = new THREE.ShapeGeometry(s, 24);
  add(g, geo, m.glow, 0, 0.1 * k, z);
  const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s.getPoints(40).map((p) => new THREE.Vector3(p.x, p.y + 0.1 * k, z + 0.02 * k))), 80, 0.05 * k, 6, false), m.trim);
  g.add(rim);
  add(g, new THREE.TorusGeometry(0.7 * k, 0.05 * k, 8, 40), m.trim, 0, headY, z + 0.04 * k);
  add(g, new THREE.CircleGeometry(0.66 * k, 32), m.trim, 0, headY, z + 0.03 * k);
}

/** Seated Buddha in lotus position on a double lotus throne. Base at y = 0, facing +z. */
export function seatedBuddha(m: StatueMats, k: number, detail = 110): THREE.Group {
  const g = new THREE.Group();
  // throne: octagonal pedestal + two rings of petals
  add(g, new THREE.CylinderGeometry(1.45 * k, 1.65 * k, 0.5 * k, 8), m.trim, 0, 0.25 * k, 0);
  add(g, new THREE.CylinderGeometry(1.2 * k, 1.35 * k, 0.12 * k, 8), m.body, 0, 0.56 * k, 0);
  const petal = new THREE.SphereGeometry(0.34 * k, 8, 6);
  for (let ring = 0; ring < 2; ring++) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = ((i + ring * 0.5) / n) * Math.PI * 2;
      const r = (1.22 - ring * 0.2) * k;
      const p = add(g, petal, ring ? m.body : m.trim, Math.cos(a) * r, (0.75 + ring * 0.1) * k, Math.sin(a) * r, 0.55, 1, 0.22);
      p.lookAt(0, p.position.y, 0);
      p.rotateX(-0.5 + ring * 0.25); // petals open outward
    }
  }
  const seat = 0.86 * k;
  // crossed legs (lap) and upturned soles
  add(g, new THREE.SphereGeometry(1, 24, 14), m.body, 0, seat + 0.22 * k, 0.12 * k, 1.12 * k, 0.36 * k, 0.78 * k);
  for (const sx of [-1, 1]) add(g, new THREE.SphereGeometry(0.16 * k, 10, 8), m.trim, sx * 0.42 * k, seat + 0.44 * k, 0.52 * k, 1, 0.45, 1.5, 0, sx * 0.4, 0);
  // torso (slightly flattened front-to-back) and robe
  const torso = new THREE.LatheGeometry(
    [
      [0.66, 0],
      [0.7, 0.25],
      [0.62, 0.62],
      [0.66, 0.92],
      [0.58, 1.05],
      [0.3, 1.16],
      [0, 1.18],
    ].map(([x, y]) => new THREE.Vector2(x * k, y * k)),
    32,
  );
  add(g, torso, m.body, 0, seat + 0.3 * k, -0.04 * k, 1, 1, 0.78);
  // robe draped over the left shoulder, bare right shoulder
  add(g, new THREE.BoxGeometry(0.34 * k, 1.35 * k, 0.07 * k), m.trim, 0.12 * k, seat + 0.95 * k, 0.48 * k, 1, 1, 1, -0.12, 0, 0.62);
  add(g, new THREE.TorusGeometry(0.6 * k, 0.07 * k, 6, 24, Math.PI * 0.9), m.trim, 0, seat + 0.42 * k, 0.08 * k, 1, 0.5, 1.2, Math.PI / 2, 0, 0.05);
  // arms down to the hands resting in the lap (dhyāna mudrā)
  const sh = seat + 1.32 * k;
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Vector3(sx * 0.6 * k, sh, -0.02 * k);
    const elbow = new THREE.Vector3(sx * 0.76 * k, seat + 0.7 * k, 0.1 * k);
    const wrist = new THREE.Vector3(sx * 0.24 * k, seat + 0.5 * k, 0.5 * k);
    limb(g, m.body, shoulder, elbow, 0.17 * k, 0.15 * k);
    limb(g, m.body, elbow, wrist, 0.15 * k, 0.1 * k);
  }
  add(g, new THREE.SphereGeometry(1, 14, 10), m.body, 0, seat + 0.5 * k, 0.55 * k, 0.3 * k, 0.07 * k, 0.2 * k); // right hand on left
  add(g, new THREE.SphereGeometry(1, 14, 10), m.body, 0, seat + 0.56 * k, 0.53 * k, 0.28 * k, 0.065 * k, 0.18 * k);
  add(g, new THREE.TorusGeometry(0.06 * k, 0.025 * k, 6, 10, Math.PI), m.body, 0, seat + 0.63 * k, 0.6 * k); // touching thumbs
  // neck with the three beauty folds
  const neckY = seat + 1.5 * k;
  add(g, new THREE.CylinderGeometry(0.17 * k, 0.2 * k, 0.26 * k, 14), m.body, 0, neckY, -0.02 * k);
  for (let i = 0; i < 3; i++) add(g, new THREE.TorusGeometry(0.185 * k, 0.012 * k, 4, 18), m.trim, 0, neckY - 0.08 * k + i * 0.07 * k, -0.02 * k, 1, 1, 1, Math.PI / 2);
  const headY = neckY + 0.5 * k;
  buddhaHead(g, m, k, 0, headY, 0, detail);
  mandorla(g, m, k, headY, headY + 1.2 * k, -0.75 * k);
  return g;
}

/** Standing Bodhisattva (crowned, flowing robes, hands joined holding a lotus). */
export function standingBodhisattva(m: StatueMats, k: number): THREE.Group {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.62 * k, 0.7 * k, 0.32 * k, 8), m.trim, 0, 0.16 * k, 0);
  const petal = new THREE.SphereGeometry(0.2 * k, 8, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = add(g, petal, m.trim, Math.cos(a) * 0.58 * k, 0.38 * k, Math.sin(a) * 0.58 * k, 0.6, 1, 0.25);
    p.lookAt(0, p.position.y, 0);
    p.rotateX(-0.4);
  }
  const robe = new THREE.LatheGeometry(
    [
      [0, 0],
      [0.52, 0],
      [0.48, 0.25],
      [0.4, 0.9],
      [0.36, 1.45],
      [0.42, 1.75],
      [0.34, 1.92],
      [0.16, 2.02],
      [0, 2.03],
    ].map(([x, y]) => new THREE.Vector2(x * k, y * k)),
    28,
  );
  add(g, robe, m.body, 0, 0.36 * k, 0, 1, 1, 0.82);
  // scarf falling over both arms
  for (const sx of [-1, 1]) add(g, new THREE.BoxGeometry(0.1 * k, 1.5 * k, 0.05 * k), m.trim, sx * 0.44 * k, 1.35 * k, 0.12 * k, 1, 1, 1, 0, 0, sx * 0.08);
  // arms bent, hands together at the chest holding a lotus bud
  const sh = 2.2 * k;
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Vector3(sx * 0.38 * k, sh, 0);
    const elbow = new THREE.Vector3(sx * 0.46 * k, 1.75 * k, 0.12 * k);
    const hand = new THREE.Vector3(sx * 0.07 * k, 1.95 * k, 0.36 * k);
    limb(g, m.body, shoulder, elbow, 0.1 * k, 0.09 * k);
    limb(g, m.body, elbow, hand, 0.09 * k, 0.06 * k);
  }
  add(g, new THREE.ConeGeometry(0.1 * k, 0.24 * k, 8), m.glow, 0, 2.12 * k, 0.4 * k);
  const neckY = 2.42 * k;
  add(g, new THREE.CylinderGeometry(0.11 * k, 0.13 * k, 0.18 * k, 12), m.body, 0, neckY, 0);
  const headY = neckY + 0.32 * k;
  buddhaHead(g, m, k * 0.62, 0, headY, 0, 0, true);
  add(g, new THREE.TorusGeometry(0.48 * k, 0.035 * k, 6, 32), m.trim, 0, headY, -0.32 * k);
  add(g, new THREE.CircleGeometry(0.45 * k, 28), m.glow, 0, headY, -0.33 * k);
  return g;
}
