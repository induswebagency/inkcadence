'use strict';
/* End-to-end check of the Inkcadence API against an in-memory Postgres.
   No database server required. Run with: npm test */

const path = require('path');
const PROJECT = path.join(__dirname, '..');

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/inkcadence';
process.env.CORS_ORIGIN = 'https://mafzalkalwardev.github.io';
process.env.SESSION_DAYS = '30';

// Swap the real pg driver for the in-memory one before anything requires it.
const { newDb } = require('pg-mem');
const mem = newDb({ autoCreateForeignKeyIndices: true });
const adapter = mem.adapters.createPg();
const pgPath = require.resolve('pg', { paths: [PROJECT] });
require.cache[pgPath] = {
  id: pgPath, filename: pgPath, loaded: true, exports: adapter, children: [], paths: [],
};

const { migrate } = require(path.join(PROJECT, 'server/migrate'));
const { createApp } = require(path.join(PROJECT, 'server/app'));

let pass = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

async function main() {
  await migrate();
  console.log('migrations applied');

  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const json = (res) => res.text().then((t) => { try { return JSON.parse(t); } catch (e) { return { _raw: t.slice(0, 200) }; } });

  async function req(method, url, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers);
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, {
      method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      redirect: 'manual',
    });
    return { status: res.status, headers: res.headers, body: await json(res) };
  }

  console.log('\n-- health + static exposure --');
  let r = await req('GET', '/api/health');
  check('health 200', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  check('health reports redis', typeof r.body.redis === 'string', JSON.stringify(r.body));
  check('health reports ml', typeof r.body.ml === 'string', JSON.stringify(r.body));
  check('health deployMode', r.body.deployMode === 'selfhost' || r.body.deployMode === 'saas', JSON.stringify(r.body));

  r = await req('GET', '/');
  check('index.html served at / with 200', r.status === 200 && typeof r.body._raw === 'string', 'status ' + r.status);
  r = await req('GET', '/index.html');
  check('/index.html served', r.status === 200);
  r = await req('GET', '/js/store.js');
  check('/js/store.js served', r.status === 200);

  console.log('\n-- the server must not leak its own files --');
  r = await req('GET', '/server/db.js');
  check('server/db.js NOT served', r.status === 404, 'got ' + r.status);
  r = await req('GET', '/.env');
  check('.env NOT served', r.status === 404, 'got ' + r.status);
  r = await req('GET', '/.env.example');
  check('.env.example NOT served', r.status === 404, 'got ' + r.status);
  r = await req('GET', '/package.json');
  check('package.json NOT served', r.status === 404, 'got ' + r.status);

  console.log('\n-- signup validation --');
  r = await req('POST', '/api/auth/signup', { body: { username: 'ab', password: 'longenough1' } });
  check('short username rejected 400', r.status === 400 && r.body.error.code === 'username_invalid', JSON.stringify(r.body));
  r = await req('POST', '/api/auth/signup', { body: { username: 'Aarav_K', password: 'longenough1' } });
  check('uppercase username accepted 201', r.status === 201, JSON.stringify(r.body));
  r = await req('POST', '/api/auth/signup', { body: { username: 'shortpw', password: 'abc' } });
  check('short password rejected 400', r.status === 400 && r.body.error.code === 'password_too_short', JSON.stringify(r.body));

  console.log('\n-- token mode (the GitHub Pages path) --');
  r = await req('POST', '/api/auth/signup', {
    headers: { 'x-session-mode': 'token' },
    body: { username: 'aarav', password: 'correct-horse-battery' },
  });
  check('signup 201', r.status === 201, JSON.stringify(r.body));
  check('returns a token', typeof r.body.token === 'string' && r.body.token.length > 20);
  check('does NOT set a cookie in token mode', !r.headers.get('set-cookie'));
  check('username lowercased', r.body.user && r.body.user.username === 'aarav', JSON.stringify(r.body.user));
  const token = r.body.token;

  r = await req('POST', '/api/auth/signup', {
    headers: { 'x-session-mode': 'token' },
    body: { username: 'aarav', password: 'correct-horse-battery' },
  });
  check('duplicate username 409', r.status === 409 && r.body.error.code === 'username_taken', JSON.stringify(r.body));

  r = await req('GET', '/api/auth/me', { headers: { authorization: 'Bearer ' + token } });
  check('me with bearer', r.status === 200 && r.body.user && r.body.user.username === 'aarav', JSON.stringify(r.body));

  r = await req('GET', '/api/auth/me');
  check('me without token is null', r.status === 200 && r.body.user === null, JSON.stringify(r.body));

  r = await req('GET', '/api/auth/me', { headers: { authorization: 'Bearer not-a-real-token' } });
  check('bogus token is null, not 500', r.status === 200 && r.body.user === null, JSON.stringify(r.body));

  console.log('\n-- packs --');
  const auth = { authorization: 'Bearer ' + token };
  r = await req('GET', '/api/packs', { headers: auth });
  check('empty list', r.status === 200 && Array.isArray(r.body.packs) && r.body.packs.length === 0);

  r = await req('GET', '/api/packs');
  check('packs require auth 401', r.status === 401, 'got ' + r.status);

  const payload = { name: 'My hand', data: { slant: -4, ink: '#1b2a4a', glyphs: [{ c: 'a' }, { c: 'b' }] } };
  r = await req('POST', '/api/packs', { headers: auth, body: payload });
  check('create pack 201', r.status === 201, JSON.stringify(r.body).slice(0, 200));
  const packId = r.body.pack && r.body.pack.id;
  check('server assigned an id', typeof packId === 'string' && packId.length > 10);
  check('data round-trips', r.body.pack.data && r.body.pack.data.glyphs.length === 2, JSON.stringify(r.body.pack && r.body.pack.data));

  r = await req('GET', '/api/packs?include=data', { headers: auth });
  check('list with data returns glyphs', r.status === 200 && r.body.packs[0] && r.body.packs[0].data && r.body.packs[0].data.glyphs.length === 2, JSON.stringify(r.body).slice(0, 200));

  r = await req('GET', '/api/packs', { headers: auth });
  check('list without data omits payload', r.status === 200 && r.body.packs[0] && r.body.packs[0].data === undefined);

  r = await req('PATCH', '/api/packs/' + packId, { headers: auth, body: { name: 'Renamed' } });
  check('patch name 200', r.status === 200 && r.body.pack.name === 'Renamed', JSON.stringify(r.body).slice(0, 160));
  check('patch keeps data', r.body.pack && r.body.pack.data && r.body.pack.data.glyphs.length === 2);

  r = await req('POST', '/api/packs', { headers: auth, body: { name: 'x', data: 'not-an-object' } });
  check('non-object data rejected 400', r.status === 400 && r.body.error.code === 'data_invalid', JSON.stringify(r.body));

  r = await req('POST', '/api/packs', { headers: auth, body: { name: '', data: {} } });
  check('empty name rejected 400', r.status === 400, JSON.stringify(r.body));

  console.log('\n-- one account cannot touch another --');
  const r2 = await req('POST', '/api/auth/signup', {
    headers: { 'x-session-mode': 'token' },
    body: { username: 'intruder', password: 'another-good-password' },
  });
  const token2 = r2.body.token;
  check('second account created', r2.status === 201 && typeof token2 === 'string');

  r = await req('GET', '/api/packs/' + packId, { headers: { authorization: 'Bearer ' + token2 } });
  check('other user cannot read the pack', r.status === 404, 'got ' + r.status);
  r = await req('PATCH', '/api/packs/' + packId, { headers: { authorization: 'Bearer ' + token2 }, body: { name: 'stolen' } });
  check('other user cannot patch the pack', r.status === 404, 'got ' + r.status);
  r = await req('DELETE', '/api/packs/' + packId, { headers: { authorization: 'Bearer ' + token2 } });
  check('other user cannot delete the pack', r.status === 404, 'got ' + r.status);

  console.log('\n-- login / logout --');
  r = await req('POST', '/api/auth/login', {
    headers: { 'x-session-mode': 'token' },
    body: { username: 'aarav', password: 'wrong-password' },
  });
  check('wrong password 401', r.status === 401 && r.body.error.code === 'bad_credentials', JSON.stringify(r.body));
  r = await req('POST', '/api/auth/login', {
    headers: { 'x-session-mode': 'token' },
    body: { username: 'ghost-user', password: 'anything-at-all' },
  });
  check('unknown user gives the same message', r.status === 401 && r.body.error.code === 'bad_credentials', JSON.stringify(r.body));

  r = await req('POST', '/api/auth/login', {
    headers: { 'x-session-mode': 'token' },
    body: { username: 'AARAV', password: 'correct-horse-battery' },
  });
  check('login 200, case-insensitive name', r.status === 200 && typeof r.body.token === 'string', JSON.stringify(r.body).slice(0, 160));
  const loginToken = r.body.token;

  r = await req('POST', '/api/auth/logout', { headers: { authorization: 'Bearer ' + loginToken } });
  check('logout 200', r.status === 200 && r.body.ok === true);
  r = await req('GET', '/api/auth/me', { headers: { authorization: 'Bearer ' + loginToken } });
  check('token dead after logout', r.status === 200 && r.body.user === null, JSON.stringify(r.body));
  r = await req('GET', '/api/auth/me', { headers: { authorization: 'Bearer ' + token } });
  check('other session still alive', r.status === 200 && r.body.user && r.body.user.username === 'aarav');

  console.log('\n-- cookie mode (same-origin, VPS) --');
  r = await req('POST', '/api/auth/signup', { body: { username: 'cookieuser', password: 'cookie-password-1' } });
  check('signup sets a cookie', r.status === 201 && !!r.headers.get('set-cookie'), 'set-cookie: ' + r.headers.get('set-cookie'));
  check('no token in body in cookie mode', r.body.token === undefined, JSON.stringify(r.body));
  const rawCookie = r.headers.get('set-cookie') || '';
  check('cookie is HttpOnly', /HttpOnly/i.test(rawCookie), rawCookie);
  check('cookie is SameSite=Lax', /SameSite=Lax/i.test(rawCookie), rawCookie);
  const cookie = rawCookie.split(';')[0];
  r = await req('GET', '/api/auth/me', { headers: { cookie } });
  check('me via cookie', r.status === 200 && r.body.user && r.body.user.username === 'cookieuser', JSON.stringify(r.body));

  console.log('\n-- CORS for the GitHub Pages origin --');
  r = await req('OPTIONS', '/api/auth/login', {
    headers: { origin: 'https://mafzalkalwardev.github.io', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-session-mode' },
  });
  check('preflight 204', r.status === 204, 'got ' + r.status);
  check('origin echoed', r.headers.get('access-control-allow-origin') === 'https://mafzalkalwardev.github.io', String(r.headers.get('access-control-allow-origin')));
  check('x-session-mode allowed', /x-session-mode/i.test(r.headers.get('access-control-allow-headers') || ''), String(r.headers.get('access-control-allow-headers')));
  check('authorization allowed', /authorization/i.test(r.headers.get('access-control-allow-headers') || ''));

  r = await req('GET', '/api/health', { headers: { origin: 'https://evil.example.com' } });
  check('unknown origin gets no CORS header', !r.headers.get('access-control-allow-origin'), String(r.headers.get('access-control-allow-origin')));

  console.log('\n-- delete --');
  r = await req('DELETE', '/api/packs/' + packId, { headers: auth });
  check('delete 200', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  r = await req('GET', '/api/packs/' + packId, { headers: auth });
  check('gone after delete', r.status === 404);

  console.log('\n-- password reset hooks --');
  r = await req('POST', '/api/auth/request-password-reset', { body: { email: 'nobody@example.com' } });
  check('reset request always 200', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

  console.log('\n-- billing plans (selfhost) --');
  r = await req('GET', '/api/billing/plans');
  check('plans endpoint', r.status === 200 && Array.isArray(r.body.plans), JSON.stringify(r.body));

  console.log('\n-- pack neural train queue (no ML) --');
  r = await req('POST', '/api/packs', { headers: auth, body: { name: 'Neural later', data: { glyphs: [] } } });
  check('create pack for train', r.status === 201, JSON.stringify(r.body).slice(0, 160));
  const trainPackId = r.body.pack && r.body.pack.id;
  r = await req('POST', '/api/packs/' + trainPackId + '/train-model', { headers: auth });
  check('train-model accepted 202', r.status === 202 && r.body.modelStatus === 'queued', JSON.stringify(r.body));
  r = await req('POST', '/api/packs/' + trainPackId + '/infer', { headers: auth, body: { text: 'hi', renderMode: 'auto' } });
  check('infer falls back classical', r.status === 200 && (r.body.mode === 'classical' || r.body.fallback === true), JSON.stringify(r.body));

  console.log('\n-- unknown api route --');
  r = await req('GET', '/api/nonsense');
  check('404 json, not html', r.status === 404 && r.body.error && r.body.error.code === 'not_found', JSON.stringify(r.body));

  server.close();
  console.log('\n' + '='.repeat(52));
  console.log('  passed: ' + pass + '   failed: ' + failures.length);
  if (failures.length) { failures.forEach((f) => console.log('   - ' + f)); process.exit(1); }
  console.log('  all green');
}

main().catch((err) => { console.error('HARNESS ERROR:', err); process.exit(2); });
