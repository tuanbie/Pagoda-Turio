import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STUPA, TABLES, WORLD, pavilion, type FishTuple, type PavilionDef, type TableSnap } from '@sontu/shared';
import { hipRoof, mat, rng, scaleUV, type World } from './World.ts';
import { textures } from './textures.ts';
import { drawBoard } from './boardDraw.ts';
import { BRIDGE, bridgeHeight, stairWidth } from './terrain.ts';

/** Seat heights so avatars sit ON cushions / stones / stools, never inside them. */
export const CUSHION_TOP = 0.16;
export const STONE_TOP = 0.35;
export const STOOL_TOP = 0.45;

// =====================================================================================
// Pavilions: tea house, discussion hall, game hall
// =====================================================================================
const PAV_NAMES: Record<PavilionDef['id'], [string, string, string]> = {
  tea: ['TRÀ THẤT', '茶 室', '茶'],
  talk: ['GIẢNG ĐƯỜNG', '講 堂', '道'],
  games: ['KỲ ĐƯỜNG', '棋 堂', '棋'],
};

function scroll(w: World, x: number, y: number, z: number, glyph: string, ry = 0) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f1e6cf';
  g.fillRect(0, 0, 128, 320);
  g.fillStyle = '#6b4a2a';
  g.fillRect(0, 0, 128, 14);
  g.fillRect(0, 306, 128, 14);
  g.fillStyle = '#2a1c12';
  g.font = '600 92px "Noto Serif TC", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 64, 160);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.75), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  w.scene.add(m);
}

function pavilionShell(w: World, p: PavilionDef) {
  const front = p.z + p.d / 2;
  const back = p.z - p.d / 2;
  const H = 4.6;
  const top = p.h;
  const M = w.m;
  w.box(p.w + 2, p.h, p.d + 2, M.stone, p.x, p.h / 2, p.z);
  w.plane(p.w + 2, p.d + 2, M.paving, p.x, p.h + 0.005, p.z, 0, 2.2);
  w.plane(p.w - 0.6, p.d - 0.6, M.floor, p.x, top + 0.02, p.z, 0, 2);
  const sw = stairWidth(p);
  for (let i = 0; i < 2; i++) w.box(sw, (p.h * (2 - i)) / 2, 0.8, M.stone, p.x, (p.h * (2 - i)) / 4, front + 1.3 + i * 0.8);
  // walls with lattice windows on the sides
  w.box(p.w, H, 0.3, M.plaster, p.x, top + H / 2, back + 0.15);
  w.boxes.push({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: back - 1, z1: back + 0.5 });
  for (const sx of [-1, 1]) {
    const wx = p.x + sx * (p.w / 2 - 0.15);
    w.box(0.3, 1.2, p.d, M.woodDark, wx, top + 0.6, p.z);
    w.box(0.3, H - 2.6, p.d, M.plaster, wx, top + H - (H - 2.6) / 2, p.z);
    const g = new THREE.BoxGeometry(0.12, 1.4, p.d - 1);
    scaleUV(g, (p.d - 1) / 1.4, 1);
    w.batch.add(g, M.lattice, mat(wx, top + 1.9, p.z));
    w.boxes.push({ x0: wx - 0.45, x1: wx + 0.45, z0: back - 1, z1: front + 0.2 });
  }
  const colGeo = new THREE.CylinderGeometry(0.22, 0.25, H, 12);
  for (let i = 0; i < 5; i++) {
    const x = p.x - p.w / 2 + 0.4 + (i * (p.w - 0.8)) / 4;
    w.batch.add(colGeo, M.lacquer, mat(x, top + H / 2, front - 0.3));
    w.circles.push({ x, z: front - 0.3, r: 0.4 });
    if (i < 4 && i !== 1 && i !== 2) w.batch.add(new THREE.SphereGeometry(0.26, 12, 8).scale(1, 1.25, 1), M.lantern, mat(x + (p.w - 0.8) / 8, top + H - 0.6, front + 0.5), false);
  }
  w.box(p.w + 0.5, 0.45, 0.45, M.lacquer, p.x, top + H + 0.05, front - 0.3);
  w.box(p.w + 0.5, 0.3, 0.47, M.trim, p.x, top + H + 0.4, front - 0.3);
  w.batch.add(hipRoof(p.w + 4, p.d + 4, 3.4, 0.9), M.roof, mat(p.x, top + H + 0.5, p.z));
  const [vi, han, glyph] = PAV_NAMES[p.id];
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.2), new THREE.MeshBasicMaterial({ map: textures.signBilingual(vi, han), toneMapped: false }));
  // hang the board just under the front beam so the roof never hides it
  board.position.set(p.x, top + H - 0.75, front + 0.02);
  w.scene.add(board);
  scroll(w, p.x - 2.2, top + 2.4, back + 0.32, glyph);
  scroll(w, p.x + 2.2, top + 2.4, back + 0.32, glyph);
  return { top, front, back };
}

function teaHouse(w: World) {
  const p = pavilion('tea');
  const { top } = pavilionShell(w, p);
  const M = w.m;
  const pot = new THREE.SphereGeometry(0.13, 14, 10).scale(1, 0.8, 1);
  const spout = new THREE.ConeGeometry(0.03, 0.16, 8);
  const cup = new THREE.CylinderGeometry(0.045, 0.035, 0.06, 10);
  for (const tx of [-3.6, 3.6])
    for (const tz of [-2.4, 2.4]) {
      const x = p.x + tx;
      const z = p.z + tz;
      w.box(1.2, 0.32, 1.2, M.woodDark, x, top + 0.16, z);
      w.box(1.26, 0.04, 1.26, M.lacquer, x, top + 0.34, z, 0, false);
      w.batch.add(pot, M.white, mat(x, top + 0.46, z));
      w.batch.add(spout, M.white, mat(x + 0.15, top + 0.48, z, 0, 1, 1, 1, 0, -1.1));
      w.batch.add(new THREE.SphereGeometry(0.04, 8, 6), M.white, mat(x, top + 0.57, z));
      for (const [cx, cz] of [
        [0.32, 0.25],
        [-0.32, 0.25],
        [0.32, -0.25],
        [-0.32, -0.25],
      ])
        w.batch.add(cup, M.white, mat(x + cx, top + 0.39, z + cz), false);
      w.circles.push({ x, z, r: 0.55 });
    }
  // folding screen behind
  w.box(5, 1.8, 0.08, M.lattice, p.x, top + 0.9, p.z - p.d / 2 + 1.4);
  w.boxes.push({ x0: p.x - 2.5, x1: p.x + 2.5, z0: p.z - p.d / 2 + 1.3, z1: p.z - p.d / 2 + 1.5 });
}

function discussionHall(w: World) {
  const p = pavilion('talk');
  const { top, back } = pavilionShell(w, p);
  const M = w.m;
  // low round table with a vase and incense in the middle of the circle
  w.batch.add(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 24), M.lacquer, mat(p.x, top + 0.34, p.z));
  w.batch.add(new THREE.CylinderGeometry(0.2, 0.3, 0.3, 10), M.woodDark, mat(p.x, top + 0.16, p.z));
  w.batch.add(new THREE.LatheGeometry([0, 0.12, 0.16, 0.08, 0.1, 0].map((r, i) => new THREE.Vector2(r, i * 0.09)), 16), M.white, mat(p.x - 0.3, top + 0.37, p.z));
  w.batch.add(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 12), M.bronze, mat(p.x + 0.3, top + 0.43, p.z));
  w.circles.push({ x: p.x, z: p.z, r: 0.95 });
  // bookshelves along the back wall
  const spineMats = [M.lacquer, M.trim, M.woodDark, M.white];
  const r = rng(77);
  for (const sx of [-1, 1]) {
    const bx = p.x + sx * 5.5;
    w.box(3.4, 2.4, 0.5, M.woodDark, bx, top + 1.2, back + 0.6);
    for (let shelf = 0; shelf < 3; shelf++)
      for (let b = 0; b < 12; b++) {
        const bw = 0.16 + r() * 0.08;
        const bh = 0.45 + r() * 0.2;
        w.box(bw, bh, 0.32, spineMats[Math.floor(r() * spineMats.length)], bx - 1.5 + b * 0.26, top + 0.35 + shelf * 0.75 + bh / 2, back + 0.72, 0, false);
      }
    w.boxes.push({ x0: bx - 1.75, x1: bx + 1.75, z0: back, z1: back + 0.95 });
  }
}

/** Game hall with 6 live boards: each table top is a canvas texture redrawn on every move. */
export class GameTables {
  private boards: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];

  constructor(private w: World) {
    const p = pavilion('games');
    const { top } = pavilionShell(w, p);
    const M = w.m;
    const stool = new THREE.CylinderGeometry(0.28, 0.3, STOOL_TOP, 14);
    TABLES.forEach((t, i) => {
      w.box(1.3, 0.72, 1.3, M.woodDark, t.x, top + 0.36, t.z);
      for (const dz of [-1.05, 1.05]) w.batch.add(stool, M.lacquer, mat(t.x, top + STOOL_TOP / 2, t.z + dz));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
      board.position.set(t.x, top + 0.725, t.z);
      board.receiveShadow = true;
      w.scene.add(board);
      this.boards.push({ canvas, tex });
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 1.5), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(t.x, top + 0.65, t.z);
      hit.userData.kind = 'table';
      hit.userData.table = i;
      w.scene.add(hit);
      w.clickables.push(hit);
      w.circles.push({ x: t.x, z: t.z, r: 0.68 });
    });
  }

  set(snap: TableSnap) {
    const b = this.boards[snap.i];
    if (!b) return;
    const ctx = b.canvas.getContext('2d')!;
    drawBoard(ctx, 512, 512, snap.g);
    b.tex.needsUpdate = true;
  }
}

export function buildPavilions(w: World) {
  teaHouse(w);
  discussionHall(w);
  return new GameTables(w);
}

// =====================================================================================
// Climbable stupa
// =====================================================================================
export function buildStupa(w: World) {
  const s = STUPA;
  const M = w.m;
  const at = (r: number, a: number) => [s.x + Math.cos(a) * r, s.z + Math.sin(a) * r] as const;
  // octagonal body from the ground up to the upper balcony
  w.batch.add(new THREE.CylinderGeometry(s.upperR, s.upperR + 0.4, s.upperH, 8), M.plaster, mat(s.x, s.upperH / 2, s.z, Math.PI / 8));
  w.batch.add(new THREE.CylinderGeometry(s.upperR + 0.6, s.upperR + 0.9, 1, 8), M.stoneDark, mat(s.x, 0.5, s.z, Math.PI / 8));
  // lower balcony deck on columns
  w.batch.add(new THREE.CylinderGeometry(s.lowerR, s.lowerR, 0.5, 32), M.stone, mat(s.x, s.lowerH - 0.25, s.z));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    if (Math.abs(Math.sin(a) + 1) < 0.08) continue; // keep the stair opening (north) free
    const [x, z] = at(s.lowerR - 0.5, a);
    w.batch.add(new THREE.CylinderGeometry(0.28, 0.32, s.lowerH - 0.5, 10), M.lacquer, mat(x, (s.lowerH - 0.5) / 2, z));
  }
  // balustrades: posts around the deck edge, leaving the north (stair) gap open
  const post = new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6);
  const railY = s.lowerH + 0.55;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    if (Math.abs(a - Math.PI * 1.5) < 0.17) continue;
    const [x, z] = at(s.lowerR - 0.15, a);
    w.batch.add(post, M.lacquer, mat(x, railY, z));
  }
  w.batch.add(new THREE.TorusGeometry(s.lowerR - 0.15, 0.06, 6, 64, Math.PI * 2 - 0.34).rotateX(Math.PI / 2), M.lacquer, mat(s.x, s.lowerH + 1.1, s.z, -Math.PI * 1.5 - 0.17));
  // spiral stair on the balcony up to the upper ring
  const steps = 48;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.5) / steps;
    const a = s.spiralFrom + s.spiralSpan * t;
    const h = s.lowerH + (s.upperH - s.lowerH) * t;
    const [x, z] = at(s.upperR + 1.3, a);
    const arc = ((s.upperR + 1.3) * s.spiralSpan) / steps + 0.05;
    w.batch.add(new THREE.BoxGeometry(2.6, h - s.lowerH + 0.25, arc), M.stone, mat(x, (h + s.lowerH) / 2 - 0.12, z, -a));
  }
  // upper balcony + railing
  w.batch.add(new THREE.CylinderGeometry(s.upperR + 0.3, s.upperR + 0.3, 0.4, 32), M.stone, mat(s.x, s.upperH - 0.2, s.z));
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const end = s.spiralFrom + s.spiralSpan;
    if (Math.abs(Math.atan2(Math.sin(a - end), Math.cos(a - end))) < 0.3) continue; // where the spiral arrives
    const [x, z] = at(s.upperR + 0.15, a);
    w.batch.add(post, M.lacquer, mat(x, s.upperH + 0.55, z));
  }
  // straight stair from the ground (north side)
  const n = 30;
  for (let k = 0; k < n; k++) {
    const z0 = s.z - s.lowerR - s.stairLen + (k * s.stairLen) / n;
    const h = (s.lowerH * (k + 1)) / n;
    w.box(s.stairW, h, s.stairLen / n + 0.02, M.stone, s.x, h / 2, z0 + s.stairLen / n / 2);
  }
  for (const sx of [-1, 1]) {
    const len = Math.hypot(s.stairLen, s.lowerH);
    w.box(0.25, 0.9, len, M.stoneDark, s.x + sx * (s.stairW / 2 + 0.12), s.lowerH / 2 + 0.45, s.z - s.lowerR - s.stairLen / 2, 0, true);
    // tilt the balustrade with the stair
    void len;
  }
  // tiers above the upper balcony
  let y = s.upperH;
  let rad = s.core;
  for (let i = 0; i < 6; i++) {
    const h = 3.2 - i * 0.25;
    w.batch.add(new THREE.CylinderGeometry(rad * 0.92, rad, h, 8), M.plaster, mat(s.x, y + h / 2, s.z, Math.PI / 8));
    w.batch.add(new THREE.CylinderGeometry(rad * 0.6, rad + 1.4, 0.9, 8), M.roof, mat(s.x, y + h + 0.35, s.z, Math.PI / 8));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      w.batch.add(new THREE.SphereGeometry(0.16, 8, 6), M.lantern, mat(s.x + Math.cos(a) * (rad + 1.2), y + h + 0.1, s.z + Math.sin(a) * (rad + 1.2)), false);
    }
    y += h + 0.8;
    rad *= 0.82;
  }
  w.batch.add(new THREE.CylinderGeometry(0.12, 0.22, 5, 8), M.gold, mat(s.x, y + 2.5, s.z));
  for (let i = 0; i < 5; i++) w.batch.add(new THREE.SphereGeometry(0.5 - i * 0.07, 12, 8), M.gold, mat(s.x, y + 0.6 + i * 0.9, s.z));
  // eave between body and balcony + a name board facing the stair
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.5), new THREE.MeshBasicMaterial({ map: textures.signBilingual('BẢO THÁP', '寶 塔'), toneMapped: false }));
  board.position.set(s.x, 5.4, s.z - s.upperR - 0.45);
  board.rotation.y = Math.PI;
  w.scene.add(board);
}

// =====================================================================================
// Lotus pond: large water, arched bridge with a mid-pond gazebo, koi that visitors release
// =====================================================================================
interface FishBody {
  seed: number;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  w: number;
  phase: number;
  bornAt: number;
  from: [number, number] | null;
}

export class Pond {
  private fishMesh: THREE.InstancedMesh;
  private fish: FishBody[] = [];
  private dummy = new THREE.Object3D();
  static readonly CAP = 150;

  constructor(private w: World) {
    const { pond } = WORLD;
    const M = w.m;
    const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 96).rotateX(-Math.PI / 2), M.water);
    water.position.set(pond.x, 0.06, pond.z);
    water.receiveShadow = true;
    water.userData.kind = 'pond';
    w.scene.add(water);
    w.clickables.push(water);
    w.batch.add(new THREE.CircleGeometry(pond.r + 1, 96).rotateX(-Math.PI / 2), M.soil, mat(pond.x, 0.03, pond.z), false);
    const r = rng(3);
    const rock = new THREE.DodecahedronGeometry(0.6, 0);
    const n = 150;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(Math.sin(a)) < 0.09) continue; // bridge ends (east / west)
      const k = 0.6 + r() * 0.8;
      const x = pond.x + Math.cos(a) * (pond.r + 0.4);
      const z = pond.z + Math.sin(a) * (pond.r + 0.4);
      w.batch.add(rock, M.stoneDark, mat(x, 0.12, z, r() * 3, k, k * 0.6, k, r(), r()));
      w.circles.push({ x, z, r: 0.45 * k });
    }
    // lily pads & lotus flowers
    const pads = new THREE.InstancedMesh(new THREE.CircleGeometry(0.6, 14).rotateX(-Math.PI / 2), M.pad, 110);
    const flowers = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.38, 8, 1, true), M.lotus, 45);
    let fi = 0;
    for (let i = 0; i < 110; i++) {
      let x = 0;
      let z = 0;
      do {
        const a = r() * Math.PI * 2;
        const d = 2 + r() * (pond.r - 3);
        x = pond.x + Math.cos(a) * d;
        z = pond.z + Math.sin(a) * d;
      } while (Math.abs(z - BRIDGE.z) < 4.5);
      this.dummy.position.set(x, 0.08, z);
      this.dummy.scale.setScalar(0.7 + r() * 0.7);
      this.dummy.updateMatrix();
      pads.setMatrixAt(i, this.dummy.matrix);
      if (fi < 45 && r() < 0.45) {
        this.dummy.position.set(x, 0.26, z);
        this.dummy.scale.setScalar(1);
        this.dummy.rotation.x = Math.PI;
        this.dummy.updateMatrix();
        flowers.setMatrixAt(fi++, this.dummy.matrix);
        this.dummy.rotation.x = 0;
      }
    }
    flowers.count = fi;
    w.scene.add(pads, flowers);
    this.buildBridge();

    // koi: body + tail merged into one geometry, coloured per instance
    const body = new THREE.SphereGeometry(0.22, 12, 8).scale(0.55, 0.42, 1.4);
    const tail = new THREE.ConeGeometry(0.16, 0.34, 8).scale(0.2, 1, 1).rotateX(Math.PI / 2).translate(0, 0, -0.42);
    const finL = new THREE.ConeGeometry(0.07, 0.18, 6).rotateZ(Math.PI / 2).translate(0.16, -0.03, 0.08);
    const finR = finL.clone().scale(-1, 1, 1);
    const geo = mergeGeometries([body, tail, finL, finR].map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      return g;
    }));
    this.fishMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }), Pond.CAP);
    this.fishMesh.count = 0;
    this.fishMesh.frustumCulled = false;
    w.scene.add(this.fishMesh);
    // a few koi already live in the pond
    for (let i = 0; i < 18; i++) this.add([1000 + i * 7919, 0], null, true);
  }

  private buildBridge() {
    const b = BRIDGE;
    const M = this.w.m;
    const n = 64;
    const step = (b.x1 - b.x0) / n;
    const post = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
    for (let k = 0; k < n; k++) {
      const x = b.x0 + (k + 0.5) * step;
      const h = bridgeHeight(x, b.z)!;
      this.w.box(step + 0.04, 0.22, b.w, M.floor, x, h - 0.11, b.z, 0, true);
      if (k % 2 === 0)
        for (const sz of [-1, 1]) {
          const mid = (b.x0 + b.x1) / 2;
          if (Math.abs(x - mid) < b.midW / 2) continue;
          this.w.batch.add(post, M.lacquer, mat(x, h + 0.5, b.z + sz * (b.w / 2 - 0.08)));
        }
      if (k % 6 === 0) this.w.box(0.5, h, 0.5, M.stoneDark, x, h / 2, b.z, 0, false); // piers
    }
    // hand rails following the arch
    for (const sz of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let x = b.x0; x <= b.x1; x += 0.5) {
        const mid = (b.x0 + b.x1) / 2;
        if (Math.abs(x - mid) < b.midW / 2) {
          if (pts.length > 1) this.w.batch.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.splice(0)), 40, 0.06, 6), M.lacquer, new THREE.Matrix4());
          pts.length = 0;
          continue;
        }
        pts.push(new THREE.Vector3(x, bridgeHeight(x, b.z)! + 1, b.z + sz * (b.w / 2 - 0.08)));
      }
      if (pts.length > 1) this.w.batch.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.06, 6), M.lacquer, new THREE.Matrix4());
    }
    // gazebo on the wide deck in the middle of the pond
    const mx = (b.x0 + b.x1) / 2;
    const mh = bridgeHeight(mx, b.z)!;
    this.w.box(b.midW, 0.3, b.midW, M.floor, mx, mh - 0.15, b.z);
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const x = mx + dx * (b.midW / 2 - 0.4);
      const z = b.z + dz * (b.midW / 2 - 0.4);
      this.w.batch.add(new THREE.CylinderGeometry(0.18, 0.2, 3.2, 10), M.lacquer, mat(x, mh + 1.6, z));
      this.w.circles.push({ x, z, r: 0.35 });
    }
    this.w.batch.add(hipRoof(b.midW + 2.2, b.midW + 2.2, 2.4, 0.8), M.roof, mat(mx, mh + 3.2, b.z));
    this.w.batch.add(new THREE.SphereGeometry(0.3, 10, 8), M.gold, mat(mx, mh + 5.7, b.z));
  }

  /** Add a fish. `from` = where it is released (it swims out from there). */
  add(f: FishTuple, from: [number, number] | null, quiet = false) {
    if (this.fish.length >= Pond.CAP) this.fish.shift();
    const r = rng(f[0] >>> 0);
    for (let i = 0; i < 3; i++) r();
    const { pond } = WORLD;
    const a = r() * Math.PI * 2;
    const d = r() * pond.r * 0.55;
    this.fish.push({
      seed: f[0],
      cx: pond.x + Math.cos(a) * d,
      cz: pond.z + Math.sin(a) * d,
      rx: 2.5 + r() * 6,
      rz: 2 + r() * 5,
      w: (0.12 + r() * 0.2) * (r() < 0.5 ? 1 : -1),
      phase: r() * Math.PI * 2,
      bornAt: quiet ? -1e9 : performance.now(),
      from,
    });
    const palette = ['#ff7a2f', '#f4f1ea', '#ff4b3a', '#f1b33d', '#ffffff', '#ff9a4a'].map((c) => new THREE.Color(c));
    this.fishMesh.count = this.fish.length;
    for (let i = 0; i < this.fish.length; i++) this.fishMesh.setColorAt(i, palette[(this.fish[i].seed >>> 3) % palette.length]);
    if (this.fishMesh.instanceColor) this.fishMesh.instanceColor.needsUpdate = true;
  }

  update(now: number) {
    const { pond } = WORLD;
    const t = now / 1000;
    this.fish.forEach((f, i) => {
      const ang = t * f.w + f.phase;
      let x = f.cx + Math.cos(ang) * f.rx;
      let z = f.cz + Math.sin(ang) * f.rz;
      // stay inside the water and away from the bridge piers
      const dx = x - pond.x;
      const dz = z - pond.z;
      const d = Math.hypot(dx, dz);
      if (d > pond.r - 1.2) {
        x = pond.x + (dx / d) * (pond.r - 1.2);
        z = pond.z + (dz / d) * (pond.r - 1.2);
      }
      // freshly released fish swim out from the shore over ~4 s
      const age = (now - f.bornAt) / 4000;
      if (f.from && age < 1) {
        const e = age * age * (3 - 2 * age);
        x = f.from[0] + (x - f.from[0]) * e;
        z = f.from[1] + (z - f.from[1]) * e;
      }
      const heading = Math.atan2(-Math.sin(ang) * f.rx * Math.sign(f.w), Math.cos(ang) * f.rz * Math.sign(f.w));
      this.dummy.position.set(x, -0.06 + Math.sin(t * 2 + i) * 0.03, z);
      this.dummy.rotation.set(0, heading, Math.sin(t * 6 + i) * 0.12);
      const s = 0.8 + ((f.seed >>> 5) % 50) / 100;
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.fishMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.fishMesh.instanceMatrix.needsUpdate = true;
  }

  /** nearest shore point to (x,z) — where a released fish enters the water */
  shore(x: number, z: number): [number, number] {
    const { pond } = WORLD;
    const a = Math.atan2(z - pond.z, x - pond.x);
    return [pond.x + Math.cos(a) * (pond.r - 0.8), pond.z + Math.sin(a) * (pond.r - 0.8)];
  }
}

// =====================================================================================
// Shuttle: an open electric temple cart drives visitors from the road to the gate
// =====================================================================================
export const SHUTTLE_STOP = { x: 2.6, z: WORLD.gate.z + 4.5 };

export class Shuttle {
  private trips: { g: THREE.Group; t0: number; onDrop: (() => void) | null; dropped: boolean; rider: THREE.Object3D | null }[] = [];
  static readonly IN_MS = 5200;
  static readonly STOP_MS = 1600;
  static readonly OUT_MS = 4200;

  constructor(private w: World) {
    const M = w.m;
    // road from the gate forecourt out through the wall gap to the horizon
    const len = 200;
    w.plane(6.5, len, new THREE.MeshStandardMaterial({ color: '#55554f', roughness: 0.95 }), 0, 0.03, WORLD.gate.z + 2 + len / 2, 0, 4);
    for (let z = WORLD.gate.z + 12; z < WORLD.gate.z + len; z += 6) w.plane(0.18, 2.4, M.white, 0, 0.04, z, 0, 3);
    w.plane(12, 8, M.paving, 0, 0.035, WORLD.gate.z + 5, 0, 2.2);
  }

  private makeCart(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: '#f4efe3', roughness: 0.4 });
    const seat = new THREE.MeshStandardMaterial({ color: '#8f3b2b', roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: '#202020', roughness: 0.6 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(1.7, 0.45, 3.6), body, 0, 0.55, 0);
    add(new THREE.BoxGeometry(1.6, 0.5, 0.9), body, 0, 0.95, 1.3); // bonnet
    for (const z of [-1.2, -0.1, 0.9]) {
      add(new THREE.BoxGeometry(1.5, 0.18, 0.6), seat, 0, 0.92, z - 0.2);
      add(new THREE.BoxGeometry(1.5, 0.5, 0.12), seat, 0, 1.2, z - 0.5);
    }
    for (const [x, z] of [
      [-0.78, 1.6],
      [0.78, 1.6],
      [-0.78, -1.7],
      [0.78, -1.7],
    ])
      add(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), dark, x, 1.5, z);
    add(new THREE.BoxGeometry(1.8, 0.08, 3.6), body, 0, 2.25, -0.05); // canopy
    const wind = add(new THREE.PlaneGeometry(1.5, 0.7), new THREE.MeshStandardMaterial({ color: '#9fc3d6', transparent: true, opacity: 0.45, side: THREE.DoubleSide }), 0, 1.6, 1.6);
    wind.rotation.x = -0.2;
    const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 16).rotateZ(Math.PI / 2);
    for (const [x, z] of [
      [-0.86, 1.15],
      [0.86, 1.15],
      [-0.86, -1.15],
      [0.86, -1.15],
    ])
      add(wheel, dark, x, 0.32, z);
    for (const x of [-0.55, 0.55]) add(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff6c8' }), x, 0.85, 1.78);
    return g;
  }

  /**
   * Bring someone to the gate. The rider (their avatar) sits on the front bench during the
   * ride and steps off when the cart stops; `onDrop` fires at that moment.
   */
  arrive(onDrop: () => void, rider: THREE.Object3D | null = null) {
    const g = this.makeCart();
    this.w.scene.add(g);
    if (rider) {
      g.add(rider);
      rider.position.set(-0.4, 0.86, 0.55);
      rider.rotation.set(0, 0, 0);
    }
    this.trips.push({ g, t0: performance.now(), onDrop, dropped: false, rider });
  }

  /** positions of every cart on the road (walkers steer around them) */
  carts(): THREE.Vector3[] {
    return this.trips.map((t) => t.g.position);
  }

  /** world position of the newest cart (for the camera during your own arrival) */
  latest(): THREE.Vector3 | null {
    const t = this.trips[this.trips.length - 1];
    return t ? t.g.position : null;
  }

  update(now: number) {
    const ease = (x: number) => 1 - (1 - x) ** 3;
    const farZ = WORLD.gate.z + 120;
    for (const trip of [...this.trips]) {
      const t = now - trip.t0;
      const g = trip.g;
      if (t < Shuttle.IN_MS) {
        const k = ease(t / Shuttle.IN_MS);
        g.position.set(SHUTTLE_STOP.x, 0, farZ + (SHUTTLE_STOP.z - farZ) * k);
        g.rotation.y = Math.PI; // driving toward the gate (-z)
      } else if (t < Shuttle.IN_MS + Shuttle.STOP_MS) {
        g.position.set(SHUTTLE_STOP.x, 0, SHUTTLE_STOP.z);
        if (!trip.dropped) {
          trip.dropped = true;
          if (trip.rider) {
            // step off on the gate side of the cart
            this.w.scene.add(trip.rider);
            trip.rider.position.set(SHUTTLE_STOP.x - 1.7, 0, SHUTTLE_STOP.z);
            trip.rider.rotation.set(0, Math.PI, 0);
          }
          trip.onDrop?.();
        }
      } else if (t < Shuttle.IN_MS + Shuttle.STOP_MS + Shuttle.OUT_MS) {
        const k = (t - Shuttle.IN_MS - Shuttle.STOP_MS) / Shuttle.OUT_MS;
        // U-turn then drive away
        const turn = Math.min(1, k * 3);
        g.rotation.y = Math.PI - Math.PI * turn;
        g.position.set(SHUTTLE_STOP.x - 2.2 * Math.sin(turn * Math.PI), 0, SHUTTLE_STOP.z + (farZ - SHUTTLE_STOP.z) * Math.max(0, (k - 0.25) / 0.75) ** 2);
      } else {
        g.removeFromParent();
        this.trips.splice(this.trips.indexOf(trip), 1);
      }
    }
  }
}
