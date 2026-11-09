# Production deploy checklist

## Shared

- [ ] Domain + TLS
- [ ] `DATABASE_URL` (Neon / Postgres) + run migrations (`npm run migrate`)
- [ ] `REDIS_URL`
- [ ] Build web assets (`npm run build --prefix web`)
- [ ] Set `CORS_ORIGIN` and `APP_ORIGIN`
- [ ] Confirm `/api/health` → `db: up`
- [ ] Smoke: signup → create pack → render

## Self-host

- [ ] Follow `SELFHOST.md`
- [ ] Optional ML profile
- [ ] Document operator backup of Postgres volume

## SaaS

- [ ] Follow `SAAS.md`
- [ ] Stripe products + webhook endpoint
- [ ] SMTP provider
- [ ] Object storage for consented fine-tune uploads
- [ ] Error tracking / OTEL endpoint
- [ ] Admin user listed in `ADMIN_USERS`

## Static Pages fallback

GitHub Pages can still serve root `index.html` + `js/` classical app with `apiBase` pointed at your API (token mode).
