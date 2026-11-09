'use strict';
/* Practice loop: analyze samples → auto-detect sheet → render a full page → save PNG. */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { createCanvas, loadImage, Image } = require('canvas');

const PROJECT = path.join(__dirname, '..');
const FIX = path.join(PROJECT, 'test/fixtures/samples');
const OUT = path.join(PROJECT, 'test/fixtures/out');
fs.mkdirSync(OUT, { recursive: true });

function loadEngines() {
  const sandbox = {
    console, Math, JSON, Array, Object, String, Number, Error,
    Uint8Array, Uint8ClampedArray, Uint32Array, Float32Array, Float64Array,
    Promise, Date, setTimeout, clearTimeout, Image,
  };
  sandbox.window = sandbox;
  sandbox.document = { createElement(tag) { return tag === 'canvas' ? createCanvas(1, 1) : {}; } };
  sandbox.URL = { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} };
  vm.createContext(sandbox);
  for (const f of ['js/imaging.js', 'js/glyphs.js', 'js/render.js']) {
    vm.runInContext(fs.readFileSync(path.join(PROJECT, f), 'utf8'), sandbox);
  }
  return sandbox;
}

async function toCanvas(file) {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

(async () => {
  const sb = loadEngines();
  const pages = [];
  for (const name of ['sample_page_1.jpg', 'sample_page_2.jpg', 'sample_page_3.jpg']) {
    pages.push(await toCanvas(path.join(FIX, name)));
  }
  const stats = sb.Imaging.mergeAnalyses(pages.map((p) => sb.Imaging.analyze(p)));
  const sheet = await toCanvas(path.join(FIX, 'glyph_sheet.jpg'));
  const rect = sb.Glyphs.detectSheetGrid(sheet);
  const extracted = sb.Glyphs.extractGlyphs(sheet, rect, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  await sb.Glyphs.hydrate({ glyphs: extracted.glyphs });

  if (extracted.glyphs.length < 76) {
    console.error('FAIL glyph coverage', extracted.glyphs.length, extracted.missing.join(''));
    process.exit(1);
  }

  const pack = {
    glyphs: extracted.glyphs,
    missing: extracted.missing,
    cellH: rect.h / sb.Glyphs.ROWS,
    cellW: rect.w / sb.Glyphs.COLS,
    lineGap: stats.lineGap,
    slant: stats.slant,
    paper: stats.paper,
    penColours: stats.palette.filter((p) => p.kind === 'pen').map((p) => p.hex),
  };
  if (!pack.penColours.length) pack.penColours = [stats.palette[0].hex];

  const text = [
    '# Practice page',
    'The mitochondria produce ATP for the cell.',
    'Photosynthesis converts light into chemical energy.',
    'DNA stores genetic information in base pairs.',
    'I can write homework, notes, and letters in my own hand.',
    'Numbers work too: 1234567890 — and punctuation!?',
  ].join('\n');

  const rendered = sb.Rendering.renderPages({
    pack,
    text,
    size: 34,
    jitter: 0.55,
    seed: 11,
    penColour: pack.penColours[0],
    paperColour: pack.paper,
    paper: 'ruled',
    watermark: true,
  });

  const outFile = path.join(OUT, 'practice_page.png');
  fs.writeFileSync(outFile, rendered[0].toBuffer('image/png'));
  console.log('OK glyphs', extracted.glyphs.length + '/80');
  console.log('OK pages', rendered.length);
  console.log('OK wrote', outFile, fs.statSync(outFile).size, 'bytes');
  console.log('OK pen', pack.penColours[0], 'paper', pack.paper, 'slant', stats.slant);
})().catch((e) => { console.error(e); process.exit(1); });
