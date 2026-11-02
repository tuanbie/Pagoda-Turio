import { useEffect, useRef, useState } from 'react';
import { store, toast, useStore } from '../store.ts';
import { audio } from '../audio/AudioEngine.ts';
import { t as tt } from '../i18n/index.ts';
import { Icon, closePanel, useT } from './common.tsx';

const AUTO_MS = 60_000 / 66;

export function MoktakOverlay() {
  const t = useT();
  const auto = useStore((s) => s.moktakAuto);
  const count = useStore((s) => s.moktakCount);
  const soundOn = useStore((s) => s.soundOn);
  const [hit, setHit] = useState(0);
  const warned = useRef(false);

  const strike = () => {
    if (soundOn) audio.moktak();
    else if (!warned.current) {
      warned.current = true;
      toast(tt('moktak.needSound'));
    }
    store.set({ moktakCount: store.get().moktakCount + 1 });
    setHit((h) => h + 1);
  };

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(strike, AUTO_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, soundOn]);

  useEffect(() => () => store.set({ moktakAuto: false }), []);

  return (
    <div className="moktak-card" role="dialog" aria-label={t('moktak.title')}>
      <header>
        <strong>{t('moktak.title')}</strong>
        <span className="muted">{t('moktak.count', { n: count })}</span>
        <button className="icon-btn" onClick={closePanel} aria-label={t('moktak.close')}>
          <Icon name="close" />
        </button>
      </header>
      <button className="moktak-hit" onClick={strike} aria-label={t('moktak.hit')}>
        <svg viewBox="0 0 200 130" className={hit % 2 ? 'a' : 'b'} key={hit}>
          <ellipse cx="100" cy="78" rx="78" ry="44" fill="#8a4b25" />
          <ellipse cx="100" cy="72" rx="74" ry="38" fill="#a85d2e" />
          <path d="M40 80c20 14 100 14 120 0" stroke="#3b1d0d" strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="150" cy="58" r="6" fill="#3b1d0d" />
          <g className="mallet">
            <rect x="120" y="-6" width="10" height="70" rx="5" fill="#6a3d1f" transform="rotate(35 125 30)" />
            <circle cx="104" cy="54" r="13" fill="#d8b98a" />
          </g>
        </svg>
        <span>{t('moktak.hit')}</span>
      </button>
      <button className={`toggle wide ${auto ? 'on' : ''}`} onClick={() => store.set({ moktakAuto: !auto })} aria-pressed={auto}>
        {auto ? t('moktak.pause') : t('moktak.auto')}
      </button>
    </div>
  );
}
