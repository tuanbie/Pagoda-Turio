import * as THREE from 'three';
import { HALLS, WORLD } from '@sontu/shared';
import { mat, rng, type World } from '../World.ts';
import { PATHS, gardenRect } from '../layout.ts';
import { textures } from '../textures.ts';
import { BRIDGE } from '../terrain.ts';
import { cloth, drift, flap, wind, type WindOpts } from './shader.ts';
import { merge } from './geo.ts';

/**
 * Things that make the grounds feel alive on HIGH (and much more of them on ULTRA):
 *  high  — circling birds, pond dragonflies, banners on poles along the spirit way,
 *          a few real flickering lantern lights at night.
 *  ultra — instanced grass blades + wild flowers swaying by the paths (distance culled),
 *          falling blossom petals, ripple rings on the pond, sun shafts and dust motes in the halls.
 * Everything is instanced, GPU-animated where possible, and allocation-free per frame.
 */

const GRASS_CHUNK = 24;
const GRASS_RANGE = 58;
const UP = new THREE.Vector3(0, 1, 0);

/** 5 curved, tapered blades in one tuft (normals point up so it lights like the lawn). */
function tuftGeometry() {
  const pos: number[] = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 0.32 + ((b * 37) % 7) * 0.035;
    const lean = 0.08 + ((b * 13) % 5) * 0.025;
    const wd = 0.028;
    const P = (side: number, t: number) => {
      const r = 0.05 + lean * t * t;
      const w = wd * (1 - t);
      return [ca * r - sa * w * side, h * t, sa * r + ca * w * side];
    };
    const q = [P(-1, 0), P(1, 0), P(-1, 0.5), P(1, 0.5), P(0, 1)];
    pos.push(...q[0], ...q[1], ...q[3], ...q[0], ...q[3], ...q[2], ...q[2], ...q[3], ...q[4]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

/** bird in flight: small body + two swept wings (local x = wing span) */
function birdGeometry() {
  const p = [
    // left wing
    0, 0, 0.12, -0.55, 0.02, -0.08, 0, 0, -0.1,
    // right wing
    0, 0, 0.12, 0, 0, -0.1, 0.55, 0.02, -0.08,
    // body (two thin triangles)
    0, 0.03, 0.2, -0.04, 0, -0.25, 0.04, 0, -0.25, 0, -0.03, 0.2, 0.04, 0, -0.25, -0.04, 0, -0.25,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** dragonfly: thin body + two pairs of wings */
function dragonflyGeometry() {
  const body = new THREE.BoxGeometry(0.014, 0.014, 0.11).translate(0, 0, -0.02);
  const wing = new THREE.PlaneGeometry(0.075, 0.02).rotateX(-Math.PI / 2);
  return merge([body, [wing, new THREE.Matrix4().makeTranslation(0.045, 0.006, 0.012)], [wing, new THREE.Matrix4().makeTranslation(-0.045, 0.006, 0.012)], [wing, new THREE.Matrix4().makeTranslation(0.04, 0.006, -0.012)], [wing, new THREE.Matrix4().makeTranslation(-0.04, 0.006, -0.012)]]);
}

interface Chunk {
  meshes: THREE.InstancedMesh[];
  x: number;
  z: number;
}

export class Life {
  private dummy = new THREE.Object3D();
  private chunks: Chunk[] = [];
  private cullClock = 1;
  private birds: THREE.InstancedMesh | null = null;
  private birdData: Float32Array | null = null; // cx, cz, R, h, speed, phase
  private flies: THREE.InstancedMesh | null = null;
  private flyData: Float32Array | null = null; // homeX, homeZ, x, y, z, tx, ty, tz, timer
  private petals: THREE.InstancedMesh | null = null;
  private petalData: Float32Array | null = null; // x, y, z, phase, speed
  private nearBlooms: { x: number; z: number; y: number }[] = [];
  private bloomClock = 1;
  private ripples: THREE.InstancedMesh | null = null;
  private rippleData: Float32Array | null = null; // x, z, age, life
  private lights: THREE.PointLight[] = [];
  private lightClock = 1;
  private night = 0;
  private rays: THREE.Mesh | null = null;
  private motes: THREE.Points | null = null;
  private rand = rng(4242);
  private tmpColor = new THREE.Color();
  private order: number[] = [];

  constructor(
    private w: World,
    private occupied: (x: number, z: number, pad: number) => boolean,
  ) {
    this.buildBirds();
    this.buildDragonflies();
    this.buildBanners();
    this.buildLanternLights();
    if (w.ul) {
      this.buildGrass();
      this.buildPetals();
      this.buildRipples();
      this.buildHallLight();
    }
  }

  // ------------------------------------------------------------------ ultra: grass + flowers
  private buildGrass() {
    const r = rng(77);
    const want = 30000;
    const spots: number[] = [];
    let tries = 0;
    // 60 % hugging the edges of the walkways, the rest scattered over the open lawn
    while (spots.length / 2 < want && tries++ < want * 6) {
      let x: number;
      let z: number;
      if (r() < 0.6) {
        const [x1, z1, x2, z2, wd] = PATHS[Math.floor(r() * PATHS.length)];
        const t = r();
        const len = Math.hypot(x2 - x1, z2 - z1) || 1;
        const nx = -(z2 - z1) / len;
        const nz = (x2 - x1) / len;
        const off = (wd / 2 + 0.6 + r() ** 1.6 * 4) * (r() < 0.5 ? -1 : 1);
        x = x1 + (x2 - x1) * t + nx * off;
        z = z1 + (z2 - z1) * t + nz * off;
      } else {
        const a = r() * Math.PI * 2;
        const d = 8 + Math.sqrt(r()) * 120;
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
      }
      if (Math.hypot(x, z) > WORLD.radius - 1 || this.occupied(x, z, -1.5)) continue;
      spots.push(x, z);
    }
    const flowerSpots: number[] = [];
    for (let i = 0; i < spots.length; i += 2) if (r() < 0.09) flowerSpots.push(spots[i] + (r() - 0.5) * 0.6, spots[i + 1] + (r() - 0.5) * 0.6);
    // the flower garden's lawn gets a few more
    const g = gardenRect();
    for (let i = 0; i < 400; i++) {
      const x = g.x0 - 3 - r() * 4 * (r() < 0.5 ? 1 : -1) + (r() < 0.5 ? 0 : g.x1 - g.x0 + 6);
      const z = g.z0 + r() * (g.z1 - g.z0);
      if (!this.occupied(x, z, -1.5)) flowerSpots.push(x, z);
    }

    const grassWind: WindOpts = { amp: 0.11, y0: 0, y1: 0.55, pow: 1.4, freq: 2.1 };
    const grassMat = wind(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, side: THREE.DoubleSide }), grassWind);
    const stemMat = wind(new THREE.MeshStandardMaterial({ color: '#5d8a3a', roughness: 0.9, side: THREE.DoubleSide }), grassWind);
    const headMat = wind(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, emissive: '#1a1410' }), grassWind);
    const tuft = tuftGeometry();
    const stem = new THREE.PlaneGeometry(0.014, 0.34).translate(0, 0.17, 0);
    const head = new THREE.IcosahedronGeometry(0.045, 0).scale(1, 0.55, 1).translate(0, 0.35, 0);
    const greens = ['#7d9a4c', '#6a8a3f', '#8ea85a', '#5f7d3a', '#93a35c'].map((c) => new THREE.Color(c));
    const petals = ['#f4f1ea', '#f6d36a', '#e8a0c0', '#b58ae0', '#ff9f5a', '#f2f2ff'].map((c) => new THREE.Color(c));

    const key = (x: number, z: number) => `${Math.floor(x / GRASS_CHUNK)},${Math.floor(z / GRASS_CHUNK)}`;
    const groups = new Map<string, { grass: number[]; flowers: number[] }>();
    const at = (k: string) => {
      let e = groups.get(k);
      if (!e) groups.set(k, (e = { grass: [], flowers: [] }));
      return e;
    };
    for (let i = 0; i < spots.length; i += 2) at(key(spots[i], spots[i + 1])).grass.push(spots[i], spots[i + 1]);
    for (let i = 0; i < flowerSpots.length; i += 2) at(key(flowerSpots[i], flowerSpots[i + 1])).flowers.push(flowerSpots[i], flowerSpots[i + 1]);
    const d = this.dummy;
    for (const [k, e] of groups) {
      const [cx, cz] = k.split(',').map((v) => (Number(v) + 0.5) * GRASS_CHUNK);
      const meshes: THREE.InstancedMesh[] = [];
      if (e.grass.length) {
        const im = new THREE.InstancedMesh(tuft, grassMat, e.grass.length / 2);
        for (let i = 0; i < e.grass.length; i += 2) {
          d.position.set(e.grass[i], 0, e.grass[i + 1]);
          d.rotation.set(0, r() * 6.28, 0);
          const s = 0.7 + r() * 0.8;
          d.scale.set(s, s * (0.7 + r() * 0.7), s);
          d.updateMatrix();
          im.setMatrixAt(i / 2, d.matrix);
          im.setColorAt(i / 2, this.tmpColor.copy(greens[Math.floor(r() * greens.length)]));
        }
        meshes.push(im);
      }
      if (e.flowers.length) {
        const n = e.flowers.length / 2;
        const st = new THREE.InstancedMesh(stem, stemMat, n);
        const hd = new THREE.InstancedMesh(head, headMat, n);
        for (let i = 0; i < e.flowers.length; i += 2) {
          d.position.set(e.flowers[i], 0, e.flowers[i + 1]);
          d.rotation.set(0, r() * 6.28, 0);
          d.scale.setScalar(0.7 + r() * 0.7);
          d.updateMatrix();
          st.setMatrixAt(i / 2, d.matrix);
          hd.setMatrixAt(i / 2, d.matrix);
          hd.setColorAt(i / 2, petals[Math.floor(r() * petals.length)]);
        }
        meshes.push(st, hd);
      }
      for (const m of meshes) {
        m.receiveShadow = true;
        m.computeBoundingSphere();
        this.w.scene.add(m);
      }
      d.scale.setScalar(1);
      d.rotation.set(0, 0, 0);
      this.chunks.push({ meshes, x: cx, z: cz });
    }
  }

  // ------------------------------------------------------------------ birds circling high above
  private buildBirds() {
    const n = this.w.ul ? 18 : 10;
    const m = flap(new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.9, side: THREE.DoubleSide }), 7.5, 0.9, 0.05);
    this.birds = new THREE.InstancedMesh(birdGeometry(), m, n);
    this.birds.frustumCulled = false;
    this.birdData = new Float32Array(n * 6);
    const flocks = [
      [0, -40],
      [-60, 40],
      [55, 10],
    ];
    const r = this.rand;
    for (let i = 0; i < n; i++) {
      const [cx, cz] = flocks[i % flocks.length];
      this.birdData.set([cx + (r() - 0.5) * 8, cz + (r() - 0.5) * 8, 24 + r() * 26, 30 + r() * 22, (0.09 + r() * 0.05) * (i % 2 ? 1 : -1), r() * 6.28], i * 6);
    }
    this.w.scene.add(this.birds);
  }

  // ------------------------------------------------------------------ dragonflies over the lotus pond
  private buildDragonflies() {
    const n = this.w.ul ? 12 : 6;
    const m = flap(new THREE.MeshStandardMaterial({ color: '#2f6f8f', metalness: 0.3, roughness: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }), 55, 0.55, 0.012);
    this.flies = new THREE.InstancedMesh(dragonflyGeometry(), m, n);
    this.flies.frustumCulled = false;
    this.flyData = new Float32Array(n * 9);
    const { pond } = WORLD;
    const r = this.rand;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = pond.r * (0.4 + r() * 0.65);
      const hx = pond.x + Math.cos(a) * d;
      const hz = pond.z + Math.sin(a) * d;
      this.flyData.set([hx, hz, hx, 0.8, hz, hx, 0.8, hz, r() * 2], i * 9);
      this.flies.setColorAt(i, this.tmpColor.set(i % 3 === 0 ? '#c0452c' : i % 3 === 1 ? '#3f86a8' : '#5f8f3a'));
    }
    this.w.scene.add(this.flies);
  }

  // ------------------------------------------------------------------ cloth banners along the spirit way
  private buildBanners() {
    const w = this.w;
    const branches = PATHS.filter(([x1]) => Math.abs(x1) < 2.6 && x1 !== 0).map(([, z1]) => z1);
    const zs = [8, 24, 40, 56, 72, 88, 104].filter((z) => !branches.some((bz) => Math.abs(bz - z) < 3.5));
    const spots: [number, number][] = [];
    // keep every pole well clear of the side paths that branch off the spirit way
    const clear = (x: number, z: number) =>
      PATHS.every(([x1, z1, x2, z2, wd]) => {
        if (x1 === 0 && x2 === 0) return true;
        const dx = x2 - x1;
        const dz = z2 - z1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) > wd / 2 + 1.2;
      });
    for (const z of zs) for (const sx of [-1, 1]) if (clear(sx * 4, z)) spots.push([sx * 4, z]);
    const H = 6.2;
    const pole = new THREE.CylinderGeometry(0.07, 0.1, H, 8);
    const arm = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6).rotateZ(Math.PI / 2);
    const base = new THREE.CylinderGeometry(0.28, 0.34, 0.3, 10);
    const tip = new THREE.ConeGeometry(0.09, 0.32, 8);
    for (const [x, z] of spots) {
      w.batch.add(base, w.m.stone, mat(x, 0.15, z));
      w.batch.add(pole, w.m.lacquer, mat(x, H / 2, z));
      w.batch.add(arm, w.m.woodDark, mat(x - Math.sign(x) * 0.45, H - 0.25, z), false);
      w.batch.add(tip, w.m.gold, mat(x, H + 0.16, z), false);
      w.circles.push({ x, z, r: 0.3 });
    }
    const g = new THREE.PlaneGeometry(0.62, 3.0, 2, 12).translate(0, -1.5, 0);
    const m = cloth(new THREE.MeshStandardMaterial({ map: textures.banner(), side: THREE.DoubleSide, roughness: 0.9 }), 0.16);
    const im = new THREE.InstancedMesh(g, m, spots.length);
    const cols = ['#e3a43a', '#b8452c', '#e8c25a', '#c46a2a'].map((c) => new THREE.Color(c));
    spots.forEach(([x, z], i) => {
      this.dummy.position.set(x - Math.sign(x) * 0.75, H - 0.28, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      im.setMatrixAt(i, this.dummy.matrix);
      im.setColorAt(i, cols[i % cols.length]);
    });
    im.castShadow = false;
    im.computeBoundingSphere();
    w.scene.add(im);
  }

  // ------------------------------------------------------------------ real light from the nearest lanterns at night
  private buildLanternLights() {
    const n = this.w.ul ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight('#ffb066', 0, 11, 1.8);
      l.position.set(0, -100, 0);
      this.w.scene.add(l);
      this.lights.push(l);
    }
  }

  // ------------------------------------------------------------------ ultra: blossom petals
  private buildPetals() {
    const n = 240;
    const m = new THREE.MeshStandardMaterial({ color: '#f6c9d6', side: THREE.DoubleSide, roughness: 0.8, emissive: '#2a1418' });
    this.petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 5).scale(1, 0.7, 1), m, n);
    this.petals.frustumCulled = false;
    this.petals.count = 0;
    this.petalData = new Float32Array(n * 5);
    this.w.scene.add(this.petals);
  }

  // ------------------------------------------------------------------ ultra: ripple rings on the pond
  private buildRipples() {
    const n = 14;
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ripples = new THREE.InstancedMesh(new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), m, n);
    this.ripples.frustumCulled = false;
    this.rippleData = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.rippleData[i * 4 + 2] = this.rand() * 4;
      this.rippleData[i * 4 + 3] = 0;
      this.ripples.setColorAt(i, this.tmpColor.setRGB(0, 0, 0));
    }
    this.w.scene.add(this.ripples);
  }

  // ------------------------------------------------------------------ ultra: sun shafts + dust motes in the halls
  private buildHallLight() {
    const cards: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    const motes: number[] = [];
    const r = this.rand;
    for (const h of HALLS) {
      const main = h.id === 'main';
      const H = main ? 11 : 8;
      const top = h.h;
      const front = h.z + h.d / 2;
      const n = main ? 5 : 3;
      const rise = H - 1.4;
      const run = rise * 0.95;
      const len = Math.hypot(rise, run);
      const card = new THREE.PlaneGeometry(main ? 3.2 : 2.6, len);
      const up = new THREE.Vector3(0, rise, run).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, up);
      for (let i = 0; i < n; i++) {
        const x = h.x + (i - (n - 1) / 2) * (main ? 5.2 : 4.6);
        const c = new THREE.Vector3(x, top + rise / 2 + 0.05, front - 0.6 - run / 2);
        cards.push([card, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1))]);
        for (let k = 0; k < (main ? 90 : 70); k++) {
          const t = r();
          motes.push(x + (r() - 0.5) * 2.6, top + 0.3 + t * rise, front - 0.6 - (1 - t) * run + (r() - 0.5) * 1.5);
        }
      }
    }
    this.rays = new THREE.Mesh(
      merge(cards),
      new THREE.MeshBasicMaterial({ map: textures.shaft(), color: '#ffdcaa', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.rays.renderOrder = 2;
    this.w.scene.add(this.rays);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(motes, 3));
    this.motes = new THREE.Points(
      g,
      drift(new THREE.PointsMaterial({ map: textures.softDot(), color: '#ffe6b8', size: 0.06, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), 0.3),
    );
    this.w.scene.add(this.motes);
  }

  setHour(day: number, golden: number, night: number) {
    this.night = night;
    if (this.rays) (this.rays.material as THREE.MeshBasicMaterial).opacity = day * 0.2 + golden * 0.18;
    if (this.motes) (this.motes.material as THREE.PointsMaterial).opacity = day * 0.55 + golden * 0.3;
    if (this.birds) this.birds.visible = night < 0.6;
    if (this.flies) this.flies.visible = night < 0.5;
  }

  update(dt: number, t: number, fx: number, fz: number) {
    const d = this.dummy;
    // grass chunks near the visitor only
    this.cullClock += dt;
    if (this.cullClock > 0.25 && this.chunks.length) {
      this.cullClock = 0;
      const lim = (GRASS_RANGE + GRASS_CHUNK * 0.71) ** 2;
      for (const c of this.chunks) {
        const v = (c.x - fx) ** 2 + (c.z - fz) ** 2 < lim;
        for (const m of c.meshes) m.visible = v;
      }
    }
    // birds: wide lazy circles with a little bank and bob
    if (this.birds?.visible && this.birdData) {
      const b = this.birdData;
      for (let i = 0; i < this.birds.count; i++) {
        const k = i * 6;
        const a = t * b[k + 4] + b[k + 5];
        const dir = Math.sign(b[k + 4]);
        d.position.set(b[k] + Math.cos(a) * b[k + 2], b[k + 3] + Math.sin(t * 0.4 + i) * 1.5, b[k + 1] + Math.sin(a) * b[k + 2]);
        d.rotation.set(0, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), -0.25 * dir, 'YXZ');
        d.scale.setScalar(1.3);
        d.updateMatrix();
        this.birds.setMatrixAt(i, d.matrix);
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }
    // dragonflies: hover, then dart to a new spot near home
    if (this.flies?.visible && this.flyData) {
      const f = this.flyData;
      const r = this.rand;
      for (let i = 0; i < this.flies.count; i++) {
        const k = i * 9;
        f[k + 8] -= dt;
        if (f[k + 8] <= 0) {
          f[k + 8] = 0.8 + r() * 2.5;
          f[k + 5] = f[k] + (r() - 0.5) * 6;
          f[k + 6] = 0.35 + r() * 1.0;
          f[k + 7] = f[k + 1] + (r() - 0.5) * 6;
        }
        const e = 1 - Math.exp(-dt * 4);
        const px = f[k + 2];
        const pz = f[k + 4];
        f[k + 2] += (f[k + 5] - f[k + 2]) * e;
        f[k + 3] += (f[k + 6] - f[k + 3]) * e;
        f[k + 4] += (f[k + 7] - f[k + 4]) * e;
        const vx = f[k + 2] - px;
        const vz = f[k + 4] - pz;
        d.position.set(f[k + 2], f[k + 3] + Math.sin(t * 9 + i) * 0.015, f[k + 4]);
        if (vx * vx + vz * vz > 1e-6) d.rotation.set(0, Math.atan2(vx, vz), 0);
        d.scale.setScalar(1.6);
        d.updateMatrix();
        this.flies.setMatrixAt(i, d.matrix);
      }
      this.flies.instanceMatrix.needsUpdate = true;
    }
    // petals drift down around blossoming trees close to the visitor
    if (this.petals && this.petalData) {
      this.bloomClock += dt;
      if (this.bloomClock > 1) {
        this.bloomClock = 0;
        this.nearBlooms.length = 0;
        for (const bl of this.w.blossoms) if ((bl.x - fx) ** 2 + (bl.z - fz) ** 2 < 48 * 48) this.nearBlooms.push(bl);
        const want = this.nearBlooms.length ? this.petalData.length / 5 : 0;
        if (want && !this.petals.count) for (let i = 0; i < want; i++) this.petalData[i * 5 + 1] = -1; // respawn all
        this.petals.count = want;
      }
      const p = this.petalData;
      const r = this.rand;
      for (let i = 0; i < this.petals.count; i++) {
        const k = i * 5;
        p[k + 1] -= p[k + 4] * dt;
        if (p[k + 1] < 0.03) {
          const bl = this.nearBlooms[Math.floor(r() * this.nearBlooms.length)];
          const a = r() * Math.PI * 2;
          const rr = Math.sqrt(r()) * 3.2;
          p[k] = bl.x + Math.cos(a) * rr;
          p[k + 1] = bl.y * (0.6 + r() * 0.5);
          p[k + 2] = bl.z + Math.sin(a) * rr;
          p[k + 3] = r() * 6;
          p[k + 4] = 0.25 + r() * 0.35;
        }
        const ph = p[k + 3] + t * 1.7;
        p[k] += Math.sin(t * 0.3) * 0.12 * dt; // a light breeze
        d.position.set(p[k] + Math.sin(ph) * 0.35, p[k + 1], p[k + 2] + Math.cos(ph * 0.8) * 0.25);
        d.rotation.set(ph, ph * 0.7, ph * 0.4);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.petals.setMatrixAt(i, d.matrix);
      }
      if (this.petals.count) this.petals.instanceMatrix.needsUpdate = true;
    }
    // ripple rings spreading where a fish touched the surface
    if (this.ripples && this.rippleData) {
      const rp = this.rippleData;
      const { pond } = WORLD;
      const r = this.rand;
      for (let i = 0; i < this.ripples.count; i++) {
        const k = i * 4;
        rp[k + 2] += dt;
        if (rp[k + 2] > rp[k + 3]) {
          let x = 0;
          let z = 0;
          do {
            const a = r() * Math.PI * 2;
            const dd = Math.sqrt(r()) * (pond.r - 2);
            x = pond.x + Math.cos(a) * dd;
            z = pond.z + Math.sin(a) * dd;
          } while (Math.abs(z - BRIDGE.z) < 2.2);
          rp[k] = x;
          rp[k + 1] = z;
          rp[k + 2] = 0;
          rp[k + 3] = 2.2 + r() * 2.2;
        }
        const f = rp[k + 2] / rp[k + 3];
        d.position.set(rp[k], 0.075, rp[k + 1]);
        d.rotation.set(0, 0, 0);
        d.scale.setScalar(0.08 + f * 1.4);
        d.updateMatrix();
        this.ripples.setMatrixAt(i, d.matrix);
        const v = (1 - f) * (1 - f) * Math.min(1, f * 8);
        this.ripples.setColorAt(i, this.tmpColor.setRGB(v, v, v));
      }
      this.ripples.instanceMatrix.needsUpdate = true;
      if (this.ripples.instanceColor) this.ripples.instanceColor.needsUpdate = true;
    }
    // lantern lights: re-pick the nearest lanterns twice a second, flicker every frame
    if (this.lights.length) {
      this.lightClock += dt;
      const spots = this.w.lanternSpots;
      if (this.lightClock > 0.5 && this.night > 0.05) {
        this.lightClock = 0;
        const o = this.order;
        o.length = 0;
        for (let i = 0; i < spots.length; i++) o.push(i);
        const dist = (i: number) => (spots[i].x - fx) ** 2 + (spots[i].z - fz) ** 2;
        for (let j = 0; j < this.lights.length && j < o.length; j++) {
          let best = j;
          for (let i = j + 1; i < o.length; i++) if (dist(o[i]) < dist(o[best])) best = i;
          [o[j], o[best]] = [o[best], o[j]];
          const s = spots[o[j]];
          this.lights[j].position.set(s.x, s.y - 0.15, s.z);
        }
      }
      for (let j = 0; j < this.lights.length; j++) {
        const fl = 1 + 0.12 * Math.sin(t * 11 + j * 2.1) + 0.08 * Math.sin(t * 27.3 + j);
        this.lights[j].intensity = this.night * 5.5 * fl;
      }
    }
    d.scale.setScalar(1);
    d.rotation.set(0, 0, 0);
  }

  dispose() {
    for (const l of this.lights) l.removeFromParent();
    this.lights.length = 0;
    this.chunks.length = 0;
  }
}
