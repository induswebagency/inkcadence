'use strict';

const { ApiError } = require('./validate');

// Sliding-window limiter held in process memory.
//
// Fine for a single VPS process and for one serverless instance, but it is
// per-process: behind several workers the effective limit multiplies. If this
// ever needs to be exact, move the counters into Postgres or Redis.
const buckets = new Map();

function hit(key, limit, windowMs) {
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

// Keeps the map from growing without bound on a long-lived process.
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
    try {
      hit(req.method + ':' + req.baseUrl + req.path + ':' + clientIp(req), limit, windowMs);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { limiter, clientIp, hit };
