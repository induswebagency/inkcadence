'use strict';

const express = require('express');
const db = require('./db');
const { ApiError, username, password, text } = require('./validate');
const { limiter } = require('./ratelimit');
const security = require('./security');

const COOKIE = 'inkcadence_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// A cross-origin page (GitHub Pages calling a VPS API) cannot rely on cookies:
// SameSite would have to be None and browsers are phasing third-party cookies out.
// So the same opaque token can also travel as `Authorization: Bearer`.
function readToken(req) {
  const cookie = readCookie(req, COOKIE);
  if (cookie) return cookie;

  const header = req.headers.authorization;
  if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '').trim() || null;
  }
  return null;
}

function wantsToken(req) {
  return String(req.headers['x-session-mode'] || '').toLowerCase() === 'token';
}

function setSessionCookie(res, token, maxAgeMs) {
  const bits = [
    COOKIE + '=' + encodeURIComponent(token),
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(maxAgeMs / 1000),
  ];
  if (process.env.COOKIE_SECURE === '1') bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

function clearSessionCookie(res) {
  const bits = [COOKIE + '=', 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.COOKIE_SECURE === '1') bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

async function createSession(res, userId, req, asToken) {
  const token = security.newSessionToken();
  const days = Number.isFinite(SESSION_DAYS) && SESSION_DAYS > 0 ? SESSION_DAYS : 30;
  const maxAgeMs = days * 24 * 60 * 60 * 1000;

  await db.query(
    'INSERT INTO sessions (token_hash, user_id, user_agent, expires_at)' +
    ' VALUES ($1, $2, $3, $4)',
    [
      security.hashToken(token),
      userId,
      String(req.headers['user-agent'] || '').slice(0, 300),
      new Date(Date.now() + maxAgeMs),
    ]
  );

  // In token mode the client keeps the token and sends it as a header, so no
  // cookie is set. In cookie mode the token never leaves the server.
  if (!asToken) setSessionCookie(res, token, maxAgeMs);

  return token;
}

// Attaches req.user when a valid session cookie is present. Never rejects on its own.
async function attachUser(req, _res, next) {
  try {
    const token = readToken(req);
    if (!token) return next();

    const row = await db.one(
      'SELECT u.id, u.username, u.display_name, u.created_at, s.expires_at' +
      '  FROM sessions s JOIN users u ON u.id = s.user_id' +
      ' WHERE s.token_hash = $1',
      [security.hashToken(token)]
    );

    if (!row) return next();

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [security.hashToken(token)]);
      return next();
    }

    req.user = row;
    next();
  } catch (err) {
    next(err);
  }
}

function requireUser(req, _res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'not_signed_in', 'Sign in to use style packs.'));
  }
  next();
}

const router = express.Router();

router.post('/signup', limiter(10, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = username(body.username);
    const secret = password(body.password);
    const display = body.displayName ? text(body.displayName, 'displayName', { max: 60 }) : name;

    const existing = await db.one('SELECT id FROM users WHERE username = $1', [name]);
    if (existing) throw new ApiError(409, 'username_taken', 'That username is already taken.');

    const hash = await security.hashPassword(secret);
    const row = await db.one(
      'INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, $2, $3, $4)' +
      ' RETURNING id, username, display_name, created_at',
      [security.newId(), name, display, hash]
    );

    const asToken = wantsToken(req);
    const token = await createSession(res, row.id, req, asToken);
    const payload = { user: publicUser(row) };
    if (asToken) payload.token = token;
    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/login', limiter(10, 15 * 60 * 1000), async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.username || '').trim().toLowerCase();
    const secret = typeof body.password === 'string' ? body.password : '';

    const row = await db.one('SELECT * FROM users WHERE username = $1', [name]);

    // Same message and comparable work whether the user exists or not.
    const ok = row ? await security.verifyPassword(secret, row.password_hash) : false;
    if (!ok) {
      if (!row) await security.hashPassword(secret || 'x');
      throw new ApiError(401, 'bad_credentials', 'That username and password do not match.');
    }

    const asToken = wantsToken(req);
    const token = await createSession(res, row.id, req, asToken);
    const payload = { user: publicUser(row) };
    if (asToken) payload.token = token;
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = readToken(req);
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [security.hashToken(token)]);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(200).json({ user: null });
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, attachUser, requireUser, publicUser, COOKIE };
