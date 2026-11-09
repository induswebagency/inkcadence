'use strict';

const crypto = require('crypto');

// scrypt is in Node's standard library, so there is no native module to compile —
// which keeps the Vercel build simple. 128*N*r = 16 MB, inside Node's 32 MB default.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (err, key) => {
      if (err) return reject(err);
      resolve([
        'scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
        salt.toString('base64'),
        key.toString('base64'),
      ].join('$'));
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);

    const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
    let salt;
    let expected;
    try {
      salt = Buffer.from(parts[4], 'base64');
      expected = Buffer.from(parts[5], 'base64');
    } catch {
      return resolve(false);
    }
    if (!Number.isFinite(params.N) || expected.length === 0) return resolve(false);

    crypto.scrypt(password, salt, expected.length, params, (err, key) => {
      if (err) return resolve(false);
      resolve(key.length === expected.length && crypto.timingSafeEqual(key, expected));
    });
  });
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Only the hash is stored, so a database leak does not hand over live sessions.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newId() {
  return crypto.randomUUID();
}

module.exports = { hashPassword, verifyPassword, newSessionToken, hashToken, newId };
