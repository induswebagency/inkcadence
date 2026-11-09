'use strict';

const express = require('express');
const db = require('./db');
const { requireUser, requireAdmin } = require('./auth');

const router = express.Router();

router.use(requireUser, requireAdmin);

router.get('/overview', async (_req, res, next) => {
  try {
    const users = await db.one('SELECT COUNT(*) AS n FROM users');
    const packs = await db.one('SELECT COUNT(*) AS n FROM style_packs');
    const jobs = await db.one(
      "SELECT COUNT(*) AS n FROM ml_jobs WHERE status IN ('queued','running')"
    );
    users.n = Number(users.n);
    packs.n = Number(packs.n);
    jobs.n = Number(jobs.n);
    const recentUsers = await db.query(
      'SELECT id, username, plan, created_at FROM users ORDER BY created_at DESC LIMIT 20'
    );
    const recentJobs = await db.query(
      'SELECT id, pack_id, user_id, status, error, created_at, updated_at' +
      ' FROM ml_jobs ORDER BY created_at DESC LIMIT 20'
    );
    res.json({
      users: users.n,
      packs: packs.n,
      activeJobs: jobs.n,
      recentUsers: recentUsers.rows,
      recentJobs: recentJobs.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
