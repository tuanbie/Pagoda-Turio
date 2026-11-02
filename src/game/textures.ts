import * as THREE from 'three';

/** Small procedural textures (no downloads). Generated once, shared everywhere. */

function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export const textures = {
  grass: () =>
    canvas(256, (g, s) => {
      const r = rng(1);
      g.fillStyle = '#6f7f4c';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 5000; i++) {
        const v = r();
        g.fillStyle = v < 0.33 ? '#7d8f55' : v < 0.66 ? '#627344' : '#8a9a5d';
        g.globalAlpha = 0.5;
        g.fillRect(r() * s, r() * s, 1 + r() * 2, 2 + r() * 3);
      }
      g.globalAlpha = 1;
    }),

  paving: () =>
    canvas(256, (g, s) => {
      const r = rng(2);
      const n = 4;
      const c = s / n;
      g.fillStyle = '#8e877a';
      g.fillRect(0, 0, s, s);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const l = 72 + r() * 12;
          g.fillStyle = `hsl(40, ${8 + r() * 6}%, ${l}%)`;
          const off = y % 2 ? c / 2 : 0;
          for (const dx of [0, -s]) g.fillRect(x * c + off + dx + 2, y * c + 2, c - 4, c - 4);
          for (let k = 0; k < 40; k++) {
            g.fillStyle = `rgba(80,70,55,${r() * 0.12})`;
            g.fillRect(x * c + r() * c, y * c + r() * c, 2, 2);
          }
        }
    }),

  wood: () =>
    canvas(256, (g, s) => {
      const r = rng(3);
      const planks = 8;
      for (let i = 0; i < planks; i++) {
        g.fillStyle = `hsl(28, ${38 + r() * 8}%, ${30 + r() * 8}%)`;
        g.fillRect(0, (i * s) / planks, s, s / planks);
        g.strokeStyle = 'rgba(20,10,5,0.4)';
        g.strokeRect(0, (i * s) / planks, s, s / planks);
        for (let k = 0; k < 12; k++) {
          g.strokeStyle = `rgba(30,15,5,${0.05 + r() * 0.08})`;
          g.beginPath();
          const y = (i * s) / planks + r() * (s / planks);
          g.moveTo(0, y);
          g.bezierCurveTo(s / 3, y + r() * 4 - 2, (2 * s) / 3, y + r() * 4 - 2, s, y);
          g.stroke();
        }
      }
    }),

  roof: () =>
    canvas(256, (g, s) => {
      g.fillStyle = '#2f3633';
      g.fillRect(0, 0, s, s);
      const cols = 16;
      for (let i = 0; i < cols; i++) {
        const x = (i * s) / cols;
        const grad = g.createLinearGradient(x, 0, x + s / cols, 0);
        grad.addColorStop(0, '#26302d');
        grad.addColorStop(0.5, '#4b5651');
        grad.addColorStop(1, '#232b28');
        g.fillStyle = grad;
        g.fillRect(x, 0, s / cols, s);
      }
      for (let y = 0; y < s; y += s / 8) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(0, y, s, 2);
      }
    }),

  plaster: () =>
    canvas(128, (g, s) => {
      const r = rng(4);
      g.fillStyle = '#ece3cf';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 800; i++) {
        g.fillStyle = `rgba(120,100,70,${r() * 0.05})`;
        g.fillRect(r() * s, r() * s, 2, 2);
      }
    }),

  lattice: () =>
    canvas(128, (g, s) => {
      g.fillStyle = '#efe2c4';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#7a2b1e';
      g.lineWidth = 5;
      for (let i = 0; i <= 8; i++) {
        g.beginPath();
        g.moveTo((i * s) / 8, 0);
        g.lineTo((i * s) / 8, s);
        g.moveTo(0, (i * s) / 8);
        g.lineTo(s, (i * s) / 8);
        g.stroke();
      }
      g.lineWidth = 10;
      g.strokeRect(0, 0, s, s);
    }),

  bark: () =>
    canvas(64, (g, s) => {
      const r = rng(5);
      g.fillStyle = '#5a4130';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(30,20,10,${0.2 + r() * 0.3})`;
        g.fillRect(r() * s, 0, 1 + r() * 2, s);
      }
    }),

  softDot: () =>
    canvas(
      64,
      (g) => {
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
      },
      false,
    ),

  sign(text: string, fg = '#e2c27a', bg = '#2a2420', w = 512, h = 160, font = 'bold 104px "Noto Serif TC", serif') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 8;
    g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = fg;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },
};
