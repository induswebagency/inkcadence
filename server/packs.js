'use strict';

const express = require('express');
const db = require('./db');
const { ApiError, text, packData } = require('./validate');
const { limiter } = require('./ratelimit');
const { newId } = require('./security');
const { planFor } = require('./plans');
const ml = require('./ml-client');
const { log } = require('./log');

const router = express.Router();

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    data: row.data,
    renderMode: row.render_mode || 'auto',
    modelStatus: row.model_status || 'none',
    modelUri: row.model_uri || null,
    modelMetrics: row.model_metrics || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeSummary(row) {
  return {
    id: row.id,
    name: row.name,
    renderMode: row.render_mode || 'auto',
    modelStatus: row.model_status || 'none',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const full = req.query.include === 'data';

    const { rows } = await db.query(
      'SELECT id, name, created_at, updated_at, render_mode, model_status, model_uri, model_metrics' +
      (full ? ', data' : '') +
      '  FROM style_packs WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200',
      [req.user.id]
    );

    res.json({ packs: rows.map(full ? shape : shapeSummary) });
  } catch (err) {
    next(err);
  }
});

router.post('/', limiter(120, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = text(body.name, 'name', { max: 80 });
    const data = packData(body.data);
    const limits = planFor(req.user);

    const countRow = await db.one(
      'SELECT COUNT(*) AS n FROM style_packs WHERE user_id = $1',
      [req.user.id]
    );
    const packCount = countRow ? Number(countRow.n) : 0;
    if (packCount >= limits.maxPacks) {
      throw new ApiError(403, 'pack_quota',
        'You have reached the pack limit for your plan (' + limits.maxPacks + ').');
    }

    const renderMode = ['auto', 'classical', 'neural'].includes(body.renderMode)
      ? body.renderMode
      : 'auto';

    const row = await db.one(
      'INSERT INTO style_packs (id, user_id, name, data, render_mode)' +
      ' VALUES ($1, $2, $3, $4, $5)' +
      ' RETURNING id, name, data, render_mode, model_status, model_uri, model_metrics, created_at, updated_at',
      [newId(), req.user.id, name, JSON.stringify(data), renderMode]
    );

    res.status(201).json({ pack: shape(row) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.one(
      'SELECT id, name, data, render_mode, model_status, model_uri, model_metrics, created_at, updated_at' +
      ' FROM style_packs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!row) throw new ApiError(404, 'pack_not_found', 'That style pack does not exist.');
    res.json({ pack: shape(row) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];

    if (body.name !== undefined) {
      params.push(text(body.name, 'name', { max: 80 }));
      sets.push('name = $' + params.length);
    }
    if (body.data !== undefined) {
      params.push(JSON.stringify(packData(body.data)));
      sets.push('data = $' + params.length);
    }
    if (body.renderMode !== undefined) {
      if (!['auto', 'classical', 'neural'].includes(body.renderMode)) {
        throw new ApiError(400, 'render_mode_invalid', 'renderMode must be auto, classical, or neural.');
      }
      params.push(body.renderMode);
      sets.push('render_mode = $' + params.length);
    }

    if (!sets.length) throw new ApiError(400, 'nothing_to_update', 'Send a name, data, or renderMode field.');

    params.push(req.params.id, req.user.id);
    sets.push('updated_at = now()');

    const row = await db.one(
      'UPDATE style_packs SET ' + sets.join(', ') +
      ' WHERE id = $' + (params.length - 1) + ' AND user_id = $' + params.length +
      ' RETURNING id, name, data, render_mode, model_status, model_uri, model_metrics, created_at, updated_at',
      params
    );

    if (!row) throw new ApiError(404, 'pack_not_found', 'That style pack does not exist.');
    res.json({ pack: shape(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await db.one(
      'DELETE FROM style_packs WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!row) throw new ApiError(404, 'pack_not_found', 'That style pack does not exist.');
    res.json({ ok: true, id: row.id });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/train-model', limiter(20, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const pack = await db.one(
      'SELECT id, name, data, model_status FROM style_packs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!pack) throw new ApiError(404, 'pack_not_found', 'That style pack does not exist.');

    const limits = planFor(req.user);
    if (limits.neuralTrainMinutes <= 0 && String(process.env.DEPLOY_MODE || '') === 'saas') {
      throw new ApiError(403, 'plan_required', 'Neural training requires a Pro plan or higher.');
    }

    const jobId = newId();
    await db.query(
      'INSERT INTO ml_jobs (id, pack_id, user_id, status) VALUES ($1, $2, $3, $4)',
      [jobId, pack.id, req.user.id, 'queued']
    );
    await db.query(
      'UPDATE style_packs SET model_status = $1, updated_at = now() WHERE id = $2',
      ['queued', pack.id]
    );

    // Fire-and-forget to ML service; classical path remains available.
    const payload = {
      jobId,
      packId: pack.id,
      userId: req.user.id,
      glyphs: (pack.data && pack.data.glyphs) || [],
      stats: (pack.data && pack.data.stats) || {},
      callbackUrl: (process.env.API_PUBLIC_URL || '') + '/api/internal/ml-callback',
    };

    ml.enqueueTrain(payload).catch(async (err) => {
      log('error', 'ml.enqueue_failed', { packId: pack.id, error: err.message });
      await db.query(
        'UPDATE style_packs SET model_status = $1, updated_at = now() WHERE id = $2',
        ['failed', pack.id]
      ).catch(() => {});
      await db.query(
        'UPDATE ml_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3',
        ['failed', err.message, jobId]
      ).catch(() => {});
    });

    res.status(202).json({ ok: true, jobId, modelStatus: 'queued' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/infer', limiter(60, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const pack = await db.one(
      'SELECT id, data, render_mode, model_status, model_uri FROM style_packs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!pack) throw new ApiError(404, 'pack_not_found', 'That style pack does not exist.');

    const mode = req.body && req.body.renderMode
      ? req.body.renderMode
      : (pack.render_mode || 'auto');

    const wantNeural = mode === 'neural' || (mode === 'auto' && pack.model_status === 'ready');
    if (!wantNeural) {
      return res.json({ mode: 'classical', pages: null, fallback: false });
    }

    const result = await ml.infer({
      packId: pack.id,
      modelUri: pack.model_uri,
      text: (req.body && req.body.text) || '',
      options: (req.body && req.body.options) || {},
    });

    if (!result || !result.pages) {
      // Silent classical fallback — client renders locally.
      return res.json({ mode: 'classical', pages: null, fallback: true });
    }

    res.json({ mode: 'neural', pages: result.pages, fallback: false, metrics: result.metrics || null });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, shape };
