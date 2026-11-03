import { useEffect, useRef, useState } from 'react';
import { HALLS, MAX_CHAT_CHARS, PAVILIONS, SEAT_REQUEST_MS, SONGS, STUPA, WORLD, songDurationMs } from '@sontu/shared';
import { serverNow, store, toast, useStore } from '../store.ts';
import { visitorName } from '../i18n/index.ts';
import { runtime } from '../runtime.ts';
import { PATHS, MAP_EXTENT, gardenRect } from '../game/layout.ts';
import { BRIDGE } from '../game/terrain.ts';
import { Icon, Modal, closePanel, useT } from './common.tsx';

// ---------------------------------------------------------------- chat
export function ChatPanel() {
  const t = useT();
  const open = useStore((s) => s.chatOpen);
  const lines = useStore((s) => s.chat);
  const unread = useStore((s) => s.unread);
  const me = useStore((s) => s.selfId);
  const locale = useStore((s) => s.locale);
  const zone = useStore((s) => s.zone);
  const roomOnly = useStore((s) => s.chatRoom);
  const inTalk = zone === 'talk';
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) store.set({ unread: 0 });
  }, [open, lines.length]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lines.length, open]);
  // Enter anywhere focuses the chat box
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target as HTMLElement)?.tagName === 'INPUT' || store.get().panel) return;
      store.set({ chatOpen: true });
      setTimeout(() => input.current?.focus(), 0);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const send = () => {
    const m = text.trim();
    if (!m) return;
    runtime.net?.send({ t: 'chat', m, ch: inTalk && roomOnly ? 1 : 0 });
    setText('');
  };

  if (!open)
    return (
      <button className="chat-fab" onClick={() => store.set({ chatOpen: true })} aria-label={t('chat.open')}>
        <Icon name="chat" />
        <span>{t('chat.open')}</span>
        {unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
      </button>
    );
  return (
    <section className="chat" aria-label={t('chat.title')}>
      <header>
        <strong>{t('chat.title')}</strong>
        {inTalk && (
          <button className={`room-pill ${roomOnly ? 'on' : ''}`} onClick={() => store.set({ chatRoom: !roomOnly })} aria-pressed={roomOnly}>
            🗣 {t('chat.room')}
          </button>
        )}
        <button className="icon-btn sm" onClick={() => store.set({ chatOpen: false })} aria-label={t('chat.close')}>
          <Icon name="minus" size={16} />
        </button>
      </header>
      <div className="chat-lines" ref={list} aria-live="polite">
        <p className="chat-rules">{t('chat.rules')}</p>
        {lines.length === 0 && <p className="muted small">{t('chat.empty')}</p>}
        {lines.map((l) => (
          <p key={l.key} className={`${l.id === me ? 'mine' : ''} ${l.ch === 1 ? 'room' : ''}`}>
            {l.ch === 1 && <i className="tag">{t('chat.roomTag')}</i>}
            <b>{l.id === me ? t('visitors.you') : l.name || visitorName(locale, l.adj, l.noun)}</b>
            <span>{l.text}</span>
          </p>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={input}
          value={text}
          maxLength={MAX_CHAT_CHARS}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
          aria-label={t('chat.placeholder')}
        />
        <button type="submit" disabled={!text.trim()} aria-label={t('chat.send')}>
          <Icon name="send" size={18} />
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- seats
export function SeatDialogs() {
  const t = useT();
  const ask = useStore((s) => s.seatAsk);
  const incoming = useStore((s) => s.seatIncoming);
  useStore((s) => s.visitors); // re-render when names change
  const [, tick] = useState(0);
  useEffect(() => {
    if (!incoming) return;
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [incoming]);
  const g = runtime.game;
  return (
    <>
      {ask && g && (
        <div className="seat-card" role="dialog">
          <p>{t('seat.ask', { name: g.nameOf(ask.owner) })}</p>
          <div className="row">
            <button className="text-btn" onClick={() => store.set({ seatAsk: null })}>
              {t('seat.cancel')}
            </button>
            <button className="primary sm" onClick={() => g.askForSeat(ask.i)}>
              {t('seat.askBtn')}
            </button>
          </div>
        </div>
      )}
      {incoming && g && (
        <div className="seat-card incoming" role="alertdialog">
          <p>
            <Icon name="bow" size={18} /> {t('seat.incoming', { name: g.nameOf(incoming.from) })}
          </p>
          <div className="bar">
            <i style={{ width: `${Math.max(0, 100 - ((Date.now() - incoming.at) / SEAT_REQUEST_MS) * 100)}%` }} />
          </div>
          <div className="row">
            <button className="text-btn" onClick={() => g.answerSeat(false)}>
              {t('seat.keep')}
            </button>
            <button className="primary sm" onClick={() => g.answerSeat(true)}>
              {t('seat.give')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- DJ
export function DjPanel() {
  const t = useT();
  const dj = useStore((s) => s.dj);
  const me = useStore((s) => s.selfId);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!dj) return null;
  const mine = dj.q.some(([, by]) => by === me);
  const left = Math.max(0, dj.at + songDurationMs(dj.s) - serverNow());
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const g = runtime.game;
  return (
    <Modal title={t('dj.title')} onClose={closePanel} closeLabel={t('donate.close')}>
      <div className="now-playing">
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div>
          <small>{t('dj.now')}</small>
          <strong>{t(`song.${dj.s}` as 'song.0')}</strong>
          <small>
            {SONGS[dj.s].bpm} BPM · −{mmss(left)}
          </small>
        </div>
      </div>
      <h3>{t('dj.queue')}</h3>
      {dj.q.length === 0 ? (
        <p className="muted small">{t('dj.empty')}</p>
      ) : (
        <ol className="queue">
          {dj.q.map(([s, by], i) => (
            <li key={i}>
              {t(`song.${s}` as 'song.0')} <small className="muted">· {t('dj.by', { name: g?.nameOf(by) ?? '…' })}</small>
            </li>
          ))}
        </ol>
      )}
      <h3>{t('dj.open')}</h3>
      <ul className="song-list">
        {SONGS.map((s, i) => (
          <li key={i}>
            <span>
              <strong>{t(`song.${i}` as 'song.0')}</strong>
              <small className="muted">
                {s.style} · {s.bpm} BPM · {mmss(songDurationMs(i))}
              </small>
            </span>
            <button
              className="toggle"
              disabled={mine}
              onClick={() => {
                runtime.net?.send({ t: 'dj', s: i });
                toast(t('dj.queued'));
              }}
            >
              {t('dj.request')}
            </button>
          </li>
        ))}
      </ul>
      {mine && <p className="muted small">{t('dj.limit')}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- minimap
const MAP_PX = 176;

/** Pre-rendered layout (drawn once), dots for people redrawn ~8×/s. */
function drawBase(size: number) {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = size * dpr;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const k = size / (MAP_EXTENT * 2);
  const P = (x: number) => (x + MAP_EXTENT) * k;
  g.fillStyle = '#5c6b45';
  g.beginPath();
  g.arc(P(0), P(0), (WORLD.radius + 1.5) * k, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#e8dfc8';
  g.lineWidth = 1.5;
  g.stroke();
  // paths
  g.strokeStyle = '#cfc5ad';
  g.lineCap = 'round';
  for (const [x1, z1, x2, z2, w] of PATHS) {
    g.lineWidth = Math.max(1.5, w * k);
    g.beginPath();
    g.moveTo(P(x1), P(z1));
    g.lineTo(P(x2), P(z2));
    g.stroke();
  }
  g.fillStyle = '#cfc5ad';
  g.beginPath();
  g.arc(P(WORLD.courtyard.x), P(WORLD.courtyard.z), WORLD.courtyard.r * k, 0, Math.PI * 2);
  g.fill();
  // halls
  for (const h of HALLS) {
    g.fillStyle = '#8c2a1c';
    g.fillRect(P(h.x - h.w / 2), P(h.z - h.d / 2), h.w * k, h.d * k);
    g.fillStyle = '#39443f';
    g.fillRect(P(h.x - h.w / 2) + 1, P(h.z - h.d / 2) + 1, h.w * k - 2, h.d * k * 0.45);
  }
  const gr = gardenRect();
  g.fillStyle = '#e59ab5';
  g.fillRect(P(gr.x0), P(gr.z0), (gr.x1 - gr.x0) * k, (gr.z1 - gr.z0) * k);
  const circle = (p: { x: number; z: number }, r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(P(p.x), P(p.z), r * k, 0, Math.PI * 2);
    g.fill();
  };
  circle(WORLD.pond, WORLD.pond.r, '#4d7f86');
  circle(WORLD.moonYard, WORLD.moonYard.r, '#59607a');
  circle(STUPA, STUPA.lowerR, '#efe6d4');
  circle(STUPA, STUPA.upperR, '#cfa968');
  g.fillStyle = '#b9b09c';
  g.fillRect(P(STUPA.x - STUPA.stairW / 2), P(STUPA.z - STUPA.lowerR - STUPA.stairLen), STUPA.stairW * k, STUPA.stairLen * k);
  // bridge across the pond
  g.fillStyle = '#a07a52';
  g.fillRect(P(BRIDGE.x0), P(BRIDGE.z - BRIDGE.w / 2), (BRIDGE.x1 - BRIDGE.x0) * k, Math.max(2, BRIDGE.w * k));
  // pavilions: tea (green), talk (blue), games (gold)
  const pavColor = { tea: '#5f8f5a', talk: '#5a76a8', games: '#c9a35a' } as const;
  for (const p of PAVILIONS) {
    g.fillStyle = pavColor[p.id];
    g.fillRect(P(p.x - p.w / 2), P(p.z - p.d / 2), p.w * k, p.d * k);
  }
  // road to the shuttle stop
  g.fillStyle = '#55554f';
  g.fillRect(P(-3.2), P(WORLD.gate.z + 2), 6.4 * k, (MAP_EXTENT - WORLD.gate.z) * k);
  circle(WORLD.bodhi, 6, '#3f6a37');
  circle(WORLD.censer, 1.6, '#d4a548');
  for (const tw of [WORLD.bellTower, WORLD.drumTower]) {
    g.fillStyle = '#8c2a1c';
    g.fillRect(P(tw.x - 2.6), P(tw.z - 2.6), 5.2 * k, 5.2 * k);
  }
  g.fillStyle = '#8c2a1c';
  g.fillRect(P(WORLD.gate.x - 6), P(WORLD.gate.z - 0.8), 12 * k, 1.6 * k + 1);
  // compass
  g.fillStyle = '#f5f1e6';
  g.font = '600 10px "Be Vietnam Pro", sans-serif';
  g.textAlign = 'center';
  g.fillText('N', size / 2, 10);
  return c;
}

export function Minimap() {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [big, setBig] = useState(false);
  const size = big ? Math.min(340, innerWidth - 32) : innerWidth < 650 ? 124 : MAP_PX;

  useEffect(() => {
    const el = canvas.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = el.height = size * dpr;
    const g = el.getContext('2d')!;
    const base = drawBase(size);
    const k = size / (MAP_EXTENT * 2);
    const P = (x: number) => (x + MAP_EXTENT) * k;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 120) return;
      last = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      g.drawImage(base, 0, 0, size, size);
      const dots = runtime.game?.mapSnapshot() ?? [];
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (const d of dots) {
        if (d.self) continue;
        g.beginPath();
        g.arc(P(d.x), P(d.z), 2, 0, Math.PI * 2);
        g.fill();
      }
      const me = dots.find((d) => d.self);
      if (me) {
        // gold arrow pointing where I face
        g.save();
        g.translate(P(me.x), P(me.z));
        g.rotate(-(me.r ?? 0) + Math.PI);
        g.fillStyle = '#ffd27a';
        g.strokeStyle = '#2a2418';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(0, -7);
        g.lineTo(5, 5);
        g.lineTo(0, 2.5);
        g.lineTo(-5, 5);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <div className={`minimap ${big ? 'big' : ''}`}>
      <canvas
        ref={canvas}
        style={{ width: size, height: size }}
        aria-label={t('map.title')}
        onClick={(e) => {
          // click on the map = walk there
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * MAP_EXTENT * 2 - MAP_EXTENT;
          const z = ((e.clientY - rect.top) / rect.height) * MAP_EXTENT * 2 - MAP_EXTENT;
          runtime.game?.walkTo(x, z);
        }}
      />
      <button className="map-toggle" onClick={() => setBig((b) => !b)} aria-label={t('map.title')}>
        <Icon name={big ? 'shrink' : 'expand'} size={14} />
      </button>
    </div>
  );
}
