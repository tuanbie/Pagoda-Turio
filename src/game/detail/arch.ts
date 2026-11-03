import * as THREE from 'three';
import { mat, type World } from '../World.ts';
import { hipRidges, merge, roofTiles, taperTube } from './geo.ts';
import { isHigh, isUltra } from './tier.ts';

/**
 * Architectural ornaments for the HIGH and ULTRA tiers: hip ridges with upturned đầu đao,
 * ridge dragons facing the moon, phoenixes, bracket sets, carved column bases, couplet
 * panels, framed lattice doors, worn step noses and stone balustrades. Everything is
 * baked into the world's static batch (merged per material + 40 m chunk).
 * All motifs are generic — nothing is copied from a real, named temple.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface RoofOpts {
  /** add a ridge tube + end curls along the top (halls build their own ridge) */
  topRidge?: boolean;
  /** what sits in the middle of the top ridge */
  crest?: 'phoenix' | 'dragons' | 'pearl';
}

/** extra corner upturn used on high / ultra (see geo.hipY) */
export const roofCurl = (d: number) => Math.max(0.35, d * 0.035);

/** Hip ridges, đầu đao hooks, eave fascia (high) and real tube tiles (ultra). Local roof coords. */
export function roofDetail(w: World, W: number, D: number, h: number, lift: number, x: number, y: number, z: number, o: RoofOpts = {}) {
  if (!isHigh(w.opt)) return;
  const curl = roofCurl(D);
  const r = Math.min(0.22, Math.max(0.07, D * 0.0055));
  w.batch.add(hipRidges(W, D, h, lift, curl, r, true), w.m.trim, mat(x, y, z));
  if (isUltra(w.opt)) {
    const sp = Math.min(0.5, Math.max(0.28, D * 0.012));
    w.batch.add(roofTiles(W, D, h, lift, curl, sp, sp * 0.36), tileMat(w), mat(x, y, z));
  }
  const ridge = Math.max(0, (W - D) / 2);
  if (o.topRidge && ridge > 0.3) {
    const k = Math.min(1.4, Math.max(0.45, D * 0.06));
    w.box(ridge * 2, 0.32 * k, 0.36 * k, w.m.trim, x, y + h + 0.12 * k, z);
    const curlG = new THREE.TorusGeometry(0.3 * k, 0.08 * k, 6, 12, Math.PI * 1.3);
    for (const sx of [-1, 1]) w.batch.add(curlG, w.m.trim, mat(x + sx * ridge, y + h + 0.38 * k, z, 0, sx, 1, 1));
    const top = y + h + 0.28 * k;
    if (o.crest === 'phoenix' && ridge > 1) {
      for (const sx of [-1, 1]) w.batch.add(phoenix(k * 1.1), w.m.gold, mat(x - sx * Math.min(ridge * 0.5, 2.2 * k), top, z, sx < 0 ? 0 : Math.PI));
      w.batch.add(new THREE.SphereGeometry(0.22 * k, 12, 8), w.m.gold, mat(x, top + 0.25 * k, z));
    } else if (o.crest === 'dragons' && ridge > 0.8) {
      dragonPair(w, x, top, z, ridge * 2, false);
    } else if (o.crest === 'pearl') {
      w.batch.add(new THREE.SphereGeometry(0.22 * k, 12, 8), w.m.gold, mat(x, top + 0.2 * k, z));
    }
  }
}

let tile: { mat: THREE.MeshStandardMaterial; owner: World } | null = null;
/** glazed ceramic tube tiles (ultra) */
function tileMat(w: World) {
  if (!tile || tile.owner !== w) tile = { owner: w, mat: new THREE.MeshStandardMaterial({ color: '#3b4440', roughness: 0.55, metalness: 0.05 }) };
  return tile.mat;
}

// ------------------------------------------------------------------ ridge creatures
/**
 * Stylised dragon in profile, length L, standing on y = 0, facing +x (its head near x = 0).
 * Returns [body geometry, gold accents geometry].
 */
export function dragon(L: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const spine = [
    [-1.0, 0.05],
    [-0.9, 0.19],
    [-0.79, 0.3],
    [-0.67, 0.2],
    [-0.56, 0.07],
    [-0.45, 0.17],
    [-0.33, 0.36],
    [-0.22, 0.31],
    [-0.13, 0.2],
    [-0.05, 0.27],
    [0.02, 0.4],
  ].map(([x, y]) => V(x * L, y * L, 0));
  const curve = new THREE.CatmullRomCurve3(spine, false, 'centripetal');
  const rad = (t: number) => L * (0.012 + 0.036 * Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.5)) * (t > 0.92 ? 0.85 : 1);
  const body: (THREE.BufferGeometry | [THREE.BufferGeometry, THREE.Matrix4])[] = [taperTube(spine, 64, 8, rad)];
  const gold: (THREE.BufferGeometry | [THREE.BufferGeometry, THREE.Matrix4])[] = [];
  const M = (x: number, y: number, z: number, rz = 0, sx = 1, sy = 1, sz = 1, ry = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), V(sx, sy, sz));
  // dorsal fins along the back
  const fin = new THREE.ConeGeometry(L * 0.016, L * 0.07, 4);
  const p = V(0, 0, 0);
  const tg = V(0, 0, 0);
  for (let t = 0.08; t < 0.9; t += 0.055) {
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tg);
    const n = V(-tg.y, tg.x, 0).normalize();
    const r = rad(t);
    gold.push([fin, M(p.x + n.x * r, p.y + n.y * r + L * 0.02, 0, Math.atan2(-n.x, n.y) + 0.45, 1, 0.6 + Math.sin(t * Math.PI) * 0.6, 1)]);
  }
  // legs with claws where the body dips to the ridge
  const leg = new THREE.CylinderGeometry(L * 0.011, L * 0.015, 1, 6);
  for (const t of [0.4, 0.78]) {
    curve.getPointAt(t, p);
    body.push([leg, M(p.x + L * 0.03, p.y / 2, 0, 0.35, 1, p.y, 1)]);
    gold.push([new THREE.SphereGeometry(L * 0.022, 8, 6), M(p.x + L * 0.05, L * 0.01, 0, 0, 1.4, 0.6, 1.4)]);
  }
  // tail flame
  const flame = new THREE.ConeGeometry(L * 0.025, L * 0.12, 5);
  for (let i = 0; i < 3; i++) gold.push([flame, M(-L * 1.02, L * (0.08 + i * 0.03), 0, 0.9 + i * 0.35)]);
  // head: skull, snout, open jaw, horns, eyes, mane, whiskers
  const hx = L * 0.06;
  const hy = L * 0.43;
  const sphere = new THREE.SphereGeometry(1, 12, 9);
  body.push([sphere, M(hx, hy, 0, 0, L * 0.07, L * 0.055, L * 0.05)]);
  body.push([new THREE.BoxGeometry(L * 0.12, L * 0.042, L * 0.05), M(hx + L * 0.075, hy - L * 0.005, 0, -0.12)]);
  body.push([new THREE.BoxGeometry(L * 0.1, L * 0.018, L * 0.042), M(hx + L * 0.06, hy - L * 0.05, 0, 0.32)]);
  const horn = new THREE.ConeGeometry(L * 0.012, L * 0.13, 5);
  const mane = new THREE.ConeGeometry(L * 0.02, L * 0.1, 4);
  for (const sz of [-1, 1]) {
    gold.push([horn, M(hx - L * 0.02, hy + L * 0.07, sz * L * 0.022, 1.05)]);
    gold.push([new THREE.SphereGeometry(L * 0.012, 6, 5), M(hx + L * 0.04, hy + L * 0.022, sz * L * 0.032)]);
    body.push([
      taperTube(
        [V(hx + L * 0.13, hy - L * 0.01, sz * L * 0.02), V(hx + L * 0.16, hy + L * 0.04, sz * L * 0.05), V(hx + L * 0.1, hy + L * 0.09, sz * L * 0.06), V(hx + L * 0.03, hy + L * 0.1, sz * L * 0.06)],
        12,
        4,
        (t) => L * 0.006 * (1 - t * 0.7),
      ),
      new THREE.Matrix4(),
    ]);
  }
  for (let i = 0; i < 4; i++) gold.push([mane, M(hx - L * 0.06, hy - L * 0.02 + i * L * 0.03, 0, 1.6 + i * 0.25)]);
  gold.push([new THREE.SphereGeometry(L * 0.02, 8, 6), M(hx + L * 0.15, hy - L * 0.025, 0)]); // pearl in the mouth
  return [merge(body), merge(gold)];
}

/** "Two dragons facing the moon" on a ridge of length `len` centred at (x, y, z). */
export function dragonPair(w: World, x: number, y: number, z: number, len: number, moon: boolean) {
  const L = len * (moon ? 0.34 : 0.32);
  const [body, gold] = dragon(L);
  const gap = moon ? L * 0.42 : L * 0.2;
  for (const sx of [-1, 1]) {
    // left dragon faces +x, the right one is mirrored to face -x
    const m = mat(x - sx * gap, y, z, 0, sx, 1, 1);
    w.batch.add(body, w.m.trim, m);
    w.batch.add(gold, w.m.gold, m);
  }
  if (moon) {
    const R = L * 0.2;
    w.batch.add(new THREE.CylinderGeometry(R * 0.25, R * 0.4, R * 0.8, 10), w.m.trim, mat(x, y + R * 0.4, z));
    w.batch.add(new THREE.CylinderGeometry(R, R, R * 0.22, 28).rotateX(Math.PI / 2), w.m.gold, mat(x, y + R * 1.8, z));
    w.batch.add(new THREE.TorusGeometry(R * 1.12, R * 0.07, 6, 32), w.m.gold, mat(x, y + R * 1.8, z));
    const fl = new THREE.ConeGeometry(R * 0.16, R * 0.62, 4);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      w.batch.add(fl, w.m.gold, mat(x + Math.cos(a) * R * 1.35, y + R * 1.8 + Math.sin(a) * R * 1.35, z, 0, 1, 1 + (i % 2) * 0.5, 0.5, 0, a - Math.PI / 2));
    }
  } else {
    w.batch.add(new THREE.SphereGeometry(L * 0.07, 14, 10), w.m.gold, mat(x, y + L * 0.12, z));
  }
}

/** Phoenix silhouette (extruded), height ≈ k, standing at the origin facing +x. */
export function phoenix(k: number) {
  const s = new THREE.Shape();
  const P = (x: number, y: number) => [x * k, y * k] as const;
  s.moveTo(...P(-0.08, 0));
  s.quadraticCurveTo(...P(0.2, 0.12), ...P(0.18, 0.32));
  s.quadraticCurveTo(...P(0.1, 0.5), ...P(0.24, 0.66)); // neck
  s.lineTo(...P(0.38, 0.62)); // beak
  s.lineTo(...P(0.27, 0.71));
  s.quadraticCurveTo(...P(0.2, 0.9), ...P(0.08, 0.86)); // crest
  s.quadraticCurveTo(...P(0.17, 0.76), ...P(0.12, 0.66));
  s.quadraticCurveTo(...P(0.02, 0.56), ...P(0.03, 0.46));
  s.quadraticCurveTo(...P(-0.05, 0.8), ...P(-0.22, 0.98)); // raised wing
  s.quadraticCurveTo(...P(-0.2, 0.6), ...P(-0.3, 0.42));
  s.quadraticCurveTo(...P(-0.62, 0.62), ...P(-0.92, 0.66)); // tail plumes
  s.quadraticCurveTo(...P(-0.66, 0.4), ...P(-0.98, 0.3));
  s.quadraticCurveTo(...P(-0.62, 0.22), ...P(-0.86, 0.06));
  s.quadraticCurveTo(...P(-0.4, 0.12), ...P(-0.08, 0));
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.06 * k, bevelEnabled: true, bevelSize: 0.015 * k, bevelThickness: 0.015 * k, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -0.03 * k);
  return g;
}

// ------------------------------------------------------------------ timber + stone details
/** Interlocking bracket set (đấu củng) on top of a column, projecting toward `out` (±1 on z). */
export function bracketSet(w: World, x: number, y: number, z: number, k: number, out: number) {
  const L = w.m.lacquer;
  const G = w.m.gold;
  w.box(0.5 * k, 0.3 * k, 0.5 * k, G, x, y, z, 0, false);
  w.box(1.5 * k, 0.22 * k, 0.3 * k, L, x, y + 0.26 * k, z, 0, false);
  w.box(0.3 * k, 0.22 * k, 1.7 * k, L, x, y + 0.26 * k, z + out * 0.55 * k, 0, false);
  for (const [dx, dz] of [
    [-0.62, 0],
    [0.62, 0],
    [0, 1.25],
  ])
    w.box(0.3 * k, 0.2 * k, 0.3 * k, G, x + dx * k, y + 0.47 * k, z + out * dz * k, 0, false);
  w.box(1.9 * k, 0.2 * k, 0.28 * k, L, x, y + 0.67 * k, z, 0, false);
  w.box(0.28 * k, 0.22 * k, 1.5 * k, L, x, y + 0.67 * k, z + out * 1.1 * k, 0, false);
  w.box(0.3 * k, 0.2 * k, 0.3 * k, G, x, y + 0.88 * k, z + out * 1.75 * k, 0, false);
  // carved cloud-scroll end (a curled half torus)
  w.batch.add(new THREE.TorusGeometry(0.16 * k, 0.05 * k, 5, 10, Math.PI).rotateY(Math.PI / 2), L, mat(x, y + 0.5 * k, z + out * 1.85 * k), false);
}

/** Lotus-drum stone base + gold bands on a lacquered column (high). */
export function columnDetail(w: World, x: number, y0: number, H: number, r: number, z: number) {
  const base = new THREE.LatheGeometry(
    [
      [r * 1.9, 0],
      [r * 1.95, 0.08],
      [r * 1.8, 0.16],
      [r * 1.5, 0.3],
      [r * 1.3, 0.4],
      [r * 1.25, 0.46],
      [0, 0.46],
    ].map(([a, b]) => new THREE.Vector2(a, b)),
    16,
  );
  w.batch.add(base, w.m.stone, mat(x, y0, z));
  const band = new THREE.TorusGeometry(r * 1.03, Math.max(0.025, r * 0.07), 5, 18).rotateX(Math.PI / 2);
  for (const yy of [y0 + 0.75, y0 + H - 0.7, y0 + H - 0.9]) w.batch.add(band, w.m.gold, mat(x, yy, z), false);
}

/** A dragon coiling up a column (ultra, main hall). */
export function coiledDragon(w: World, x: number, y0: number, H: number, r: number, z: number) {
  const pts: THREE.Vector3[] = [];
  const turns = 2.3;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * turns * Math.PI * 2 + Math.PI / 2;
    pts.push(V(x + Math.cos(a) * r * 1.18, y0 + 0.9 + t * (H - 2.2), z + Math.sin(a) * r * 1.18));
  }
  w.batch.add(taperTube(pts, 120, 8, (t) => r * (0.06 + 0.2 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5))), w.m.gold, new THREE.Matrix4(), false);
  const last = pts[pts.length - 1];
  w.batch.add(new THREE.SphereGeometry(r * 0.32, 10, 8).scale(1.4, 0.9, 1), w.m.gold, mat(last.x, last.y + r * 0.15, last.z + r * 0.2), false);
  const horn = new THREE.ConeGeometry(r * 0.06, r * 0.45, 5);
  for (const sx of [-1, 1]) w.batch.add(horn, w.m.gold, mat(last.x + sx * r * 0.15, last.y + r * 0.45, last.z, 0, 1, 1, 1, -0.5), false);
}

/** Vertical couplet panel on the front face of a column. */
export function couplet(w: World, material: THREE.Material, x: number, y: number, z: number, wid: number, hgt: number, ry = 0) {
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  w.batch.add(new THREE.BoxGeometry(wid + 0.06, hgt + 0.06, 0.05), w.m.woodDark, mat(x - nx * 0.02, y, z - nz * 0.02, ry), false);
  w.batch.add(new THREE.PlaneGeometry(wid, hgt), material, mat(x + nx * 0.008, y, z + nz * 0.008, ry), false);
}

/** Frame, stiles, rails and a solid kick panel over a lattice door bay (faces ±z). */
export function doorFrame(w: World, x0: number, x1: number, y0: number, dh: number, z: number) {
  const D = w.m.woodDark;
  const width = x1 - x0;
  const leaves = Math.max(2, Math.round(width / 1.1));
  const t = 0.18;
  for (let i = 0; i <= leaves; i++) w.box(0.1, dh, t, D, x0 + (i * width) / leaves, y0 + dh / 2, z, 0, false);
  for (const yy of [y0 + 0.05, y0 + dh * 0.3, y0 + dh * 0.72, y0 + dh - 0.05]) w.box(width, 0.1, t, D, (x0 + x1) / 2, yy, z, 0, false);
  w.box(width - 0.05, dh * 0.3 - 0.1, 0.15, w.m.lacquer, (x0 + x1) / 2, y0 + dh * 0.15, z, 0, false);
  // a small carved roundel on each kick panel
  const rosette = new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12).rotateX(Math.PI / 2);
  for (let i = 0; i < leaves; i++)
    for (const sz of [-1, 1]) w.batch.add(rosette, w.m.gold, mat(x0 + ((i + 0.5) * width) / leaves, y0 + dh * 0.15, z + sz * 0.085), false);
}

/** Rounded, slightly worn nose along the top-front edge of a step (runs along x). */
export function stepNose(w: World, x: number, yTop: number, zFront: number, len: number) {
  const r = 0.06;
  w.batch.add(new THREE.CylinderGeometry(r, r, len, 8, 1).rotateZ(Math.PI / 2), w.m.stone, mat(x, yTop - r * 0.7, zFront - r * 0.7));
  // trodden-smooth, darker centre of the tread
  w.plane(len * 0.55, 0.32, w.m.stoneDark, x, yTop + 0.004, zFront - 0.25, 0, 3);
}

let baluster: THREE.BufferGeometry | null = null;
/**
 * Stone balustrade along x at height y (on a platform top), with a collider so nobody
 * walks through it. Posts carry lotus-bud caps; vase-shaped balusters in between.
 */
export function balustrade(w: World, x0: number, x1: number, z: number, y: number) {
  if (x1 - x0 < 0.8) return;
  const S = w.m.stone;
  baluster ??= new THREE.LatheGeometry(
    [
      [0.07, 0],
      [0.09, 0.08],
      [0.05, 0.22],
      [0.08, 0.36],
      [0.05, 0.5],
      [0.07, 0.56],
    ].map(([a, b]) => new THREE.Vector2(a, b)),
    6,
  );
  const len = x1 - x0;
  const posts = Math.max(1, Math.round(len / 2.2));
  const bud = new THREE.SphereGeometry(0.13, 8, 6).scale(1, 1.4, 1);
  for (let i = 0; i <= posts; i++) {
    const px = x0 + (i * len) / posts;
    w.box(0.24, 0.86, 0.24, w.m.stoneDark, px, y + 0.43, z);
    w.batch.add(bud, S, mat(px, y + 0.98, z));
    if (i === posts) break;
    const seg = len / posts;
    const n = Math.max(1, Math.floor((seg - 0.3) / 0.3));
    for (let k = 1; k <= n; k++) w.batch.add(baluster, S, mat(px + (k * seg) / (n + 1), y + 0.1, z));
  }
  w.box(len, 0.1, 0.2, S, (x0 + x1) / 2, y + 0.05, z);
  w.box(len, 0.1, 0.22, S, (x0 + x1) / 2, y + 0.71, z);
  w.boxes.push({ x0: x0 - 0.15, x1: x1 + 0.15, z0: z - 0.17, z1: z + 0.17 });
}

/** release cached shared geometry (called when a world is disposed) */
export function disposeArch() {
  baluster?.dispose();
  baluster = null;
  tile = null;
}
