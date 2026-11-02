import type { ClientMsg, Pose, RoomInfo, ServerMsg } from '@sontu/shared';
import { store, prefs } from '../store.ts';

export interface NetHandlers {
  onMessage(msg: ServerMsg): void;
  onStatus(status: 'connecting' | 'online' | 'reconnecting' | 'full'): void;
}

/**
 * WebSocket client with:
 *  - room directory lookup (/api/rooms) so we connect straight to the node hosting the room
 *  - resume token (same anonymous name/position after a reload or network blip)
 *  - exponential backoff with jitter (avoids a thundering herd after a server restart)
 *  - NTP-style clock sync, keeping the lowest-RTT sample
 *  - outgoing move throttling (≤ 10 Hz, only when changed)
 */
export class Net {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private closedByUser = false;
  private retryTimer = 0;
  private pingTimer = 0;
  private bestRtt = Infinity;
  private lastMove = '';
  private lastMoveAt = 0;
  private pendingMove: ClientMsg | null = null;
  private moveTimer = 0;
  roomId: string | null = prefs.get<string | null>('room', null);

  constructor(private h: NetHandlers) {}

  static async rooms(): Promise<RoomInfo[]> {
    const res = await fetch('/api/rooms', { cache: 'no-store' });
    if (!res.ok) throw new Error('rooms ' + res.status);
    return ((await res.json()) as { rooms: RoomInfo[] }).rooms;
  }

  async connect(roomId: string | null = this.roomId) {
    this.closedByUser = false;
    clearTimeout(this.retryTimer);
    this.h.onStatus(this.attempts ? 'reconnecting' : 'connecting');
    let url = '/ws';
    try {
      const rooms = await Net.rooms();
      const target = rooms.find((r) => r.id === roomId && r.count < r.cap) ?? rooms.find((r) => r.count < r.cap);
      if (target) {
        roomId = target.id;
        url = target.url;
      } else roomId = null;
    } catch {
      /* directory down -> let the default node pick */
    }
    const abs = /^wss?:/.test(url) ? new URL(url) : new URL(url, location.href.replace(/^http/, 'ws'));
    if (roomId) abs.searchParams.set('room', roomId);
    const name = store.get().myName;
    if (name) abs.searchParams.set('name', name);
    const token = sessionStorage.getItem('sontu:token');
    if (token) abs.searchParams.set('token', token);

    this.ws?.close();
    const ws = new WebSocket(abs);
    this.ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg;
      if (msg.t === 'hi') {
        this.attempts = 0;
        this.roomId = msg.room.id;
        prefs.set('room', msg.room.id);
        sessionStorage.setItem('sontu:token', msg.token);
        this.syncClock(msg.now, 0);
        this.h.onStatus('online');
        this.startPing();
      } else if (msg.t === 'pong') {
        this.syncClock(msg.s, performance.now() - msg.c);
        return;
      } else if (msg.t === 'full') {
        this.h.onStatus('full');
        this.roomId = null;
      }
      this.h.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      if (this.closedByUser) return;
      if (ev.code === 4001) {
        // room filled up between lookup and join: retry immediately anywhere
        this.roomId = null;
        prefs.set('room', null);
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    this.attempts++;
    this.h.onStatus('reconnecting');
    const base = Math.min(15_000, 500 * 2 ** Math.min(this.attempts, 5));
    this.retryTimer = window.setTimeout(() => void this.connect(), base * (0.5 + Math.random()));
  }

  switchRoom(roomId: string) {
    this.attempts = 0;
    void this.connect(roomId);
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }

  get online() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Coalesces movement to at most 10 msgs/s and skips unchanged states. */
  move(x: number, z: number, r: number, p: Pose) {
    const msg: ClientMsg = { t: 'mv', x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2), p };
    const key = `${msg.x},${msg.z},${msg.r},${p}`;
    if (key === this.lastMove) return;
    this.pendingMove = msg;
    const wait = 100 - (performance.now() - this.lastMoveAt);
    if (wait <= 0) this.flushMove();
    else if (!this.moveTimer) this.moveTimer = window.setTimeout(() => this.flushMove(), wait);
  }

  private flushMove() {
    this.moveTimer = 0;
    if (!this.pendingMove || !this.online) return;
    const m = this.pendingMove as Extract<ClientMsg, { t: 'mv' }>;
    this.lastMove = `${m.x},${m.z},${m.r},${m.p}`;
    this.lastMoveAt = performance.now();
    this.send(m);
    this.pendingMove = null;
  }

  private startPing() {
    clearInterval(this.pingTimer);
    this.bestRtt = Infinity;
    const ping = () => this.send({ t: 'ping', c: performance.now() });
    ping();
    setTimeout(ping, 1000);
    this.pingTimer = window.setInterval(ping, 10_000);
  }

  private syncClock(serverMs: number, rtt: number) {
    if (rtt && rtt > this.bestRtt * 1.5) return;
    if (rtt) this.bestRtt = Math.min(this.bestRtt, rtt);
    store.set({ clockOffset: Math.round(serverMs + rtt / 2 - Date.now()) });
  }
}
