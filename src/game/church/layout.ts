import { CHURCH, INCENSE_SLOTS, type CenserDef } from '@sontu/shared';

/**
 * Client-side layout of the church grounds (the server only knows seats, candle stands and
 * the spawn point from shared/church.ts). Metres, +z = south; the altar end is north.
 */
export const C = CHURCH;

/** outer aisle walls, transept ends, choir walls, apse radius (inner faces) */
export const AISLE_X = 16;
export const TRANSEPT_X = C.transept.w / 2; // 23
export const NAVE_Z0 = C.nave.z0; // -40 (crossing starts)
export const CROSS_Z0 = C.transept.z - C.transept.d / 2; // -52
export const CHOIR_X = 11;
export const APSE_Z = C.apse.z; // -58
export const APSE_R = C.apse.r; // 11
export const WALL_T = 1.2;

/** side door in the east aisle wall, toward the cloister */
export const SIDE_DOOR = { z: -27.5, half: 1.0 };
/** west door (main portal) half width */
export const DOOR_HALF = 2.6;
/** sanctuary (choir + apse) is raised by this much above the church floor */
export const SANCTUARY_RISE = 0.45;
/** bench seat height above the floor it stands on */
export const PEW_TOP = 0.45;

/** churchyard: low wall around this rectangle, gate on the south side at C.gate */
export const YARD = { x0: -88, x1: 88, z0: -96, z1: 100 };

export function inChurch(x: number, z: number): boolean {
  const ax = Math.abs(x);
  if (z <= 0.6 && z >= NAVE_Z0 && ax <= AISLE_X) return true;
  if (z < NAVE_Z0 && z >= CROSS_Z0 && ax <= TRANSEPT_X) return true;
  if (z < CROSS_Z0 && z >= APSE_Z && ax <= CHOIR_X) return true;
  if (z < APSE_Z && Math.hypot(x, z - APSE_Z) <= APSE_R) return true;
  return false;
}

/** three equal steps between h0 (at t=0) and h1 (at t=1) */
const steps = (h0: number, h1: number, t: number) => h0 + (h1 - h0) * (t >= 1 ? 1 : Math.floor(Math.max(0, t) * 3) / 3);

/** Walkable height at (x, z). Walls are colliders, so this only models floors and steps. */
export function churchHeight(x: number, z: number): number {
  const f = C.floorH;
  if (inChurch(x, z)) {
    if (z < CROSS_Z0 - 0.0) return f + SANCTUARY_RISE;
    // three steps up to the sanctuary across the north edge of the crossing (treads are 0.4 deep, 20 m wide)
    if (z < CROSS_Z0 + 1.2 && Math.abs(x) < CHOIR_X - 1) return steps(f + SANCTUARY_RISE, f, (z - CROSS_Z0) / 1.2);
    return f;
  }
  // west steps down to the plaza
  if (z > 0.6 && z < 2.4 && Math.abs(x) < 6) return steps(f, 0, (z - 0.6) / 1.8);
  // side door steps toward the cloister (the plinth runs to x 17.2, then treads at 17.2 / 17.8 / 18.4)
  if (Math.abs(z - SIDE_DOOR.z) < SIDE_DOOR.half + 0.4 && x > AISLE_X && x < AISLE_X + 2.4) return steps(f, 0, (x - AISLE_X - 0.6) / 1.8);
  // sacristy doorway in the east transept end wall at church-floor height, then three steps down inside
  if (Math.abs(z + 44) < 1.4 && x > TRANSEPT_X && x < TRANSEPT_X + WALL_T + 1.8) return steps(f, 0, (x - TRANSEPT_X - WALL_T) / 1.8);
  return 0;
}

/** Candle spot inside a stand's 3-tier rack: [dx, dy, dz] before the stand's scale. */
export function candleSpot(slot: number): [number, number, number] {
  const perTier = INCENSE_SLOTS / 3;
  const tier = Math.floor(slot / perTier);
  const i = slot % perTier;
  return [(i - (perTier - 1) / 2) * 0.115, tier * 0.12, -tier * 0.14 + 0.14];
}
export const candleBase = (c: CenserDef, slot: number): [number, number, number] => {
  const [dx, dy, dz] = candleSpot(slot);
  return [c.x + dx * c.scale * 1.25, c.y + dy, c.z + dz];
};
