'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { ApiError, username, password, text } = require('./validate');
const { limiter } = require('./ratelimit');
const security = require('./security');
const mailer = require('./mailer');
const { isSaas } = require('./plans');

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
  if (process.env.COOKIE_SECURE === '1' || isSaas()) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

function clearSessionCookie(res) {
  const bits = [COOKIE + '=', 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.COOKIE_SECURE === '1' || isSaas()) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email || null,
    emailVerified: !!row.email_verified_at,
    plan: row.plan || 'free',
    createdAt: row.created_at,
  };
}

function appOrigin() {
  return String(process.env.APP_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:8080')
    .split(',')[0].trim().replace(/\/+$/, '');
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

  if (!asToken) setSessionCookie(res, token, maxAgeMs);
  return token;
}

async function attachUser(req, _res, next) {
  try {
    const token = readToken(req);
    if (!token) return next();

    const row = await db.one(
      'SELECT u.id, u.username, u.display_name, u.email, u.email_verified_at, u.plan,' +
      ' u.stripe_customer_id, u.created_at, s.expires_at' +
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

function requireAdmin(req, _res, next) {
  const admins = String(process.env.ADMIN_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!req.user || !admins.includes(String(req.user.username || '').toLowerCase())) {
    return next(new ApiError(403, 'forbidden', 'Admin access required.'));
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
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, 'email_invalid', 'That email address does not look valid.');
    }

    const existing = await db.one('SELECT id FROM users WHERE username = $1', [name]);
    if (existing) throw new ApiError(409, 'username_taken', 'That username is already taken.');

    if (email) {
      const taken = await db.one('SELECT id FROM users WHERE lower(email) = $1', [email]);
      if (taken) throw new ApiError(409, 'email_taken', 'That email is already registered.');
    }

    const hash = await security.hashPassword(secret);
    const verifyToken = email ? security.newSessionToken() : null;
    const row = await db.one(
      'INSERT INTO users (id, username, display_name, password_hash, email, verify_token_hash, plan)' +
      ' VALUES ($1, $2, $3, $4, $5, $6, $7)' +
      ' RETURNING id, username, display_name, email, email_verified_at, plan, created_at',
      [
        security.newId(),
        name,
        display,
        hash,
        email,
        verifyToken ? security.hashToken(verifyToken) : null,
        'free',
      ]
    );

    if (email && verifyToken) {
      const link = appOrigin() + '/#/verify?token=' + encodeURIComponent(verifyToken);
      const mail = mailer.verificationEmail(name, link);
      await mailer.sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
    }

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

router.post('/request-password-reset', limiter(5, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    // Always succeed to avoid account enumeration.
    if (email) {
      const row = await db.one('SELECT id, username, email FROM users WHERE lower(email) = $1', [email]);
      if (row) {
        const token = security.newSessionToken();
        await db.query(
          'UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3',
          [security.hashToken(token), new Date(Date.now() + 60 * 60 * 1000), row.id]
        );
        const link = appOrigin() + '/#/reset?token=' + encodeURIComponent(token);
        const mail = mailer.resetEmail(row.username, link);
        await mailer.sendMail({ to: row.email, subject: mail.subject, text: mail.text, html: mail.html });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', limiter(10, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const token = String((req.body && req.body.token) || '');
    const secret = password((req.body && req.body.password) || '');
    if (!token) throw new ApiError(400, 'token_required', 'A reset token is required.');

    const row = await db.one(
      'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires_at > now()',
      [security.hashToken(token)]
    );
    if (!row) throw new ApiError(400, 'token_invalid', 'That reset link is invalid or expired.');

    const hash = await security.hashPassword(secret);
    await db.query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $2',
      [hash, row.id]
    );
    await db.query('DELETE FROM sessions WHERE user_id = $1', [row.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-email', limiter(20, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const token = String((req.body && req.body.token) || '');
    if (!token) throw new ApiError(400, 'token_required', 'A verification token is required.');
    const row = await db.one(
      'SELECT id FROM users WHERE verify_token_hash = $1',
      [security.hashToken(token)]
    );
    if (!row) throw new ApiError(400, 'token_invalid', 'That verification link is invalid.');
    await db.query(
      'UPDATE users SET email_verified_at = now(), verify_token_hash = NULL WHERE id = $1',
      [row.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = {
  router,
  attachUser,
  requireUser,
  requireAdmin,
  publicUser,
  COOKIE,
  readToken,
};
