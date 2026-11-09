'use strict';

// Serverless entry point for Vercel. Vercel serves the HTML, CSS and JS from the
// CDN itself; this function only ever sees /api/*.
//
// Long-lived connections are a bad fit for serverless, so keep PG_POOL_MAX small
// (1-2) and put a pooled endpoint (Neon, Supabase pooler) in DATABASE_URL.
const { createApp } = require('../server/app');

module.exports = createApp();
