'use strict';

const express = require('express');
const db = require('./db');
const { ApiError } = require('./validate');
const { log } = require('./log');

const router = express.Router();

// ML worker callback — protected by shared secret, not user sessions.
router.post('/ml-callback', async (req, res, next) => {
  try {
    const secret = process.env.ML_CALLBACK_SECRET || '';
    const provided = req.headers['x-ml-secret'] || '';
    if (!secret || provided !== secret) {
      throw new ApiError(401, 'unauthorized', 'Invalid ML callback secret.');
    }

    const body = req.body || {};
    const packId = body.packId;
    const jobId = body.jobId;
    const status = body.status;
    if (!packId || !status) {
      throw new ApiError(400, 'bad_request', 'packId and status are required.');
    }

    if (status === 'ready') {
      await db.query(
        'UPDATE style_packs SET model_status = $1, model_uri = $2, model_metrics = $3, updated_at = now() WHERE id = $4',
        ['ready', body.modelUri || null, JSON.stringify(body.metrics || {}), packId]
      );
    } else if (status === 'failed' || status === 'running' || status === 'queued') {
      await db.query(
        'UPDATE style_packs SET model_status = $1, updated_at = now() WHERE id = $2',
        [status, packId]
      );
    }

    if (jobId) {
      await db.query(
        'UPDATE ml_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3',
        [status, body.error || null, jobId]
      );
    }

    log('info', 'ml.callback', { packId, jobId, status });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
