import { useEffect, useRef, useState } from 'react';
import { store, toast, useStore } from '../store.ts';
import { audio } from '../audio/AudioEngine.ts';
import { t as tt } from '../i18n/index.ts';
import { Icon, closePanel, useT } from './common.tsx';

const ROUND = 108;
const SPACING = 74;
const VISIBLE = 6;

/**
 * A long wooden mala you flick through. Physics (drag → momentum → snap) runs in rAF and writes
 * transforms straight to the DOM, so React only re-renders when the count changes.
 */
export function BeadsOverlay() {
  const t = useT();
  const total = useStore((s) => s.beadsTotal);
  const soundOn = useStore((s) => s.soundOn);
  const [session, setSession] = useState(0);
  const strand = useRef<HTMLDivElement>(null);
  const beads = useRef<(HTMLDivElement | null)[]>([]);
  /** bead i is counted as bead number start + i of the lifetime total */
  const start = useRef(store.get().beadsTotal).current;
  const st = useRef({ offset: 0, vel: 0, drag: null as null | { y: number; t: number }, reached: 0, target: null as number | null });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = st.current;
      if (!s.drag) {
        if (s.target !== null) {
          s.offset += (s.target - s.offset) * Math.min(1, dt * 14);
          if (Math.abs(s.target - s.offset) < 0.002) {
            s.offset = s.target;
            s.target = null;
          }
        } else {
          s.offset += s.vel * dt;
          s.vel *= Math.exp(-dt * 3.5);
          if (Math.abs(s.vel) < 0.6) {
            const snap = Math.round(s.offset);
            s.offset += (snap - s.offset) * Math.min(1, dt * 10);
            s.vel = 0;
          }
        }
      }
      // count each bead the first time it passes the thumb
      const passed = Math.floor(s.offset + 0.5);
      if (passed > s.reached) {
        const n = passed - s.reached;
        s.reached = passed;
        if (soundOn) audio.bead();
        const before = store.get().beadsTotal;
        const after = before + n;
        store.set({ beadsTotal: after });
        setSession((x) => x + n);
        if (Math.floor(after / ROUND) > Math.floor(before / ROUND)) {
          if (soundOn) audio.bell();
          toast(tt('beads.complete', { n: Math.floor(after / ROUND) }));
        }
      }
      // layout
      const base = Math.floor(s.offset);
      for (let k = -VISIBLE; k <= VISIBLE; k++) {
        const el = beads.current[k + VISIBLE];
        if (!el) continue;
        const i = base + k;
        const y = (i - s.offset) * SPACING;
        const depth = Math.min(1, Math.abs(y) / (SPACING * VISIBLE));
        const scale = 1.25 - depth * 0.75;
        const x = Math.sin((i - s.offset) * 0.22) * 46;
        const guru = (((start + i) % ROUND) + ROUND) % ROUND === 0;
        el.style.transform = `translate(${x}px, ${-y}px) scale(${scale})`;
        el.style.opacity = String(1 - depth * 0.85);
        el.style.zIndex = String(100 - Math.round(depth * 50));
        el.classList.toggle('guru', guru);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = st.current;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === ' ') {
        s.target = Math.round(s.target ?? s.offset) + 1;
        e.preventDefault();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        s.target = Math.round(s.target ?? s.offset) - 1;
        e.preventDefault();
      } else if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const inRound = total % ROUND;
  const round = Math.floor(total / ROUND) + 1;
  return (
    <div className="beads-overlay" role="dialog" aria-label={t('beads.title')}>
      <header>
        <div>
          <h2>{t('beads.round', { n: round })}</h2>
          <p>{t('beads.count', { c: inRound, t: total })}</p>
        </div>
        <button className="icon-btn" onClick={closePanel} aria-label={t('beads.close')}>
          <Icon name="close" />
        </button>
      </header>
      <div
        className="strand"
        ref={strand}
        tabIndex={0}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          st.current.drag = { y: e.clientY, t: performance.now() };
          st.current.vel = 0;
          st.current.target = null;
        }}
        onPointerMove={(e) => {
          const s = st.current;
          if (!s.drag) return;
          const dy = s.drag.y - e.clientY;
          const now = performance.now();
          const dtt = Math.max(1, now - s.drag.t) / 1000;
          s.offset += dy / SPACING;
          s.vel = s.vel * 0.6 + (dy / SPACING / dtt) * 0.4;
          s.drag = { y: e.clientY, t: now };
        }}
        onPointerUp={() => (st.current.drag = null)}
        onPointerCancel={() => (st.current.drag = null)}
        onWheel={(e) => {
          st.current.target = null;
          st.current.vel += e.deltaY * 0.02;
        }}
      >
        <div className="cord" />
        {Array.from({ length: VISIBLE * 2 + 1 }, (_, k) => (
          <div key={k} className="bead" ref={(el) => (beads.current[k] = el)} />
        ))}
        <div className="thumb" />
      </div>
      <footer>
        <span>{t('beads.hint')}</span>
        {session > 0 && <strong>+{session}</strong>}
      </footer>
    </div>
  );
}
