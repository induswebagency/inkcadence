/* store.js — Inkcadence local account + style-pack storage.
   IndexedDB when available, localStorage fallback (file:// friendly). */
(function (global) {
  'use strict';
  var NS = 'inkcadence';
  var idb = null;
  var useIDB = false;

  var ready = (function () {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      try {
        if (!global.indexedDB) return done(false);
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
    return ready.then(function () {
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
    return ready.then(function () {
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
    return ready.then(function () {
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

  function hashPassword(password, salt) {
    var enc = new TextEncoder().encode(salt + ':' + password);
    if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest) {
      return global.crypto.subtle.digest('SHA-256', enc).then(function (d) {
        return 'sha256:' + hex(new Uint8Array(d));
      }).catch(function () { return weakHash(enc); });
    }
    return Promise.resolve(weakHash(enc));
  }

  function weakHash(bytes) {
    var h = 2166136261;
    for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
    return 'fnv:' + (h >>> 0).toString(16);
  }

  function newSalt() {
    var a = new Uint8Array(12);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(a);
    else for (var i = 0; i < 12; i++) a[i] = (Math.random() * 256) | 0;
    return hex(a);
  }

  function users() { return get('users').then(function (u) { return u || {}; }); }

  function signup(name, password) {
    name = (name || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,24}$/.test(name)) return Promise.reject(new Error('Username: 3–24 chars, letters/digits/._- only.'));
    if ((password || '').length < 4) return Promise.reject(new Error('Password must be at least 4 characters.'));
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
    return users().then(function (all) {
      var u = all[name];
      if (!u) throw new Error('No account with that name on this device.');
      return hashPassword(password, u.salt).then(function (h) {
        if (h !== u.hash) throw new Error('Wrong password.');
        return set('session', name).then(function () { return name; });
      });
    });
  }

  function currentUser() { return get('session'); }
  function logout() { return del('session'); }

  function packs(user) { return get('packs:' + user).then(function (p) { return p || []; }); }
  function savePack(user, pack) {
    return packs(user).then(function (list) {
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].id === pack.id) i = k;
      if (i >= 0) list[i] = pack; else list.push(pack);
      return set('packs:' + user, list).then(function () { return pack; });
    });
  }
  function deletePack(user, id) {
    return packs(user).then(function (list) {
      var out = list.filter(function (p) { return p.id !== id; });
      return set('packs:' + user, out).then(function () { return out; });
    });
  }

  global.Store = {
    ready: ready,
    get: get, set: set, del: del,
    signup: signup, login: login, currentUser: currentUser, logout: logout,
    packs: packs, savePack: savePack, deletePack: deletePack,
    usingIDB: function () { return useIDB; }
  };
})(window);
