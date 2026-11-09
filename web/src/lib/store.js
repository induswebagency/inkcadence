'use strict';
import { INKCADENCE_CONFIG as _CFG } from './config.js';
/* store.js — Inkcadence account and style-pack storage.
 *
 * Two drivers behind one API:
 *   remote — the Inkcadence API, authenticated with a bearer token. This is the
 *            driver used when the page is served from GitHub Pages and the API
 *            lives on another origin, where a session cookie could not be sent.
 *   local  — IndexedDB with a localStorage fallback. Used when no server is
 *            configured or the server cannot be reached, so the app still works
 *            as a plain static page.
 *
 * caller never needs to know which one is running.
 */
var NS = 'inkcadence';
  var idb = null;
  var useIDB = false;

  var CFG = _CFG || {};
  var API_BASE = String(CFG.apiBase || '').replace(/\/+$/, '');
  var MODE = 'local';
  var TOKEN_KEY = NS + ':token';

  /* ------------------------------------------------------------------ local */

  var localReady = (function () {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      try {
        if (!(typeof indexedDB!=="undefined"?indexedDB:undefined)) return done(false);
        var req = indexedDB.open(NS, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = function () { idb = req.result; useIDB = true; done(true); };
        req.onerror = function () { done(false); };
        setTimeout(function () { done(useIDB); }, 2500);
      } catch (e) { done(false); }
    });
  })();

  function lsGet(k) {
    try { var v = localStorage.getItem(NS + ':' + k); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(NS + ':' + k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }

  function get(k) {
    return localReady.then(function () {
      if (!useIDB) return lsGet(k);
      return new Promise(function (resolve) {
        try {
          var rq = idb.transaction('kv', 'readonly').objectStore('kv').get(k);
          rq.onsuccess = function () { resolve(rq.result === undefined ? null : rq.result); };
          rq.onerror = function () { resolve(lsGet(k)); };
        } catch (e) { resolve(lsGet(k)); }
      });
    });
  }

  function set(k, v) {
    return localReady.then(function () {
      if (useIDB) {
        var ok = new Promise(function (resolve) {
          try {
            var tx = idb.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(v, k);
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { resolve(false); };
          } catch (e) { resolve(false); }
        });
        return ok.then(function (r) { return r || lsSet(k, v); });
      }
      return lsSet(k, v);
    });
  }

  function del(k) {
    return localReady.then(function () {
      if (useIDB) {
        try {
          var tx = idb.transaction('kv', 'readwrite');
          tx.objectStore('kv').delete(k);
        } catch (e) {}
      }
      try { localStorage.removeItem(NS + ':' + k); } catch (e) {}
      return true;
    });
  }

  function hex(buf) {
    var s = '';
    for (var i = 0; i < buf.length; i++) s += ('0' + buf[i].toString(16)).slice(-2);
    return s;
  }

  function weakHash(bytes) {
    var h = 2166136261;
    for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
    return 'fnv:' + (h >>> 0).toString(16);
  }

  function hashPassword(password, salt) {
    var enc = new TextEncoder().encode(salt + ':' + password);
    if (crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', enc).then(function (d) {
        return 'sha256:' + hex(new Uint8Array(d));
      }).catch(function () { return weakHash(enc); });
    }
    return Promise.resolve(weakHash(enc));
  }

  function newSalt() {
    var a = new Uint8Array(12);
    if (crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < 12; i++) a[i] = (Math.random() * 256) | 0;
    return hex(a);
  }

  function users() { return get('users').then(function (u) { return u || {}; }); }

  /* ----------------------------------------------------------------- remote */

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function withTimeout(promise, ms) {
    if (!AbortController) return promise;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return promise(ctrl.signal).then(function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; });
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.tokenMode) headers['X-Session-Mode'] = 'token';

    return withTimeout(function (signal) {
      return fetch(API_BASE + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: signal
      });
    }, opts.timeout || 15000).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        if (!res.ok) {
          var err = new Error((data.error && data.error.message) || ('Request failed (' + res.status + ')'));
          err.status = res.status;
          err.code = data.error && data.error.code;
          throw err;
        }
        return data;
      });
    });
  }

  function mapPack(row) {
    var p = (row.data && typeof row.data === 'object') ? Object.assign({}, row.data) : {};
    p.id = row.id;
    p.name = row.name;
    p.updatedAt = row.updatedAt;
    if (row.modelStatus != null) p.modelStatus = row.modelStatus;
    if (row.model_status != null) p.modelStatus = row.model_status;
    if (row.renderMode != null) p.renderMode = row.renderMode;
    if (row.render_mode != null) p.renderMode = row.render_mode;
    if (row.modelUri != null) p.modelUri = row.modelUri;
    if (row.model_uri != null) p.modelUri = row.model_uri;
    if (row.modelMetrics != null) p.modelMetrics = row.modelMetrics;
    if (row.model_metrics != null) p.modelMetrics = row.model_metrics;
    return p;
  }

  var ready = localReady.then(function () {
    if (!API_BASE || CFG.remote === 'off') { MODE = 'local'; return MODE; }
    return api('/api/health', { timeout: 4000 })
      .then(function () { MODE = 'remote'; return MODE; })
      .catch(function () { MODE = 'local'; return MODE; });
  });

  /* ------------------------------------------------------------------- auth */

  function signup(name, password, email) {
    name = (name || '').trim().toLowerCase();
    password = password || '';
    email = email ? String(email).trim().toLowerCase() : undefined;

    if (MODE === 'remote') {
      var body = { username: name, password: password };
      if (email) body.email = email;
      return api('/api/auth/signup', {
        method: 'POST', tokenMode: true, body: body
      }).then(function (d) {
        if (!d.token) throw new Error('The server did not return a session token.');
        setToken(d.token);
        return d.user.username;
      });
    }

    if (!/^[a-z0-9_.-]{3,24}$/.test(name)) return Promise.reject(new Error('Username: 3–24 chars, letters/digits/._- only.'));
    if (password.length < 8) return Promise.reject(new Error('Password must be at least 8 characters.'));
    return users().then(function (all) {
      if (all[name]) throw new Error('That username already exists on this device.');
      var salt = newSalt();
      return hashPassword(password, salt).then(function (h) {
        all[name] = { salt: salt, hash: h, created: Date.now() };
        return set('users', all).then(function () { return set('session', name); }).then(function () { return name; });
      });
    });
  }

  function login(name, password) {
    name = (name || '').trim().toLowerCase();
    password = password || '';

    if (MODE === 'remote') {
      return api('/api/auth/login', {
        method: 'POST', tokenMode: true, body: { username: name, password: password }
      }).then(function (d) {
        if (!d.token) throw new Error('The server did not return a session token.');
        setToken(d.token);
        return d.user.username;
      });
    }

    return users().then(function (all) {
      var u = all[name];
      if (!u) throw new Error('No account with that name on this device.');
      return hashPassword(password, u.salt).then(function (h) {
        if (h !== u.hash) throw new Error('Wrong password.');
        return set('session', name).then(function () { return name; });
      });
    });
  }

  function currentUser() {
    if (MODE === 'remote') {
      if (!getToken()) return Promise.resolve(null);
      return api('/api/auth/me', { token: getToken() })
        .then(function (d) { return d.user ? d.user.username : null; })
        .catch(function (err) {
          if (err.status === 401 || err.status === 404) setToken(null);
          return null;
        });
    }
    return get('session');
  }

  function logout() {
    if (MODE === 'remote') {
      var token = getToken();
      setToken(null);
      if (!token) return Promise.resolve(true);
      return api('/api/auth/logout', { method: 'POST', token: token })
        .then(function () { return true; })
        .catch(function () { return true; });
    }
    return del('session');
  }

  /* ------------------------------------------------------------------ packs */

  function packs(user) {
    if (MODE === 'remote') {
      return api('/api/packs?include=data', { token: getToken() })
        .then(function (d) { return d.packs.map(mapPack); });
    }
    return get('packs:' + user).then(function (p) { return p || []; });
  }

  function plainPack(pack) {
    return JSON.parse(JSON.stringify(pack, function (key, value) {
      if (key === '_img' || key === '__id') return undefined;
      if (typeof value === 'function') return undefined;
      return value;
    }));
  }

  function savePack(user, pack) {
    pack = plainPack(pack);
    if (MODE === 'remote') {
      var token = getToken();
      var payload = { name: pack.name || 'Untitled', data: pack };

      if (pack.id) {
        return api('/api/packs/' + encodeURIComponent(pack.id), { method: 'PATCH', body: payload, token: token })
          .then(function (d) { return mapPack(d.pack); })
          .catch(function (err) {
            if (err.status !== 404) throw err;
            return api('/api/packs', { method: 'POST', body: payload, token: token })
              .then(function (d) { return mapPack(d.pack); });
          });
      }
      return api('/api/packs', { method: 'POST', body: payload, token: token })
        .then(function (d) { return mapPack(d.pack); });
    }

    return get('packs:' + user).then(function (list) {
      list = list || [];
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].id === pack.id) i = k;
      if (i >= 0) list[i] = pack; else list.push(pack);
      return set('packs:' + user, list).then(function () { return pack; });
    });
  }

  function deletePack(user, id) {
    if (MODE === 'remote') {
      return api('/api/packs/' + encodeURIComponent(id), { method: 'DELETE', token: getToken() })
        .then(function () { return api('/api/packs?include=data', { token: getToken() }); })
        .then(function (d) { return d.packs.map(mapPack); });
    }

    return get('packs:' + user).then(function (list) {
      var out = (list || []).filter(function (p) { return p.id !== id; });
      return set('packs:' + user, out).then(function () { return out; });
    });
  }

  const Store = {
    ready: ready,
    mode: function () { return MODE; },
    get: get, set: set, del: del,
    signup: signup, login: login, currentUser: currentUser, logout: logout,
    packs: packs, savePack: savePack, deletePack: deletePack,
    usingIDB: function () { return useIDB; }
  };

export { Store };
export default Store;
