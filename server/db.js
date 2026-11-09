'use strict';

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';
const useMemory = /^memory:?$/i.test(connectionString);

if (!connectionString) {
  console.error('[db] DATABASE_URL is not set.');
  console.error('[db] For a local demo run `npm run dev` (in-memory database).');
  console.error('[db] Otherwise copy .env.example to .env and point it at Postgres.');
}

// Managed Postgres (Neon, Supabase, Vercel, RDS) requires TLS. A local server does not.
const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(connectionString);
const wantsSsl = /sslmode=require/.test(connectionString) || !isLocal;

const pool = useMemory
  ? require('./memory-db').createPool()
  : new Pool({
      connectionString,
      ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

if (typeof pool.on === 'function') {
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
}

async function query(text, params) {
  const started = Date.now();
  const result = await pool.query(text, params);
  const ms = Date.now() - started;
  if (ms > 500) console.warn(`[db] slow query ${ms}ms: ${text.slice(0, 80)}`);
  return result;
}

async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

// Runs fn inside a transaction; rolls back on any throw.
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, one, transaction, close };
