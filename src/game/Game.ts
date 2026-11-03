import * as THREE from 'three';
import {
  CENSERS,
  HALLS,
  INCENSE_SLOTS,
  Instrument,
  PAVILIONS,
  Pose,
  SEATS,
  STUPA,
  TABLES,
  WORLD,
  djBeat,
  inMoonYard,
  tableSeat,
  type IncenseState,
  type PlayerTuple,
  type ServerMsg,
  type Side,
} from '@sontu/shared';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World } from './World.ts';
import { Avatar, RemotePlayer } from './Avatar.ts';
import { NavGrid } from './nav.ts';
import { gardenRect, hallRect } from './layout.ts';
import { STEP_MAX, terrainHeight } from './terrain.ts';
import { CUSHION_TOP, STONE_TOP, STOOL_TOP } from './places.ts';
import { store, serverNow, toast, type Zone, type Visitor, type ChatLine } from '../store.ts';
import { audio } from '../audio/AudioEngine.ts';
import { t, visitorName } from '../i18n/index.ts';
import type { Net } from '../net/Net.ts';

const SPEED = 3.3;
const ACCEL = 9;
type Activity = null | typeof Pose.Bow | typeof Pose.Dance | typeof Pose.Beads | typeof Pose.Moktak;
type Then = 'sit' | 'censer' | 'table' | 'fish';

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
let chatKey = 0;

export interface MapDot {
  x: number;
  z: number;
  self?: boolean;
  r?: number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
  private world!: World;
  private nav!: NavGrid;
  private self!: Avatar;
  private remotes = new Map<number, RemotePlayer>();
  private seatOwner = new Map<number, number>(); // seat -> player
  private ray = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private ro: ResizeObserver;
  private abort = new AbortController();
  private marker!: THREE.Mesh;

  // local player
  private id = 0;
  private x: number = WORLD.spawn.x;
  private z: number = WORLD.spawn.z;
  private r = Math.PI;
  private vx = 0;
  private vz = 0;
  private path: { x: number; z: number }[] = [];
  private then: Then | null = null;
  private stuck = 0;
  private speed = 0;
  private activity: Activity = null;
  private greetUntil = 0;
  private seat = -1;
  private seated = false;
  private keys = new Set<string>();
  private lastAskedName = '';
  /** auto mode: tier chosen after measuring this device (null = use the device profile) */
  private autoTier: 'high' | 'medium' | 'low' | null = null;
  private stickCache = new Map<number, number>();
  private fishLog: [number, number][] = [];
  private teaPose: Pose = Pose.PourTea;
  private censer = 0;
  private teaUntil = 0;
  /** game table I'm sitting at (or walking to) */
  private table = -1;
  private tableSide: Side = 0;
  private atTable = false;
  /** the shuttle cinematic is playing for me */
  private arriving = false;
  private firstHi = true;
  private ident = { a: 0, n: 0, c: 0 };
  /** cushion to reclaim after a reconnect (server instance may have changed) */
  private reclaimSeat = -1;
  private silentSeat = false;

  // camera (input sets targets, actual values ease toward them)
  private yaw = 0;
  private pitch = 0.42;
  private dist = 9;
  private tYaw = 0;
  private tPitch = 0.42;
  private tDist = 9;
  private camTarget = new THREE.Vector3(WORLD.spawn.x, 1.3, WORLD.spawn.z);

  // input
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; t: number; moved: boolean } | null = null;
  private pinch = 0;

  // perf
  private pixelRatio = 1;
  private maxPixelRatio = 1;
  private frameAvg = 16;
  private perfClock = 0;
  private slowTimer = 0;
  private zoneClock = 0;
  private hourClock = 99;
  private visitorsDirty = true;
  private hourOverride: number | null;
  private frameNo = 0;
  private low = false;
  private lastRender = 0;
  private portrait: boolean | null = null;

  constructor(
    private host: HTMLElement,
    private net: Net,
  ) {
    const q = store.get().quality;
    const dpr = window.devicePixelRatio || 1;
    const lowStart = q === 'low' || (q === 'auto' && deviceProfile().weak);
    // antialiasing can only be chosen when the WebGL context is created
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowStart && dpr < 2, powerPreference: lowStart ? 'low-power' : 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    host.appendChild(this.renderer.domElement);
    this.self = new Avatar(0, true);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff3c9', transparent: true, opacity: 0.85 }));
    this.marker.visible = false;
    this.world = this.buildWorld();
    this.nav = new NavGrid(this.world.circles, this.world.boxes);

    const h = new URLSearchParams(location.search).get('hour');
    this.hourOverride = h !== null && !Number.isNaN(+h) ? +h : null;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /**
   * Build the 3D world for the current graphics setting and put every live thing into it
   * (me, other visitors, seats taken, burning incense, game boards, released fish).
   * Called at start and again when the quality changes — you stay exactly where you are.
   */
  private buildWorld(): World {
    const q = store.get().quality;
    const dpr = window.devicePixelRatio || 1;
    const { mobile, weak } = deviceProfile();
    // four tiers; "auto" picks one from the device profile
    // "auto" (the default for every new visitor) picks a tier from the device profile,
    // and may later step down if this device can't keep up
    const tier: Exclude<typeof q, 'auto'> = q !== 'auto' ? q : this.autoTier ?? (weak ? 'low' : mobile ? 'medium' : 'high');
    if (q === 'auto') store.set({ autoTier: tier });
    const low = tier === 'low';
    const shadows = tier === 'high';
    this.low = low;
    this.camera.far = low ? 420 : 1200;
    this.camera.updateProjectionMatrix();
    // cheaper materials reflect less light: lift the exposure so low still looks bright
    this.renderer.toneMappingExposure = low ? 1.25 : tier === 'medium' ? 1.1 : 1.05;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.maxPixelRatio = low ? 1 : tier === 'high' ? Math.min(dpr, q === 'high' ? 2 : 1.6) : Math.min(dpr, 1.25);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);

    const world = new World({ low, shadows, shadowSize: q === 'high' ? 2048 : 1024, density: low ? 0.45 : tier === 'medium' ? 0.7 : 1 });
    // image-based lighting makes gold / bronze read as metal (one-off, tiny env map)
    if (!low) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      world.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      world.scene.environmentIntensity = 0.35;
      pmrem.dispose();
    }
    world.scene.add(this.self.root, this.marker);
    // invisible click target for the DJ booth
    const djHit = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 6), new THREE.MeshBasicMaterial({ visible: false }));
    djHit.position.set(WORLD.djBooth.x + 0.5, 1.2, WORLD.djBooth.z);
    djHit.userData.kind = 'dj';
    world.scene.add(djHit);
    world.clickables.push(djHit);
    // restore live state
    for (const rp of this.remotes.values()) {
      rp.riding = false;
      world.scene.add(rp.avatar.root);
    }
    for (const [i, id] of this.seatOwner) world.setSeatTaken(i, id !== this.id);
    for (const [slot, at] of this.stickCache) world.setStick(slot, at);
    for (const snap of store.get().tables) world.gameTables.set(snap);
    for (const f of this.fishLog) world.pond.add(f, null, true);
    this.hourClock = 99;
    return world;
  }

  /** Graphics quality changed: swap the scene, keep the visitor in place. */
  setQuality() {
    const old = this.world;
    if (this.arriving) {
      this.arriving = false;
      store.set({ arriving: false });
    }
    this.self.root.removeFromParent();
    this.world = this.buildWorld();
    old.dispose();
    this.resize();
  }

  // ---------------- naming helpers ----------------
  nameOf(id: number): string {
    if (id === this.id) return store.get().myName || t('map.you');
    const r = this.remotes.get(id);
    if (!r) return '…';
    return r.name || visitorName(store.get().locale, r.adj, r.noun);
  }

  /** Re-render name tags (e.g. after a language change). */
  refreshLabels() {
    for (const r of this.remotes.values()) r.avatar.setName(this.nameOf(r.id));
  }

  // ---------------- network ----------------
  handle(msg: ServerMsg) {
    const now = performance.now();
    switch (msg.t) {
      case 'hi': {
        this.id = msg.id;
        for (const r of this.remotes.values()) r.avatar.dispose();
        this.remotes.clear();
        this.seatOwner.clear();
        SEATS.forEach((_, i) => this.world.setSeatTaken(i, false));
        const reclaim = this.seat >= 0 ? this.seat : this.reclaimSeat;
        for (const p of msg.players) {
          if (p[0] === msg.id) {
            this.x = p[3];
            this.z = p[4];
            this.r = p[5];
            this.ident = { a: p[1], n: p[2], c: p[7] };
          } else this.addRemote(p);
        }
        this.camTarget.set(this.x, 1.3, this.z);
        for (const [i, id] of msg.seats) this.setSeat(i, id);
        for (const [c, slot, at] of msg.sticks) {
          const k = c * INCENSE_SLOTS + slot;
          this.stickCache.set(k, at - store.get().clockOffset);
          this.world.setStick(k, at - store.get().clockOffset);
        }
        this.seat = -1;
        this.seated = false;
        this.stop();
        store.set({
          selfId: msg.id,
          room: msg.room,
          incs: msg.inc,
          seated: false,
          dj: msg.dj,
          chat: msg.chat.map(([id, name, adj, noun, text, at, ch]) => ({ key: ++chatKey, id, name, adj, noun, text, at, ch: ch ?? 0 })),
          tables: msg.tables,
          seatAsk: null,
          seatIncoming: null,
        });
        audio.setDj(msg.dj);
        for (const snap of msg.tables) this.world.gameTables.set(snap);
        if (this.firstHi)
          for (const f of msg.fish) {
            this.fishLog.push(f);
            this.world.pond.add(f, null, true);
          }
        this.table = -1;
        this.atTable = false;
        msg.inc.forEach((st, c) => this.onIncense(c, st));
        this.visitorsDirty = true;
        this.sendMove(true);
        // quietly sit back down on the same cushion if it is still free
        this.reclaimSeat = -1;
        if (reclaim >= 0 && !msg.seats.some(([i]) => i === reclaim)) {
          this.silentSeat = true;
          this.net.send({ t: 'seat', i: reclaim });
        }
        // first arrival: the shuttle drives me to the gate, then I walk in
        if (this.firstHi && Math.hypot(this.x - WORLD.spawn.x, this.z - WORLD.spawn.z) < 5) this.playArrival();
        this.firstHi = false;
        break;
      }
      case 's':
        if (msg.j)
          for (const p of msg.j)
            if (p[0] !== this.id && !this.remotes.has(p[0])) {
              const rp = this.addRemote(p);
              // newcomers arrive by shuttle too: show them once the cart has stopped
              if (Math.hypot(p[3] - WORLD.spawn.x, p[4] - WORLD.spawn.z) < 5) {
                rp.riding = true;
                this.world.shuttle.arrive(() => (rp.riding = false), rp.avatar.root);
              }
            }
        if (msg.u)
          for (const [id, x, z, r, p] of msg.u) {
            if (id === this.id) continue;
            this.remotes.get(id)?.push(now, x, z, r, p);
          }
        if (msg.l)
          for (const id of msg.l) {
            this.remotes.get(id)?.avatar.dispose();
            this.remotes.delete(id);
            this.visitorsDirty = true;
          }
        break;
      case 'seat':
        this.setSeat(msg.i, msg.id);
        break;
      case 'seatno':
        if (!this.silentSeat) toast(t('seat.taken'));
        this.silentSeat = false;
        break;
      case 'sreq':
        store.set({ seatIncoming: { i: msg.i, from: msg.from, at: Date.now() } });
        if (store.get().soundOn) audio.ping();
        break;
      case 'sreqx':
        store.set({ seatIncoming: null });
        break;
      case 'sres': {
        const key = ({ ok: 'seat.ok', no: 'seat.no', busy: 'seat.busy', timeout: 'seat.timeout', gone: 'seat.gone' } as const)[msg.r];
        toast(t(key, { name: this.lastAskedName }));
        break;
      }
      case 'inc':
        this.onIncense(msg.c, msg.s);
        break;
      case 'stk': {
        const k = msg.c * INCENSE_SLOTS + msg.s[0];
        this.stickCache.set(k, msg.s[1] - store.get().clockOffset);
        this.world.setStick(k, msg.s[1] - store.get().clockOffset);
        break;
      }
      case 'nm': {
        const r = this.remotes.get(msg.id);
        if (r) {
          r.name = msg.n;
          r.avatar.setName(this.nameOf(r.id));
          this.visitorsDirty = true;
        }
        break;
      }
      case 'chat': {
        const [id, name, adj, noun, text, at, ch] = msg.c;
        const line: ChatLine = { key: ++chatKey, id, name, adj, noun, text, at, ch: ch ?? 0 };
        const s = store.get();
        store.set({ chat: [...s.chat.slice(-99), line], unread: s.chatOpen || id === this.id ? s.unread : s.unread + 1 });
        const av = id === this.id ? this.self : this.remotes.get(id)?.avatar;
        av?.say(text, performance.now());
        if (id !== this.id && s.soundOn) audio.ping();
        break;
      }
      case 'fx': {
        const src = msg.k === Instrument.Bell ? WORLD.bellTower : WORLD.drumTower;
        const gain = Math.max(0.15, 1 - Math.hypot(this.x - src.x, this.z - src.z) / 90);
        this.world.ring(msg.k === Instrument.Bell ? 'bell' : 'drum');
        if (store.get().soundOn) {
          if (msg.k === Instrument.Bell) audio.bell('effects', undefined, 110, gain * 1.4);
          else audio.drum(gain);
        }
        break;
      }
      case 'dj':
        store.set({ dj: msg.d });
        audio.setDj(msg.d);
        break;
      case 'tb': {
        const tables = [...store.get().tables];
        tables[msg.s.i] = msg.s;
        store.set({ tables });
        this.world.gameTables.set(msg.s);
        const side = msg.s.p.indexOf(this.id);
        if (side >= 0 && this.table !== msg.s.i) {
          // the server gave me this seat: walk over and sit on the stool
          this.table = msg.s.i;
          this.tableSide = side as Side;
          this.leaveSeat();
          const st = tableSeat(TABLES[msg.s.i], this.tableSide);
          this.goTo(st.x, st.z, 'table');
        } else if (side < 0 && this.table === msg.s.i) {
          this.table = -1;
          this.atTable = false;
        }
        break;
      }
      case 'fish': {
        const r = this.remotes.get(msg.id);
        const from = msg.id === this.id ? this.world.pond.shore(this.x, this.z) : r ? this.world.pond.shore(r.x, r.z) : null;
        this.world.pond.add(msg.f, from);
        this.fishLog.push(msg.f);
        if (this.fishLog.length > 150) this.fishLog.shift();
        if (msg.id === this.id) toast(t('fish.released'));
        if (store.get().soundOn && from && Math.hypot(this.x - from[0], this.z - from[1]) < 30) audio.splash();
        break;
      }
    }
  }

  /** Shuttle cinematic for my own first arrival. */
  private playArrival() {
    this.arriving = true;
    store.set({ arriving: true });
    toast(t('arrive.riding'));
    this.world.shuttle.arrive(() => {
      this.arriving = false;
      store.set({ arriving: false });
      toast(t('arrive.welcome'));
    }, this.self.root);
  }

  private addRemote(p: PlayerTuple): RemotePlayer {
    const [id, adj, noun, x, z, r, pose, tint, name] = p;
    const rp = new RemotePlayer(id, adj, noun, tint, name ?? '', x, z, r, pose);
    this.remotes.set(id, rp);
    rp.avatar.root.position.set(x, this.world.groundHeight(x, z), z);
    rp.avatar.setName(this.nameOf(id));
    this.world.scene.add(rp.avatar.root);
    this.visitorsDirty = true;
    return rp;
  }

  private setSeat(i: number, id: number | null) {
    const prev = this.seatOwner.get(i);
    if (id === null) this.seatOwner.delete(i);
    else this.seatOwner.set(i, id);
    this.world.setSeatTaken(i, id !== null && id !== this.id);
    if (id === this.id) {
      this.seat = i;
      this.activity = null;
      if (this.silentSeat) {
        this.silentSeat = false;
        this.then = 'sit';
        this.arrive();
        return;
      }
      this.goTo(SEATS[i].x, SEATS[i].z, 'sit');
    } else if (prev === this.id && this.seat === i) {
      // my cushion went to someone else (I offered it) → stand up and step aside
      const wasSeated = this.seated;
      this.seat = -1;
      this.seated = false;
      store.set({ seated: false });
      if (wasSeated && id !== null) {
        const s = SEATS[i];
        const [nx, nz] = this.world.resolve(s.x + Math.sin(s.r + Math.PI / 2) * 1.1, s.z + Math.cos(s.r + Math.PI / 2) * 1.1);
        this.goTo(nx, nz);
        toast(t('seat.gave'));
      }
    }
  }

  private onIncense(c: number, s: IncenseState) {
    const incs = [...store.get().incs];
    const prev = incs[c];
    if (prev && prev.cur === this.id && prev.ph === 1 && s.cur !== this.id) store.set({ myStickAt: serverNow() });
    incs[c] = s;
    store.set({ incs });
    if (s.cur === this.id && s.ph === 0 && !(this.then === 'censer' && this.censer === c)) {
      this.leaveSeat();
      this.leaveTable();
      this.activity = null;
      this.censer = c;
      this.goTo(CENSERS[c].stand.x, CENSERS[c].stand.z, 'censer');
    }
  }

  /** censer I'm offering at / queued for, or -1 */
  private myCenser(): number {
    return store.get().incs.findIndex((st) => st && (st.cur === this.id || st.q.includes(this.id)));
  }

  /** The hall I'm standing in gets the offering; otherwise the nearest censer. */
  censerHere(): number {
    const zone = store.get().zone;
    const inHall = CENSERS.findIndex((c) => c.hall === zone);
    if (inHall >= 0) return inHall;
    let best = 0;
    let bestD = Infinity;
    CENSERS.forEach((c, i) => {
      const d = Math.hypot(this.x - c.stand.x, this.z - c.stand.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ---------------- actions (called by UI / hotkeys) ----------------
  primaryAction() {
    if (inMoonYard(this.x, this.z)) return this.toggle(Pose.Dance);
    this.toggle(Pose.Bow);
  }

  toggle(a: typeof Pose.Bow | typeof Pose.Dance) {
    this.stop();
    this.activity = this.activity === a ? null : a;
    this.sendMove();
  }

  greet() {
    this.greetUntil = performance.now() + 2600;
    this.activity = this.activity === Pose.Bow || this.activity === Pose.Dance ? null : this.activity;
    toast(t('toast.greeted'));
    this.sendMove();
  }

  setActivity(a: Activity) {
    if (this.activity === a) return;
    if (a === null && this.activity !== Pose.Beads && this.activity !== Pose.Moktak) return;
    this.activity = a;
    this.sendMove();
  }

  offerIncense(c = this.censerHere()) {
    if (!this.net.online) return toast(t('incense.offline'));
    this.net.send({ t: 'inc', c });
  }

  cancelIncense() {
    this.net.send({ t: 'incx' });
    if (this.then === 'censer') this.stop();
  }

  requestSeat(i: number) {
    const owner = this.seatOwner.get(i);
    if (owner === this.id) return this.goTo(SEATS[i].x, SEATS[i].z, 'sit');
    if (owner !== undefined) return store.set({ seatAsk: { i, owner } });
    this.net.send({ t: 'seat', i });
  }

  /** confirmed from the "ask for seat" dialog */
  askForSeat(i: number) {
    const owner = this.seatOwner.get(i);
    store.set({ seatAsk: null });
    if (owner === undefined) return this.net.send({ t: 'seat', i });
    this.lastAskedName = this.nameOf(owner);
    this.net.send({ t: 'sreq', i });
    toast(t('seat.asked', { name: this.lastAskedName }));
  }

  answerSeat(ok: boolean) {
    this.net.send({ t: 'sans', ok });
    store.set({ seatIncoming: null });
  }

  // ---------------- game tables ----------------
  /** Ask the server for a seat at a table (side 0 / 1). */
  joinTable(i: number, side: Side) {
    this.net.send({ t: 'tb', a: 'join', i, side });
  }

  leaveTable() {
    if (this.table < 0) return;
    this.net.send({ t: 'tb', a: 'leave', i: this.table });
    this.table = -1;
    this.atTable = false;
  }

  tableAction(a: 'move' | 'resign' | 'reset', i: number, m?: number[]) {
    this.net.send({ t: 'tb', a, i, m });
  }

  get myId() {
    return this.id;
  }

  // ---------------- pond ----------------
  /** Walk to the nearest shore, then release a fish. */
  releaseFish() {
    const [sx, sz] = this.world.pond.shore(this.x, this.z);
    const { pond } = WORLD;
    const a = Math.atan2(sz - pond.z, sx - pond.x);
    const bx = pond.x + Math.cos(a) * (pond.r + 1.6);
    const bz = pond.z + Math.sin(a) * (pond.r + 1.6);
    if (Math.hypot(this.x - bx, this.z - bz) < 2.5) return this.net.send({ t: 'fish' });
    this.leaveSeat();
    this.leaveTable();
    this.goTo(bx, bz, 'fish');
  }

  standUp() {
    this.leaveSeat();
    this.sendMove();
  }

  rename(name: string) {
    store.set({ myName: name });
    this.net.send({ t: 'name', n: name });
  }

  private leaveSeat() {
    if (this.seat >= 0) this.net.send({ t: 'unseat' });
    this.seat = -1;
    if (this.seated) {
      this.seated = false;
      store.set({ seated: false });
    }
  }

  /** Tea house only: pour from the pot, or sip from the cup (short one-shot gestures). */
  tea(kind: 'pour' | 'drink') {
    if (!this.seated || SEATS[this.seat]?.area !== 'tea') return;
    this.teaPose = kind === 'pour' ? Pose.PourTea : Pose.DrinkTea;
    this.teaUntil = performance.now() + (kind === 'pour' ? 3400 : 2800);
    if (store.get().soundOn) (kind === 'pour' ? audio.pour() : audio.sip());
    this.sendMove();
  }

  get atTea() {
    return this.seated && SEATS[this.seat]?.area === 'tea';
  }

  get pose(): Pose {
    if (performance.now() < this.teaUntil && this.seated) return this.teaPose;
    if (store.get().incs.some((st) => st && st.cur === this.id && st.ph === 1)) return Pose.Offer;
    if (this.speed > 0.3) return Pose.Idle;
    if (performance.now() < this.greetUntil) return Pose.Greet;
    if (this.activity !== null) return this.activity;
    return this.seated || this.atTable ? Pose.Sit : Pose.Idle;
  }

  private sendMove(force = false) {
    if (force || this.net.online) this.net.move(this.x, this.z, this.r, this.pose);
  }

  /** Route to (x,z) with A*; `then` = what to do on arrival. */
  goTo(x: number, z: number, then: Then | null = null) {
    const route = this.nav.find(this.x, this.z, x, z);
    this.then = then;
    if (!route) {
      this.path = [];
      if (then) this.arrive();
      else toast(t('nav.unreachable'));
      return;
    }
    // seats and the censer stand lie inside obstacle padding: walk the final leg directly
    if (then) route[route.length - 1] = { x, z };
    this.path = route;
    this.stuck = 0;
    if (!then) {
      this.marker.position.set(x, this.world.groundHeight(x, z) + 0.03, z);
      this.marker.visible = true;
    } else this.marker.visible = false;
  }

  private stop() {
    this.path = [];
    this.then = null;
    this.marker.visible = false;
  }

  private moveTo(x: number, z: number) {
    if (this.arriving) return;
    if (this.myCenser() >= 0) this.cancelIncense();
    this.leaveSeat();
    this.leaveTable();
    if (this.activity === Pose.Bow || this.activity === Pose.Dance) this.activity = null;
    this.goTo(x, z);
  }

  /** sent with every (re)connect so a different server instance restores me in place */
  joinHint(): JoinHint | null {
    if (!this.id) return null;
    if (this.seat >= 0) this.reclaimSeat = this.seat;
    return { x: this.x, z: this.z, ...this.ident };
  }

  // ---------------- minimap ----------------
  mapSnapshot(): MapDot[] {
    const out: MapDot[] = [{ x: this.x, z: this.z, self: true, r: this.r }];
    for (const r of this.remotes.values()) out.push({ x: r.x, z: r.z });
    return out;
  }

  walkTo(x: number, z: number) {
    const [rx, rz] = this.world.resolve(x, z);
    this.moveTo(rx, rz);
  }

  // ---------------- input ----------------
  private bindInput() {
    const el = this.renderer.domElement;
    const sig = { signal: this.abort.signal };
    el.addEventListener(
      'pointerdown',
      (e) => {
        el.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 1) this.drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.drag) this.drag.moved = true;
        }
      },
      sig,
    );
    el.addEventListener(
      'pointermove',
      (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinch) this.zoom(this.pinch / d);
          this.pinch = d;
          return;
        }
        if (!this.drag) return;
        if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) this.drag.moved = true;
        if (this.drag.moved) {
          this.tYaw -= dx * 0.006;
          this.tPitch = Math.min(1.25, Math.max(0.06, this.tPitch + dy * 0.004));
        }
      },
      sig,
    );
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      if (this.drag && this.pointers.size === 0) {
        if (!this.drag.moved && performance.now() - this.drag.t < 500) this.click(e.clientX, e.clientY);
        this.drag = null;
      }
    };
    el.addEventListener('pointerup', up, sig);
    el.addEventListener('pointercancel', up, sig);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(1 + Math.sign(e.deltaY) * Math.min(0.25, Math.abs(e.deltaY) * 0.0015));
      },
      { ...sig, passive: false },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (store.get().panel === 'beads' || (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) return;
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          this.keys.add(e.code);
          e.preventDefault();
        }
      },
      sig,
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), sig);
    window.addEventListener('blur', () => this.keys.clear(), sig);
  }

  private zoom(f: number) {
    this.tDist = Math.min(30, Math.max(2.6, this.tDist * f));
  }

  private click(cx: number, cy: number) {
    if (this.arriving) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObjects(this.world.clickables, true)[0];
    const ground = this.world.pickGround(this.ray.ray);
    // an object wins only if it is in front of the ground point
    if (hit && (!ground || hit.distance < ground.distanceTo(this.ray.ray.origin) + 0.5)) {
      const kind = hit.object.userData.kind as string | undefined;
      if (kind === 'censer') return this.offerIncense(hit.object.userData.censer as number);
      if (kind === 'dj') return store.set({ panel: 'dj' });
      if (kind === 'table') return store.set({ panel: 'game', gameTable: hit.object.userData.table as number });
      if (kind === 'pond') return this.releaseFish();
      if (kind === 'bell' || kind === 'drum') return this.net.send({ t: 'ring', k: kind === 'bell' ? Instrument.Bell : Instrument.Drum });
      const idx = hit.object.userData.seatIdx as number[] | undefined;
      if (idx && hit.instanceId !== undefined) return this.requestSeat(idx[hit.instanceId]);
    }
    if (!ground) return;
    const [x, z] = this.world.resolve(ground.x, ground.z);
    this.moveTo(x, z);
  }

  // ---------------- frame ----------------
  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    const portrait = w < h;
    // phones in portrait: wider lens, camera further back and a bit higher so you
    // still see the halls around you instead of just your own back
    this.camera.fov = portrait ? 68 : 55;
    this.camera.updateProjectionMatrix();
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.tDist = portrait ? 12 : 9;
      this.tPitch = portrait ? 0.5 : 0.42;
    }
  }

  private frame() {
    // battery saver: low-end devices render at ~30 fps (smooth enough, half the heat)
    const t0 = performance.now();
    if (this.low && t0 - this.lastRender < 30) return;
    this.lastRender = t0;
    const dt = Math.min(0.06, this.clock.getDelta());
    this.frameNo++;
    const now = performance.now();
    const sNow = serverNow();
    const dj = store.get().dj;
    const beat = dj ? djBeat(dj, sNow) : 0;
    this.updateSelf(dt);
    const selfLift = this.seated && this.seat >= 0 ? seatTop(this.seat) : this.atTable ? STOOL_TOP : 0;
    if (!this.arriving) {
      // (while riding, the cart carries the avatar)
      this.self.root.position.set(this.x, damp(this.self.root.position.y, this.world.groundHeight(this.x, this.z) + selfLift, 12, dt), this.z);
      this.self.root.rotation.y = this.r;
    }
    this.self.animate(dt, this.arriving ? Pose.Sit : this.pose, this.arriving ? 0 : this.speed, this.arriving || this.seated || this.atTable, beat);
    this.self.updateOverlay(now, 0);

    // where each remote visitor sits: cushion / stone / stool height
    const seatOf = new Map<number, number>();
    for (const [i, id] of this.seatOwner) seatOf.set(id, seatTop(i));
    for (const tb of store.get().tables) for (const id of tb.p) if (id !== null) seatOf.set(id, STOOL_TOP);
    const cam = this.camera.position;
    for (const rp of this.remotes.values()) {
      const { x, z, r } = rp.update(now, dt);
      const root = rp.avatar.root;
      if (rp.riding) {
        rp.avatar.animate(dt, Pose.Sit, 0, true, beat);
        continue;
      }
      const lift = rp.speed < 0.2 ? seatOf.get(rp.id) ?? 0 : 0;
      root.position.set(x, damp(root.position.y, this.world.groundHeight(x, z) + lift, 12, dt), z);
      root.rotation.y = r;
      const d = Math.hypot(cam.x - x, cam.z - z);
      // far-away visitors are tiny on screen: animate them every other frame
      if (d < 45 || (this.frameNo + rp.id) % 2 === 0) rp.avatar.animate(d < 45 ? dt : dt * 2, rp.pose, rp.speed, rp.pose === Pose.Sit || (lift > 0 && rp.speed < 0.2), beat);
      rp.avatar.updateOverlay(now, d);
    }
    this.world.dj.animate(dt, Pose.Dance, 0, false, beat);
    this.world.update(dt, Date.now(), now / 1000);
    if (this.marker.visible) (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(now / 200) * 0.3;

    // camera: smooth follow + eased orbit/zoom
    this.yaw = damp(this.yaw, this.tYaw, 14, dt);
    this.pitch = damp(this.pitch, this.tPitch, 14, dt);
    this.dist = damp(this.dist, this.tDist, 10, dt);
    const gy = this.self.root.position.y;
    // during my shuttle ride the camera follows the cart
    const cart = this.arriving ? this.world.shuttle.latest() : null;
    const fx = cart ? cart.x : this.x;
    const fz = cart ? cart.z : this.z;
    this.camTarget.x = damp(this.camTarget.x, fx, cart ? 4 : 7, dt);
    this.camTarget.y = damp(this.camTarget.y, (cart ? 0 : gy) + 1.3, 7, dt);
    this.camTarget.z = damp(this.camTarget.z, fz, cart ? 4 : 7, dt);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.camTarget.x + Math.sin(this.yaw) * cp * this.dist,
      Math.max(0.6, this.camTarget.y + Math.sin(this.pitch) * this.dist),
      this.camTarget.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.camTarget);
    this.world.followShadow(this.x, this.z);
    this.world.cull(this.camera.position, dt);

    this.slowUpdates(dt);
    this.renderer.render(this.world.scene, this.camera);
    this.adaptQuality(dt);
  }

  private updateSelf(dt: number) {
    let wx = 0;
    let wz = 0;
    let maxSpeed = SPEED;
    const k = this.arriving ? new Set<string>() : this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (fwd || side) {
      if (this.path.length || this.seated || this.atTable || this.activity === Pose.Bow || this.activity === Pose.Dance) {
        if (this.then === 'censer') this.cancelIncense();
        this.stop();
        this.leaveSeat();
        this.leaveTable();
        if (this.activity === Pose.Bow || this.activity === Pose.Dance) this.activity = null;
      }
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      wx = fx * fwd - fz * side;
      wz = fz * fwd + fx * side;
      const l = Math.hypot(wx, wz);
      wx /= l;
      wz /= l;
    } else if (this.path.length) {
      const wp = this.path[0];
      const tx = wp.x - this.x;
      const tz = wp.z - this.z;
      const d = Math.hypot(tx, tz);
      const last = this.path.length === 1;
      if (d < (last ? 0.06 : 0.35)) {
        this.path.shift();
        if (!this.path.length) this.arrive();
      } else {
        wx = tx / d;
        wz = tz / d;
        if (last) maxSpeed = Math.min(SPEED, 0.6 + d * 2.2); // ease into the final stop
      }
    }
    // velocity eases toward the wanted direction → no instant starts / stops
    this.vx = damp(this.vx, wx * maxSpeed, ACCEL, dt);
    this.vz = damp(this.vz, wz * maxSpeed, ACCEL, dt);
    if (!wx && !wz && Math.hypot(this.vx, this.vz) < 0.05) this.vx = this.vz = 0;
    const step = Math.hypot(this.vx, this.vz) * dt;
    if (step > 0) {
      const direct = this.then !== null && this.path.length === 1;
      const [nx, nz] = this.steer(this.vx * dt, this.vz * dt, direct);
      const moved = Math.hypot(nx - this.x, nz - this.z);
      if (moved < 1e-4 && !this.path.length) {
        this.vx = this.vz = 0;
      }
      this.stuck = this.path.length && moved < step * 0.2 ? this.stuck + dt : 0;
      if (this.stuck > 0.6) {
        // something in the way — re-plan to the same goal
        const goal = this.path[this.path.length - 1];
        this.stuck = 0;
        if (goal) this.goTo(goal.x, goal.z, this.then);
      }
      this.speed = moved / dt;
      if ((wx || wz) && moved > 1e-3) {
        // face where we actually go (looks natural while side-stepping)
        let dr = Math.atan2(nx - this.x, nz - this.z) - this.r;
        dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        this.r += dr * (1 - Math.exp(-10 * dt));
      }
      this.x = nx;
      this.z = nz;
    } else this.speed = damp(this.speed, 0, 12, dt);
    // standing still on top of someone (e.g. both arrived at once)? drift apart gently
    if (this.speed < 0.05 && !this.seated && !this.atTable && !this.path.length && !this.arriving) {
      const [ax, az] = this.avoidPeople(this.x, this.z, 0.6 * dt * 4);
      if (ax !== this.x || az !== this.z) {
        const [rx, rz] = this.world.resolve(ax, az);
        const h0 = terrainHeight(this.x, this.z);
        const h1 = terrainHeight(rx, rz);
        if (!Number.isNaN(h1) && Math.abs(h1 - h0) <= STEP_MAX) {
          this.x = rx;
          this.z = rz;
        }
      }
    }
    if (this.speed > 0.05 || this.pose !== store.get().pose) {
      store.set({ pose: this.pose });
      this.sendMove();
    }
  }

  /**
   * Local obstacle avoidance. Try the wanted step; if a wall, tree, person, cart, water or a
   * too-high ledge blocks most of it, fan out to the sides and take the first direction that
   * still makes progress — so you walk AROUND things instead of grinding against them.
   */
  private steer(sx: number, sz: number, direct: boolean): [number, number] {
    const len = Math.hypot(sx, sz);
    if (len < 1e-6) return [this.x, this.z];
    const h0 = terrainHeight(this.x, this.z);
    const okH = (x: number, z: number) => {
      const h = terrainHeight(x, z);
      return !Number.isNaN(h) && (Number.isNaN(h0) || Math.abs(h - h0) <= STEP_MAX);
    };
    let best: [number, number] | null = null;
    let bestAlong = 0;
    for (const a of [0, 0.45, -0.45, 0.9, -0.9, 1.3, -1.3]) {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const ax = sx * c - sz * sn;
      const az = sx * sn + sz * c;
      let [nx, nz] = direct ? [this.x + ax, this.z + az] : this.world.resolve(this.x + ax, this.z + az);
      if (!direct) [nx, nz] = this.avoidPeople(nx, nz);
      if (!okH(nx, nz)) continue;
      const along = ((nx - this.x) * sx + (nz - this.z) * sz) / len;
      if (along >= len * (a === 0 ? 0.6 : 0.3)) return [nx, nz];
      if (along > bestAlong) {
        bestAlong = along;
        best = [nx, nz];
      }
    }
    return best ?? [this.x, this.z];
  }

  /**
   * People never overlap: push the point out of other visitors' personal space (0.7 m)
   * and add a small sideways bias so we walk around them instead of stopping dead.
   */
  private avoidPeople(x: number, z: number, maxPush = Infinity): [number, number] {
    const R = 0.7;
    let px = 0;
    let pz = 0;
    for (const rp of this.remotes.values()) {
      if (rp.riding) continue;
      const dx = x - rp.x;
      const dz = z - rp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 0.001;
      const push = R - d;
      // normal push + tangential slide (always to the right of my heading) to get past
      const nx = dx / d;
      const nz = dz / d;
      px += nx * push + -nz * push * 0.6;
      pz += nz * push + nx * push * 0.6;
    }
    for (const c of this.world.shuttle.carts()) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4 && d > 1e-3) {
        px += (dx / d) * (2.4 - d);
        pz += (dz / d) * (2.4 - d);
      }
    }
    const len = Math.hypot(px, pz);
    if (len > maxPush) {
      px *= maxPush / len;
      pz *= maxPush / len;
    }
    return [x + px, z + pz];
  }

  private arrive() {
    const then = this.then;
    this.then = null;
    this.marker.visible = false;
    if (then === 'sit' && this.seat >= 0) {
      const s = SEATS[this.seat];
      this.x = s.x;
      this.z = s.z;
      this.r = s.r;
      this.seated = true;
      store.set({ seated: true });
    } else if (then === 'censer') {
      const c = CENSERS[this.censer];
      this.x = c.stand.x;
      this.z = c.stand.z;
      this.r = Math.atan2(c.x - c.stand.x, c.z - c.stand.z);
    } else if (then === 'table' && this.table >= 0) {
      const st = tableSeat(TABLES[this.table], this.tableSide);
      this.x = st.x;
      this.z = st.z;
      this.r = st.r;
      this.atTable = true;
      this.activity = null;
    } else if (then === 'fish') {
      const { pond } = WORLD;
      this.r = Math.atan2(pond.x - this.x, pond.z - this.z);
      this.net.send({ t: 'fish' });
    }
    this.vx = this.vz = 0;
    this.sendMove();
  }

  private slowUpdates(dt: number) {
    this.zoneClock += dt;
    if (this.zoneClock > 0.25) {
      this.zoneClock = 0;
      store.set({ zone: this.zone() });
      const m = WORLD.moonYard;
      const d = Math.hypot(this.x - m.x, this.z - m.z);
      audio.setMusicProximity(Math.min(1, Math.max(0, (m.r + 9 - d) / 9)));
      audio.setHallProximity(this.hallProximity());
      if (this.visitorsDirty) {
        this.visitorsDirty = false;
        const list: Visitor[] = [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, adj: r.adj, noun: r.noun, tint: r.tint }));
        store.set({ visitors: list });
      }
    }
    this.hourClock += dt;
    if (this.hourClock > 5) {
      this.hourClock = 0;
      const d = new Date();
      this.world.setHour(this.hourOverride ?? d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600);
      audio.setNight(this.world.night > 0.5);
    }
  }

  /** 1 inside a hall, fading to 0 about 12 m away from it. */
  private hallProximity() {
    let best = 0;
    for (const h of HALLS) {
      const r = hallRect(h);
      const dx = Math.max(r.x0 - this.x, 0, this.x - r.x1);
      const dz = Math.max(r.z0 - this.z, 0, this.z - r.z1);
      best = Math.max(best, 1 - Math.min(1, Math.hypot(dx, dz) / 12));
    }
    return best * best;
  }

  private zone(): Zone {
    const { x, z } = this;
    for (const h of [...HALLS, ...PAVILIONS]) {
      const r = hallRect(h);
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return h.id;
    }
    const near = (p: { x: number; z: number }, r: number) => Math.hypot(x - p.x, z - p.z) < r;
    if (inMoonYard(x, z)) return 'moon';
    if (near(WORLD.bellTower, 5)) return 'bell';
    if (near(WORLD.drumTower, 5)) return 'drum';
    if (near(WORLD.pond, WORLD.pond.r + 5)) return 'pond';
    if (near(STUPA, STUPA.lowerR + 3) || (Math.abs(x - STUPA.x) < 3 && z < STUPA.z && z > STUPA.z - STUPA.lowerR - STUPA.stairLen)) return 'stupa';
    if (near(WORLD.bodhi, 10)) return 'bodhi';
    if (near(WORLD.gate, 8)) return 'gate';
    const g = gardenRect();
    if (x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1) return 'garden';
    if (near(WORLD.courtyard, WORLD.courtyard.r + 1)) return 'courtyard';
    if (Math.abs(x) < 5 && z > -4 && z < WORLD.gate.z) return 'path';
    return 'forest';
  }

  /** Dynamic resolution: keep ~50+ fps on weak devices instead of stuttering. */
  private adaptQuality(dt: number) {
    if (store.get().quality !== 'auto') return;
    this.frameAvg = this.frameAvg * 0.95 + dt * 1000 * 0.05;
    this.perfClock += dt;
    if (this.perfClock < 1) return;
    this.perfClock = 0;
    if (this.frameAvg > (this.low ? 40 : 24)) this.slowTimer++;
    else if (this.frameAvg < (this.low ? 34 : 15)) this.slowTimer = Math.min(0, this.slowTimer - 1);
    else this.slowTimer = 0;
    let next = this.pixelRatio;
    // already at the lowest resolution and still slow → step the whole tier down
    if (this.slowTimer >= 4 && this.pixelRatio <= 0.61) {
      const cur = store.get().autoTier;
      const lower = cur === 'high' ? 'medium' : cur === 'medium' ? 'low' : null;
      if (lower) {
        this.autoTier = lower;
        this.slowTimer = 0;
        this.setQuality();
        return;
      }
    }
    if (this.slowTimer >= 2) next = Math.max(0.6, this.pixelRatio - 0.15);
    else if (this.slowTimer <= -4) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
      this.slowTimer = 0;
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.abort.abort();
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/**
 * Coarse device tiering, no benchmarks needed: touch + few cores / little RAM /
 * an old mobile GPU → "weak" (Lambert materials, no shadows, 30 fps, fewer props).
 */
export function deviceProfile() {
  const mobile = matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 820;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    /* ignore */
  }
  const oldGpu = /Adreno \(TM\) [1-5]\d\d|Mali-[4T]|Mali-G[57]1|PowerVR|SGX|Intel\(R\) HD Graphics [2-5]\d{2,3}\b/i.test(gpu);
  const weak = (mobile && (cores <= 4 || mem <= 3)) || oldGpu || mem <= 2;
  return { mobile, weak, gpu };
}

export function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export type JoinHint = { x: number; z: number; a: number; n: number; c: number };

/** Height of the top of seat i (cushion or Bodhi stone) so avatars sit on it, not in it. */
function seatTop(i: number) {
  return SEATS[i]?.area === 'bodhi' ? STONE_TOP : CUSHION_TOP;
}
