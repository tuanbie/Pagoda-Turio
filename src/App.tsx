import { useCallback, useEffect, useRef } from 'react';
import { MAX_NAME_CHARS, Pose, serviceStatus } from '@sontu/shared';
import { store, serverNow, toast, useStore } from './store.ts';
import { audio } from './audio/AudioEngine.ts';
import { Net } from './net/Net.ts';
import { Game, webglAvailable } from './game/Game.ts';
import { runtime } from './runtime.ts';
import { t as tt } from './i18n/index.ts';
import { Icon, useT } from './ui/common.tsx';
import { ActionBar, IncenseCard, NetBanner, ServiceBanner, StatusLine, Toast, TopBar } from './ui/Hud.tsx';
import { DonatePanel, LanguageSelect, ServersPanel, SettingsPanel, VisitorsPanel } from './ui/Panels.tsx';
import { BeadsOverlay } from './ui/Beads.tsx';
import { MoktakOverlay } from './ui/Moktak.tsx';
import { ChatPanel, DjPanel, Minimap, SeatDialogs } from './ui/Social.tsx';

export function App() {
  const phase = useStore((s) => s.phase);
  const locale = useStore((s) => s.locale);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${tt('app.name')} · ${tt('app.tagline')}`;
    runtime.game?.refreshLabels();
  }, [locale]);

  // boot: fetch live visitor count for the welcome card, then show it
  useEffect(() => {
    if (phase !== 'boot') return;
    Net.rooms()
      .then((rooms) => store.set({ onlineHint: rooms.reduce((n, r) => n + r.count, 0) }))
      .catch(() => {})
      .finally(() => store.set({ phase: 'welcome' }));
  }, [phase]);

  const enter = useCallback(async () => {
    if (!webglAvailable()) return store.set({ phase: 'error' });
    store.set({ myName: store.get().myName.trim() });
    if (store.get().soundOn) await audio.unlock();
    const net = new Net({
      onMessage: (m) => {
        runtime.game?.handle(m);
        if (m.t === 'hi') toast(tt('net.connected', { n: m.room.num }));
        if (m.t === 'bye') toast(tt('net.restart'));
      },
      onStatus: (s) => store.set({ net: s }),
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
      runtime.game = new Game(host.current!, runtime.net!);
    };
    runtime.rebuildGame = () => {
      build();
      void runtime.net?.connect();
    };
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
    </>
  );
}

function InGame({ onLeave }: { onLeave: () => void }) {
  const panel = useStore((s) => s.panel);
  const resting = useStore((s) => s.resting);
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
      {resting && <RestOverlay />}
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
        {online > 0 && <p className="online">{t('welcome.online', { n: online })}</p>}
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

function RestOverlay() {
  const t = useT();
  return (
    <div className="rest">
      <p>{t('rest.title')}</p>
      <button
        className="primary"
        onClick={() => {
          store.set({ resting: false });
          void audio.resume();
        }}
      >
        {t('rest.continue')}
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

/** Tab hidden → "resting" overlay; audio pauses unless background play is on. */
function useVisibility(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.hidden) {
        store.set({ resting: true });
        if (!store.get().backgroundPlay) void audio.suspend();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]);
}
