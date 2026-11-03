import * as THREE from 'three';
import type { FishTuple } from '@sontu/shared';
import { C } from './layout.ts';

/**
 * White doves released in the cloister (the church's counterpart of the temple's koi).
 * Each released dove ([seed, at]) flies up from where it was released, circles the towers and
 * the cloister, then perches on the fountain rim, the plaza or a roof ridge — and takes off
 * again now and then. Fully deterministic from (seed, at) so everyone sees the same flock.
 * Rendered as one InstancedMesh for bodies and two for wings.
 */
const MAX_SHOWN = 60;

interface Dove {
  seed: number;
  at: number;
  /** release point (or null: was already there when I arrived) */
  from: [number, number] | null;
}

const PERCHES: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  const f = C.fountain;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push([f.x + Math.cos(a) * (f.r + 0.05), 0.72, f.z + Math.sin(a) * (f.r + 0.05)]);
  }
  for (let i = 0; i < 14; i++) out.push([-14 + i * 2.1, 0.02, 14 + ((i * 7) % 5) * 2.4]); // plaza
  // nave ridge: on top of the iron ridge bar (y 28.85..29.35, 0.4 m wide, z -41..0)
  for (let i = 0; i < 12; i++) out.push([i % 2 ? 0.1 : -0.1, 29.43, -2 - i * 3.3]);
  return out;
})();

const hash = (n: number) => {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
};

export class Doves {
  private list: Dove[] = [];
  private body: THREE.InstancedMesh;
  private wingL: THREE.InstancedMesh;
  private wingR: THREE.InstancedMesh;
  private d = new THREE.Object3D();
  private p = new THREE.Vector3();
  private q = new THREE.Vector3();

  constructor(scene: THREE.Scene, detail: boolean) {
    const white = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.85 });
    const bodyG = new THREE.SphereGeometry(0.09, detail ? 12 : 7, detail ? 8 : 5).scale(1, 0.85, 1.9);
    const head = new THREE.SphereGeometry(0.05, detail ? 10 : 6, detail ? 8 : 4).translate(0, 0.06, 0.15);
    const tail = new THREE.ConeGeometry(0.05, 0.14, 4).rotateX(-Math.PI / 2).translate(0, 0.01, -0.2);
    const g = mergeSimple([bodyG, head, tail]);
    this.body = new THREE.InstancedMesh(g, white, MAX_SHOWN);
    const wing = new THREE.PlaneGeometry(0.26, 0.12).translate(0.13, 0, -0.02);
    const wingM = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 });
    this.wingL = new THREE.InstancedMesh(wing, wingM, MAX_SHOWN);
    this.wingR = new THREE.InstancedMesh(wing, wingM, MAX_SHOWN);
    for (const m of [this.body, this.wingL, this.wingR]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      scene.add(m);
    }
  }

  add(f: FishTuple, from: [number, number] | null, quiet = false) {
    this.list.push({ seed: f[0], at: f[1], from: quiet ? null : from });
    if (this.list.length > MAX_SHOWN) this.list.shift();
  }

  /** Where to stand to release a dove: by the fountain rim, on the side nearest (x, z). */
  shore(x: number, z: number): [number, number] {
    const f = C.fountain;
    const a = Math.atan2(z - f.z, x - f.x);
    return [f.x + Math.cos(a) * (f.r + 1.6), f.z + Math.sin(a) * (f.r + 1.6)];
  }

  /** @param sNow server time (ms) */
  update(sNow: number) {
    const n = this.list.length;
    for (const m of [this.body, this.wingL, this.wingR]) m.count = n;
    for (let i = 0; i < n; i++) {
      const dv = this.list[i];
      const age = (sNow - dv.at) / 1000;
      const h = hash(dv.seed);
      // a 70 s life cycle: perch 40 s, fly 30 s (offset per dove so they don't all move at once)
      const cyc = 70;
      const ph = ((age + h * cyc) % cyc + cyc) % cyc;
      const perch = PERCHES[Math.floor(hash(dv.seed + Math.floor((age + h * cyc) / cyc)) * PERCHES.length)];
      let flying = ph >= 40;
      let flap = 0;
      if (age < 9 && dv.from) {
        // just released: rise in a spiral from the hands that let it go
        const t = age / 9;
        const a = t * Math.PI * 3 + h * 6;
        this.p.set(dv.from[0] + Math.cos(a) * 3 * t, 1.4 + t * 22, dv.from[1] + Math.sin(a) * 3 * t);
        flying = true;
      } else if (flying) {
        // circle between the towers and the cloister
        const t = (ph - 40) / 30;
        const a = t * Math.PI * 2 * 1.5 + h * 6.28;
        const cx = 22 + Math.sin(h * 9) * 10;
        const cz = -14;
        const R = 26 + h * 10;
        this.p.set(cx + Math.cos(a) * R, 18 + Math.sin(t * Math.PI) * 14 + Math.sin(a * 2) * 2, cz + Math.sin(a) * R * 0.7);
        // glide in to the perch over the last 15%
        if (t > 0.85) {
          const k = (t - 0.85) / 0.15;
          this.q.set(perch[0], perch[1], perch[2]);
          this.p.lerp(this.q, k * k * (3 - 2 * k));
        }
      } else {
        // perched: small hops and head bobs
        this.p.set(perch[0] + Math.sin(age * 0.7 + h * 20) * 0.08, perch[1], perch[2] + Math.cos(age * 0.5 + h * 11) * 0.08);
      }
      // heading: along the path when flying, random-ish when perched
      const dt = 0.05;
      const ahead = flying ? (ph - 40 + dt) / 30 : 0;
      const yaw = flying ? Math.atan2(Math.cos((ahead * 3 + h) * Math.PI), -Math.sin((ahead * 3 + h) * Math.PI)) : h * 6.28 + Math.sin(age * 0.3) * 0.8;
      flap = flying ? Math.sin(sNow / 55 + h * 40) * 0.9 : Math.sin(age * 9 + h * 5) > 0.97 ? 0.6 : 0.05;
      this.d.position.copy(this.p);
      this.d.rotation.set(0, yaw, 0);
      this.d.scale.setScalar(1);
      this.d.updateMatrix();
      this.body.setMatrixAt(i, this.d.matrix);
      this.d.rotation.set(0, yaw, flying ? flap : 0.15);
      this.d.updateMatrix();
      this.wingL.setMatrixAt(i, this.d.matrix);
      this.d.rotation.set(0, yaw + Math.PI, flying ? -flap : -0.15);
      this.d.rotateY(0);
      this.d.updateMatrix();
      // mirrored wing: flip around the body axis
      this.d.rotation.set(0, yaw, Math.PI - (flying ? flap : 0.15));
      this.d.updateMatrix();
      this.wingR.setMatrixAt(i, this.d.matrix);
    }
    for (const m of [this.body, this.wingL, this.wingR]) m.instanceMatrix.needsUpdate = true;
  }
}

function mergeSimple(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
