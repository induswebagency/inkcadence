'use strict';
/* Loads js/config.js + js/store.js in a fake browser and drives them against a
   real running Inkcadence API, verifying the GitHub Pages integration path.
   No database server required. Run with: npm test */

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const PROJECT = path.join(__dirname, '..');

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/inkcadence';
process.env.CORS_ORIGIN = 'https://mafzalkalwardev.github.io';

const { newDb } = require('pg-mem');
const mem = newDb({ autoCreateForeignKeyIndices: true });
const adapter = mem.adapters.createPg();
const pgPath = require.resolve('pg', { paths: [PROJECT] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: adapter, children: [], paths: [] };

const { migrate } = require(path.join(PROJECT, 'server/migrate'));
const { createApp } = require(path.join(PROJECT, 'server/app'));

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

function loadBrowser(apiBase, storage) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.localStorage = storage;
  sandbox.fetch = (url, opts) => fetch(url, opts);
  sandbox.TextEncoder = TextEncoder;
  sandbox.TextDecoder = TextDecoder;
  sandbox.AbortController = AbortController;
  sandbox.crypto = crypto.webcrypto;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.clearInterval = clearInterval;
  sandbox.setInterval = setInterval;
  sandbox.Promise = Promise;
  sandbox.Date = Date;
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  sandbox.Error = Error;
  sandbox.Object = Object;
  sandbox.Array = Array;
  sandbox.String = String;
  sandbox.Number = Number;
  sandbox.Uint8Array = Uint8Array;
  sandbox.encodeURIComponent = encodeURIComponent;
  sandbox.INKCADENCE_CONFIG = { apiBase: apiBase, remote: 'auto' };
  vm.createContext(sandbox);

  // config.js normally sets INKCADENCE_CONFIG itself; give it the real file too.
  vm.runInContext(fs.readFileSync(path.join(PROJECT, 'js/config.js'), 'utf8'), sandbox);
  sandbox.INKCADENCE_CONFIG.apiBase = apiBase;
  vm.runInContext(fs.readFileSync(path.join(PROJECT, 'js/store.js'), 'utf8'), sandbox);
  return sandbox.Store;
}

async function main() {
  await migrate();
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  console.log('server on ' + base + '\n');

  /* ---------------- remote mode ---------------- */
  console.log('-- Store against a reachable API --');
  const storage = fakeStorage();
  const Store = loadBrowser(base, storage);
  check('Store is exposed', !!Store && typeof Store.signup === 'function');

  const mode = await Store.ready;
  check('mode resolves to remote', mode === 'remote', 'got ' + mode);
  check('mode() agrees', Store.mode() === 'remote');

  const name = await Store.signup('webuser', 'a-good-password');
  check('signup returns the username', name === 'webuser', 'got ' + name);
  check('token persisted to storage', !!storage.getItem('inkcadence:token'), JSON.stringify(storage._dump()));
  check('no session key used in remote mode', storage.getItem('inkcadence:session') === null);

  const who = await Store.currentUser();
  check('currentUser round-trips', who === 'webuser', 'got ' + who);

  let rejected = null;
  try { await Store.signup('webuser', 'a-good-password'); } catch (e) { rejected = e; }
  check('duplicate signup surfaces server message', !!rejected && /taken/i.test(rejected.message), rejected && rejected.message);

  const pack = {
    id: '',
    name: 'My hand',
    stats: { slant: -4 },
    penColours: ['#1b2a4a', '#c0392b'],
    paper: '#fdfcf7',
    missing: ['q'],
    glyphs: [{ c: 'a', d: 'M0 0' }, { c: 'b', d: 'M1 1' }],
  };

  const saved = await Store.savePack('webuser', pack);
  check('savePack returns a server-assigned id', !!saved.id && saved.id !== '', JSON.stringify(saved).slice(0, 120));
  check('savePack preserves glyphs', saved.glyphs && saved.glyphs.length === 2, JSON.stringify(saved.glyphs));
  check('savePack preserves penColours', Array.isArray(saved.penColours) && saved.penColours.length === 2);
  check('savePack preserves stats.slant', saved.stats && saved.stats.slant === -4);

  const list = await Store.packs('webuser');
  check('packs() returns the saved pack', list.length === 1 && list[0].name === 'My hand', JSON.stringify(list).slice(0, 140));
  check('listed pack carries glyphs', list[0].glyphs && list[0].glyphs.length === 2);

  saved.name = 'Renamed pack';
  const updated = await Store.savePack('webuser', saved);
  check('saving an existing pack patches it', updated.name === 'Renamed pack', JSON.stringify(updated).slice(0, 140));
  const list2 = await Store.packs('webuser');
  check('still exactly one pack after update', list2.length === 1, 'got ' + list2.length);
  check('update did not lose data', list2[0].glyphs.length === 2);

  const afterDelete = await Store.deletePack('webuser', saved.id);
  check('deletePack returns the fresh list', Array.isArray(afterDelete) && afterDelete.length === 0, JSON.stringify(afterDelete).slice(0, 120));

  await Store.logout();
  check('logout clears the token', storage.getItem('inkcadence:token') === null, JSON.stringify(storage._dump()));
  const afterLogout = await Store.currentUser();
  check('currentUser is null after logout', afterLogout === null, 'got ' + afterLogout);

  /* fresh sign-in through login() */
  const name2 = await Store.login('webuser', 'a-good-password');
  check('login() returns the username', name2 === 'webuser', 'got ' + name2);

  let badLogin = null;
  try { await Store.login('webuser', 'nope-nope-nope'); } catch (e) { badLogin = e; }
  check('wrong password rejected', !!badLogin && /do not match/i.test(badLogin.message), badLogin && badLogin.message);

  /* ---------------- local fallback ---------------- */
  console.log('\n-- Store when the API is unreachable --');
  const storage2 = fakeStorage();
  const Store2 = loadBrowser('http://127.0.0.1:9', storage2);  // discard port
  const mode2 = await Store2.ready;
  check('falls back to local', mode2 === 'local', 'got ' + mode2);

  const n3 = await Store2.signup('offlineuser', 'offline-password');
  check('local signup works', n3 === 'offlineuser', 'got ' + n3);
  const p3 = await Store2.savePack('offlineuser', { id: 'p1', name: 'Offline', glyphs: [{ c: 'a' }] });
  check('local savePack works', p3 && p3.id === 'p1');
  const l3 = await Store2.packs('offlineuser');
  check('local packs() works', l3.length === 1 && l3[0].name === 'Offline', JSON.stringify(l3).slice(0, 120));
  const d3 = await Store2.deletePack('offlineuser', 'p1');
  check('local deletePack works', d3.length === 0);

  let shortPw = null;
  try { await Store2.signup('someoneelse', 'short'); } catch (e) { shortPw = e; }
  check('local mode enforces 8-char minimum', !!shortPw && /8 characters/i.test(shortPw.message), shortPw && shortPw.message);

  server.close();
  console.log('\n' + '='.repeat(52));
  console.log('  passed: ' + pass + '   failed: ' + failures.length);
  if (failures.length) { failures.forEach((f) => console.log('   - ' + f)); process.exit(1); }
  console.log('  all green');
}

main().catch((err) => { console.error('HARNESS ERROR:', err); process.exit(2); });
