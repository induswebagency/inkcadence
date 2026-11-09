'use strict';

const path = require('path');
const express = require('express');
const auth = require('./auth');
const packs = require('./packs');
const { ApiError } = require('./validate');
const db = require('./db');

const ROOT = path.join(__dirname, '..');

// Only these directories are ever served. Mounting the project root would expose
// server/, .env and .git.
const PUBLIC_DIRS = ['js', 'assets'];
const PUBLIC_FILES = ['index.html', 'sheet.html', 'robots.txt', 'llms.txt'];

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const allowedOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Mode');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, db: 'up', time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ ok: false, db: 'down', error: err.message });
    }
  });

  // Mounted on /api only, so static requests never pay for a session lookup.
  app.use('/api', auth.attachUser);

  app.use('/api/auth', auth.router);
  app.use('/api/packs', auth.requireUser, packs.router);

  for (const dir of PUBLIC_DIRS) {
    app.use('/' + dir, express.static(path.join(ROOT, dir), { maxAge: '1h', index: false }));
  }

  for (const file of PUBLIC_FILES) {
    app.get('/' + file, (_req, res) => res.sendFile(path.join(ROOT, file)));
  }

  app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

  app.all('/api/*', (_req, _res, next) => {
    next(new ApiError(404, 'not_found', 'No such endpoint.'));
  });

  app.use((_req, res) => {
    res.status(404).sendFile(path.join(ROOT, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[api] ' + req.method + ' ' + req.originalUrl + ' —', err.message);

    if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    res.status(status).json({
      error: {
        code: err.code || (status >= 500 ? 'internal_error' : 'bad_request'),
        message: status >= 500 ? 'Something went wrong on our side.' : err.message,
      },
    });
  });

  return app;
}

module.exports = { createApp };
