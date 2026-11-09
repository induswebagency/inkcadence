'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function convert(name, exportName) {
  const src = fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8');
  const start = src.indexOf('(function');
  if (start < 0) throw new Error(name + ' is not an IIFE');
  let body = src.slice(start).trim();
  const header = src.slice(0, start).trim();
  body = body
    .replace(/^\(function\s*\(global\)\s*\{\s*'use strict';\s*/, "'use strict';\n")
    .replace(new RegExp('global\\.' + exportName + '\\s*=\\s*\\{'), 'const ' + exportName + ' = {')
    .replace(/\}\s*;\s*\}\)\(window\);\s*$/, '};\n\nexport { ' + exportName + ' };\nexport default ' + exportName + ';\n');
  if (header) body = header + '\n' + body;

  const out = path.join(ROOT, 'web', 'src', 'lib', name + '.js');
  fs.writeFileSync(out, body);
  console.log('synced', out);
}

const modules = [
  ['imaging', 'Imaging'],
  ['glyphs', 'Glyphs'],
  ['render', 'Rendering'],
  ['presets', 'Presets'],
  ['harvest', 'Harvest'],
  ['assignment', 'Assignment'],
  ['packshare', 'PackShare']
];

modules.forEach(function (pair) {
  convert(pair[0], pair[1]);
});
