'use strict';
/* Analyze diverse synthetic assignment fixtures (lined/blank/grid, neat/messy, phone). */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

let createCanvas, loadImage, Image;
try {
  ({ createCanvas, loadImage, Image } = require('canvas'));
} catch (e) {
  console.log('-- assignments: skipped (canvas not installed) --');
  process.exit(0);
}

const FIX = path.join(__dirname, 'fixtures', 'samples', 'assignments');
if (!fs.existsSync(FIX)) {
  console.log('-- assignments: skipped (run python scripts/make_assignment_fixtures.py) --');
  process.exit(0);
}

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
  for (const name of ['imaging', 'glyphs', 'harvest', 'render', 'presets', 'assignment']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8');
    vm.runInContext(code, sandbox, { filename: name + '.js' });
  }
  return sandbox;
}

async function toCanvas(p) {
  const img = await loadImage(p);
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

async function main() {
  console.log('\n-- assignments: diverse written pages --');
  const files = fs.readdirSync(FIX).filter((f) => /\.jpe?g$/i.test(f)).sort();
  check('fixture set present', files.length >= 6, String(files.length));

  const sb = loadEngines();
  const analyses = [];
  for (const f of files) {
    const c = await toCanvas(path.join(FIX, f));
    const a = sb.Imaging.analyze(c);
    analyses.push({ f, a });
    check(f + ' has ink', a.inkRatio > 0.001 && a.inkRatio < 0.25, 'ink=' + a.inkRatio);
    check(f + ' finds pen', (a.palette || []).some((p) => p.kind === 'pen'), JSON.stringify((a.palette || []).slice(0, 2)));
    check(f + ' patterns', !!(a.patterns && a.patterns.qualityGuess), JSON.stringify(a.patterns));
  }

  const merged = sb.Imaging.mergeAnalyses(analyses.map((x) => x.a));
  check('merge multi-type pages', merged.pages === files.length, String(merged.pages));
  const base = sb.Presets.matchFromStats(merged);
  check('auto-match builtin', !!(base && base.id), base && base.name);

  const phone = analyses.find((x) => /phone/.test(x.f));
  if (phone) {
    const crops = sb.Harvest.harvestFromPages(
      [await toCanvas(path.join(FIX, phone.f))],
      { maxCrops: 40, allowFreqFallback: true }
    );
    check('phone harvest crops', crops.length >= 8, String(crops.length));
  }

  const neat = analyses.find((x) => /neat/.test(x.f));
  const messy = analyses.find((x) => /messy/.test(x.f));
  if (neat && messy && neat.a.patterns && messy.a.patterns) {
    check('neat page scored', neat.a.patterns.neatness > 0.1, String(neat.a.patterns.neatness));
    check('messy page scored', messy.a.patterns.neatness > 0.1, String(messy.a.patterns.neatness));
    check(
      'both have qualityGuess',
      !!(neat.a.patterns.qualityGuess && messy.a.patterns.qualityGuess),
      neat.a.patterns.qualityGuess + '/' + messy.a.patterns.qualityGuess
    );
  }

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
