import { WORLD } from '@sontu/shared';
import type { Box, Circle } from './World.ts';

const CELL = 0.5;
const EXT = 68;
const N = Math.ceil((EXT * 2) / CELL);
const SQRT2 = Math.SQRT2;

/**
 * Grid navigation: obstacles are rasterised once (inflated by the body radius),
 * A* (8-neighbour, octile heuristic, binary heap) finds the shortest route,
 * then line-of-sight smoothing turns the staircase into a few straight legs.
 */
export class NavGrid {
  private blocked = new Uint8Array(N * N);
  private g = new Float32Array(N * N);
  private parent = new Int32Array(N * N);
  private stamp = new Uint32Array(N * N);
  private closed = new Uint32Array(N * N);
  private run = 0;

  constructor(circles: Circle[], boxes: Box[], radius = 0.35) {
    const b = this.blocked;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const [x, z] = this.pos(i, j);
        if (Math.hypot(x, z) > WORLD.radius - 0.3) b[j * N + i] = 1;
      }
    for (const c of circles) {
      const r = c.r + radius;
      this.fill(c.x - r, c.z - r, c.x + r, c.z + r, (x, z) => (x - c.x) ** 2 + (z - c.z) ** 2 < r * r);
    }
    for (const bx of boxes) this.fill(bx.x0 - radius, bx.z0 - radius, bx.x1 + radius, bx.z1 + radius, () => true);
  }

  private fill(x0: number, z0: number, x1: number, z1: number, test: (x: number, z: number) => boolean) {
    const [i0, j0] = this.cell(x0, z0);
    const [i1, j1] = this.cell(x1, z1);
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        const [x, z] = this.pos(i, j);
        if (test(x, z)) this.blocked[j * N + i] = 1;
      }
  }

  private cell(x: number, z: number): [number, number] {
    return [Math.floor((x + EXT) / CELL), Math.floor((z + EXT) / CELL)];
  }
  private pos(i: number, j: number): [number, number] {
    return [i * CELL - EXT + CELL / 2, j * CELL - EXT + CELL / 2];
  }
  private free(i: number, j: number) {
    return i >= 0 && j >= 0 && i < N && j < N && !this.blocked[j * N + i];
  }

  walkable(x: number, z: number) {
    const [i, j] = this.cell(x, z);
    return this.free(i, j);
  }

  /** Nearest free cell to (x,z), searching outward in rings. */
  private nearestFree(i: number, j: number): [number, number] | null {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 24; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.free(i + di, j + dj)) return [i + di, j + dj];
        }
    return null;
  }

  /** Straight walk between two points stays on free cells? */
  lineOfSight(x0: number, z0: number, x1: number, z1: number) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(d / (CELL * 0.5));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (!this.walkable(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  /** Shortest walkable route as waypoints (excluding the start). Null if unreachable. */
  find(sx: number, sz: number, tx: number, tz: number): { x: number; z: number }[] | null {
    if (this.lineOfSight(sx, sz, tx, tz) && this.walkable(tx, tz)) return [{ x: tx, z: tz }];
    const s = this.nearestFree(...this.cell(sx, sz));
    const t = this.nearestFree(...this.cell(tx, tz));
    if (!s || !t) return null;
    const run = ++this.run;
    const start = s[1] * N + s[0];
    const goal = t[1] * N + t[0];
    const heap = new Heap();
    const h = (k: number) => {
      const dx = Math.abs((k % N) - t[0]);
      const dz = Math.abs(Math.floor(k / N) - t[1]);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * CELL;
    };
    this.g[start] = 0;
    this.stamp[start] = run;
    this.parent[start] = -1;
    heap.push(start, h(start));
    let found = false;
    let expanded = 0;
    while (heap.size) {
      const k = heap.pop();
      if (this.closed[k] === run) continue;
      this.closed[k] = run;
      if (k === goal) {
        found = true;
        break;
      }
      if (++expanded > 60_000) break;
      const i = k % N;
      const j = (k - i) / N;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!this.free(ni, nj)) continue;
          // no corner cutting through blocked diagonals
          if (di && dj && (!this.free(i + di, j) || !this.free(i, j + dj))) continue;
          const nk = nj * N + ni;
          if (this.closed[nk] === run) continue;
          const cost = this.g[k] + (di && dj ? SQRT2 : 1) * CELL;
          if (this.stamp[nk] !== run || cost < this.g[nk]) {
            this.stamp[nk] = run;
            this.g[nk] = cost;
            this.parent[nk] = k;
            heap.push(nk, cost + h(nk));
          }
        }
    }
    if (!found) return null;
    const cells: { x: number; z: number }[] = [];
    for (let k = goal; k !== -1; k = this.parent[k]) {
      const [x, z] = this.pos(k % N, Math.floor(k / N));
      cells.push({ x, z });
    }
    cells.reverse();
    cells[cells.length - 1] = this.walkable(tx, tz) ? { x: tx, z: tz } : cells[cells.length - 1];
    // string pulling: keep only the waypoints we can't see past
    const out: { x: number; z: number }[] = [];
    let from = { x: sx, z: sz };
    let idx = 0;
    while (idx < cells.length) {
      let far = idx;
      for (let k = cells.length - 1; k > idx; k--)
        if (this.lineOfSight(from.x, from.z, cells[k].x, cells[k].z)) {
          far = k;
          break;
        }
      out.push(cells[far]);
      from = cells[far];
      idx = far + 1;
    }
    return out;
  }
}

class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number) {
    const { k, p } = this;
    let i = k.length;
    k.push(key);
    p.push(pri);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= p[i]) break;
      [k[up], k[i]] = [k[i], k[up]];
      [p[up], p[i]] = [p[i], p[up]];
      i = up;
    }
  }
  pop() {
    const { k, p } = this;
    const top = k[0];
    const lk = k.pop()!;
    const lp = p.pop()!;
    if (k.length) {
      k[0] = lk;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
