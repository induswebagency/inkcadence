'use strict';
/* Pure unit checks for classical engine helpers (no browser canvas required). */

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const PROJECT = path.join(__dirname, '..');

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function loadIife(file, sandbox) {
  vm.runInContext(fs.readFileSync(path.join(PROJECT, file), 'utf8'), sandbox);
}

function fakeDom() {
  const sandbox = {
    console,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Error,
    Uint8Array,
    Uint8ClampedArray,
    Uint32Array,
    Float32Array,
    Float64Array,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.document = {
    createElement: function (tag) {
      if (tag !== 'canvas') return {};
      const c = {
        width: 0,
        height: 0,
        getContext: function () {
          return {
            drawImage: function () {},
            getImageData: function (x, y, w, h) {
              const data = new Uint8ClampedArray(w * h * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 240; data[i + 1] = 240; data[i + 2] = 235; data[i + 3] = 255;
              }
              for (let yy = 10; yy < 30; yy++) {
                for (let xx = 10; xx < 40; xx++) {
                  const p = (yy * w + xx) * 4;
                  data[p] = 20; data[p + 1] = 30; data[p + 2] = 50;
                }
              }
              return { data: data, width: w, height: h };
            },
            putImageData: function () {},
            createImageData: function (w, h) {
              return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
            },
            fillRect: function () {},
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            globalAlpha: 1,
            font: '',
            textAlign: 'left',
            textBaseline: 'alphabetic',
            globalCompositeOperation: '',
            beginPath: function () {},
            moveTo: function () {},
            lineTo: function () {},
            stroke: function () {},
            fillText: function () {},
            measureText: function (t) { return { width: String(t).length * 10 }; },
            save: function () {},
            restore: function () {},
            translate: function () {},
            rotate: function () {},
            transform: function () {},
          };
        },
        toDataURL: function () { return 'data:image/png;base64,AAA'; },
      };
      return c;
    },
  };
  sandbox.Image = function () { this.onload = null; this.src = ''; };
  sandbox.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
  vm.createContext(sandbox);
  return sandbox;
}

console.log('\n-- engine: imaging / glyphs / render helpers --');
const sb = fakeDom();
loadIife('js/imaging.js', sb);
loadIife('js/glyphs.js', sb);
loadIife('js/render.js', sb);
loadIife('js/harvest.js', sb);
loadIife('js/assignment.js', sb);

check('Imaging exported', !!sb.Imaging && typeof sb.Imaging.otsu === 'function');
check('Glyphs exported', !!sb.Glyphs && sb.Glyphs.CHARS.length > 50);
check('Rendering exported', !!sb.Rendering && typeof sb.Rendering.renderPages === 'function');
check('Harvest exported', !!sb.Harvest && typeof sb.Harvest.harvestFromPages === 'function');
check('Assignment exported', !!sb.Assignment && typeof sb.Assignment.styleScore === 'function');
check('Harvest.medianCellMetrics', typeof sb.Harvest.medianCellMetrics === 'function');
check('Imaging.guessPaperStyle', typeof sb.Imaging.guessPaperStyle === 'function');

const hist = new Uint32Array(256);
for (let i = 0; i < 100; i++) hist[40]++;
for (let i = 0; i < 400; i++) hist[220]++;
const th = sb.Imaging.otsu(hist);
check('otsu finds a threshold between clusters', th >= 40 && th < 220, 'th=' + th);

const conf = sb.Imaging.strokeConfidence;
check('strokeConfidence exported', typeof conf === 'function');
const ink = new Uint8Array(100 * 40);
for (let y = 0; y < 40; y++) for (let x = 5; x < 12; x++) ink[y * 100 + x] = 1;
const c = conf(ink, 100, 40, 7);
check('strokeConfidence in 0..1', c >= 0.2 && c <= 1, String(c));

check('pairKern tightens th', sb.Rendering.pairKern('t', 'h', 34) < 0);
check('pairKern unknown is 0', sb.Rendering.pairKern('q', 'z', 34) === 0);
check('glyphJitterProfile ascender', sb.Rendering.glyphJitterProfile('b').rot === 0.7);
check('glyphJitterProfile default', sb.Rendering.glyphJitterProfile('a').rot === 1);

const pack = {
  cellH: 92,
  glyphs: [],
  lineGap: 40,
};
const pages = sb.Rendering.renderPages({
  text: '# Title\nHello world',
  pack: pack,
  size: 34,
  jitter: 0.4,
  seed: 7,
  penColour: '#1b2a4a',
  paper: 'ruled',
  watermark: true,
});
check('renderPages returns canvases', Array.isArray(pages) && pages.length >= 1);
check('exportPrintDocument html', typeof sb.Rendering.exportPrintDocument === 'function' &&
  /page-break-after/.test(sb.Rendering.exportPrintDocument(pages, 't')));

// QA helper (Node can require the ESM via dynamic import in modern Node — use inline mirror)
const total = sb.Glyphs.CHARS.length;
const completeness = Math.round((10 / total) * 100);
check('glyph alphabet size stable', total >= 80, String(total));
check('completeness math', completeness > 0 && completeness < 100);

const layouts = sb.Assignment.layouts();
check('assignment layouts include exam/essay/lab',
  layouts.some((l) => l.id === 'exam_lined') &&
  layouts.some((l) => l.id === 'blank_essay') &&
  layouts.some((l) => l.id === 'lab_grid'));

const med = sb.Harvest.medianCellMetrics([
  { cellH: 40, cellW: 30 },
  { cellH: 50, cellW: 32 },
  { cellH: 90, cellW: 60 },
]);
check('medianCellMetrics picks middle', med.cellH === 50 && med.cellW === 32, JSON.stringify(med));

const mergedEmpty = sb.Harvest.mergeVariants(
  [{ ch: 'a', w: 1 }],
  [{ ch: 'a', w: 2 }, { ch: 'b', w: 3 }]
);
check('mergeVariants adds new letters',
  mergedEmpty.some((g) => g.ch === 'b') &&
  mergedEmpty.filter((g) => g.ch === 'a').length === 2 &&
  mergedEmpty.length === 3,
  'len=' + mergedEmpty.length);

console.log('\n' + '='.repeat(52));
console.log('  passed: ' + pass + '   failed: ' + failures.length);
if (failures.length) { failures.forEach((f) => console.log('   - ' + f)); process.exit(1); }
console.log('  all green');
