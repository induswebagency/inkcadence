'use strict';
const { createCanvas, loadImage, Image } = require('canvas');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const PROJECT = path.join(__dirname, '..');

const sandbox = {
  console, Math, JSON, Array, Object, String, Number, Error,
  Uint8Array, Uint8ClampedArray, Uint32Array, Float32Array, Float64Array,
  Promise, Date, Image,
};
sandbox.window = sandbox;
sandbox.document = {
  createElement(t) { return t === 'canvas' ? createCanvas(1, 1) : {}; },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(PROJECT, 'js/glyphs.js'), 'utf8'), sandbox);

(async () => {
  const img = await loadImage(path.join(PROJECT, 'test/fixtures/samples/glyph_sheet.jpg'));
  const sheet = createCanvas(img.width, img.height);
  sheet.getContext('2d').drawImage(img, 0, 0);
  const CHARS = sandbox.Glyphs.CHARS;
  const COLS = 13;
  const rect = { x: 70, y: 160, w: sheet.width - 140, h: sheet.height - 160 - 80 };
  const cw = rect.w / COLS;
  const ch = rect.h / sandbox.Glyphs.ROWS;

  for (const want of ['G', 'M', 'Q', '8', '.', ',', '#', 'a', 'A']) {
    const idx = CHARS.indexOf(want);
    const r = Math.floor(idx / COLS);
    const c = idx % COLS;
    const cx = rect.x + c * cw;
    const cy = rect.y + r * ch;
    const sx = Math.round(cx);
    const sy = Math.round(cy);
    const sw = Math.round(cw);
    const sh = Math.round(ch);
    const data = sheet.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let dark = 0;
    const n = sw * sh;
    let minL = 255;
    let maxL = 0;
    for (let i = 0; i < data.length; i += 4) {
      const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (L < minL) minL = L;
      if (L > maxL) maxL = L;
      if (L < 180) dark++;
    }
    const g = sandbox.Glyphs.extractGlyphs(sheet, { x: cx, y: cy, w: cw, h: ch }, 1, 1, want);
    console.log({
      want, idx, r, c,
      minL: Math.round(minL),
      maxL: Math.round(maxL),
      contrast: Math.round(maxL - minL),
      darkRatio: +(dark / n).toFixed(4),
      got: g.glyphs.length,
      missing: g.missing,
    });
  }
})();
