import * as THREE from 'three';
import { Pose } from '@sontu/shared';

const ROBE_TINTS = ['#8b7f6c', '#9a8770', '#7d7466', '#a08a6a', '#8a8378', '#97806a'];
const SKIN = '#f0cfae';

// Geometry and materials are shared by every avatar → 100 visitors cost almost no extra memory.
const shared = (() => {
  const lower = new THREE.LatheGeometry(
    [
      [0, 0.04],
      [0.33, 0.04],
      [0.35, 0.12],
      [0.29, 0.5],
      [0.23, 0.9],
      [0, 0.92],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    16,
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
    16,
  );
  const arm = new THREE.CapsuleGeometry(0.075, 0.32, 3, 8);
  arm.translate(0, -0.24, 0);
  const hand = new THREE.SphereGeometry(0.055, 8, 6);
  hand.translate(0, -0.47, 0);
  const head = new THREE.SphereGeometry(0.17, 18, 14);
  const ear = new THREE.SphereGeometry(0.045, 6, 5).scale(0.5, 1, 0.8);
  const eye = new THREE.SphereGeometry(0.018, 6, 4);
  const foot = new THREE.SphereGeometry(0.08, 8, 6).scale(0.9, 0.55, 1.5);
  const sash = new THREE.BoxGeometry(0.09, 0.62, 0.02);
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
    lower,
    upper,
    arm,
    hand,
    head,
    ear,
    eye,
    foot,
    sash,
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

export interface AvatarOptions {
  /** a computer-controlled novice monk: brown robe, a little smaller */
  novice?: boolean;
}

/** Procedural little monk with pose-driven, critically-damped animation. */
export class Avatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private lower: THREE.Mesh;
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private footL: THREE.Mesh;
  private footR: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private t = Math.random() * 10;
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
    const robe = opts.novice ? novice.robe : isSelf ? shared.selfRobe : shared.robes[tint % shared.robes.length];
    this.lower = new THREE.Mesh(shared.lower, robe);
    const upper = new THREE.Mesh(shared.upper, robe);
    const headMesh = new THREE.Mesh(shared.head, shared.skin);
    this.head.position.y = 0.64;
    this.head.add(headMesh);
    for (const x of [-0.17, 0.17]) {
      const ear = new THREE.Mesh(shared.ear, shared.skin);
      ear.position.set(x, 0, 0);
      this.head.add(ear);
    }
    for (const x of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(shared.eye, shared.eyeMat);
      eye.position.set(x, 0.02, 0.158);
      this.head.add(eye);
      this.eyes.push(eye);
    }
    const sash = new THREE.Mesh(shared.sash, opts.novice ? novice.sash : shared.sashMat);
    sash.position.set(0.02, 0.24, 0.21);
    sash.rotation.z = 0.55;
    this.torso.position.y = 0.9;
    this.torso.add(upper, this.head, sash);
    for (const [arm, x] of [
      [this.armL, 0.22],
      [this.armR, -0.22],
    ] as const) {
      arm.position.set(x, 0.38, 0);
      arm.add(new THREE.Mesh(shared.arm, robe), new THREE.Mesh(shared.hand, shared.skin));
      this.torso.add(arm);
    }
    this.footL = new THREE.Mesh(shared.foot, shared.shoe);
    this.footR = new THREE.Mesh(shared.foot, shared.shoe);
    this.footL.position.set(0.11, 0.04, 0.08);
    this.footR.position.set(-0.11, 0.04, 0.08);
    this.body.add(this.lower, this.torso, this.footL, this.footR);
    this.root.add(this.body, new THREE.Mesh(shared.shadow, shared.shadowMat));
    if (isSelf) this.root.add(new THREE.Mesh(shared.ring, shared.ringMat));
    if (opts.novice) this.body.scale.setScalar(0.86);
    this.root.traverse((o) => {
      o.userData.kind = 'avatar';
      if ((o as THREE.Mesh).isMesh && o.parent !== this.root) o.castShadow = true;
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

  get currentAction() {
    return this.action;
  }

  setHeadphones() {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: '#25232c' }));
    band.rotation.y = Math.PI / 2;
    band.position.y = 0.02;
    const cupGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12).rotateZ(Math.PI / 2);
    for (const x of [-0.19, 0.19]) {
      const cup = new THREE.Mesh(cupGeo, new THREE.MeshStandardMaterial({ color: '#8f7cff', emissive: '#4a3aa0' }));
      cup.position.set(x, 0, 0);
      this.head.add(cup);
    }
    this.head.add(band);
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

  /** Labels fade with distance; bubbles expire. Called once per frame. */
  updateOverlay(now: number, camDist: number) {
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
   * @param kneel   sitting on a cushion (affects bow / beads / moktak)
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
    const kneeling = kneel || pose === Pose.Sit || pose === Pose.Bow;
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
