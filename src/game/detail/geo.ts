import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Geometry helpers shared by the high / ultra detail passes. */

/** keep only position / normal / uv and make non-indexed so anything can be merged */
export function clean(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

/** merge (and dispose) a list of geometries, each optionally transformed */
export function merge(parts: (THREE.BufferGeometry | [THREE.BufferGeometry, THREE.Matrix4])[]) {
  const list = parts.map((p) => {
    const [g, m] = Array.isArray(p) ? p : [p, null];
    const c = clean(g.clone());
    if (m) c.applyMatrix4(m);
    return c;
  });
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out;
}

/** Height of the concave hip roof (see World.hipRoof) at local (x, z). */
export function hipY(w: number, d: number, h: number, lift: number, x: number, z: number, curl = 0) {
  const ridge = Math.max(0, (w - d) / 2);
  const t = Math.min(1, Math.max(Math.max(0, Math.abs(x) - ridge) / (d / 2), Math.abs(z) / (d / 2)));
  const cx = Math.min(1, Math.abs(x) / (w / 2));
  const cz = Math.min(1, Math.abs(z) / (d / 2));
  const q = cx * cz;
  // đầu đao: an extra, sharper upturn right at the corners (only when curl > 0)
  const up = curl > 0 ? curl * Math.max(0, (q - 0.55) / 0.45) ** 2.6 : 0;
  return h * (1 - t) ** 1.7 + lift * q ** 3 + up;
}

/**
 * Tube along a smooth curve through `pts` whose radius follows r(t), t = 0..1.
 * (TubeGeometry samples the curve at equal arc length, so each ring can be rescaled.)
 */
export function taperTube(pts: THREE.Vector3[], segs: number, radial: number, r: (t: number) => number) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    const k = r(i / segs);
    for (let j = 0; j <= radial; j++) {
      const v = i * (radial + 1) + j;
      pos.setXYZ(v, c.x + (pos.getX(v) - c.x) * k, c.y + (pos.getY(v) - c.y) * k, c.z + (pos.getZ(v) - c.z) * k);
    }
  }
  return g;
}

/**
 * Real roof tiles (ultra): rows of half-round "tube" tiles running down every face of a
 * hip roof, in roof-local coordinates. One non-indexed geometry per roof.
 */
export function roofTiles(w: number, d: number, h: number, lift: number, curl: number, spacing: number, rT: number) {
  const ridge = Math.max(0, (w - d) / 2);
  const RAD = 4;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  // one row: from (ax,az) to (bx,bz), perpendicular horizontal direction (px,pz)
  const row = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.3) return;
    const n = Math.max(3, Math.min(14, Math.round(len / 1.2)));
    const ring: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const x = ax + (bx - ax) * s;
      const z = az + (bz - az) * s;
      const y = hipY(w, d, h, lift, x, z, curl) + 0.03;
      const r: number[] = [];
      for (let j = 0; j <= RAD; j++) {
        const a = (j / RAD) * Math.PI;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        r.push(x + px * c * rT, y + sn * rT * 0.8, z + pz * c * rT, px * c, sn, pz * c);
      }
      ring.push(r);
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < RAD; j++) {
        const q = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        for (const [ii, jj] of q) {
          const v = ring[ii].slice(jj * 6, jj * 6 + 6);
          pos.push(v[0], v[1], v[2]);
          nor.push(v[3], v[4], v[5]);
          uv.push(jj / RAD, ii / n);
        }
      }
  };
  // front / back faces: rows along z
  for (let x = -w / 2 + spacing / 2; x < w / 2; x += spacing) {
    const z0 = Math.max(0, Math.abs(x) - ridge) + 0.05;
    if (z0 >= d / 2 - 0.2) continue;
    row(x, z0, x, d / 2, 1, 0);
    row(x, -z0, x, -d / 2, 1, 0);
  }
  // hip ends: rows along x
  for (let z = -d / 2 + spacing / 2; z < d / 2; z += spacing) {
    const x0 = ridge + Math.abs(z) + 0.05;
    if (x0 >= w / 2 - 0.2) continue;
    row(x0, z, w / 2, z, 0, 1);
    row(-x0, z, -w / 2, z, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Hip ridges running from the top ridge to each corner, ending in an upturned, curling
 * "đầu đao" hook with small flame leaves. Plus a fascia tube along the curved eaves.
 */
export function hipRidges(w: number, d: number, h: number, lift: number, curl: number, r: number, eaves: boolean) {
  const ridge = Math.max(0, (w - d) / 2);
  const parts: THREE.BufferGeometry[] = [];
  const s = Math.min(2.1, Math.max(0.45, d * 0.05));
  const flame = new THREE.ConeGeometry(r * 0.9, s * 0.42, 5);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const x = sx * (ridge + t * (w / 2 - ridge));
        const z = sz * t * (d / 2);
        pts.push(new THREE.Vector3(x, hipY(w, d, h, lift, x, z, curl) + r * 0.6, z));
      }
      // the hook: out along the diagonal, up, then curling back
      const c = pts[pts.length - 1];
      const out = new THREE.Vector3(sx * (w / 2 - ridge), 0, sz * (d / 2)).normalize();
      const hk = (o: number, u: number) => c.clone().addScaledVector(out, o * s).add(new THREE.Vector3(0, u * s, 0));
      pts.push(hk(0.3, 0.22), hk(0.55, 0.62), hk(0.52, 1.0), hk(0.3, 1.16), hk(0.16, 1.02));
      parts.push(taperTube(pts, 48, 6, (t) => r * (t < 0.62 ? 1 : 1 - (t - 0.62) * 1.5)));
      // three flame leaves on the outer side of the hook
      for (let k = 0; k < 3; k++) {
        const p = hk(0.42 + k * 0.08, 0.35 + k * 0.28);
        const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, Math.atan2(out.x, out.z), 0)).multiply(new THREE.Matrix4().makeRotationX(0.9 - k * 0.25));
        m.setPosition(p.clone().addScaledVector(out, s * 0.12));
        const f = flame.clone().applyMatrix4(m);
        parts.push(f);
      }
    }
  if (eaves) {
    // fascia along the four eave edges (follows the upturned corners)
    const edge = (ax: number, az: number, bx: number, bz: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const x = ax + ((bx - ax) * i) / 24;
        const z = az + ((bz - az) * i) / 24;
        pts.push(new THREE.Vector3(x, hipY(w, d, h, lift, x, z, curl) + 0.02, z));
      }
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r * 0.55, 5, false));
    };
    edge(-w / 2, d / 2, w / 2, d / 2);
    edge(-w / 2, -d / 2, w / 2, -d / 2);
    edge(w / 2, -d / 2, w / 2, d / 2);
    edge(-w / 2, -d / 2, -w / 2, d / 2);
  }
  const g = merge(parts);
  for (const p of parts) p.dispose();
  flame.dispose();
  return g;
}

/** Pointed, slightly cupped lotus petal standing in the XY plane (base at the origin, tip at +y). */
export function petal(len: number, wid: number, cup = 0.3, segs = 6) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wid * 0.7, len * 0.1, wid * 0.62, len * 0.62, 0, len);
  s.bezierCurveTo(-wid * 0.62, len * 0.62, -wid * 0.7, len * 0.1, 0, 0);
  const g = new THREE.ShapeGeometry(s, segs);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / wid;
    const y = p.getY(i) / len;
    // cup across the width and curl the tip outward
    p.setZ(i, cup * wid * (1 - x * x * 2.2) * Math.sin(Math.PI * y) - len * 0.12 * y * y);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A ring of petals around the Y axis, tilted outward by `tilt` (0 = upright).
 * Petal faces point outward.
 */
export function petalRing(n: number, radius: number, y: number, len: number, wid: number, tilt: number, phase = 0, cup = 0.3) {
  const base = petal(len, wid, cup);
  const parts: [THREE.BufferGeometry, THREE.Matrix4][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + phase) / n) * Math.PI * 2;
    const m = new THREE.Matrix4()
      .makeTranslation(Math.sin(a) * radius, y, Math.cos(a) * radius)
      .multiply(new THREE.Matrix4().makeRotationY(a))
      .multiply(new THREE.Matrix4().makeRotationX(tilt));
    parts.push([base, m]);
  }
  const g = merge(parts);
  base.dispose();
  return g;
}

/** Lathe with vertical pleats (robe folds) between yMin and yMax. */
export function pleatLathe(pts: THREE.Vector2[], segs: number, pleats: number, amp: number, yMin: number, yMax: number) {
  const g = new THREE.LatheGeometry(pts, segs);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const y = p.getY(i);
    const a = Math.atan2(x, z);
    const k = THREE.MathUtils.smoothstep(y, yMin, yMin + (yMax - yMin) * 0.2) * (1 - THREE.MathUtils.smoothstep(y, yMax - (yMax - yMin) * 0.3, yMax));
    const f = 1 + amp * k * (Math.sin(a * pleats) * 0.7 + Math.sin(a * pleats * 0.5 + 1.3) * 0.3);
    p.setX(i, x * f);
    p.setZ(i, z * f);
  }
  g.computeVertexNormals();
  return g;
}

/** Icosphere blob with jittered vertices (clumpy tree canopy). */
export function clump(detail: number, jitter: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  // jitter by position hash so shared vertices stay shared (no cracks)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const hsh = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const k = 1 + (hsh - Math.floor(hsh) - 0.5) * 2 * jitter;
    p.setXYZ(i, x * k, y * k * (y < 0 ? 0.7 : 1), z * k);
  }
  g.computeVertexNormals();
  return g;
}
