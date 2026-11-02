import { GOMOKU_N, boardArray, inCheck, type GameState } from '@sontu/shared';

/**
 * One renderer for every board, used both for the 3D table tops (CanvasTexture)
 * and for the interactive 2D board in the game panel.
 */
export interface DrawOpts {
  /** view from side 1 (black / second player) */
  flip?: boolean;
  selected?: number | null;
  targets?: number[];
}

interface Geo {
  cols: number;
  rows: number;
  /** intersections (xiangqi, gomoku) vs squares (chess) */
  points: boolean;
}
const GEO: Record<GameState['kind'], Geo> = {
  xiangqi: { cols: 9, rows: 10, points: true },
  chess: { cols: 8, rows: 8, points: false },
  gomoku: { cols: GOMOKU_N, rows: GOMOKU_N, points: true },
};

/** Board size in CSS pixels for a given width (xiangqi is a little taller than wide). */
export function boardHeight(kind: GameState['kind'], width: number) {
  const g = GEO[kind];
  const cell = width / (g.points ? g.cols : g.cols);
  return g.points ? cell * g.rows : width;
}

function layout(kind: GameState['kind'], w: number, h: number) {
  const g = GEO[kind];
  const cell = g.points ? Math.min(w / g.cols, h / g.rows) : Math.min(w / g.cols, h / g.rows);
  const ox = (w - cell * g.cols) / 2;
  const oy = (h - cell * g.rows) / 2;
  return { g, cell, ox, oy };
}

/** Pixel centre of square/intersection i. */
function center(kind: GameState['kind'], w: number, h: number, i: number, flip: boolean) {
  const { g, cell, ox, oy } = layout(kind, w, h);
  let x = i % g.cols;
  let y = Math.floor(i / g.cols);
  if (flip) {
    x = g.cols - 1 - x;
    y = g.rows - 1 - y;
  }
  return { px: ox + (x + 0.5) * cell, py: oy + (y + 0.5) * cell, cell };
}

/** Square/intersection under a pixel, or -1. */
export function hitTest(kind: GameState['kind'], w: number, h: number, px: number, py: number, flip = false) {
  const { g, cell, ox, oy } = layout(kind, w, h);
  let x = Math.floor((px - ox) / cell);
  let y = Math.floor((py - oy) / cell);
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return -1;
  if (flip) {
    x = g.cols - 1 - x;
    y = g.rows - 1 - y;
  }
  return y * g.cols + x;
}

const XQ_GLYPH: Record<string, string> = {
  K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵',
  k: '將', a: '士', e: '象', h: '馬', r: '車', c: '砲', p: '卒',
};
const CHESS_GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

export function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, g: GameState, opts: DrawOpts = {}) {
  const flip = !!opts.flip;
  const { g: geo, cell, ox, oy } = layout(g.kind, w, h);
  const board = boardArray(g);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  // wood background
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#e9c98f');
  grad.addColorStop(1, '#d9b072');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const P = (i: number) => center(g.kind, w, h, i, flip);
  if (g.kind === 'chess') {
    for (let i = 0; i < 64; i++) {
      const { px, py } = P(i);
      const light = (i % 8) % 2 === Math.floor(i / 8) % 2;
      ctx.fillStyle = light ? '#f1dcb4' : '#a9744a';
      ctx.fillRect(px - cell / 2, py - cell / 2, cell, cell);
    }
  } else {
    // grid through the intersections
    ctx.strokeStyle = 'rgba(70,40,15,0.85)';
    ctx.lineWidth = Math.max(1, cell * 0.04);
    const x0 = ox + cell / 2;
    const y0 = oy + cell / 2;
    const x1 = ox + cell * (geo.cols - 0.5);
    const y1 = oy + cell * (geo.rows - 0.5);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    for (let c = 1; c < geo.cols - 1; c++) {
      const x = x0 + c * cell;
      if (g.kind === 'xiangqi') {
        // vertical lines stop at the river
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + 4 * cell);
        ctx.moveTo(x, y0 + 5 * cell);
        ctx.lineTo(x, y1);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
    }
    for (let r = 1; r < geo.rows - 1; r++) {
      ctx.beginPath();
      ctx.moveTo(x0, y0 + r * cell);
      ctx.lineTo(x1, y0 + r * cell);
      ctx.stroke();
    }
    if (g.kind === 'xiangqi') {
      // palaces
      for (const top of [0, 7]) {
        ctx.beginPath();
        ctx.moveTo(x0 + 3 * cell, y0 + top * cell);
        ctx.lineTo(x0 + 5 * cell, y0 + (top + 2) * cell);
        ctx.moveTo(x0 + 5 * cell, y0 + top * cell);
        ctx.lineTo(x0 + 3 * cell, y0 + (top + 2) * cell);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(70,40,15,0.7)';
      ctx.font = `${cell * 0.5}px "Noto Serif TC", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ry = y0 + 4.5 * cell;
      ctx.fillText(flip ? '漢 界' : '楚 河', x0 + 2 * cell, ry);
      ctx.fillText(flip ? '楚 河' : '漢 界', x0 + 6 * cell, ry);
    } else {
      // gomoku star points
      ctx.fillStyle = 'rgba(70,40,15,0.9)';
      for (const sx of [3, 7, 11])
        for (const sy of [3, 7, 11]) {
          ctx.beginPath();
          ctx.arc(x0 + sx * cell, y0 + sy * cell, cell * 0.1, 0, Math.PI * 2);
          ctx.fill();
        }
    }
  }

  // last move + selection + legal targets
  const ring = (i: number, color: string, wd: number) => {
    const { px, py } = P(i);
    ctx.strokeStyle = color;
    ctx.lineWidth = wd;
    if (g.kind === 'chess') ctx.strokeRect(px - cell / 2 + wd / 2, py - cell / 2 + wd / 2, cell - wd, cell - wd);
    else {
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.47, 0, Math.PI * 2);
      ctx.stroke();
    }
  };
  if (g.last) for (const i of g.kind === 'gomoku' ? g.last : g.last.slice(0, 2)) ring(i, 'rgba(46,140,220,0.9)', Math.max(2, cell * 0.07));
  if (inCheck(g) && !g.result) {
    const king = board.findIndex((c) => c === (g.turn === 0 ? 'K' : 'k'));
    if (king >= 0) ring(king, 'rgba(220,40,40,0.95)', Math.max(3, cell * 0.1));
  }

  // pieces
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  board.forEach((c, i) => {
    if (!c) return;
    const { px, py } = P(i);
    if (g.kind === 'gomoku') {
      const black = c === 'x';
      const sg = ctx.createRadialGradient(px - cell * 0.12, py - cell * 0.12, cell * 0.05, px, py, cell * 0.45);
      sg.addColorStop(0, black ? '#555' : '#fff');
      sg.addColorStop(1, black ? '#0d0d0d' : '#cfcfcf');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.43, 0, Math.PI * 2);
      ctx.fill();
    } else if (g.kind === 'xiangqi') {
      const red = c === c.toUpperCase();
      ctx.fillStyle = '#f7e7c4';
      ctx.strokeStyle = red ? '#b3261e' : '#222';
      ctx.lineWidth = Math.max(1.5, cell * 0.06);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = red ? '#b3261e' : '#1b1b1b';
      ctx.font = `600 ${cell * 0.48}px "Noto Serif TC", serif`;
      ctx.fillText(XQ_GLYPH[c], px, py + cell * 0.02);
    } else {
      const white = c === c.toUpperCase();
      ctx.font = `${cell * 0.8}px "Segoe UI Symbol", "Noto Sans Symbols 2", serif`;
      ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.strokeStyle = white ? '#2a1a0e' : '#e9d7b8';
      ctx.fillStyle = white ? '#fffaf0' : '#1d1410';
      ctx.strokeText(CHESS_GLYPH[c.toLowerCase()], px, py + cell * 0.04);
      ctx.fillText(CHESS_GLYPH[c.toLowerCase()], px, py + cell * 0.04);
    }
  });

  if (opts.selected != null && opts.selected >= 0) ring(opts.selected, 'rgba(255,200,40,0.95)', Math.max(3, cell * 0.1));
  for (const tIdx of opts.targets ?? []) {
    const { px, py } = P(tIdx);
    ctx.fillStyle = board[tIdx] ? 'rgba(220,60,40,0.55)' : 'rgba(40,120,60,0.55)';
    ctx.beginPath();
    ctx.arc(px, py, cell * (board[tIdx] ? 0.46 : 0.16), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
