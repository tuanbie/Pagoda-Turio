import { HALLS, PAVILIONS, WORLD, type HallDef, type PavilionDef } from '@sontu/shared';

/** x of the east end of the pond bridge (see terrain.ts BRIDGE) */
const B_EAST = WORLD.pond.x + WORLD.pond.r + 2.3;

/** Client-only layout details shared by the 3D world and the minimap. */

/** Paved walkways: [x1, z1, x2, z2, width] */
export const PATHS: [number, number, number, number, number][] = [
  // every branch starts INSIDE the spirit way / courtyard and ends ON a stair, bridge or plaza
  [0, -6, 0, 136, 5], // spirit way: courtyard → gate → shuttle stop
  [0, -34, 0, -43.6, 9], // courtyard → main hall stairs
  [-14, -28, -50, -37.6, 4], // → Avalokiteśvara hall stairs
  [14, -28, 50, -37.6, 4], // → Medicine Buddha hall stairs
  [-14, -16, -88, -10.6, 3.6], // → Kṣitigarbha hall stairs
  [14, -16, 88, -10.6, 3.6], // → Maitreya hall stairs
  [-1.5, 14, -24, 20, 3], // spirit way → flower garden
  [-49, 20, -98.5, 8.4, 2.6], // garden → Bodhi tree
  [-1.5, 44, -60, 44.6, 3], // spirit way → discussion hall stairs
  [-60, 44.6, -80, 40.8, 3], // discussion hall → stupa stair foot
  [1.5, 18, 13.8, 34, 3], // spirit way → west end of the pond bridge
  [B_EAST, 34, 72, 46, 3], // east end of the bridge → junction
  [1.5, 64, 72, 58, 3], // spirit way → east junction (stays clear of the pond)
  [72, 46, 72, 58, 3], // junction link
  [72, 46, 92, 38.6, 3], // → game hall stairs
  [72, 58, 70, 90.6, 3], // → tea house stairs
  [-1.5, 84, -28.5, 90.5, 2.8], // spirit way → moonlight yard
  // client-only grounds (see GROUNDS below)
  [1.5, 88, 20.5, 90, 3], // spirit way → wish tree plaza
  [-69.5, -12, -69.5, -72, 2.6], // west service lane (behind the halls)
  [-69.5, -72, -50, -77.4, 2.6], // → kitchen
  [-69.5, -50, -83, -50.6, 2.6], // → storehouse
  [69.5, -12, 69.5, -72, 2.6], // east service lane
  [69.5, -72, 50, -77.4, 2.6], // → residence
  [69.5, -50, 83, -50.6, 2.6], // → sleeping quarters
];


export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const hallRect = (h: HallDef | PavilionDef, pad = 0): Rect => ({
  x0: h.x - h.w / 2 - pad,
  x1: h.x + h.w / 2 + pad,
  z0: h.z - h.d / 2 - pad,
  z1: h.z + h.d / 2 + pad,
});

export const gardenRect = (): Rect => {
  const g = WORLD.garden;
  return { x0: g.x - g.w / 2, x1: g.x + g.w / 2, z0: g.z - g.d / 2, z1: g.z + g.d / 2 };
};

/** every building footprint (halls + pavilions) */
export const BUILDINGS: readonly (HallDef | PavilionDef)[] = [...HALLS, ...PAVILIONS];

export const MAP_EXTENT = 136;

/**
 * Buildings that exist only on the client (the server never checks the layout). They are
 * NOT in shared HALLS / PAVILIONS on purpose: seats and censers are derived from those lists,
 * and a new entry would shift their indices against the running server.
 * All face south (+z); `front` = z + d/2.
 */
export interface GroundsDef {
  id: 'kitchen' | 'store' | 'residence' | 'dorm';
  x: number;
  z: number;
  w: number;
  d: number;
}
export const GROUNDS: readonly GroundsDef[] = [
  { id: 'kitchen', x: -50, z: -82, w: 14, d: 9 },
  { id: 'store', x: -88, z: -55, w: 10, d: 8 },
  { id: 'residence', x: 50, z: -82, w: 14, d: 9 },
  { id: 'dorm', x: 88, z: -55, w: 14, d: 8 },
];
export const groundsRect = (g: GroundsDef, pad = 0): Rect => ({ x0: g.x - g.w / 2 - pad, x1: g.x + g.w / 2 + pad, z0: g.z - g.d / 2 - pad, z1: g.z + g.d / 2 + pad });
export const grounds = (id: GroundsDef['id']) => GROUNDS.find((g) => g.id === id)!;

/** Wish tree plaza with the proverb-stick altar and the riddle table. */
export const WISH = { x: 28, z: 90, r: 8.5 };
export const STICKS = { x: 22.6, z: 95.6 };
export const RIDDLE = { x: 34.2, z: 95.2 };
/** where a visitor stands for each (south of the thing, facing north) */
export const SPOTS = {
  wish: { x: WISH.x, z: WISH.z + 3.1 },
  sticks: { x: STICKS.x, z: STICKS.z + 1.25 },
  riddle: { x: RIDDLE.x, z: RIDDLE.z + 1.55 },
} as const;
