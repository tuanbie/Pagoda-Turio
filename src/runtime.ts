import type { Game } from './game/Game.ts';
import type { Net } from './net/Net.ts';
import { audio } from './audio/AudioEngine.ts';
import { store, toast } from './store.ts';
import { t } from './i18n/index.ts';

/** Imperative singletons shared by the React UI (game engine, socket, audio). */
export const runtime = {
  game: null as Game | null,
  net: null as Net | null,
  /** recreate the renderer (e.g. after a graphics quality change) */
  rebuildGame: null as null | (() => void),

  async toggleSound() {
    const on = !store.get().soundOn;
    if (on) await audio.unlock();
    audio.setMuted(!on);
    store.set({ soundOn: on });
  },

  /** Plays an effect if sound is on; otherwise hints how to enable it. */
  async effect(play: () => void) {
    if (!store.get().soundOn) return toast(t('toast.needSound'));
    if (!audio.ready) await audio.unlock();
    play();
  },
};

// handy for support/debugging from the browser console
(window as unknown as { sontu: typeof runtime & { store: typeof store } }).sontu = Object.assign(runtime, { store });
