'use strict';

// In-memory Postgres, for running the app locally with nothing installed.
//
// This is a development convenience only. The emulator implements the subset of
// SQL that Inkcadence uses, and everything is gone when the process exits. Real
// deployments talk to a real Postgres through server/db.js.
//
// It exists so `npm run dev` works on a fresh machine with no Docker and no
// database server, which makes the app easy to try and easy to demo.

let pool = null;

function createPool() {
  if (pool) return pool;

  let newDb;
  try {
    newDb = require('pg-mem').newDb;
  } catch (err) {
    console.error('');
    console.error('  pg-mem is not installed.');
    console.error('  Either run `npm install`, or set DATABASE_URL to a real Postgres.');
    console.error('');
    throw err;
  }

  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  pool = new adapter.Pool();

  console.warn('');
  console.warn('  ┌─────────────────────────────────────────────────────────────┐');
  console.warn('  │ IN-MEMORY DATABASE — development only                       │');
  console.warn('  │ Every account and style pack is lost when this stops.       │');
  console.warn('  │ For anything real, set DATABASE_URL to a Postgres server.   │');
  console.warn('  └─────────────────────────────────────────────────────────────┘');
  console.warn('');

  return pool;
}

module.exports = { createPool };
