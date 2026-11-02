import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALLS, INCENSE_BURN_MS, INCENSE_SLOTS, SEATS, WORLD, type HallDef } from '@sontu/shared';
import { Avatar } from './Avatar.ts';
import { textures } from './textures.ts';
import { PATHS, gardenRect, hallRect } from './layout.ts';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export type Circle = { x: number; z: number; r: number };
export type Box = { x0: number; x1: number; z0: number; z1: number };

export interface WorldOptions {
  low: boolean;
  shadows: boolean;
  shadowSize: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
function mat(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  return tmpM.clone().compose(V(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), tmpS.set(sx, sy, sz));
}

function scaleUV(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/**
 * Collects every static mesh and merges them per material at the end:
 * a whole temple complex renders in a few dozen draw calls instead of thousands.
 */
class Batch {
  private groups = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();

  add(geo: THREE.BufferGeometry, material: THREE.Material, m: THREE.Matrix4, cast = true) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g = g.applyMatrix4(m);
    const key = material.uuid + (cast ? 'c' : '');
    let group = this.groups.get(key);
    if (!group) this.groups.set(key, (group = { mat: material, cast, geos: [] }));
    group.geos.push(g);
  }

  /** Bake an ordinary Object3D hierarchy into the batch. */
  addObject(obj: THREE.Object3D, cast = true) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.add(m.geometry, m.material as THREE.Material, m.matrixWorld, cast && m.castShadow !== false);
    });
  }

  flush(scene: THREE.Scene, receive: boolean) {
    for (const { mat, cast, geos } of this.groups.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.groups.clear();
  }
}

/** Concave hip roof with upturned corners — the classic East-Asian silhouette. */
function hipRoof(w: number, d: number, h: number, lift: number, nx = 22, nz = 14) {
  const g = new THREE.PlaneGeometry(w, d, nx, nz);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const ridge = Math.max(0, (w - d) / 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = Math.min(1, Math.max(Math.max(0, Math.abs(x) - ridge) / (d / 2), Math.abs(z) / (d / 2)));
    const cx = Math.abs(x) / (w / 2);
    const cz = Math.abs(z) / (d / 2);
    pos.setY(i, h * (1 - t) ** 1.7 + lift * (cx * cz) ** 3);
  }
  g.computeVertexNormals();
  scaleUV(g, w / 4, d / 4);
  return g;
}

export class World {
  readonly scene = new THREE.Scene();
  /** interactive objects (raycast targets) — the ground is picked analytically */
  readonly clickables: THREE.Object3D[] = [];
  readonly cushions: THREE.InstancedMesh;
  readonly stones: THREE.InstancedMesh;
  readonly bell = new THREE.Group();
  readonly drum = new THREE.Group();
  readonly dj: Avatar;
  readonly circles: Circle[] = [];
  readonly boxes: Box[] = [];
  readonly sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private sunDisc: THREE.Mesh;
  private moonDisc: THREE.Mesh;
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private hallLights: THREE.PointLight[] = [];
  private sticks: THREE.InstancedMesh;
  private stickTips: THREE.InstancedMesh;
  private stickLitAt = new Map<number, number>();
  private smoke: THREE.Points;
  private smokeData: { slot: number; age: number; life: number; vx: number; vz: number }[] = [];
  private seatMarkers: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private batch = new Batch();
  private bellSwing = 0;
  private drumHit = 0;
  night = 0;
  private m: Record<string, THREE.MeshStandardMaterial>;

  constructor(private opt: WorldOptions) {
    const s = this.scene;
    s.fog = new THREE.FogExp2('#d9dccb', opt.low ? 0.011 : 0.0065);

    // ---------- materials ----------
    // weak GPUs get Lambert (per-vertex-ish, far cheaper) with the same colours / textures
    const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
      if (!opt.low) return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...p });
      const { roughness: _r, metalness: _m, ...rest } = p;
      return new THREE.MeshLambertMaterial(rest as THREE.MeshLambertMaterialParameters) as unknown as THREE.MeshStandardMaterial;
    };
    const grassTex = textures.grass();
    const pavingTex = textures.paving();
    this.m = {
      grass: std({ map: grassTex, roughness: 1 }),
      paving: std({ map: pavingTex, roughness: 0.9 }),
      stone: std({ color: '#a9a396', roughness: 0.92 }),
      stoneDark: std({ color: '#7a756a', roughness: 0.95 }),
      lacquer: std({ color: '#8c2a1c', roughness: 0.5 }),
      woodDark: std({ color: '#47291a', roughness: 0.7 }),
      floor: std({ map: textures.wood(), roughness: 0.6 }),
      plaster: std({ map: textures.plaster() }),
      lattice: std({ map: textures.lattice(), roughness: 0.8 }),
      roof: std({ map: textures.roof(), roughness: 0.75, side: THREE.DoubleSide }),
      trim: std({ color: '#2d5a52', roughness: 0.6 }),
      gold: std({ color: '#e0b04f', metalness: 0.55, roughness: 0.32, emissive: '#5a3a08', emissiveIntensity: 0.6 }),
      white: std({ color: '#f1ece2', roughness: 0.55 }),
      bronze: std({ color: '#7d6040', metalness: 0.6, roughness: 0.42 }),
      bark: std({ map: textures.bark(), roughness: 1 }),
      pine: std({ color: '#2e4a33', flatShading: true }),
      pine2: std({ color: '#3b5c3d', flatShading: true }),
      leaf: std({ color: '#4f7a3c', flatShading: true }),
      leaf2: std({ color: '#6b8f45', flatShading: true }),
      bamboo: std({ color: '#7f9d4f', roughness: 0.6 }),
      hedge: std({ color: '#3f6a37', flatShading: true }),
      soil: std({ color: '#5a4332' }),
      water: std({ color: '#3d6b74', roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.9 }),
      cushion: std({ color: '#93402c', roughness: 1 }),
      lantern: std({ color: '#c8402c', emissive: '#ff5a2e', emissiveIntensity: 0.2 }),
      lanternWarm: std({ color: '#f3dfb0', emissive: '#ffb45a', emissiveIntensity: 0.2 }),
      mountain: std({ color: '#4f6150', flatShading: true }),
      mountain2: std({ color: '#61735f', flatShading: true }),
      slate: std({ color: '#4c5266', roughness: 0.7 }),
      lotus: std({ color: '#f2a7c3', emissive: '#3a1622' }),
      pad: std({ color: '#4f7d3b' }),
    };
    this.glowMats.push(this.m.lantern, this.m.lanternWarm);

    // ---------- sky ----------
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#7fa7c9') },
        bottom: { value: new THREE.Color('#e9e2cc') },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        glow: { value: new THREE.Color('#ffe9b8') },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 glow; varying vec3 vDir;
        void main(){
          float h = smoothstep(-0.05, 0.6, vDir.y);
          vec3 c = mix(bottom, top, h);
          float s = max(dot(vDir, normalize(sunDir)), 0.0);
          c += glow * (pow(s, 48.0) * 0.6 + pow(s, 6.0) * 0.18);
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), this.skyMat));
    const starGeo = new THREE.BufferGeometry();
    const starCount = opt.low ? 400 : 1200;
    const pos = new Float32Array(starCount * 3);
    const r = rng(7);
    for (let i = 0; i < starCount; i++) {
      const th = r() * Math.PI * 2;
      const ph = Math.acos(0.1 + r() * 0.9);
      pos.set([Math.cos(th) * Math.sin(ph) * 460, Math.cos(ph) * 460, Math.sin(th) * Math.sin(ph) * 460], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false }));
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 10), new THREE.MeshBasicMaterial({ color: '#fff4d6', fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 10), new THREE.MeshBasicMaterial({ color: '#eef0ff', fog: false }));
    s.add(this.stars, this.sunDisc, this.moonDisc);

    // ---------- lights ----------
    this.hemi = new THREE.HemisphereLight('#fff6e0', '#5f6b48', 0.9);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    if (opt.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(opt.shadowSize, opt.shadowSize);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -30;
      c.right = c.top = 30;
      c.near = 1;
      c.far = 200;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.03;
    }
    s.add(this.sun, this.sun.target);

    // ---------- build ----------
    this.buildGround();
    for (const h of HALLS) this.buildHall(h);
    this.buildCourtyardPieces();
    this.buildTower(WORLD.bellTower.x, WORLD.bellTower.z, 'bell');
    this.buildTower(WORLD.drumTower.x, WORLD.drumTower.z, 'drum');
    this.buildGate();
    this.buildWall();
    this.buildStoneLanterns();
    this.buildGarden();
    this.buildPond();
    this.buildStupa();
    this.buildBodhi();
    this.dj = this.buildMoonYard();
    this.buildForest();
    this.buildMountains();
    this.batch.flush(s, opt.shadows);

    // ---------- seats ----------
    const hallSeats = SEATS.filter((x) => x.area !== 'bodhi');
    this.cushions = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.38, 0.42, 0.16, 20), this.m.cushion, hallSeats.length);
    hallSeats.forEach((p, i) => {
      this.dummy.position.set(p.x, this.groundHeight(p.x, p.z) + 0.08, p.z);
      this.dummy.updateMatrix();
      this.cushions.setMatrixAt(i, this.dummy.matrix);
    });
    this.cushions.userData.seatOffset = 0;
    this.cushions.receiveShadow = true;
    const bodhiSeats = SEATS.filter((x) => x.area === 'bodhi');
    this.stones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.6, 0.35, 10), this.m.stone, bodhiSeats.length);
    bodhiSeats.forEach((p, i) => {
      this.dummy.position.set(p.x, 0.17, p.z);
      this.dummy.updateMatrix();
      this.stones.setMatrixAt(i, this.dummy.matrix);
    });
    this.stones.userData.seatOffset = hallSeats.length;
    this.stones.castShadow = this.stones.receiveShadow = true;
    s.add(this.cushions, this.stones);
    this.clickables.push(this.cushions, this.stones);
    this.seatMarkers = new THREE.InstancedMesh(new THREE.TorusGeometry(0.46, 0.03, 6, 28), new THREE.MeshBasicMaterial({ color: '#e0b768' }), SEATS.length);
    SEATS.forEach((_, i) => this.setSeatTaken(i, false));
    s.add(this.seatMarkers);

    // ---------- incense ----------
    const stickGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
    stickGeo.translate(0, 0.5, 0);
    this.sticks = new THREE.InstancedMesh(stickGeo, this.m.woodDark, INCENSE_SLOTS);
    this.stickTips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff7a2a' }), INCENSE_SLOTS);
    for (let i = 0; i < INCENSE_SLOTS; i++) this.setStick(i, 0);
    s.add(this.sticks, this.stickTips);
    const smokeCount = opt.low ? 80 : 180;
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(smokeCount * 3), 3));
    this.smoke = new THREE.Points(
      smokeGeo,
      new THREE.PointsMaterial({ map: textures.softDot(), size: 0.4, transparent: true, opacity: 0.3, depthWrite: false, color: '#e8e4dc' }),
    );
    this.smoke.frustumCulled = false;
    for (let i = 0; i < smokeCount; i++) this.smokeData.push({ slot: -1, age: 0, life: 1, vx: 0, vz: 0 });
    s.add(this.smoke);
  }

  // =================================================================== builders
  private plane(w: number, d: number, material: THREE.Material, x: number, y: number, z: number, ry = 0, tile = 3) {
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    scaleUV(g, w / tile, d / tile);
    this.batch.add(g, material, mat(x, y, z, ry), false);
  }

  private box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, ry = 0, cast = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleUV(g, Math.max(w, d) / 2, h / 2);
    this.batch.add(g, material, mat(x, y, z, ry), cast);
  }

  private buildGround() {
    const g = new THREE.CircleGeometry(220, 64).rotateX(-Math.PI / 2);
    scaleUV(g, 70, 70);
    this.batch.add(g, this.m.grass, mat(0, 0, 0), false);
    const c = WORLD.courtyard;
    const cg = new THREE.CircleGeometry(c.r, 64).rotateX(-Math.PI / 2);
    scaleUV(cg, 9, 9);
    this.batch.add(cg, this.m.paving, mat(c.x, 0.02, c.z), false);
    for (const [x1, z1, x2, z2, w] of PATHS) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      this.plane(w, len, this.m.paving, (x1 + x2) / 2, 0.025, (z1 + z2) / 2, Math.atan2(x2 - x1, z2 - z1), 2.2);
    }
  }

  private buildHall(h: HallDef) {
    const main = h.id === 'main';
    const front = h.z + h.d / 2;
    const back = h.z - h.d / 2;
    const H = main ? 5 : 4.2;
    const top = h.h;
    // stone platform + steps
    this.box(h.w + 2, h.h, h.d + 2, this.m.stone, h.x, h.h / 2, h.z);
    this.plane(h.w + 2, h.d + 2, this.m.paving, h.x, h.h + 0.005, h.z, 0, 2.2);
    const stepW = main ? 8 : 5;
    for (let i = 0; i < 3; i++) this.box(stepW, (h.h * (3 - i)) / 3, 0.55, this.m.stone, h.x, (h.h * (3 - i)) / 6, front + 1 + 0.27 + i * 0.55);
    this.plane(h.w - 0.6, h.d - 0.6, this.m.floor, h.x, top + 0.02, h.z, 0, 2);

    // walls
    this.box(h.w, H, 0.3, this.m.plaster, h.x, top + H / 2, back + 0.15);
    this.box(h.w, 1, 0.34, this.m.woodDark, h.x, top + 0.5, back + 0.15);
    this.boxes.push({ x0: h.x - h.w / 2, x1: h.x + h.w / 2, z0: back - 1.2, z1: back + 0.5 });
    for (const sx of [-1, 1]) {
      const wx = h.x + sx * (h.w / 2 - 0.15);
      this.box(0.3, H, h.d, this.m.plaster, wx, top + H / 2, h.z);
      this.box(0.34, 1, h.d, this.m.woodDark, wx, top + 0.5, h.z);
      this.boxes.push({ x0: wx - 0.5, x1: wx + 0.5, z0: back - 1, z1: front + 0.2 });
    }
    // columns: front row + back corners
    const bays = main ? 7 : 5;
    const colGeo = new THREE.CylinderGeometry(0.28, 0.32, H, 14);
    const baseGeo = new THREE.CylinderGeometry(0.45, 0.5, 0.3, 10);
    const colX: number[] = [];
    for (let i = 0; i <= bays - 1; i++) colX.push(h.x - h.w / 2 + 0.4 + (i * (h.w - 0.8)) / (bays - 1));
    for (const x of colX) {
      this.batch.add(colGeo, this.m.lacquer, mat(x, top + H / 2, front - 0.3));
      this.batch.add(baseGeo, this.m.stone, mat(x, top + 0.15, front - 0.3));
      this.circles.push({ x, z: front - 0.3, r: 0.45 });
    }
    // lattice doors on the outer bays, centre bays open
    // centre bays stay open (4 in the main hall, 2 in the side halls), outer bays get lattice doors
    const nBays = bays - 1;
    const openCount = main ? 4 : 2;
    const openFrom = Math.floor((nBays - openCount) / 2);
    const openTo = openFrom + openCount - 1;
    for (let i = 0; i < bays - 1; i++) {
      if (i >= openFrom && i <= openTo) continue;
      const x0 = colX[i] + 0.3;
      const x1 = colX[i + 1] - 0.3;
      const g = new THREE.BoxGeometry(x1 - x0, H - 1.1, 0.1);
      scaleUV(g, (x1 - x0) / 1.4, (H - 1.1) / 1.4);
      this.batch.add(g, this.m.lattice, mat((x0 + x1) / 2, top + (H - 1.1) / 2 + 0.25, front - 0.3));
      this.boxes.push({ x0, x1, z0: front - 0.6, z1: front });
    }
    // beams with painted band (dancheong-like)
    this.box(h.w + 0.6, 0.45, 0.5, this.m.lacquer, h.x, top + H + 0.05, front - 0.3);
    this.box(h.w + 0.6, 0.3, 0.52, this.m.trim, h.x, top + H + 0.42, front - 0.3);
    this.box(h.w + 0.6, 0.45, 0.5, this.m.lacquer, h.x, top + H + 0.05, back + 0.15);
    // hanging lanterns under the eaves
    const lanternGeo = new THREE.SphereGeometry(0.28, 12, 8).scale(1, 1.25, 1);
    for (let i = 0; i < colX.length - 1; i++) this.batch.add(lanternGeo, this.m.lantern, mat((colX[i] + colX[i + 1]) / 2, top + H - 0.6, front + 0.6), false);

    // roof(s)
    const y0 = top + H + 0.55;
    if (main) {
      this.batch.add(hipRoof(h.w + 6, h.d + 6, 2.4, 1.0), this.m.roof, mat(h.x, y0, h.z));
      this.box(h.w * 0.62, 1.6, h.d * 0.52, this.m.plaster, h.x, y0 + 1.9, h.z);
      this.box(h.w * 0.62 + 0.2, 0.3, h.d * 0.52 + 0.2, this.m.trim, h.x, y0 + 2.6, h.z);
      this.batch.add(hipRoof(h.w * 0.78 + 2, h.d * 0.66 + 2, 3.2, 0.9), this.m.roof, mat(h.x, y0 + 2.6, h.z));
      this.ridge(h.x, y0 + 5.8, h.z, h.w * 0.78 + 2 - (h.d * 0.66 + 2));
    } else {
      this.batch.add(hipRoof(h.w + 5, h.d + 5, 3.4, 0.9), this.m.roof, mat(h.x, y0, h.z));
      this.ridge(h.x, y0 + 3.4, h.z, h.w - h.d);
    }
    // name board
    const label = { main: '大 雄 寶 殿', west: '觀 音 殿', east: '藥 師 殿' }[h.id];
    const board = new THREE.Mesh(new THREE.PlaneGeometry(main ? 4.2 : 3, main ? 1.1 : 0.9), new THREE.MeshBasicMaterial({ map: textures.sign(label), toneMapped: false }));
    board.position.set(h.x, top + H + 0.95, front - 0.02);
    this.scene.add(board);

    // altar & statues
    const altarD = main ? 4.2 : 3.2;
    this.box(h.w * 0.62, 1.1, altarD, this.m.lacquer, h.x, top + 0.55, back + 0.3 + altarD / 2);
    this.box(h.w * 0.62 + 0.2, 0.12, altarD + 0.2, this.m.gold, h.x, top + 1.12, back + 0.3 + altarD / 2, 0, false);
    this.boxes.push({ x0: h.x - h.w * 0.31 - 0.3, x1: h.x + h.w * 0.31 + 0.3, z0: back, z1: back + 0.6 + altarD });
    const sy = top + 1.18;
    const sz = back + 0.3 + altarD / 2 - 0.2;
    if (main) {
      for (const [dx, k] of [
        [0, 1.15],
        [-4.2, 0.9],
        [4.2, 0.9],
      ] as const)
        this.batch.addObject(this.buddha(this.m.gold, k, h.x + dx, sy, sz));
    } else if (h.id === 'west') {
      this.batch.addObject(this.standing(this.m.white, h.x, sy, sz, 1.15));
      this.batch.addObject(this.standing(this.m.gold, h.x - 2.6, sy, sz, 0.85));
      this.batch.addObject(this.standing(this.m.gold, h.x + 2.6, sy, sz, 0.85));
    } else {
      this.batch.addObject(this.buddha(this.m.gold, 0.95, h.x, sy, sz));
    }
    // candles + offerings
    for (const dx of [-1.8, 1.8]) {
      this.batch.add(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8), this.m.white, mat(h.x + dx, top + 1.36, back + 0.3 + altarD - 0.3));
      this.batch.add(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 1.8, 1), this.m.lanternWarm, mat(h.x + dx, top + 1.6, back + 0.3 + altarD - 0.3), false);
    }
    if (!this.opt.low) {
      const light = new THREE.PointLight('#ffbb66', 4, main ? 22 : 15, 1.6);
      light.position.set(h.x, top + 3.4, back + altarD + 2.5);
      this.scene.add(light);
      this.hallLights.push(light);
    }
  }

  private ridge(x: number, y: number, z: number, len: number) {
    const L = Math.max(1.5, len);
    this.box(L, 0.4, 0.45, this.m.trim, x, y, z);
    const curl = new THREE.TorusGeometry(0.35, 0.1, 6, 12, Math.PI * 1.3);
    for (const sx of [-1, 1]) this.batch.add(curl, this.m.trim, mat(x + (sx * L) / 2, y + 0.35, z, 0, sx, 1, 1));
  }

  private buddha(material: THREE.Material, k: number, x: number, y: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const add = (geo: THREE.BufferGeometry, px: number, py: number, pz: number, mm = material) => {
      const m = new THREE.Mesh(geo, mm);
      m.position.set(px * k, py * k, pz * k);
      g.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(1.25 * k, 1.05 * k, 0.45 * k, 20), 0, 0.22, 0);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const p = add(new THREE.SphereGeometry(0.3 * k, 8, 6), Math.cos(a) * 1.18, 0.42, Math.sin(a) * 1.18);
      p.scale.set(0.6, 1, 0.35);
      p.lookAt(x, y + 0.42 * k, z);
    }
    add(
      new THREE.LatheGeometry(
        [
          [0, 0],
          [1.05, 0],
          [1.12, 0.35],
          [0.78, 0.55],
          [0.64, 1.1],
          [0.6, 1.5],
          [0.3, 1.72],
          [0, 1.74],
        ].map(([a, b]) => new THREE.Vector2(a * k, b * k)),
        28,
      ),
      0,
      0.45,
      0,
    );
    add(new THREE.SphereGeometry(0.42 * k, 22, 16), 0, 2.52, 0).scale.y = 1.12;
    add(new THREE.SphereGeometry(0.2 * k, 12, 8), 0, 3.0, 0);
    const halo = add(new THREE.TorusGeometry(1.4 * k, 0.06 * k, 8, 48), 0, 2.45, -0.55);
    halo.castShadow = false;
    add(new THREE.CircleGeometry(1.3 * k, 40), 0, 2.45, -0.6, this.m.lanternWarm).castShadow = false;
    return g;
  }

  private standing(robe: THREE.Material, x: number, y: number, z: number, k: number) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(k);
    const add = (geo: THREE.BufferGeometry, py: number, m: THREE.Material = robe) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.y = py;
      g.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(0.6, 0.65, 0.3, 16), 0.15, this.m.gold);
    add(
      new THREE.LatheGeometry(
        [
          [0, 0],
          [0.48, 0],
          [0.4, 0.9],
          [0.36, 1.6],
          [0.42, 1.9],
          [0.2, 2.05],
          [0, 2.06],
        ].map(([a, b]) => new THREE.Vector2(a, b)),
        20,
      ),
      0.3,
    );
    add(new THREE.SphereGeometry(0.24, 16, 12), 2.6, this.m.gold);
    add(new THREE.ConeGeometry(0.2, 0.38, 10), 2.92, this.m.gold);
    const halo = add(new THREE.TorusGeometry(0.55, 0.035, 6, 36), 2.62);
    halo.position.z = -0.3;
    return g;
  }

  private buildCourtyardPieces() {
    // censer on a stone dais
    const { censer, donation } = WORLD;
    this.batch.add(new THREE.CylinderGeometry(1.4, 1.5, 0.35, 20), this.m.stone, mat(censer.x, 0.17, censer.z));
    this.batch.add(new THREE.CylinderGeometry(0.8, 0.58, 0.6, 24), this.m.bronze, mat(censer.x, 0.97, censer.z));
    this.batch.add(new THREE.TorusGeometry(0.8, 0.06, 8, 28).rotateX(Math.PI / 2), this.m.bronze, mat(censer.x, 1.27, censer.z));
    this.batch.add(new THREE.CircleGeometry(0.76, 24).rotateX(-Math.PI / 2), this.m.stone, mat(censer.x, 1.24, censer.z));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.batch.add(new THREE.CylinderGeometry(0.08, 0.06, 0.55, 8), this.m.bronze, mat(censer.x + Math.cos(a) * 0.5, 0.55, censer.z + Math.sin(a) * 0.5));
    }
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.6, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(censer.x, 0.8, censer.z);
    hit.userData.kind = 'censer';
    this.scene.add(hit);
    this.clickables.push(hit);
    this.circles.push({ x: censer.x, z: censer.z, r: 1.55 });

    // merit box
    const box = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.75), this.m.woodDark);
    body.position.y = 0.48;
    body.castShadow = true;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.4), new THREE.MeshBasicMaterial({ map: textures.sign('功 德', '#f0d28a', '#4b2615', 256, 110, 'bold 70px "Noto Serif TC", serif') }));
    label.position.set(0, 0.55, 0.38);
    box.add(body, label);
    box.position.set(donation.x, this.groundHeight(donation.x, donation.z), donation.z);
    box.rotation.y = -0.3;
    box.traverse((o) => (o.userData.kind = 'donation'));
    this.scene.add(box);
    this.clickables.push(box);
    this.circles.push({ x: donation.x, z: donation.z, r: 0.9 });
  }

  private buildTower(x: number, z: number, kind: 'bell' | 'drum') {
    this.box(5.2, 0.7, 5.2, this.m.stone, x, 0.35, z);
    for (const [dx, dz] of [
      [-2.1, -2.1],
      [2.1, -2.1],
      [-2.1, 2.1],
      [2.1, 2.1],
    ])
      this.batch.add(new THREE.CylinderGeometry(0.2, 0.24, 3.8, 10), this.m.lacquer, mat(x + dx, 0.7 + 1.9, z + dz));
    this.box(4.8, 0.35, 4.8, this.m.trim, x, 4.6, z);
    this.batch.add(hipRoof(7, 7, 2.6, 0.8), this.m.roof, mat(x, 4.75, z));
    this.batch.add(new THREE.SphereGeometry(0.3, 10, 8), this.m.gold, mat(x, 7.4, z));
    this.boxes.push({ x0: x - 2.6, x1: x + 2.6, z0: z - 2.6, z1: z + 2.6 });
    const target = kind === 'bell' ? this.bell : this.drum;
    if (kind === 'bell') {
      const bell = new THREE.Mesh(
        new THREE.LatheGeometry(
          [
            [0, 1.5],
            [0.55, 1.45],
            [0.7, 1.0],
            [0.8, 0.3],
            [0.95, 0],
            [0.85, 0],
          ].map(([a, b]) => new THREE.Vector2(a, b)),
          28,
        ),
        this.m.bronze,
      );
      bell.position.y = -1.6;
      bell.castShadow = true;
      target.add(bell);
      target.position.set(x, 4.4, z);
    } else {
      const drumBody = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 28, 1, true), this.m.lacquer);
      const skin = new THREE.Mesh(new THREE.CircleGeometry(0.95, 28), this.m.white);
      skin.position.y = 0.66;
      skin.rotation.x = -Math.PI / 2;
      const skin2 = skin.clone();
      skin2.position.y = -0.66;
      skin2.rotation.x = Math.PI / 2;
      const d = new THREE.Group();
      d.add(drumBody, skin, skin2);
      d.rotation.x = Math.PI / 2;
      target.add(d);
      target.position.set(x, 2.1, z);
      this.box(0.2, 1.3, 1.6, this.m.woodDark, x - 0.9, 1.3, z);
      this.box(0.2, 1.3, 1.6, this.m.woodDark, x + 0.9, 1.3, z);
    }
    target.traverse((o) => {
      o.userData.kind = kind;
      o.castShadow = true;
    });
    this.scene.add(target);
    this.clickables.push(target);
  }

  private buildGate() {
    const { gate } = WORLD;
    for (const x of [-5.4, -2, 2, 5.4]) {
      this.batch.add(new THREE.CylinderGeometry(0.32, 0.36, 4.6, 12), this.m.lacquer, mat(gate.x + x, 2.3, gate.z));
      this.batch.add(new THREE.CylinderGeometry(0.5, 0.55, 0.4, 10), this.m.stone, mat(gate.x + x, 0.2, gate.z));
      this.circles.push({ x: gate.x + x, z: gate.z, r: 0.5 });
    }
    this.box(12, 0.5, 0.6, this.m.lacquer, gate.x, 4.75, gate.z);
    this.box(12, 0.3, 0.62, this.m.trim, gate.x, 5.1, gate.z);
    this.batch.add(hipRoof(6.6, 3.6, 1.9, 0.6), this.m.roof, mat(gate.x, 5.3, gate.z));
    this.batch.add(hipRoof(4.6, 3.2, 1.5, 0.5), this.m.roof, mat(gate.x - 4.4, 4.9, gate.z));
    this.batch.add(hipRoof(4.6, 3.2, 1.5, 0.5), this.m.roof, mat(gate.x + 4.4, 4.9, gate.z));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.95), new THREE.MeshBasicMaterial({ map: textures.sign('淨 心 寺'), toneMapped: false }));
    board.position.set(gate.x, 4.2, gate.z + 0.32);
    this.scene.add(board);
    const back = board.clone();
    back.rotation.y = Math.PI;
    back.position.z = gate.z - 0.32;
    this.scene.add(back);
    // gate wings join the perimeter wall
    for (const sx of [-1, 1]) {
      this.box(6, 2.2, 0.7, this.m.plaster, gate.x + sx * 9, 1.1, gate.z);
      this.box(6.4, 0.3, 1.1, this.m.roof, gate.x + sx * 9, 2.35, gate.z);
      this.boxes.push({ x0: gate.x + sx * 9 - 3, x1: gate.x + sx * 9 + 3, z0: gate.z - 0.5, z1: gate.z + 0.5 });
    }
  }

  private buildWall() {
    const R = 67.5;
    const n = 96;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      if (z > 55 && Math.abs(x) < 13) continue; // gate gap
      const len = ((2 * Math.PI * R) / n) * 1.02;
      this.box(len, 1.9, 0.6, this.m.plaster, x, 0.95, z, -a + Math.PI / 2, false);
      this.box(len + 0.1, 0.25, 1.0, this.m.roof, x, 2.0, z, -a + Math.PI / 2, false);
    }
  }

  private stoneLantern(x: number, z: number) {
    this.batch.add(new THREE.BoxGeometry(0.6, 0.25, 0.6), this.m.stoneDark, mat(x, 0.12, z));
    this.batch.add(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 8), this.m.stone, mat(x, 0.7, z));
    this.batch.add(new THREE.BoxGeometry(0.55, 0.12, 0.55), this.m.stone, mat(x, 1.2, z));
    this.batch.add(new THREE.BoxGeometry(0.36, 0.4, 0.36), this.m.lanternWarm, mat(x, 1.46, z), false);
    this.batch.add(new THREE.ConeGeometry(0.5, 0.42, 4).rotateY(Math.PI / 4), this.m.stoneDark, mat(x, 1.86, z));
    this.circles.push({ x, z, r: 0.4 });
  }

  private buildStoneLanterns() {
    for (let z = 20; z <= 54; z += 7) for (const sx of [-1, 1]) this.stoneLantern(sx * 3.4, z);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const x = WORLD.courtyard.x + Math.cos(a) * (WORLD.courtyard.r + 0.8);
      const z = WORLD.courtyard.z + Math.sin(a) * (WORLD.courtyard.r + 0.8);
      if (z < -8 || (Math.abs(x) < 4 && z > 10)) continue;
      this.stoneLantern(x, z);
    }
  }

  private buildGarden() {
    const g = gardenRect();
    const r = rng(21);
    const cx = (g.x0 + g.x1) / 2;
    const cz = (g.z0 + g.z1) / 2;
    // hedge border with entrances in the middle of each side
    const hedge = (x0: number, z0: number, x1: number, z1: number) => {
      const w = Math.abs(x1 - x0) || 0.7;
      const d = Math.abs(z1 - z0) || 0.7;
      this.box(w, 0.9, d, this.m.hedge, (x0 + x1) / 2, 0.45, (z0 + z1) / 2);
      this.boxes.push({ x0: Math.min(x0, x1) - 0.35, x1: Math.max(x0, x1) + 0.35, z0: Math.min(z0, z1) - 0.35, z1: Math.max(z0, z1) + 0.35 });
    };
    hedge(g.x0, g.z0, cx - 1.6, g.z0);
    hedge(cx + 1.6, g.z0, g.x1, g.z0);
    hedge(g.x0, g.z1, cx - 1.6, g.z1);
    hedge(cx + 1.6, g.z1, g.x1, g.z1);
    hedge(g.x0, g.z0, g.x0, cz - 1.6);
    hedge(g.x0, cz + 1.6, g.x0, g.z1);
    hedge(g.x1, g.z0, g.x1, cz - 1.6);
    hedge(g.x1, cz + 1.6, g.x1, g.z1);
    this.plane(3, g.z1 - g.z0, this.m.paving, cx, 0.02, cz, 0, 2);
    this.plane(g.x1 - g.x0, 3, this.m.paving, cx, 0.021, cz, 0, 2);
    // flower beds
    const colors = ['#f4a6c0', '#ffffff', '#f6d36a', '#b58ae0', '#e8504a', '#ff9f5a'].map((c) => new THREE.Color(c));
    const beds: [number, number][] = [];
    for (const bx of [-1, 1]) for (const bz of [-1, 1]) for (const k of [0.32, 0.75]) beds.push([cx + bx * (g.x1 - cx) * k, cz + bz * (g.z1 - cz) * 0.55]);
    const perBed = this.opt.low ? 40 : 90;
    const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), beds.length * perBed);
    const stems = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.4, 4), this.m.leaf2, beds.length * perBed);
    let fi = 0;
    for (const [bx, bz] of beds) {
      this.box(3.4, 0.3, 2.4, this.m.woodDark, bx, 0.15, bz);
      this.plane(3.2, 2.2, this.m.soil, bx, 0.31, bz, 0, 3);
      this.boxes.push({ x0: bx - 1.7, x1: bx + 1.7, z0: bz - 1.2, z1: bz + 1.2 });
      const col = colors[Math.floor(r() * colors.length)];
      for (let i = 0; i < perBed; i++) {
        const fx = bx + (r() - 0.5) * 3;
        const fz = bz + (r() - 0.5) * 2;
        this.dummy.position.set(fx, 0.5 + r() * 0.12, fz);
        this.dummy.scale.setScalar(0.8 + r() * 0.6);
        this.dummy.updateMatrix();
        flowers.setMatrixAt(fi, this.dummy.matrix);
        flowers.setColorAt(fi, r() < 0.8 ? col : colors[Math.floor(r() * colors.length)]);
        this.dummy.position.set(fx, 0.45, fz);
        this.dummy.updateMatrix();
        stems.setMatrixAt(fi, this.dummy.matrix);
        fi++;
      }
    }
    this.dummy.scale.setScalar(1);
    flowers.castShadow = true;
    this.scene.add(flowers, stems);
    // bonsai pots + benches + a white Quan Âm statue at the centre
    for (const [px, pz] of [
      [g.x0 + 2, g.z0 + 2],
      [g.x1 - 2, g.z0 + 2],
      [g.x0 + 2, g.z1 - 2],
      [g.x1 - 2, g.z1 - 2],
    ]) {
      this.batch.add(new THREE.CylinderGeometry(0.55, 0.4, 0.5, 12), this.m.stoneDark, mat(px, 0.25, pz));
      this.batch.add(new THREE.CylinderGeometry(0.08, 0.12, 0.8, 6), this.m.bark, mat(px, 0.8, pz, 0, 1, 1, 1, 0, 0.3));
      this.batch.add(new THREE.IcosahedronGeometry(0.6, 0), this.m.leaf, mat(px + 0.2, 1.3, pz, 0, 1.4, 0.6, 1.2));
      this.circles.push({ x: px, z: pz, r: 0.7 });
    }
    for (const [bx, bz, ry] of [
      [cx - 5, cz + 0.2, 0],
      [cx + 5, cz + 0.2, 0],
    ] as const) {
      this.box(2, 0.12, 0.6, this.m.woodDark, bx, 0.48, bz + 2.2, ry);
      this.box(0.15, 0.45, 0.5, this.m.stone, bx - 0.8, 0.22, bz + 2.2, ry);
      this.box(0.15, 0.45, 0.5, this.m.stone, bx + 0.8, 0.22, bz + 2.2, ry);
      this.boxes.push({ x0: bx - 1, x1: bx + 1, z0: bz + 1.9, z1: bz + 2.5 });
    }
    this.batch.add(new THREE.CylinderGeometry(0.9, 1, 0.6, 16), this.m.stone, mat(cx, 0.3, cz));
    this.batch.addObject(this.standing(this.m.white, cx, 0.6, cz, 0.75));
    this.circles.push({ x: cx, z: cz, r: 1.3 });
  }

  private buildPond() {
    const { pond } = WORLD;
    const r = rng(3);
    const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 48).rotateX(-Math.PI / 2), this.m.water);
    water.position.set(pond.x, 0.06, pond.z);
    water.receiveShadow = true;
    this.scene.add(water);
    this.batch.add(new THREE.CircleGeometry(pond.r + 0.6, 48).rotateX(-Math.PI / 2), this.m.soil, mat(pond.x, 0.03, pond.z), false);
    this.circles.push({ x: pond.x, z: pond.z, r: pond.r + 0.5 });
    const rock = new THREE.DodecahedronGeometry(0.55, 0);
    for (let i = 0; i < 42; i++) {
      const a = (i / 42) * Math.PI * 2;
      const k = 0.6 + r() * 0.7;
      this.batch.add(rock, this.m.stoneDark, mat(pond.x + Math.cos(a) * (pond.r + 0.3), 0.12, pond.z + Math.sin(a) * (pond.r + 0.3), r() * 3, k, k * 0.6, k, r(), r()));
    }
    const pads = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2), this.m.pad, 30);
    const flowers = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.32, 8, 1, true), this.m.lotus, 14);
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2;
      const d = 1.2 + r() * (pond.r - 2);
      const x = pond.x + Math.cos(a) * d;
      const z = pond.z + Math.sin(a) * d;
      this.dummy.position.set(x, 0.08, z);
      this.dummy.scale.setScalar(0.7 + r() * 0.6);
      this.dummy.updateMatrix();
      pads.setMatrixAt(i, this.dummy.matrix);
      if (i < 14) {
        this.dummy.position.set(x, 0.24, z);
        this.dummy.scale.setScalar(1);
        this.dummy.rotation.x = Math.PI;
        this.dummy.updateMatrix();
        flowers.setMatrixAt(i, this.dummy.matrix);
        this.dummy.rotation.x = 0;
      }
    }
    this.dummy.scale.setScalar(1);
    this.scene.add(pads, flowers);
    // waterside pavilion (thủy tạ) on the north bank
    const px = pond.x;
    const pz = pond.z - pond.r - 2.2;
    this.box(4.4, 0.4, 3.4, this.m.stone, px, 0.2, pz);
    for (const [dx, dz] of [
      [-1.8, -1.3],
      [1.8, -1.3],
      [-1.8, 1.3],
      [1.8, 1.3],
    ])
      this.batch.add(new THREE.CylinderGeometry(0.14, 0.16, 2.8, 8), this.m.lacquer, mat(px + dx, 1.8, pz + dz));
    this.batch.add(hipRoof(5.6, 4.6, 1.8, 0.6), this.m.roof, mat(px, 3.2, pz));
    this.boxes.push({ x0: px - 2.2, x1: px + 2.2, z0: pz - 1.7, z1: pz + 1.7 });
  }

  private buildStupa() {
    const { stupa } = WORLD;
    this.batch.add(new THREE.CylinderGeometry(4.2, 4.6, 0.8, 8), this.m.stone, mat(stupa.x, 0.4, stupa.z));
    let y = 0.8;
    let rad = 3;
    for (let i = 0; i < 7; i++) {
      const h = 1.7 - i * 0.08;
      this.batch.add(new THREE.CylinderGeometry(rad * 0.92, rad, h, 8), this.m.plaster, mat(stupa.x, y + h / 2, stupa.z));
      this.batch.add(new THREE.CylinderGeometry(rad * 0.7, rad + 0.7, 0.45, 8), this.m.roof, mat(stupa.x, y + h + 0.2, stupa.z));
      y += h + 0.4;
      rad *= 0.86;
    }
    this.batch.add(new THREE.CylinderGeometry(0.08, 0.14, 2.6, 8), this.m.gold, mat(stupa.x, y + 1.3, stupa.z));
    for (let i = 0; i < 4; i++) this.batch.add(new THREE.SphereGeometry(0.28 - i * 0.04, 10, 8), this.m.gold, mat(stupa.x, y + 0.4 + i * 0.55, stupa.z));
    this.circles.push({ x: stupa.x, z: stupa.z, r: 4.6 });
  }

  private buildBodhi() {
    const { bodhi } = WORLD;
    this.batch.add(
      new THREE.LatheGeometry(
        [
          [1.6, 0],
          [0.9, 0.4],
          [0.7, 2],
          [0.6, 4],
          [0.4, 5.5],
          [0, 5.6],
        ].map(([a, b]) => new THREE.Vector2(a, b)),
        12,
      ),
      this.m.bark,
      mat(bodhi.x, 0, bodhi.z),
    );
    const r = rng(9);
    const blob = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 11; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 4;
      const k = 2.2 + r() * 1.6;
      this.batch.add(blob, i % 2 ? this.m.leaf : this.m.leaf2, mat(bodhi.x + Math.cos(a) * d, 6 + r() * 2.5, bodhi.z + Math.sin(a) * d, r() * 3, k, k * 0.7, k));
    }
    this.circles.push({ x: bodhi.x, z: bodhi.z, r: 1.7 });
  }

  private buildMoonYard(): Avatar {
    const { moonYard: m, djBooth: d } = WORLD;
    this.batch.add(new THREE.CircleGeometry(m.r, 48).rotateX(-Math.PI / 2), this.m.slate, mat(m.x, 0.03, m.z), false);
    const ring = new THREE.Mesh(new THREE.RingGeometry(m.r - 0.25, m.r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#c9b8ff', transparent: true, opacity: 0.5 }));
    ring.position.set(m.x, 0.04, m.z);
    this.scene.add(ring);
    const n = 56;
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3 });
    this.glowMats.push(bulbMat);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), bulbMat, n);
    const colors = ['#ffd27a', '#ff9db3', '#9ed8ff', '#c9b8ff'].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sag = Math.sin(((i % 7) / 7) * Math.PI) * 0.45;
      this.dummy.position.set(m.x + Math.cos(a) * (m.r - 0.6), 3.4 - sag, m.z + Math.sin(a) * (m.r - 0.6));
      this.dummy.updateMatrix();
      bulbs.setMatrixAt(i, this.dummy.matrix);
      bulbs.setColorAt(i, colors[i % colors.length]);
    }
    this.scene.add(bulbs);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = m.x + Math.cos(a) * (m.r - 0.6);
      const z = m.z + Math.sin(a) * (m.r - 0.6);
      this.batch.add(new THREE.CylinderGeometry(0.06, 0.07, 3.5, 6), this.m.woodDark, mat(x, 1.75, z));
      this.circles.push({ x, z, r: 0.25 });
    }
    this.box(1.1, 1.0, 2.6, this.m.woodDark, d.x + 1.1, 0.5, d.z);
    const deckMat = new THREE.MeshStandardMaterial({ color: '#8f7cff', emissive: '#8f7cff', emissiveIntensity: 0.5 });
    this.glowMats.push(deckMat);
    this.batch.add(new THREE.BoxGeometry(0.9, 0.05, 2.2), deckMat, mat(d.x + 1.1, 1.03, d.z), false);
    for (const sz of [-2.3, 2.3]) {
      this.box(0.8, 1.6, 0.8, this.m.woodDark, d.x + 0.8, 0.8, d.z + sz);
      this.boxes.push({ x0: d.x + 0.3, x1: d.x + 1.3, z0: d.z + sz - 0.5, z1: d.z + sz + 0.5 });
    }
    this.boxes.push({ x0: d.x - 0.8, x1: d.x + 1.8, z0: d.z - 1.5, z1: d.z + 1.5 });
    const dj = new Avatar(3, false);
    dj.setHeadphones();
    dj.root.position.set(d.x, 0, d.z);
    dj.root.rotation.y = Math.PI / 2;
    this.scene.add(dj.root);
    return dj;
  }

  /** Is (x,z) somewhere we must not put trees? */
  private occupied(x: number, z: number, pad = 0): boolean {
    for (const h of HALLS) {
      const r = hallRect(h, 4 + pad);
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 + 4) return true;
    }
    const near = (p: { x: number; z: number }, rr: number) => (x - p.x) ** 2 + (z - p.z) ** 2 < (rr + pad) ** 2;
    if (near(WORLD.courtyard, WORLD.courtyard.r + 4)) return true;
    if (near(WORLD.pond, WORLD.pond.r + 4.5) || near(WORLD.moonYard, WORLD.moonYard.r + 3) || near(WORLD.stupa, 6.5) || near(WORLD.bodhi, 8.5)) return true;
    if (near(WORLD.bellTower, 5) || near(WORLD.drumTower, 5) || near(WORLD.gate, 8)) return true;
    const g = gardenRect();
    if (x > g.x0 - 3 && x < g.x1 + 3 && z > g.z0 - 3 && z < g.z1 + 3) return true;
    for (const [x1, z1, x2, z2, w] of PATHS) {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) < w / 2 + 2 + pad) return true;
    }
    return false;
  }

  private buildForest() {
    const r = rng(11);
    const want = this.opt.low ? 110 : 230;
    type T = [number, number, number, number];
    const spots: T[] = [];
    let tries = 0;
    while (spots.length < want && tries++ < 12000) {
      const a = r() * Math.PI * 2;
      const d = 12 + r() * 53;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (this.occupied(x, z)) continue;
      if (spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < 9)) continue;
      spots.push([x, z, 0.8 + r() * 0.7, r()]);
    }
    // 55% pines, 30% broadleaf, 15% bamboo clumps
    const pines = spots.filter((s) => s[3] < 0.55);
    const broad = spots.filter((s) => s[3] >= 0.55 && s[3] < 0.85);
    const bamboo = spots.filter((s) => s[3] >= 0.85);
    const inst = (geo: THREE.BufferGeometry, m: THREE.Material, n: number) => {
      const im = new THREE.InstancedMesh(geo, m, Math.max(1, n));
      im.castShadow = true;
      im.receiveShadow = false;
      this.scene.add(im);
      return im;
    };
    const trunk = inst(new THREE.CylinderGeometry(0.16, 0.26, 2, 7), this.m.bark, pines.length + broad.length);
    const layers = [0, 1, 2, 3].map((l) => inst(new THREE.ConeGeometry(1.9 - l * 0.38, 2.1, 8), l % 2 ? this.m.pine2 : this.m.pine, pines.length));
    const crowns = [0, 1, 2].map((l) => inst(new THREE.IcosahedronGeometry(1, 0), l % 2 ? this.m.leaf : this.m.leaf2, broad.length));
    let ti = 0;
    const put = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, ry = 0) => {
      this.dummy.position.set(x, y, z);
      this.dummy.scale.set(sx, sy, sz);
      this.dummy.rotation.set(0, ry, 0);
      this.dummy.updateMatrix();
      im.setMatrixAt(i, this.dummy.matrix);
    };
    pines.forEach(([x, z, k], i) => {
      put(trunk, ti++, x, 1 * k, z, k);
      layers.forEach((m, l) => put(m, i, x, (2.4 + l * 1.15) * k, z, k, k, k, i));
      this.circles.push({ x, z, r: 0.45 * k });
    });
    broad.forEach(([x, z, k], i) => {
      put(trunk, ti++, x, 1 * k, z, k);
      crowns.forEach((m, l) => put(m, i, x + (l - 1) * 0.7 * k, (3 + (l % 2) * 0.7) * k, z + ((l * 37) % 3 - 1) * 0.5 * k, 1.5 * k, 1.2 * k, 1.5 * k, i + l));
      this.circles.push({ x, z, r: 0.45 * k });
    });
    const stalksPer = 7;
    const stalks = inst(new THREE.CylinderGeometry(0.06, 0.07, 1, 6), this.m.bamboo, bamboo.length * stalksPer);
    const tufts = inst(new THREE.ConeGeometry(0.5, 1.2, 5), this.m.leaf2, bamboo.length * stalksPer);
    bamboo.forEach(([x, z, k], i) => {
      for (let s = 0; s < stalksPer; s++) {
        const a = (s / stalksPer) * Math.PI * 2;
        const h = (5 + ((s * 13) % 5) * 0.4) * k;
        const bx = x + Math.cos(a) * 0.5;
        const bz = z + Math.sin(a) * 0.5;
        put(stalks, i * stalksPer + s, bx, h / 2, bz, 1, h, 1);
        put(tufts, i * stalksPer + s, bx, h, bz, 1);
      }
      this.circles.push({ x, z, r: 0.9 });
    });
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(1);
    // grass tufts & rocks (detail only on capable devices)
    if (!this.opt.low) {
      const tuftsN = 1400;
      const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.45, 3), this.m.leaf2, tuftsN);
      let gi = 0;
      while (gi < tuftsN) {
        const a = r() * Math.PI * 2;
        const d = 6 + r() * 60;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (this.occupied(x, z, -1.5)) continue;
        put(grass, gi++, x, 0.2, z, 0.7 + r() * 0.8, 0.6 + r() * 0.8, 0.7 + r() * 0.8, r() * 3);
      }
      this.scene.add(grass);
    }
    const rock = new THREE.DodecahedronGeometry(0.6, 0);
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const d = 18 + r() * 46;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (this.occupied(x, z)) continue;
      const k = 0.6 + r() * 1.2;
      this.batch.add(rock, this.m.stoneDark, mat(x, 0.15 * k, z, r() * 3, k, k * 0.6, k, r(), r()));
      this.circles.push({ x, z, r: 0.55 * k });
    }
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(1);
  }

  private buildMountains() {
    const r = rng(42);
    const geo = new THREE.ConeGeometry(1, 1, 8, 2);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + r() * 0.12;
      const d = 115 + r() * 70;
      const h = 26 + r() * 46;
      const sx = 22 + r() * 26;
      this.batch.add(geo, i % 2 ? this.m.mountain : this.m.mountain2, mat(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d, r() * 3, sx, h, sx), false);
    }
  }

  // =================================================================== runtime
  /**
   * Real-time lighting. `hour` is the visitor's local clock (0-24, fractional):
   * the sun rises in the east, arcs south and sets in the west; the moon takes over at night.
   */
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
    const top = c('#0b1226').lerp(c('#6e9cc6'), day).lerp(c('#58669a'), golden * 0.6);
    const bottom = c('#283049').lerp(c('#e7e1cd'), day).lerp(c('#f0a364'), golden * 0.85);
    this.skyMat.uniforms.top.value.copy(top);
    this.skyMat.uniforms.bottom.value.copy(bottom);
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.glow.value.copy(c('#ffdca0').multiplyScalar(day + golden));
    (this.scene.fog as THREE.FogExp2).color.copy(bottom.clone().lerp(top, 0.25));

    const moonDir = sunDir.clone().multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.25;
    moonDir.normalize();
    const lightDir = e > -0.03 ? sunDir : moonDir;
    this.sun.userData.dir = lightDir;
    this.sun.color.copy(c('#9db0ff').lerp(c('#ffb070'), golden + day * 0.2).lerp(c('#fff2dc'), day * (1 - golden)));
    this.sun.intensity = 2.6 * day + 0.9 * golden + 0.35 * night;
    this.sun.castShadow = this.opt.shadows && (e > 0.05 || (night > 0.9 && moonDir.y > 0.3));
    this.hemi.color.copy(c('#6c7fb8').lerp(c('#fff5e2'), day));
    this.hemi.groundColor.copy(c('#1a2016').lerp(c('#5d6a47'), day));
    // without hall point lights, low-end mode needs a little more fill light at night
    this.hemi.intensity = 0.45 + 0.55 * day + (this.opt.low ? 0.4 * night : 0);

    this.sunDisc.position.copy(sunDir).multiplyScalar(420);
    this.sunDisc.visible = e > -0.05;
    this.moonDisc.position.copy(moonDir).multiplyScalar(420);
    this.moonDisc.visible = night > 0.3;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, night * 1.2 - 0.2);
    this.stars.visible = night > 0.15;
    for (const m of this.glowMats) m.emissiveIntensity = 0.15 + 2.4 * Math.max(night, golden * 0.5);
    for (const l of this.hallLights) l.intensity = 3 + 22 * Math.max(night, golden * 0.6);
  }

  /** Keep the shadow camera centred on the player (snapped to avoid shimmering). */
  followShadow(x: number, z: number) {
    const dir = (this.sun.userData.dir as THREE.Vector3 | undefined) ?? new THREE.Vector3(0.4, 1, 0.3);
    const sx = Math.round(x);
    const sz = Math.round(z);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + dir.x * 80, dir.y * 80, sz + dir.z * 80);
  }

  ring(kind: 'bell' | 'drum') {
    if (kind === 'bell') this.bellSwing = 1;
    else this.drumHit = 1;
  }

  setSeatTaken(i: number, taken: boolean) {
    const p = SEATS[i];
    this.dummy.position.set(p.x, this.groundHeight(p.x, p.z) + (p.area === 'bodhi' ? 0.37 : 0.18), p.z);
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    this.dummy.scale.setScalar(taken ? 1 : 0.0001);
    this.dummy.updateMatrix();
    this.seatMarkers.setMatrixAt(i, this.dummy.matrix);
    this.seatMarkers.instanceMatrix.needsUpdate = true;
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(1);
  }

  setStick(slot: number, litAt: number) {
    if (litAt) this.stickLitAt.set(slot, litAt);
    else this.stickLitAt.delete(slot);
    this.updateStick(slot, Date.now());
  }

  private stickPos(slot: number) {
    const a = (slot / INCENSE_SLOTS) * Math.PI * 2 * 3.0;
    const rr = 0.18 + (slot % 3) * 0.19;
    return [WORLD.censer.x + Math.cos(a) * rr, WORLD.censer.z + Math.sin(a) * rr];
  }

  private updateStick(slot: number, now: number) {
    const lit = this.stickLitAt.get(slot);
    const [x, z] = this.stickPos(slot);
    const left = lit ? 1 - (now - lit) / INCENSE_BURN_MS : 0;
    const len = left > 0 ? 0.08 + 0.5 * left : 0;
    this.dummy.position.set(x, 1.24, z);
    this.dummy.scale.set(1, Math.max(len, 0.0001), 1);
    this.dummy.updateMatrix();
    this.sticks.setMatrixAt(slot, this.dummy.matrix);
    this.dummy.position.set(x, 1.24 + len, z);
    this.dummy.scale.setScalar(len ? 1 : 0.0001);
    this.dummy.updateMatrix();
    this.stickTips.setMatrixAt(slot, this.dummy.matrix);
    this.dummy.scale.setScalar(1);
    this.sticks.instanceMatrix.needsUpdate = true;
    this.stickTips.instanceMatrix.needsUpdate = true;
    if (left <= 0 && lit) this.stickLitAt.delete(slot);
  }

  private stickClock = 0;
  update(dt: number, now: number, t: number) {
    this.stickClock += dt;
    if (this.stickClock > 0.5) {
      this.stickClock = 0;
      for (const slot of [...this.stickLitAt.keys()]) this.updateStick(slot, now);
    }
    // bell swings, drum pulses
    if (this.bellSwing > 0.001) {
      this.bellSwing *= Math.exp(-dt * 0.9);
      this.bell.rotation.z = Math.sin(t * 5) * 0.12 * this.bellSwing;
    }
    if (this.drumHit > 0.001) {
      this.drumHit *= Math.exp(-dt * 8);
      this.drum.scale.setScalar(1 + this.drumHit * 0.04);
    }
    const lit = [...this.stickLitAt.keys()];
    const pos = this.smoke.geometry.attributes.position as THREE.BufferAttribute;
    this.smokeData.forEach((p, i) => {
      p.age += dt;
      if (p.slot < 0 || p.age > p.life) {
        if (!lit.length || Math.random() > 0.08) {
          p.slot = -1;
          pos.setXYZ(i, 0, -50, 0);
          return;
        }
        p.slot = lit[Math.floor(Math.random() * lit.length)];
        p.age = 0;
        p.life = 3 + Math.random() * 3;
        p.vx = (Math.random() - 0.5) * 0.12;
        p.vz = (Math.random() - 0.5) * 0.12;
        const [x, z] = this.stickPos(p.slot);
        pos.setXYZ(i, x, 1.8, z);
        return;
      }
      const sway = Math.sin(p.age * 1.7 + i) * 0.004;
      pos.setXYZ(i, pos.getX(i) + p.vx * dt + sway, pos.getY(i) + 0.32 * dt, pos.getZ(i) + p.vz * dt);
    });
    pos.needsUpdate = true;
  }

  // =================================================================== movement helpers
  groundHeight(x: number, z: number) {
    for (const h of HALLS) {
      const front = h.z + h.d / 2;
      if (Math.abs(x - h.x) < h.w / 2 + 1 && z > h.z - h.d / 2 - 1 && z <= front + 1) return h.h;
      const stepW = h.id === 'main' ? 4 : 2.5;
      if (Math.abs(x - h.x) < stepW && z > front + 1 && z < front + 2.65) return h.h * (1 - (z - front - 1) / 1.65);
    }
    return 0;
  }

  /** Ground pick without raycasting thousands of merged triangles: analytic planes per height level. */
  pickGround(ray: THREE.Ray): THREE.Vector3 | null {
    const levels = [...new Set(HALLS.map((h) => h.h)), 0];
    let best: THREE.Vector3 | null = null;
    for (const y of levels) {
      const p = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
      if (!p) continue;
      if (Math.abs(this.groundHeight(p.x, p.z) - y) > 0.05) continue;
      if (!best || p.distanceToSquared(ray.origin) < best.distanceToSquared(ray.origin)) best = p;
    }
    return best;
  }

  /** Push a point out of obstacles and keep it inside the world. */
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
    const d = Math.hypot(x, z);
    if (d > WORLD.radius) {
      x *= WORLD.radius / d;
      z *= WORLD.radius / d;
    }
    return [x, z];
  }
}
