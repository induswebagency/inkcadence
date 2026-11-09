'use strict';

const { log } = require('./log');

let client = null;
let ready = false;

function redisUrl() {
  return process.env.REDIS_URL || '';
}

async function getRedis() {
  const url = redisUrl();
  if (!url) return null;
  if (client && ready) return client;

  try {
    let Redis;
    try {
      Redis = require('ioredis');
    } catch {
      log('error', 'redis.missing_dep', { hint: 'npm install ioredis' });
      return null;
    }

    if (!client) {
      client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        lazyConnect: true,
      });
      client.on('error', (err) => log('error', 'redis.error', { error: err.message }));
    }

    if (client.status !== 'ready') {
      await client.connect();
    }
    ready = true;
    return client;
  } catch (err) {
    log('error', 'redis.unavailable', { error: err.message });
    ready = false;
    try { if (client) client.disconnect(); } catch { /* ignore */ }
    client = null;
    return null;
  }
}

async function pingRedis() {
  try {
    if (!redisUrl()) return { ok: false, status: 'disabled' };
    const r = await getRedis();
    if (!r) return { ok: false, status: 'down' };
    const pong = await r.ping();
    return { ok: pong === 'PONG', status: pong === 'PONG' ? 'up' : 'down' };
  } catch {
    return { ok: false, status: 'down' };
  }
}

async function closeRedis() {
  if (client) {
    try { await client.quit(); } catch { /* ignore */ }
    client = null;
    ready = false;
  }
}

module.exports = { getRedis, pingRedis, closeRedis, redisUrl };
