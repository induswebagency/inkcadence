'use strict';

// Long-running entry point: used on a VPS, in Docker, and by Render/Railway/Fly.
const path = require('path');
const { loadEnv } = require('./env');

loadEnv(path.join(__dirname, '..', '.env'));

const { createApp } = require('./app');
const { pool } = require('./db');
const { migrate } = require('./migrate');

const port = Number(process.env.PORT || 8080);
// Dev mode binds to loopback so the server is not exposed on the local network.
// A real deployment listens on all interfaces and sits behind a reverse proxy.
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

async function main() {
  try {
    await migrate();
  } catch (err) {
    console.error('[startup] database not ready:', err.message);
    process.exit(1);
  }

  const server = app.listen(port, host, () => {
    console.log('Inkcadence listening on http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port);
    console.log('  health: http://localhost:' + port + '/api/health');
  });

  function shutdown(signal) {
    console.log('[' + signal + '] shutting down');
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
