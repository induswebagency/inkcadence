'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./env');

loadEnv(path.join(__dirname, '..', '.env'));

const { pool } = require('./db');

async function migrate() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
    '  name TEXT PRIMARY KEY,' +
    '  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()' +
    ')'
  );

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log('[migrate] already applied: ' + file);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('[migrate] applied: ' + file);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error('Migration ' + file + ' failed: ' + err.message);
    } finally {
      client.release();
    }
  }

  return files.length;
}

if (require.main === module) {
  migrate()
    .then((n) => {
      console.log('[migrate] done, ' + n + ' migration file(s) on disk');
      return pool.end();
    })
    .catch((err) => {
      console.error('[migrate] ' + err.message);
      process.exit(1);
    });
}

module.exports = { migrate };
