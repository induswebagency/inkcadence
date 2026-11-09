'use strict';

const { ApiError } = require('./validate');
const { getRedis, redisUrl } = require('./redis');

// Sliding-window limiter. Uses Redis when REDIS_URL is set; otherwise process memory.
const buckets = new Map();

function hitMemory(key, limit, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let stamps = buckets.get(key);

  if (!stamps) {
    stamps = [];
    buckets.set(key, stamps);
  }

  while (stamps.length && stamps[0] <= cutoff) stamps.shift();

  if (stamps.length >= limit) {
    const retryAfter = Math.ceil((stamps[0] + windowMs - now) / 1000);
    const err = new ApiError(429, 'rate_limited', 'Too many attempts. Try again in ' + retryAfter + 's.');
    err.retryAfter = retryAfter;
    throw err;
  }

  stamps.push(now);
}

async function hitRedis(key, limit, windowMs) {
  const redis = await getRedis();
  if (!redis) {
    hitMemory(key, limit, windowMs);
    return;
  }

  const now = Date.now();
  const redisKey = 'rl:' + key;
  const multi = redis.multi();
  multi.zremrangebyscore(redisKey, 0, now - windowMs);
  multi.zcard(redisKey);
  multi.zadd(redisKey, now, String(now) + ':' + Math.random());
  multi.pexpire(redisKey, windowMs);
  const results = await multi.exec();
  const count = results && results[1] ? Number(results[1][1]) : 0;

  if (count >= limit) {
    const retryAfter = Math.ceil(windowMs / 1000);
    const err = new ApiError(429, 'rate_limited', 'Too many attempts. Try again in ' + retryAfter + 's.');
    err.retryAfter = retryAfter;
    throw err;
  }
}

async function hit(key, limit, windowMs) {
  if (redisUrl()) {
    await hitRedis(key, limit, windowMs);
  } else {
    hitMemory(key, limit, windowMs);
  }
}

const sweeper = setInterval(() => {
  const cutoff = Date.now() - 15 * 60000;
  for (const entry of buckets) {
    const stamps = entry[1];
    while (stamps.length && stamps[0] <= cutoff) stamps.shift();
    if (!stamps.length) buckets.delete(entry[0]);
  }
}, 5 * 60000);
if (sweeper.unref) sweeper.unref();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function limiter(limit, windowMs) {
  return function (req, _res, next) {
    hit(req.method + ':' + req.baseUrl + req.path + ':' + clientIp(req), limit, windowMs)
      .then(() => next())
      .catch((err) => next(err));
  };
}

module.exports = { limiter, clientIp, hit };
