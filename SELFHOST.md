# Self-host Inkcadence

One codebase, `DEPLOY_MODE=selfhost` (default). Classical handwriting always works offline; the API adds accounts and style-pack sync.

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d --build
# API: http://localhost:8080
# Optional ML: docker compose --profile ml up -d --build
```

Postgres data persists in the `pgdata` volume. Redis is included for shared rate limits.

## Dev without Docker

```bash
npm install
npm run dev          # API + in-memory DB on http://127.0.0.1:8080
npm install --prefix web && npm run dev --prefix web   # Vite on :5173 (proxies /api)
```

Point `web/src/lib/config.js` `apiBase` at `http://127.0.0.1:8080` when the Vite app is not same-origin, or leave empty for local-only classical.

## Production checklist

- [ ] `DATABASE_URL` on managed Postgres (Neon, RDS, …)
- [ ] `REDIS_URL` for multi-instance rate limits
- [ ] `CORS_ORIGIN` / `APP_ORIGIN` for your domain
- [ ] `COOKIE_SECURE=1` behind HTTPS
- [ ] `MAX_PACKS_PER_USER`
- [ ] Optional: `SMTP_URL` for password reset / email verify
- [ ] Optional: `ML_URL` + compose `--profile ml`
- [ ] Build web: `npm run build --prefix web` (Express serves `web/dist` when present)
- [ ] GitHub Pages static fallback still works from repo root `index.html` + `js/`

## Security notes

- Source photos are **not** stored server-side — only style pack JSON.
- Session tokens are hashed at rest; passwords use scrypt.
- `/api/health` reports `db`, `redis`, and `ml` readiness.
