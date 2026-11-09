'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadModule(name, exportName) {
  const file = path.join(__dirname, '..', 'web', 'src', 'lib', name + '.js');
  const mod = await import(pathToFileURL(file).href);
  return mod[exportName] || mod.default;
}

async function main() {
  const Assignment = await loadModule('assignment', 'Assignment');
  const PackShare = await loadModule('packshare', 'PackShare');
  const Presets = await loadModule('presets', 'Presets');

  const formatted = Assignment.formatAssignment('Assignment 1\n1) What is ML?\nIt learns from data.\n2. Define loss');
  assert.ok(formatted.includes('# '), 'formats title as heading');
  assert.ok(formatted.includes('1. '), 'normalizes numbered questions');

  const layouts = Assignment.layouts();
  assert.ok(layouts.length >= 3, 'layout presets exist');
  assert.strictEqual(Assignment.layoutById('blank_essay').paper, 'plain');

  const score = Assignment.styleScore({
    pages: 2,
    inkRatio: 0.04,
    strokeConfidence: 0.8,
    patterns: { neatness: 0.85, qualityGuess: 'best' },
  });
  assert.ok(score.score >= 50 && score.score <= 98, 'style score in range');

  const builtins = Presets.list();
  assert.strictEqual(builtins.length, 10, 'ten builtin styles');
  const matched = Presets.matchFromStats({ slant: 0.05, strokeWidth: 2.2, patterns: { neatness: 0.9 } });
  assert.ok(matched && matched.id, 'matchFromStats returns pack');

  const pack = {
    id: 'pk_test',
    name: 'Test Hand',
    glyphs: [{ ch: 'a', url: 'data:image/png;base64,aaa', w: 10, h: 12, by: 8, adv: 12 }],
    stats: { thumbs: ['secret-photo'], pages: 1, slant: 0.1, strokeWidth: 2, palette: [] },
    penColours: ['#123'],
  };
  const encoded = PackShare.encodeShare(pack);
  assert.ok(encoded.startsWith('INK1.'), 'share encode prefix');
  const decoded = PackShare.decodeShare(encoded);
  assert.strictEqual(decoded.name, 'Test Hand');
  assert.ok(!decoded.stats.thumbs.length, 'photos stripped on import');
  assert.ok(decoded.id.indexOf('pk_import_') === 0, 'import gets new id');

  // Ensure Pages workflow includes classic app.
  const pagesYml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.ok(pagesYml.includes('_site/classic'), 'Pages deploys classic writer');
  assert.ok(pagesYml.includes('sync_engines_to_web'), 'Pages syncs engines');

  console.log('realism.test.js ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
