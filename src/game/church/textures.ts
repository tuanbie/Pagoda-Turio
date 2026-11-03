import * as THREE from 'three';

/**
 * Canvas textures for the church — a cool, stone-and-glass palette that reads very differently
 * from the temple's warm lacquer, timber and glazed tiles. Ultra replaces the stone ones with
 * photo-scanned CC0 textures (see realism.ts); the stained glass always comes from here.
 */
function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true, h = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function rnd(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const GLASS = ['#1d3f8f', '#2456b8', '#8c1d2b', '#b8322e', '#d9a52b', '#2f7d4a', '#6a2c8a', '#e6c76a', '#1b6f8a'];

/** Pointed arch outline in a w×h box (springing at 55% height). */
function archPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const spring = y + h * 0.42;
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, spring);
  g.quadraticCurveTo(x, y + h * 0.08, x + w / 2, y);
  g.quadraticCurveTo(x + w, y + h * 0.08, x + w, spring);
  g.lineTo(x + w, y + h);
  g.closePath();
}

export const churchTextures = {
  /** ashlar limestone blocks with mortar lines and subtle per-block tone */
  limestone: () =>
    canvas(512, (g, s) => {
      const r = rnd(11);
      g.fillStyle = '#b9b3a6';
      g.fillRect(0, 0, s, s);
      const rows = 8;
      const bh = s / rows;
      for (let row = 0; row < rows; row++) {
        const off = row % 2 ? bh * 0.9 : 0;
        for (let x = -off; x < s; x += bh * 1.8) {
          const v = 168 + r() * 34;
          g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
          g.fillRect(x + 2, row * bh + 2, bh * 1.8 - 4, bh - 4);
          for (let i = 0; i < 40; i++) {
            const a = r() * 0.08;
            g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '60,55,45'},${a})`;
            g.fillRect(x + r() * bh * 1.8, row * bh + r() * bh, 2 + r() * 6, 1 + r() * 3);
          }
        }
      }
    }),
  /** black-and-white marble chequer with veining */
  marble: () =>
    canvas(512, (g, s) => {
      const r = rnd(5);
      const n = 4;
      const t = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const dark = (i + j) % 2 === 1;
          g.fillStyle = dark ? '#3a3d42' : '#e9e6df';
          g.fillRect(i * t, j * t, t, t);
          g.strokeStyle = dark ? 'rgba(200,200,210,0.18)' : 'rgba(120,115,110,0.22)';
          for (let k = 0; k < 5; k++) {
            g.lineWidth = 0.6 + r() * 1.4;
            g.beginPath();
            let x = i * t + r() * t;
            let y = j * t;
            g.moveTo(x, y);
            for (let q = 0; q < 6; q++) {
              x += (r() - 0.5) * t * 0.4;
              y += t / 6;
              g.lineTo(x, y);
            }
            g.stroke();
          }
          g.strokeStyle = 'rgba(0,0,0,0.25)';
          g.lineWidth = 1.5;
          g.strokeRect(i * t, j * t, t, t);
        }
    }),
  /** dark blue-grey slate shingles */
  slate: () =>
    canvas(256, (g, s) => {
      const r = rnd(3);
      g.fillStyle = '#3d434d';
      g.fillRect(0, 0, s, s);
      const rows = 10;
      const h = s / rows;
      for (let row = 0; row < rows; row++)
        for (let x = row % 2 ? -h * 0.6 : 0; x < s; x += h * 1.2) {
          const v = 52 + r() * 22;
          g.fillStyle = `rgb(${v},${v + 6},${v + 16})`;
          g.beginPath();
          g.moveTo(x + 1, row * h);
          g.lineTo(x + h * 1.2 - 1, row * h);
          g.lineTo(x + h * 1.2 - 1, row * h + h * 0.82);
          g.quadraticCurveTo(x + h * 0.6, row * h + h * 1.02, x + 1, row * h + h * 0.82);
          g.fill();
        }
    }),
  /** varnished oak for pews and doors */
  oak: () =>
    canvas(256, (g, s) => {
      const r = rnd(9);
      g.fillStyle = '#6b4526';
      g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 2) {
        g.fillStyle = `rgba(${r() > 0.5 ? '40,22,10' : '150,100,60'},${0.08 + r() * 0.12})`;
        g.fillRect(0, y + Math.sin(y * 0.05) * 2, s, 1 + r() * 2);
      }
    }),
  /** pale gravel for paths */
  gravel: () =>
    canvas(256, (g, s) => {
      const r = rnd(21);
      g.fillStyle = '#b7ad9b';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        const v = 120 + r() * 110;
        g.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
        g.beginPath();
        g.arc(r() * s, r() * s, 0.6 + r() * 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }),
  /**
   * A lancet window: stone surround (opaque) + a pointed arch of leaded stained glass.
   * Used on emissive planes so the glass glows from inside at night and reads as lit glass by day.
   */
  lancet: (seed: number) =>
    canvas(
      128,
      (g) => {
        const W = 128;
        const H = 384;
        const r = rnd(seed);
        g.fillStyle = '#8e887c';
        g.fillRect(0, 0, W, H);
        archPath(g, 14, 10, W - 28, H - 20);
        g.save();
        g.clip();
        // leaded glass: a grid of small panes in a palette, a medallion in the middle
        const cell = 16;
        for (let y = 0; y < H; y += cell)
          for (let x = 0; x < W; x += cell) {
            g.fillStyle = GLASS[Math.floor(r() * GLASS.length)];
            g.fillRect(x, y, cell, cell);
          }
        for (const cy of [H * 0.32, H * 0.62]) {
          g.fillStyle = GLASS[Math.floor(r() * GLASS.length)];
          g.beginPath();
          g.arc(W / 2, cy, 34, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = '#e6c76a';
          g.lineWidth = 4;
          g.stroke();
          // a simple star / flower motif (no figures)
          g.fillStyle = '#f3e3a8';
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            g.beginPath();
            g.ellipse(W / 2 + Math.cos(a) * 16, cy + Math.sin(a) * 16, 9, 4, a, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.strokeStyle = 'rgba(20,20,22,0.85)';
        g.lineWidth = 2;
        for (let y = 0; y < H; y += cell) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(W, y);
          g.stroke();
        }
        for (let x = 0; x < W; x += cell) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, H);
          g.stroke();
        }
        g.restore();
        g.strokeStyle = '#6f695e';
        g.lineWidth = 8;
        archPath(g, 14, 10, W - 28, H - 20);
        g.stroke();
        // central mullion
        g.fillStyle = '#7d776b';
        g.fillRect(W / 2 - 3, H * 0.3, 6, H * 0.7);
      },
      false,
      384,
    ),
  /** rose window: radial tracery of petals around a centre */
  rose: () =>
    canvas(
      512,
      (g, s) => {
        const c = s / 2;
        const r = rnd(42);
        g.fillStyle = '#8e887c';
        g.fillRect(0, 0, s, s);
        g.save();
        g.beginPath();
        g.arc(c, c, c - 10, 0, Math.PI * 2);
        g.clip();
        for (let ring = 6; ring > 0; ring--) {
          const rr = ((c - 10) * ring) / 6;
          const n = ring * 6;
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * Math.PI * 2;
            const a1 = ((k + 1) / n) * Math.PI * 2;
            g.fillStyle = GLASS[Math.floor(r() * GLASS.length)];
            g.beginPath();
            g.moveTo(c, c);
            g.arc(c, c, rr, a0, a1);
            g.closePath();
            g.fill();
          }
        }
        g.strokeStyle = '#6f695e';
        g.lineWidth = 7;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          g.beginPath();
          g.moveTo(c, c);
          g.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
          g.stroke();
          // petal tracery
          g.beginPath();
          g.arc(c + Math.cos(a) * c * 0.62, c + Math.sin(a) * c * 0.62, c * 0.2, 0, Math.PI * 2);
          g.stroke();
        }
        for (const rr of [0.18, 0.42, 0.98]) {
          g.beginPath();
          g.arc(c, c, (c - 10) * rr, 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      },
      false,
    ),
  /** soft round glow for candle flames and lamp halos */
  glow: () =>
    canvas(
      64,
      (g, s) => {
        const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(255,240,200,1)');
        grd.addColorStop(0.25, 'rgba(255,190,90,0.55)');
        grd.addColorStop(1, 'rgba(255,150,50,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
      },
      false,
    ),
};
