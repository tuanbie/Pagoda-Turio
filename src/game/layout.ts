import { HALLS, WORLD } from '@sontu/shared';

/** Client-only layout details shared by the 3D world and the minimap. */

/** Paved walkways: [x1, z1, x2, z2, width] */
export const PATHS: [number, number, number, number, number][] = [
  [0, 15, 0, 62, 4.2], // spirit way: gate → courtyard
  [0, -10, 0, -15.5, 6], // courtyard → main hall steps
  [-14, -4, -34, -12, 3], // → west hall
  [14, -4, 34, -12, 3], // → east hall
  [-12, 9, -24, 18, 2.6], // → flower garden
  [12, 9, 22, 20, 2.6], // → lotus pond
  [-15, 2, -42, 4, 2.4], // → bodhi tree
  [15, 2, 42, 4, 2.4], // → stupa
  [-6, 40, -27, 46, 2.6], // → moonlight yard
];

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const hallRect = (h: (typeof HALLS)[number], pad = 0): Rect => ({
  x0: h.x - h.w / 2 - pad,
  x1: h.x + h.w / 2 + pad,
  z0: h.z - h.d / 2 - pad,
  z1: h.z + h.d / 2 + pad,
});

export const gardenRect = (): Rect => {
  const g = WORLD.garden;
  return { x0: g.x - g.w / 2, x1: g.x + g.w / 2, z0: g.z - g.d / 2, z1: g.z + g.d / 2 };
};

export const MAP_EXTENT = 70;
