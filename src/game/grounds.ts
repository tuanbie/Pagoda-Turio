import * as THREE from 'three';
import { mat, rng, type World } from './World.ts';
import { HOUSE_FLOOR, KITCHEN_FLOOR } from './terrain.ts';
import { isHigh } from './detail/tier.ts';
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

/**
 * Door openings (x offsets from the house centre) and their width. The nav grid (nav.ts:
 * 0.5 m cells, colliders inflated by 0.35 m) leaves DOOR_W - 0.7 = 1.1 m free, which is two
 * whole cells only when the door centre sits on a whole metre — keep every house x + offset
 * an integer, or tap-to-walk can't route through the door.
 */
const DOOR_W = 1.8;
const DOORS: Record<GroundsDef['id'], number[]> = {
  kitchen: [],
  store: [0],
  residence: [0],
  dorm: [-4, 4],
};
/** cushion top (avatars sit on it) */
const CUSHION_SEAT = 0.16;

/** Things inside the rooms you can click (Game handles kind 'prop'). */
export type PropId = 'bed' | 'desk' | 'tea' | 'stove' | 'shelf' | 'sacks' | 'water' | 'books' | 'bench' | 'sink';

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
  /** every usable thing in the rooms (for debugging / the minimap) */
  readonly props: { id: PropId; x: number; z: number; spot: { x: number; z: number; r: number }; sit?: number }[] = [];

  constructor(private w: World) {
    for (const g of GROUNDS) this.house(g);
    this.kitchenInside(grounds('kitchen'));
    this.kitchenMore(grounds('kitchen'));
    this.storeYard(grounds('store'));
    this.storeInside(grounds('store'));
    this.residenceVeranda(grounds('residence'));
    this.residenceInside(grounds('residence'));
    this.dormYard(grounds('dorm'));
    this.dormInside(grounds('dorm'));
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
  /**
   * Plastered house on a stone plinth, wooden frame, tiled hip roof, name board — with real
   * door openings (and matching gaps in the colliders) so every room can be walked into.
   * The plinth is one walkable level (terrain HOUSE_FLOOR = 0.3 m: a single step).
   */
  private house(g: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const { x, z, w: W, d: D } = g;
    const front = z + D / 2;
    const back = z - D / 2;
    const H = 3.2;
    const open = g.id === 'kitchen'; // the kitchen is an open-fronted shed
    const B = open ? KITCHEN_FLOOR : HOUSE_FLOOR;
    w.box(W + 0.8, B, D + 0.8, M.stone, x, B / 2, z);
    w.plane(W, D, M.floor, x, B + 0.01, z, 0, 2);
    // walls: back + two sides, each with a dark timber dado (thin colliders: the inside stays walkable)
    w.box(W, H, 0.25, M.plaster, x, B + H / 2, back + 0.12);
    w.box(W, 0.9, 0.27, M.woodDark, x, B + 0.45, back + 0.13);
    // camera occluders: walls (door gaps left open) + the ceiling
    w.occluder(W, H, 0.3, x, B + H / 2, back + 0.12);
    for (const sx of [-1, 1]) w.occluder(0.3, H, D, x + sx * (W / 2 - 0.12), B + H / 2, z);
    w.occluder(W, 0.3, D + (open ? 1.4 : 0), x, B + H + 0.1, z + (open ? 0.7 : 0));
    w.boxes.push({ x0: x - W / 2 - 0.4, x1: x + W / 2 + 0.4, z0: back - 0.4, z1: back + 0.25 });
    for (const sx of [-1, 1]) {
      const wx = x + sx * (W / 2 - 0.12);
      w.box(0.25, H, D, M.plaster, wx, B + H / 2, z);
      w.box(0.27, 0.9, D, M.woodDark, wx, B + 0.45, z);
      w.boxes.push({ x0: wx - (sx < 0 ? 0.52 : 0.13), x1: wx + (sx < 0 ? 0.13 : 0.52), z0: back - 0.4, z1: open ? front + 0.4 : front });
    }
    if (!open) {
      const DW = DOOR_W;
      const doors = DOORS[g.id];
      // front wall in segments between the doorways
      const edges = [x - W / 2, ...doors.flatMap((dx) => [x + dx - DW / 2, x + dx + DW / 2]), x + W / 2];
      for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i];
        const b = edges[i + 1];
        if (b - a < 0.05) continue;
        w.box(b - a, H, 0.25, M.plaster, (a + b) / 2, B + H / 2, front - 0.12);
        w.occluder(b - a, H, 0.3, (a + b) / 2, B + H / 2, front - 0.12);
        w.box(b - a, 0.9, 0.27, M.woodDark, (a + b) / 2, B + 0.45, front - 0.12);
        w.boxes.push({ x0: a, x1: b, z0: front - 0.25, z1: front + 0.02 });
      }
      for (const dx of doors) {
        const cx = x + dx;
        // lintel, lacquered frame, a stone step and two leaves swung open inward
        w.box(DW, H - 2.35, 0.25, M.plaster, cx, B + 2.35 + (H - 2.35) / 2, front - 0.12);
        w.occluder(DW, H - 2.35, 0.3, cx, B + 2.35 + (H - 2.35) / 2, front - 0.12);
        w.box(DW + 0.3, 0.14, 0.32, M.lacquer, cx, B + 2.33, front - 0.12);
        for (const s of [-1, 1]) w.box(0.12, 2.3, 0.32, M.lacquer, cx + s * (DW / 2 + 0.03), B + 1.15, front - 0.12);
        w.box(DW + 0.4, 0.15, 0.45, M.stoneDark, cx, 0.075, front + 0.62, 0, false);
        const leaf = DW / 2 - 0.05;
        for (const s of [-1, 1]) {
          // hinged just past the jamb, folded flat behind the wall end: the leaf collider
          // never narrows the opening (its inflated edge lines up with the wall's)
          const hx = cx + s * (DW / 2 + 0.05);
          w.box(0.06, 2.2, leaf, M.woodDark, hx, B + 1.1, front - 0.3 - leaf / 2, 0, false);
          w.boxes.push({ x0: hx - 0.05, x1: hx + 0.05, z0: front - 0.3 - leaf, z1: front - 0.3 });
        }
      }
      const wins = g.id === 'dorm' ? [-6, -2.1, 2.1, 6] : g.id === 'store' ? [-3] : [-4.4, -2.2, 2.2, 4.4];
      for (const dx of wins)
        for (const zz of [front + 0.03, front - 0.27]) {
          w.box(1.0, 0.9, 0.1, M.lattice, x + dx, B + 1.75, zz);
          w.box(1.15, 0.1, 0.16, M.woodDark, x + dx, B + 1.24, zz + (zz > front ? 0.03 : -0.03));
        }
    }
    // timber frame: corner posts + front posts under the eaves (a shallow veranda)
    const post = new THREE.CylinderGeometry(0.14, 0.16, H, 10);
    for (const sx of [-1, 1]) for (const zz of [back + 0.12, front - 0.12]) w.batch.add(post, M.woodDark, mat(x + sx * (W / 2 - 0.1), B + H / 2, zz));
    const eave = new THREE.CylinderGeometry(0.16, 0.18, H + 0.1, 10);
    // veranda posts, spaced so none stands in front of a doorway (a post there blocks the
    // only nav-grid route in or out)
    const postX = (i: number, n: number) => x - W / 2 + B + (i * (W - 0.6)) / (n - 1);
    const doorX = open ? [] : DOORS[g.id].map((dx) => x + dx);
    let n = Math.max(3, Math.round(W / 3.5));
    while (doorX.some((cx) => Array.from({ length: n }, (_, i) => postX(i, n)).some((px) => Math.abs(px - cx) < DOOR_W / 2 + 0.4))) n++;
    for (let i = 0; i < n; i++) {
      const px = postX(i, n);
      w.batch.add(eave, M.lacquer, mat(px, B + H / 2, front + 1.0));
      w.circles.push({ x: px, z: front + 1.0, r: 0.3 });
    }
    w.box(W + 0.6, 0.3, 0.3, M.lacquer, x, B + H + 0.05, front + 1.0);
    w.box(W + 0.6, 0.3, 0.3, M.woodDark, x, B + H + 0.05, back + 0.12);
    // ceiling, so the room reads as a room rather than a hollow shell
    const ceil = new THREE.PlaneGeometry(W - 0.3, D - 0.3).rotateX(Math.PI / 2);
    w.batch.add(ceil, M.woodDark, mat(x, B + H - 0.02, z), false);
    w.roof(W + 3, D + 3.4, 2.3, 0.6, x, B + H + 0.2, z + 0.4, { topRidge: true });
    w.box(W * 0.45, 0.22, 0.32, M.trim, x, B + H + 2.45, z + 0.4);
    // name board under the front beam
    const [vi, han] = NAMES[g.id];
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.0), new THREE.MeshBasicMaterial({ map: textures.signBilingual(vi, han), toneMapped: false }));
    board.position.set(x, B + H - 0.55, front + (open ? 1.18 : 0.06));
    w.scene.add(board);
    // a warm hanging lamp in the room (emissive on every tier, a real light on high / ultra)
    const lampX = open ? x + 1.5 : x;
    w.batch.add(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4), M.woodDark, mat(lampX, B + H - 0.37, z), false);
    w.batch.add(new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1.25, 1), M.lanternWarm, mat(lampX, B + H - 0.85, z), false);
    if (isHigh(w.opt)) {
      const l = new THREE.PointLight('#ffc27a', 2, Math.max(W, D) * 0.9, 1.6);
      l.position.set(lampX, B + H - 1.05, z);
      w.scene.add(l);
      w.roomLights.push(l);
    }
  }

  /** Invisible click target for something you can use (Game handles userData.kind 'prop'). */
  private prop(id: PropId, x: number, y: number, z: number, sx: number, sy: number, sz: number, spot: { x: number; z: number; r: number }, sit?: number) {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, y, z);
    hit.userData.kind = 'prop';
    hit.userData.prop = id;
    hit.userData.spot = spot;
    if (sit !== undefined) {
      hit.userData.sit = true;
      hit.userData.y = sit;
    }
    this.w.scene.add(hit);
    this.w.clickables.push(hit);
    this.props.push({ id, x, z, spot, sit });
  }

  // ------------------------------------------------------------------ interiors
  /** Sleeping quarters: a row of wooden beds with mats, pillows, folded blankets and nets. */
  private dormInside(dm: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const B = HOUSE_FLOOR;
    const back = dm.z - dm.d / 2;
    const front = dm.z + dm.d / 2;
    const matM = new THREE.MeshStandardMaterial({ color: '#d8c9a0', roughness: 0.95 });
    const blanket = new THREE.MeshStandardMaterial({ color: '#7d6a52', roughness: 1 });
    const pillowM = new THREE.MeshStandardMaterial({ color: '#efe9da', roughness: 0.9 });
    const net = new THREE.MeshStandardMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, roughness: 1 });
    const BED_TOP = 0.45;
    const leg = new THREE.BoxGeometry(0.08, BED_TOP - 0.06, 0.08);
    const pole = new THREE.CylinderGeometry(0.015, 0.015, 1.35, 4);
    const roll = new THREE.CylinderGeometry(0.07, 0.07, 1.9, 8).rotateX(Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const bx = dm.x - 5.25 + i * 1.5;
      const bz = back + 1.3;
      w.box(0.92, 0.08, 2.0, M.woodDark, bx, B + BED_TOP - 0.04, bz);
      for (const [lx, lz] of [
        [-0.4, -0.92],
        [0.4, -0.92],
        [-0.4, 0.92],
        [0.4, 0.92],
      ])
        w.batch.add(leg, M.woodDark, mat(bx + lx, B + (BED_TOP - 0.06) / 2, bz + lz));
      w.box(0.86, 0.025, 1.92, matM, bx, B + BED_TOP + 0.012, bz, 0, false); // woven sleeping mat
      w.box(0.5, 0.1, 0.26, pillowM, bx, B + BED_TOP + 0.07, bz - 0.78, 0, false);
      w.box(0.62, 0.14, 0.38, blanket, bx, B + BED_TOP + 0.09, bz + 0.62, 0, false); // folded at the foot
      // mosquito net: let down over every other bed, rolled up over the rest
      for (const [px, pz] of [
        [-0.44, -0.98],
        [0.44, -0.98],
        [-0.44, 0.98],
        [0.44, 0.98],
      ])
        w.batch.add(pole, M.woodDark, mat(bx + px, B + BED_TOP + 0.675, bz + pz), false);
      if (i % 2 === 0) w.box(0.9, 1.25, 1.98, net, bx, B + BED_TOP + 0.625, bz, 0, false);
      else w.batch.add(roll, net, mat(bx, B + BED_TOP + 1.25, bz), false);
      // you sit on the foot of the bed, facing the room
      this.prop('bed', bx, B + 0.5, bz + 0.5, 0.95, 1.0, 1.0, { x: bx, z: back + 2.05, r: 0 }, BED_TOP);
    }
    // one collider for the row of beds; the foot strip stays free so you can sit on the edge
    w.boxes.push({ x0: dm.x - 6.1, x1: dm.x + 6.1, z0: back, z1: back + 1.6 });
    // robe hooks on the west wall: a rail with pegs and a few hanging robes
    const wx = dm.x - dm.w / 2 + 0.3;
    w.box(0.06, 0.08, 4.2, M.woodDark, wx, B + 1.9, dm.z + 0.4, 0, false);
    const peg = new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5).rotateZ(Math.PI / 2);
    for (let k = 0; k < 6; k++) w.batch.add(peg, M.woodDark, mat(wx + 0.08, B + 1.85, dm.z - 1.5 + k * 0.76), false);
    const robeM = new THREE.MeshStandardMaterial({ color: '#8a6a3e', roughness: 0.95, side: THREE.DoubleSide });
    const robeG = new THREE.PlaneGeometry(0.62, 1.15).rotateY(Math.PI / 2);
    for (const k of [1, 3, 4]) w.batch.add(robeG, robeM, mat(wx + 0.14, B + 1.27, dm.z - 1.5 + k * 0.76), false);
    // shoe rack inside, by the east door, with a few pairs of sandals
    const sx = dm.x + 6.2;
    w.box(0.5, 0.4, 1.6, M.woodDark, sx, B + 0.2, front - 1.6);
    w.boxes.push({ x0: sx - 0.3, x1: sx + 0.3, z0: front - 2.45, z1: front - 0.75 });
    const sandal = new THREE.BoxGeometry(0.11, 0.03, 0.26);
    for (let k = 0; k < 5; k++) for (const o of [-0.07, 0.07]) w.batch.add(sandal, M.lacquer, mat(sx + o, B + 0.42, front - 2.2 + k * 0.3, Math.PI / 2), false);
    // a bench along the west wall, near the front
    const bx = dm.x - dm.w / 2 + 0.75;
    const bz = front - 2.2;
    w.box(0.45, 0.08, 1.8, M.woodDark, bx, B + 0.44, bz);
    for (const o of [-0.75, 0.75]) w.box(0.38, 0.4, 0.08, M.woodDark, bx, B + 0.2, bz + o);
    w.boxes.push({ x0: bx - 0.25, x1: bx + 0.05, z0: bz - 0.9, z1: bz + 0.9 });
    this.prop('bench', bx, B + 0.4, bz, 0.6, 0.8, 1.9, { x: bx + 0.12, z: bz, r: Math.PI / 2 }, 0.46);
  }

  /** Residence: a study desk with books and a brush pot, a tea table, bookshelves, a scroll. */
  private residenceInside(rs: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const B = HOUSE_FLOOR;
    const back = rs.z - rs.d / 2;
    // study desk against the back wall (west side) + a round stool
    const dx = rs.x - 4.2;
    const dz = back + 0.75;
    w.box(1.7, 0.06, 0.8, M.woodDark, dx, B + 0.78, dz);
    for (const ox of [-0.78, 0.78]) w.box(0.08, 0.75, 0.72, M.woodDark, dx + ox, B + 0.375, dz);
    w.box(0.5, 0.03, 0.36, M.white, dx - 0.2, B + 0.825, dz + 0.05, 0.1, false); // open book
    for (let k = 0; k < 4; k++) w.box(0.3, 0.05, 0.22, k % 2 ? M.lacquer : M.trim, dx + 0.55, B + 0.835 + k * 0.05, dz - 0.15, 0.05 * k, false);
    w.batch.add(new THREE.CylinderGeometry(0.06, 0.055, 0.16, 10), M.white, mat(dx - 0.62, B + 0.89, dz - 0.2)); // brush pot
    const brush = new THREE.CylinderGeometry(0.008, 0.006, 0.28, 4);
    for (let k = 0; k < 4; k++) w.batch.add(brush, M.woodDark, mat(dx - 0.62 + (k - 1.5) * 0.02, B + 1.0, dz - 0.2, 0, 1, 1, 1, 0, (k - 1.5) * 0.08), false);
    w.box(0.18, 0.03, 0.12, M.stoneDark, dx + 0.15, B + 0.825, dz - 0.25, 0, false); // ink stone
    w.batch.add(new THREE.CylinderGeometry(0.2, 0.22, 0.45, 12), M.woodDark, mat(dx, B + 0.225, dz + 0.95));
    w.boxes.push({ x0: dx - 0.9, x1: dx + 0.9, z0: back, z1: dz + 0.42 });
    this.prop('desk', dx, B + 0.6, dz + 0.4, 1.8, 1.2, 1.4, { x: dx, z: dz + 0.95, r: Math.PI }, 0.45);
    // tea table with two cushions and a tea set
    const tx = rs.x + 2.2;
    const tz = rs.z + 0.4;
    w.box(1.2, 0.3, 0.8, M.woodDark, tx, B + 0.15, tz);
    w.box(1.26, 0.04, 0.86, M.lacquer, tx, B + 0.32, tz, 0, false);
    w.batch.add(new THREE.SphereGeometry(0.12, 12, 8).scale(1, 0.8, 1), M.white, mat(tx, B + 0.43, tz));
    const cup = new THREE.CylinderGeometry(0.045, 0.035, 0.06, 10);
    for (const [cx, cz] of [
      [0.3, 0.2],
      [-0.3, 0.2],
      [0.3, -0.2],
    ])
      w.batch.add(cup, M.white, mat(tx + cx, B + 0.37, tz + cz), false);
    for (const o of [-0.85, 0.85]) w.batch.add(new THREE.CylinderGeometry(0.34, 0.38, 0.14, 16), M.cushion, mat(tx, B + 0.07, tz + o));
    w.circles.push({ x: tx, z: tz, r: 0.55 });
    this.prop('tea', tx, B + 0.3, tz, 1.4, 0.6, 1.0, { x: tx, z: tz + 0.85, r: Math.PI }, CUSHION_SEAT);
    // bookshelves along the east wall
    const sx = rs.x + rs.w / 2 - 0.5;
    const r = rng(41);
    const spines = [M.lacquer, M.trim, M.woodDark, M.white];
    w.box(0.5, 2.2, 3.2, M.woodDark, sx, B + 1.1, back + 2.4);
    for (let shelf = 0; shelf < 3; shelf++)
      for (let b = 0; b < 11; b++) {
        const bh = 0.4 + r() * 0.18;
        w.box(0.3, bh, 0.16 + r() * 0.06, spines[Math.floor(r() * spines.length)], sx - 0.12, B + 0.32 + shelf * 0.7 + bh / 2, back + 1.0 + b * 0.27, 0, false);
      }
    w.boxes.push({ x0: sx - 0.3, x1: sx + 0.3, z0: back + 0.7, z1: back + 4.1 });
    this.prop('books', sx - 0.2, B + 1.1, back + 2.4, 0.8, 2.2, 3.2, { x: sx - 1.0, z: back + 2.4, r: Math.PI / 2 });
    // calligraphy scroll on the back wall (a generic word: 靜, "stillness")
    const scroll = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.6), new THREE.MeshBasicMaterial({ map: textures.couplet('靜', '#efe4cc') }));
    scroll.position.set(rs.x + 1.2, B + 1.9, back + 0.27);
    w.scene.add(scroll);
  }

  /** Storehouse: shelves with jars, baskets and boxes, a pile of sacks, floor baskets and tools. */
  private storeInside(st: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const B = HOUSE_FLOOR;
    const back = st.z - st.d / 2;
    const jar = new THREE.MeshStandardMaterial({ color: '#6e4b32', roughness: 0.6 });
    const basket = new THREE.MeshStandardMaterial({ color: '#b08a52', roughness: 0.95, side: THREE.DoubleSide });
    const sackM = new THREE.MeshStandardMaterial({ color: '#cbb994', roughness: 0.95 });
    const jarG = new THREE.SphereGeometry(0.2, 10, 8).scale(1, 1.2, 1);
    const basketG = new THREE.CylinderGeometry(0.22, 0.17, 0.3, 12, 1, true);
    for (const ox of [-2.4, 2.4]) {
      const sx = st.x + ox;
      for (const yy of [0.05, 0.75, 1.45, 2.1]) w.box(3.2, 0.06, 0.6, M.woodDark, sx, B + yy, back + 0.55, 0, yy > 0.1);
      for (const px of [-1.55, 1.55]) w.box(0.08, 2.2, 0.6, M.woodDark, sx + px, B + 1.1, back + 0.55);
      for (let k = 0; k < 5; k++) {
        w.batch.add(jarG, jar, mat(sx - 1.2 + k * 0.6, B + 0.33, back + 0.55));
        w.batch.add(basketG, basket, mat(sx - 1.2 + k * 0.6, B + 0.94, back + 0.55));
        w.box(0.42, 0.28, 0.4, k % 2 ? M.woodDark : basket, sx - 1.2 + k * 0.6, B + 1.62, back + 0.55, 0.1 * k, false);
      }
      w.boxes.push({ x0: sx - 1.65, x1: sx + 1.65, z0: back, z1: back + 0.9 });
      this.prop('shelf', sx, B + 1.1, back + 0.55, 3.2, 2.2, 0.8, { x: sx, z: back + 1.6, r: Math.PI });
    }
    // sack pile on the west side
    const sack = new THREE.SphereGeometry(0.34, 10, 8).scale(1.25, 0.7, 0.85);
    const px = st.x - st.w / 2 + 1.0;
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 4 - row; i++) w.batch.add(sack, sackM, mat(px, B + 0.24 + row * 0.42, st.z - 1.2 + i * 0.75 + row * 0.37, Math.PI / 2 + 0.1 * ((i + row) % 3)));
    w.boxes.push({ x0: px - 0.55, x1: px + 0.55, z0: st.z - 1.7, z1: st.z + 1.6 });
    this.prop('sacks', px, B + 0.6, st.z + 0.1, 1.1, 1.3, 3.2, { x: px + 1.2, z: st.z + 0.1, r: -Math.PI / 2 });
    // tools leaning on the east wall: a broom and two hoes
    const ex = st.x + st.w / 2 - 0.35;
    const handle = new THREE.CylinderGeometry(0.025, 0.025, 1.7, 5);
    for (let k = 0; k < 3; k++) {
      const tz = st.z - 1.0 + k * 0.7;
      w.batch.add(handle, M.bamboo, mat(ex - 0.12, B + 0.85, tz, 0, 1, 1, 1, 0, 0.12), false);
      if (k === 0) w.batch.add(new THREE.ConeGeometry(0.16, 0.45, 6), basket, mat(ex - 0.02, B + 0.2, tz), false);
      else w.box(0.06, 0.08, 0.3, M.stoneDark, ex - 0.22, B + 1.66, tz, 0, false);
    }
    w.boxes.push({ x0: ex - 0.3, x1: ex + 0.2, z0: st.z - 1.3, z1: st.z + 0.7 });
    // baskets on the floor
    const floorBasket = new THREE.CylinderGeometry(0.3, 0.24, 0.36, 12, 1, true);
    for (let k = 0; k < 3; k++) w.batch.add(floorBasket, basket, mat(st.x + 2.4 + k * 0.62, B + 0.18, st.z + 2.6));
    w.boxes.push({ x0: st.x + 2.05, x1: st.x + 4.1, z0: st.z + 2.3, z1: st.z + 2.9 });
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

  /** Kitchen extras: bowls on a shelf, cutting boards, rice sacks and a stone wash basin. */
  private kitchenMore(k: GroundsDef) {
    const w = this.w;
    const M = w.m;
    const F = KITCHEN_FLOOR;
    const back = k.z - k.d / 2;
    const front = k.z + k.d / 2;
    // bowl shelf on the back wall (east half)
    const sx = k.x + 3.4;
    for (const yy of [0.9, 1.5]) w.box(3.6, 0.05, 0.45, M.woodDark, sx, F + yy, back + 0.45);
    for (const ox of [-1.75, 1.75]) w.box(0.06, 1.6, 0.45, M.woodDark, sx + ox, F + 0.8, back + 0.45);
    const bowl = new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    for (const yy of [0.93, 1.53])
      for (let i = 0; i < 9; i++)
        for (let st = 0; st < 3; st++) w.batch.add(bowl, M.white, mat(sx - 1.55 + i * 0.38, F + yy + 0.12 + st * 0.045, back + 0.45, 0, 1, 1, 1, Math.PI), false);
    w.boxes.push({ x0: sx - 1.8, x1: sx + 1.8, z0: back, z1: back + 0.7 });
    this.prop('shelf', sx, F + 1.0, back + 0.45, 3.6, 1.8, 0.6, { x: sx, z: back + 1.45, r: Math.PI });
    // cutting board and a round chopping block on the prep table
    w.box(0.6, 0.04, 0.36, M.floor, k.x + 3.0, F + 0.88, k.z + 0.35, 0.1, false);
    w.batch.add(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 14), M.bark, mat(k.x + 4.3, F + 0.91, k.z + 0.05), false);
    // rice sacks by the east wall
    const sackM = new THREE.MeshStandardMaterial({ color: '#d6c7a0', roughness: 0.95 });
    const sack = new THREE.SphereGeometry(0.32, 10, 8).scale(0.85, 1.2, 0.85);
    const rx = k.x + k.w / 2 - 0.8;
    for (let i = 0; i < 3; i++) w.batch.add(sack, sackM, mat(rx, F + 0.36, front - 1.2 - i * 0.62, i * 0.4));
    w.boxes.push({ x0: rx - 0.4, x1: rx + 0.4, z0: front - 2.8, z1: front - 0.8 });
    this.prop('sacks', rx, F + 0.4, front - 1.8, 0.9, 0.9, 2.0, { x: rx - 1.0, z: front - 1.8, r: Math.PI / 2 });
    // stone wash basin with water, near the west wall at the front
    const bx = k.x - k.w / 2 + 1.1;
    const bz = front - 1.3;
    w.box(1.0, 0.75, 1.3, M.stone, bx, F + 0.375, bz);
    w.plane(0.8, 1.1, M.water, bx, F + 0.76, bz, 0, 1);
    w.batch.add(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 12), M.woodDark, mat(bx + 0.3, F + 0.81, bz - 0.45), false); // ladle cup
    w.boxes.push({ x0: bx - 0.55, x1: bx + 0.55, z0: bz - 0.7, z1: bz + 0.7 });
    this.prop('sink', bx, F + 0.5, bz, 1.1, 1.0, 1.4, { x: bx + 1.05, z: bz, r: -Math.PI / 2 });
    // the stove and the water jars become usable too
    this.prop('stove', k.x - 2, F + 0.9, back + 0.9, 4.6, 1.6, 1.4, { x: k.x - 0.6, z: back + 2.3, r: Math.PI });
    const jx = k.x - k.w / 2 + 0.9;
    this.prop('water', jx, F + 0.6, back + 2.9, 1.1, 1.2, 3.8, { x: jx + 1.1, z: back + 2.9, r: -Math.PI / 2 });
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
