import { useSyncExternalStore } from 'react';
import type { DjState, IncenseState, Pose } from '@sontu/shared';
import type { Locale } from './i18n/index.ts';

export type Panel = null | 'settings' | 'servers' | 'visitors' | 'donate' | 'beads' | 'moktak' | 'dj';
export type Zone = 'main' | 'west' | 'east' | 'courtyard' | 'bell' | 'drum' | 'garden' | 'pond' | 'stupa' | 'bodhi' | 'moon' | 'gate' | 'path' | 'forest';
export type Quality = 'auto' | 'high' | 'low';

export interface Visitor {
  id: number;
  name: string;
  adj: number;
  noun: number;
  tint: number;
}

export interface AppState {
  locale: Locale;
  phase: 'boot' | 'welcome' | 'in' | 'left' | 'error';
  net: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'full';
  room: { id: string; num: number; cap: number } | null;
  selfId: number;
  visitors: Visitor[];
  soundOn: boolean;
  volumes: { ambient: number; effects: number; chant: number; music: number };
  backgroundPlay: boolean;
  quality: Quality;
  pose: Pose;
  seated: boolean;
  zone: Zone;
  panel: Panel;
  inc: IncenseState;
  myStickAt: number;
  beadsTotal: number;
  moktakAuto: boolean;
  moktakCount: number;
  chantOn: boolean;
  serviceListening: boolean;
  musicOn: boolean;
  toast: { id: number; text: string } | null;
  resting: boolean;
  onlineHint: number;
  /** server clock minus local clock (ms) */
  clockOffset: number;
  myName: string;
  chat: ChatLine[];
  chatOpen: boolean;
  unread: number;
  /** I clicked a cushion someone else sits on */
  seatAsk: { i: number; owner: number } | null;
  /** someone asks for my cushion */
  seatIncoming: { i: number; from: number; at: number } | null;
  dj: DjState | null;
}

export interface ChatLine {
  key: number;
  id: number;
  name: string;
  adj: number;
  noun: number;
  text: string;
  at: number;
}

const ls = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem('sontu:' + k);
      return v === null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem('sontu:' + k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

type Listener = () => void;

class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }
  get = () => this.state;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  set(patch: Partial<AppState>) {
    let changed = false;
    for (const k in patch) if (patch[k as keyof AppState] !== this.state[k as keyof AppState]) changed = true;
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const k of ['locale', 'volumes', 'backgroundPlay', 'quality', 'beadsTotal', 'soundOn', 'musicOn', 'chatOpen', 'myName'] as const)
      if (k in patch) ls.set(k, this.state[k]);
    for (const l of this.listeners) l();
  }
}

let toastSeq = 0;

export const store = new Store({
  locale: ls.get<Locale | null>('locale', null) ?? 'vi',
  phase: 'boot',
  net: 'idle',
  room: null,
  selfId: 0,
  visitors: [],
  soundOn: ls.get('soundOn', true),
  volumes: ls.get('volumes', { ambient: 0.4, effects: 0.8, chant: 0.7, music: 0.6 }),
  backgroundPlay: ls.get('backgroundPlay', false),
  quality: ls.get<Quality>('quality', 'auto'),
  pose: 0,
  seated: false,
  zone: 'path',
  panel: null,
  inc: { cur: null, ph: 0, until: 0, q: [] },
  myStickAt: 0,
  beadsTotal: ls.get('beadsTotal', 0),
  moktakAuto: false,
  moktakCount: 0,
  chantOn: false,
  serviceListening: true,
  musicOn: ls.get('musicOn', true),
  toast: null,
  resting: false,
  onlineHint: 0,
  clockOffset: 0,
  myName: ls.get('name', ''),
  chat: [],
  // phones start with the chat folded so it doesn't cover the scene
  chatOpen: ls.get('chatOpen', !matchMedia('(pointer: coarse)').matches),
  unread: 0,
  seatAsk: null,
  seatIncoming: null,
  dj: null,
});

export function toast(text: string) {
  const id = ++toastSeq;
  store.set({ toast: { id, text } });
  setTimeout(() => store.get().toast?.id === id && store.set({ toast: null }), 3200);
}

export const serverNow = () => Date.now() + store.get().clockOffset;

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

export const prefs = ls;
