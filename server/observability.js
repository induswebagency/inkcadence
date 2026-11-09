'use strict';

const { log } = require('./log');

let otelStarted = false;

function initObservability() {
  if (otelStarted) return;
  otelStarted = true;

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    log('info', 'otel.configured', {
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      note: 'Set OTEL SDK auto-instrumentation in production deploy if desired.',
    });
  }

  process.on('uncaughtException', (err) => {
    log('error', 'uncaughtException', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (err) => {
    log('error', 'unhandledRejection', {
      error: err && err.message ? err.message : String(err),
    });
  });
}

function trackMetric(name, value, tags) {
  log('info', 'metric', Object.assign({ name: name, value: value }, tags || {}));
}

module.exports = { initObservability, trackMetric };
