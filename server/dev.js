'use strict';

// `npm run dev` — the same server, backed by an in-memory database and bound to
// localhost. No Docker, no Postgres, no configuration. Useful for trying the app
// and for checking a change before deploying.
//
// Cross-platform on purpose: it sets the environment in JavaScript rather than
// in the npm script, because `VAR=x node ...` is not valid on Windows cmd.exe.

const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'memory';
process.env.PORT = process.env.PORT || '8080';
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.PG_POOL_MAX = '1';

require('./env').loadEnv(path.join(__dirname, '..', '.env'));

if (!/^memory/i.test(process.env.DATABASE_URL)) {
  console.log('[dev] DATABASE_URL is set, using it instead of the in-memory database.');
}

require('./index');
