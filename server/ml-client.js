'use strict';

const { log } = require('./log');

function mlBase() {
  return String(process.env.ML_URL || '').replace(/\/+$/, '');
}

async function pingMl() {
  const base = mlBase();
  if (!base) return { ok: false, status: 'disabled' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(base + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: 'down' };
    const body = await res.json().catch(() => ({}));
    return { ok: true, status: 'up', detail: body };
  } catch (err) {
    return { ok: false, status: 'down', error: err.message };
  }
}

async function enqueueTrain(payload) {
  const base = mlBase();
  if (!base) throw new Error('ML service is not configured (ML_URL).');
  const res = await fetch(base + '/train', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    log('error', 'ml.train_failed', { status: res.status, body: text.slice(0, 200) });
    throw new Error('ML train request failed (' + res.status + ')');
  }
  return res.json();
}

async function infer(payload) {
  const base = mlBase();
  if (!base) return null;
  try {
    const res = await fetch(base + '/infer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    log('error', 'ml.infer_failed', { error: err.message });
    return null;
  }
}

async function getModel(packId) {
  const base = mlBase();
  if (!base) return null;
  try {
    const res = await fetch(base + '/models/' + encodeURIComponent(packId));
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

module.exports = { mlBase, pingMl, enqueueTrain, infer, getModel };
