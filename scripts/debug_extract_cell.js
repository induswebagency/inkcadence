'use strict';
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const PROJECT = path.join(__dirname, '..');

(async () => {
  const img = await loadImage(path.join(PROJECT, 'test/fixtures/samples/glyph_sheet.jpg'));
  const sheet = createCanvas(img.width, img.height);
  sheet.getContext('2d').drawImage(img, 0, 0);
  const COLS = 13, ROWS = 7;
  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-:;"\'()/&@#+*=';
  const rect = { x: 70, y: 160, w: sheet.width - 140, h: sheet.height - 160 - 80 };
  const cw = rect.w / COLS, ch = rect.h / ROWS;

  function probe(want) {
    const idx = CHARS.indexOf(want);
    const r = Math.floor(idx / COLS), c = idx % COLS;
    const cx = rect.x + c * cw, cy = rect.y + r * ch;
    const sx = Math.max(0, Math.round(cx)), sy = Math.max(0, Math.round(cy));
    const sw = Math.min(sheet.width - sx, Math.round(cw));
    const shh = Math.min(sheet.height - sy, Math.round(ch));
    const d = sheet.getContext('2d').getImageData(sx, sy, sw, shh).data;
    const n = sw * shh;
    const lum = new Float32Array(n);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const L = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      lum[p] = L;
      hist[L | 0]++;
    }
    let target = n * 0.92, acc = 0, paper = 230;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= target) { paper = i; break; } }
    target = n * 0.02; acc = 0; let inkLum = 40;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) { inkLum = i; break; } }
    let count = 0, minX = sw, minY = shh, maxX = -1, maxY = -1;
    for (let y = 0; y < shh; y++) {
      for (let x = 0; x < sw; x++) {
        const p = y * sw + x;
        if (x < 2 || y < 2 || x > sw - 3 || y > shh - 3 || (x < sw * 0.2 && y < shh * 0.18)) continue;
        let a = (paper - lum[p]) / (paper - inkLum);
        a = a <= 0.12 ? 0 : (a > 1 ? 255 : (a - 0.12) / 0.88 * 255);
        if (a < 12) a = 0;
        if (a > 0) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const gw = maxX >= 0 ? maxX - minX + 1 : 0;
    const gh = maxY >= 0 ? maxY - minY + 1 : 0;
    console.log({
      want, paper, inkLum, contrast: paper - inkLum,
      count, dens: +(count / n).toFixed(4), need: +(n * 0.006).toFixed(1),
      box: [minX, minY, maxX, maxY], gw, gh,
      failContrast: paper - inkLum < 70,
      failDens: count < n * 0.006 || maxX < 0,
      failSize: gw < 3 || gh < 3,
    });
  }

  ['G', 'M', 'Q', '8', '.', ',', '#', 'a', 'A'].forEach(probe);
})();
