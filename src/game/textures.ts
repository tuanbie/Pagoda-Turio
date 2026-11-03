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

/** Finer door lattice for high / ultra: diamond grid with a carved flower roundel. */
function latticeCarved() {
  return canvas(256, (g, s) => {
    g.fillStyle = '#efe2c4';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#6e2619';
    g.lineWidth = 5;
    for (let i = -8; i <= 16; i++) {
      g.beginPath();
      g.moveTo((i * s) / 8, 0);
      g.lineTo((i * s) / 8 + s, s);
      g.moveTo((i * s) / 8, 0);
      g.lineTo((i * s) / 8 - s, s);
      g.stroke();
    }
    // carved roundel in the middle
    g.fillStyle = '#7a2b1e';
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c99a4a';
    for (let k = 0; k < 8; k++) {
      g.save();
      g.translate(s / 2, s / 2);
      g.rotate((k / 8) * Math.PI * 2);
      g.beginPath();
      g.ellipse(0, -s * 0.1, s * 0.035, s * 0.08, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.04, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#4a170f';
    g.lineWidth = 14;
    g.strokeRect(0, 0, s, s);
  });
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

  lattice: (carved = false) =>
    carved ? latticeCarved() : canvas(128, (g, s) => {
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

  /** Vertical couplet panel: Hán characters top-to-bottom, gold on dark lacquer. */
  couplet(han: string, bg = '#4a1410') {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 640;
    const g = c.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, 128, 640);
    g.strokeStyle = '#d9b46a';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 112, 624);
    g.lineWidth = 2;
    g.strokeRect(16, 16, 96, 608);
    // light paper gets dark ink, dark lacquer gets gold
    const light = parseInt(bg.slice(1, 3), 16) > 140;
    g.fillStyle = light ? '#2a1c12' : '#e8c77e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = Array.from(han.replace(/\s/g, ''));
    g.font = '600 84px "Noto Serif TC", serif';
    const step = 560 / chars.length;
    chars.forEach((ch, i) => g.fillText(ch, 64, 40 + step * (i + 0.5)));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  },

  /** Tileable ripple normal map for water (procedural sum of waves). */
  waterNormal: () => {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    const r = rng(9);
    const waves = Array.from({ length: 7 }, () => ({ kx: Math.round((r() - 0.5) * 8), ky: Math.round((r() - 0.5) * 8) || 1, ph: r() * 6.28, a: 0.4 + r() * 0.6 }));
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let dx = 0;
        let dy = 0;
        for (const w of waves) {
          const c2 = Math.cos(((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.ph) * w.a;
          dx += c2 * w.kx * 0.05;
          dy += c2 * w.ky * 0.05;
        }
        const n = Math.hypot(dx, dy, 1);
        const i = (y * S + x) * 4;
        img.data[i] = ((-dx / n) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((-dy / n) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / n) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  /** Plain cloth banner (phướn) with a lotus motif — tinted per instance, no text. */
  banner: () =>
    canvas(
      128,
      (g) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(0, 0, 128, 10);
        g.fillRect(0, 118, 128, 10);
        g.fillRect(0, 0, 8, 128);
        g.fillRect(120, 0, 8, 128);
        // stylised lotus
        g.fillStyle = 'rgba(120,60,0,0.45)';
        for (let i = -2; i <= 2; i++) {
          g.save();
          g.translate(64, 84);
          g.rotate(i * 0.38);
          g.beginPath();
          g.ellipse(0, -20, 8, 22, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
        g.fillRect(40, 86, 48, 5);
      },
      false,
    ),

  /** Soft vertical light shaft (god-ray card): bright core, faded edges and ends. */
  shaft: () =>
    canvas(
      64,
      (g) => {
        const img = g.createImageData(64, 64);
        for (let y = 0; y < 64; y++)
          for (let x = 0; x < 64; x++) {
            const u = x / 63;
            const v = y / 63;
            const a = Math.sin(Math.PI * u) ** 2 * Math.sin(Math.PI * Math.min(1, v * 1.4)) ** 1.5 * (1 - v * 0.5);
            const i = (y * 64 + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
            img.data[i + 3] = a * 255;
          }
        g.putImageData(img, 0, 0);
      },
      false,
    ),

  /** Two-line board: Vietnamese name on top, Hán characters below. */
  signBilingual(vi: string, han: string, w = 768, h = 260) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2a2420';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e2c27a';
    g.lineWidth = 10;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.lineWidth = 3;
    g.strokeRect(28, 28, w - 56, h - 56);
    g.fillStyle = '#e8c77e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 104;
    do g.font = `700 ${size}px "Be Vietnam Pro", serif`;
    while (g.measureText(vi).width > w - 90 && (size -= 4) > 30);
    g.fillText(vi, w / 2, h * 0.42);
    g.font = '600 52px "Noto Serif TC", serif';
    g.fillStyle = '#cfa968';
    g.fillText(han, w / 2, h * 0.76);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  },

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
