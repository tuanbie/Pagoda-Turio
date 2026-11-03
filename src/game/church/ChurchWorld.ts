import * as THREE from 'three';
import { CHURCH_CANDLES, CHURCH_SEATS, INCENSE_BURN_MS, INCENSE_SLOTS, type TableSnap } from '@sontu/shared';
import { Batch, mat, rng, type Box, type Circle, type WorldOptions } from '../World.ts';
import { textures } from '../textures.ts';
import { churchTextures as ct } from './textures.ts';
import { Doves } from './doves.ts';
import { serverNow } from '../../store.ts';
import {
  AISLE_X,
  APSE_R,
  APSE_Z,
  C,
  CHOIR_X,
  CROSS_Z0,
  DOOR_HALF,
  NAVE_Z0,
  PEW_TOP,
  SANCTUARY_RISE,
  SIDE_DOOR,
  TRANSEPT_X,
  WALL_T,
  YARD,
  candleBase,
  churchHeight,
  inChurch,
} from './layout.ts';

/**
 * The church grounds: a fictional Gothic church in a walled churchyard, with a cloister garden,
 * a fountain and three side rooms you can walk into (sacristy, library, refectory).
 *
 * Exposes the same surface the game uses on the temple World (scene, clickables, colliders,
 * seats, candles as "sticks", the bell, doves as "pond", stubs for the temple-only shuttle,
 * DJ and game tables), so Game.ts drives both places the same way.
 *
 * Deliberately distinct from the temple: cool limestone, slate and stained glass instead of
 * lacquer, timber and glazed tiles; pointed arches and vaults instead of curved hip roofs;
 * candles, pews and doves instead of incense, cushions and koi.
 */

const F = C.floorH;
/** belfry stage (30 m to the tower top): sill top, arch springing, crown bottom, opening width */
const BELFRY = { sill: 33.5, spring: 38.0, top: 41.0, open: 4.0 };
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Pointed (two-centred) arch outline: width w, springing at height s, apex at s + w*k. */
function pointedArch(w: number, s: number, k = 0.75, seg = 10): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const r = w * k; // radius of each arc; centres at ±(r - w/2)
  const c = r - w / 2;
  const apex = Math.sqrt(r * r - c * c);
  pts.push(new THREE.Vector2(-w / 2, 0));
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI - (i / seg) * Math.acos(c / r);
    pts.push(new THREE.Vector2(c + Math.cos(a) * r, s + Math.sin(a) * r));
  }
  for (let i = seg; i >= 0; i--) {
    const a = (i / seg) * Math.acos(c / r);
    pts.push(new THREE.Vector2(-c + Math.cos(a) * r, s + Math.sin(a) * r));
  }
  pts.push(new THREE.Vector2(w / 2, 0));
  void apex;
  return pts;
}
const archApex = (w: number, s: number, k = 0.75) => {
  const r = w * k;
  const c = r - w / 2;
  return s + Math.sqrt(r * r - c * c);
};

/** A band (rib / archivolt) following a pointed arch: extruded thickness t, depth d. */
function archBand(w: number, s: number, t: number, d: number, k = 0.75, seg = 10) {
  const outer = pointedArch(w + t * 2, s, k * (w / (w + t * 2)) + (1 - w / (w + t * 2)) * 0.5, seg);
  const inner = pointedArch(w, s, k, seg);
  const shape = new THREE.Shape(outer.slice(1, -1));
  shape.lineTo(inner[inner.length - 2].x, inner[inner.length - 2].y);
  for (let i = inner.length - 2; i >= 1; i--) shape.lineTo(inner[i].x, inner[i].y);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 2 });
  g.translate(0, 0, -d / 2);
  return g;
}

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);

/** Octagonal spire (pyramid) with a slight entasis. */
function spire(r: number, h: number) {
  const g = new THREE.ConeGeometry(r, h, 8, 6, true);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h + 0.5; // 0 bottom … 1 top
    const k = 1 + Math.sin(y * Math.PI) * 0.06;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

interface Prop {
  kind: 'prop';
  prop: string;
  spot: { x: number; z: number; r: number };
  sit?: boolean;
  y?: number;
}

export class ChurchWorld {
  readonly place = 'church' as const;
  readonly scene = new THREE.Scene();
  readonly clickables: THREE.Object3D[] = [];
  readonly circles: Circle[] = [];
  readonly boxes: Box[] = [];
  /** invisible boxes (walls, ceilings) the third-person camera must not pass through */
  readonly occluders: THREE.Object3D[] = [];
  private occMat = new THREE.MeshBasicMaterial({ visible: false });
  readonly m: Record<string, THREE.MeshStandardMaterial>;
  readonly batch = new Batch();
  readonly sun: THREE.DirectionalLight;
  night = 0;

  // temple-only features: harmless stubs so Game can treat both places alike
  readonly dj = { animate: (_dt: number, _p: number, _s: number, _k: boolean, _b: number) => {} };
  readonly gameTables = { set: (_s: TableSnap) => {} };
  readonly shuttle = {
    arrive: (onDrop: () => void, _rider?: THREE.Object3D | null) => onDrop(),
    carts: (): THREE.Vector3[] => [],
    latest: (): THREE.Vector3 | null => null,
    update: (_t: number) => {},
  };
  readonly pond: Doves;

  private hemi: THREE.HemisphereLight;
  private fill: THREE.AmbientLight;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private sunDisc: THREE.Mesh;
  private moonDisc: THREE.Mesh;
  private glass: THREE.MeshStandardMaterial[] = [];
  private lampMats: THREE.MeshStandardMaterial[] = [];
  private lights: THREE.PointLight[] = [];
  private seatMarkers!: THREE.InstancedMesh;
  private wax!: THREE.InstancedMesh;
  private flames!: THREE.InstancedMesh;
  private halos!: THREE.Points;
  private candleLight: THREE.PointLight[] = [];
  private litAt = new Map<number, number>();
  private bell!: THREE.Object3D;
  private bellSwing = 0;
  private water: THREE.Mesh | null = null;
  private jets: THREE.Points | null = null;
  private jetAge: Float32Array | null = null;
  private dummy = new THREE.Object3D();
  private clock = 0;
  private fx = 0;
  private fz = 0;

  constructor(readonly opt: WorldOptions) {
    const s = this.scene;
    const hi = !opt.low && opt.density >= 1;
    const ultra = !!opt.ultra;
    s.fog = new THREE.FogExp2('#cfd6dc', opt.low ? 0.0105 : opt.density < 1 ? 0.007 : ultra ? 0.003 : 0.004);

    const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
      if (!opt.low) return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...p });
      const { roughness: _r, metalness: _m, ...rest } = p;
      return new THREE.MeshLambertMaterial(rest as THREE.MeshLambertMaterialParameters) as unknown as THREE.MeshStandardMaterial;
    };
    const lime = ct.limestone();
    this.m = {
      grass: std({ map: textures.grass(), roughness: 1, color: '#c9d6b8' }),
      paving: std({ map: textures.paving(), roughness: 0.9, color: '#d6d2ca' }),
      gravel: std({ map: ct.gravel(), roughness: 1 }),
      limestone: std({ map: lime, roughness: 0.9 }),
      stone: std({ color: '#b3ada1', roughness: 0.92 }),
      stoneDark: std({ color: '#7d7a73', roughness: 0.95 }),
      plaster: std({ color: '#e6e1d6', roughness: 0.95 }),
      marble: std({ map: ct.marble(), roughness: 0.25, metalness: 0.02 }),
      slateRoof: std({ map: ct.slate(), roughness: 0.6, side: THREE.DoubleSide }),
      pew: std({ map: ct.oak(), roughness: 0.45 }),
      floor: std({ map: textures.wood(), roughness: 0.6 }),
      woodDark: std({ color: '#3b2416', roughness: 0.6 }),
      iron: std({ color: '#26282b', roughness: 0.45, metalness: 0.7 }),
      bronze: std({ color: '#7a5c3a', metalness: 0.75, roughness: 0.35 }),
      gold: std({ color: '#d8ad55', metalness: 0.8, roughness: 0.28 }),
      white: std({ color: '#f4f1ea', roughness: 0.7 }),
      red: std({ color: '#7d1b22', roughness: 0.8 }),
      wax: std({ color: '#f3ead6', roughness: 0.55, emissive: '#3a2a10', emissiveIntensity: 0.15 }),
      bark: std({ map: textures.bark(), roughness: 1 }),
      leaf: std({ color: '#3f6638', flatShading: !hi }),
      leaf2: std({ color: '#5d8248', flatShading: !hi }),
      cypress: std({ color: '#2c4a30', flatShading: !hi }),
      hedge: std({ color: '#38603a', flatShading: !hi }),
      soil: std({ color: '#5b4634' }),
      water: std({ color: '#5d8a98', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.85 }),
      hill: std({ color: '#5d7160', flatShading: true }),
      hill2: std({ color: '#71846f', flatShading: true }),
      rose: std({ color: '#c23a4a' }),
      rose2: std({ color: '#f1e3e6' }),
      lavender: std({ color: '#8a78b8' }),
      book: std({ color: '#6b2e2a', roughness: 0.8 }),
      book2: std({ color: '#2d4a6b', roughness: 0.8 }),
      book3: std({ color: '#3f5a33', roughness: 0.8 }),
      cloth: std({ color: '#c8c0ad', roughness: 1 }),
    };
    const lamp = std({ color: '#fff1c8', emissive: '#ffc26a', emissiveIntensity: 0.2 });
    this.m.lamp = lamp;
    this.lampMats.push(lamp);

    // ---------- sky (cooler, paler than the temple's) ----------
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#7aa1c8') },
        bottom: { value: new THREE.Color('#e3e6e6') },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        glow: { value: new THREE.Color('#fff1cf') },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 glow; varying vec3 vDir;
        void main(){
          float h = smoothstep(-0.05, 0.6, vDir.y);
          vec3 c = mix(bottom, top, h);
          float s = max(dot(vDir, normalize(sunDir)), 0.0);
          c += glow * (pow(s, 48.0) * 0.6 + pow(s, 6.0) * 0.16);
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), this.skyMat));
    const starGeo = new THREE.BufferGeometry();
    const sc = opt.low ? 400 : 1200;
    const sp = new Float32Array(sc * 3);
    const sr = rng(17);
    for (let i = 0; i < sc; i++) {
      const th = sr() * Math.PI * 2;
      const ph = Math.acos(0.1 + sr() * 0.9);
      sp.set([Math.cos(th) * Math.sin(ph) * 460, Math.cos(ph) * 460, Math.sin(th) * Math.sin(ph) * 460], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false }));
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 10), new THREE.MeshBasicMaterial({ color: '#fff6dc', fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 10), new THREE.MeshBasicMaterial({ color: '#eef0ff', fog: false }));
    s.add(this.stars, this.sunDisc, this.moonDisc);

    // ---------- lights ----------
    this.hemi = new THREE.HemisphereLight('#eef3ff', '#5d6658', 0.9);
    this.fill = new THREE.AmbientLight('#f2f0ea', opt.low ? 0.55 : 0);
    this.sun = new THREE.DirectionalLight('#fff3dc', 2.4);
    if (opt.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(opt.shadowSize, opt.shadowSize);
      const cam = this.sun.shadow.camera;
      const ext = ultra ? 56 : 36;
      cam.left = cam.bottom = -ext;
      cam.right = cam.top = ext;
      cam.near = 1;
      cam.far = 260;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.03;
    }
    s.add(this.hemi, this.fill, this.sun, this.sun.target);

    // ---------- build ----------
    this.buildGround(hi);
    this.buildChurch(hi, ultra);
    this.buildTowers(hi, ultra);
    this.buildInterior(hi, ultra);
    this.buildRooms(hi);
    this.buildCloister(hi, ultra);
    this.buildYard(hi);
    for (const mesh of this.batch.flush(s, opt.shadows)) mesh.receiveShadow = opt.shadows;
    this.buildSeats();
    this.buildCandles();
    this.pond = new Doves(s, hi);
  }

  // =================================================================== helpers
  private box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, cast = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) / 3, uv.getY(i) * h / 3);
    this.batch.add(g, m, mat(x, y, z, ry), cast);
  }
  private plane(w: number, d: number, m: THREE.Material, x: number, y: number, z: number, tile = 3, ry = 0) {
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    this.batch.add(g, m, mat(x, y, z, ry), false);
  }
  private collide(x0: number, x1: number, z0: number, z1: number) {
    this.boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  }
  /** an invisible box the camera stops in front of (never rendered, raycast only) */
  private occ(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.occMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.updateMatrixWorld(true);
    this.occluders.push(m);
  }
  /** wall running along z at x, from z0 to z1, with door gaps [zc, half] */
  private wallZ(x: number, z0: number, z1: number, h: number, m: THREE.Material, gaps: [number, number][] = [], t = WALL_T, base = 0, lintel = 3.2) {
    const a = Math.min(z0, z1);
    const b = Math.max(z0, z1);
    let cur = a;
    const cuts = [...gaps].sort((p, q) => p[0] - q[0]);
    for (const [zc, half] of [...cuts, [b + 1e9, 0] as [number, number]]) {
      const end = Math.min(b, zc - half);
      if (end > cur + 0.01) {
        this.box(t, h, end - cur, m, x, base + h / 2, (cur + end) / 2);
        this.collide(x - t / 2, x + t / 2, cur, end);
        this.occ(t, h, end - cur, x, base + h / 2, (cur + end) / 2);
      }
      if (zc < b + 1e8) {
        // lintel over the door
        this.box(t, h - lintel, half * 2, m, x, base + lintel + (h - lintel) / 2, zc);
        this.occ(t, h - lintel, half * 2, x, base + lintel + (h - lintel) / 2, zc);
        cur = zc + half;
      }
    }
  }
  private wallX(z: number, x0: number, x1: number, h: number, m: THREE.Material, gaps: [number, number][] = [], t = WALL_T, base = 0, lintel = 3.2) {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    let cur = a;
    const cuts = [...gaps].sort((p, q) => p[0] - q[0]);
    for (const [xc, half] of [...cuts, [b + 1e9, 0] as [number, number]]) {
      const end = Math.min(b, xc - half);
      if (end > cur + 0.01) {
        this.box(end - cur, h, t, m, (cur + end) / 2, base + h / 2, z);
        this.collide(cur, end, z - t / 2, z + t / 2);
        this.occ(end - cur, h, t, (cur + end) / 2, base + h / 2, z);
      }
      if (xc < b + 1e8) {
        this.box(half * 2, h - lintel, t, m, xc, base + lintel + (h - lintel) / 2, z);
        this.occ(half * 2, h - lintel, t, xc, base + lintel + (h - lintel) / 2, z);
        cur = xc + half;
      }
    }
  }
  /** a stained-glass lancet: emissive textured plane (both sides), never casts shadows so the sun shines through */
  private lancet(x: number, y: number, z: number, w: number, h: number, ry: number, seed: number) {
    const tex = ct.lancet(seed);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.3, side: THREE.DoubleSide });
    if (this.opt.low) m.emissiveIntensity = 0.8;
    this.glass.push(m);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    p.castShadow = false;
    this.scene.add(p);
  }
  private addProp(hit: THREE.Mesh, p: Prop) {
    hit.userData = { ...p };
    this.scene.add(hit);
    this.clickables.push(hit);
  }
  private hitBox(w: number, h: number, d: number, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z);
    return m;
  }

  // =================================================================== ground & churchyard
  private buildGround(hi: boolean) {
    const M = this.m;
    const g = new THREE.CircleGeometry(420, 72).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 140, uv.getY(i) * 140);
    const ground = new THREE.Mesh(g, M.grass);
    ground.receiveShadow = this.opt.shadows;
    this.scene.add(ground);
    // plaza in front of the west door, the avenue to the gate, paths round the church
    this.plane(C.plaza.w, C.plaza.d, M.paving, C.plaza.x, 0.02, C.plaza.z, 2.5);
    this.plane(5, C.gate.z - (C.plaza.z + C.plaza.d / 2), M.gravel, 0, 0.015, (C.gate.z + C.plaza.z + C.plaza.d / 2) / 2, 3);
    this.plane(3, 44, M.gravel, AISLE_X + 4, 0.015, -14, 3); // east path
    this.plane(3, 44, M.gravel, -AISLE_X - 4, 0.015, -14, 3); // west path
    this.plane(31 - (AISLE_X + 1.8), 3, M.gravel, (31 + AISLE_X + 1.8) / 2, 0.016, SIDE_DOOR.z, 3); // side door → cloister
    // plaza centre: round flower bed with a low stone kerb
    const bed = new THREE.CylinderGeometry(3.4, 3.5, 0.35, 32);
    this.batch.add(bed, M.stone, mat(0, 0.17, C.plaza.z + 2));
    this.batch.add(new THREE.CylinderGeometry(3.1, 3.1, 0.06, 32), M.soil, mat(0, 0.36, C.plaza.z + 2), false);
    this.circles.push({ x: 0, z: C.plaza.z + 2, r: 3.6 });
    this.flowers(0, C.plaza.z + 2, 3, hi ? 160 : 70, [M.rose, M.rose2, M.lavender], 0.38);
    // distant hills ring
    const r = rng(91);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2;
      const d = 260 + r() * 90;
      const h = 30 + r() * 50;
      this.batch.add(new THREE.ConeGeometry(40 + r() * 40, h, 7), i % 2 ? M.hill : M.hill2, mat(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d, r() * 3), false);
    }
  }

  private flowers(cx: number, cz: number, rad: number, n: number, mats: THREE.Material[], y: number) {
    const r = rng(Math.floor(cx * 13 + cz * 7) >>> 0);
    const geo = new THREE.IcosahedronGeometry(0.09, 0);
    for (const m of mats) {
      const im = new THREE.InstancedMesh(geo, m, Math.ceil(n / mats.length));
      for (let i = 0; i < im.count; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * rad;
        this.dummy.position.set(cx + Math.cos(a) * d, y + r() * 0.25, cz + Math.sin(a) * d);
        this.dummy.scale.setScalar(0.7 + r() * 0.8);
        this.dummy.updateMatrix();
        im.setMatrixAt(i, this.dummy.matrix);
      }
      this.dummy.scale.setScalar(1);
      this.scene.add(im);
    }
  }

  private buildYard(hi: boolean) {
    const M = this.m;
    const { x0, x1, z0, z1 } = YARD;
    // low stone wall with coping, gate gap on the south side
    const h = 1.6;
    for (const [a, b] of [
      [x0, -3],
      [3, x1],
    ] as [number, number][]) {
      this.box(b - a, h, 0.7, M.stone, (a + b) / 2, h / 2, z1);
      this.box(b - a + 0.2, 0.15, 0.9, M.stoneDark, (a + b) / 2, h + 0.07, z1);
      this.collide(a, b, z1 - 0.35, z1 + 0.35);
    }
    this.box(x1 - x0, h, 0.7, M.stone, 0, h / 2, z0);
    this.collide(x0, x1, z0 - 0.35, z0 + 0.35);
    for (const x of [x0, x1]) {
      this.box(0.7, h, z1 - z0, M.stone, x, h / 2, (z0 + z1) / 2);
      this.collide(x - 0.35, x + 0.35, z0, z1);
    }
    // gate piers + open wrought-iron gates
    for (const sx of [-1, 1]) {
      this.box(1.1, 3.2, 1.1, M.stone, sx * 3.5, 1.6, z1);
      this.batch.add(new THREE.SphereGeometry(0.45, 14, 10), M.stone, mat(sx * 3.5, 3.5, z1));
      const gate = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), M.iron);
        bar.position.set(sx * (0.15 + i * 0.32), 1.25, 0);
        gate.add(bar);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), M.iron);
        tip.position.set(sx * (0.15 + i * 0.32), 2.5, 0);
        gate.add(tip);
      }
      for (const y of [0.3, 2.1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.06, 0.06), M.iron);
        rail.position.set(sx * 1.45, y, 0);
        gate.add(rail);
      }
      gate.position.set(sx * 2.95, 0, z1);
      gate.rotation.y = sx * -1.3; // swung open into the yard
      this.batch.addObject(gate);
    }
    // the avenue: cypresses and iron lamp posts on both sides
    for (let z = C.plaza.z + C.plaza.d / 2 + 4; z < z1 - 4; z += 7) {
      for (const sx of [-1, 1]) {
        this.cypress(sx * 5.5, z, hi);
        this.lampPost(sx * 3.6, z + 3.5);
      }
    }
    // lindens and plane trees scattered on the lawns, kept clear of buildings and paths
    const r = rng(303);
    let placed = 0;
    for (let i = 0; i < 400 && placed < (hi ? 70 : 38); i++) {
      const x = x0 + 6 + r() * (x1 - x0 - 12);
      const z = z0 + 6 + r() * (z1 - z0 - 12);
      if (Math.abs(x) < 30 && z > -75 && z < 46) continue; // church + plaza
      if (x > 24 && x < 68 && z > -56 && z < 4) continue; // cloister + rooms
      if (Math.abs(x) < 9 && z > 40) continue; // avenue
      if (this.circles.some((c) => Math.hypot(c.x - x, c.z - z) < 5)) continue;
      placed++;
      if (r() < 0.3) this.cypress(x, z, hi);
      else this.broadTree(x, z, r, hi);
    }
    // hedges along the plaza edges
    for (const sx of [-1, 1]) {
      this.box(0.9, 1.1, C.plaza.d - 6, M.hedge, sx * (C.plaza.w / 2 - 0.5), 0.55, C.plaza.z + 1);
      this.collide(sx * (C.plaza.w / 2 - 0.5) - 0.45, sx * (C.plaza.w / 2 - 0.5) + 0.45, C.plaza.z - C.plaza.d / 2 + 4, C.plaza.z + C.plaza.d / 2 - 2);
    }
  }

  private cypress(x: number, z: number, hi: boolean) {
    const h = 7 + ((x * 31 + z * 17) % 3);
    this.batch.add(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), this.m.bark, mat(x, 0.6, z));
    const seg = hi ? 12 : 7;
    const g = new THREE.SphereGeometry(1, seg, seg).scale(0.9, h / 2, 0.9);
    this.batch.add(g, this.m.cypress, mat(x, 0.9 + h / 2, z));
    this.circles.push({ x, z, r: 0.7 });
  }

  private broadTree(x: number, z: number, r: () => number, hi: boolean) {
    const h = 4 + r() * 2;
    this.batch.add(new THREE.CylinderGeometry(0.28, 0.42, h, 8), this.m.bark, mat(x, h / 2, z));
    const blobs = hi ? 7 : 4;
    for (let i = 0; i < blobs; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 1.8;
      const s = 1.6 + r() * 1.2;
      this.batch.add(new THREE.IcosahedronGeometry(1, hi ? 2 : 1), i % 2 ? this.m.leaf : this.m.leaf2, mat(x + Math.cos(a) * d, h + 0.6 + r() * 1.4, z + Math.sin(a) * d, r() * 3, s, s * 0.8, s));
    }
    this.circles.push({ x, z, r: 0.6 });
  }

  private lampPost(x: number, z: number) {
    const M = this.m;
    this.batch.add(new THREE.CylinderGeometry(0.06, 0.09, 3.2, 8), M.iron, mat(x, 1.6, z));
    this.batch.add(new THREE.CylinderGeometry(0.2, 0.14, 0.12, 8), M.iron, mat(x, 3.25, z));
    this.batch.add(new THREE.BoxGeometry(0.32, 0.42, 0.32), M.lamp, mat(x, 3.52, z));
    this.batch.add(new THREE.ConeGeometry(0.3, 0.3, 4), M.iron, mat(x, 3.88, z, Math.PI / 4));
    this.circles.push({ x, z, r: 0.25 });
  }

  // =================================================================== the church shell
  private buildChurch(hi: boolean, ultra: boolean) {
    const M = this.m;
    const L = M.limestone;
    const aisleH = 10; // aisle walls
    const clereTop = 21; // top of the clerestory walls over the nave
    const vaultCam = F + 19.5; // camera ceiling inside the church (just under the vault springing)
    const z1 = 0;
    const z0 = NAVE_Z0;

    // floor: marble inside the whole footprint
    this.plane(AISLE_X * 2, -z0 + 0.6, M.marble, 0, F, (z0 + 0.6) / 2, 2.4);
    this.plane(TRANSEPT_X * 2, C.transept.d, M.marble, 0, F, C.transept.z, 2.4);
    this.plane(CHOIR_X * 2, APSE_Z - CROSS_Z0 < 0 ? CROSS_Z0 - APSE_Z : 6, M.marble, 0, F + SANCTUARY_RISE, (CROSS_Z0 + APSE_Z) / 2, 2.4);
    const apseFloor = new THREE.CircleGeometry(APSE_R, 32, 0, Math.PI).rotateX(-Math.PI / 2);
    this.batch.add(apseFloor, M.marble, mat(0, F + SANCTUARY_RISE, APSE_Z), false);
    // plinth around the footprint (the building sits three steps up)
    this.box(AISLE_X * 2 + 2.4, F, -z0 + 1.2, M.stoneDark, 0, F / 2 - 0.01, (z0 + 0.6) / 2, 0, false);
    this.box(TRANSEPT_X * 2 + 2.4, F, C.transept.d + 1.2, M.stoneDark, 0, F / 2 - 0.01, C.transept.z, 0, false);
    // sanctuary platform + steps
    this.box(CHOIR_X * 2, SANCTUARY_RISE, CROSS_Z0 - APSE_Z, M.stone, 0, F + SANCTUARY_RISE / 2, (CROSS_Z0 + APSE_Z) / 2, 0, false);
    for (let k = 0; k < 3; k++) this.box(CHOIR_X * 2 - 2, (SANCTUARY_RISE / 3) * (3 - k), 0.4, M.stone, 0, F + ((SANCTUARY_RISE / 3) * (3 - k)) / 2, CROSS_Z0 + 0.2 + k * 0.4, 0, false);
    // west steps
    for (let k = 0; k < 3; k++) this.box(12, (F / 3) * (3 - k), 0.6, M.stone, 0, ((F / 3) * (3 - k)) / 2, 0.9 + k * 0.6, 0, false);
    // east side-door steps
    for (let k = 0; k < 3; k++) this.box(0.6, (F / 3) * (3 - k), SIDE_DOOR.half * 2 + 0.8, M.stone, AISLE_X + 0.9 + k * 0.6, ((F / 3) * (3 - k)) / 2, SIDE_DOOR.z, 0, false);

    // ---- aisle walls with lancet windows (each bay) and the east side door ----
    for (const sx of [-1, 1]) {
      const x = sx * (AISLE_X + WALL_T / 2);
      const bays = Math.round((z1 - z0) / C.colStep);
      for (let b = 0; b < bays; b++) {
        const zc = z1 - C.colStep * (b + 0.5);
        const isDoor = sx === 1 && Math.abs(zc - SIDE_DOOR.z) < C.colStep / 2;
        // piers between windows, sill and head
        const winW = 2.0;
        const winS = F + 2.6;
        const winTop = F + 8.2;
        const pierLen = (C.colStep - winW) / 2;
        for (const side of [-1, 1]) {
          const pz = zc + side * (winW / 2 + pierLen / 2);
          this.box(WALL_T, aisleH, pierLen, L, x, F + aisleH / 2, pz);
        }
        if (isDoor) {
          this.box(WALL_T, aisleH - 3.6, winW, L, x, F + 3.6 + (aisleH - 3.6) / 2, zc);
          // door frame: pointed archivolt
          this.batch.add(archBand(2.6, F + 2.6, 0.25, WALL_T + 0.3), M.stone, mat(x, 0, zc, Math.PI / 2));
        } else {
          this.box(WALL_T, winS, winW, L, x, winS / 2, zc);
          this.box(WALL_T, F + aisleH - winTop, winW, L, x, winTop + (F + aisleH - winTop) / 2, zc);
          this.lancet(x, (winS + winTop) / 2, zc, winW, winTop - winS, Math.PI / 2, 100 + b * 2 + (sx > 0 ? 1 : 0));
        }
        // buttress outside every pier line + pinnacle
        const bz = z1 - C.colStep * b;
        if (b > 0) {
          this.box(1.4, aisleH + 1, 2.2, L, sx * (AISLE_X + WALL_T + 1.1), (aisleH + 1) / 2, bz);
          this.collide(sx * (AISLE_X + WALL_T), sx * (AISLE_X + WALL_T + 1.8), bz - 0.7, bz + 0.7);
          this.batch.add(new THREE.ConeGeometry(0.55, 2.4, 4), L, mat(sx * (AISLE_X + WALL_T + 1.1), aisleH + 2.2, bz, Math.PI / 4));
          if (hi) {
            // flying buttress: a quarter-arch from the buttress to the clerestory
            const fb = new THREE.TorusGeometry(4.2, 0.28, 6, 12, Math.PI / 2);
            this.batch.add(fb, L, mat(sx * (AISLE_X - 3.6), aisleH + 0.4, bz, sx < 0 ? Math.PI : 0));
          }
        }
      }
      // camera stops at the aisle walls (with the side door left open) and under the aisle ceiling
      if (sx === 1) {
        this.occ(WALL_T, aisleH + F, SIDE_DOOR.z - SIDE_DOOR.half - z0, x, (aisleH + F) / 2, (z0 + SIDE_DOOR.z - SIDE_DOOR.half) / 2);
        this.occ(WALL_T, aisleH + F, z1 - (SIDE_DOOR.z + SIDE_DOOR.half), x, (aisleH + F) / 2, (z1 + SIDE_DOOR.z + SIDE_DOOR.half) / 2);
      } else this.occ(WALL_T, aisleH + F, z1 - z0, x, (aisleH + F) / 2, (z0 + z1) / 2);
      this.occ(AISLE_X - C.colX, 0.4, z1 - z0, sx * (C.colX + (AISLE_X - C.colX) / 2), F + 10, (z0 + z1) / 2);
      // side-door collider gap: replace the wall colliders with segments around the door
      if (sx === 1) {
        this.collide(x - WALL_T / 2, x + WALL_T / 2, z0, SIDE_DOOR.z - SIDE_DOOR.half);
        this.collide(x - WALL_T / 2, x + WALL_T / 2, SIDE_DOOR.z + SIDE_DOOR.half, z1);
      } else this.collide(x - WALL_T / 2, x + WALL_T / 2, z0, z1);
      // aisle lean-to roof
      const roof = new THREE.PlaneGeometry(6.8, z1 - z0 + 0.8);
      roof.rotateX(-Math.PI / 2);
      this.batch.add(roof, M.slateRoof, mat(sx * (AISLE_X - 2.6), F + aisleH + 1.6, (z0 + z1) / 2, 0, 1, 1, 1, 0, -sx * 0.42));
      // clerestory wall above the arcade with small lancets
      const cx = sx * (C.colX + 0.5);
      this.box(1.0, clereTop - (F + aisleH), z1 - z0, L, cx, (clereTop + F + aisleH) / 2, (z0 + z1) / 2);
      for (let b = 0; b < (z1 - z0) / C.colStep; b++) {
        const zc = z1 - C.colStep * (b + 0.5);
        this.lancet(cx + sx * 0.52, F + aisleH + 5.3, zc, 1.6, 4.4, Math.PI / 2, 300 + b * 2 + (sx > 0 ? 1 : 0));
        this.lancet(cx - sx * 0.52, F + aisleH + 5.3, zc, 1.6, 4.4, Math.PI / 2, 300 + b * 2 + (sx > 0 ? 1 : 0));
      }
    }

    // ---- nave gable roof (slate) ----
    const ridge = 29;
    const half = C.colX + 1.2;
    const slope = Math.atan2(ridge - clereTop, half);
    const len = Math.hypot(half, ridge - clereTop);
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(len, z1 - z0 + 1).rotateX(-Math.PI / 2);
      this.batch.add(g, M.slateRoof, mat((sx * half) / 2, (ridge + clereTop) / 2, (z0 + z1) / 2 - 0.5, 0, 1, 1, 1, 0, -sx * slope));
    }
    this.box(0.4, 0.5, z1 - z0 + 1, M.iron, 0, ridge + 0.1, (z0 + z1) / 2 - 0.5);

    // ---- west front: gable wall with the portal and the rose window ----
    const fz = z1 + 0.6;
    const fw = C.colX + 0.5;
    for (const sx of [-1, 1]) this.box(fw - DOOR_HALF, clereTop, WALL_T + 0.4, L, (sx * (fw + DOOR_HALF)) / 2, clereTop / 2, fz);
    const doorTop = archApex(DOOR_HALF * 2, F + 4.6, 0.75);
    for (const sx of [-1, 1]) this.occ(fw - DOOR_HALF, clereTop, WALL_T + 0.4, (sx * (fw + DOOR_HALF)) / 2, clereTop / 2, fz);
    this.occ(DOOR_HALF * 2, clereTop - F - 4.6, WALL_T + 0.4, 0, (clereTop + F + 4.6) / 2, fz);
    // vault: the camera stays under it inside the church
    this.occ(C.colX * 2 + 2, 0.5, -z0 + 2, 0, vaultCam, z0 / 2);
    this.occ(TRANSEPT_X * 2 + 2, 0.5, C.transept.d + 2, 0, vaultCam, C.transept.z);
    this.occ(CHOIR_X * 2 + 2, 0.5, CROSS_Z0 - APSE_Z + APSE_R + 2, 0, vaultCam, (CROSS_Z0 + APSE_Z - APSE_R) / 2);
    this.box(DOOR_HALF * 2, clereTop - doorTop, WALL_T + 0.4, L, 0, (clereTop + doorTop) / 2, fz);
    // tympanum: the pointed head of the doorway is filled with carved stone; the door is the rectangle below
    const tymp = new THREE.ExtrudeGeometry(new THREE.Shape(pointedArch(DOOR_HALF * 2, F + 4.6, 0.75).slice(1, -1)), { depth: WALL_T + 0.2, bevelEnabled: false });
    this.batch.add(tymp.translate(0, 0, -(WALL_T + 0.2) / 2), M.stone, mat(0, 0, fz));
    const gable = new THREE.Shape([V2(-half, 0), V2(half, 0), V2(0, ridge - clereTop + 0.6)]);
    this.batch.add(new THREE.ExtrudeGeometry(gable, { depth: WALL_T, bevelEnabled: false }).translate(0, 0, -WALL_T / 2), L, mat(0, clereTop, fz));
    // aisle fronts between towers and nave are covered by the towers
    this.collide(-C.colX - 0.5, -DOOR_HALF, fz - 0.8, fz + 0.8);
    this.collide(DOOR_HALF, C.colX + 0.5, fz - 0.8, fz + 0.8);
    // portal: three receding archivolts + tympanum
    for (let k = 0; k < (hi ? 4 : 2); k++)
      this.batch.add(archBand(DOOR_HALF * 2 + 0.5 + k * 0.7, F + 4.6, 0.22, 0.5), k % 2 ? M.stone : L, mat(0, 0, fz + 0.6 + k * 0.35));
    for (const sx of [-1, 1]) {
      for (let k = 0; k < (hi ? 4 : 2); k++) this.batch.add(new THREE.CylinderGeometry(0.16, 0.16, F + 4.6, 10), M.stone, mat(sx * (DOOR_HALF + 0.35 + k * 0.35), (F + 4.6) / 2, fz + 0.6 + k * 0.35));
      // door leaves, opened inward against the walls
      this.box(0.12, 4.6, DOOR_HALF, M.pew, sx * (DOOR_HALF - 0.1), F + 2.3, fz - 0.6 - DOOR_HALF / 2);
    }
    // rose window, both faces
    const roseTex = ct.rose();
    const roseMat = new THREE.MeshStandardMaterial({ map: roseTex, emissive: '#ffffff', emissiveMap: roseTex, emissiveIntensity: 0.55, roughness: 0.3, side: THREE.DoubleSide });
    this.glass.push(roseMat);
    const roseZ = WALL_T / 2 + 0.22; // facade boxes are WALL_T + 0.4 deep: sit just outside both faces
    for (const dz of [roseZ, -roseZ]) {
      const rose = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), roseMat);
      rose.position.set(0, 15.2, fz + dz);
      if (dz < 0) rose.rotation.y = Math.PI;
      rose.castShadow = false;
      this.scene.add(rose);
    }
    for (const dz of [roseZ + 0.03, -(roseZ + 0.03)]) this.batch.add(new THREE.TorusGeometry(4.7, 0.3, 8, 48), M.stone, mat(0, 15.2, fz + dz));
    // gallery of small arches under the gable (ultra/high)
    if (hi)
      for (let i = -4; i <= 4; i++) {
        this.batch.add(archBand(1.1, 0, 0.12, 0.3), M.stone, mat(i * 1.6, 20.4, fz + 0.75, 0, 1, 1.2, 1));
        this.batch.add(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8), M.stone, mat(i * 1.6 + 0.8, 20.9, fz + 0.75));
      }

    // ---- transept: end walls with tall windows, roofs ----
    for (const sx of [-1, 1]) {
      const x = sx * (TRANSEPT_X + WALL_T / 2);
      this.wallZ(x, CROSS_Z0, NAVE_Z0, clereTop - F, L, sx === 1 ? [[-44, 1.4]] : [], WALL_T, F, 3.2);
      this.lancet(x - sx * 0.62, F + 11, C.transept.z - 2.6, 2.2, 9, Math.PI / 2, 500 + sx);
      this.lancet(x - sx * 0.62, F + 11, C.transept.z + 2.6, 2.2, 9, Math.PI / 2, 502 + sx);
      this.lancet(x + sx * 0.62, F + 11, C.transept.z - 2.6, 2.2, 9, Math.PI / 2, 500 + sx);
      this.lancet(x + sx * 0.62, F + 11, C.transept.z + 2.6, 2.2, 9, Math.PI / 2, 502 + sx);
      // south and north walls of each arm (between aisle wall / choir and the end wall)
      this.wallX(NAVE_Z0 + WALL_T / 2, sx * (AISLE_X + WALL_T), sx * TRANSEPT_X, aisleH + 6, L, [], WALL_T, F);
      this.wallX(CROSS_Z0 - WALL_T / 2, sx * CHOIR_X, sx * (TRANSEPT_X + WALL_T), aisleH + 6, L, [], WALL_T, F);
      // gable roof running east-west over the arm
      const tl = TRANSEPT_X - C.colX + 2;
      for (const sz of [-1, 1]) {
        const g = new THREE.PlaneGeometry(tl, Math.hypot(C.transept.d / 2 + 1, ridge - 2 - clereTop)).rotateX(-Math.PI / 2);
        this.batch.add(g, M.slateRoof, mat(sx * (C.colX + tl / 2 - 1), (ridge - 2 + clereTop) / 2, C.transept.z + (sz * (C.transept.d / 2 + 1)) / 2, 0, 1, 1, 1, sz * Math.atan2(ridge - 2 - clereTop, C.transept.d / 2 + 1), 0));
      }
      this.box(WALL_T, clereTop - F - (aisleH + 6), C.transept.d, L, x, aisleH + 6 + F + (clereTop - F - aisleH - 6) / 2, C.transept.z);
      const tg = new THREE.Shape([V2(-(C.transept.d / 2 + 1), 0), V2(C.transept.d / 2 + 1, 0), V2(0, ridge - 2 - clereTop)]);
      this.batch.add(new THREE.ExtrudeGeometry(tg, { depth: WALL_T, bevelEnabled: false }).translate(0, 0, -WALL_T / 2), L, mat(x, clereTop, C.transept.z, Math.PI / 2));
    }
    // crossing flèche (slender spire over the crossing)
    if (!this.opt.low) {
      this.box(3, 4, 3, M.slateRoof, 0, ridge + 1.6, C.transept.z);
      this.batch.add(spire(1.8, 14), M.slateRoof, mat(0, ridge + 10.6, C.transept.z));
      this.batch.add(new THREE.SphereGeometry(0.3, 10, 8), M.gold, mat(0, ridge + 17.8, C.transept.z));
    }

    // ---- choir + apse ----
    for (const sx of [-1, 1]) this.wallZ(sx * (CHOIR_X + WALL_T / 2), APSE_Z, CROSS_Z0, clereTop - F, L, [], WALL_T, F);
    const apseSeg = hi ? 18 : 10;
    for (let i = 0; i < apseSeg; i++) {
      const a0 = Math.PI + (i / apseSeg) * Math.PI;
      const a1 = Math.PI + ((i + 1) / apseSeg) * Math.PI;
      const am = (a0 + a1) / 2;
      const segLen = 2 * (APSE_R + WALL_T / 2) * Math.sin((a1 - a0) / 2) + 0.05;
      const x = Math.cos(am) * (APSE_R + WALL_T / 2);
      const z = APSE_Z + Math.sin(am) * (APSE_R + WALL_T / 2);
      const ry = -am;
      const window = i % 2 === 1;
      if (window) {
        this.box(WALL_T, 4, segLen, L, x, F + 2, z, ry);
        this.box(WALL_T, clereTop - F - 14, segLen, L, x, F + 14 + (clereTop - F - 14) / 2, z, ry);
        const inset = 0.65;
        this.lancet(Math.cos(am) * (APSE_R + WALL_T / 2 - inset), F + 9, APSE_Z + Math.sin(am) * (APSE_R + WALL_T / 2 - inset), segLen * 0.8, 10, ry + Math.PI / 2, 700 + i);
        this.lancet(Math.cos(am) * (APSE_R + WALL_T / 2 + inset), F + 9, APSE_Z + Math.sin(am) * (APSE_R + WALL_T / 2 + inset), segLen * 0.8, 10, ry + Math.PI / 2, 700 + i);
      } else this.box(WALL_T, clereTop - F, segLen, L, x, (clereTop + F) / 2, z, ry);
      this.circles.push({ x: Math.cos(am) * (APSE_R + WALL_T / 2), z: APSE_Z + Math.sin(am) * (APSE_R + WALL_T / 2), r: segLen * 0.6 });
      if (i % 2 === 0) {
        const bx = Math.cos(am) * (APSE_R + WALL_T + 0.9);
        const bz = APSE_Z + Math.sin(am) * (APSE_R + WALL_T + 0.9);
        this.box(1.4, aisleH + 4, 2.0, L, bx, (aisleH + 4) / 2, bz, ry + Math.PI / 2);
        this.circles.push({ x: bx, z: bz, r: 1.0 });
        this.batch.add(new THREE.ConeGeometry(0.55, 2.4, 4), L, mat(bx, aisleH + 5.2, bz, ry + Math.PI / 4));
      }
    }
    // apse roof: half cone
    const apseRoof = new THREE.ConeGeometry(APSE_R + 1.4, ridge - clereTop, apseSeg * 2, 1, true, Math.PI / 2, Math.PI);
    this.batch.add(apseRoof, M.slateRoof, mat(0, (ridge + clereTop) / 2, APSE_Z));
    this.box(CHOIR_X * 2 + 2.4, 0.01, 0.01, M.slateRoof, 0, clereTop, APSE_Z); // keeps a merge group even on low
    // choir roof continues the nave roof
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(len, CROSS_Z0 - APSE_Z + C.transept.d + 1).rotateX(-Math.PI / 2);
      this.batch.add(g, M.slateRoof, mat((sx * half) / 2, (ridge + clereTop) / 2, (APSE_Z + NAVE_Z0) / 2, 0, 1, 1, 1, 0, -sx * slope));
    }
    if (ultra) {
      // gargoyle-free waterspouts and a cornice of corbels along the clerestory
      for (const sx of [-1, 1])
        for (let z = z0; z < z1; z += 1.25) this.box(0.35, 0.3, 0.3, M.stone, sx * (C.colX + 1.05), clereTop - 0.2, z);
    }
  }

  // =================================================================== the west towers + bell
  private buildTowers(hi: boolean, ultra: boolean) {
    const M = this.m;
    const L = M.limestone;
    const T = C.towers;
    for (const sx of [-1, 1]) {
      const x = sx * T.x;
      const z = T.z;
      const s = T.size;
      const bell = sx === 1;
      // shaft in three stages, slightly stepping in
      const stages: [number, number, number][] = [
        [0, 16, s],
        [16, 30, s - 0.6],
        [30, T.h, s - 1.2],
      ];
      for (const [y0, y1, w] of stages) {
        if (y0 === 30) {
          // belfry: solid sill and crown, four corner piers and pointed openings you can see the bell through
          this.box(w, BELFRY.sill - y0, w, L, x, (y0 + BELFRY.sill) / 2, z);
          this.box(w, y1 - BELFRY.top, w, L, x, (BELFRY.top + y1) / 2, z);
          const pw = (w - BELFRY.open) / 2;
          const po = w / 2 - pw / 2;
          for (const cx of [-1, 1]) for (const cz of [-1, 1]) this.box(pw, BELFRY.top - BELFRY.sill, pw, L, x + cx * po, (BELFRY.sill + BELFRY.top) / 2, z + cz * po);
          const head = new THREE.Shape([...pointedArch(BELFRY.open, 0).slice(1, -1), V2(BELFRY.open / 2, BELFRY.top - BELFRY.spring), V2(-BELFRY.open / 2, BELFRY.top - BELFRY.spring)]);
          const headG = new THREE.ExtrudeGeometry(head, { depth: pw, bevelEnabled: false }).translate(0, 0, -pw / 2);
          for (let f = 0; f < 4; f++) {
            const a = (f / 4) * Math.PI * 2;
            this.batch.add(headG, L, mat(x + Math.sin(a) * po, BELFRY.spring, z + Math.cos(a) * po, a));
          }
        } else if (y0 === 0 && bell) {
          // ground stage of the bell tower: open arch on the south face for the bell rope
          for (const ox of [-1, 1]) this.box((w - 3) / 2, y1 - y0, w, L, x + ox * (w / 2 - (w - 3) / 4), (y0 + y1) / 2, z);
          this.box(3, y1 - y0 - 5, w, L, x, 5 + (y1 - y0 - 5) / 2, z);
          this.box(3, 5, w - 2.2, L, x, 2.5, z - 1.1);
          this.collide(x - w / 2, x - 1.5, z - w / 2, z + w / 2);
          this.collide(x + 1.5, x + w / 2, z - w / 2, z + w / 2);
          this.collide(x - 1.5, x + 1.5, z - w / 2, z + w / 2 - 2.2);
          this.batch.add(archBand(3, 3.4, 0.3, 0.6), M.stone, mat(x, 0, z + w / 2 + 0.05));
        } else {
          this.box(w, y1 - y0, w, L, x, (y0 + y1) / 2, z);
          if (y0 === 0) this.collide(x - w / 2, x + w / 2, z - w / 2, z + w / 2);
        }
        if (y0 === 0) this.occ(w, y1, bell ? w - 2.2 : w, x, y1 / 2, bell ? z - 1.1 : z);
        // string course
        this.box(w + 0.5, 0.4, w + 0.5, M.stone, x, y1, z);
      }
      // corner buttresses with pinnacles
      for (const cx of [-1, 1])
        for (const cz of [-1, 1]) {
          const bx = x + cx * (s / 2 + 0.2);
          const bz = z + cz * (s / 2 + 0.2);
          this.box(1.3, 32, 1.3, L, bx, 16, bz);
          this.collide(bx - 0.65, bx + 0.65, bz - 0.65, bz + 0.65);
          this.batch.add(new THREE.ConeGeometry(0.6, 3.2, 4), L, mat(bx, T.h + 1.8, bz, Math.PI / 4));
        }
      // windows: tall lancets on each face of the middle stage, louvred belfry openings
      for (let f = 0; f < 4; f++) {
        const a = (f / 4) * Math.PI * 2;
        const nx = Math.sin(a);
        const nz = Math.cos(a);
        const d = (s - 0.6) / 2 + 0.02;
        this.lancet(x + nx * d, 23, z + nz * d, 1.8, 7, a, 900 + f + (bell ? 10 : 0));
        // belfry louvres: thin and widely spaced; on the bell tower only on the north and west faces,
        // so the swinging bell stays visible from the plaza (south) and the cloister (east)
        if (bell && (f === 0 || f === 1)) continue;
        const bd = (s - 1.2) / 2 - 0.4;
        const nl = hi ? 5 : 3;
        for (let k = 0; k < nl; k++) this.box(BELFRY.open, 0.08, 0.35, M.woodDark, x + nx * bd, BELFRY.sill + 0.6 + (k * (BELFRY.spring - BELFRY.sill - 1)) / (nl - 1), z + nz * bd, a);
      }
      // spire with lucarnes and a gilded finial with a small cross
      this.batch.add(spire((s - 1.2) * 0.62, T.spire), M.slateRoof, mat(x, T.h + T.spire / 2, z, Math.PI / 8));
      if (hi)
        for (let f = 0; f < 4; f++) {
          const a = (f / 4) * Math.PI * 2;
          this.batch.add(new THREE.ConeGeometry(0.7, 2.4, 4), M.slateRoof, mat(x + Math.sin(a) * 2.6, T.h + 3, z + Math.cos(a) * 2.6, a + Math.PI / 4));
        }
      this.batch.add(new THREE.SphereGeometry(0.35, 12, 8), M.gold, mat(x, T.h + T.spire + 0.2, z));
      this.box(0.14, 1.6, 0.14, M.gold, x, T.h + T.spire + 1.1, z);
      this.box(0.9, 0.14, 0.14, M.gold, x, T.h + T.spire + 1.4, z);
      if (bell) {
        // the bell, hung from a yoke in the belfry (swings when rung)
        const pivot = new THREE.Group();
        pivot.position.set(x, 38.6, z);
        const profile: THREE.Vector2[] = [];
        for (let i = 0; i <= 14; i++) {
          const t = i / 14;
          profile.push(V2(0.35 + Math.pow(t, 2.2) * 1.05 + (t > 0.9 ? (t - 0.9) * 2.5 : 0), -t * 2.1));
        }
        const bm = new THREE.Mesh(new THREE.LatheGeometry(profile, hi ? 40 : 20), M.bronze);
        bm.castShadow = true;
        pivot.add(bm);
        // headstock along the swing axis (z), resting on two frame beams let into the corner piers
        const frameZ = (s - 1.2) / 2 - (s - 1.2 - BELFRY.open) / 4;
        const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, frameZ * 2 + 0.5), M.woodDark);
        yoke.position.y = 0.2;
        pivot.add(yoke);
        for (const sz of [-1, 1]) this.box(s - 1.2, 0.4, 0.5, M.woodDark, x, 38.6 - 0.2, z + sz * frameZ);
        this.scene.add(pivot);
        this.bell = pivot;
        // the rope comes down the open ground stage
        const ropeLen = BELFRY.sill - 0.2 - 2;
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, ropeLen, 6), new THREE.MeshStandardMaterial({ color: '#b89a6a', roughness: 1 }));
        rope.position.set(C.bellRope.x, 2 + ropeLen / 2, C.bellRope.z);
        this.scene.add(rope);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 10), M.red);
        grip.position.set(C.bellRope.x, 1.7, C.bellRope.z);
        this.scene.add(grip);
        const hit = this.hitBox(1.6, 3, 1.6, C.bellRope.x, 1.5, C.bellRope.z);
        hit.userData.kind = 'bell';
        this.scene.add(hit);
        this.clickables.push(hit);
      }
    }
    void ultra;
  }

  // =================================================================== interior
  private buildInterior(hi: boolean, ultra: boolean) {
    const M = this.m;
    const L = M.limestone;
    const z0 = NAVE_Z0;
    const springAisle = F + 7.2;
    const vaultSpring = F + 19;
    // ---- piers + arcade arches ----
    const pier = (x: number, z: number, h: number, r: number) => {
      this.batch.add(new THREE.CylinderGeometry(r, r, h, hi ? 16 : 10), L, mat(x, F + h / 2, z));
      if (hi) for (let k = 0; k < 4; k++) this.batch.add(new THREE.CylinderGeometry(r * 0.32, r * 0.32, h, 8), L, mat(x + Math.cos((k * Math.PI) / 2) * r, F + h / 2, z + Math.sin((k * Math.PI) / 2) * r));
      this.batch.add(new THREE.CylinderGeometry(r * 1.35, r * 1.5, 0.6, hi ? 16 : 8), M.stone, mat(x, F + 0.3, z));
      this.batch.add(new THREE.CylinderGeometry(r * 1.45, r * 1.1, 0.5, hi ? 16 : 8), M.stone, mat(x, F + h - 0.25, z));
      this.circles.push({ x, z, r: r * 1.4 });
    };
    for (const sx of [-1, 1]) {
      for (let z = -C.colStep; z > z0 + 0.1; z -= C.colStep) pier(sx * C.colX, z, springAisle - F, 0.6);
      pier(sx * C.colX, z0, vaultSpring - F, 0.85);
      pier(sx * C.colX, CROSS_Z0, vaultSpring - F, 0.85);
      // arcade: pointed arches between piers, and the wall above them up to the clerestory
      for (let z = 0; z > z0 + 0.1; z -= C.colStep) {
        const zc = z - C.colStep / 2;
        this.batch.add(archBand(C.colStep - 1.2, springAisle, 0.4, 1.0, 0.7), L, mat(sx * C.colX, 0, zc, Math.PI / 2));
        const apex = archApex(C.colStep - 1.2, springAisle, 0.7);
        this.box(1.0, F + 10 - apex + 0.4, C.colStep, L, sx * (C.colX + 0.5), (apex - 0.4 + F + 10) / 2, zc);
      }
      // aisle ceiling (flat, timbered)
      this.box(AISLE_X - C.colX, 0.3, -z0, M.woodDark, sx * (C.colX + (AISLE_X - C.colX) / 2), F + 10, z0 / 2, 0, false);
      for (let z = 0; z > z0; z -= 1.25) this.box(AISLE_X - C.colX, 0.25, 0.18, M.woodDark, sx * (C.colX + (AISLE_X - C.colX) / 2), F + 9.8, z, 0, false);
    }
    // ---- vaults: pointed barrel shells with transverse (and on ultra diagonal) ribs ----
    const vaultW = C.colX * 2 + 1;
    const shell = (w: number, d: number) => archBand(w, 0, 0.35, d, 0.68, hi ? 14 : 8);
    this.batch.add(shell(vaultW, -z0 + 0.6), M.plaster, mat(0, vaultSpring, z0 / 2, 0), false);
    this.batch.add(shell(vaultW, TRANSEPT_X * 2 + 1.2), M.plaster, mat(0, vaultSpring, C.transept.z, Math.PI / 2), false);
    this.batch.add(shell(CHOIR_X * 2 + 1, CROSS_Z0 - APSE_Z + 0.4), M.plaster, mat(0, vaultSpring, (CROSS_Z0 + APSE_Z) / 2), false);
    // apse semi-dome
    const dome = new THREE.SphereGeometry(APSE_R + 0.2, hi ? 24 : 12, hi ? 12 : 6, Math.PI, Math.PI, 0, Math.PI / 2);
    this.batch.add(dome.scale(1, 0.62, 1), M.plaster, mat(0, vaultSpring, APSE_Z), false);
    for (let z = 0; z >= z0 - 0.1; z -= C.colStep) this.batch.add(archBand(vaultW, 0, 0.3, 0.5, 0.68, hi ? 14 : 8), L, mat(0, vaultSpring, z), false);
    if (ultra || hi) {
      const diag = Math.hypot(vaultW, C.colStep);
      const ang = Math.atan2(C.colStep, vaultW);
      for (let z = -C.colStep / 2; z > z0; z -= C.colStep)
        for (const s of [-1, 1]) this.batch.add(archBand(vaultW, 0, 0.22, 0.3, 0.68, 12), L, mat(0, vaultSpring, z, s * ang, diag / vaultW, 1, 1), false);
      // carved boss at each crossing of the ribs
      for (let z = -C.colStep / 2; z > z0; z -= C.colStep) this.batch.add(new THREE.SphereGeometry(0.45, 12, 8), M.gold, mat(0, archApex(vaultW, vaultSpring, 0.68) - 0.3, z), false);
    }
    // ---- sanctuary: altar, rail, candlesticks, a plain cross on the apse wall ----
    const sy = F + SANCTUARY_RISE;
    this.box(3.4, 1.0, 1.4, M.stone, 0, sy + 0.5, APSE_Z - 2);
    this.box(3.6, 0.06, 1.6, M.white, 0, sy + 1.03, APSE_Z - 2);
    this.box(3.62, 0.5, 0.02, M.white, 0, sy + 0.8, APSE_Z - 1.19);
    this.collide(-1.8, 1.8, APSE_Z - 2.8, APSE_Z - 1.2);
    for (const sx of [-1, 1]) {
      this.batch.add(new THREE.CylinderGeometry(0.06, 0.12, 0.7, 12), M.gold, mat(sx * 1.3, sy + 1.4, APSE_Z - 2.2));
      this.batch.add(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 10), M.wax, mat(sx * 1.3, sy + 1.92, APSE_Z - 2.2));
      this.batch.add(new THREE.SphereGeometry(0.04, 8, 6), M.lamp, mat(sx * 1.3, sy + 2.13, APSE_Z - 2.2));
    }
    this.box(0.35, 5.2, 0.25, M.woodDark, 0, sy + 7.5, APSE_Z - APSE_R + 0.9);
    this.box(2.6, 0.35, 0.25, M.woodDark, 0, sy + 8.6, APSE_Z - APSE_R + 0.9);
    this.box(0.42, 5.3, 0.06, M.gold, 0, sy + 7.5, APSE_Z - APSE_R + 1.05);
    this.box(2.7, 0.42, 0.06, M.gold, 0, sy + 8.6, APSE_Z - APSE_R + 1.05);
    // communion-rail-like low balustrade across the sanctuary steps (gap in the middle)
    for (const sx of [-1, 1]) {
      this.box(CHOIR_X - 2.5, 0.12, 0.3, M.stone, sx * ((CHOIR_X - 2.5) / 2 + 1.5), sy + 0.95, CROSS_Z0 - 0.4);
      for (let x = 1.7; x < CHOIR_X - 1; x += 0.45) this.batch.add(new THREE.CylinderGeometry(0.07, 0.09, 0.85, 8), M.stone, mat(sx * x, sy + 0.45, CROSS_Z0 - 0.4));
      this.collide(sx * 1.5, sx * (CHOIR_X - 1), CROSS_Z0 - 0.6, CROSS_Z0 - 0.2);
    }
    // choir stalls along the choir walls
    for (const sx of [-1, 1]) {
      this.box(0.8, 0.5, 5, M.pew, sx * (CHOIR_X - 0.6), sy + 0.25, (CROSS_Z0 + APSE_Z) / 2);
      this.box(0.15, 1.6, 5, M.pew, sx * (CHOIR_X - 0.1), sy + 0.8, (CROSS_Z0 + APSE_Z) / 2);
      this.collide(sx * (CHOIR_X - 1.0), sx * CHOIR_X, APSE_Z + 0.5, CROSS_Z0 - 0.5);
    }
    // ---- pews (instanced) ----
    const pew = this.pewGeometry(hi);
    const rows = 19;
    const im = new THREE.InstancedMesh(pew, M.pew, rows * 2);
    let n = 0;
    for (let row = 0; row < rows; row++) {
      const z = -37.4 + row * 1.7;
      for (const sx of [-1, 1]) {
        this.dummy.position.set(sx * 5.75, F, z);
        this.dummy.updateMatrix();
        im.setMatrixAt(n++, this.dummy.matrix);
        this.collide(sx * 2.0, sx * 9.5, z + 0.1, z + 0.55);
      }
    }
    im.castShadow = im.receiveShadow = !!this.opt.shadows;
    this.scene.add(im);
    // ---- west organ gallery with pipes (instanced) ----
    const gz = -2.2;
    this.box(C.colX * 2 - 1, 0.5, 3.6, M.woodDark, 0, F + 7.2, gz - 0.2, 0, false);
    this.box(C.colX * 2 - 1, 1.1, 0.15, M.pew, 0, F + 8, gz - 2, 0, false);
    const pipeN = hi ? 41 : 21;
    const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, 1, hi ? 12 : 8), M.gold, pipeN);
    for (let i = 0; i < pipeN; i++) {
      const t = i / (pipeN - 1);
      const h = 2.4 + Math.sin(t * Math.PI) * 4.2 + (i % 2) * 0.4;
      this.dummy.position.set(-7 + t * 14, F + 7.5 + h / 2, gz + 0.6);
      this.dummy.scale.set(1, h, 1);
      this.dummy.updateMatrix();
      pipes.setMatrixAt(i, this.dummy.matrix);
    }
    this.dummy.scale.setScalar(1);
    this.scene.add(pipes);
    this.box(15, 0.5, 1.6, M.woodDark, 0, F + 7.7, gz + 0.6, 0, false);
    // ---- chandeliers: iron rings with candle lamps; real lights on high/ultra ----
    const chZ = [-6, -16, -26, -36];
    for (const z of chZ) {
      const y = F + 13;
      this.batch.add(new THREE.TorusGeometry(1.4, 0.06, 6, 28).rotateX(Math.PI / 2), M.iron, mat(0, y, z), false);
      this.batch.add(new THREE.CylinderGeometry(0.02, 0.02, vaultSpring + 6 - y, 4), M.iron, mat(0, (y + vaultSpring + 6) / 2, z), false);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        this.batch.add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), M.wax, mat(Math.cos(a) * 1.4, y + 0.14, z + Math.sin(a) * 1.4), false);
        this.batch.add(new THREE.SphereGeometry(0.05, 6, 4), M.lamp, mat(Math.cos(a) * 1.4, y + 0.3, z + Math.sin(a) * 1.4), false);
      }
      if (!this.opt.low && (hi || z === -16 || z === -36)) {
        const l = new THREE.PointLight('#ffc98a', 0, 26, 1.6);
        l.position.set(0, y - 0.3, z);
        this.scene.add(l);
        this.lights.push(l);
      }
    }
    // sanctuary light
    if (!this.opt.low) {
      const l = new THREE.PointLight('#ffd7a0', 0, 22, 1.6);
      l.position.set(0, F + 6, APSE_Z - 1);
      this.scene.add(l);
      this.lights.push(l);
    }
    // ultra: dusty light shafts under the clerestory windows
    if (ultra) {
      const shaftMat = new THREE.MeshBasicMaterial({ color: '#fff1d0', transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      for (let z = -2.5; z > z0; z -= C.colStep * 2) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 16), shaftMat);
        p.position.set(-4, F + 9, z);
        p.rotation.set(0, Math.PI / 2, -0.55);
        this.scene.add(p);
      }
    }
  }

  private pewGeometry(hi: boolean) {
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => parts.push(g.applyMatrix4(mat(x, y, z, 0, 1, 1, 1, rx)));
    const len = 7.5;
    add(new THREE.BoxGeometry(len, 0.07, 0.46), 0, PEW_TOP - 0.035, 0.02); // seat
    add(new THREE.BoxGeometry(len, 0.75, 0.06), 0, PEW_TOP + 0.38, 0.3, -0.14); // back, slightly reclined
    add(new THREE.BoxGeometry(len, 0.06, 0.18), 0, PEW_TOP + 0.76, 0.35); // book rest on the back (for the row behind)
    add(new THREE.BoxGeometry(len, 0.08, 0.16), 0, 0.14, -0.55); // kneeler
    for (const sx of [-1, 1]) {
      const end = new THREE.BoxGeometry(0.07, 1.05, 0.95);
      add(end, (sx * len) / 2, 0.52, 0.05);
      if (hi) add(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 14).rotateZ(Math.PI / 2), (sx * len) / 2, 1.07, 0.05); // carved finial
    }
    const merged = mergeAll(parts);
    return merged;
  }

  // =================================================================== side rooms you can enter
  private buildRooms(hi: boolean) {
    const M = this.m;
    // a room: floor, four walls with a door gap on `doorSide`, a pitched slate roof, a warm lamp
    const room = (x0: number, x1: number, z0: number, z1: number, door: { side: 'n' | 's' | 'e' | 'w'; at: number }) => {
      const h = 4.2;
      this.plane(x1 - x0, z1 - z0, M.floor, (x0 + x1) / 2, 0.03, (z0 + z1) / 2, 1.6);
      const gap = (s: string): [number, number][] => (door.side === s ? [[door.at, 0.9]] : []);
      this.wallX(z0, x0, x1, h, M.limestone, gap('n'), 0.5, 0, 2.6);
      this.wallX(z1, x0, x1, h, M.limestone, gap('s'), 0.5, 0, 2.6);
      this.wallZ(x0, z0, z1, h, M.limestone, gap('w'), 0.5, 0, 2.6);
      this.wallZ(x1, z0, z1, h, M.limestone, gap('e'), 0.5, 0, 2.6);
      const w = x1 - x0;
      const d = z1 - z0;
      for (const sz of [-1, 1]) {
        const g = new THREE.PlaneGeometry(w + 1, Math.hypot(d / 2 + 0.5, 2.2)).rotateX(-Math.PI / 2);
        this.batch.add(g, M.slateRoof, mat((x0 + x1) / 2, h + 1.1, (z0 + z1) / 2 + (sz * (d / 2 + 0.5)) / 2, 0, 1, 1, 1, sz * Math.atan2(2.2, d / 2 + 0.5), 0));
      }
      for (const sx of [x0, x1]) {
        const tg = new THREE.Shape([V2(-(d / 2 + 0.5), 0), V2(d / 2 + 0.5, 0), V2(0, 2.2)]);
        this.batch.add(new THREE.ExtrudeGeometry(tg, { depth: 0.5, bevelEnabled: false }).translate(0, 0, -0.25), M.limestone, mat(sx, h, (z0 + z1) / 2, Math.PI / 2));
      }
      this.box(w, 0.12, d, M.woodDark, (x0 + x1) / 2, h - 0.06, (z0 + z1) / 2, 0, false); // ceiling
      this.occ(w + 1, 0.3, d + 1, (x0 + x1) / 2, h - 0.2, (z0 + z1) / 2);
      this.batch.add(new THREE.SphereGeometry(0.22, 12, 8), M.lamp, mat((x0 + x1) / 2, h - 0.6, (z0 + z1) / 2), false);
      if (!this.opt.low) {
        const l = new THREE.PointLight('#ffcf94', 0, 12, 1.8);
        l.position.set((x0 + x1) / 2, h - 0.8, (z0 + z1) / 2);
        this.scene.add(l);
        this.lights.push(l);
      }
    };

    // ---- sacristy: off the east transept (door in the transept end wall at z -44) ----
    const sx0 = TRANSEPT_X + WALL_T;
    const sx1 = sx0 + 8;
    const sz0 = CROSS_Z0;
    const sz1 = NAVE_Z0 - 2;
    room(sx0, sx1, sz0, sz1, { side: 'w', at: -44 });
    // three steps down from the church floor (the doorway is at church-floor height); see churchHeight
    for (let k = 0; k < 3; k++) this.box(0.6, (F / 3) * (3 - k), 2.8, M.stone, sx0 + 0.3 + k * 0.6, ((F / 3) * (3 - k)) / 2, -44, 0, false);
    // vestment cabinet, wash basin, a table with folded cloths
    this.box(3.2, 2.4, 0.7, M.pew, sx0 + 4, 1.2, sz0 + 0.75);
    this.collide(sx0 + 2.4, sx0 + 5.6, sz0 + 0.3, sz0 + 1.2);
    this.addProp(this.hitBox(3.2, 2.4, 0.9, sx0 + 4, 1.2, sz0 + 0.8), { kind: 'prop', prop: 'shelf', spot: { x: sx0 + 4, z: sz0 + 2, r: Math.PI } });
    this.box(1.0, 0.9, 0.6, M.stone, sx1 - 1.2, 0.45, sz1 - 1.0);
    this.batch.add(new THREE.CylinderGeometry(0.32, 0.22, 0.18, 16), M.white, mat(sx1 - 1.2, 0.98, sz1 - 1.0));
    this.collide(sx1 - 1.7, sx1 - 0.7, sz1 - 1.3, sz1 - 0.7);
    this.addProp(this.hitBox(1.1, 1.2, 0.8, sx1 - 1.2, 0.6, sz1 - 1.0), { kind: 'prop', prop: 'sink', spot: { x: sx1 - 1.2, z: sz1 - 2.1, r: 0 } });
    this.box(1.8, 0.08, 0.9, M.pew, sx0 + 4.4, 0.82, sz1 - 1.4);
    for (let i = 0; i < 4; i++) this.box(0.5, 0.05, 0.4, i % 2 ? M.white : M.red, sx0 + 3.9 + (i % 2) * 0.6, 0.88 + Math.floor(i / 2) * 0.05, sz1 - 1.4);
    this.collide(sx0 + 3.5, sx0 + 5.3, sz1 - 1.85, sz1 - 0.95);

    // ---- cloister buildings: library on the north side, refectory on the south side ----
    const cl = C.cloister;
    const cx0 = cl.x - cl.w / 2;
    const cx1 = cl.x + cl.w / 2;
    const lz1 = cl.z - cl.d / 2; // -41
    const lz0 = lz1 - 9;
    room(cx0 + 3, cx1 - 3, lz0, lz1, { side: 's', at: cl.x });
    // library: shelves of books along the walls, reading desks with stools
    const bookMats = [M.book, M.book2, M.book3];
    const r = rng(77);
    for (const [x0, x1, z] of [
      [cx0 + 3.6, cl.x - 2, lz0 + 0.5],
      [cl.x + 2, cx1 - 3.6, lz0 + 0.5],
    ] as [number, number, number][]) {
      this.box(x1 - x0, 3.0, 0.5, M.woodDark, (x0 + x1) / 2, 1.5, z);
      this.collide(x0, x1, z - 0.3, z + 0.3);
      for (let shelf = 0; shelf < 5; shelf++)
        for (let x = x0 + 0.1; x < x1 - 0.1; x += 0.09) {
          const h = 0.32 + r() * 0.14;
          if (r() < 0.12) continue;
          this.box(0.075, h, 0.3, bookMats[Math.floor(r() * 3)], x, 0.18 + shelf * 0.58 + h / 2, z + 0.12, 0, false);
        }
      this.addProp(this.hitBox(x1 - x0, 3, 0.8, (x0 + x1) / 2, 1.5, z + 0.2), { kind: 'prop', prop: 'books', spot: { x: (x0 + x1) / 2, z: z + 1.4, r: Math.PI } });
    }
    for (const dx of [-5, 5]) {
      const x = cl.x + dx;
      const z = lz0 + 5;
      this.box(2.0, 0.08, 1.0, M.pew, x, 0.78, z);
      for (const ex of [-0.9, 0.9]) for (const ez of [-0.4, 0.4]) this.box(0.07, 0.76, 0.07, M.woodDark, x + ex, 0.38, z + ez);
      this.box(0.5, 0.04, 0.35, M.white, x - 0.3, 0.83, z, 0.2); // open book
      this.box(0.5, 0.45, 0.45, M.pew, x, 0.23, z + 0.95); // stool
      this.collide(x - 1.05, x + 1.05, z - 0.55, z + 0.55);
      this.addProp(this.hitBox(2.2, 1.2, 2.2, x, 0.6, z + 0.4), { kind: 'prop', prop: 'desk', spot: { x, z: z + 0.95, r: Math.PI }, sit: true, y: 0.45 });
    }
    // refectory (dining hall): long tables with benches, a water jug, a small kitchen corner
    const rz0 = cl.z + cl.d / 2; // -11
    const rz1 = rz0 + 9;
    room(cx0 + 3, cx1 - 3, rz0, rz1, { side: 'n', at: cl.x });
    for (const tz of [rz0 + 3, rz0 + 6.2]) {
      this.box(14, 0.08, 1.0, M.pew, cl.x, 0.78, tz);
      for (const ex of [-6.6, 0, 6.6]) this.box(0.1, 0.76, 0.8, M.woodDark, cl.x + ex, 0.38, tz);
      for (const bz of [-0.85, 0.85]) {
        this.box(14, 0.06, 0.32, M.pew, cl.x, 0.45, tz + bz);
        this.addProp(this.hitBox(14, 0.6, 0.5, cl.x, 0.3, tz + bz), { kind: 'prop', prop: 'bench', spot: { x: cl.x - 3 + (bz > 0 ? 2 : 0), z: tz + bz, r: bz > 0 ? Math.PI : 0 }, sit: true, y: 0.45 });
      }
      for (let i = 0; i < 10; i++) this.batch.add(new THREE.CylinderGeometry(0.12, 0.08, 0.05, 12), M.white, mat(cl.x - 6 + i * 1.33, 0.85, tz + (i % 2 ? 0.25 : -0.25)), false);
      this.collide(cl.x - 7, cl.x + 7, tz - 0.55, tz + 0.55);
    }
    this.batch.add(new THREE.CylinderGeometry(0.12, 0.16, 0.36, 14), new THREE.MeshStandardMaterial({ color: '#b66a3c', roughness: 0.7 }), mat(cl.x + 2, 1.0, rz0 + 3));
    this.addProp(this.hitBox(0.6, 1.2, 0.6, cl.x + 2, 0.9, rz0 + 3), { kind: 'prop', prop: 'water', spot: { x: cl.x + 2, z: rz0 + 1.6, r: 0 } });
    this.box(2.4, 0.9, 0.8, M.stone, cx1 - 5, 0.45, rz1 - 0.8);
    this.batch.add(new THREE.CylinderGeometry(0.35, 0.3, 0.3, 16), M.iron, mat(cx1 - 5.4, 1.05, rz1 - 0.8));
    this.collide(cx1 - 6.2, cx1 - 3.8, rz1 - 1.25, rz1 - 0.35);
    this.addProp(this.hitBox(2.4, 1.4, 1.0, cx1 - 5, 0.7, rz1 - 0.8), { kind: 'prop', prop: 'stove', spot: { x: cx1 - 5, z: rz1 - 2, r: 0 } });
    void hi;
  }

  // =================================================================== cloister garden + fountain
  private buildCloister(hi: boolean, ultra: boolean) {
    const M = this.m;
    const cl = C.cloister;
    const x0 = cl.x - cl.w / 2;
    const x1 = cl.x + cl.w / 2;
    const z0 = cl.z - cl.d / 2;
    const z1 = cl.z + cl.d / 2;
    const walk = 3;
    // walkway paving and lawn
    this.plane(cl.w, cl.d, M.paving, cl.x, 0.02, cl.z, 2);
    this.plane(cl.w - walk * 2, cl.d - walk * 2, M.grass, cl.x, 0.03, cl.z, 4);
    this.plane(2, cl.d - walk * 2, M.gravel, cl.x, 0.035, cl.z, 2);
    this.plane(cl.w - walk * 2, 2, M.gravel, cl.x, 0.036, cl.z, 2);
    // arcade: paired colonnettes + pointed arches on the garden side, lean-to roof over the walk
    const colStep = 2.5;
    const sides: { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3; gaps: number[] }[] = [
      { a: V3(x0 + walk, 0, z0 + walk), b: V3(x1 - walk, 0, z0 + walk), n: V3(0, 0, -1), gaps: [cl.x] },
      { a: V3(x0 + walk, 0, z1 - walk), b: V3(x1 - walk, 0, z1 - walk), n: V3(0, 0, 1), gaps: [cl.x] },
      { a: V3(x0 + walk, 0, z0 + walk), b: V3(x0 + walk, 0, z1 - walk), n: V3(-1, 0, 0), gaps: [cl.z] },
      { a: V3(x1 - walk, 0, z0 + walk), b: V3(x1 - walk, 0, z1 - walk), n: V3(1, 0, 0), gaps: [cl.z] },
    ];
    for (const s of sides) {
      const len = s.a.distanceTo(s.b);
      const dir = s.b.clone().sub(s.a).normalize();
      const ry = Math.atan2(dir.x, dir.z);
      const n = Math.round(len / colStep);
      for (let i = 0; i <= n; i++) {
        const p = s.a.clone().addScaledVector(dir, (i / n) * len);
        for (const k of hi ? [-0.12, 0.12] : [0]) {
          const q = p.clone().addScaledVector(s.n, k);
          this.batch.add(new THREE.CylinderGeometry(0.11, 0.11, 2.6, hi ? 10 : 6), M.limestone, mat(q.x, 0.4 + 1.3, q.z));
        }
        this.box(0.6, 0.4, 0.6, M.stone, p.x, 0.2, p.z);
        this.box(0.5, 0.25, 0.5, M.stone, p.x, 2.95, p.z);
        this.circles.push({ x: p.x, z: p.z, r: 0.32 });
        if (i < n) {
          const m = p.clone().addScaledVector(dir, len / n / 2);
          this.batch.add(archBand(len / n - 0.4, 2.9, 0.18, 0.5, 0.7, 6), M.limestone, mat(m.x, 0, m.z, ry + Math.PI / 2));
        }
      }
      // wall above the arches and the lean-to roof
      const mid = s.a.clone().add(s.b).multiplyScalar(0.5);
      this.box(dir.x ? len : 0.5, 1.2, dir.z ? len : 0.5, M.limestone, mid.x, 4.5, mid.z);
      const roofMid = mid.clone().addScaledVector(s.n, walk / 2);
      const g = new THREE.PlaneGeometry(dir.x ? len + walk * 2 : walk + 0.6, dir.z ? len + walk * 2 : walk + 0.6).rotateX(-Math.PI / 2);
      const tilt = 0.3;
      this.batch.add(g, M.slateRoof, mat(roofMid.x, 5.3, roofMid.z, 0, 1, 1, 1, -s.n.z * tilt, s.n.x * tilt));
    }
    // outer wall of the cloister (with openings to the church path and both rooms)
    const h = 5.2;
    this.wallZ(x0, z0, z1, h, M.limestone, [[SIDE_DOOR.z, 1.6]], 0.6, 0, 3.2);
    this.wallZ(x1, z0, z1, h, M.limestone, [], 0.6);
    this.wallX(z0, x0, x1, h, M.limestone, [[cl.x, 0.9]], 0.6, 0, 2.6);
    this.wallX(z1, x0, x1, h, M.limestone, [[cl.x, 0.9]], 0.6, 0, 2.6);
    // fountain: octagonal basin, central pillar with two bowls, water jets (ultra/high particles)
    const f = C.fountain;
    this.batch.add(new THREE.CylinderGeometry(f.r + 0.25, f.r + 0.35, 0.7, 8), M.stone, mat(f.x, 0.35, f.z, Math.PI / 8));
    this.batch.add(new THREE.CylinderGeometry(f.r - 0.05, f.r - 0.05, 0.1, 8), M.stoneDark, mat(f.x, 0.3, f.z, Math.PI / 8), false);
    this.batch.add(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 12), M.stone, mat(f.x, 1.2, f.z));
    this.batch.add(new THREE.CylinderGeometry(1.4, 0.3, 0.4, 20), M.stone, mat(f.x, 1.8, f.z));
    this.batch.add(new THREE.CylinderGeometry(0.2, 0.25, 0.9, 10), M.stone, mat(f.x, 2.4, f.z));
    this.batch.add(new THREE.CylinderGeometry(0.7, 0.15, 0.3, 16), M.stone, mat(f.x, 2.95, f.z));
    this.circles.push({ x: f.x, z: f.z, r: f.r + 0.4 });
    const wg = new THREE.CircleGeometry(f.r - 0.1, hi ? 48 : 16).rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, M.water);
    this.water.position.set(f.x, 0.6, f.z);
    this.scene.add(this.water);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(f.r + 0.4, f.r + 0.4, 1.4, 16), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(f.x, 0.7, f.z);
    hit.userData.kind = 'pond';
    this.scene.add(hit);
    this.clickables.push(hit);
    if (!this.opt.low) {
      const n = ultra ? 900 : hi ? 420 : 160;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      this.jets = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#e6f3f8', size: 0.07, transparent: true, opacity: 0.75, depthWrite: false }));
      this.jets.frustumCulled = false;
      this.jetAge = new Float32Array(n).map(() => Math.random());
      this.scene.add(this.jets);
    }
    // benches around the fountain (the seats themselves come from CHURCH_SEATS)
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * Math.PI * 2 + Math.PI / 6;
      const x = f.x + Math.cos(a) * 7.1;
      const z = f.z + Math.sin(a) * 7.1;
      const ry = Math.atan2(f.x - x, f.z - z); // local z points at the fountain, local x runs along the bench
      this.box(1.9, 0.1, 0.5, M.stone, x, PEW_TOP - 0.05, z, ry);
      for (const o of [-0.7, 0.7]) this.box(0.2, PEW_TOP - 0.1, 0.4, M.stone, x - Math.sin(a) * o, (PEW_TOP - 0.1) / 2, z + Math.cos(a) * o, ry);
      this.circles.push({ x: x + Math.cos(a) * 0.25, z: z + Math.sin(a) * 0.25, r: 0.4 });
    }
    // roses in the four lawn quarters, lemon trees in pots at the corners, clipped box balls
    for (const qx of [-1, 1])
      for (const qz of [-1, 1]) {
        const x = cl.x + qx * 6.5;
        const z = cl.z + qz * 6.5;
        this.flowers(x, z, 2.4, hi ? 120 : 50, [M.rose, M.rose2], 0.25);
        this.batch.add(new THREE.SphereGeometry(0.55, hi ? 14 : 8, hi ? 10 : 6), M.hedge, mat(cl.x + qx * 10.4, 0.5, cl.z + qz * 10.4));
        const px = cl.x + qx * 11.6;
        const pz = cl.z + qz * 3.6;
        this.batch.add(new THREE.CylinderGeometry(0.4, 0.3, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#a8603e', roughness: 0.8 }), mat(px, 0.3, pz));
        this.batch.add(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6), M.bark, mat(px, 1.0, pz));
        this.batch.add(new THREE.IcosahedronGeometry(0.7, hi ? 2 : 1), M.leaf2, mat(px, 1.8, pz));
        this.circles.push({ x: px, z: pz, r: 0.45 });
        if (hi) {
          const lemon = new THREE.MeshStandardMaterial({ color: '#f2d23c', roughness: 0.6 });
          for (let i = 0; i < 6; i++) this.batch.add(new THREE.SphereGeometry(0.07, 8, 6), lemon, mat(px + Math.cos(i) * 0.55, 1.6 + (i % 3) * 0.2, pz + Math.sin(i) * 0.55));
        }
      }
  }

  // =================================================================== seats (pews, benches)
  private buildSeats() {
    // invisible click targets, one per seat, and a gold ring that marks a taken place
    const hit = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1.2, 0.8), new THREE.MeshBasicMaterial({ visible: false }), CHURCH_SEATS.length);
    CHURCH_SEATS.forEach((p, i) => {
      this.dummy.position.set(p.x, this.groundHeight(p.x, p.z) + 0.6, p.z);
      this.dummy.rotation.set(0, p.r, 0);
      this.dummy.updateMatrix();
      hit.setMatrixAt(i, this.dummy.matrix);
    });
    this.dummy.rotation.set(0, 0, 0);
    hit.userData.seatIdx = CHURCH_SEATS.map((_, i) => i);
    this.scene.add(hit);
    this.clickables.push(hit);
    this.seatMarkers = new THREE.InstancedMesh(new THREE.TorusGeometry(0.36, 0.025, 6, 24), new THREE.MeshBasicMaterial({ color: '#c9d6f0' }), CHURCH_SEATS.length);
    CHURCH_SEATS.forEach((_, i) => this.setSeatTaken(i, false));
    this.scene.add(this.seatMarkers);
  }

  // =================================================================== candle stands
  private buildCandles() {
    const M = this.m;
    const total = INCENSE_SLOTS * CHURCH_CANDLES.length;
    CHURCH_CANDLES.forEach((c, ci) => {
      // wrought-iron stand: three stepped trays on legs, a sand tray for the candles
      for (let tier = 0; tier < 3; tier++) {
        const w = 2.4 * c.scale * 1.25;
        this.box(w, 0.04, 0.16, M.iron, c.x, c.y - 0.03 + tier * 0.12, c.z + 0.14 - tier * 0.14);
        this.box(w, 0.03, 0.14, M.bronze, c.x, c.y - 0.005 + tier * 0.12, c.z + 0.14 - tier * 0.14, 0, false);
      }
      for (const ex of [-1, 1]) for (const ez of [-1, 1]) this.box(0.05, c.y, 0.05, M.iron, c.x + ex * 1.4 * c.scale * 1.25, c.y / 2, c.z + ez * 0.25);
      this.collide(c.x - 1.6 * c.scale * 1.25, c.x + 1.6 * c.scale * 1.25, c.z - 0.4, c.z + 0.4);
      const hit = this.hitBox(3.4 * c.scale * 1.25, 1.6, 1.2, c.x, c.y / 2 + 0.3, c.z);
      hit.userData.kind = 'censer';
      hit.userData.censer = ci;
      this.scene.add(hit);
      this.clickables.push(hit);
      if (!this.opt.low) {
        const l = new THREE.PointLight('#ffb764', 0, 7, 2);
        l.position.set(c.x, c.y + 0.6, c.z);
        this.scene.add(l);
        this.candleLight.push(l);
      }
    });
    const waxG = new THREE.CylinderGeometry(0.022, 0.024, 1, 8).translate(0, 0.5, 0);
    this.wax = new THREE.InstancedMesh(waxG, M.wax, total);
    const flameG = new THREE.ConeGeometry(0.018, 0.07, 6).translate(0, 0.035, 0);
    this.flames = new THREE.InstancedMesh(flameG, new THREE.MeshBasicMaterial({ color: '#ffd27a', toneMapped: false }), total);
    this.wax.frustumCulled = this.flames.frustumCulled = false;
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    this.halos = new THREE.Points(haloGeo, new THREE.PointsMaterial({ map: ct.glow(), size: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffcf80' }));
    this.halos.frustumCulled = false;
    for (let i = 0; i < total; i++) this.updateCandle(i, Date.now());
    this.scene.add(this.wax, this.flames, this.halos);
  }

  private updateCandle(slot: number, now: number) {
    const lit = this.litAt.get(slot);
    const c = CHURCH_CANDLES[Math.floor(slot / INCENSE_SLOTS)];
    const [x, y, z] = candleBase(c, slot % INCENSE_SLOTS);
    const left = lit ? 1 - (now - lit) / INCENSE_BURN_MS : 0;
    const len = left > 0 ? 0.05 + 0.22 * left : 0;
    this.dummy.position.set(x, y, z);
    this.dummy.scale.set(1, Math.max(len, 0.0001), 1);
    this.dummy.updateMatrix();
    this.wax.setMatrixAt(slot, this.dummy.matrix);
    this.dummy.position.set(x, y + len, z);
    this.dummy.scale.setScalar(len ? 1 : 0.0001);
    this.dummy.updateMatrix();
    this.flames.setMatrixAt(slot, this.dummy.matrix);
    this.dummy.scale.setScalar(1);
    (this.halos.geometry.attributes.position as THREE.BufferAttribute).setXYZ(slot, x, len ? y + len + 0.04 : -50, z);
    this.wax.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
    this.halos.geometry.attributes.position.needsUpdate = true;
    if (left <= 0 && lit) this.litAt.delete(slot);
  }

  // =================================================================== API used by Game
  setStick(slot: number, litAt: number) {
    if (litAt) this.litAt.set(slot, litAt);
    else this.litAt.delete(slot);
    this.updateCandle(slot, Date.now());
  }

  setSeatTaken(i: number, taken: boolean) {
    const p = CHURCH_SEATS[i];
    if (!p) return;
    this.dummy.position.set(p.x, this.groundHeight(p.x, p.z) + PEW_TOP + 0.02, p.z);
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    this.dummy.scale.setScalar(taken ? 1 : 0.0001);
    this.dummy.updateMatrix();
    this.seatMarkers.setMatrixAt(i, this.dummy.matrix);
    this.seatMarkers.instanceMatrix.needsUpdate = true;
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(1);
  }

  ring(_kind: 'bell' | 'drum') {
    this.bellSwing = 1;
  }

  setHour(hour: number) {
    const th = ((hour - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(th), Math.sin(th) * 0.95, 0.38).normalize();
    const e = sunDir.y;
    const ss = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const day = ss(-0.04, 0.3, e);
    const golden = (1 - ss(0.04, 0.32, e)) * ss(-0.14, 0.02, e);
    const night = 1 - ss(-0.2, 0.02, e);
    this.night = night;
    const c = (a: string) => new THREE.Color(a);
    // a cooler, more silvery palette than the temple's
    const top = c('#0a1124').lerp(c('#6f9bc8'), day).lerp(c('#5a6aa0'), golden * 0.5);
    const bottom = c('#242b40').lerp(c('#e2e5e4'), day).lerp(c('#e7b48a'), golden * 0.7);
    this.skyMat.uniforms.top.value.copy(top);
    this.skyMat.uniforms.bottom.value.copy(bottom);
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.glow.value.copy(c('#fff0cc').multiplyScalar(day + golden));
    (this.scene.fog as THREE.FogExp2).color.copy(bottom.clone().lerp(top, 0.25));
    const moonDir = sunDir.clone().multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.25;
    moonDir.normalize();
    this.sun.userData.dir = e > -0.03 ? sunDir : moonDir;
    this.sun.color.copy(c('#a4b4ff').lerp(c('#ffc08a'), golden + day * 0.2).lerp(c('#fff5e6'), day * (1 - golden)));
    this.sun.intensity = 2.6 * day + 0.9 * golden + 0.35 * night;
    this.sun.castShadow = this.opt.shadows && (e > 0.05 || (night > 0.9 && moonDir.y > 0.3));
    this.hemi.color.copy(c('#6c7fb8').lerp(c('#f1f5ff'), day));
    this.hemi.groundColor.copy(c('#181d1a').lerp(c('#59634f'), day));
    this.hemi.intensity = 0.45 + 0.5 * day + (this.opt.low ? 0.35 + 0.3 * night : 0);
    this.fill.intensity = this.opt.low ? 0.5 + 0.35 * night : 0;
    this.sunDisc.position.copy(sunDir).multiplyScalar(420);
    this.sunDisc.visible = e > -0.05;
    this.moonDisc.position.copy(moonDir).multiplyScalar(420);
    this.moonDisc.visible = night > 0.3;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, night * 1.2 - 0.2);
    this.stars.visible = night > 0.15;
    // stained glass: lit by the sky by day, by the chandeliers at night
    for (const m of this.glass) m.emissiveIntensity = (this.opt.low ? 0.55 : 0.35) + 0.45 * day + 0.25 * night;
    for (const m of this.lampMats) m.emissiveIntensity = 0.3 + 2.4 * Math.max(night, golden * 0.5);
    for (const l of this.lights) l.intensity = 6 + 26 * Math.max(night, golden * 0.6);
  }

  followShadow(x: number, z: number) {
    this.fx = x;
    this.fz = z;
    const dir = (this.sun.userData.dir as THREE.Vector3 | undefined) ?? new THREE.Vector3(0.4, 1, 0.3);
    const sx = Math.round(x);
    const sz = Math.round(z);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + dir.x * 100, dir.y * 100, sz + dir.z * 100);
  }

  cull(_cam: THREE.Vector3, _dt: number) {}

  update(dt: number, now: number, t: number) {
    this.clock += dt;
    if (this.clock > 0.5) {
      this.clock = 0;
      for (const slot of [...this.litAt.keys()]) this.updateCandle(slot, now);
      // candle stands glow with how many candles burn on them
      CHURCH_CANDLES.forEach((_, ci) => {
        let n = 0;
        for (const s of this.litAt.keys()) if (Math.floor(s / INCENSE_SLOTS) === ci) n++;
        if (this.candleLight[ci]) this.candleLight[ci].intensity = Math.min(6, n * 0.35);
      });
    }
    // flicker: scale the halo size a little, every frame (cheap)
    (this.halos.material as THREE.PointsMaterial).size = 0.2 + Math.sin(t * 17) * 0.015 + Math.sin(t * 31) * 0.01;
    if (this.bellSwing > 0.001) {
      this.bellSwing *= Math.exp(-dt * 0.45);
      this.bell.rotation.z = Math.sin(t * 2.6) * 0.5 * this.bellSwing;
    }
    // fountain water: gentle ripple and falling jets
    if (this.water) this.water.position.y = 0.6 + Math.sin(t * 2) * 0.008;
    if (this.jets && this.jetAge) {
      const f = C.fountain;
      const pos = this.jets.geometry.attributes.position as THREE.BufferAttribute;
      const n = this.jetAge.length;
      for (let i = 0; i < n; i++) {
        let a = this.jetAge[i] + dt * 0.8;
        if (a > 1) a -= 1;
        this.jetAge[i] = a;
        const ang = (i / n) * Math.PI * 2 * 7;
        const top = i % 3 === 0;
        const r = (top ? 0.65 : 1.35) * (0.25 + a * 0.9);
        const y = (top ? 3.1 : 1.95) + (top ? 0.25 : 0.1) * Math.sin(a * Math.PI) - a * a * (top ? 1.2 : 1.4);
        pos.setXYZ(i, f.x + Math.cos(ang) * r, Math.max(0.62, y), f.z + Math.sin(ang) * r);
      }
      pos.needsUpdate = true;
    }
    // doves are stamped with the server clock (candle sticks above stay on the local clock)
    this.pond.update(serverNow());
    void this.fx;
    void this.fz;
  }

  groundHeight(x: number, z: number) {
    return churchHeight(x, z);
  }

  terrainHeight(x: number, z: number) {
    return churchHeight(x, z);
  }

  pickGround(ray: THREE.Ray): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    let prevAbove = true;
    for (let t = 0.5; t < 500; t += t < 60 ? 0.2 : 0.6) {
      ray.at(t, p);
      const h = churchHeight(p.x, p.z);
      const above = p.y > h;
      if (!above && prevAbove) return p.setY(h);
      prevAbove = above;
    }
    return null;
  }

  resolve(x: number, z: number, radius = 0.3): [number, number] {
    for (const c of this.circles) {
      const dx = x - c.x;
      const dz = z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.001;
        x = c.x + (dx / d) * min;
        z = c.z + (dz / d) * min;
      }
    }
    for (const b of this.boxes) {
      if (x > b.x0 - radius && x < b.x1 + radius && z > b.z0 - radius && z < b.z1 + radius) {
        const pushes = [b.x0 - radius - x, b.x1 + radius - x, b.z0 - radius - z, b.z1 + radius - z];
        const abs = pushes.map(Math.abs);
        const i = abs.indexOf(Math.min(...abs));
        if (i < 2) x += pushes[i];
        else z += pushes[i];
      }
    }
    x = Math.min(YARD.x1 - 1, Math.max(YARD.x0 + 1, x));
    z = Math.min(YARD.z1 + 30, Math.max(YARD.z0 + 1, z));
    const d = Math.hypot(x, z);
    if (d > C.radius) {
      x *= C.radius / d;
      z *= C.radius / d;
    }
    return [x, z];
  }

  /** inside the church building (for the HUD zone and the hall acoustics) */
  inside(x: number, z: number) {
    return inChurch(x, z);
  }

  dispose() {
    const tex = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      if (o.userData.kind === 'avatar') return;
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints) return;
      m.geometry?.dispose();
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
        if (!mt) continue;
        for (const v of Object.values(mt)) if (v instanceof THREE.Texture) tex.add(v);
        mt.dispose();
      }
    });
    for (const t of tex) t.dispose();
    this.scene.environment?.dispose();
    this.scene.clear();
  }
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
