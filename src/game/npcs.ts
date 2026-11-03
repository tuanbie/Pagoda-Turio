import * as THREE from 'three';
import { Pose, WORLD } from '@sontu/shared';
import { Avatar, type Action } from './Avatar.ts';
import type { NavGrid } from './nav.ts';
import type { World } from './World.ts';
import { STATIONS } from './grounds.ts';
import { grounds } from './layout.ts';
import { t, type Key } from '../i18n/index.ts';
import { audio } from '../audio/AudioEngine.ts';
import { store } from '../store.ts';

/**
 * Novice monks (chú tiểu) doing the temple's daily chores. Fictional, computer-controlled
 * characters: everything is computed on this client from the server clock, so every visitor
 * sees the same monk in the same place doing the same thing, with nothing sent over the wire.
 */

type P = { x: number; z: number };
type Step =
  /** walk to a point; `act` keeps a gesture going while walking (sweeping, carrying) */
  | { go: P; act?: Action; speed?: number }
  /** stay at a spot facing r for `secs`; `sound` plays the instrument the gesture strikes */
  | { at: P & { r: number }; act: Action | null; secs: number; kneel?: boolean; sound?: 'bell' | 'moktak' };

interface Def {
  /** i18n key of what they are doing (shown when clicked) */
  doing: Key;
  steps: Step[];
  /** seconds: de-synchronises monks that share a schedule length */
  offset: number;
  /** present on the low tier too */
  essential?: boolean;
}

const WALK = 1.05;
const SWEEP_WALK = 0.42;

function defs(): Def[] {
  const c = WORLD.courtyard;
  const bell = WORLD.bellTower;
  const k = grounds('kitchen');
  const g = WORLD.garden;
  const dm = grounds('dorm');
  const sweepLoop: P[] = [
    { x: c.x - 9, z: c.z + 9 },
    { x: c.x + 9, z: c.z + 9 },
    { x: c.x + 11, z: c.z + 1 },
    { x: c.x + 6.5, z: c.z - 5.5 },
    { x: c.x - 6.5, z: c.z - 5.5 },
    { x: c.x - 11, z: c.z + 1 },
  ];
  return [
    {
      doing: 'npc.sweep',
      essential: true,
      offset: 0,
      steps: [...sweepLoop.map((p) => ({ go: p, act: 'sweep' as Action, speed: SWEEP_WALK })), { at: { ...sweepLoop[0], r: 0 }, act: 'sweep', secs: 5 }],
    },
    {
      doing: 'npc.sweep',
      offset: 37,
      steps: [
        { go: { x: -1.7, z: 8 }, act: 'sweep', speed: SWEEP_WALK },
        { go: { x: -1.7, z: 62 }, act: 'sweep', speed: SWEEP_WALK },
        { at: { x: -1.7, z: 62, r: 0 }, act: null, secs: 6 },
        { go: { x: 1.7, z: 62 } },
        { go: { x: 1.7, z: 8 }, act: 'sweep', speed: SWEEP_WALK },
        { at: { x: 1.7, z: 8, r: Math.PI }, act: null, secs: 6 },
      ],
    },
    {
      doing: 'npc.clean',
      offset: 11,
      steps: [28, 36, 44, 52].flatMap((z) => [
        { at: { x: 3.15, z, r: Math.PI / 2 }, act: 'wipe' as Action, secs: 7 },
        { at: { x: -3.15, z, r: -Math.PI / 2 }, act: 'wipe' as Action, secs: 7 },
      ]),
    },
    {
      doing: 'npc.bell',
      essential: true,
      offset: 5,
      steps: [
        { at: { x: bell.x, z: bell.z + 3.0, r: Math.PI }, act: 'ringBell', secs: 12, sound: 'bell' },
        { at: { x: bell.x + 7, z: bell.z + 9, r: 0.6 }, act: null, secs: 40 },
        { go: { x: bell.x + 12, z: bell.z + 14 } },
        { at: { x: bell.x + 12, z: bell.z + 14, r: 2.4 }, act: 'wipe', secs: 30 },
        { at: { x: bell.x + 4, z: bell.z + 6, r: Math.PI }, act: null, secs: 60 },
      ],
    },
    {
      doing: 'npc.moktak',
      essential: true,
      offset: 0,
      steps: [
        { at: STATIONS.moktak, act: 'moktak', secs: 150, kneel: true, sound: 'moktak' },
        { at: { x: STATIONS.moktak.x - 1.4, z: STATIONS.moktak.z + 1.6, r: 0 }, act: null, secs: 20 },
      ],
    },
    {
      doing: 'npc.cook',
      essential: true,
      offset: 3,
      steps: [
        { at: STATIONS.stove, act: 'stir', secs: 40 },
        { at: { x: k.x - k.w / 2 + 2.0, z: k.z - k.d / 2 + 2.9, r: -Math.PI / 2 }, act: 'prep', secs: 8 },
      ],
    },
    {
      doing: 'npc.cook',
      offset: 20,
      steps: [
        { at: STATIONS.prep, act: 'prep', secs: 45 },
        { at: { x: STATIONS.stove.x + 1.6, z: STATIONS.stove.z, r: Math.PI }, act: 'stir', secs: 15 },
      ],
    },
    {
      doing: 'npc.carry',
      essential: true,
      offset: 60,
      steps: [
        { at: STATIONS.storeDoor, act: 'prep', secs: 4 },
        { go: STATIONS.kitchenDoor, act: 'carry' },
        { at: STATIONS.kitchenDoor, act: 'prep', secs: 4 },
        { go: STATIONS.storeDoor },
      ],
    },
    {
      doing: 'npc.water',
      offset: 9,
      steps: [
        { at: { x: g.x - g.w / 2 - 0.9, z: g.z - 4, r: Math.PI / 2 }, act: 'water', secs: 9 },
        { at: { x: g.x, z: g.z - g.d / 2 - 0.9, r: 0 }, act: 'water', secs: 9 },
        { at: { x: g.x + g.w / 2 + 0.9, z: g.z + 3, r: -Math.PI / 2 }, act: 'water', secs: 9 },
        { at: { x: g.x, z: g.z + g.d / 2 + 0.9, r: Math.PI }, act: 'water', secs: 9 },
      ],
    },
    {
      doing: 'npc.clean',
      offset: 14,
      steps: [
        { at: STATIONS.dormLine, act: 'wipe', secs: 12 },
        { go: { x: dm.x - 6, z: dm.z + dm.d / 2 + 1.7 }, act: 'sweep', speed: SWEEP_WALK },
        { go: { x: dm.x + 6, z: dm.z + dm.d / 2 + 1.7 }, act: 'sweep', speed: SWEEP_WALK },
      ],
    },
  ];
}

type Seg =
  | { kind: 'walk'; t0: number; t1: number; pts: P[]; cum: number[]; len: number; act: Action | null; speed: number }
  | { kind: 'stay'; t0: number; t1: number; x: number; z: number; r: number; act: Action | null; kneel: boolean; sound?: 'bell' | 'moktak' };

interface Npc {
  def: Def;
  avatar: Avatar;
  hit: THREE.Mesh;
  segs: Seg[];
  total: number;
  seg: number;
  x: number;
  z: number;
  r: number;
  act: Action | null;
  /** last strike we made a sound for (index within the current stay) */
  strikes: number;
  strikeSeg: number;
}

const BELL_PERIOD = 4;
const BELL_AT = 2.2; // the swing meets the bell 55% into each pull (see Avatar 'ringBell')
const MOKTAK_HZ = 1.1;

export class Npcs {
  readonly list: Npc[] = [];
  /** reused every frame: positions for the visitor's collision avoidance */
  readonly spots: P[] = [];

  constructor(nav: NavGrid, low: boolean) {
    const all = defs().filter((d) => !low || d.essential);
    for (const def of all) {
      const { segs, total } = this.timeline(def, nav);
      const avatar = new Avatar(0, false, { novice: true });
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.7, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.85;
      hit.userData.kind = 'npc';
      hit.userData.npc = this.list.length;
      avatar.root.add(hit);
      this.list.push({ def, avatar, hit, segs, total, seg: 0, x: 0, z: 0, r: 0, act: null, strikes: -1, strikeSeg: -1 });
      this.spots.push({ x: 0, z: 0 });
    }
    this.refreshLabels();
  }

  /** Precompute the whole day loop once: A* routes between stations, segment timings. */
  private timeline(def: Def, nav: NavGrid) {
    const segs: Seg[] = [];
    let t = 0;
    const first = def.steps[0];
    let cur: P = 'at' in first ? first.at : first.go;
    const walk = (to: P, act: Action | null, speed: number) => {
      if (Math.hypot(to.x - cur.x, to.z - cur.z) < 0.05) return;
      const route = nav.find(cur.x, cur.z, to.x, to.z) ?? [to];
      const pts: P[] = [{ x: cur.x, z: cur.z }, ...route.slice(0, -1).map((p) => ({ x: p.x, z: p.z })), { x: to.x, z: to.z }];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      const len = cum[cum.length - 1];
      segs.push({ kind: 'walk', t0: t, t1: t + len / speed, pts, cum, len, act, speed });
      t += len / speed;
      cur = to;
    };
    for (const s of def.steps) {
      if ('go' in s) walk(s.go, s.act ?? null, s.speed ?? WALK);
      else {
        walk(s.at, null, WALK);
        segs.push({ kind: 'stay', t0: t, t1: t + s.secs, x: s.at.x, z: s.at.z, r: s.at.r, act: s.act, kneel: !!s.kneel, sound: s.sound });
        t += s.secs;
      }
    }
    // close the loop back to the start
    const start = 'at' in first ? first.at : first.go;
    const lastWalk = [...segs].reverse().find((s) => s.kind === 'walk');
    walk(start, lastWalk && lastWalk.kind === 'walk' && lastWalk.act === 'sweep' ? 'sweep' : null, lastWalk?.kind === 'walk' && lastWalk.act === 'sweep' ? SWEEP_WALK : WALK);
    return { segs, total: Math.max(t, 1) };
  }

  /** add (or re-add, after a graphics change rebuilt the scene) every monk to the world */
  attach(world: World) {
    for (const n of this.list) {
      world.scene.add(n.avatar.root);
      world.clickables.push(n.hit);
    }
  }

  refreshLabels() {
    for (const n of this.list) n.avatar.setName(t('npc.novice'));
  }

  /** What a monk is doing, for the click toast: "Chú tiểu · đang quét lá". */
  describe(i: number): string {
    const n = this.list[i];
    if (!n) return '';
    const walking = n.segs[n.seg]?.kind === 'walk' && n.act !== 'sweep' && n.act !== 'carry';
    return `${t('npc.novice')} · ${t(walking ? 'npc.walk' : n.def.doing)}`;
  }

  /**
   * @param sNow  server time (ms) — the same on every client
   * @param cx/cz camera position (far monks animate less often)
   * @param me    where I am (instrument sounds are heard only nearby)
   */
  update(dt: number, sNow: number, world: World, cx: number, cz: number, me: P, frameNo: number) {
    const sound = store.get().soundOn;
    for (let i = 0; i < this.list.length; i++) {
      const n = this.list[i];
      const tc = (((sNow / 1000 + n.def.offset) % n.total) + n.total) % n.total;
      // find the current segment (usually the same as last frame)
      let si = n.seg;
      const segs = n.segs;
      if (!(segs[si] && tc >= segs[si].t0 && tc < segs[si].t1)) {
        si = segs.findIndex((s) => tc >= s.t0 && tc < s.t1);
        if (si < 0) si = segs.length - 1;
        n.seg = si;
      }
      const s = segs[si];
      let speed = 0;
      let targetR = n.r;
      let kneel = false;
      if (s.kind === 'walk') {
        const d = Math.min(s.len, (tc - s.t0) * s.speed);
        let j = 1;
        while (j < s.cum.length - 1 && s.cum[j] < d) j++;
        const a = s.pts[j - 1];
        const b = s.pts[j];
        const segLen = s.cum[j] - s.cum[j - 1] || 1;
        const k = Math.min(1, Math.max(0, (d - s.cum[j - 1]) / segLen));
        n.x = a.x + (b.x - a.x) * k;
        n.z = a.z + (b.z - a.z) * k;
        targetR = Math.atan2(b.x - a.x, b.z - a.z);
        speed = s.speed;
        n.act = s.act;
      } else {
        n.x = s.x;
        n.z = s.z;
        targetR = s.r;
        n.act = s.act;
        kneel = s.kneel;
        // instruments are struck on a fixed rhythm → the same moment for everyone
        if (s.sound) {
          const local = tc - s.t0;
          const idx = s.sound === 'bell' ? Math.floor((local - BELL_AT) / BELL_PERIOD) : Math.floor(local * MOKTAK_HZ - 0.25);
          if (n.strikeSeg !== si) {
            n.strikeSeg = si;
            n.strikes = idx;
          } else if (idx > n.strikes) {
            n.strikes = idx;
            const dist = Math.hypot(me.x - n.x, me.z - n.z);
            if (s.sound === 'bell') {
              world.ring('bell');
              if (sound && dist < 70) audio.bell('effects', undefined, 110, 0.9 * (1 - dist / 70));
            } else if (sound && dist < 16) audio.moktak('effects', undefined, 0.35 * (1 - dist / 16));
          }
        }
      }
      let dr = targetR - n.r;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      n.r += dr * (1 - Math.exp(-8 * dt));
      const root = n.avatar.root;
      root.position.set(n.x, world.groundHeight(n.x, n.z) + (kneel ? 0.14 : 0), n.z);
      root.rotation.y = n.r;
      this.spots[i].x = n.x;
      this.spots[i].z = n.z;
      // a gesture held at a station runs on the server clock too, so a strike lands with its sound
      // (also after joining mid-stay, a graphics rebuild, or frames skipped while far away)
      const synced = s.kind === 'stay' && n.act !== null;
      if (!synced && n.avatar.currentAction !== n.act) n.avatar.play(n.act);
      const camD = Math.hypot(cx - n.x, cz - n.z);
      root.visible = camD < 110;
      if (!root.visible) continue;
      // far monks are small on screen: animate them every third frame
      if (camD < 40 || (frameNo + i) % 3 === 0) {
        const adt = camD < 40 ? dt : dt * 3;
        // (animate() adds adt to the age: start that much earlier)
        if (synced) n.avatar.syncAction(n.act, Math.max(0, tc - s.t0 - adt));
        n.avatar.animate(adt, kneel ? Pose.Sit : Pose.Idle, speed, kneel, 0);
      }
      n.avatar.updateOverlay(performance.now(), camD);
    }
  }
}
