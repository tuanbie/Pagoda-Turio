import * as THREE from 'three';
import { hipRoof, mat, rng, type World } from './World.ts';
import { textures } from './textures.ts';
import { GROUNDS, RIDDLE, STICKS, WISH, grounds, type GroundsDef } from './layout.ts';

/**
 * The working side of the temple, client-only: kitchen, storehouse, residence and sleeping
 * quarters behind the halls, plus the wish tree plaza near the gate.
 * Static parts go into the world batch; only a few small things move (fire, smoke,
 * drying robes, ribbons, butterflies), all updated without allocating.
 */

const NAMES: Record<GroundsDef['id'], [string, string]> = {
  kitchen: ['NHÀ BẾP', '香 積 廚'],
  store: ['NHÀ KHO', '庫 房'],
  residence: ['TỊNH XÁ', '精 舍'],
  dorm: ['LIÊU PHÒNG', '寮 房'],
};

/** the open kitchen's floor sits at ground level so people can walk in */
const KITCHEN_FLOOR = 0.05;

/** Where the novice monks work (used by npcs.ts). r = facing (atan2 convention of the game). */
export const STATIONS = (() => {
  const k = grounds('kitchen');
  const st = grounds('store');
  const rs = grounds('residence');
  const dm = grounds('dorm');
  const kBack = k.z - k.d / 2;
  return {
    stove: { x: k.x - 2, z: kBack + 2.35, r: Math.PI }, // facing the stove on the back wall
    prep: { x: k.x + 3.6, z: k.z + 1.4, r: Math.PI },
    storeDoor: { x: st.x, z: st.z + st.d / 2 + 1.1, r: Math.PI },
    kitchenDoor: { x: k.x - 4.5, z: k.z + k.d / 2 + 0.9, r: Math.PI },
    moktak: { x: rs.x - 3.2, z: rs.z + rs.d / 2 + 1.25, r: Math.PI / 2 }, // kneeling on the veranda, facing the wooden fish
    dormLine: { x: dm.x + 5.2, z: dm.z + dm.d / 2 + 2.6, r: 0 },
  };
})();

export class Grounds {
  private fire: THREE.MeshBasicMaterial;
  private fireMesh: THREE.Mesh;
  private smoke: THREE.Points;
  private smokeAge: Float32Array;
  private smokeOrigin = new THREE.Vector3();
  private robes: THREE.Mesh[] = [];
  private ribbons = new THREE.Group();
  private butterflies: { wingL: THREE.Mesh; wingR: THREE.Mesh; g: THREE.Group; cx: number; cz: number; r: number; s: number; ph: number }[] = [];
  private leaves: THREE.InstancedMesh | null = null;
  private leafData: Float32Array | null = null;
  private dummy = new THREE.Object3D();

  constructor(private w: World) {
    for (const g of GROUNDS) this.house(g);
    this.kitchenInside(grounds('kitchen'));
    this.storeYard(grounds('store'));
    this.residenceVeranda(grounds('residence'));
    this.dormYard(grounds('dorm'));
    this.wishPlaza();

    // kitchen fire glow (flickers in update) and chimney smoke
    const k = grounds('kitchen');
    this.fire = new THREE.MeshBasicMaterial({ color: '#ff7a2a', toneMapped: false });
    this.fireMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.32), this.fire);
    this.fireMesh.position.set(k.x - 2, KITCHEN_FLOOR + 0.3, k.z - k.d / 2 + 1.56);
    w.scene.add(this.fireMesh);
    const n = w.opt.low ? 18 : w.opt.density > 1 ? 70 : 40;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.smokeAge = new Float32Array(n).map(() => Math.random() * 6);
    this.smoke = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#d8d4cc', size: 0.9, transparent: true, opacity: 0.32, depthWrite: false }));
    this.smoke.frustumCulled = false;
    this.smokeOrigin.set(k.x - 2, 6.4, k.z - k.d / 2 + 0.6);
    w.scene.add(this.smoke);

    if (!w.opt.low) this.buildButterflies();
    if (w.opt.density > 1) this.buildFallingLeaves();
  }

  // ------------------------------------------------------------------ buildings
  /** Plastered house on a stone plinth, wooden frame, tiled hip roof, name board, door + windows. */
  private house(g: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const { x, z, w: W, d: D } = g;
    const front = z + D / 2;
    const back = z - D / 2;
    const H = 3.2;
    const open = g.id === 'kitchen'; // the kitchen is an open-fronted shed
    const B = open ? KITCHEN_FLOOR : 0.3;
    w.box(W + 0.8, B, D + 0.8, M.stone, x, B / 2, z);
    w.plane(W, D, M.floor, x, B + 0.01, z, 0, 2);
    // walls: back, two sides, and (except the kitchen) the front
    w.box(W, H, 0.25, M.plaster, x, B + H / 2, back + 0.12);
    for (const sx of [-1, 1]) w.box(0.25, H, D, M.plaster, x + sx * (W / 2 - 0.12), B + H / 2, z);
    if (!open) {
      w.box(W, H, 0.25, M.plaster, x, B + H / 2, front - 0.12);
      // doors (dark timber, slightly proud of the wall) and lattice windows between them
      const doors = g.id === 'dorm' ? [-4.2, 0, 4.2] : [0];
      for (const dx of doors) {
        w.box(1.3, 2.2, 0.08, M.woodDark, x + dx, B + 1.1, front + 0.02);
        w.box(1.5, 0.12, 0.12, M.lacquer, x + dx, B + 2.26, front + 0.04);
      }
      const wins = g.id === 'dorm' ? [-6, -2.1, 2.1, 6] : g.id === 'store' ? [-3] : [-4.4, -2.2, 2.2, 4.4];
      for (const dx of wins) {
        w.box(1.0, 0.9, 0.1, M.lattice, x + dx, B + 1.75, front + 0.03);
        w.box(1.15, 0.1, 0.16, M.woodDark, x + dx, B + 1.24, front + 0.06);
      }
      w.boxes.push({ x0: x - W / 2 - 0.4, x1: x + W / 2 + 0.4, z0: back - 0.4, z1: front + 0.4 });
    } else {
      w.boxes.push({ x0: x - W / 2 - 0.4, x1: x + W / 2 + 0.4, z0: back - 0.4, z1: back + 0.5 });
      for (const sx of [-1, 1]) w.boxes.push({ x0: x + sx * (W / 2 - 0.12) - 0.4, x1: x + sx * (W / 2 - 0.12) + 0.4, z0: back, z1: front + 0.4 });
    }
    // timber frame: corner posts + front posts under the eaves (a shallow veranda)
    const post = new THREE.CylinderGeometry(0.14, 0.16, H, 10);
    for (const sx of [-1, 1]) for (const zz of [back + 0.12, front - 0.12]) w.batch.add(post, M.woodDark, mat(x + sx * (W / 2 - 0.1), B + H / 2, zz));
    const eave = new THREE.CylinderGeometry(0.16, 0.18, H + 0.1, 10);
    const n = Math.max(3, Math.round(W / 3.5));
    for (let i = 0; i < n; i++) {
      const px = x - W / 2 + B + (i * (W - 0.6)) / (n - 1);
      w.batch.add(eave, M.lacquer, mat(px, B + H / 2, front + 1.0));
      w.circles.push({ x: px, z: front + 1.0, r: 0.3 });
    }
    w.box(W + 0.6, 0.3, 0.3, M.lacquer, x, B + H + 0.05, front + 1.0);
    w.box(W + 0.6, 0.3, 0.3, M.woodDark, x, B + H + 0.05, back + 0.12);
    w.batch.add(hipRoof(W + 3, D + 3.4, 2.3, 0.6), M.roof, mat(x, B + H + 0.2, z + 0.4));
    w.box(W * 0.45, 0.22, 0.32, M.trim, x, B + H + 2.45, z + 0.4);
    // name board under the front beam
    const [vi, han] = NAMES[g.id];
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.0), new THREE.MeshBasicMaterial({ map: textures.signBilingual(vi, han), toneMapped: false }));
    board.position.set(x, B + H - 0.55, front + (open ? 1.18 : 0.06));
    w.scene.add(board);
  }

  /** Clay stove with two big pots, chimney, prep table with vegetables, water jars, firewood. */
  private kitchenInside(k: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const back = k.z - k.d / 2;
    const clay = new THREE.MeshStandardMaterial({ color: '#9a5a3c', roughness: 0.95 });
    const iron = new THREE.MeshStandardMaterial({ color: '#2d2b29', roughness: 0.55, metalness: 0.4 });
    // stove along the back wall
    w.box(4.6, 0.85, 1.3, clay, k.x - 2, KITCHEN_FLOOR + 0.42, back + 0.9);
    for (const dx of [-1.1, 1.1]) {
      w.batch.add(new THREE.CylinderGeometry(0.52, 0.42, 0.42, 18), iron, mat(k.x - 2 + dx, KITCHEN_FLOOR + 1.06, back + 0.9));
      w.batch.add(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 18), M.woodDark, mat(k.x - 2 + dx, KITCHEN_FLOOR + 1.3, back + 0.9));
    }
    w.box(0.7, 4.6, 0.7, clay, k.x - 2, KITCHEN_FLOOR + 2.3 + 1.2, back + 0.45); // chimney through the roof
    w.boxes.push({ x0: k.x - 4.4, x1: k.x + 0.4, z0: back, z1: back + 1.7 });
    // prep table + baskets of greens
    w.box(2.6, 0.08, 1.1, M.woodDark, k.x + 3.6, KITCHEN_FLOOR + 0.82, k.z + 0.2);
    for (const dx of [-1.1, 1.1]) for (const dz of [-0.4, 0.4]) w.box(0.08, 0.8, 0.08, M.woodDark, k.x + 3.6 + dx, KITCHEN_FLOOR + 0.4, k.z + 0.2 + dz);
    const greens = new THREE.MeshStandardMaterial({ color: '#5f8f3a', roughness: 0.9 });
    const r = rng(77);
    for (let i = 0; i < 9; i++) w.batch.add(new THREE.SphereGeometry(0.09 + r() * 0.05, 7, 5), greens, mat(k.x + 3.0 + r() * 1.4, KITCHEN_FLOOR + 0.92, k.z + r() * 0.5));
    w.batch.add(new THREE.CylinderGeometry(0.3, 0.24, 0.22, 12, 1, true), M.bamboo, mat(k.x + 4.6, KITCHEN_FLOOR + 0.97, k.z + 0.3));
    w.boxes.push({ x0: k.x + 2.2, x1: k.x + 5.0, z0: k.z - 0.45, z1: k.z + 0.85 });
    // water jars along the west wall
    const jar = new THREE.MeshStandardMaterial({ color: '#6e4b32', roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const jz = back + 1.6 + i * 1.3;
      w.batch.add(new THREE.SphereGeometry(0.48, 14, 10).scale(1, 1.15, 1), jar, mat(k.x - k.w / 2 + 0.9, KITCHEN_FLOOR + 0.5, jz));
      w.batch.add(new THREE.CylinderGeometry(0.44, 0.44, 0.05, 14), M.woodDark, mat(k.x - k.w / 2 + 0.9, KITCHEN_FLOOR + 1.05, jz));
      w.circles.push({ x: k.x - k.w / 2 + 0.9, z: jz, r: 0.55 });
    }
    // firewood stacked outside the east wall
    const log = new THREE.CylinderGeometry(0.09, 0.09, 1.2, 7).rotateX(Math.PI / 2);
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 6 - row; i++) w.batch.add(log, M.bark, mat(k.x + k.w / 2 + 0.6, 0.09 + row * 0.16, k.z - 2 + i * 0.19 + row * 0.095, 0, 1, 1, 1, 0.02 * i));
    w.boxes.push({ x0: k.x + k.w / 2 + 0.2, x1: k.x + k.w / 2 + 1.0, z0: k.z - 2.8, z1: k.z - 0.6 });
  }

  /** Rice sacks, barrels and a hand cart in front of the storehouse. */
  private storeYard(st: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const front = st.z + st.d / 2;
    const sackM = new THREE.MeshStandardMaterial({ color: '#cbb994', roughness: 0.95 });
    const sack = new THREE.SphereGeometry(0.34, 10, 8).scale(1.25, 0.7, 0.85);
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 4 - row; i++) w.batch.add(sack, sackM, mat(st.x + 2.4 + i * 0.75 + row * 0.37, 0.24 + row * 0.42, front + 1.5, 0.1 * ((i + row) % 3)));
    w.boxes.push({ x0: st.x + 1.9, x1: st.x + 5.3, z0: front + 1.0, z1: front + 2.0 });
    const barrel = new THREE.CylinderGeometry(0.36, 0.36, 0.9, 14);
    for (const dx of [-3.4, -2.6]) {
      w.batch.add(barrel, M.woodDark, mat(st.x + dx, 0.45, front + 1.2));
      w.circles.push({ x: st.x + dx, z: front + 1.2, r: 0.45 });
    }
    // hand cart
    w.box(1.6, 0.12, 0.9, M.woodDark, st.x - 1.2, 0.55, front + 3.2, 0.3);
    const wheel = new THREE.TorusGeometry(0.34, 0.05, 6, 16).rotateY(Math.PI / 2);
    for (const s of [-1, 1]) w.batch.add(wheel, M.woodDark, mat(st.x - 1.2 + s * 0.13, 0.36, front + 3.2 + s * 0.5, 0.3));
    w.circles.push({ x: st.x - 1.2, z: front + 3.2, r: 1.0 });
  }

  /** Veranda of the residence: cushion and a wooden fish on its stand, potted plants, low table. */
  private residenceVeranda(rs: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const s = STATIONS.moktak;
    w.batch.add(new THREE.CylinderGeometry(0.38, 0.42, 0.14, 18), M.cushion, mat(s.x, 0.07, s.z));
    // the wooden fish (mõ) on a little stand, east of the cushion
    w.box(0.5, 0.25, 0.5, M.lacquer, s.x + 0.85, 0.12, s.z);
    w.batch.add(new THREE.SphereGeometry(0.2, 12, 10).scale(1.2, 0.8, 1), new THREE.MeshStandardMaterial({ color: '#8a4a26', roughness: 0.5 }), mat(s.x + 0.85, 0.38, s.z));
    w.circles.push({ x: s.x + 0.85, z: s.z, r: 0.4 });
    const pot = new THREE.CylinderGeometry(0.32, 0.24, 0.45, 12);
    const r = rng(5);
    for (const dx of [-5.6, 3.2, 5.6]) {
      const px = rs.x + dx;
      const pz = rs.z + rs.d / 2 + 0.85;
      w.batch.add(pot, new THREE.MeshStandardMaterial({ color: '#8f5a3c' }), mat(px, 0.22, pz));
      for (let i = 0; i < 4; i++) w.batch.add(new THREE.IcosahedronGeometry(0.28 + r() * 0.1, 0), M.leaf, mat(px + (r() - 0.5) * 0.3, 0.6 + i * 0.13, pz + (r() - 0.5) * 0.3));
      w.circles.push({ x: px, z: pz, r: 0.4 });
    }
  }

  /** Drying line with robes in front of the sleeping quarters (the robes sway). */
  private dormYard(dm: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const lz = dm.z + dm.d / 2 + 3.4;
    const x0 = dm.x + 2.4;
    const x1 = dm.x + 8.4;
    for (const px of [x0, x1]) {
      w.batch.add(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6), M.woodDark, mat(px, 1.05, lz));
      w.circles.push({ x: px, z: lz, r: 0.2 });
    }
    w.batch.add(new THREE.CylinderGeometry(0.012, 0.012, x1 - x0, 4).rotateZ(Math.PI / 2), M.woodDark, mat((x0 + x1) / 2, 2.0, lz), false);
    const robe = new THREE.PlaneGeometry(0.9, 1.1).translate(0, -0.55, 0);
    const colors = ['#7c6b55', '#8a7a62', '#6f5f4a', '#b98a4e'];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(robe, new THREE.MeshStandardMaterial({ color: colors[i], side: THREE.DoubleSide, roughness: 0.95 }));
      m.position.set(x0 + 0.9 + i * 1.4, 2.0, lz);
      m.castShadow = true;
      w.scene.add(m);
      this.robes.push(m);
    }
  }

  // ------------------------------------------------------------------ wish tree plaza
  private wishPlaza() {
    const w = this.w;
    const M = w.m;
    const { x, z } = WISH;
    const disc = new THREE.CircleGeometry(WISH.r, 40).rotateX(-Math.PI / 2);
    w.batch.add(disc, M.paving, mat(x, 0.02, z), false);
    // big old tree: flared trunk, five limbs, layered canopy
    w.batch.add(new THREE.CylinderGeometry(0.62, 1.05, 4.4, 14), M.bark, mat(x, 2.2, z));
    const r = rng(2024);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const lean = 0.75 + r() * 0.2;
      const len = 3.4 + r() * 0.8;
      w.batch.add(
        new THREE.CylinderGeometry(0.2, 0.4, len, 8).translate(0, len / 2, 0),
        M.bark,
        mat(x + Math.cos(a) * 0.2, 3.9, z + Math.sin(a) * 0.2, -a + Math.PI / 2, 1, 1, 1, 0, -lean),
      );
    }
    const blobs = Math.round(16 * Math.max(0.6, Math.min(1.4, w.opt.density)));
    for (let i = 0; i < blobs; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 4.6;
      const s = 1.8 + r() * 1.6;
      w.batch.add(new THREE.IcosahedronGeometry(1, 1), i % 3 ? M.leaf : M.leaf2, mat(x + Math.cos(a) * d, 6.6 + r() * 1.8 - d * 0.25, z + Math.sin(a) * d, r() * 3, s, s * 0.72, s));
    }
    // round stone bench around the trunk
    w.batch.add(new THREE.CylinderGeometry(2.0, 2.05, 0.45, 28, 1, true), M.stone, mat(x, 0.225, z));
    w.batch.add(new THREE.RingGeometry(1.15, 2.0, 28).rotateX(-Math.PI / 2), M.stone, mat(x, 0.45, z), false);
    w.circles.push({ x, z, r: 2.2 });
    // red ribbons and red-and-gold wish buds hanging from the lower branches (sway as one group)
    const count = Math.round(130 * Math.max(0.5, Math.min(1.5, w.opt.density)));
    const red = new THREE.MeshStandardMaterial({ color: '#c0281e', side: THREE.DoubleSide, roughness: 0.7, emissive: '#2a0402' });
    const gold = new THREE.MeshStandardMaterial({ color: '#e2b15a', side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 });
    const ribbonG = new THREE.PlaneGeometry(0.06, 0.7).translate(0, -0.35, 0);
    const budG = new THREE.BoxGeometry(0.12, 0.17, 0.02).translate(0, -0.5, 0);
    const ribbons = new THREE.InstancedMesh(ribbonG, red, count);
    const buds = new THREE.InstancedMesh(budG, gold, Math.round(count / 2));
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = 1.6 + r() * 3.6;
      this.dummy.position.set(Math.cos(a) * d, 4.2 + r() * 1.6 - d * 0.15, Math.sin(a) * d);
      this.dummy.rotation.set((r() - 0.5) * 0.2, r() * Math.PI, (r() - 0.5) * 0.2);
      this.dummy.updateMatrix();
      ribbons.setMatrixAt(i, this.dummy.matrix);
      if (i % 2 === 0) buds.setMatrixAt(i / 2, this.dummy.matrix);
    }
    this.ribbons.add(ribbons, buds);
    this.ribbons.position.set(x, 0, z);
    w.scene.add(this.ribbons);
    // invisible click volume: the trunk and the low branches
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.4, 6.5, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, 3.25, z);
    hit.userData.kind = 'wishTree';
    w.scene.add(hit);
    w.clickables.push(hit);
    this.stickAltar();
    this.riddleTable();
  }

  /** Small red altar table with a bamboo tube of proverb sticks. */
  private stickAltar() {
    const w = this.w;
    const M = w.m;
    const { x, z } = STICKS;
    w.box(1.3, 0.08, 0.8, M.lacquer, x, 0.82, z);
    w.box(1.2, 0.78, 0.7, M.woodDark, x, 0.39, z);
    w.batch.add(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 14, 1, true), M.bamboo, mat(x, 1.03, z));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      w.box(0.025, 0.42, 0.008, M.bamboo, x + Math.cos(a) * 0.06, 1.22, z + Math.sin(a) * 0.06, a, false);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), new THREE.MeshBasicMaterial({ map: textures.signBilingual('LỜI HAY', '佳 言'), toneMapped: false }));
    sign.position.set(x, 0.5, z + 0.36);
    w.scene.add(sign);
    w.boxes.push({ x0: x - 0.7, x1: x + 0.7, z0: z - 0.45, z1: z + 0.45 });
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 1.0), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, 0.8, z);
    hit.userData.kind = 'sticks';
    w.scene.add(hit);
    w.clickables.push(hit);
  }

  /** Round stone table with four stools and a riddle tablet. */
  private riddleTable() {
    const w = this.w;
    const M = w.m;
    const { x, z } = RIDDLE;
    w.batch.add(new THREE.CylinderGeometry(0.75, 0.8, 0.1, 22), M.stone, mat(x, 0.78, z));
    w.batch.add(new THREE.CylinderGeometry(0.22, 0.35, 0.74, 12), M.stone, mat(x, 0.37, z));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      w.batch.add(new THREE.CylinderGeometry(0.22, 0.26, 0.45, 12), M.stone, mat(x + Math.cos(a) * 1.25, 0.225, z + Math.sin(a) * 1.25));
    }
    w.circles.push({ x, z, r: 0.95 });
    const tablet = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.38), new THREE.MeshBasicMaterial({ map: textures.signBilingual('ĐỐ VUI', '謎 語'), toneMapped: false }));
    tablet.position.set(x, 0.84, z);
    tablet.rotation.x = -Math.PI / 2;
    w.scene.add(tablet);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.2, 14), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, 0.6, z);
    hit.userData.kind = 'riddle';
    w.scene.add(hit);
    w.clickables.push(hit);
  }

  // ------------------------------------------------------------------ life
  private buildButterflies() {
    const wingG = new THREE.PlaneGeometry(0.16, 0.12).translate(0.08, 0, 0);
    const colors = ['#f2c14e', '#ffffff', '#e98a5b', '#9fd3f0'];
    const spots = [
      [-36, 20, 9],
      [WISH.x, WISH.z, 7],
      [40, 34, 26],
      [-104, 8, 7],
    ];
    const n = this.w.opt.density > 1 ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const [cx, cz, r] = spots[i % spots.length];
      const m = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
      const g = new THREE.Group();
      const wingL = new THREE.Mesh(wingG, m);
      const wingR = new THREE.Mesh(wingG, m);
      wingR.rotation.y = Math.PI;
      g.add(wingL, wingR);
      this.w.scene.add(g);
      this.butterflies.push({ g, wingL, wingR, cx, cz, r: r * (0.5 + ((i * 37) % 10) / 20), s: 0.3 + ((i * 13) % 7) / 20, ph: i * 1.7 });
    }
  }

  /** Ultra only: leaves drifting down around the visitor. */
  private buildFallingLeaves() {
    const n = 260;
    const g = new THREE.PlaneGeometry(0.12, 0.08);
    this.leaves = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#c48a3a', side: THREE.DoubleSide, roughness: 0.9 }), n);
    this.leaves.frustumCulled = false;
    this.leafData = new Float32Array(n * 5); // x, y, z, phase, speed
    for (let i = 0; i < n; i++) {
      this.leafData[i * 5] = (Math.random() - 0.5) * 50;
      this.leafData[i * 5 + 1] = Math.random() * 12;
      this.leafData[i * 5 + 2] = (Math.random() - 0.5) * 50;
      this.leafData[i * 5 + 3] = Math.random() * 6;
      this.leafData[i * 5 + 4] = 0.4 + Math.random() * 0.5;
    }
    this.w.scene.add(this.leaves);
  }

  /** @param t seconds (any clock) · @param cx/cz where the visitor is (falling leaves follow them) */
  update(dt: number, t: number, cx: number, cz: number) {
    // fire flicker
    const f = 0.75 + Math.sin(t * 13) * 0.12 + Math.sin(t * 29) * 0.08;
    this.fire.color.setRGB(1, 0.42 * f + 0.05, 0.12 * f);
    this.fireMesh.scale.y = 0.85 + f * 0.25;
    // chimney smoke: rises, drifts with the wind, fades by recycling
    const pos = this.smoke.geometry.attributes.position as THREE.BufferAttribute;
    const o = this.smokeOrigin;
    for (let i = 0; i < this.smokeAge.length; i++) {
      let a = this.smokeAge[i] + dt;
      if (a > 6) a -= 6;
      this.smokeAge[i] = a;
      pos.setXYZ(i, o.x + a * 0.35 + Math.sin(i * 2.1 + t * 0.6) * 0.25 * a, o.y + a * 0.9, o.z + Math.cos(i * 1.3) * 0.2 * a);
    }
    pos.needsUpdate = true;
    // drying robes and wish ribbons sway in the breeze
    for (let i = 0; i < this.robes.length; i++) this.robes[i].rotation.x = Math.sin(t * 1.3 + i * 0.9) * 0.12 + 0.05;
    this.ribbons.rotation.y = Math.sin(t * 0.3) * 0.02;
    this.ribbons.rotation.z = Math.sin(t * 0.7) * 0.012;
    // butterflies: lazy figure-eights with flapping wings
    for (const b of this.butterflies) {
      const u = t * b.s + b.ph;
      b.g.position.set(b.cx + Math.sin(u) * b.r, 0.7 + Math.sin(u * 2.3) * 0.35 + 0.4, b.cz + Math.sin(u * 2) * b.r * 0.5);
      b.g.rotation.y = Math.atan2(Math.cos(u) * b.r, Math.cos(u * 2) * b.r) + Math.PI / 2;
      const flap = Math.sin(t * 22 + b.ph) * 1.1;
      b.wingL.rotation.y = flap;
      b.wingR.rotation.y = Math.PI - flap;
    }
    // falling leaves around the visitor (ultra)
    if (this.leaves && this.leafData) {
      const d = this.leafData;
      const n = this.leaves.count;
      for (let i = 0; i < n; i++) {
        const k = i * 5;
        d[k + 1] -= d[k + 4] * dt;
        if (d[k + 1] < 0.02) {
          d[k] = cx + (Math.random() - 0.5) * 50;
          d[k + 1] = 9 + Math.random() * 4;
          d[k + 2] = cz + (Math.random() - 0.5) * 50;
        }
        const ph = d[k + 3] + t * 1.5;
        this.dummy.position.set(d[k] + Math.sin(ph) * 0.6, d[k + 1], d[k + 2] + Math.cos(ph * 0.7) * 0.4);
        this.dummy.rotation.set(ph, ph * 0.6, ph * 0.3);
        this.dummy.updateMatrix();
        this.leaves.setMatrixAt(i, this.dummy.matrix);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
  }
}
