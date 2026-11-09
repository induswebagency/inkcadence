# Hosted SaaS mode

Set `DEPLOY_MODE=saas` on the API. Same codebase as self-host; billing, stricter cookies/CORS, and quotas turn on.

## Required env

| Variable | Purpose |
|---|---|
| `DEPLOY_MODE=saas` | Enable SaaS behaviours |
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | Rate limits + job keys |
| `CORS_ORIGIN` | App origins only |
| `APP_ORIGIN` | Stripe + email links |
| `COOKIE_SECURE=1` | Secure cookies |
| `STRIPE_SECRET_KEY` | Billing |
| `STRIPE_WEBHOOK_SECRET` | `/api/billing/webhook` |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM` | Price IDs |
| `SMTP_URL` | Verification + password reset |
| `ML_URL` | Always-on ML workers recommended |
| `ADMIN_USERS` | Comma-separated usernames for `/api/admin` |
| `FORCE_WATERMARK` | Default on for SaaS exports |

## Features gated by SaaS

- Stripe Checkout + Customer Portal (`/api/billing/checkout`, `/portal`)
- Plan limits via `users.plan` (`free` / `pro` / `team`)
- Email verification + password reset hooks
- Marketing (`#/`) vs app (`#/app`) split in the Vite UI
- OpenTelemetry hook via `OTEL_EXPORTER_OTLP_ENDPOINT`
- AI-assisted handwriting disclosure enforced for exports

## Object storage

Compose profile `saas` starts MinIO for local prod-like object storage. Wire `S3_*` style env vars in your host for production sample uploads used only for consented neural fine-tunes.
