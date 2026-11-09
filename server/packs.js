'use strict';

const express = require('express');
const db = require('./db');
const { ApiError, text, packData } = require('./validate');
const { limiter } = require('./ratelimit');
const { newId } = require('./security');

const router = express.Router();

// Every query is scoped by user_id. Ownership is never checked in JavaScript,
// so a guessed pack id cannot reach another account's row.
function shape(row) {
  return {
    id: row.id,
    name: row.name,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeSummary(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    // The app needs glyphs and palette to render, so it asks for ?include=data.
    const full = req.query.include === 'data';

    const { rows } = await db.query(
      'SELECT id, name, created_at, updated_at' + (full ? ', data' : '') +
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

    const row = await db.one(
      'INSERT INTO style_packs (id, user_id, name, data) VALUES ($1, $2, $3, $4)' +
      ' RETURNING id, name, data, created_at, updated_at',
      [newId(), req.user.id, name, JSON.stringify(data)]
    );

    res.status(201).json({ pack: shape(row) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.one(
      'SELECT id, name, data, created_at, updated_at FROM style_packs WHERE id = $1 AND user_id = $2',
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

    if (!sets.length) throw new ApiError(400, 'nothing_to_update', 'Send a name or a data field.');

    params.push(req.params.id, req.user.id);
    sets.push('updated_at = now()');

    const row = await db.one(
      'UPDATE style_packs SET ' + sets.join(', ') +
      ' WHERE id = $' + (params.length - 1) + ' AND user_id = $' + params.length +
      ' RETURNING id, name, data, created_at, updated_at',
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

module.exports = { router };
