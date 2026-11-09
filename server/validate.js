'use strict';

// Small hand-rolled validators. Throwing ApiError keeps route handlers free of if-chains.

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

function username(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) throw new ApiError(400, 'username_required', 'A username is required.');
  if (!USERNAME_RE.test(raw)) {
    throw new ApiError(400, 'username_invalid',
      'Usernames are 3-32 characters: letters, digits, dot, dash or underscore, starting and ending with a letter or digit.');
  }
  return raw;
}

function password(value) {
  const raw = typeof value === 'string' ? value : '';
  if (raw.length < 8) throw new ApiError(400, 'password_too_short', 'Passwords need at least 8 characters.');
  if (raw.length > 200) throw new ApiError(400, 'password_too_long', 'Passwords are capped at 200 characters.');
  return raw;
}

function text(value, field, options) {
  const opts = options || {};
  const min = opts.min === undefined ? 1 : opts.min;
  const max = opts.max === undefined ? 200 : opts.max;
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.length < min) throw new ApiError(400, field + '_required', field + ' is required.');
  if (raw.length > max) throw new ApiError(400, field + '_too_long', field + ' is capped at ' + max + ' characters.');
  return raw;
}

// Style pack payload: opaque to the server, but bounded so one client cannot fill the disk.
function packData(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'data_invalid', 'data must be a JSON object.');
  }
  if (JSON.stringify(value).length > 4000000) {
    throw new ApiError(413, 'data_too_large', 'That style pack is larger than 4 MB.');
  }
  return value;
}

module.exports = { ApiError, username, password, text, packData };
