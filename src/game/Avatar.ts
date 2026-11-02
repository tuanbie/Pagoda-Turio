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
  private t = Math.random() * 10;
  private s = { bodyY: 0, bend: 0, lx: 0, lz: 0, rx: 0, rz: 0, sway: 0, squash: 1, nod: 0, walk: 0 };
  /** walk cycle advances with distance travelled → no foot sliding */
  private phase = 0;
  private label: THREE.Sprite | null = null;
  private labelText = '';
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  poseAge = 0;
  private lastPose: Pose = Pose.Idle;

  constructor(tint: number, isSelf: boolean) {
    const robe = isSelf ? shared.selfRobe : shared.robes[tint % shared.robes.length];
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
    }
    const sash = new THREE.Mesh(shared.sash, shared.sashMat);
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
    this.root.traverse((o) => {
      o.userData.kind = 'avatar';
      if ((o as THREE.Mesh).isMesh && o.parent !== this.root) o.castShadow = true;
    });
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
    this.phase += speed * dt * 3.1;
    const t = this.t;
    const moving = speed > 0.15;
    const tgt = { bodyY: 0, bend: 0.02, lx: -0.1, lz: -0.1, rx: -0.1, rz: 0.1, sway: 0, squash: 1, nod: 0, walk: Math.min(1, speed / 3) };
    const kneeling = kneel || pose === Pose.Sit || pose === Pose.Bow;
    if (kneeling) {
      tgt.bodyY = -0.36;
      tgt.squash = 0.55;
    }

    switch (pose) {
      case Pose.Sit:
        Object.assign(tgt, { lx: -0.72, lz: -0.48, rx: -0.72, rz: 0.48, bend: 0.06 + Math.sin(t * 0.9) * 0.015, nod: 0.12 });
        break;
      case Pose.Bow: {
        // full prostration (~5 s): palms together → bow down → hold → rise
        const c = (this.poseAge % 5) / 5;
        const down = c < 0.18 ? 0 : c < 0.48 ? smooth((c - 0.18) / 0.3) : c < 0.66 ? 1 : 1 - smooth((c - 0.66) / 0.34);
        Object.assign(tgt, {
          bend: down * 1.3,
          lx: -1.3 + down * 0.1,
          lz: -0.58 + down * 0.38,
          rx: -1.3 + down * 0.1,
          rz: 0.58 - down * 0.38,
          nod: down * 0.3,
        });
        break;
      }
      case Pose.Greet: {
        const a = this.poseAge;
        const nod = smooth(Math.min(1, a / 0.7)) * (a < 1.7 ? 1 : Math.max(0, 1 - (a - 1.7) / 0.7));
        Object.assign(tgt, { lx: -1.32, lz: -0.6, rx: -1.32, rz: 0.6, bend: 0.38 * nod, nod: 0.25 * nod });
        break;
      }
      case Pose.Beads:
        Object.assign(tgt, { lx: -0.95, lz: -0.5, rx: -1.05 + Math.sin(t * 4) * 0.05, rz: 0.4, bend: 0.12, nod: 0.25 });
        break;
      case Pose.Moktak: {
        const hit = Math.max(0, Math.sin(t * Math.PI * 2 * 1.1)) ** 4;
        Object.assign(tgt, { lx: -0.8, lz: -0.3, rx: -1.15 + hit * 0.45, rz: 0.25, bend: 0.1, nod: 0.15 });
        break;
      }
      case Pose.Offer: {
        const nod = (Math.sin(t * 1.4) + 1) * 0.5;
        Object.assign(tgt, { lx: -1.45, lz: -0.6, rx: -1.45, rz: 0.6, bend: 0.12 + nod * 0.22, nod: 0.1 + nod * 0.15 });
        break;
      }
      case Pose.Dance: {
        const ph = beat * Math.PI * 2;
        const half = Math.floor(beat / 4) % 2;
        tgt.bodyY = -Math.abs(Math.sin(ph / 2)) * 0.09;
        tgt.sway = Math.sin(ph / 2) * 0.2;
        tgt.nod = Math.abs(Math.sin(ph)) * 0.15;
        if (half) Object.assign(tgt, { lx: -2.7 + Math.sin(ph) * 0.3, lz: -0.2, rx: -2.7 - Math.sin(ph) * 0.3, rz: 0.2 });
        else Object.assign(tgt, { lx: -0.6 + Math.sin(ph) * 0.6, lz: 0.5, rx: -0.6 - Math.sin(ph) * 0.6, rz: -0.5 });
        tgt.bend = 0.05;
        break;
      }
      default:
        if (moving) {
          const sw = Math.sin(this.phase);
          Object.assign(tgt, { lx: sw * 0.5 * tgt.walk, rx: -sw * 0.5 * tgt.walk, bodyY: Math.abs(Math.cos(this.phase)) * 0.045 * tgt.walk, bend: 0.08 * tgt.walk });
        } else tgt.bend = 0.02 + Math.sin(t * 1.2) * 0.012; // breathing
    }

    // dance follows the beat tightly; everything else eases gently
    const k = pose === Pose.Dance ? 14 : 7;
    const s = this.s;
    for (const key of Object.keys(s) as (keyof typeof s)[]) s[key] = damp(s[key], tgt[key], key === 'walk' ? 8 : k, dt);
    this.body.position.y = s.bodyY;
    this.lower.scale.set(1 + (1 - s.squash) * 0.5, s.squash, 1 + (1 - s.squash) * 0.7);
    this.torso.position.y = 0.9 * s.squash + (1 - s.squash) * 0.05;
    this.torso.rotation.set(s.bend, Math.sin(this.phase) * 0.06 * s.walk, s.sway);
    this.head.rotation.x = s.nod;
    this.armL.rotation.set(s.lx, 0, s.lz);
    this.armR.rotation.set(s.rx, 0, s.rz);
    // feet step forward/back under the robe while walking, tuck in when kneeling
    const step = Math.sin(this.phase) * 0.14 * s.walk;
    this.footL.position.set(0.11, 0.04 + Math.max(0, Math.cos(this.phase)) * 0.04 * s.walk, 0.08 + step);
    this.footR.position.set(-0.11, 0.04 + Math.max(0, -Math.cos(this.phase)) * 0.04 * s.walk, 0.08 - step);
    this.footL.visible = this.footR.visible = s.squash > 0.75;
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
