import { useEffect, type ReactNode } from 'react';
import { translate, type Key } from '../i18n/index.ts';
import { store, useStore } from '../store.ts';

export function useT() {
  const locale = useStore((s) => s.locale);
  return (key: Key, params?: Record<string, string | number>) => translate(locale, key, params);
}

const paths: Record<string, string> = {
  temple: 'M2 11c5-1 8-4 10-7 2 3 5 6 10 7M4 12h16M7 13v7m10-7v7M4 20h16M10 15h4v5',
  soundOn: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5zM14.5 3.5v2a7 7 0 0 1 0 13v2a9 9 0 0 0 0-17z',
  soundOff: 'M4 9v6h4l5 4V5L8 9H4zm12 0 5 6m0-6-5 6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5m2.5 9c0-2.6-1.5-4.8-3.6-5.6',
  heart: 'M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z',
  leave: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  close: 'M6 6l12 12M18 6 6 18',
  bow: 'M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 20c0-3 2-5 4-6l2 2 2-2c2 1 4 3 4 6',
  beads: 'M12 3a3 3 0 1 0 0 .1M5.5 7a2.5 2.5 0 1 0 0 .1M18.5 7a2.5 2.5 0 1 0 0 .1M4 14a2.5 2.5 0 1 0 0 .1M20 14a2.5 2.5 0 1 0 0 .1M8 20a2.5 2.5 0 1 0 0 .1M16 20a2.5 2.5 0 1 0 0 .1',
  greet: 'M12 3v9m-3-6 3-3 3 3M8 10l4 8 4-8M7 21h10',
  dance: 'M9 18V6l10-2v12M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm10-2a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  moktak: 'M4 13c0-4 3.6-7 8-7s8 3 8 7-3.6 6-8 6-8-2-8-6zm4 0h8M16 3l3 3',
  incense: 'M12 21v-9m-3 9h6M12 9c-1-1.5 1-2.5 0-4m3 5c-1-1.5 1-2.5 0-4M9 10c-1-1.5 1-2.5 0-4',
  stand: 'M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 5v6m-3 6 3-6 3 6m-6-9h6',
  chat: 'M4 5h16v11H9l-5 4V5z',
  minus: 'M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7-7-1z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function Modal({ title, onClose, closeLabel, children, wide }: { title: string; onClose: () => void; closeLabel: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={closeLabel}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export const closePanel = () => store.set({ panel: null });
