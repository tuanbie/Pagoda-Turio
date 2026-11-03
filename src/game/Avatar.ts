import * as THREE from 'three';
import { Pose } from '@sontu/shared';

const ROBE_TINTS = ['#8b7f6c', '#9a8770', '#7d7466', '#a08a6a', '#8a8378', '#97806a'];
const SKIN = '#f0cfae';

/**
 * Character detail tier (follows the graphics setting).
 * - low:    the classic little monk with fewer segments and fewer shadow casters
 * - medium: the classic little monk (unchanged look)
 * - high:   skinned procedural figure: smooth shading, soft face (eyes, brows, nose, ears),
 *           hands with a thumb, pleated robe + sash, sandals, full procedural locomotion
 * - ultra:  human proportions (~7.5 heads), sculpted head, blinking eyelids, lips, jointed
 *           fingers, layered robe / kasaya with drape folds and hem sway, skin + cloth sheen.
 *           Far away (see setLod) it falls back to the high mesh on the same skeleton.
 */
export type AvatarDetail = 'low' | 'medium' | 'high' | 'ultra';
let defaultDetail: AvatarDetail = 'medium';
/** Tier used by avatars created without an explicit `detail` option. Call before creating avatars. */
export function setAvatarDetail(d: AvatarDetail) {
  defaultDetail = d;
}
export function getAvatarDetail(): AvatarDetail {
  return defaultDetail;
}

/** Classic (low / medium) geometry. `seg` scales the tessellation. */
function classicGeometry(lowPoly: boolean) {
  const n = (hi: number, lo: number) => (lowPoly ? lo : hi);
  const lower = new THREE.LatheGeometry(
    [
      [0, 0.04],
      [0.33, 0.04],
      [0.35, 0.12],
      [0.29, 0.5],
      [0.23, 0.9],
      [0, 0.92],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    n(16, 9),
  );
  const upper = new THREE.LatheGeometry(
    [
      [0, -0.02],
      [0.24, -0.02],
      [0.23, 0.25],
      [0.21, 0.4],
      [0.1, 0.48],
      [0, 0.49],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    n(16, 9),
  );
  const arm = new THREE.CapsuleGeometry(0.075, 0.32, n(3, 1), n(8, 5));
  arm.translate(0, -0.24, 0);
  const hand = new THREE.SphereGeometry(0.055, n(8, 5), n(6, 4));
  hand.translate(0, -0.47, 0);
  const head = new THREE.SphereGeometry(0.17, n(18, 10), n(14, 8));
  const ear = new THREE.SphereGeometry(0.045, n(6, 4), n(5, 3)).scale(0.5, 1, 0.8);
  const eye = new THREE.SphereGeometry(0.018, n(6, 4), n(4, 3));
  const foot = new THREE.SphereGeometry(0.08, n(8, 5), n(6, 4)).scale(0.9, 0.55, 1.5);
  const sash = new THREE.BoxGeometry(0.09, 0.62, 0.02);
  return { lower, upper, arm, hand, head, ear, eye, foot, sash };
}

// Geometry and materials are shared by every avatar → 100 visitors cost almost no extra memory.
const shared = (() => {
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const std = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  return {
    ...classicGeometry(false),
    shadow: new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2),
    skin: std(SKIN),
    eyeMat: new THREE.MeshBasicMaterial({ color: '#2b211b' }),
    shoe: std('#3a2c22'),
    robes: ROBE_TINTS.map(std),
    selfRobe: std('#b98a4e'),
    sashMat: std('#7a3b22'),
    shadowMat: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    ring: new THREE.RingGeometry(0.42, 0.48, 32).rotateX(-Math.PI / 2),
    ringMat: new THREE.MeshBasicMaterial({ color: '#e6c27a', transparent: true, opacity: 0.8 }),
  };
})();
type ClassicGeo = ReturnType<typeof classicGeometry>;
let lowGeo: ClassicGeo | null = null;

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Text sprite drawn on a canvas (name tag or chat bubble). */
function textSprite(text: string, bubble: boolean): THREE.Sprite {
  const font = bubble ? 30 : 26;
  const pad = bubble ? 18 : 12;
  const maxW = 420;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const family = `500 ${font}px "Be Vietnam Pro", "Noto Sans Lao", "Noto Sans Khmer", sans-serif`;
  g.font = family;
  // simple word wrap (falls back to char wrap for scripts without spaces)
  const lines: string[] = [];
  let line = '';
  for (const ch of bubble ? Array.from(text) : [text]) {
    const test = line + ch;
    if (bubble && g.measureText(test).width > maxW && line) {
      const cut = line.lastIndexOf(' ');
      if (cut > 0 && ch !== ' ') {
        lines.push(line.slice(0, cut));
        line = line.slice(cut + 1) + ch;
      } else {
        lines.push(line);
        line = ch === ' ' ? '' : ch;
      }
    } else line = test;
  }
  lines.push(line);
  const shown = lines.slice(0, 4);
  const w = Math.min(maxW, Math.max(...shown.map((l) => g.measureText(l).width))) + pad * 2;
  const lh = font * 1.3;
  const h = shown.length * lh + pad * (bubble ? 1.6 : 1.1) + (bubble ? 14 : 0);
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  g.font = family;
  g.fillStyle = bubble ? 'rgba(250,247,238,0.95)' : 'rgba(24,26,21,0.62)';
  const r = bubble ? 18 : h / 2.4;
  const bh = bubble ? h - 14 : h;
  g.beginPath();
  g.roundRect(0, 0, w, bh, r);
  if (bubble) {
    g.moveTo(w / 2 - 12, bh);
    g.lineTo(w / 2, h);
    g.lineTo(w / 2 + 12, bh);
  }
  g.fill();
  g.fillStyle = bubble ? '#2a2620' : '#f6f1e4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  shown.forEach((l, i) => g.fillText(l, w / 2, pad * (bubble ? 0.8 : 0.55) + lh * (i + 0.5)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const k = 0.0042;
  s.scale.set(c.width * k, c.height * k, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

/** Robes for the computer-controlled novice monks (chú tiểu): brown-grey, darker sash. */
const novice = (() => {
  const std = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  return { robe: std('#7c6b55'), sash: std('#4f3f2e') };
})();

/**
 * Hand-held props, built once on first use and shared by every avatar that needs them
 * (geometry + materials); each avatar only adds cheap Mesh instances. Coordinates are
 * relative to the hand, so a prop turns around the grip, not around the shoulder.
 */
type PropName = 'broom' | 'cloth' | 'ladle' | 'mallet' | 'can' | 'sack' | 'incense' | 'tube' | 'bud' | 'card' | 'teapot' | 'cup' | 'stream';
type Part = [THREE.BufferGeometry, THREE.Material, number, number, number, number?];
const HAND = new THREE.Vector3(0, -0.48, 0.04);
let propKit: Record<PropName, Part[]> | null = null;
function makeProp(name: PropName, onTorso: boolean): THREE.Object3D {
  if (!propKit) {
    const m = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
    const wood = m('#8a6440');
    const porcelain = m('#f3efe6', { roughness: 0.35 });
    const bamboo = m('#b89b5c');
    const tin = m('#7f8c8a', { metalness: 0.5, roughness: 0.45 });
    const stick = m('#7a3b22');
    const glow = new THREE.MeshBasicMaterial({ color: '#ff8a3a' });
    const stickG = new THREE.CylinderGeometry(0.006, 0.006, 0.34, 4).translate(0, 0.17, 0);
    const tipG = new THREE.SphereGeometry(0.012, 5, 4);
    propKit = {
      // long bamboo broom gripped near the top: bristles end up by the feet
      broom: [
        [new THREE.CylinderGeometry(0.014, 0.014, 1.1, 6), wood, 0, -0.42, 0.06, 0.12],
        [new THREE.ConeGeometry(0.13, 0.36, 8, 1, true), m('#c9a55e', { side: THREE.DoubleSide }), 0, -1.02, 0.13, 0.12],
      ],
      cloth: [[new THREE.BoxGeometry(0.12, 0.02, 0.1), m('#d8d2c2'), 0, -0.03, 0.02]],
      ladle: [
        [new THREE.CylinderGeometry(0.01, 0.01, 0.62, 5), wood, 0, -0.24, 0.06, 0.45],
        [new THREE.SphereGeometry(0.05, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), wood, 0, -0.52, 0.19],
      ],
      mallet: [
        [new THREE.CylinderGeometry(0.012, 0.012, 0.26, 5), wood, 0, -0.04, 0.08, 1.2],
        [new THREE.SphereGeometry(0.036, 8, 6), m('#5a3a22'), 0, -0.09, 0.2],
      ],
      can: [
        [new THREE.CylinderGeometry(0.07, 0.08, 0.16, 10), tin, 0, -0.1, 0.02],
        [new THREE.CylinderGeometry(0.01, 0.016, 0.22, 5), tin, 0, -0.08, 0.14, 1.0],
      ],
      sack: [[new THREE.SphereGeometry(0.2, 10, 8).scale(1.25, 0.75, 0.85), m('#cbb994'), 0.16, 0.5, -0.02]],
      incense: [
        [stickG, stick, -0.012, 0, 0.02],
        [stickG, stick, 0, 0, 0.02],
        [stickG, stick, 0.012, 0, 0.02],
        [tipG, glow, -0.012, 0.34, 0.02],
        [tipG, glow, 0, 0.34, 0.02],
        [tipG, glow, 0.012, 0.34, 0.02],
      ],
      tube: [
        [new THREE.CylinderGeometry(0.05, 0.05, 0.26, 10, 1, true), m('#b89b5c', { side: THREE.DoubleSide }), 0, 0.02, 0.04],
        [new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8), m('#c8b38a'), 0, 0.18, 0.04],
      ],
      bud: [
        [new THREE.BoxGeometry(0.07, 0.1, 0.012), m('#b3261e', { emissive: '#3a0805' }), 0, -0.05, 0.02],
        [new THREE.BoxGeometry(0.05, 0.012, 0.013), m('#d9b26a', { metalness: 0.6, roughness: 0.4 }), 0, -0.02, 0.02],
      ],
      card: [[new THREE.BoxGeometry(0.03, 0.24, 0.006), bamboo, 0, 0.06, 0.03]],
      teapot: [
        [new THREE.SphereGeometry(0.09, 12, 8).scale(1, 0.8, 1), porcelain, 0, -0.04, 0.01],
        [new THREE.ConeGeometry(0.022, 0.11, 6), porcelain, 0, -0.03, 0.11, 1.1],
        [new THREE.SphereGeometry(0.03, 8, 6), porcelain, 0, 0.035, 0.01],
      ],
      cup: [[new THREE.CylinderGeometry(0.04, 0.03, 0.06, 10), porcelain, 0, -0.01, 0]],
      // the tea stream falling into the cup (shown only while pouring)
      stream: [[new THREE.CylinderGeometry(0.006, 0.004, 0.2, 5), new THREE.MeshStandardMaterial({ color: '#c8a56a', transparent: true, opacity: 0.7, roughness: 0.1 }), 0, 0.13, 0]],
    };
  }
  const grp = new THREE.Group();
  if (!onTorso) grp.position.copy(HAND);
  for (const [geo, mat, x, y, z, rx = 0] of propKit[name]) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
    grp.add(mesh);
  }
  return grp;
}

/**
 * Local gestures: played only on this client (never sent to the server, whose Pose list
 * is fixed). NPC chores, and my own short actions at the wish tree / stick tube / riddles.
 */
export type Action = 'sweep' | 'wipe' | 'stir' | 'prep' | 'ringBell' | 'moktak' | 'water' | 'carry' | 'pick' | 'shake' | 'think' | 'read';
const ACTION_PROPS: [Action, PropName, 'L' | 'R' | 'T'][] = [
  ['sweep', 'broom', 'R'],
  ['wipe', 'cloth', 'R'],
  ['stir', 'ladle', 'R'],
  ['moktak', 'mallet', 'R'],
  ['water', 'can', 'R'],
  ['carry', 'sack', 'T'],
  ['shake', 'tube', 'R'],
  ['read', 'card', 'R'],
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 → 1 → 0 bump over [a, b] with eased edges of width e */
const window01 = (x: number, a: number, b: number, e: number) => smooth(clamp01((x - a) / e)) * (1 - smooth(clamp01((x - (b - e)) / e)));

type State = { bodyY: number; bend: number; lx: number; lz: number; rx: number; rz: number; sway: number; squash: number; nod: number; walk: number; look: number; hip: number };
const KEYS: (keyof State)[] = ['bodyY', 'bend', 'lx', 'lz', 'rx', 'rz', 'sway', 'squash', 'nod', 'walk', 'look', 'hip'];
/** one scratch target for every avatar: animate() allocates nothing per frame */
const T: State = { bodyY: 0, bend: 0, lx: 0, lz: 0, rx: 0, rz: 0, sway: 0, squash: 1, nod: 0, walk: 0, look: 0, hip: 0 };
const arms = (lx: number, lz: number, rx: number, rz: number) => {
  T.lx = lx;
  T.lz = lz;
  T.rx = rx;
  T.rz = rz;
};

// =====================================================================================
// HIGH / ULTRA: one procedural skeleton per avatar, every body part rigid- (or blend-)
// skinned into ONE merged SkinnedMesh per material (≈5 draw calls per avatar), with
// geometry shared by all avatars of a tier. Motion is fully procedural: critically-damped
// springs on every pose channel, 2-bone IK for arms and legs, distance-driven gait.
// =====================================================================================

type V3 = [number, number, number];
type Style = 'U' | 'H';
type MatKind = 'skin' | 'eye' | 'robe' | 'sash' | 'dark';
const MAT_KINDS: MatKind[] = ['skin', 'eye', 'robe', 'sash', 'dark'];

interface Dims {
  name: string;
  ankle: number;
  shin: number;
  thigh: number;
  hipW: number;
  /** pelvis → spine (waist) → chest → neck → head bone offsets */
  p2s: number;
  s2c: number;
  c2n: number;
  n2h: number;
  /** head centre relative to the head bone, and its semi-axes */
  headC: V3;
  headA: V3;
  /** shoulder joint relative to the chest bone */
  sh: V3;
  upper: number;
  fore: number;
  palm: number;
  finger: number;
  /** upper robe rings [world y, rx, rz] */
  torso: V3[];
  /** skirt rings [world y, r] (z radius = r * skirtZ) */
  skirt: [number, number][];
  skirtZ: number;
  footLen: number;
  sleeve: number;
  neckR: number;
  eyeR: number;
  ear: number;
  /** 0..1 how pronounced the facial sculpt is */
  real: number;
}

/** real human proportions: ~1.70 m, head 0.228 m → 7.5 heads */
const ULTRA_DIMS: Dims = {
  name: 'u',
  ankle: 0.075,
  shin: 0.4,
  thigh: 0.43,
  hipW: 0.088,
  p2s: 0.11,
  s2c: 0.2,
  c2n: 0.2,
  n2h: 0.085,
  headC: [0, 0.085, 0.012],
  headA: [0.078, 0.11, 0.097],
  sh: [0.172, 0.165, -0.01],
  upper: 0.29,
  fore: 0.255,
  palm: 0.092,
  finger: 0.085,
  torso: [
    [0.97, 0.152, 0.114],
    [1.03, 0.146, 0.108],
    [1.12, 0.152, 0.11],
    [1.22, 0.166, 0.118],
    [1.31, 0.176, 0.12],
    [1.365, 0.168, 0.112],
    [1.405, 0.13, 0.095],
    [1.435, 0.075, 0.068],
    [1.45, 0.058, 0.056],
  ],
  skirt: [
    [1.035, 0.15],
    [0.96, 0.17],
    [0.86, 0.185],
    [0.62, 0.2],
    [0.36, 0.222],
    [0.11, 0.248],
    [0.088, 0.24],
  ],
  skirtZ: 0.86,
  footLen: 0.24,
  sleeve: 0.078,
  neckR: 0.055,
  eyeR: 0.0122,
  ear: 1,
  real: 1,
};

/** stylised (≈5.4 heads) but smooth figure for the high tier */
const HIGH_DIMS: Dims = {
  name: 'h',
  ankle: 0.07,
  shin: 0.32,
  thigh: 0.35,
  hipW: 0.085,
  p2s: 0.1,
  s2c: 0.17,
  c2n: 0.17,
  n2h: 0.06,
  headC: [0, 0.15, 0.01],
  headA: [0.15, 0.165, 0.152],
  sh: [0.19, 0.14, -0.01],
  upper: 0.25,
  fore: 0.21,
  palm: 0.08,
  finger: 0.07,
  torso: [
    [0.8, 0.172, 0.136],
    [0.86, 0.166, 0.13],
    [0.95, 0.176, 0.135],
    [1.04, 0.19, 0.142],
    [1.11, 0.196, 0.142],
    [1.155, 0.172, 0.126],
    [1.19, 0.11, 0.09],
    [1.205, 0.07, 0.065],
  ],
  skirt: [
    [0.86, 0.168],
    [0.78, 0.19],
    [0.6, 0.215],
    [0.35, 0.24],
    [0.1, 0.268],
    [0.08, 0.26],
  ],
  skirtZ: 0.88,
  footLen: 0.22,
  sleeve: 0.085,
  neckR: 0.058,
  eyeR: 0.02,
  ear: 1.6,
  real: 0.5,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampN = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
/** smoothstep from a to b (a > b gives a falling edge) */
const sstep = (a: number, b: number, x: number) => {
  const u = (x - a) / (b - a);
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
};
const gauss = (u: number, v: number, su: number, sv: number) => Math.exp(-(u * u) / (su * su) - (v * v) / (sv * sv));

/** heights of the joints in the rest pose (world y, feet on y = 0) */
function heights(D: Dims) {
  const hip = D.ankle + D.shin + D.thigh;
  const spine = hip + D.p2s;
  const chest = spine + D.s2c;
  const neck = chest + D.c2n;
  const head = neck + D.n2h;
  return { hip, spine, chest, neck, head, shoulder: chest + D.sh[1] };
}

/** Landmarks in chest space used to aim the hands (anjali, mouth, chin...). */
interface Land {
  shX: number;
  shY: number;
  shZ: number;
  reach: number;
  /** arm-length scale relative to the ultra figure */
  k: number;
  /** leg-length scale relative to the ultra figure */
  lk: number;
  front: number;
  sternY: number;
  mouthY: number;
  mouthZ: number;
  chinY: number;
  chinZ: number;
  browY: number;
  browZ: number;
  lapY: number;
  hipY: number;
}
function landmarks(D: Dims): Land {
  const H = heights(D);
  const reach = D.upper + D.fore;
  const k = reach / 0.545;
  const hcY = D.c2n + D.n2h + D.headC[1];
  const hcZ = D.headC[2];
  const [, ay, az] = D.headA;
  let front = D.torso[0][2];
  for (let i = 0; i < D.torso.length - 1; i++) {
    const [y0, , z0] = D.torso[i];
    const [y1, , z1] = D.torso[i + 1];
    if (H.chest >= y0 && H.chest <= y1) front = lerp(z0, z1, (H.chest - y0) / (y1 - y0));
  }
  return {
    shX: D.sh[0],
    shY: D.sh[1],
    shZ: D.sh[2],
    reach,
    k,
    lk: (D.thigh + D.shin) / 0.83,
    front,
    sternY: D.sh[1] - 0.12 * k,
    mouthY: hcY - 0.56 * ay,
    mouthZ: hcZ + az * 0.92,
    chinY: hcY - 0.86 * ay,
    chinZ: hcZ + az * 0.62,
    browY: hcY + 0.3 * ay,
    browZ: hcZ + az * 0.95,
    lapY: -(D.p2s + D.s2c) + 0.03,
    hipY: H.hip,
  };
}

/** Sculpted head: unit-sphere direction → point relative to the head centre. */
function sculpt(D: Dims, x: number, y: number, z: number, out: THREE.Vector3) {
  const [ax, ay, az] = D.headA;
  const r = D.real;
  const low = Math.max(0, -y);
  // gentle jaw taper (a V-chin reads as cartoon), fuller back of the skull, flatter face plane
  const sx = (1 - (0.14 * r + 0.08) * low * low) * (1 + 0.06 * r * sstep(-0.1, 0.45, y) * sstep(1, 0.7, y));
  const back = z < 0 ? 1.04 + 0.05 * Math.max(0, y) : 1;
  const front = sstep(0.3, 0.85, z);
  const X = Math.abs(x);
  // nose: narrow bridge between the eyes growing to a rounded tip, plus nostril wings
  const along = sstep(0.04, -0.3, y) * sstep(-0.44, -0.34, y);
  const nose = (0.035 + 0.12 * sstep(0.02, -0.3, y)) * along * gauss(x, 0, lerp(0.05, 0.1, sstep(0, -0.3, y)), 1) + 0.045 * gauss(X - 0.085, y + 0.33, 0.06, 0.045);
  const d =
    nose * (r > 0.75 ? 1 : 0.55) +
    0.05 * gauss(X, y - 0.24, 0.5, 0.06) - // brow ridge
    0.075 * gauss(X - 0.36, y - 0.04, 0.13, 0.09) + // eye sockets
    0.035 * gauss(X - 0.5, y + 0.17, 0.14, 0.1) + // cheekbones
    0.04 * gauss(x, y + 0.53, 0.19, 0.05) + // upper lip
    0.035 * gauss(x, y + 0.6, 0.17, 0.045) - // lower lip
    0.03 * gauss(x, y + 0.565, 0.17, 0.012) - // mouth line
    0.03 * gauss(x, y + 0.7, 0.2, 0.04) + // under the lower lip
    0.06 * gauss(x, y + 0.83, 0.2, 0.09); // chin
  // the lower face is a near-vertical plane, not the ellipsoid's receding curve
  const plane = 1 + (r > 0.75 ? 0.5 : 0.1) * low ** 1.2 * gauss(x, 0, 0.6, 1) * sstep(0, 0.4, z);
  out.set(x * ax * sx, y * ay, z * az * back * plane * (1 - 0.08 * r * front * (1 - low)) + d * az * front * r);
  return out;
}

// ---- skeleton -------------------------------------------------------------------------
const SIDES = ['L', 'R'] as const;
const FINGER_Z = [0.024, 0.008, -0.008, -0.023];
const FINGER_LEN = [0.95, 1.04, 0.97, 0.78];
const FINGER_SEG = [0.45, 0.31, 0.24];
const BONE_NAMES: string[] = (() => {
  const n = ['body', 'pelvis', 'hem', 'spine', 'chest', 'neck', 'head', 'eyeL', 'eyeR', 'lidUL', 'lidUR', 'lidLL', 'lidLR'];
  for (const s of SIDES) {
    n.push('sh' + s, 'el' + s, 'wr' + s);
    for (let i = 0; i < 4; i++) for (const j of ['a', 'b', 'c']) n.push(`f${i}${j}${s}`);
    for (let j = 0; j < 3; j++) n.push(`t${j}${s}`);
  }
  for (const s of SIDES) n.push('th' + s, 'kn' + s, 'ft' + s, 'to' + s);
  return n;
})();
const BI: Record<string, number> = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));

function eyeCentre(D: Dims, sgn: number, out: THREE.Vector3) {
  const n = new THREE.Vector3(sgn * 0.36, 0.035, 0.93).normalize();
  sculpt(D, n.x, n.y, n.z, out);
  out.z -= D.eyeR * (D.real > 0.75 ? 0.45 : 0.25);
  return out.add(new THREE.Vector3(...D.headC));
}

interface Rig {
  bones: THREE.Bone[];
  by: Record<string, THREE.Bone>;
}
function makeRig(D: Dims): Rig {
  const by: Record<string, THREE.Bone> = {};
  const bones = BONE_NAMES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    by[name] = b;
    return b;
  });
  const put = (name: string, parent: string | null, x: number, y: number, z: number) => {
    by[name].position.set(x, y, z);
    if (parent) by[parent].add(by[name]);
  };
  const H = heights(D);
  put('body', null, 0, 0, 0);
  put('pelvis', 'body', 0, H.hip, 0);
  put('hem', 'pelvis', 0, 0, 0);
  put('spine', 'pelvis', 0, D.p2s, 0);
  put('chest', 'spine', 0, D.s2c, 0);
  put('neck', 'chest', 0, D.c2n, -0.01);
  put('head', 'neck', 0, D.n2h, 0.01);
  for (const [i, s] of SIDES.entries()) {
    const sgn = i === 0 ? 1 : -1;
    const e = eyeCentre(D, sgn, new THREE.Vector3());
    put('eye' + s, 'head', e.x, e.y, e.z);
    put('lidU' + s, 'head', e.x, e.y, e.z);
    put('lidL' + s, 'head', e.x, e.y, e.z);
    put('sh' + s, 'chest', sgn * D.sh[0], D.sh[1], D.sh[2]);
    put('el' + s, 'sh' + s, 0, -D.upper, 0);
    put('wr' + s, 'el' + s, 0, -D.fore, 0);
    const hs = D.palm / 0.092;
    for (let f = 0; f < 4; f++) {
      const len = D.finger * FINGER_LEN[f];
      put(`f${f}a${s}`, 'wr' + s, 0, -D.palm + [0, 0, 0.002, 0.008][f] * hs, FINGER_Z[f] * hs);
      put(`f${f}b${s}`, `f${f}a${s}`, 0, -len * FINGER_SEG[0], 0);
      put(`f${f}c${s}`, `f${f}b${s}`, 0, -len * FINGER_SEG[1], 0);
    }
    put('t0' + s, 'wr' + s, -sgn * 0.01 * hs, -0.018 * hs, 0.022 * hs);
    by['t0' + s].rotation.set(-0.55, 0, -sgn * 0.3);
    put('t1' + s, 't0' + s, 0, -0.04 * hs, 0);
    put('t2' + s, 't1' + s, 0, -0.032 * hs, 0);
    put('th' + s, 'pelvis', sgn * D.hipW, 0, 0);
    put('kn' + s, 'th' + s, 0, -D.thigh, 0);
    put('ft' + s, 'kn' + s, 0, -D.shin, 0);
    put('to' + s, 'ft' + s, 0, -D.ankle * 0.7, D.footLen * 0.56);
  }
  for (const n of ['pelvis', 'spine', 'chest', 'neck', 'head']) by[n].rotation.order = 'YXZ';
  return { bones, by };
}

// ---- geometry helpers (build time only) -----------------------------------------------
interface TubeOpts {
  zs?: number;
  pleats?: number;
  amp?: (t: number) => number;
  ao?: number;
  warp?: (p: THREE.Vector3, th: number, t: number) => void;
}
/** Ring-stacked surface (lathe with elliptic rings, drape pleats and fold occlusion in vertex colours). */
function tube(rings: number[][], radial: number, o: TubeOpts = {}) {
  const nr = rings.length;
  const pos = new Float32Array(nr * radial * 3);
  const col = new Float32Array(nr * radial * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < nr; i++) {
    const [y, rx, rz0] = rings[i];
    const rz = (rz0 ?? rx) * (o.zs ?? 1);
    const t = nr > 1 ? i / (nr - 1) : 0;
    const amp = o.amp ? o.amp(t) : 0;
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const n = o.pleats ?? 0;
      const pl = n ? 0.65 * Math.sin(th * n + 0.4) + 0.35 * Math.sin(th * n * 1.73 + 1.3 + t * 2) : 0;
      const k = 1 + amp * pl;
      p.set(Math.sin(th) * rx * k, y, Math.cos(th) * rz * k);
      o.warp?.(p, th, t);
      const q = (i * radial + j) * 3;
      pos[q] = p.x;
      pos[q + 1] = p.y;
      pos[q + 2] = p.z;
      const shade = 1 - (o.ao ?? 0) * Math.min(1, amp * 9) * (0.5 - 0.5 * pl);
      col[q] = col[q + 1] = col[q + 2] = shade;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nr - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** recompute normals and average them across coincident (seam) vertices */
function smoothNormals(g: THREE.BufferGeometry) {
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    const l = groups.get(key);
    if (l) l.push(i);
    else groups.set(key, [i]);
  }
  const n = new THREE.Vector3();
  for (const l of groups.values()) {
    if (l.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of l) n.x += nor.getX(i), (n.y += nor.getY(i)), (n.z += nor.getZ(i));
    n.normalize();
    for (const i of l) nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

const ell = (sx: number, sy: number, sz: number, w = 10, h = 8) => new THREE.SphereGeometry(1, w, h).scale(sx, sy, sz);
/** capsule hanging from the bone origin down -y */
const limb = (r: number, len: number, radial = 6, cap = 2) =>
  new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), cap, radial).translate(0, -len / 2, 0);

type Weights = [number, number][];
interface Acc {
  pos: number[];
  nor: number[];
  col: number[];
  si: number[];
  sw: number[];
  idx: number[];
}
class KitBuilder {
  acc = new Map<MatKind, Acc>();
  tris = 0;
  constructor(readonly rig: Rig) {}
  /** add `geo` (in `bone` space) to material `kind`; rigid to the bone unless `wf` gives blend weights (bind space) */
  add(kind: MatKind, geo: THREE.BufferGeometry, bone: string, color?: THREE.Color | string | null, wf?: (p: THREE.Vector3) => Weights) {
    let a = this.acc.get(kind);
    if (!a) this.acc.set(kind, (a = { pos: [], nor: [], col: [], si: [], sw: [], idx: [] }));
    if (!geo.index) {
      const n = geo.attributes.position.count;
      geo.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const m = this.rig.by[bone].matrixWorld;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const c = color ? new THREE.Color(color) : null;
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    const C = geo.attributes.color;
    const base = a.pos.length / 3;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(m);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      a.pos.push(p.x, p.y, p.z);
      a.nor.push(n.x, n.y, n.z);
      let r = C ? C.getX(i) : 1;
      let g = C ? C.getY(i) : 1;
      let b = C ? C.getZ(i) : 1;
      if (c) (r *= c.r), (g *= c.g), (b *= c.b);
      a.col.push(r, g, b);
      const w: Weights = wf ? wf(p).filter((e) => e[1] > 1e-4) : [[BI[bone], 1]];
      w.sort((x, y) => y[1] - x[1]);
      const tot = w.slice(0, 4).reduce((s, e) => s + e[1], 0) || 1;
      for (let k = 0; k < 4; k++) {
        a.si.push(w[k] ? w[k][0] : 0);
        a.sw.push(w[k] ? w[k][1] / tot : 0);
      }
    }
    const I = geo.index!;
    for (let i = 0; i < I.count; i++) a.idx.push(base + I.getX(i));
    this.tris += I.count / 3;
  }
  build() {
    const out: Partial<Record<MatKind, THREE.BufferGeometry>> = {};
    for (const [kind, a] of this.acc) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(a.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(a.sw, 4));
      g.setIndex(a.idx);
      out[kind] = g;
    }
    return out;
  }
}

const HQ_COL = {
  skinU: '#e4b995',
  skinH: SKIN,
  stubble: '#7d6a60',
  lip: '#b8706a',
  cheek: '#e79c86',
  brow: '#4a3326',
  lash: '#24180f',
  sclera: '#efe8e0',
  iris: '#4a2f1d',
  pupil: '#0a0706',
  eyeH: '#2b211b',
  sole: '#3a2c22',
  strap: '#5a3e2a',
  trouser: '#5f5447',
  inner: '#6e604f',
};

interface Kit {
  geos: Partial<Record<MatKind, THREE.BufferGeometry>>;
  tris: number;
}
const kitCache = new Map<string, Kit>();
/** Shared merged geometry for a style ('U' = ultra detail, 'H' = high detail) on a body type. */
function getKit(style: Style, D: Dims): Kit {
  const key = style + D.name;
  const hit = kitCache.get(key);
  if (hit) return hit;
  const rig = makeRig(D);
  rig.by.body.updateMatrixWorld(true);
  const kb = new KitBuilder(rig);
  const U = style === 'U';
  const H = heights(D);
  const skinC = new THREE.Color(U ? HQ_COL.skinU : HQ_COL.skinH);

  // --- weight functions (bind space = rest pose, feet on y = 0) ---
  const torsoW = (p: THREE.Vector3): Weights => {
    const wp = 1 - sstep(H.spine - 0.07, H.spine + 0.01, p.y);
    const wc = sstep(H.spine + 0.03, H.chest + 0.02, p.y);
    return [
      [BI.pelvis, wp],
      [BI.spine, Math.max(0, 1 - wp - wc)],
      [BI.chest, wc],
    ];
  };
  const skirtW = (p: THREE.Vector3): Weights => {
    const g = sstep(H.hip + 0.06, H.hip - 0.14, p.y);
    if (g <= 0) return torsoW(p);
    const us = Math.max(0, H.hip - p.y);
    const wl = smooth(clamp01(0.5 + p.x / 0.26));
    const h = 0.4 * sstep(0, H.hip - 0.1, us);
    const leg = (s: string) => (us < D.thigh * 0.8 ? BI['th' + s] : BI['kn' + s]);
    return [
      [BI.pelvis, 1 - g],
      [leg('L'), g * (1 - h) * wl],
      [leg('R'), g * (1 - h) * (1 - wl)],
      [BI.hem, g * h],
    ];
  };
  const neckW = (p: THREE.Vector3): Weights => {
    const wc = 1 - sstep(H.neck - 0.06, H.neck, p.y);
    const wh = sstep(H.head - 0.02, H.head + 0.04, p.y);
    return [
      [BI.chest, wc],
      [BI.neck, Math.max(0, 1 - wc - wh)],
      [BI.head, wh],
    ];
  };

  // --- head ---
  {
    const g = new THREE.SphereGeometry(1, U ? 40 : 28, U ? 30 : 20);
    const P = g.attributes.position;
    const col = new Float32Array(P.count * 3);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    const stub = new THREE.Color(HQ_COL.stubble);
    const lip = new THREE.Color(HQ_COL.lip);
    const cheek = new THREE.Color(HQ_COL.cheek);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i);
      const y = P.getY(i);
      const z = P.getZ(i);
      sculpt(D, x, y, z, v);
      P.setXYZ(i, v.x + D.headC[0], v.y + D.headC[1], v.z + D.headC[2]);
      const front = sstep(0.3, 0.85, z);
      const thr = lerp(-0.35, 0.52, sstep(-0.5, 0.75, z));
      c.copy(skinC)
        .lerp(stub, (U ? 0.4 : 0.22) * sstep(thr, thr + 0.12, y))
        .lerp(lip, (U ? 0.7 : 0.4) * gauss(x, y + 0.565, 0.16, 0.055) * front)
        .lerp(cheek, 0.22 * gauss(Math.abs(x) - 0.45, y + 0.25, 0.15, 0.12) * front);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    smoothNormals(g);
    kb.add('skin', g, 'head');
    const v2 = new THREE.Vector3();
    for (const sgn of [1, -1]) {
      // ears
      const ear = ell(0.011 * D.ear, 0.03 * D.ear, 0.019 * D.ear, U ? 10 : 8, U ? 8 : 6)
        .rotateY(sgn * 0.35)
        .translate(D.headC[0] + sgn * D.headA[0] * 0.96, D.headC[1] - 0.06 * D.headA[1], D.headC[2] - 0.08 * D.headA[2]);
      kb.add('skin', ear, 'head', skinC);
      // brows
      const bn = new THREE.Vector3(sgn * 0.36, 0.27, 0.91).normalize();
      sculpt(D, bn.x, bn.y, bn.z, v2);
      const brow = (U ? ell(0.02, 0.0028, 0.0045, 10, 6) : ell(0.034, 0.0065, 0.009, 8, 5))
        .rotateZ(-sgn * 0.16)
        .translate(v2.x + D.headC[0], v2.y + D.headC[1], v2.z + D.headC[2] + 0.002);
      kb.add('skin', brow, 'head', HQ_COL.brow);
    }
  }
  // --- eyes ---
  for (const s of SIDES) {
    if (U) {
      const g = new THREE.SphereGeometry(D.eyeR, 14, 10);
      const P = g.attributes.position;
      const col = new Float32Array(P.count * 3);
      const c = new THREE.Color();
      const sc = new THREE.Color(HQ_COL.sclera);
      const ir = new THREE.Color(HQ_COL.iris);
      const pu = new THREE.Color(HQ_COL.pupil);
      for (let i = 0; i < P.count; i++) {
        const z = P.getZ(i) / D.eyeR;
        c.copy(sc).lerp(ir, sstep(0.86, 0.9, z)).lerp(pu, sstep(0.965, 0.975, z));
        col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      kb.add('eye', g, 'eye' + s);
      // eyelids: upper (dark lash line on its rim) and lower, each a shell rotating about the eye centre
      const up = new THREE.SphereGeometry(D.eyeR * 1.12, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
      const UP = up.attributes.position;
      const ucol = new Float32Array(UP.count * 3);
      const lash = new THREE.Color(HQ_COL.lash);
      for (let i = 0; i < UP.count; i++) {
        c.copy(skinC).lerp(lash, sstep(0.25, 0.05, UP.getY(i) / D.eyeR) * sstep(0, 0.5, UP.getZ(i) / D.eyeR));
        ucol.set([c.r, c.g, c.b], i * 3);
      }
      up.setAttribute('color', new THREE.BufferAttribute(ucol, 3));
      kb.add('skin', up, 'lidU' + s);
      kb.add('skin', new THREE.SphereGeometry(D.eyeR * 1.09, 14, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 'lidL' + s, skinC);
    } else {
      kb.add('eye', ell(D.eyeR, D.eyeR * 1.3, D.eyeR * 0.6, 12, 8), 'eye' + s, HQ_COL.eyeH);
    }
  }
  // --- neck ---
  kb.add(
    'skin',
    tube(
      [
        [-0.07, D.neckR],
        [0.02, D.neckR * 0.97],
        [D.n2h + 0.05, D.neckR * 0.9],
      ],
      U ? 16 : 12,
    ),
    'neck',
    skinC,
    neckW,
  );
  // --- upper robe, collar, belt ---
  kb.add('robe', tube(D.torso, U ? 40 : 24, { pleats: U ? 7 : 5, amp: (t) => 0.018 * (1 - t), ao: 0.5 }), 'body', null, torsoW);
  const top = D.torso[D.torso.length - 1];
  kb.add(
    'robe',
    tube(
      [
        [H.neck + 0.03, D.neckR * 1.25, D.neckR * 1.2],
        [H.neck + 0.005, D.neckR * 1.55, D.neckR * 1.45],
        [H.neck - 0.025, D.neckR * 1.7, D.neckR * 1.6],
      ],
      U ? 24 : 16,
      { ao: 0 },
    ),
    'body',
    '#e6dccd',
    neckW,
  );
  void top;
  const ring = (y: number) => {
    let a = D.torso[0];
    let b = D.torso[D.torso.length - 1];
    for (let i = 0; i < D.torso.length - 1; i++)
      if (y >= D.torso[i][0] && y <= D.torso[i + 1][0]) {
        a = D.torso[i];
        b = D.torso[i + 1];
      }
    const u = clamp01((y - a[0]) / (b[0] - a[0] || 1));
    return [lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  };
  {
    const [rx, rz] = ring(H.spine);
    kb.add(
      'sash',
      tube(
        [
          [H.spine + 0.032, rx + 0.006, rz + 0.006],
          [H.spine + 0.02, rx + 0.014, rz + 0.014],
          [H.spine - 0.02, rx + 0.016, rz + 0.016],
          [H.spine - 0.032, rx + 0.008, rz + 0.008],
        ],
        U ? 36 : 22,
      ),
      'body',
      null,
      torsoW,
    );
  }
  // --- kasaya / sash band: from the right hip over the left shoulder, with drape folds ---
  {
    const along = U ? 72 : 40;
    const across = U ? 4 : 2;
    const w = U ? 0.13 : 0.06;
    const topY = H.shoulder + 0.025;
    const botY = H.spine - 0.02;
    const yc = (topY + botY) / 2;
    const A = (topY - botY) / 2;
    const yMax = D.torso[D.torso.length - 2][0];
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < along; i++) {
      const ph = (i / along) * Math.PI * 2;
      const y0 = yc + A * Math.sin(ph);
      const [rx0] = ring(y0);
      const slope = Math.atan2(A * Math.cos(ph), rx0);
      const fold = U ? Math.sin(ph * 11) ** 2 : 0;
      for (let j = 0; j <= across; j++) {
        const v = j / across - 0.5;
        const y = Math.min(yMax, y0 + (v * w) / Math.max(0.35, Math.cos(slope)));
        const [rx, rz] = ring(y);
        const off = 0.008 + 0.006 * fold * (1 - Math.abs(v) * 1.4);
        pos.push(Math.sin(ph) * (rx + off), y, Math.cos(ph) * (rz + off));
        const sh = 1 - 0.25 * (1 - fold) * (U ? 1 : 0);
        col.push(sh, sh, sh);
      }
    }
    const idx: number[] = [];
    const W = across + 1;
    for (let i = 0; i < along; i++)
      for (let j = 0; j < across; j++) {
        const a = i * W + j;
        const b = ((i + 1) % along) * W + j;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    kb.add('sash', g, 'body', null, torsoW);
  }
  // --- skirt: inner robe to the ankles (+ for ultra an outer wrap with a diagonal hem) ---
  kb.add(
    U ? 'dark' : 'robe',
    tube(D.skirt, U ? 44 : 26, { zs: D.skirtZ, pleats: U ? 9 : 7, amp: (t) => 0.02 + 0.1 * t, ao: 0.55 }),
    'body',
    U ? HQ_COL.inner : null,
    skirtW,
  );
  if (U) {
    const outer = [
      [1.03, 0.163],
      [0.95, 0.184],
      [0.85, 0.199],
      [0.62, 0.214],
      [0.42, 0.233],
    ];
    kb.add(
      'robe',
      tube(outer, 48, {
        zs: D.skirtZ,
        pleats: 8,
        amp: (t) => 0.015 + 0.1 * t,
        ao: 0.6,
        warp: (p, th, t) => {
          if (t > 0.99) p.y += 0.07 * Math.sin(th) + 0.04;
        },
      }),
      'body',
      null,
      skirtW,
    );
  }
  // pelvis volume (fills the robe when sitting / bowing)
  kb.add('dark', ell(0.155, 0.12, 0.12, U ? 14 : 10, U ? 10 : 8).translate(0, -0.02, -0.015), 'pelvis', HQ_COL.inner);

  // --- arms ---
  for (const [i, s] of SIDES.entries()) {
    const sgn = i === 0 ? 1 : -1;
    const shY = H.shoulder;
    kb.add(
      'robe',
      tube(
        [
          [0.05, 0],
          [0.045, 0.026],
          [0.03, 0.045],
          [0.0, 0.057],
          [-0.06, 0.06],
          [-D.upper + 0.03, 0.058],
          [-D.upper - 0.02, 0.056],
        ].map(([y, r]) => [y, r * (U ? 1 : 1.12)]),
        U ? 18 : 12,
        { pleats: 3, amp: () => 0.02, ao: 0.4 },
      ),
      'sh' + s,
      null,
      (p) => {
        const wc = 0.55 * sstep(shY - 0.05, shY + 0.035, p.y);
        return [
          [BI.chest, wc],
          [BI['sh' + s], 1 - wc],
        ];
      },
    );
    kb.add(
      'robe',
      tube(
        [
          [0.05, 0.06],
          [-D.fore * 0.45, 0.067],
          [-D.fore + 0.035, D.sleeve],
          [-D.fore + 0.03, D.sleeve * 0.93],
        ],
        U ? 20 : 12,
        { pleats: 4, amp: (t) => 0.03 * t, ao: 0.5 },
      ),
      'el' + s,
    );
    kb.add('skin', limb(U ? 0.026 : 0.03, 0.09, U ? 8 : 6, 1).translate(0, -D.fore + 0.085, 0), 'el' + s, skinC);
    // palm (palm faces medially, thumb forward)
    const hs = D.palm / 0.092;
    kb.add(
      'skin',
      ell(0.0155 * hs, D.palm * 0.56, 0.041 * hs, U ? 12 : 8, U ? 8 : 6).translate(-sgn * 0.003, -D.palm * 0.5, 0.003),
      'wr' + s,
      skinC,
    );
    const lodHand = () => {
      kb.add('skin', ell(0.0135 * hs, D.finger * 0.55, 0.037 * hs, 8, 6).translate(0, -D.finger * 0.48, -0.008 * hs), `f1a${s}`, skinC);
      kb.add('skin', limb(0.012 * hs, 0.06 * hs, 6, 1), 't0' + s, skinC);
    };
    if (U) {
      for (let f = 0; f < 4; f++) {
        const len = D.finger * FINGER_LEN[f];
        const r0 = [0.0085, 0.0088, 0.0083, 0.0073][f] * hs;
        for (let j = 0; j < 3; j++) {
          const seg = len * FINGER_SEG[j] + (j < 2 ? 0.004 : 0);
          kb.add('skin', limb(r0 * [1, 0.93, 0.85][j], seg, 6, 2), `f${f}${'abc'[j]}${s}`, skinC);
        }
      }
      for (let j = 0; j < 3; j++) kb.add('skin', limb([0.0115, 0.0105, 0.0095][j] * hs, [0.044, 0.035, 0.027][j] * hs, 6, 2), `t${j}${s}`, skinC);
    } else lodHand();
    // legs (covered by the robe, but shape it when seated) and feet in sandals
    kb.add(
      'dark',
      tube(
        [
          [0.04, 0.07],
          [-0.08, 0.074],
          [-D.thigh + 0.04, 0.055],
          [-D.thigh - 0.02, 0.05],
        ],
        U ? 12 : 8,
      ),
      'th' + s,
      HQ_COL.trouser,
    );
    kb.add(
      'dark',
      tube(
        [
          [0.03, 0.052],
          [-D.shin * 0.4, 0.05],
          [-D.shin + 0.08, 0.036],
        ],
        U ? 10 : 8,
      ),
      'kn' + s,
      HQ_COL.trouser,
    );
    kb.add('skin', limb(0.032, 0.11, U ? 8 : 6, 1).translate(0, -D.shin + 0.1, 0), 'kn' + s, skinC);
    const fl = D.footLen / 0.24;
    kb.add('skin', ell(0.04, 0.03, 0.085 * fl, U ? 12 : 8, U ? 8 : 6).translate(0, -D.ankle + 0.032, 0.035 * fl), 'ft' + s, skinC);
    const toeY = -D.ankle * 0.3;
    kb.add('skin', ell(0.041, 0.017, 0.04 * fl, U ? 10 : 8, 6).translate(0, toeY + 0.017, 0.022 * fl), 'to' + s, skinC);
    kb.add('dark', new THREE.CylinderGeometry(1, 1, 1, U ? 18 : 12).scale(0.05, 0.014, 0.1 * fl).translate(0, -D.ankle + 0.007, 0.035 * fl), 'ft' + s, HQ_COL.sole);
    kb.add('dark', new THREE.CylinderGeometry(1, 1, 1, U ? 14 : 10).scale(0.049, 0.014, 0.05 * fl).translate(0, toeY + 0.007, 0.03 * fl), 'to' + s, HQ_COL.sole);
    kb.add(
      'dark',
      new THREE.TorusGeometry(0.044, U ? 0.006 : 0.008, 5, U ? 14 : 10, Math.PI).scale(1, 0.75, 1).translate(0, -D.ankle + 0.012, 0.075 * fl),
      'ft' + s,
      HQ_COL.strap,
    );
  }
  const kit: Kit = { geos: kb.build(), tris: kb.tris };
  kitCache.set(key, kit);
  return kit;
}

// ---- materials --------------------------------------------------------------------------
const matCache = new Map<string, THREE.Material>();
function hqMaterial(style: Style, kind: MatKind, color: string): THREE.Material {
  const key = `${style}|${kind}|${kind === 'robe' || kind === 'sash' ? color : ''}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const U = style === 'U';
  let m: THREE.Material;
  const cloth = (c: string) =>
    U
      ? new THREE.MeshPhysicalMaterial({
          color: c,
          vertexColors: true,
          roughness: 0.88,
          sheen: 1,
          sheenRoughness: 0.7,
          sheenColor: new THREE.Color(c).lerp(new THREE.Color('#fff4e0'), 0.45),
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  switch (kind) {
    case 'skin':
      m = U
        ? new THREE.MeshPhysicalMaterial({
            vertexColors: true,
            roughness: 0.5,
            sheen: 0.4,
            sheenRoughness: 0.45,
            sheenColor: new THREE.Color('#ff9a7c'),
            clearcoat: 0.06,
            clearcoatRoughness: 0.55,
            // faint warm self-light: light scattered under the skin keeps shadows from going grey
            emissive: new THREE.Color('#4a1c10'),
            emissiveIntensity: 0.18,
          })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68 });
      break;
    case 'eye':
      m = U
        ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2 });
      break;
    case 'robe':
    case 'sash':
      m = cloth(color);
      break;
    default:
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  }
  matCache.set(key, m);
  return m;
}

/** count triangles of a tier's shared geometry (for diagnostics) */
export function avatarTriangles(detail: AvatarDetail): number {
  if (detail === 'ultra') return getKit('U', ULTRA_DIMS).tris;
  if (detail === 'high') return getKit('H', HIGH_DIMS).tris;
  const g = detail === 'low' ? (lowGeo ??= classicGeometry(true)) : shared;
  const tri = (x: THREE.BufferGeometry) => (x.index ? x.index.count : x.attributes.position.count) / 3;
  return tri(g.lower) + tri(g.upper) + 2 * tri(g.arm) + 2 * tri(g.hand) + tri(g.head) + (detail === 'low' ? 0 : 2 * tri(g.ear)) + 2 * tri(g.eye) + 2 * tri(g.foot) + tri(g.sash);
}

// ---- animation channels ---------------------------------------------------------------
// body
const PX = 0,
  PY = 1,
  PZ = 2,
  PP = 3,
  PR = 4,
  PW = 5,
  SP = 6,
  SR = 7,
  SW = 8,
  CP = 9,
  CW = 10,
  NP = 11,
  HP = 12,
  HW = 13,
  HR = 14;
/** hands: HB + side*10 + [x y z (wrist, chest space), ox oy oz (hand orientation, chest space), curl, elbowOut, elbowFwd, swing] */
const HB = 15;
/** feet: FB + side*7 + [x y z (ankle, body space), pitch yaw roll, kneeOut] */
const FB = 35;
const PRP = 49,
  PRY = 50,
  PRR = 51,
  GAIT = 52,
  LID = 53;
const NCH = 54;

/** scratch: one target / stiffness buffer for every avatar → animate() allocates nothing */
const TG = new Float32Array(NCH);
const OM = new Float32Array(NCH);
/** post-spring additive offsets: hand L xyz, hand R xyz, prop pitch */
const ADD = new Float32Array(7);
const GF = new Float32Array(3);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);

type Sit = 'stand' | 'lotus' | 'seiza' | 'bench';
/** assumed seat height for 'bench' (feet reach the floor this far below the root) */
const BENCH_H = 0.45;

/**
 * 2-bone IK in the parent's space. `S` root joint, `T` target, `a`/`b` bone lengths,
 * `pole` direction the middle joint points to. Writes upper & lower bone quaternions.
 * Arms flex the forearm toward local +z (rotation -x); legs flex the shin toward -z.
 */
function solveIK(S: THREE.Vector3, T: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, upper: THREE.Bone, lower: THREE.Bone, leg: boolean) {
  const n = _v1.subVectors(T, S);
  let L = n.length();
  if (L < 1e-6) n.set(0, -1, 0), (L = 1e-3);
  else n.divideScalar(L);
  L = clampN(L, Math.abs(a - b) + 1e-3, (a + b) * 0.9995);
  const m = _v2.copy(pole).addScaledVector(n, -pole.dot(n));
  if (m.lengthSq() < 1e-8) m.set(0, 0, leg ? 1 : -1).addScaledVector(n, -n.z);
  m.normalize();
  const cosA = clampN((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const d = _v3.copy(n).multiplyScalar(cosA).addScaledVector(m, sinA); // upper bone direction
  // forearm/shin direction: from the elbow to the (clamped) target
  const fw = _v4
    .copy(n)
    .multiplyScalar(L)
    .addScaledVector(d, -a)
    .normalize();
  const yv = _v5.copy(d).negate();
  const zv = _v6.copy(fw).addScaledVector(d, -fw.dot(d));
  if (zv.lengthSq() < 1e-8) zv.copy(m).negate();
  zv.normalize();
  if (leg) zv.negate();
  const xv = _v4.crossVectors(yv, zv);
  _m1.makeBasis(xv, yv, zv);
  upper.quaternion.setFromRotationMatrix(_m1);
  const cosE = clampN((a * a + b * b - L * L) / (2 * a * b), -1, 1);
  const flex = Math.PI - Math.acos(cosE);
  lower.quaternion.setFromAxisAngle(X_AXIS, leg ? flex : -flex);
}

/** gait sample for one foot at cycle phase `ph`: writes GF = [z offset, lift, pitch] */
function gaitFoot(ph: number, beta: number, D: number, H: number) {
  if (ph < beta) {
    const s = ph / beta;
    GF[0] = D / 2 - s * D;
    GF[1] = 0;
    GF[2] = s < 0.16 ? -0.3 * (1 - smooth(s / 0.16)) : s > 0.6 ? 0.7 * smooth((s - 0.6) / 0.4) : 0;
  } else {
    const s = (ph - beta) / (1 - beta);
    GF[0] = -D / 2 + D * smooth(s);
    GF[1] = H * Math.sin(Math.PI * Math.pow(s, 0.8));
    GF[2] = lerp(0.7, -0.3, smooth(Math.min(1, s * 1.25)));
  }
}

let LM: Land;
let CHEST_INV: THREE.Matrix4;
let PITCH = 0;
/** hand target in chest space (x/oy/oz given for the LEFT hand, mirrored for the right) */
function hand(s: number, x: number, y: number, z: number, ox: number, oy: number, oz: number, curl: number, eo = 0.3, ef = 0) {
  const b = HB + s * 10;
  const m = s === 0 ? 1 : -1;
  TG[b] = x * m;
  TG[b + 1] = y;
  TG[b + 2] = z;
  TG[b + 3] = ox;
  TG[b + 4] = oy * m;
  TG[b + 5] = oz * m;
  TG[b + 6] = curl;
  TG[b + 7] = eo;
  TG[b + 8] = ef;
  TG[b + 9] = 0;
}
/** hand target given in body space (floor / table / thigh anchored); `ox` is a body-space pitch */
function bodyHand(s: number, x: number, y: number, z: number, ox: number, oy: number, oz: number, curl: number, eo = 0.3, ef = 0) {
  _v1.set(s === 0 ? x : -x, y, z).applyMatrix4(CHEST_INV);
  hand(s, s === 0 ? _v1.x : -_v1.x, _v1.y, _v1.z, ox - PITCH, oy, oz, curl, eo, ef);
}
function foot(s: number, x: number, y: number, z: number, pitch: number, yaw: number, roll: number, kneeOut: number) {
  const b = FB + s * 7;
  const m = s === 0 ? 1 : -1;
  TG[b] = x * m;
  TG[b + 1] = y;
  TG[b + 2] = z;
  TG[b + 3] = pitch;
  TG[b + 4] = yaw * m;
  TG[b + 5] = roll * m;
  TG[b + 6] = kneeOut;
}

/** module flags written by the target pass, read by the prop pass */
const FL = { teapot: false, cup: false, pour: false, incense: false, pot: 0, bud: false, calm: false };

const HALF_PI = Math.PI / 2;
/** palms facing each other, fingers up and slightly forward (prayer / anjali) */
const ANJALI = -2.89;

/**
 * Fill TG with the pose + action targets for a high/ultra avatar.
 * Coordinates: chest space for hands (see `hand`), body space for feet; +z forward, +x = left.
 */
function hqTargets(h: HQ, pose: Pose, act: Action | null, a: number, age: number, t: number, sit: Sit, beat: number, speed: number, bowStyle: 'prostrate' | 'church' = 'prostrate') {
  const L = LM;
  const k = L.k;
  const lk = L.lk;
  const D = h.D;
  const ank = D.ankle;
  FL.teapot = FL.cup = FL.pour = FL.incense = FL.bud = FL.calm = false;
  FL.pot = 0;
  ADD.fill(0);

  // ---- base: relaxed standing ----
  TG.fill(0, 0, HB);
  TG[PY] = L.hipY - 0.012 * lk;
  TG[PP] = 0.02;
  TG[SP] = 0.02;
  TG[NP] = 0.03;
  for (let s = 0; s < 2; s++) {
    hand(s, L.shX + 0.02 * k, L.shY - L.reach * 0.975, 0.035 * k, -0.12, 0, 0, 0.32, 0.25);
    TG[HB + s * 10 + 9] = 1; // free to swing while walking
    foot(s, D.hipW + 0.006, ank, 0.015, 0, 0.1, 0, 0.1);
  }
  TG[PRP] = TG[PRY] = TG[PRR] = 0;
  TG[LID] = 1;
  // idle life: breathing sway, a slow look around, weight shifts every few seconds
  const idle = speed < 0.15 && !act;
  if (idle && sit === 'stand') {
    const w = h.wsSide;
    TG[PX] = 0.026 * w * lk;
    TG[PR] = 0.035 * w;
    TG[SR] = -0.022 * w;
    TG[HR] = 0.015 * w;
    const free = w > 0 ? 1 : 0; // the unweighted leg relaxes: knee forward, heel slightly up
    if (Math.abs(w) > 0.3) {
      const fb = FB + free * 7;
      TG[fb + 2] += 0.035;
      TG[fb + 3] = 0.14;
      TG[fb + 1] += 0.012;
    }
    TG[HW] = Math.sin(t * 0.23) * 0.32 + Math.sin(t * 0.61 + 1.3) * 0.12;
    TG[NP] = 0.03 + Math.sin(t * 0.17) * 0.04;
  }

  // ---- seating posture ----
  if (sit === 'lotus') {
    TG[PY] = 0.115 * lk;
    TG[PZ] = -0.03;
    TG[PP] = 0.06;
    TG[SP] = -0.03;
    TG[NP] = 0.09;
    foot(0, -0.12 * lk, 0.12 * lk, 0.21 * lk, 0.1, -1.25, 0.45, 2.2);
    foot(1, -0.13 * lk, 0.045 * lk, 0.25 * lk, 0.1, -1.25, 0.3, 2.2);
    // dhyana mudra: hands in the lap, palms up, right resting on left
    hand(0, 0.06 * k, L.lapY + 0.02, L.front + 0.05 * k, 0, 0, -HALF_PI, 0.18, 0.7);
    hand(1, 0.05 * k, L.lapY + 0.04, L.front + 0.06 * k, 0, 0, -HALF_PI, 0.18, 0.7);
    FL.calm = !act && pose === Pose.Sit;
  } else if (sit === 'seiza') {
    TG[PY] = 0.25 * lk;
    TG[PZ] = -0.03;
    TG[PP] = 0.04;
    TG[SP] = -0.02;
    TG[NP] = 0.08;
    foot(0, D.hipW + 0.002, ank * 0.85, -0.07 * lk, 2.75, 0, 0, 0.05);
    foot(1, D.hipW + 0.002, ank * 0.85, -0.07 * lk, 2.75, 0, 0, 0.05);
    PITCH = h.x[PP] + h.x[SP] + h.x[CP];
    bodyHand(0, 0.11 * lk, 0.27 * lk, 0.27 * lk, -HALF_PI + 0.2, -HALF_PI, 0, 0.35, 0.4);
    bodyHand(1, 0.11 * lk, 0.27 * lk, 0.27 * lk, -HALF_PI + 0.2, -HALF_PI, 0, 0.35, 0.4);
    FL.calm = !act && pose === Pose.Sit;
  } else if (sit === 'bench') {
    TG[PY] = 0.09;
    TG[PZ] = 0;
    TG[PP] = -0.02;
    TG[SP] = -0.03;
    TG[NP] = 0.06;
    const kneeY = 0.03;
    foot(0, D.hipW + 0.018, -BENCH_H + ank, 0.44 * lk + 0.02, 0, 0.08, 0, 0.12);
    foot(1, D.hipW + 0.018, -BENCH_H + ank, 0.44 * lk + 0.02, 0, 0.08, 0, 0.12);
    void kneeY;
    PITCH = h.x[PP] + h.x[SP] + h.x[CP];
    bodyHand(0, 0.12 * lk, 0.16, 0.3 * lk, -HALF_PI + 0.15, -HALF_PI, 0, 0.35, 0.35);
    bodyHand(1, 0.12 * lk, 0.16, 0.3 * lk, -HALF_PI + 0.15, -HALF_PI, 0, 0.35, 0.35);
    FL.calm = !act && pose === Pose.Sit;
  }
  if (sit !== 'stand') TG[HB + 9] = TG[HB + 19] = 0;
  PITCH = h.x[PP] + h.x[SP] + h.x[CP];

  // ---- poses ----
  switch (pose) {
    case Pose.Sit:
      // meditative breathing: a slow rise of the chest, eyes half closed
      TG[SP] += Math.sin(t * 1.15) * 0.012;
      TG[NP] += Math.sin(t * 0.21) * 0.02;
      break;
    case Pose.Bow: {
      if (bowStyle === 'church') {
        // church (4 s): a quiet bow of the head and shoulders where you stand, hands at the sides, hold, rise;
        // seated on a pew only the head bows
        const c = (age % 4) / 4;
        const bow = sstep(0.08, 0.35, c) * (1 - sstep(0.62, 0.88, c));
        if (sit === 'stand') {
          TG[PP] += 0.12 * bow;
          TG[PZ] -= 0.02 * bow; // hips go back a touch to stay balanced over the feet
          TG[SP] += 0.2 * bow;
        } else TG[SP] += 0.06 * bow;
        TG[NP] += 0.38 * bow;
        TG[HW] = 0;
        break;
      }
      // full prostration (5 s): palms together to the forehead → hinge down, hands to the floor → hold → rise
      const c = (age % 5) / 5;
      const toHead = sstep(0.0, 0.14, c) * (1 - sstep(0.18, 0.3, c));
      const down = c < 0.18 ? 0 : c < 0.5 ? smooth((c - 0.18) / 0.32) : c < 0.66 ? 1 : 1 - smooth((c - 0.66) / 0.34);
      TG[PP] = 0.04 + down * 0.95;
      TG[SP] = -0.02 + down * 0.42;
      TG[NP] = 0.08 + down * 0.25 + toHead * 0.15;
      TG[PZ] = -0.03 + down * 0.05;
      TG[PY] += down * 0.04 * lk; // the hips rise a little off the heels as the body folds
      const hy = lerp(L.sternY - 0.1 * k, L.browY - 0.17 * k, toHead);
      const hz = lerp(L.front + 0.1 * k, L.browZ + 0.1 * k, toHead);
      hand(0, 0.028 * k, hy, hz, ANJALI, 0, 0, 0.05, 0.9);
      hand(1, 0.028 * k, hy, hz, ANJALI, 0, 0, 0.05, 0.9);
      if (down > 0.02) {
        // hands slide forward onto the floor, palms down
        PITCH = h.x[PP] + h.x[SP] + h.x[CP];
        const fx = TG[HB];
        const fy = TG[HB + 1];
        const fz = TG[HB + 2];
        bodyHand(0, 0.12 * lk, 0.035, 0.5 * lk, -HALF_PI, -HALF_PI, 0, 0.1, 0.9);
        bodyHand(1, 0.12 * lk, 0.035, 0.5 * lk, -HALF_PI, -HALF_PI, 0, 0.1, 0.9);
        const w = sstep(0.05, 0.6, down);
        for (let s = 0; s < 2; s++) {
          const b = HB + s * 10;
          const m = s === 0 ? 1 : -1;
          TG[b] = lerp(fx * m, TG[b], w);
          TG[b + 1] = lerp(fy, TG[b + 1], w);
          TG[b + 2] = lerp(fz, TG[b + 2], w);
          TG[b + 3] = lerp(ANJALI, TG[b + 3], w);
          TG[b + 4] *= w;
        }
      }
      break;
    }
    case Pose.Greet: {
      // palms rise to the chest, a bow from the hips (head follows a beat later), hold, rise slower
      const up = sstep(0, 0.45, age);
      const bow = sstep(0.35, 1.15, age) * (1 - sstep(1.65, 2.5, age));
      hand(0, 0.028 * k, L.sternY - 0.1 * k, L.front + 0.1 * k, lerp(-0.12, ANJALI, up), 0, 0, 0.05, 1.3);
      hand(1, 0.028 * k, L.sternY - 0.1 * k, L.front + 0.1 * k, lerp(-0.12, ANJALI, up), 0, 0, 0.05, 1.3);
      if (sit === 'stand') {
        TG[PP] += 0.3 * bow;
        TG[PZ] -= 0.035 * bow; // hips go back to stay balanced over the feet
        TG[SP] += 0.12 * bow;
      } else TG[SP] += 0.3 * bow;
      TG[NP] += 0.22 * sstep(0.45, 1.25, age) * (1 - sstep(1.55, 2.4, age));
      TG[HW] = 0;
      break;
    }
    case Pose.Beads: {
      // mala in the left palm, right thumb counting a bead every ~0.9 s
      const c = (t % 0.9) / 0.9;
      const flick = c < 0.25 ? smooth(c / 0.25) : 1 - smooth((c - 0.25) / 0.75);
      hand(0, 0.05 * k, -0.13 * k, L.front + 0.08 * k, -0.3, 0, -HALF_PI, 0.45, 0.5);
      hand(1, 0.02 * k, -0.09 * k + flick * 0.008, L.front + 0.1 * k, -1.2, 0.4, 0, 0.55 + 0.25 * flick, 0.5);
      TG[SP] += 0.06;
      TG[NP] = 0.3;
      TG[HW] = 0;
      break;
    }
    case Pose.Moktak:
      moktakTargets(h, sit, age, k, lk);
      break;
    case Pose.PourTea: {
      // lift the pot (0-0.6 s), tip it over the cup in the left hand (0.6-2.3), right it (2.3-2.9), set down
      FL.teapot = FL.cup = true;
      const lift = smooth(clamp01(age / 0.6)) * (1 - smooth(clamp01((age - 2.9) / 0.5)));
      const pot = smooth(clamp01((age - 0.6) / 0.5)) * (1 - smooth(clamp01((age - 2.3) / 0.5)));
      FL.pot = pot;
      FL.pour = pot > 0.55;
      hand(0, 0.03 * k, -0.2 * k, L.front + 0.2 * k, -0.25, 0, -HALF_PI, 0.55, 0.5);
      hand(1, lerp(-0.12, -0.075, lift) * k, lerp(-0.22, -0.02, lift) * k, L.front + lerp(0.14, 0.2, lift) * k, -HALF_PI + 0.25, 0, -0.3 * pot, 0.75, 0.45);
      TG[SP] += 0.06 + 0.06 * lift;
      TG[NP] = 0.25 + 0.15 * lift;
      TG[HW] = 0.08 * lift;
      break;
    }
    case Pose.DrinkTea: {
      // both hands bring the cup to the lips, two small sips (head tips back a little), then lower it
      FL.cup = true;
      const up = smooth(clamp01(age / 0.7)) * (1 - smooth(clamp01((age - 2.1) / 0.6)));
      const sip = up > 0.9 ? Math.max(0, Math.sin((age - 0.7) * 4.2)) : 0;
      hand(0, lerp(0.03 * k, 0.055 * k, up), lerp(-0.2 * k, L.mouthY - 0.045, up), lerp(L.front + 0.2 * k, L.mouthZ + 0.045, up), -0.2 - 0.2 * sip, 0, -HALF_PI, 0.5, lerp(0.5, 0.9, up));
      hand(1, lerp(0.06 * k, 0.03 * k, up), lerp(-0.22 * k, L.mouthY - 0.08, up), lerp(L.front + 0.18 * k, L.mouthZ + 0.035, up), -1.0, 0.6, 0, 0.4, 0.8);
      TG[PRP] = -0.3 * sip;
      TG[NP] = 0.1 - 0.12 * up;
      TG[HP] = -0.1 * sip;
      TG[HW] = 0;
      break;
    }
    case Pose.Offer: {
      // 7 s: raise the sticks to the forehead → three bows → lean in and plant them → palms together
      FL.incense = age < 5.5;
      const raise = sstep(0, 1.0, age);
      const bowT = age - 1.0;
      const bow = bowT > 0 && bowT < 3.6 ? Math.sin(((bowT % 1.2) / 1.2) * Math.PI) ** 1.5 : 0;
      const plant = window01(age, 4.6, 6.1, 0.55);
      const after = sstep(6.0, 6.6, age);
      const hy = lerp(L.sternY - 0.1 * k, L.browY - 0.16 * k, raise);
      const hz = lerp(L.front + 0.1 * k, L.browZ + 0.11 * k, raise);
      hand(0, 0.028 * k, hy, hz, ANJALI, 0, 0, 0.3, 0.7, 0.35);
      hand(1, 0.028 * k, hy, hz, ANJALI, 0, 0, 0.55, 0.7, 0.35);
      TG[PP] += 0.25 * bow + 0.25 * plant;
      TG[SP] += 0.12 * bow + 0.2 * plant;
      TG[NP] += 0.2 * bow;
      if (sit === 'stand') TG[PZ] -= 0.03 * bow;
      if (plant > 0.01) {
        PITCH = h.x[PP] + h.x[SP] + h.x[CP];
        const sx = TG[HB + 10];
        const sy = TG[HB + 11];
        const sz = TG[HB + 12];
        bodyHand(1, 0.03, L.hipY + 0.1 * lk, 0.5 * lk, -0.9, 0, 0, 0.55, 0.6);
        const b = HB + 10;
        TG[b] = lerp(sx, TG[b], plant);
        TG[b + 1] = lerp(sy, TG[b + 1], plant);
        TG[b + 2] = lerp(sz, TG[b + 2], plant);
        TG[b + 3] = lerp(ANJALI, TG[b + 3], plant);
        hand(0, 0.06 * k, lerp(hy, L.sternY - 0.18 * k, plant), lerp(hz, L.front + 0.2 * k, plant), lerp(ANJALI, -1.2, plant), 0, 0, 0.3, 1.0);
      }
      if (after > 0) {
        for (let s = 0; s < 2; s++) hand(s, 0.028 * k, L.sternY - 0.1 * k, L.front + 0.1 * k, ANJALI, 0, 0, 0.05, 0.9);
        TG[SP] = 0.06 + 0.06 * Math.sin(t * 1.2) * after;
      }
      TG[HW] = 0;
      break;
    }
    case Pose.Dance: {
      const ph = beat * Math.PI * 2;
      const ls = Math.sin(ph / 2);
      const half = Math.floor(beat / 4) % 2;
      const bounce = 0.5 + 0.5 * Math.cos(ph);
      TG[PY] -= (0.02 + 0.035 * bounce) * lk;
      TG[PX] = 0.05 * ls * lk;
      TG[PR] = 0.07 * ls;
      TG[PW] = 0.1 * Math.sin(ph / 2 + 0.6);
      TG[SR] = -0.05 * ls;
      TG[CW] = -0.08 * Math.sin(ph / 2 + 0.6);
      TG[NP] = 0.05 + 0.07 * Math.abs(Math.sin(ph));
      TG[HR] = -0.06 * ls;
      TG[HW] = 0;
      // step-touch: the free foot taps out to the side on the off-beat
      foot(0, D.hipW + 0.02 + 0.09 * Math.max(0, -ls), ank + 0.03 * Math.max(0, -Math.sin(ph)) * (ls < 0 ? 1 : 0), 0.02, ls < 0 ? 0.15 : 0, 0.15, 0, 0.2);
      foot(1, D.hipW + 0.02 + 0.09 * Math.max(0, ls), ank + 0.03 * Math.max(0, -Math.sin(ph)) * (ls > 0 ? 1 : 0), 0.02, ls > 0 ? 0.15 : 0, 0.15, 0, 0.2);
      if (half) {
        const w = Math.sin(ph);
        hand(0, L.shX + (0.12 + 0.08 * w) * k, L.shY + 0.4 * k, 0.08 * k, -3.0, 0, 0.2 * w, 0.1, 0.6);
        hand(1, L.shX + (0.12 - 0.08 * w) * k, L.shY + 0.4 * k, 0.08 * k, -3.0, 0, -0.2 * w, 0.1, 0.6);
      } else {
        const w = Math.sin(ph);
        hand(0, 0.2 * k, (-0.08 + 0.1 * w) * k, (0.2 + 0.12 * w) * k, -1.3, 0, 0, 0.85, 0.5);
        hand(1, 0.2 * k, (-0.08 - 0.1 * w) * k, (0.2 - 0.12 * w) * k, -1.3, 0, 0, 0.85, 0.5);
      }
      break;
    }
  }

  // ---- local gesture on top (chores, wish tree, stick tube, riddles) ----
  if (act) {
    TG[HW] = 0;
    const stagger = speed < 0.15 && sit === 'stand';
    switch (act) {
      case 'sweep': {
        // long strokes: the arms lead, hips and chest follow, eyes on the bristles
        const s0 = Math.sin((a * Math.PI * 2) / 2.6);
        const sh = Math.sign(s0) * Math.abs(s0) ** 0.7;
        const roll = 0.36 * Math.sign(Math.sin((a - 0.12) * ((Math.PI * 2) / 2.6))) * Math.abs(Math.sin((a - 0.12) * ((Math.PI * 2) / 2.6))) ** 0.7;
        const pitch = -0.38;
        TG[PRP] = pitch;
        TG[PRR] = roll;
        TG[PP] += 0.12;
        TG[SP] += 0.16;
        TG[PW] = -0.1 * sh;
        TG[CW] = -0.08 * sh;
        TG[PX] = 0.022 * sh * lk;
        TG[NP] = 0.3;
        TG[HW] = 0.12 * sh;
        const rx = -0.05 * k - 0.05 * sh * k;
        const ry = -0.06 * k;
        const rz = L.front + 0.16 * k;
        hand(1, -rx, ry, rz, -1.25, 0, 0, 0.85, 0.35);
        // left hand lower down the handle, along the broom axis (in chest space)
        const p = pitch - PITCH;
        const len = 0.3 * k;
        hand(0, rx + Math.sin(roll) * len + 0.025, ry - Math.cos(roll) * Math.cos(p) * len, rz - Math.cos(roll) * Math.sin(p) * len, -1.0, -0.6, 0, 0.85, 0.5);
        if (stagger) {
          foot(0, D.hipW + 0.02, ank, 0.13 * lk, 0, 0.12, 0, 0.1);
          foot(1, D.hipW + 0.02, ank, -0.1 * lk, 0.05, 0.25, 0, 0.1);
        }
        break;
      }
      case 'wipe': {
        const c = a * 3.2;
        TG[PP] += 0.24;
        TG[SP] += 0.2;
        TG[PZ] -= 0.03;
        TG[NP] = 0.3;
        TG[HW] = 0.18 * Math.cos(c);
        TG[PX] = 0.012 * Math.cos(c);
        TG[SR] = 0.03 * Math.sin(c);
        PITCH = h.x[PP] + h.x[SP] + h.x[CP];
        bodyHand(1, 0.08 + 0.08 * Math.cos(c), 0.93 * (L.hipY / 0.905), 0.44 * lk + 0.07 * Math.sin(c), -HALF_PI, -HALF_PI, 0, 0.3, 0.5);
        bodyHand(0, 0.19, 0.92 * (L.hipY / 0.905), 0.38 * lk, -HALF_PI, -HALF_PI, 0, 0.15, 0.6);
        break;
      }
      case 'stir': {
        const c = a * 2.2;
        TG[PP] += 0.06;
        TG[SP] += 0.12;
        TG[NP] = 0.38;
        TG[SR] = 0.02 * Math.sin(c);
        TG[PRP] = -0.55 + 0.08 * Math.cos(c);
        TG[PRR] = 0.08 * Math.sin(c);
        PITCH = h.x[PP] + h.x[SP] + h.x[CP];
        const hk = L.hipY / 0.905;
        bodyHand(1, 0.06 + 0.06 * Math.sin(c), 1.12 * hk, 0.34 * lk + 0.06 * Math.cos(c), -1.2, 0, 0, 0.9, 0.45);
        bodyHand(0, 0.2, 0.97 * hk, 0.4 * lk, -HALF_PI, -HALF_PI, 0, 0.5, 0.6);
        break;
      }
      case 'prep': {
        // picking and sorting vegetables at the table: each hand picks, lifts, drops to the middle
        TG[PP] += 0.1;
        TG[SP] += 0.16;
        TG[NP] = 0.45;
        PITCH = h.x[PP] + h.x[SP] + h.x[CP];
        const hk = L.hipY / 0.905;
        for (let s = 0; s < 2; s++) {
          const c = ((a + s * 0.8) % 1.6) / 1.6;
          const lift = window01(c, 0.15, 0.75, 0.2);
          const pinch = sstep(0.05, 0.15, c) * (1 - sstep(0.75, 0.85, c));
          const toMid = smooth(clamp01((c - 0.3) / 0.35));
          bodyHand(s, lerp(0.16, 0.05, toMid), 0.9 * hk + 0.06 * lift, (0.4 + 0.05 * toMid) * lk, -HALF_PI + 0.3, -HALF_PI, 0, 0.3 + 0.5 * pinch, 0.5);
        }
        TG[HW] = 0.1 * Math.sin((a * Math.PI * 2) / 1.6);
        break;
      }
      case 'ringBell': {
        // 4 s stroke: settle → pull the striker log back (lean back) → drive it into the bell at 55% → follow through, recover
        const c = (a % 4) / 4;
        const pull = c < 0.08 ? 0 : c < 0.45 ? smooth((c - 0.08) / 0.37) : 0;
        const drive = c >= 0.45 && c < 0.55 ? ((c - 0.45) / 0.1) ** 2 : 0;
        const follow = c >= 0.55 ? 1 - smooth(clamp01((c - 0.55) / 0.3)) : 0;
        const fwd = Math.max(drive, follow);
        const back = c < 0.45 ? pull : c < 0.55 ? 1 - drive : 0;
        const settle = c < 0.08 ? Math.sin((c / 0.08) * Math.PI) : 0;
        TG[SP] += -0.1 * back + 0.16 * fwd + 0.03 * settle;
        TG[PZ] += -0.05 * back + 0.04 * fwd;
        TG[NP] = 0.04;
        PITCH = h.x[PP] + h.x[SP] + h.x[CP];
        const hk = L.hipY / 0.905;
        const z = (0.5 - 0.2 * back + 0.14 * fwd) * lk;
        const y = (1.36 - 0.04 * back) * hk;
        bodyHand(0, 0.035, y, z, -HALF_PI, -HALF_PI * 0.6, 0, 0.9, 0.5);
        bodyHand(1, 0.035, y - 0.05, z - 0.02, -HALF_PI, -HALF_PI * 0.6, 0, 0.9, 0.5);
        if (stagger) {
          foot(0, D.hipW + 0.02, ank, 0.17 * lk, 0, 0.08, 0, 0.1);
          foot(1, D.hipW + 0.03, ank, -0.17 * lk, 0.1 * back, 0.3, 0, 0.1);
        }
        break;
      }
      case 'moktak':
        moktakTargets(h, sit, a, k, lk);
        break;
      case 'water': {
        const tilt = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(a * 0.8));
        TG[PRP] = tilt;
        TG[SP] += 0.1;
        TG[SR] = 0.04;
        TG[NP] = 0.35;
        TG[HW] = -0.15;
        PITCH = h.x[PP] + h.x[SP] + h.x[CP];
        bodyHand(1, 0.19, 0.86 * (L.hipY / 0.905), 0.24 * lk, -HALF_PI + 0.4, 0, 0, 0.85, 0.3);
        TG[HB + 19] = 0;
        break;
      }
      case 'carry':
        // a sack on the right shoulder steadied by the right hand; lean away from the load
        hand(1, L.shX + 0.03 * k, L.shY + 0.2 * k, 0.05 * k, -2.9, 0, 0, 0.6, 0.15, 0.85);
        TG[SR] = -0.06;
        TG[HR] = -0.05;
        TG[SP] += 0.05;
        break;
      case 'pick': {
        // reach up into the branches (on tiptoe, eyes up), grab, pull the bud down and look at it
        const reach = window01(a, 0, 1.4, 0.45);
        const look = sstep(1.2, 1.6, a);
        FL.bud = a > 1.0;
        hand(1, 0.1 * k + 0.02, lerp(L.shY - L.reach * 0.97, L.shY + 0.5 * k, reach), lerp(0.04, 0.22, reach) * k, lerp(-0.12, -2.8, reach), 0, 0, a > 0.9 ? 0.85 : 0.2, 0.3, 0.6);
        if (look > 0) {
          const b = HB + 10;
          TG[b] = lerp(TG[b], -0.04 * k, look);
          TG[b + 1] = lerp(TG[b + 1], L.sternY - 0.02 * k, look);
          TG[b + 2] = lerp(TG[b + 2], L.front + 0.2 * k, look);
          TG[b + 3] = lerp(TG[b + 3], -1.3, look);
        }
        hand(0, L.shX + 0.08 * k, L.shY - L.reach * 0.85, 0.06 * k, -0.3, 0, 0.2, 0.3, 0.3);
        TG[NP] = -0.45 * reach + 0.3 * look;
        TG[SP] -= 0.05 * reach;
        for (let s = 0; s < 2; s++) {
          TG[FB + s * 7 + 3] = 0.4 * reach;
          TG[FB + s * 7 + 1] += 0.06 * reach;
        }
        TG[PY] += 0.05 * reach;
        break;
      }
      case 'shake': {
        // tube in both hands, tilted forward, shaken in short bursts
        const burst = Math.sin(a * 18) * (Math.sin(a * 2.2) > -0.3 ? 1 : 0.15);
        hand(0, 0.04 * k, -0.15 * k, L.front + 0.2 * k, -1.2, -0.5, 0, 0.8, 0.5);
        hand(1, 0.04 * k, -0.12 * k, L.front + 0.2 * k, -1.2, -0.5, 0, 0.8, 0.5);
        ADD[1] = ADD[4] = 0.012 * burst;
        ADD[2] = ADD[5] = 0.018 * burst;
        TG[PRP] = 0.55;
        ADD[6] = 0.07 * burst;
        TG[SP] += 0.1;
        TG[NP] = 0.25;
        break;
      }
      case 'think':
        // chin on the right hand, left arm across the belly holding the elbow
        hand(1, 0.02, L.chinY - 0.1 * k, L.chinZ + 0.06 * k, -2.75, 0, 0, 0.75, 0.1, 0.7);
        hand(0, -0.06 * k, -0.17 * k, L.front + 0.07 * k, -0.3, 0, -HALF_PI, 0.4, 0.3);
        TG[HR] = 0.08;
        TG[HW] = Math.sin(a * 0.4) * 0.2;
        TG[NP] = 0.1 + Math.sin(a * 0.8) * 0.04;
        break;
      case 'read':
        hand(1, 0.06 * k, -0.02 * k, L.front + 0.2 * k, -1.35, 0, 0, 0.6, 0.4);
        hand(0, 0.06 * k, -0.04 * k, L.front + 0.18 * k, -1.3, 0, -0.3, 0.4, 0.4);
        TG[PRP] = -0.55;
        TG[NP] = 0.35;
        TG[HW] = 0.05 * Math.sin(a * 1.3);
        break;
    }
  }
}

/** wooden-fish strokes at 1.1 Hz with the impact exactly where npcs.ts plays the sound */
function moktakTargets(h: HQ, sit: Sit, a: number, k: number, lk: number) {
  const L = LM;
  const u = (((a * 1.1 - 0.25) % 1) + 1) % 1; // 0 at impact
  let up: number;
  if (u < 0.1) up = 0.22 * Math.sin((Math.PI * u) / 0.1); // rebound
  else if (u < 0.45) up = 0.0;
  else if (u < 0.85) up = smooth((u - 0.45) / 0.4); // anticipation: lift
  else up = 1 - ((u - 0.85) / 0.15) ** 2; // accelerating strike
  const seated = sit !== 'stand';
  const baseY = seated ? h.x[PY] + 0.05 : 0.86 * (L.hipY / 0.905);
  PITCH = h.x[PP] + h.x[SP] + h.x[CP];
  bodyHand(1, 0.06, baseY + 0.16 * up, (0.4 - 0.05 * up) * lk, -1.0 + 0.3 * up, 0, 0, 0.9, 0.35);
  if (seated) bodyHand(0, 0.12 * lk, h.x[PY] + 0.03, 0.27 * lk, -HALF_PI + 0.2, -HALF_PI, 0, 0.35, 0.4);
  else hand(0, 0.06 * k, -0.15 * k, LM.front + 0.12 * k, -1.0, 0, -0.5, 0.4, 0.5);
  TG[PRP] = -0.95 + 0.45 * (1 - up);
  TG[SP] += 0.08;
  TG[NP] = 0.2 + 0.04 * (u < 0.1 ? 1 - u / 0.1 : 0);
  TG[HB + 19] = 0;
}

/** high / ultra rig of one avatar */
class HQ {
  readonly D: Dims;
  readonly lm: Land;
  readonly ultra: boolean;
  readonly b: Record<string, THREE.Bone>;
  readonly skeleton: THREE.Skeleton;
  readonly near: THREE.SkinnedMesh[] = [];
  readonly far: THREE.SkinnedMesh[] = [];
  lodFar = false;
  /** spring state */
  readonly x = new Float32Array(NCH);
  readonly v = new Float32Array(NCH);
  private started = false;
  readonly chestInv = new THREE.Matrix4();
  private chestQ = new THREE.Quaternion();
  private phase = Math.random();
  private px = 0;
  private pz = 0;
  private pyaw = 0;
  private vx = 0;
  private vz = 0;
  private az = 0;
  private yawRate = 0;
  private lean = 0;
  private hemP = 0;
  private hemR = 0;
  private hemVP = 0;
  private hemVR = 0;
  private blinkAt = 1 + Math.random() * 4;
  private blinkT = -1;
  private sacAt = 0;
  private sacX = 0;
  private sacY = 0;
  wsSide = 0;
  private wsAt = 3 + Math.random() * 5;
  private sit: Sit = 'stand';
  private sitAge = 9;
  private lastAct: Action | null = null;
  private actAge = 9;
  private lastPose: Pose = Pose.Idle;
  private prevHW = 0;
  readonly props = new Map<PropName, THREE.Object3D>();
  private palm: [THREE.Vector3, THREE.Vector3];
  private shRest: [THREE.Vector3, THREE.Vector3];
  /** per side: f0a f0b f0c … f3c t0 t1 t2 */
  private fingers: THREE.Bone[][];
  /** per side: eye, upper lid, lower lid */
  private eyeB: THREE.Bone[][];

  constructor(root: THREE.Group, robeColor: string, sashColor: string, detail: 'high' | 'ultra') {
    this.ultra = detail === 'ultra';
    this.D = this.ultra ? ULTRA_DIMS : HIGH_DIMS;
    this.lm = landmarks(this.D);
    const rig = makeRig(this.D);
    this.b = rig.by;
    root.add(rig.by.body);
    root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(rig.bones);
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0), 1.3);
    const make = (style: Style, list: THREE.SkinnedMesh[]) => {
      const kit = getKit(style, this.D);
      for (const kind of MAT_KINDS) {
        const g = kit.geos[kind];
        if (!g) continue;
        const mesh = new THREE.SkinnedMesh(g, hqMaterial(style, kind, kind === 'sash' ? sashColor : robeColor));
        mesh.bind(this.skeleton, new THREE.Matrix4());
        mesh.boundingSphere = sphere;
        mesh.castShadow = true;
        root.add(mesh);
        list.push(mesh);
      }
    };
    make(this.ultra ? 'U' : 'H', this.near);
    if (this.ultra) {
      make('H', this.far);
      for (const m of this.far) m.visible = false;
    }
    const hs = this.D.palm / 0.092;
    this.palm = [new THREE.Vector3(-0.018 * hs, -this.D.palm * 0.62, 0.004), new THREE.Vector3(0.018 * hs, -this.D.palm * 0.62, 0.004)];
    this.shRest = [this.b.shL.position.clone(), this.b.shR.position.clone()];
    this.fingers = SIDES.map((s) => [...[0, 1, 2, 3].flatMap((f) => ['a', 'b', 'c'].map((j) => this.b[`f${f}${j}${s}`])), ...[0, 1, 2].map((j) => this.b[`t${j}${s}`])]);
    this.eyeB = SIDES.map((s) => [this.b['eye' + s], this.b['lidU' + s], this.b['lidL' + s]]);
  }

  /** far avatars use the cheaper high mesh on the same skeleton (ultra only) */
  setLod(dist: number) {
    if (!this.ultra) return;
    const far = this.lodFar ? dist > 12 : dist > 15;
    if (far === this.lodFar) return;
    this.lodFar = far;
    for (const m of this.near) m.visible = !far;
    for (const m of this.far) m.visible = far;
  }

  prop(name: PropName, on: boolean, where: 'L' | 'R' | 'T' = 'R') {
    let p = this.props.get(name);
    if (!p) {
      if (!on) return;
      p = makeProp(name, true);
      p.traverse((o) => (o.userData.kind = 'avatar'));
      if (where === 'T') {
        // sack on the right shoulder (its mesh sits at +0.16, +0.5 inside the prop group)
        p.position.set(-this.lm.shX * 0.75 - 0.16, this.lm.shY + 0.12 * this.lm.k - 0.5, -0.02);
        this.b.chest.add(p);
      } else {
        const s = where === 'L' ? 0 : 1;
        p.position.copy(this.palm[s]);
        this.b[where === 'L' ? 'wrL' : 'wrR'].add(p);
      }
      this.props.set(name, p);
    }
    p.visible = on;
    return p;
  }

  /** orient a hand-held prop in body space: Q_local = inv(Q_wrist_in_body) · Q_desired */
  private orient(p: THREE.Object3D | undefined, s: number, pitch: number, yaw: number, roll: number) {
    if (!p || !p.parent || p.parent === this.b.chest) return;
    const hb = HB + s * 10;
    _q1.setFromEuler(_e1.set(this.x[hb + 3], this.x[hb + 4], this.x[hb + 5], 'XYZ'));
    _q2.multiplyQuaternions(this.chestQ, _q1).invert();
    _q3.setFromEuler(_e1.set(pitch, yaw, roll, 'XYZ'));
    p.quaternion.multiplyQuaternions(_q2, _q3);
  }

  headphones(group: THREE.Object3D) {
    const A = this.D.headA;
    group.position.set(...this.D.headC);
    group.scale.setScalar((Math.max(A[0], A[2]) / 0.17) * 1.12);
    this.b.head.add(group);
  }

  animate(
    av: { t: number; poseAge: number; seatStyle: 'floor' | 'bench'; bowStyle: 'prostrate' | 'church'; root: THREE.Group },
    dt: number,
    pose: Pose,
    speed: number,
    kneel: boolean,
    beat: number,
    act: Action | null,
    actionAge: number,
  ) {
    const D = this.D;
    const L = this.lm;
    const t = av.t;
    const x = this.x;
    const vv = this.v;
    const b = this.b;
    LM = L;
    CHEST_INV = this.chestInv;

    // ---- velocity, acceleration and turn rate from the root (set by the caller) ----
    const root = av.root;
    const ry = root.rotation.y;
    if (dt > 0) {
      const dx = root.position.x - this.px;
      const dz = root.position.z - this.pz;
      if (!this.started || dx * dx + dz * dz > 9) {
        this.vx = this.vz = this.az = this.yawRate = 0;
      } else {
        const c = Math.cos(ry);
        const s = Math.sin(ry);
        const lvx = (dx * c - dz * s) / dt;
        const lvz = (dx * s + dz * c) / dt;
        const nvz = damp(this.vz, lvz, 10, dt);
        this.az = damp(this.az, (nvz - this.vz) / dt, 6, dt);
        this.vz = nvz;
        this.vx = damp(this.vx, lvx, 10, dt);
        let dy = ry - this.pyaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yawRate = damp(this.yawRate, dy / dt, 8, dt);
      }
    }
    this.px = root.position.x;
    this.pz = root.position.z;
    this.pyaw = ry;

    // ---- posture: standing, cross-legged, kneeling or on a bench ----
    let sit: Sit = 'stand';
    const seated = (kneel || pose === Pose.Sit) && speed < 0.4;
    // church: bow where you are (standing, or upright on the pew); temple: kneel for the prostration
    if (pose === Pose.Bow && av.bowStyle === 'church') sit = seated ? (av.seatStyle === 'bench' ? 'bench' : 'lotus') : 'stand';
    else if (pose === Pose.Bow) sit = av.seatStyle === 'bench' && kneel ? 'bench' : 'seiza';
    else if (seated) sit = av.seatStyle === 'bench' ? 'bench' : act === 'moktak' || pose === Pose.Moktak ? 'seiza' : 'lotus';
    if (sit !== this.sit) {
      this.sit = sit;
      this.sitAge = 0;
    }
    this.sitAge += dt;
    if (act !== this.lastAct) {
      this.lastAct = act;
      this.actAge = 0;
    }
    this.actAge += dt;
    if (pose !== this.lastPose) this.lastPose = pose;

    // idle weight shifts
    if (t > this.wsAt) {
      this.wsAt = t + 4 + Math.random() * 7;
      const r = Math.random();
      this.wsSide = r < 0.4 ? 1 : r < 0.8 ? -1 : 0;
    }

    PITCH = x[PP] + x[SP] + x[CP];
    hqTargets(this, pose, act, actionAge, av.poseAge, t, sit, beat, speed, av.bowStyle);

    // ---- springs: gentle while a new pose / action / seat blends in, tighter once settled ----
    const since = Math.min(av.poseAge, this.actAge, this.sitAge);
    const tr = smooth(clamp01(since / 0.9));
    const sitting = this.sitAge < 1.6 ? 1 - smooth(this.sitAge / 1.6) : 0; // sit-down / stand-up takes longer
    const busy = pose === Pose.Dance ? 15 : act === 'shake' || act === 'moktak' || pose === Pose.Moktak ? 16 : act ? 11 : 9;
    const wb = lerp(4.5, pose === Pose.Dance ? 13 : 8, tr) * (1 - 0.35 * sitting);
    const wh = lerp(5, busy, tr);
    const wf = lerp(5, pose === Pose.Dance ? 16 : 10, tr) * (1 - 0.4 * sitting);
    OM.fill(wb, 0, HB);
    OM.fill(wh, HB, FB);
    OM.fill(wf, FB, PRP);
    OM[PRP] = OM[PRY] = OM[PRR] = wh;
    OM[HW] = 2.6;
    OM[LID] = 6;
    if (pose === Pose.Dance) OM[HW] = wb;
    // the walk weight follows movement (and stepping in place when turning on the spot)
    const turnStep = speed < 0.3 && Math.abs(this.yawRate) > 1.2 && sit === 'stand';
    const moving = (speed > 0.12 || turnStep) && sit === 'stand';
    TG[GAIT] = moving ? 1 : 0;
    OM[GAIT] = moving ? 9 : 5;
    if (!this.started) {
      this.started = true;
      x.set(TG);
      vv.fill(0);
    }
    for (let i = 0; i < NCH; i++) {
      const w = OM[i];
      const d = x[i] - TG[i];
      const e = Math.exp(-w * dt);
      const tmp = (vv[i] + w * d) * dt;
      x[i] = TG[i] + (d + tmp) * e;
      vv[i] = (vv[i] - w * tmp) * e;
    }

    // ---- gait (procedural, distance driven → no foot sliding) ----
    const g = x[GAIT];
    const gs = turnStep ? Math.max(speed, 0.6) : speed;
    const kw = clamp01(gs / 1.4);
    const run = sstep(2.0, 3.2, speed);
    const lk = L.lk;
    const stride = lerp(clampN(0.5 + 0.46 * gs, 0.5, 1.5), 1.25 + 0.28 * speed, run) * lk;
    if (moving) this.phase = (this.phase + (gs * dt) / stride) % 1;
    const ph = this.phase;
    const beta = lerp(0.6, 0.38, run);
    const Dst = beta * stride * (turnStep ? 0.2 : 1);
    const lift = (0.06 + 0.02 * kw + 0.12 * run) * lk;
    const toeLen = D.footLen * 0.56;
    // pelvis: bob (low at heel strike for a walk, low at mid-stance for a run), sway over the stance leg, roll, yaw
    const c2 = Math.cos(4 * Math.PI * (ph - beta / 2));
    const c1 = Math.cos(2 * Math.PI * (ph - beta / 2));
    const bob = lerp(-0.022 * kw + 0.016 * kw * c2, -0.035 - 0.022 * c2, run) * lk * g;
    const swayX = 0.018 * kw * (1 - run) * c1 * lk * g;
    const roll = 0.045 * kw * c1 * g;
    gaitFoot(ph, beta, Dst, lift);
    const zL = GF[0];
    gaitFoot((ph + 0.5) % 1, beta, Dst, lift);
    const zR = GF[0];
    const zd = Dst > 1e-4 ? (zL - zR) / Dst : 0;
    const yaw = -0.13 * kw * zd * g;
    const chestYaw = -1.45 * yaw;
    // lean: forward with speed and acceleration, into turns
    const fwdLean = (0.03 + 0.04 * kw + 0.08 * run) * g + clampN(this.az * 0.03, -0.1, 0.14) * g;
    this.lean = damp(this.lean, clampN(-this.vz * this.yawRate * 0.045, -0.22, 0.22) * g, 6, dt);

    // ---- apply: body → pelvis → spine → chest → neck → head ----
    const breath = Math.sin(t * (FL.calm ? 1.15 : 1.6) + this.phase * 0.0);
    b.body.rotation.set(0, 0, this.lean);
    b.pelvis.position.set(x[PX] + swayX, x[PY] + bob, x[PZ]);
    b.pelvis.rotation.set(x[PP], x[PW] + yaw, x[PR] + roll);
    b.spine.rotation.set(x[SP] * 0.5 + fwdLean * 0.6 - 0.006 * breath, x[SW] - yaw * 0.4, x[SR]);
    b.chest.rotation.set(x[SP] * 0.5 + x[CP] + fwdLean * 0.4 - 0.008 * breath, x[CW] + chestYaw * 0.6, x[SR] * 0.5);
    const stab = -(fwdLean + x[PP] * 0.3) * 0.85; // keep the gaze level
    const look = clampN(this.yawRate * 0.28, -0.5, 0.5) * g; // glance into the turn
    const headYaw = x[HW] + look - (yaw * 0.6 + chestYaw * 0.6) * 0.9;
    b.neck.rotation.set((x[NP] + stab) * 0.4, headYaw * 0.35, x[HR] * 0.4);
    b.head.rotation.set((x[NP] + stab) * 0.6 + x[HP], headYaw * 0.65, x[HR] * 0.6 - x[SR] * 0.3);
    for (let s = 0; s < 2; s++) b[s === 0 ? 'shL' : 'shR'].position.copy(this.shRest[s]).y += 0.003 * breath;

    // chest transform in body space (for body-anchored hand targets next frame, and props)
    b.pelvis.updateMatrix();
    b.spine.updateMatrix();
    b.chest.updateMatrix();
    _m2.multiplyMatrices(b.pelvis.matrix, b.spine.matrix).multiply(b.chest.matrix);
    this.chestInv.copy(_m2).invert();
    this.chestQ.copy(b.pelvis.quaternion).multiply(b.spine.quaternion).multiply(b.chest.quaternion);

    // ---- legs: IK to the stance / gait foot targets ----
    _q3.copy(b.pelvis.quaternion).invert();
    for (let s = 0; s < 2; s++) {
      const m = s === 0 ? 1 : -1;
      const fb = FB + s * 7;
      gaitFoot((ph + 0.5 * s) % 1, beta, Dst, lift);
      const gp = GF[2];
      const gy = D.ankle + GF[1] + (gp > 0 ? toeLen * Math.sin(gp) : 0.06 * Math.sin(-gp) * 0.6);
      const gz = GF[0] + 0.03 * lk;
      const gx = m * (D.hipW * 0.95 - 0.012 * kw);
      const sx = x[fb];
      const sy = x[fb + 1];
      const sz = x[fb + 2];
      let fy = lerp(sy, gy, g);
      // settling step when stopping / starting: lift the foot that still has to travel
      if (g > 0.01 && g < 0.99) fy += 4 * g * (1 - g) * 0.05 * clamp01(Math.abs(gz - sz) / 0.15);
      _v1.set(lerp(sx, gx, g), fy, lerp(sz, gz, g)).sub(b.pelvis.position).applyQuaternion(_q3);
      const pitch = lerp(x[fb + 3], gp, g);
      _v2.set(m * D.hipW, 0, 0);
      _v3.set(m * (0.12 + x[fb + 6]), 0, 1).normalize().applyQuaternion(_q3);
      const th = b[s === 0 ? 'thL' : 'thR'];
      const kn = b[s === 0 ? 'knL' : 'knR'];
      // copy the target out of the scratch vectors solveIK uses
      _v6.copy(_v1);
      const T0x = _v6.x,
        T0y = _v6.y,
        T0z = _v6.z;
      const P0x = _v3.x,
        P0y = _v3.y,
        P0z = _v3.z;
      solveIK(_v2.set(m * D.hipW, 0, 0), _v6.set(T0x, T0y, T0z), D.thigh, D.shin, _v5.set(P0x, P0y, P0z), th, kn, true);
      // foot orientation in body space → local
      _q1.copy(b.pelvis.quaternion).multiply(th.quaternion).multiply(kn.quaternion).invert();
      _q2.setFromEuler(_e1.set(pitch, lerp(x[fb + 4], m * 0.06, g), x[fb + 5] * (1 - g), 'YXZ'));
      b[s === 0 ? 'ftL' : 'ftR'].quaternion.multiplyQuaternions(_q1, _q2);
      // toes stay on the ground while the heel rises
      b[s === 0 ? 'toL' : 'toR'].rotation.x = -Math.max(0, Math.min(pitch, 1.0)) * (pitch < 1.2 ? 1 : 0);
    }

    // ---- arms: IK to hand targets (+ walking swing with elbow lag) ----
    const A = (0.2 + 0.22 * kw) * (1 - 0.3 * run);
    gaitFoot((ph + 1 - 0.07) % 1, beta, Dst, lift);
    const zLl = GF[0];
    gaitFoot((ph + 0.5 - 0.07 + 1) % 1, beta, Dst, lift);
    const zRl = GF[0];
    const zdl = Dst > 1e-4 ? (zLl - zRl) / Dst : 0;
    const eps0 = 0.16 + 0.12 * kw + 1.0 * run;
    for (let s = 0; s < 2; s++) {
      const m = s === 0 ? 1 : -1;
      const hb = HB + s * 10;
      const sw = g * clamp01(x[hb + 9]);
      // left arm swings forward when the right foot is forward
      const al = -m * A * zd;
      const alag = -m * A * zdl;
      const bf = alag * 1.1 + eps0;
      const S = this.shRest[s];
      let tx = x[hb];
      let ty = x[hb + 1];
      let tz = x[hb + 2];
      let ox = x[hb + 3];
      let curl = x[hb + 6];
      if (sw > 0.001) {
        const sx = m * (L.shX + 0.035 * L.k) - m * 0.03 * Math.max(0, Math.sin(bf));
        const sy = S.y - D.upper * Math.cos(al) - D.fore * Math.cos(bf);
        const sz = S.z + D.upper * Math.sin(al) + D.fore * Math.sin(bf);
        tx = lerp(tx, sx, sw);
        ty = lerp(ty, sy, sw);
        tz = lerp(tz, sz, sw);
        ox = lerp(ox, -bf * 0.45 - 0.08, sw);
        curl = lerp(curl, 0.42 + 0.35 * run, sw);
      }
      tx += ADD[s * 3];
      ty += ADD[s * 3 + 1];
      tz += ADD[s * 3 + 2];
      const sh = b[s === 0 ? 'shL' : 'shR'];
      const el = b[s === 0 ? 'elL' : 'elR'];
      const ef = x[hb + 8];
      solveIK(_v6.copy(sh.position), _v4.set(tx, ty, tz), D.upper, D.fore, _v5.set(m * x[hb + 7], -1, -1 + 2 * ef), sh, el, false);
      // ↑ solveIK reuses scratch vectors internally; inputs are read before being overwritten
      _q1.copy(sh.quaternion).multiply(el.quaternion).invert();
      _q2.setFromEuler(_e1.set(ox, x[hb + 4], x[hb + 5], 'XYZ'));
      b[s === 0 ? 'wrL' : 'wrR'].quaternion.multiplyQuaternions(_q1, _q2);
      // fingers
      const fb = this.fingers[s];
      const c = clamp01(curl);
      for (let f = 0; f < 4; f++) {
        const ff = 1 + f * 0.06;
        fb[f * 3].rotation.set((f - 1.5) * 0.04 * (1 - c), 0, -m * c * 0.95 * ff);
        fb[f * 3 + 1].rotation.z = -m * c * 1.2 * ff;
        fb[f * 3 + 2].rotation.z = -m * c * 0.8 * ff;
      }
      fb[12].rotation.set(-0.55 - c * 0.2, 0, -m * (0.3 + c * 0.35));
      fb[13].rotation.z = -m * c * 0.45;
      fb[14].rotation.z = -m * c * 0.5;
    }

    // ---- hem: under-damped spring driven by velocity, acceleration, turning and the stride ----
    {
      const tp = clampN(0.05 * this.vz + 0.02 * this.az, -0.22, 0.3);
      const tr2 = clampN(-0.05 * this.vx - 0.04 * this.vz * this.yawRate, -0.22, 0.22);
      const w = 7;
      const z = 0.32;
      this.hemVP += (-(w * w) * (this.hemP - tp) - 2 * z * w * this.hemVP) * dt;
      this.hemVR += (-(w * w) * (this.hemR - tr2) - 2 * z * w * this.hemVR) * dt;
      this.hemP += this.hemVP * dt;
      this.hemR += this.hemVR * dt;
      if (!(Math.abs(this.hemP) < 2)) this.hemP = this.hemVP = 0;
      if (!(Math.abs(this.hemR) < 2)) this.hemR = this.hemVR = 0;
      const fl = 0.025 * kw * g;
      b.hem.rotation.set(this.hemP - x[PP] * 0.5 + fl * Math.sin(4 * Math.PI * ph), 0, this.hemR + fl * Math.cos(2 * Math.PI * ph) * 0.8);
    }

    // ---- eyes: saccades, lead the head into turns; blinks (also on big head turns) ----
    if (t > this.sacAt) {
      this.sacAt = t + 0.4 + Math.random() * 1.8;
      this.sacX = (Math.random() - 0.5) * 0.25;
      this.sacY = (Math.random() - 0.5) * 0.12;
    }
    const hwv = Math.abs(x[HW] - this.prevHW) / Math.max(dt, 1e-3);
    this.prevHW = x[HW];
    if (t > this.blinkAt || (hwv > 1.2 && this.blinkT < 0 && Math.random() < 0.05)) {
      this.blinkAt = t + 2.2 + Math.random() * 4;
      this.blinkT = 0;
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const bt = this.blinkT;
      blink = bt < 0.07 ? bt / 0.07 : bt < 0.1 ? 1 : bt < 0.24 ? 1 - (bt - 0.1) / 0.14 : 0;
      if (bt >= 0.24) this.blinkT = -1;
    }
    const eyeYaw = clampN(TG[HW] - x[HW], -0.35, 0.35) + this.sacX + look * 0.6;
    const eyePitch = this.sacY + (FL.calm ? 0.25 : 0) - stab * 0.3;
    TG[LID] = FL.calm ? 0.35 : 1;
    const open = x[LID] * (1 - blink);
    for (let s = 0; s < 2; s++) {
      const eb = this.eyeB[s];
      const eye = eb[0];
      const lidU = eb[1];
      const lidL = eb[2];
      eye.rotation.set(eyePitch, eyeYaw, 0);
      if (this.ultra) {
        lidU.rotation.x = lerp(0.24, -0.42 + eyePitch * 0.6, open);
        lidL.rotation.x = lerp(0.06, 0.34 + eyePitch * 0.2, open);
      } else eye.scale.y = lerp(0.12, 1, open);
    }

    // ---- props ----
    const tp = this.prop('teapot', FL.teapot);
    this.orient(tp, 1, 0, 0, -0.95 * FL.pot);
    const cp = this.prop('cup', FL.cup, 'L');
    this.orient(cp, 0, x[PRP] * (pose === Pose.DrinkTea ? 1 : 0), 0, 0);
    const st = this.prop('stream', FL.pour, 'L');
    this.orient(st, 0, 0, 0, 0);
    const inc = this.prop('incense', FL.incense);
    this.orient(inc, 1, 0, 0, 0);
    for (let i = 0; i < ACTION_PROPS.length; i++) {
      const ap = ACTION_PROPS[i];
      const where = ap[2];
      const p = this.prop(ap[1], act === ap[0], where);
      if (p && p.visible) this.orient(p, where === 'L' ? 0 : 1, x[PRP] + ADD[6], x[PRY], x[PRR]);
    }
    const bud = this.prop('bud', act === 'pick' && FL.bud);
    if (bud && bud.visible) this.orient(bud, 1, 0, 0, 0);
  }
}

export interface AvatarOptions {
  /** a computer-controlled novice monk: brown robe, a little smaller */
  novice?: boolean;
  /** character detail tier; defaults to the module default set with setAvatarDetail() ('medium') */
  detail?: AvatarDetail;
}

/** Procedural monk with pose-driven, critically-damped animation (classic or skinned high/ultra rig). */
export class Avatar {
  readonly root = new THREE.Group();
  readonly detail: AvatarDetail;
  /**
   * How this avatar sits when seated (Pose.Sit / kneel): 'floor' = cross-legged on a cushion
   * (kneeling for the wooden fish), 'bench' = upright on a pew / stool, feet on the floor
   * ≈0.45 m below the root. The caller keeps putting the root on the seat top.
   */
  seatStyle: 'floor' | 'bench' = 'floor';
  /**
   * What Pose.Bow looks like: 'prostrate' = the temple's full prostration (kneel, palms to the
   * forehead, hands to the floor); 'church' = a standing bow of the head and shoulders
   * (seated on a pew: a bow of the head only). Set by the caller from the place.
   */
  bowStyle: 'prostrate' | 'church' = 'prostrate';
  private hq: HQ | null = null;
  private body = new THREE.Group();
  private lower!: THREE.Mesh;
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private footL!: THREE.Mesh;
  private footR!: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  /** @internal animation clock (s) */
  t = Math.random() * 10;
  private s: State = { bodyY: 0, bend: 0, lx: 0, lz: 0, rx: 0, rz: 0, sway: 0, squash: 1, nod: 0, walk: 0, look: 0, hip: 0 };
  /** walk cycle advances with distance travelled → no foot sliding */
  private phase = 0;
  private label: THREE.Sprite | null = null;
  private labelText = '';
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  poseAge = 0;
  private lastPose: Pose = Pose.Idle;
  private props = new Map<PropName, THREE.Object3D>();
  private action: Action | null = null;
  private actionAge = 0;
  private actionUntil = Infinity;
  private nextBlink = 2 + Math.random() * 3;

  constructor(tint: number, isSelf: boolean, opts: AvatarOptions = {}) {
    this.detail = opts.detail ?? defaultDetail;
    if (this.detail === 'high' || this.detail === 'ultra') {
      const robeColor = opts.novice ? '#7c6b55' : isSelf ? '#b98a4e' : ROBE_TINTS[tint % ROBE_TINTS.length];
      const sashColor = opts.novice ? '#4f3f2e' : '#7a3b22';
      this.root.add(this.body);
      this.hq = new HQ(this.body, robeColor, sashColor, this.detail);
      if (opts.novice) this.body.scale.setScalar(0.86);
      this.root.add(new THREE.Mesh(shared.shadow, shared.shadowMat));
      if (isSelf) this.root.add(new THREE.Mesh(shared.ring, shared.ringMat));
      this.root.traverse((o) => (o.userData.kind = 'avatar'));
      return;
    }
    const low = this.detail === 'low';
    const G: ClassicGeo = low ? (lowGeo ??= classicGeometry(true)) : shared;
    const robe = opts.novice ? novice.robe : isSelf ? shared.selfRobe : shared.robes[tint % shared.robes.length];
    this.lower = new THREE.Mesh(G.lower, robe);
    const upper = new THREE.Mesh(G.upper, robe);
    const headMesh = new THREE.Mesh(G.head, shared.skin);
    this.head.position.y = 0.64;
    this.head.add(headMesh);
    if (!low)
      for (const x of [-0.17, 0.17]) {
        const ear = new THREE.Mesh(G.ear, shared.skin);
        ear.position.set(x, 0, 0);
        this.head.add(ear);
      }
    for (const x of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(G.eye, shared.eyeMat);
      eye.position.set(x, 0.02, 0.158);
      this.head.add(eye);
      this.eyes.push(eye);
    }
    const sash = new THREE.Mesh(G.sash, opts.novice ? novice.sash : shared.sashMat);
    sash.position.set(0.02, 0.24, 0.21);
    sash.rotation.z = 0.55;
    this.torso.position.y = 0.9;
    this.torso.add(upper, this.head, sash);
    for (const [arm, x] of [
      [this.armL, 0.22],
      [this.armR, -0.22],
    ] as const) {
      arm.position.set(x, 0.38, 0);
      arm.add(new THREE.Mesh(G.arm, robe), new THREE.Mesh(G.hand, shared.skin));
      this.torso.add(arm);
    }
    this.footL = new THREE.Mesh(G.foot, shared.shoe);
    this.footR = new THREE.Mesh(G.foot, shared.shoe);
    this.footL.position.set(0.11, 0.04, 0.08);
    this.footR.position.set(-0.11, 0.04, 0.08);
    this.body.add(this.lower, this.torso, this.footL, this.footR);
    this.root.add(this.body, new THREE.Mesh(shared.shadow, shared.shadowMat));
    if (isSelf) this.root.add(new THREE.Mesh(shared.ring, shared.ringMat));
    if (opts.novice) this.body.scale.setScalar(0.86);
    this.root.traverse((o) => {
      o.userData.kind = 'avatar';
      // low tier: only the big robe pieces and the head throw shadows
      if ((o as THREE.Mesh).isMesh && o.parent !== this.root) o.castShadow = !low || o === this.lower || o === upper || o === headMesh;
    });
  }

  /** show/hide a prop, creating it the first time */
  private prop(name: PropName, on: boolean, where: 'L' | 'R' | 'T' = 'R') {
    let p = this.props.get(name);
    if (!p) {
      if (!on) return;
      p = makeProp(name, where === 'T');
      p.traverse((o) => (o.userData.kind = 'avatar'));
      (where === 'L' ? this.armL : where === 'T' ? this.torso : this.armR).add(p);
      this.props.set(name, p);
    }
    p.visible = on;
    return p;
  }

  /** Start a local gesture (`seconds` = Infinity keeps it until cleared). */
  play(action: Action | null, seconds = Infinity) {
    if (action !== this.action) this.actionAge = 0;
    this.action = action;
    this.actionUntil = this.t + seconds;
  }

  /**
   * Hold `action` at exactly `age` seconds in (for gestures timed by the server clock, e.g. the
   * novice monks' bell and moktak strikes). animate() then adds its own dt on top.
   */
  syncAction(action: Action | null, age: number) {
    this.action = action;
    this.actionAge = age;
    this.actionUntil = Infinity;
  }

  get currentAction() {
    return this.action;
  }

  /**
   * Level of detail by camera distance (ultra only: far avatars switch to the high mesh on the
   * same skeleton). Called automatically from updateOverlay(); may also be called directly.
   */
  setLod(dist: number) {
    this.hq?.setLod(dist);
  }

  setHeadphones() {
    const grp = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: '#25232c' }));
    band.rotation.y = Math.PI / 2;
    band.position.y = 0.02;
    const cupGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12).rotateZ(Math.PI / 2);
    for (const x of [-0.19, 0.19]) {
      const cup = new THREE.Mesh(cupGeo, new THREE.MeshStandardMaterial({ color: '#8f7cff', emissive: '#4a3aa0' }));
      cup.position.set(x, 0, 0);
      grp.add(cup);
    }
    grp.add(band);
    grp.traverse((o) => {
      o.userData.kind = 'avatar';
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    if (this.hq) this.hq.headphones(grp);
    else this.head.add(grp);
  }

  setName(text: string) {
    if (text === this.labelText) return;
    this.labelText = text;
    if (this.label) {
      this.label.material.map?.dispose();
      this.label.material.dispose();
      this.label.removeFromParent();
      this.label = null;
    }
    if (!text) return;
    this.label = textSprite(text, false);
    this.label.position.y = 1.95;
    this.root.add(this.label);
  }

  say(text: string, now: number) {
    if (this.bubble) {
      this.bubble.material.map?.dispose();
      this.bubble.material.dispose();
      this.bubble.removeFromParent();
    }
    this.bubble = textSprite(text, true);
    this.bubble.position.y = 2.15;
    this.root.add(this.bubble);
    this.bubbleUntil = now + 6000 + Math.min(4000, text.length * 40);
  }

  /** Labels fade with distance; bubbles expire; ultra avatars pick their LOD. Called once per frame. */
  updateOverlay(now: number, camDist: number) {
    this.hq?.setLod(camDist);
    if (this.label) {
      const vis = camDist < 24;
      this.label.visible = vis && !this.bubble;
      if (vis) this.label.material.opacity = Math.min(1, (24 - camDist) / 6);
    }
    if (this.bubble) {
      const left = this.bubbleUntil - now;
      if (left <= 0) {
        this.bubble.material.map?.dispose();
        this.bubble.material.dispose();
        this.bubble.removeFromParent();
        this.bubble = null;
      } else {
        this.bubble.material.opacity = Math.min(1, left / 600);
        this.bubble.visible = camDist < 40;
      }
    }
  }

  /**
   * @param speed   current ground speed (m/s) — drives the walk cycle
   * @param kneel   sitting on a cushion / seat (affects bow / beads / moktak)
   * @param beat    beat position of the moonlight-yard DJ (dance sync)
   */
  animate(dt: number, pose: Pose, speed: number, kneel: boolean, beat: number) {
    this.t += dt;
    if (pose !== this.lastPose) {
      this.lastPose = pose;
      this.poseAge = 0;
    }
    this.poseAge += dt;
    this.actionAge += dt;
    if (this.action && this.t > this.actionUntil) this.action = null;
    if (this.hq) {
      this.hq.animate(this, dt, pose, speed, kneel, beat, this.action, this.actionAge);
      return;
    }
    this.phase += speed * dt * 3.1;
    const t = this.t;
    const age = this.poseAge;
    const moving = speed > 0.15;
    const walk = Math.min(1, speed / 3);

    // ---- base target: relaxed standing ----
    T.bodyY = 0;
    T.bend = 0.03;
    arms(-0.08, -0.12, -0.08, 0.12);
    T.sway = 0;
    T.squash = 1;
    T.nod = 0;
    T.walk = walk;
    T.look = 0;
    T.hip = 0;
    const churchBow = pose === Pose.Bow && this.bowStyle === 'church';
    const kneeling = kneel || pose === Pose.Sit || (pose === Pose.Bow && !churchBow);
    // fold the legs (shorter robe) but keep the base ON the seat — never sink into it
    if (kneeling) T.squash = 0.55;
    let pot = 0; // teapot tilt
    let pouring = false;
    let incense = false;
    let teapot = false;
    let cup = false;

    switch (pose) {
      case Pose.Sit:
        arms(-0.72, -0.48, -0.72, 0.48);
        T.bend = 0.06 + Math.sin(t * 0.9) * 0.015;
        T.nod = 0.12 + Math.sin(t * 0.21) * 0.02;
        break;
      case Pose.Bow: {
        if (churchBow) {
          // church (4 s): head and shoulders bow where you stand (on a pew: the head only), hands at the sides
          const c = (age % 4) / 4;
          const bow = smooth(clamp01((c - 0.08) / 0.27)) * (1 - smooth(clamp01((c - 0.62) / 0.26)));
          if (kneeling) arms(-0.72, -0.48, -0.72, 0.48);
          T.bend = (kneeling ? 0.06 : 0.03) + bow * (kneeling ? 0.06 : 0.3);
          T.nod = bow * 0.38;
          break;
        }
        // full prostration (~5 s): palms together at the chest → down, hands to the floor → hold → rise
        const c = (age % 5) / 5;
        const down = c < 0.18 ? 0 : c < 0.48 ? smooth((c - 0.18) / 0.3) : c < 0.66 ? 1 : 1 - smooth((c - 0.66) / 0.34);
        T.bend = down * 1.3;
        arms(-1.3 + down * 0.15, -0.58 + down * 0.42, -1.3 + down * 0.15, 0.58 - down * 0.42);
        T.nod = down * 0.3;
        break;
      }
      case Pose.Greet: {
        const nod = smooth(Math.min(1, age / 0.7)) * (age < 1.7 ? 1 : Math.max(0, 1 - (age - 1.7) / 0.7));
        arms(-1.32, -0.6, -1.32, 0.6);
        T.bend = 0.38 * nod;
        T.nod = 0.25 * nod;
        break;
      }
      case Pose.Beads:
        arms(-0.95, -0.5, -1.05 + Math.sin(t * 4) * 0.05, 0.4);
        T.bend = 0.12;
        T.nod = 0.25;
        break;
      case Pose.Moktak: {
        const hit = Math.max(0, Math.sin(t * Math.PI * 2 * 1.1)) ** 4;
        arms(-0.8, -0.3, -1.15 + hit * 0.45, 0.25);
        T.bend = 0.1 + hit * 0.02;
        T.nod = 0.15;
        break;
      }
      case Pose.PourTea: {
        // lift the pot (0-0.6 s), tip it over the cup in the left hand (0.6-2.3), right it (2.3-2.9), set down
        teapot = cup = true;
        const lift = smooth(clamp01(age / 0.6)) * (1 - smooth(clamp01((age - 2.9) / 0.5)));
        pot = smooth(clamp01((age - 0.6) / 0.5)) * (1 - smooth(clamp01((age - 2.3) / 0.5)));
        pouring = pot > 0.55;
        arms(-0.75 - 0.35 * lift, -0.42, -0.85 - 0.45 * lift, 0.5 + 0.08 * pot);
        T.bend = 0.12 + 0.08 * lift;
        T.nod = 0.22 + 0.15 * lift; // watch the cup
        break;
      }
      case Pose.DrinkTea: {
        // both hands bring the cup to the lips, two small sips, then lower it
        cup = true;
        const up = smooth(clamp01(age / 0.7)) * (1 - smooth(clamp01((age - 2.1) / 0.6)));
        const sip = up > 0.9 ? Math.max(0, Math.sin((age - 0.7) * 4.2)) : 0;
        arms(-0.85 - 1.25 * up, -0.25 - 0.45 * up, -0.85 - 1.05 * up, 0.25 + 0.42 * up);
        T.nod = -0.08 * up - 0.1 * sip;
        T.bend = 0.04;
        break;
      }
      case Pose.Offer: {
        // INCENSE_OFFER_MS (7 s): raise the sticks to the forehead → three bows → lean in and plant them → palms together
        incense = age < 5.5;
        const raise = smooth(clamp01(age / 1.0));
        const bowT = age - 1.0;
        const bow = bowT > 0 && bowT < 3.6 ? Math.sin(((bowT % 1.2) / 1.2) * Math.PI) : 0;
        const plant = window01(age, 4.6, 6.1, 0.5);
        const after = smooth(clamp01((age - 6.0) / 0.6));
        const up = raise * (1 - plant);
        arms(-1.2 - 0.6 * up + 0.35 * plant, -0.58 + 0.1 * plant, -1.2 - 0.6 * up + 0.35 * plant, 0.58 - 0.1 * plant);
        T.bend = 0.06 + bow * 0.42 + plant * 0.5 + after * 0.12;
        T.nod = 0.1 + bow * 0.25 + plant * 0.25;
        if (after > 0) {
          arms(-1.32, -0.6, -1.32, 0.6);
          T.bend = 0.1 + 0.08 * Math.sin(t * 1.2);
        }
        break;
      }
      case Pose.Dance: {
        const ph = beat * Math.PI * 2;
        const half = Math.floor(beat / 4) % 2;
        T.bodyY = -Math.abs(Math.sin(ph / 2)) * 0.09;
        T.sway = Math.sin(ph / 2) * 0.2;
        T.nod = Math.abs(Math.sin(ph)) * 0.15;
        if (half) arms(-2.7 + Math.sin(ph) * 0.3, -0.2, -2.7 - Math.sin(ph) * 0.3, 0.2);
        else arms(-0.6 + Math.sin(ph) * 0.6, 0.5, -0.6 - Math.sin(ph) * 0.6, -0.5);
        T.bend = 0.05;
        break;
      }
      default:
        if (moving) {
          // arms swing opposite to the legs, slightly away from the body; lean a little into the stride
          const sw = Math.sin(this.phase);
          arms(sw * 0.45 * walk - 0.05, -0.1 - 0.05 * walk, -sw * 0.45 * walk - 0.05, 0.1 + 0.05 * walk);
          T.bodyY = Math.abs(Math.cos(this.phase)) * 0.05 * walk;
          T.bend = 0.04 + 0.1 * walk;
          T.hip = sw * 0.035 * walk;
          T.nod = -0.05 * walk; // keep the gaze level while leaning
        } else {
          // breathing, a slow weight shift and an occasional look around
          T.bend = 0.03 + Math.sin(t * 1.2) * 0.012;
          T.sway = Math.sin(t * 0.37) * 0.025;
          T.look = Math.sin(t * 0.23) * 0.35 + Math.sin(t * 0.61 + 1.3) * 0.15;
          T.nod = Math.sin(t * 0.17) * 0.04;
        }
    }

    // ---- local gesture on top (chores, wish tree, stick tube, riddles) ----
    const act = this.action;
    if (act) {
      const a = this.actionAge;
      T.look = 0;
      switch (act) {
        case 'sweep': {
          // long side-to-side strokes, body follows the broom
          const sw = Math.sin(a * 2.4);
          arms(-0.55, -0.45 + sw * 0.25, -0.6, 0.15 + sw * 0.35);
          T.bend = 0.32;
          T.sway = sw * 0.08;
          T.nod = 0.2;
          break;
        }
        case 'wipe': {
          const c = a * 3.2;
          arms(-0.5, -0.2, -1.05 + Math.sin(c) * 0.18, 0.35 + Math.cos(c) * 0.2);
          T.bend = 0.42;
          T.nod = 0.25;
          break;
        }
        case 'stir': {
          const c = a * 2.2;
          arms(-0.95, -0.3, -1.25 + Math.sin(c) * 0.12, 0.3 + Math.cos(c) * 0.16);
          T.bend = 0.22;
          T.nod = 0.35;
          T.sway = Math.sin(c) * 0.03;
          break;
        }
        case 'prep': {
          // picking and sorting vegetables at the table
          const c = a * 3;
          arms(-0.95 + Math.sin(c) * 0.08, -0.35, -0.95 + Math.sin(c + 1.7) * 0.1, 0.35);
          T.bend = 0.35;
          T.nod = 0.4;
          break;
        }
        case 'ringBell': {
          // pull the striker log back, let it swing into the bell (one stroke every 4 s)
          const c = (a % 4) / 4;
          const pull = c < 0.45 ? smooth(c / 0.45) : c < 0.55 ? 1 - smooth((c - 0.45) / 0.1) : 0;
          arms(-1.45 + pull * 0.35, -0.42, -1.45 + pull * 0.35, 0.42);
          T.bend = 0.1 - pull * 0.12;
          T.nod = 0.05;
          break;
        }
        case 'moktak': {
          const hit = Math.max(0, Math.sin(a * Math.PI * 2 * 1.1)) ** 4;
          arms(-0.8, -0.3, -1.1 + hit * 0.45, 0.25);
          T.bend = 0.1;
          T.nod = 0.15;
          break;
        }
        case 'water': {
          const tilt = 0.5 + Math.sin(a * 0.8) * 0.15;
          arms(-0.3, -0.12, -0.95 - tilt * 0.3, 0.2);
          T.bend = 0.2;
          T.nod = 0.3;
          break;
        }
        case 'carry':
          // a sack on the right shoulder, steadied with both hands
          arms(-0.55 + Math.sin(this.phase) * 0.25 * walk, -0.1, -2.6, 0.32);
          T.bend += 0.08;
          break;
        case 'pick': {
          // reach up into the branches, pull the bud down, look at it
          const reach = window01(a, 0, 1.4, 0.45);
          arms(-0.9 - 0.2 * reach, -0.3, -1.0 - 1.9 * reach, 0.2 - 0.1 * reach);
          T.nod = -0.45 * reach + 0.25 * smooth(clamp01((a - 1.2) / 0.4));
          T.bend = 0.05;
          break;
        }
        case 'shake': {
          // tube held in both hands, tilted forward, shaken in short bursts
          const burst = Math.sin(a * 18) * (Math.sin(a * 2.2) > -0.3 ? 1 : 0.2);
          arms(-1.2 + burst * 0.05, -0.5, -1.25 + burst * 0.07, 0.48);
          T.bend = 0.15;
          T.nod = 0.2;
          break;
        }
        case 'think':
          // hand to the chin
          arms(-0.35, -0.25, -2.0, 0.85);
          T.nod = 0.1 + Math.sin(a * 0.8) * 0.04;
          T.look = Math.sin(a * 0.4) * 0.2;
          break;
        case 'read':
          arms(-0.9, -0.5, -1.1, 0.3);
          T.nod = 0.3;
          break;
      }
    }

    // ---- ease toward the target ----
    // dance follows the beat tightly; chores and gestures a bit faster; everything else gently
    const k = pose === Pose.Dance ? 14 : act ? 9 : 7;
    const s = this.s;
    for (const key of KEYS) s[key] = damp(s[key], T[key], key === 'walk' ? 8 : key === 'look' ? 2.5 : k, dt);
    this.body.position.y = s.bodyY;
    this.body.rotation.z = s.hip;
    this.lower.scale.set(1 + (1 - s.squash) * 0.5, s.squash, 1 + (1 - s.squash) * 0.7);
    this.torso.position.y = 0.9 * s.squash + (1 - s.squash) * 0.05;
    this.torso.rotation.set(s.bend, Math.sin(this.phase) * 0.07 * s.walk, s.sway);
    this.head.rotation.set(s.nod, s.look, -s.sway * 0.5);
    this.armL.rotation.set(s.lx, 0, s.lz);
    this.armR.rotation.set(s.rx, 0, s.rz);
    // feet step forward/back under the robe while walking (lifted on the forward swing), tuck in when kneeling
    const step = Math.sin(this.phase) * 0.15 * s.walk;
    this.footL.position.set(0.11, 0.04 + Math.max(0, Math.cos(this.phase)) * 0.05 * s.walk, 0.08 + step);
    this.footR.position.set(-0.11, 0.04 + Math.max(0, -Math.cos(this.phase)) * 0.05 * s.walk, 0.08 - step);
    this.footL.visible = this.footR.visible = s.squash > 0.75;
    if (kneeling && this.seatStyle === 'bench' && (pose !== Pose.Bow || churchBow)) {
      // on a pew: feet rest on the floor in front of the seat
      this.footL.position.set(0.11, -0.41, 0.3);
      this.footR.position.set(-0.11, -0.41, 0.3);
      this.footL.visible = this.footR.visible = true;
    }

    // blink every few seconds
    if (t > this.nextBlink) this.nextBlink = t + 2.5 + Math.random() * 3.5;
    const eyeY = this.nextBlink - t < 0.12 ? 0.1 : 1;
    if (this.eyes[0].scale.y !== eyeY) for (const e of this.eyes) e.scale.y = eyeY;

    // ---- props ----
    // cup, pot and incense stay upright whatever the arm angle (counter-rotate the arm + torso bend)
    const tp = this.prop('teapot', teapot);
    if (tp) tp.rotation.set(-s.rx - s.bend, 0, -0.95 * pot);
    const cp = this.prop('cup', cup, 'L');
    if (cp) cp.rotation.x = -s.lx - s.bend;
    const st = this.prop('stream', pouring, 'L');
    if (st) st.rotation.x = -s.lx - s.bend;
    const inc = this.prop('incense', incense);
    if (inc) inc.rotation.x = -s.rx - s.bend;
    for (const [name, prop, where] of ACTION_PROPS) this.prop(prop, act === name, where);
    this.prop('bud', act === 'pick' && this.actionAge > 1.0);
  }

  dispose() {
    this.setName('');
    this.bubble?.material.map?.dispose();
    this.bubble?.material.dispose();
    this.hq?.skeleton.dispose();
    this.root.removeFromParent();
  }
}


/** Snapshot interpolation buffer for remote players (render ~130 ms in the past). */
export class RemotePlayer {
  avatar: Avatar;
  private samples: { t: number; x: number; z: number; r: number }[] = [];
  pose: Pose = Pose.Idle;
  speed = 0;
  /** sitting in the shuttle cart (the cart moves the avatar) */
  riding = false;
  x = 0;
  z = 0;
  r = 0;

  constructor(
    readonly id: number,
    readonly adj: number,
    readonly noun: number,
    readonly tint: number,
    public name: string,
    x: number,
    z: number,
    r: number,
    pose: Pose,
  ) {
    this.avatar = new Avatar(tint, false);
    this.push(performance.now(), x, z, r, pose);
    this.x = x;
    this.z = z;
    this.r = r;
  }

  push(t: number, x: number, z: number, r: number, pose: Pose) {
    // after a pause, re-anchor so the next movement starts smoothly instead of from a stale sample
    const last = this.samples[this.samples.length - 1];
    if (last && t - last.t > 250) this.samples.push({ ...last, t: t - 100 });
    this.samples.push({ t, x, z, r });
    if (this.samples.length > 24) this.samples.shift();
    this.pose = pose;
  }

  update(now: number, dt: number) {
    const renderT = now - 130;
    const s = this.samples;
    let a = s[0];
    let b = s[s.length - 1];
    for (let i = 0; i < s.length - 1; i++)
      if (s[i].t <= renderT && s[i + 1].t >= renderT) {
        a = s[i];
        b = s[i + 1];
        break;
      }
    const k = b.t === a.t ? 1 : Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t)));
    const x = a.x + (b.x - a.x) * k;
    const z = a.z + (b.z - a.z) * k;
    let dr = b.r - a.r;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    const targetR = a.r + dr * k;
    const moved = Math.hypot(x - this.x, z - this.z);
    this.speed = damp(this.speed, dt > 0 ? moved / dt : 0, 10, dt);
    this.x = x;
    this.z = z;
    let d = targetR - this.r;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.r += d * (1 - Math.exp(-14 * dt));
    return { x, z, r: this.r };
  }
}
