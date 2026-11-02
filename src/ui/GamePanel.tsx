import { useEffect, useMemo, useRef, useState } from 'react';
import { inCheck, legalMoves, newGame, pieceAt, type GameState, type Move, type Side } from '@sontu/shared';
import { store, useStore } from '../store.ts';
import { runtime } from '../runtime.ts';
import { boardHeight, drawBoard, hitTest } from '../game/boardDraw.ts';
import { Modal, useT } from './common.tsx';
import type { Key } from '../i18n/index.ts';

const close = () => store.set({ panel: null, gameTable: null });

/** Interactive board for one game table: sit, play (server-validated), resign, rematch, watch. */
export function GamePanel() {
  const t = useT();
  const i = useStore((s) => s.gameTable);
  const snap = useStore((s) => (s.gameTable === null ? undefined : s.tables[s.gameTable]));
  const me = useStore((s) => s.selfId);
  useStore((s) => s.visitors); // re-render when names change
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // fit the board in the viewport both ways (xiangqi is 9 × 10, others square)
  const ratio = snap?.g.kind === 'xiangqi' ? 0.9 : 1;
  const width = Math.max(220, Math.min(460, window.innerWidth - 56, (window.innerHeight - 330) * ratio));

  const g = snap?.g;
  const mySide = snap ? (snap.p.indexOf(me) as -1 | Side) : -1;
  const flip = mySide === 1;
  const height = g ? boardHeight(g.kind, width) : width;
  const bothSeated = !!snap && snap.p[0] !== null && snap.p[1] !== null;
  const myTurn = !!g && !g.result && bothSeated && mySide === g.turn;

  // legal destinations from the selected piece
  const moves: Move[] = useMemo(() => (g && selected !== null && myTurn ? legalMoves(g, selected) : []), [g, selected, myTurn]);

  useEffect(() => setSelected(null), [g?.ply, g?.result]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = width * dpr;
    el.height = height * dpr;
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(ctx, width, height, g, { flip, selected, targets: moves.map((m) => m[1]) });
  }, [g, width, height, flip, selected, moves]);

  if (i === null || !snap || !g) return null;
  const name = (id: number | null) => (id === null ? '' : runtime.game?.nameOf(id) ?? '…');
  const sideName = (side: Side) => t(`game.side.${g.kind}.${side}` as Key);

  const onBoard = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!myTurn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = hitTest(g.kind, width, height, e.clientX - rect.left, e.clientY - rect.top, flip);
    if (idx < 0) return;
    if (g.kind === 'gomoku') {
      if (g.s[idx] === '.') runtime.game?.tableAction('move', i, [idx]);
      return;
    }
    if (selected !== null) {
      const mv = moves.find((m) => m[1] === idx);
      if (mv) {
        // promotions default to a queen (mv[2] = 0)
        runtime.game?.tableAction('move', i, mv.length === 3 ? [mv[0], mv[1], 0] : mv);
        setSelected(null);
        return;
      }
    }
    // select one of my own pieces (side 0 = uppercase in both xiangqi and chess)
    const own = (c: string) => (c >= 'A' && c <= 'Z' ? 0 : 1) === mySide;
    const piece = g.kind === 'chess' ? pieceAtChess(g.s, idx) : g.s[idx];
    setSelected(piece && piece !== '.' && own(piece) ? idx : null);
  };

  let status: string;
  if (g.result) status = g.result.w === null ? `${t('game.draw')} · ${t(`game.why.${g.result.why}` as Key)}` : `${t('game.win', { name: name(snap.p[g.result.w]) || sideName(g.result.w) })} · ${t(`game.why.${g.result.why}` as Key)}`;
  else if (!bothSeated) status = t('game.waiting');
  else status = myTurn ? t('game.yourTurn') : t('game.turn', { name: name(snap.p[g.turn]) });

  const seatRow = (side: Side) => {
    const id = snap.p[side];
    return (
      <div className={`player ${g.turn === side && !g.result ? 'turn' : ''}`}>
        <span className={`chip k-${g.kind} s-${side}`} />
        <div>
          <small>{sideName(side)}</small>
          <strong>{id === null ? t('game.empty') : id === me ? `${name(id)} (${t('visitors.you')})` : name(id)}</strong>
        </div>
        {id === null && mySide === -1 && (
          <button className="toggle" onClick={() => runtime.game?.joinTable(i, side)}>
            {t('game.sit')}
          </button>
        )}
      </div>
    );
  };

  return (
    <Modal title={`${t(`game.${g.kind}` as Key)} · #${(i % 3) + 1 + Math.floor(i / 3) * 3}`} onClose={close} closeLabel={t('game.close')} wide>
      <div className="players">
        {seatRow(flip ? 0 : 1)}
        {seatRow(flip ? 1 : 0)}
      </div>
      <p className={`game-status ${myTurn ? 'mine' : ''}`}>
        {status}
        {!g.result && g.kind !== 'gomoku' && bothSeated && runtime.game && isCheck(g) && <b> · {t('game.check')}</b>}
      </p>
      <canvas ref={canvas} className="board" style={{ width, height, cursor: myTurn ? 'pointer' : 'default' }} onClick={onBoard} aria-label={t(`game.${g.kind}` as Key)} />
      <p className="muted small center">{mySide === -1 ? t('game.watching') : myTurn && g.kind !== 'gomoku' ? t('game.hint') : ' '}</p>
      {mySide !== -1 && (
        <div className="game-actions">
          {!g.result && g.ply > 0 && (
            <button className="toggle" onClick={() => runtime.game?.tableAction('resign', i)}>
              {t('game.resign')}
            </button>
          )}
          {(g.result || g.ply === 0) && g.ply > 0 && (
            <button className="toggle on" onClick={() => runtime.game?.tableAction('reset', i)}>
              {t('game.newGame')}
            </button>
          )}
          <button className="toggle" onClick={() => runtime.game?.leaveTable()}>
            {t('game.leave')}
          </button>
        </div>
      )}
    </Modal>
  );
}

const isCheck = (g: GameState) => inCheck(g);
const pieceAtChess = (fen: string, i: number) => pieceAt({ ...newGame('chess'), s: fen }, i);
