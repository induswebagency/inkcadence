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
  for (const f of ['js/imaging.js', 'js/glyphs.js', 'js/render.js', 'js/charcnn.js', 'js/harvest.js', 'js/assignment.js']) {
    vm.runInContext(fs.readFileSync(path.join(PROJECT, f), 'utf8'), sandbox);
  }
  const weightsPath = path.join(PROJECT, 'assets', 'charcnn.json');
  if (fs.existsSync(weightsPath) && sandbox.CharCNN) {
    const raw = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
    sandbox.fetch = async function (url) {
      if (String(url).indexOf('charcnn') >= 0) {
        return { ok: true, json: async () => raw };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
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
  const auto = sb.Glyphs.extractGlyphs(sheet, detected, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  console.log('  info glyphs auto-detect', auto.glyphs.length, 'missing', auto.missing.join('') || '(none)',
    'score', detected.confidence);
  check('auto-detect extracts nearly all glyphs', auto.glyphs.length >= 76,
    String(auto.glyphs.length) + '/80 missing=' + auto.missing.join(''));

  const improvedDefaults = {
    x: sheet.width * 0.045,
    y: sheet.height * 0.085,
    w: sheet.width * 0.91,
    h: sheet.height * 0.86,
  };
  const defs2 = sb.Glyphs.extractGlyphs(sheet, improvedDefaults, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
  check('updated default grid is close to exact', defs2.glyphs.length >= exact.glyphs.length - 5,
    'exact=' + exact.glyphs.length + ' defaults=' + defs2.glyphs.length + ' oldDefaults=' + defs.glyphs.length);

  /* Photo-like rotated sheet stress case */
  const photoPath = path.join(FIX, 'glyph_sheet_photo.jpg');
  if (fs.existsSync(photoPath)) {
    const photo = await toCanvas(photoPath);
    const photoDetect = sb.Glyphs.detectSheetGrid(photo, sb.Glyphs.COLS, sb.Glyphs.ROWS);
    const photoGlyphs = sb.Glyphs.extractGlyphs(photo, photoDetect, sb.Glyphs.COLS, sb.Glyphs.ROWS, sb.Glyphs.CHARS);
    console.log('  info photo-sheet', photoGlyphs.glyphs.length, 'missing', photoGlyphs.missing.join('') || '(none)');
    check('photo sheet still extracts most glyphs', photoGlyphs.glyphs.length >= 70,
      String(photoGlyphs.glyphs.length) + '/80');
  }

  const page3Path = path.join(FIX, 'sample_page_3.jpg');
  if (fs.existsSync(page3Path)) {
    const page3 = await toCanvas(page3Path);
    const a3 = sb.Imaging.analyze(page3);
    check('page3 ink ratio sane', a3.inkRatio > 0.001 && a3.inkRatio < 0.2, String(a3.inkRatio));
    check('page3 finds blue-ish pen', a3.palette.some((p) => p.kind === 'pen'), JSON.stringify(a3.palette.slice(0, 2)));
  }

  /* Diverse synthetic assignment fixtures */
  const ASSIGN = path.join(FIX, 'assignments');
  const assignmentFiles = [
    'exam_lined_neat_blue.jpg',
    'exam_lined_messy_black.jpg',
    'essay_blank_neat_black.jpg',
    'essay_blank_messy_green.jpg',
    'lab_grid_neat_green.jpg',
    'lab_grid_messy_blue.jpg',
    'homework_lined_blue_highlight.jpg',
    'exam_lined_phone_skew_shadow.jpg',
    'essay_blank_phone_skew.jpg',
    'lab_grid_phone_shadow.jpg',
  ];
  if (fs.existsSync(ASSIGN)) {
    console.log('\n-- pipeline: assignment fixtures --');
    check('assignment fixture count', assignmentFiles.every((f) => fs.existsSync(path.join(ASSIGN, f))),
      assignmentFiles.filter((f) => !fs.existsSync(path.join(ASSIGN, f))).join(','));

    const harvestCounts = [];
    for (const name of assignmentFiles) {
      const c = await toCanvas(path.join(ASSIGN, name));
      const a = sb.Imaging.analyze(c);
      check(name + ' has ink', a.inkRatio > 0.0008 && a.inkRatio < 0.25, String(a.inkRatio));
      check(name + ' stroke sane', a.strokeWidth >= 1 && a.strokeWidth <= 30, String(a.strokeWidth));
      check(name + ' finds pen/marker', a.palette.some((p) => p.kind === 'pen' || p.kind === 'marker'),
        JSON.stringify(a.palette.slice(0, 3)));
      if (name.includes('phone')) {
        check(name + ' paper still light', /^#[0-9a-f]{6}$/i.test(a.paper));
      }
      if (sb.Harvest) {
        if (sb.CharCNN && !sb.CharCNN.isReady()) {
          try { await sb.CharCNN.load(['assets/charcnn.json']); } catch (_) { /* freq fallback */ }
        }
        const crops = sb.CharCNN && sb.CharCNN.isReady()
          ? await sb.Harvest.harvestFromPagesAsync([c], { maxCrops: 80, maxPerChar: 3 })
          : sb.Harvest.harvestFromPages([c], { maxCrops: 80, maxPerChar: 3, allowFreqFallback: true });
        harvestCounts.push(crops.length);
        check(name + ' harvests letter crops', crops.length >= 8, String(crops.length));
        check(name + ' harvest crops labeled', crops.every((g) => g.ch && g.url), 'labels');
      }
    }
    if (harvestCounts.length) {
      const minH = Math.min(...harvestCounts);
      const maxH = Math.max(...harvestCounts);
      console.log('  info harvest range', minH, '..', maxH);
      check('harvest yields crops across fixtures', minH >= 8 && maxH >= 15, 'min=' + minH + ' max=' + maxH);
    }

    /* Render using harvest-only pack from lined exam */
    const exam = await toCanvas(path.join(ASSIGN, 'exam_lined_neat_blue.jpg'));
    const examStats = sb.Imaging.analyze(exam);
    const examCrops = sb.CharCNN && sb.CharCNN.isReady()
      ? await sb.Harvest.harvestFromPagesAsync([exam], { maxCrops: 100, maxPerChar: 4 })
      : sb.Harvest.harvestFromPages([exam], { maxCrops: 100, maxPerChar: 4, allowFreqFallback: true });
    await sb.Glyphs.hydrate({ glyphs: examCrops });
    const harvestPack = {
      name: 'harvest-exam',
      glyphs: examCrops,
      cellH: (sb.Harvest.medianCellMetrics(examCrops) || {}).cellH || 92,
      cellW: (sb.Harvest.medianCellMetrics(examCrops) || {}).cellW || 70,
      slant: examStats.slant,
      strokeWidth: examStats.strokeWidth,
      lineGap: examStats.lineGap,
      paper: examStats.paper,
      paperStyle: examStats.paperStyle || 'ruled',
      patterns: examStats.patterns,
      penColours: (examStats.palette || []).filter((p) => p.kind === 'pen').map((p) => p.hex),
    };
    if (!harvestPack.penColours.length) harvestPack.penColours = ['#1c378c'];
    const harvestPages = sb.Rendering.renderPages({
      pack: harvestPack,
      text: '# Midterm\nHomeostasis keeps internal conditions stable.\nThe active site shape matches one substrate.',
      size: 34,
      seed: 11,
      penColour: harvestPack.penColours[0],
      paperColour: harvestPack.paper,
      paper: harvestPack.paperStyle || 'ruled',
      watermark: false,
    });
    check('harvest-only render pages', harvestPages.length >= 1, String(harvestPages.length));
    const hbuf = harvestPages[0].toBuffer('image/png');
    fs.writeFileSync(path.join(OUT, 'rendered_from_harvest.png'), hbuf);
    check('harvest render has bytes', hbuf.length > 15000, String(hbuf.length));

    if (sb.Assignment) {
      const scored = sb.Assignment.styleScore(examStats);
      check('assignment styleScore in range', scored.score >= 12 && scored.score <= 98, String(scored.score));
    }
  } else {
    console.log('  skip assignment fixtures (run npm run fixtures:assignments)');
  }

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
