import { HALLS, PAVILIONS, WORLD, stupaHeight, type HallDef, type PavilionDef } from '@sontu/shared';
import { GROUNDS } from './layout.ts';

/** stone plinth of the service houses (you walk straight in: 0.3 m is a single step) */
export const HOUSE_FLOOR = 0.3;
/** the open kitchen's floor sits almost at ground level */
export const KITCHEN_FLOOR = 0.05;
/** low stone base of the bell / drum towers (walkable, one step) */
export const TOWER_BASE = 0.45;
export const TOWER_HALF = 2.6;

/**
 * One heightfield for everything you can stand on: ground, hall platforms and their
 * steps, the bridge over the pond and the stupa balconies. NaN = not walkable (water,
 * solid masonry). Movement and path-finding allow at most STEP_MAX between neighbours,
 * so high platforms can only be climbed by their stairs.
 */
export const STEP_MAX = 0.6;

/** Straight arched bridge across the lotus pond (west → east through the centre). */
export const BRIDGE = {
  z: WORLD.pond.z,
  x0: WORLD.pond.x - WORLD.pond.r - 2.5,
  x1: WORLD.pond.x + WORLD.pond.r + 2.5,
  w: 3.2,
  rise: 1.8,
  /** little pavilion in the middle (wider deck) */
  midW: 7,
} as const;

export function bridgeHeight(x: number, z: number): number | null {
  const b = BRIDGE;
  if (x < b.x0 || x > b.x1) return null;
  const mid = (b.x0 + b.x1) / 2;
  const half = Math.abs(x - mid) < b.midW / 2 ? b.midW / 2 : b.w / 2;
  if (Math.abs(z - b.z) > half) return null;
  const t = (x - b.x0) / (b.x1 - b.x0);
  return 0.12 + b.rise * Math.sin(Math.PI * t);
}

/** Width of the front staircase of a building (it's the only way up a tall platform). */
export const stairWidth = (b: HallDef | PavilionDef) => (b.id === 'main' ? 10 : 'cols' in b ? 6 : 4);

function platformHeight(b: HallDef | PavilionDef, x: number, z: number): number | null {
  const front = b.z + b.d / 2;
  const back = b.z - b.d / 2;
  const dx = Math.abs(x - b.x);
  // stair ramp in front of the platform
  if (dx < stairWidth(b) / 2 && z > front + 1 && z < front + 2.65) return b.h * (1 - (z - front - 1) / 1.65);
  if (dx < b.w / 2 + 1 && z > back - 1 && z <= front + 1) return b.h;
  // the main hall sits on a two-tier plinth
  if (b.id === 'main' && dx < b.w / 2 + 2 && z > back - 2 && z <= front + 2) return b.h * 0.45;
  return null;
}

export function terrainHeight(x: number, z: number): number {
  const s = stupaHeight(x, z);
  if (s !== null) return s;
  const br = bridgeHeight(x, z);
  if (br !== null) return br;
  const p = WORLD.pond;
  if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return NaN;
  for (const b of HALLS) {
    const h = platformHeight(b, x, z);
    if (h !== null) return h;
  }
  for (const b of PAVILIONS) {
    const h = platformHeight(b, x, z);
    if (h !== null) return h;
  }
  // service houses: the whole plinth (and the floor inside) is one walkable level
  for (const g of GROUNDS) if (Math.abs(x - g.x) < g.w / 2 + 0.4 && Math.abs(z - g.z) < g.d / 2 + 0.4) return g.id === 'kitchen' ? KITCHEN_FLOOR : HOUSE_FLOOR;
  for (const t of [WORLD.bellTower, WORLD.drumTower]) if (Math.abs(x - t.x) < TOWER_HALF && Math.abs(z - t.z) < TOWER_HALF) return TOWER_BASE;
  return 0;
}

/** Safe version for rendering (never NaN). */
export const groundY = (x: number, z: number) => {
  const h = terrainHeight(x, z);
  return Number.isNaN(h) ? 0 : h;
};
