'use strict';

const crypto = require('crypto');

function requestId() {
  return crypto.randomBytes(8).toString('hex');
}

function log(level, msg, fields) {
  const entry = Object.assign({
    ts: new Date().toISOString(),
    level: level,
    msg: msg,
  }, fields || {});
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.log(line);
}

function requestLogger(req, res, next) {
  const id = req.headers['x-request-id'] || requestId();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  const started = Date.now();
  res.on('finish', () => {
    log('info', 'request', {
      requestId: id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - started,
      ip: req.ip,
    });
  });
  next();
}

module.exports = { log, requestLogger, requestId };
