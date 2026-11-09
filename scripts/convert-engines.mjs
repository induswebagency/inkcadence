import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'web', 'src', 'lib');

const files = {
  imaging: {
    global: 'Imaging',
    named: 'export const { loadImageFile, canvas, analyze, mergeAnalyses, toGrayscale, otsu } = Imaging;\n',
  },
  glyphs: {
    global: 'Glyphs',
    named: 'export const { CHARS, COLS, ROWS, extractGlyphs, hydrate, tint, groupByChar } = Glyphs;\n',
  },
  render: {
    global: 'Rendering',
    import: "import { Glyphs } from './glyphs.js';\n",
    named: 'export const { renderPages, PAGE_W, PAGE_H } = Rendering;\n',
  },
  store: {
    global: 'Store',
    import: "import { INKCADENCE_CONFIG as _CFG } from './config.js';\n",
    named: '',
  },
};

for (const [name, meta] of Object.entries(files)) {
  let src = fs.readFileSync(path.join(dir, name + '.js'), 'utf8');
  src = src.replace(/^\(function \(global\) \{\s*'use strict';\s*/m, '');
  src = src.replace(/\}\)\(window\);\s*$/m, '');
  const g = meta.global;
  src = src.replace(new RegExp('global\\.' + g + '\\s*=\\s*\\{'), 'const ' + g + ' = {');
  src = src.replace(/global\.Glyphs/g, 'Glyphs');
  src = src.replace(/global\.indexedDB/g, '(typeof indexedDB!=="undefined"?indexedDB:undefined)');
  src = src.replace(/global\.crypto/g, 'crypto');
  src = src.replace(/global\.AbortController/g, 'AbortController');
  src = src.replace(/var CFG = global\.INKCADENCE_CONFIG \|\| \{\};/, 'var CFG = _CFG || {};');
  src = src.replace(/global\.INKCADENCE_CONFIG/g, '_CFG');

  const header = "'use strict';\n" + (meta.import || '');
  const exportLine = 'export { ' + g + ' };\nexport default ' + g + ';\n';
  const out = header + src.trim() + '\n\n' + (meta.named || '') + exportLine;
  fs.writeFileSync(path.join(dir, name + '.js'), out);
  console.log('converted', name);
}

// config.js as ESM
fs.writeFileSync(
  path.join(dir, 'config.js'),
  `export const INKCADENCE_CONFIG = {
  apiBase: '',
  remote: 'auto',
};

export default INKCADENCE_CONFIG;
`
);
console.log('wrote config.js');
