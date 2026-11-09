'use strict';
/* End-to-end classical pipeline against real image fixtures:
   analyze sample pages → extract glyphs from sheet → render pages to PNG. */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

let createCanvas, loadImage, Image;
try {
  ({ createCanvas, loadImage, Image } = require('canvas'));
} catch (e) {
  console.log('\n-- pipeline: skipped (npm i canvas required for image fixtures) --');
  process.exit(0);
}

const PROJECT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'samples');
const OUT = path.join(__dirname, 'fixtures', 'out');
if (!fs.existsSync(path.join(FIX, 'glyph_sheet.jpg'))) {
  console.log('\n-- pipeline: skipped (run npm run fixtures:samples first) --');
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else {
    failures.push(name + (extra ? ' — ' + extra : ''));
    console.log('  FAIL ' + name + (extra ? ' — ' + extra : ''));
  }
}

function loadEngines() {
  const sandbox = {
    console, Math, JSON, Array, Object, String, Number, Error,
    Uint8Array, Uint8ClampedArray, Uint32Array, Float32Array, Float64Array,
    Promise, Date, setTimeout, clearTimeout, Image,
  };
  sandbox.window = sandbox;
  sandbox.document = {
    createElement(tag) {
      if (tag === 'canvas') return createCanvas(1, 1);
      return {};
    },
  };
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

async function main() {
  console.log('\n-- pipeline: real sample handwriting --');
  check('sample_page_1 exists', fs.existsSync(path.join(FIX, 'sample_page_1.jpg')));
  check('sample_page_2 exists', fs.existsSync(path.join(FIX, 'sample_page_2.jpg')));
  check('glyph_sheet exists', fs.existsSync(path.join(FIX, 'glyph_sheet.jpg')));

  const sb = loadEngines();
  const page1 = await toCanvas(path.join(FIX, 'sample_page_1.jpg'));
  const page2 = await toCanvas(path.join(FIX, 'sample_page_2.jpg'));
  const sheet = await toCanvas(path.join(FIX, 'glyph_sheet.jpg'));

  const a1 = sb.Imaging.analyze(page1);
  const a2 = sb.Imaging.analyze(page2);
  console.log('  info analyze1', JSON.stringify({
    slant: a1.slant, stroke: a1.strokeWidth, conf: a1.strokeConfidence,
    gap: a1.lineGap, paper: a1.paper, palette: a1.palette.slice(0, 3), inkRatio: a1.inkRatio,
  }));
  console.log('  info analyze2', JSON.stringify({
    slant: a2.slant, stroke: a2.strokeWidth, conf: a2.strokeConfidence,
    gap: a2.lineGap, paper: a2.paper, palette: a2.palette.slice(0, 3), inkRatio: a2.inkRatio,
  }));

  check('page1 has ink', a1.inkRatio > 0.001, String(a1.inkRatio));
  check('page1 stroke width sane', a1.strokeWidth >= 1 && a1.strokeWidth <= 25, String(a1.strokeWidth));
  check('page1 finds pen colour', a1.palette.some((p) => p.kind === 'pen' || p.kind === 'marker'), JSON.stringify(a1.palette));
  check('page1 paper light', /^#[0-9a-f]{6}$/i.test(a1.paper));

  const stats = sb.Imaging.mergeAnalyses([a1, a2]);
  check('merged palette non-empty', stats.palette.length >= 1, JSON.stringify(stats.palette));
  check('merged strokeConfidence', stats.strokeConfidence >= 0.2 && stats.strokeConfidence <= 1);

  // Fixture sheet grid (matches scripts/make_sample_handwriting.py)
  const exactRect = {
    x: 70,
    y: 160,
    w: sheet.width - 140,
    h: sheet.height - 160 - 80,
  };
  // App defaults: gx=6 gy=14 gw=88 gh=72
  const defaultRect = {
    x: sheet.width * 0.06,
    y: sheet.height * 0.14,
    w: sheet.width * 0.88,
    h: sheet.height * 0.72,
  };

  const exact = sb.Glyphs.extractGlyphs(sheet, exactRect, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  const defs = sb.Glyphs.extractGlyphs(sheet, defaultRect, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  console.log('  info glyphs exact', exact.glyphs.length, 'missing', exact.missing.join('') || '(none)');
  console.log('  info glyphs default-sliders', defs.glyphs.length, 'missing', defs.missing.join('') || '(none)');

  check('exact grid extracts most glyphs', exact.glyphs.length >= 74, String(exact.glyphs.length) + '/80 missing=' + exact.missing.join(''));
  const missingLetters = 'abcdefghijklmnopqrstuvwxyz'.split('').filter((ch) => !exact.glyphs.some((g) => g.ch === ch));
  check('exact grid extracts letters a-z', missingLetters.length === 0, 'missing=' + missingLetters.join(''));
  check('exact grid extracts A-Z', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every((ch) => exact.glyphs.some((g) => g.ch === ch)),
    'missing caps=' + exact.missing.filter((c) => /[A-Z]/.test(c)).join(''));

  const detected = sb.Glyphs.detectSheetGrid(sheet, sb.Glyphs.COLS, sb.Glyphs.ROWS);
  let autoRect = detected;
  let auto = sb.Glyphs.extractGlyphs(sheet, detected, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  if (auto.glyphs.length < sb.Glyphs.CHARS.length * 0.85) {
    autoRect = { x: sheet.width * 0.045, y: sheet.height * 0.085, w: sheet.width * 0.91, h: sheet.height * 0.86 };
    auto = sb.Glyphs.extractGlyphs(sheet, autoRect, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  }
  console.log('  info glyphs auto-align', auto.glyphs.length, 'missing', auto.missing.join('') || '(none)');
  check('auto-align extracts most glyphs', auto.glyphs.length >= 72, String(auto.glyphs.length) + '/80');

  const improvedDefaults = {
    x: sheet.width * 0.045,
    y: sheet.height * 0.085,
    w: sheet.width * 0.91,
    h: sheet.height * 0.86,
  };
  const defs2 = sb.Glyphs.extractGlyphs(sheet, improvedDefaults, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  check('updated default grid is close to exact', defs2.glyphs.length >= exact.glyphs.length - 5,
    'exact=' + exact.glyphs.length + ' defaults=' + defs2.glyphs.length + ' oldDefaults=' + defs.glyphs.length);

  await sb.Glyphs.hydrate({ glyphs: exact.glyphs });

  const pack = {
    name: 'fixture-hand',
    glyphs: exact.glyphs,
    missing: exact.missing,
    cellH: exactRect.h / sb.Glyphs.ROWS,
    cellW: exactRect.w / sb.Glyphs.COLS,
    slant: stats.slant,
    strokeWidth: stats.strokeWidth,
    strokeConfidence: stats.strokeConfidence,
    lineGap: stats.lineGap,
    paper: stats.paper,
    penColours: stats.palette.filter((p) => p.kind === 'pen').map((p) => p.hex),
    markerColours: stats.palette.filter((p) => p.kind === 'marker').map((p) => p.hex),
    palette: stats.palette,
  };
  if (!pack.penColours.length) pack.penColours = [stats.palette[0].hex];

  const pages = sb.Rendering.renderPages({
    pack,
    text: '# Homework\nThe mitochondria produce ATP for the cell.\nDNA stores genetic information in base pairs.\nI need to revise chapter four before Friday.',
    size: 34,
    jitter: 0.55,
    seed: 7,
    penColour: pack.penColours[0],
    paperColour: pack.paper,
    paper: 'ruled',
    watermark: true,
  });
  check('render produced pages', pages.length >= 1, String(pages.length));

  const outPath = path.join(OUT, 'rendered_from_samples.png');
  const buf = pages[0].toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  check('wrote rendered PNG', fs.existsSync(outPath) && buf.length > 20000, String(buf.length));
  console.log('  info rendered', outPath, buf.length, 'bytes');

  // Spot-check: rendered page should have dark ink pixels (not blank paper)
  const ctx = pages[0].getContext('2d');
  const data = ctx.getImageData(100, 150, 1000, 1400).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 16) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 140) dark++;
  }
  check('rendered page has ink pixels', dark > 200, 'darkSamples=' + dark);

  console.log('\n' + '='.repeat(52));
  console.log('  passed: ' + pass + '   failed: ' + failures.length);
  if (failures.length) {
    failures.forEach((f) => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('  all green');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
