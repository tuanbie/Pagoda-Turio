import { useCallback, useEffect, useRef } from 'react';
import { MAX_NAME_CHARS, Pose, serviceStatus } from '@sontu/shared';
import { store, serverNow, toast, useStore } from './store.ts';
import { audio } from './audio/AudioEngine.ts';
import { Net } from './net/Net.ts';
import { webglAvailable } from './game/webgl.ts';
import type { Game as GameClass } from './game/Game.ts';
import { runtime } from './runtime.ts';
import { t as tt } from './i18n/index.ts';
import { siteConfig } from './config.ts';
import { Icon, LegalLinks, useT } from './ui/common.tsx';
import { ActionBar, IncenseCard, NetBanner, ServiceBanner, StatusLine, Toast, TopBar } from './ui/Hud.tsx';
import { DonatePanel, LanguageSelect, ServersPanel, SettingsPanel, VisitorsPanel } from './ui/Panels.tsx';
import { BeadsOverlay } from './ui/Beads.tsx';
import { MoktakOverlay } from './ui/Moktak.tsx';
import { ChatPanel, DjPanel, Minimap, SeatDialogs } from './ui/Social.tsx';
import { GamePanel } from './ui/GamePanel.tsx';
import { FeedbackPanel } from './ui/Feedback.tsx';

/**
 * The 3D engine (three.js + the scene, ~0.5 MB) is not needed for the welcome screen.
 * It is fetched in the background once the welcome card is up, and awaited on "enter"
 * before the socket opens, so the game always exists before the server's first message.
 */
let Game: typeof GameClass | null = null;
const loadGame = () => import('./game/Game.ts').then((m) => (Game = m.Game));

export function App() {
  const phase = useStore((s) => s.phase);
  const locale = useStore((s) => s.locale);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = tt('app.docTitle');
    runtime.game?.refreshLabels();
  }, [locale]);

  // boot: fetch live visitor count for the welcome card, then show it
  useEffect(() => {
    if (phase !== 'boot') return;
    Net.rooms()
      .then((rooms) => store.set({ onlineHint: rooms.reduce((n, r) => n + r.count, 0) }))
      .catch(() => {})
      .finally(() => {
        store.set({ phase: 'welcome' });
        loadGame().catch(() => {});
      });
  }, [phase]);

  const enter = useCallback(async () => {
    if (!webglAvailable()) return store.set({ phase: 'error' });
    store.set({ myName: store.get().myName.trim() });
    // audio first: it must start inside the click, before any other await
    if (store.get().soundOn) await audio.unlock();
    try {
      await loadGame();
    } catch {
      return store.set({ phase: 'error' });
    }
    const net = new Net({
      onMessage: (m) => {
        runtime.game?.handle(m);
        if (m.t === 'hi') toast(tt('net.connected', { n: m.room.num }));
        if (m.t === 'bye') toast(tt('net.restart'));
      },
      onStatus: (s) => {
        // only a real disconnect (after having been online) asks the visitor to reconnect
        if (s === 'online') store.set({ net: s, lost: false });
        else if (s === 'reconnecting') store.set({ net: s, lost: true });
        else store.set({ net: s });
      },
      hint: () => runtime.game?.joinHint() ?? null,
    });
    runtime.net = net;
    store.set({ phase: 'in', panel: null });
    void net.connect();
  }, []);

  useEffect(() => {
    if (phase !== 'in' || !host.current || !runtime.net) return;
    // the socket is still resolving the room directory here, so the game exists before 'hi' arrives
    const build = () => {
      runtime.game?.dispose();
      runtime.game = new Game!(host.current!, runtime.net!);
    };
    // graphics change: rebuild only the scene, the visitor keeps their place
    runtime.rebuildGame = () => runtime.game?.setQuality();
    try {
      build();
    } catch {
      store.set({ phase: 'error' });
    }
    return () => {
      runtime.game?.dispose();
      runtime.game = null;
    };
  }, [phase]);

  const leave = useCallback(() => {
    runtime.net?.close();
    runtime.net = null;
    void audio.suspend();
    store.set({ phase: 'left', panel: null, net: 'idle', visitors: [], chantOn: false });
  }, []);

  useAudioSync();
  useHotkeys(phase === 'in');
  useVisibility(phase === 'in');

  return (
    <>
      <div ref={host} className="game-host" />
      {phase === 'boot' && <BootScreen />}
      {phase === 'welcome' && <WelcomeScreen onEnter={enter} />}
      {phase === 'error' && <ErrorScreen />}
      {phase === 'left' && <LeaveScreen onAgain={() => store.set({ phase: 'welcome' })} />}
      {phase === 'in' && <InGame onLeave={leave} />}
      <FeedbackHost />
    </>
  );
}

/** the feedback form works everywhere: welcome screen, in the temple, after leaving */
function FeedbackHost() {
  const panel = useStore((s) => s.panel);
  return panel === 'feedback' ? <FeedbackPanel /> : null;
}

function InGame({ onLeave }: { onLeave: () => void }) {
  const panel = useStore((s) => s.panel);
  const lost = useStore((s) => s.lost);
  return (
    <div className="hud">
      <TopBar onLeave={onLeave} />
      <ServiceBanner />
      <NetBanner />
      <IncenseCard />
      <SeatDialogs />
      <ChatPanel />
      <Minimap />
      <StatusLine />
      <ActionBar />
      <Toast />
      {panel === 'settings' && <SettingsPanel />}
      {panel === 'servers' && <ServersPanel />}
      {panel === 'visitors' && <VisitorsPanel />}
      {panel === 'donate' && <DonatePanel />}
      {panel === 'beads' && <BeadsOverlay />}
      {panel === 'moktak' && <MoktakOverlay />}
      {panel === 'dj' && <DjPanel />}
      {panel === 'game' && <GamePanel />}
      {lost && <LostOverlay />}
    </div>
  );
}

function BootScreen() {
  const t = useT();
  return (
    <main className="screen boot" role="status">
      <span className="mark">
        <Icon name="temple" size={34} />
      </span>
      <h1>{t('app.name')}</h1>
      <p>{t('boot.opening')}</p>
      <span className="breath" />
    </main>
  );
}

function WelcomeScreen({ onEnter }: { onEnter: () => void }) {
  const t = useT();
  const online = useStore((s) => s.onlineHint);
  const name = useStore((s) => s.myName);
  return (
    <main className="screen welcome">
      <div className="welcome-card">
        <span className="mark">
          <Icon name="temple" size={34} />
        </span>
        <p className="eyebrow">淨心寺</p>
        <h1>{t('app.name')}</h1>
        <p className="meaning">{t('app.meaning')}</p>
        <p className="tagline">{t('app.tagline')}</p>
        <label className="field">
          <span>{t('welcome.name')}</span>
          <input
            className="name-input"
            value={name}
            maxLength={MAX_NAME_CHARS}
            placeholder={t('welcome.namePh')}
            onChange={(e) => store.set({ myName: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onEnter()}
          />
        </label>
        <div className="field">
          <span>
            <Icon name="globe" size={16} /> {t('welcome.language')}
          </span>
          <LanguageSelect />
        </div>
        <button className="primary" onClick={onEnter}>
          {t('welcome.enter')}
        </button>
        <p className="muted small">{t('welcome.soundHint')}</p>
        <button className="text-btn small-link" onClick={() => store.set({ panel: 'feedback' })}>
          💬 {t('feedback.open')}
        </button>
        {online > 0 && <p className="online">{t('welcome.online', { n: online })}</p>}
        <p className="disclaimer">{t('app.disclaimer', { name: siteConfig.developer.name })}</p>
        <LegalLinks />
      </div>
    </main>
  );
}

function ErrorScreen() {
  const t = useT();
  return (
    <main className="screen boot" role="alert">
      <h1 className="small-title">{t('boot.error')}</h1>
      <p>{t('boot.errorText')}</p>
      <button className="text-btn" onClick={() => location.reload()}>
        {t('boot.retry')}
      </button>
    </main>
  );
}

function LeaveScreen({ onAgain }: { onAgain: () => void }) {
  const t = useT();
  return (
    <main className="screen welcome">
      <div className="welcome-card">
        <p className="eyebrow">淨心寺</p>
        <h1 className="small-title">{t('leave.title')}</h1>
        <p className="tagline pre">{t('leave.text')}</p>
        <button className="primary" onClick={onAgain}>
          {t('leave.again')}
        </button>
      </div>
    </main>
  );
}

/** Shown only when the connection really drops (switching tabs keeps you inside). */
function LostOverlay() {
  const t = useT();
  const net = useStore((s) => s.net);
  return (
    <div className="rest" role="alertdialog" aria-label={t('net.lost')}>
      <p>{t('net.lost')}</p>
      <p className="muted small" style={{ maxWidth: 360, fontSize: 14 }}>
        {t('net.lostText')}
      </p>
      <button className="primary" disabled={net === 'connecting'} onClick={() => void runtime.net?.connect()}>
        {t('net.reconnect')}
      </button>
    </div>
  );
}

/** Keeps the audio engine in sync with the store (volumes, mute, chanting, services). */
function useAudioSync() {
  const volumes = useStore((s) => s.volumes);
  const soundOn = useStore((s) => s.soundOn);
  const chantOn = useStore((s) => s.chantOn);
  const listening = useStore((s) => s.serviceListening);
  const musicOn = useStore((s) => s.musicOn);
  const phase = useStore((s) => s.phase);
  useEffect(() => audio.setVolumes(volumes), [volumes]);
  useEffect(() => audio.setMuted(!soundOn), [soundOn]);
  useEffect(() => audio.setMusicEnabled(musicOn && phase === 'in'), [musicOn, phase]);
  useEffect(() => {
    const tick = () => {
      const { live } = serviceStatus(serverNow());
      const service = phase === 'in' && live && listening ? live.startsAt : null;
      audio.setService(service);
      // a shared service takes precedence over the private chant
      const wantChant = phase === 'in' && chantOn && service === null;
      if (wantChant !== chantActive) {
        chantActive = wantChant;
        audio.setChant(wantChant);
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [chantOn, listening, phase]);
}
let chantActive = false;

function useHotkeys(enabled: boolean) {
  const panel = useStore((s) => s.panel);
  useEffect(() => {
    const g = runtime.game;
    if (panel === 'beads') g?.setActivity(Pose.Beads);
    else if (panel === 'moktak') g?.setActivity(Pose.Moktak);
    else g?.setActivity(null);
  }, [panel]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      const panel = store.get().panel;
      if (panel === 'beads' && e.code !== 'Digit2') return;
      const g = runtime.game;
      switch (e.code) {
        case 'Digit1':
        case 'KeyE':
        case 'Space':
          if (e.target instanceof HTMLButtonElement && e.code === 'Space') return;
          e.preventDefault();
          g?.primaryAction();
          break;
        case 'Digit2':
          store.set({ panel: panel === 'beads' ? null : 'beads' });
          break;
        case 'Digit3':
          g?.greet();
          break;
        case 'Digit4':
          g?.toggle(Pose.Dance);
          break;
        case 'Digit5':
          store.set({ panel: panel === 'moktak' ? null : 'moktak' });
          break;
        case 'Digit6':
          g?.offerIncense();
          break;
        case 'Escape':
          if (panel) store.set({ panel: null });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * Switching tabs keeps you in the temple (the socket stays open; the browser just stops
 * drawing frames). Sound pauses in the background unless "background play" is on.
 */
function useVisibility(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.hidden) {
        if (!store.get().backgroundPlay) void audio.suspend();
      } else void audio.resume();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]);
}
