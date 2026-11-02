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
