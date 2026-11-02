import { useEffect, useState } from 'react';
import { INCENSE_BURN_MS, Pose, serviceStatus } from '@sontu/shared';
import { store, serverNow, useStore } from '../store.ts';
import { formatTime, visitorName } from '../i18n/index.ts';
import { runtime } from '../runtime.ts';
import { Icon, useT } from './common.tsx';

export function TopBar({ onLeave }: { onLeave: () => void }) {
  const t = useT();
  const room = useStore((s) => s.room);
  const count = useStore((s) => s.visitors.length + 1);
  const soundOn = useStore((s) => s.soundOn);
  const net = useStore((s) => s.net);
  return (
    <header className="topbar">
      <button className="brand" onClick={() => store.set({ panel: 'servers' })} aria-label={t('top.chooseServer')}>
        <Icon name="temple" size={22} />
        <span className="brand-name">{t('app.name')}</span>
        {room && <small>{t('top.server', { n: room.num })}</small>}
      </button>
      <div className="top-actions">
        <button className="pill" onClick={() => store.set({ panel: 'visitors' })} aria-label={t('top.visitors')}>
          <span className={`dot ${net === 'online' ? 'on' : ''}`} />
          {t('top.people', { n: count })}
        </button>
        <button
          className={`icon-btn ${soundOn ? 'active' : ''}`}
          onClick={() => runtime.toggleSound()}
          aria-label={soundOn ? t('top.soundOff') : t('top.soundOn')}
          title={soundOn ? t('top.soundOff') : t('top.soundOn')}
        >
          <Icon name={soundOn ? 'soundOn' : 'soundOff'} />
        </button>
        <button className="icon-btn" onClick={() => store.set({ panel: 'donate' })} aria-label={t('top.donate')} title={t('top.donate')}>
          <Icon name="heart" />
        </button>
        <button className="icon-btn" onClick={() => store.set({ panel: 'settings' })} aria-label={t('top.settings')} title={t('top.settings')}>
          <Icon name="gear" />
        </button>
        <button className="icon-btn" onClick={onLeave} aria-label={t('top.leave')} title={t('top.leave')}>
          <Icon name="leave" />
        </button>
      </div>
    </header>
  );
}

export function ActionBar() {
  const t = useT();
  const zone = useStore((s) => s.zone);
  const pose = useStore((s) => s.pose);
  const panel = useStore((s) => s.panel);
  const seated = useStore((s) => s.seated);
  const inMoon = zone === 'moon';
  const primaryActive = pose === Pose.Bow || pose === Pose.Dance;
  const g = () => runtime.game;
  const btn = (key: string, icon: string, label: string, kbd: string, onClick: () => void, active = false) => (
    <button key={key} className={`action ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active} aria-keyshortcuts={kbd}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
      <kbd>{kbd}</kbd>
    </button>
  );
  return (
    <nav className="actionbar" aria-label="actions">
      {btn('p', inMoon ? 'dance' : 'bow', primaryActive ? t('act.stop') : inMoon ? t('act.dance') : t('act.bow'), '1', () => g()?.primaryAction(), primaryActive)}
      {btn('b', 'beads', t('act.beads'), '2', () => store.set({ panel: panel === 'beads' ? null : 'beads' }), panel === 'beads')}
      {btn('g', 'greet', t('act.greet'), '3', () => g()?.greet(), pose === Pose.Greet)}
      {btn('m', 'moktak', t('act.moktak'), '5', () => store.set({ panel: panel === 'moktak' ? null : 'moktak' }), panel === 'moktak')}
      {btn('i', 'incense', t('act.incense'), '6', () => g()?.offerIncense())}
      {zone === 'pond' && btn('f', 'fish', t('act.fish'), '', () => g()?.releaseFish())}
      {seated && zone === 'tea' && btn('tp', 'teapot', t('act.pour'), '', () => g()?.tea('pour'), pose === Pose.PourTea)}
      {seated && zone === 'tea' && btn('td', 'cup', t('act.drink'), '', () => g()?.tea('drink'), pose === Pose.DrinkTea)}
      {seated && btn('s', 'stand', t('act.stand'), '', () => g()?.standUp())}
    </nav>
  );
}

export function StatusLine() {
  const t = useT();
  const zone = useStore((s) => s.zone);
  const seated = useStore((s) => s.seated);
  const touch = matchMedia('(pointer: coarse)').matches;
  return (
    <div className="statusline">
      <strong>{t(`zone.${zone}` as 'zone.hall')}</strong>
      <span>
        {seated
          ? t('seat.sitting')
          : zone === 'main' || zone === 'west' || zone === 'east' || zone === 'jizo' || zone === 'maitreya'
            ? t('hint.cushion')
            : zone === 'tea'
              ? t('hint.tea')
              : zone === 'talk'
                ? t('hint.talk')
                : zone === 'games'
                  ? t('hint.games')
                  : zone === 'pond'
                    ? t('hint.pond')
                    : zone === 'stupa'
                      ? t('hint.stupa')
            : zone === 'bell' || zone === 'drum'
              ? t('hint.bell')
              : zone === 'bodhi'
                ? t('hint.bodhi')
                : zone === 'moon'
                  ? t('dj.hint')
                  : touch
                    ? t('hint.touch')
                    : t('hint.desktop')}
      </span>
    </div>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function ServiceBanner() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const listening = useStore((s) => s.serviceListening);
  const now = useNow(5000);
  const { live, next } = serviceStatus(now);
  if (live) {
    const name = t(`service.${live.kind}`);
    return (
      <div className="service live">
        <span className="pulse" />
        <span>{t('service.live', { name })}</span>
        <button onClick={() => store.set({ serviceListening: !listening })}>{listening ? t('service.stop') : t('service.listen')}</button>
      </div>
    );
  }
  return <div className="service">{t('service.next', { name: t(`service.${next.kind}`), time: formatTime(locale, next.startsAt) })}</div>;
}

export function IncenseCard() {
  const t = useT();
  const inc = useStore((s) => s.inc);
  const me = useStore((s) => s.selfId);
  const myStickAt = useStore((s) => s.myStickAt);
  const locale = useStore((s) => s.locale);
  const visitors = useStore((s) => s.visitors);
  const now = useNow(250);
  const qi = inc.q.indexOf(me);
  let title = '';
  let sub = '';
  let progress = -1;
  let cancel = false;
  if (inc.cur === me && inc.ph === 0) {
    title = t('incense.walking');
    sub = t('incense.calm');
    cancel = true;
  } else if (inc.cur === me && inc.ph === 1) {
    title = t('incense.offering');
    sub = t('incense.offeringSub');
    progress = 1 - Math.max(0, inc.until - now) / 7000;
  } else if (qi >= 0) {
    title = t('incense.title');
    sub = t('incense.ahead', { n: qi + 1 });
    cancel = true;
  } else if (myStickAt && now - myStickAt < 12_000) {
    title = t('incense.done');
    sub = t('incense.doneSub');
    progress = 1 - (now - myStickAt) / INCENSE_BURN_MS;
  } else if (inc.cur !== null && inc.cur !== me) {
    const v = visitors.find((x) => x.id === inc.cur);
    if (!v) return null;
    return <div className="incense-card subtle">{t('incense.someone', { name: v.name || visitorName(locale, v.adj, v.noun) })}</div>;
  } else return null;
  return (
    <div className="incense-card" role="status">
      <Icon name="incense" size={26} />
      <div>
        <strong>{title}</strong>
        <p>{sub}</p>
        {progress >= 0 && (
          <div className="bar">
            <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </div>
      {cancel && (
        <button className="text-btn" onClick={() => runtime.game?.cancelIncense()}>
          {t('incense.cancel')}
        </button>
      )}
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  return (
    <div className="toast-wrap" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export function NetBanner() {
  const t = useT();
  const net = useStore((s) => s.net);
  if (net === 'online' || net === 'idle') return null;
  const text = net === 'full' ? t('net.full') : net === 'connecting' ? t('net.connecting') : t('net.reconnecting');
  return (
    <div className="net-banner" role="alert">
      {text}
      {net === 'full' && <button onClick={() => store.set({ panel: 'servers' })}>{t('top.chooseServer')}</button>}
    </div>
  );
}
