'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const auth = require('./auth');
const packs = require('./packs');
const billing = require('./billing');
const admin = require('./admin');
const internal = require('./internal');
const { ApiError } = require('./validate');
const db = require('./db');
const { requestLogger, log } = require('./log');
const { pingRedis } = require('./redis');
const { pingMl } = require('./ml-client');
const { isSaas } = require('./plans');
const { initObservability, trackMetric } = require('./observability');

const ROOT = path.join(__dirname, '..');
const WEB_DIST = path.join(ROOT, 'web', 'dist');
const hasWebDist = fs.existsSync(path.join(WEB_DIST, 'index.html'));

// Only these directories are ever served from the project root (static Pages fallback).
const PUBLIC_DIRS = ['js', 'assets'];
const PUBLIC_FILES = [
  'index.html', 'sheet.html', 'robots.txt', 'llms.txt',
  'SELFHOST.md', 'SAAS.md', 'ML.md', 'DEPLOY.md', 'BACKEND.md', 'README.md',
];

function createApp() {
  initObservability();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));

  app.use(requestLogger);

  const allowedOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // SaaS defaults to stricter CORS — only listed origins.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Mode, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    } else if (origin && !isSaas() && allowedOrigins.length === 0) {
      // Self-host with empty CORS_ORIGIN: echo same-origin tools carefully — deny cross-origin.
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isSaas() || process.env.COOKIE_SECURE === '1') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    // Basic CSP for HTML responses; API JSON is unaffected.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self' " +
        (process.env.ML_URL || '') + ';'
    );
    next();
  });

  // Stripe webhooks need the raw body for signature verification.
  app.post(
    '/api/billing/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req, res, next) => {
      req.rawBody = req.body;
      billing.handleWebhook(req, res).catch(next);
    }
  );

  app.use(express.json({
    limit: process.env.BODY_LIMIT || '5mb',
    verify: (req, _res, buf) => {
      // Keep a copy for webhook-style consumers if needed later.
      req.rawBody = buf;
    },
  }));

  app.get('/api/health', async (_req, res) => {
    let dbStatus = 'down';
    try {
      await db.query('SELECT 1');
      dbStatus = 'up';
    } catch (err) {
      dbStatus = 'down';
      log('error', 'health.db', { error: err.message });
    }

    const redis = await pingRedis();
    const ml = await pingMl();
    const ok = dbStatus === 'up';
    const payload = {
      ok,
      db: dbStatus,
      redis: redis.status,
      ml: ml.status,
      deployMode: isSaas() ? 'saas' : 'selfhost',
      web: hasWebDist ? 'vite' : 'static',
      time: new Date().toISOString(),
    };
    trackMetric('health.check', ok ? 1 : 0, { db: dbStatus, redis: redis.status, ml: ml.status });
    res.status(ok ? 200 : 503).json(payload);
  });

  app.use('/api', auth.attachUser);
  app.use('/api/auth', auth.router);
  app.use('/api/packs', auth.requireUser, packs.router);
  app.use('/api/billing', billing.router);
  app.use('/api/admin', admin.router);
  app.use('/api/internal', internal.router);

  app.get('/api/legal/disclosure', (_req, res) => {
    res.json({
      watermarkRequired: isSaas() ? process.env.FORCE_WATERMARK !== '0' : false,
      text: 'Pages generated with Inkcadence may include AI-assisted handwriting. Do not use outputs to forge signatures, certificates, or official documents.',
    });
  });

  if (hasWebDist) {
    app.use(express.static(WEB_DIST, { maxAge: '1h', index: false }));
    // Marketing + SPA fallback for Vite build.
    app.get(['/app', '/app/*', '/pricing', '/legal', '/legal/*'], (_req, res) => {
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  for (const dir of PUBLIC_DIRS) {
    app.use('/' + dir, express.static(path.join(ROOT, dir), { maxAge: '1h', index: false }));
  }

  for (const file of PUBLIC_FILES) {
    app.get('/' + file, (_req, res) => res.sendFile(path.join(ROOT, file)));
  }

  app.get('/', (_req, res) => {
    if (hasWebDist) return res.sendFile(path.join(WEB_DIST, 'index.html'));
    return res.sendFile(path.join(ROOT, 'index.html'));
  });

  app.all('/api/*', (_req, _res, next) => {
    next(new ApiError(404, 'not_found', 'No such endpoint.'));
  });

  app.use((_req, res) => {
    if (hasWebDist) return res.status(404).sendFile(path.join(WEB_DIST, 'index.html'));
    res.status(404).sendFile(path.join(ROOT, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) {
      log('error', 'request.error', {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        error: err.message,
      });
    }

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
