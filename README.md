<p align="center">
  <img src="assets/inkcadence-wordmark.svg" alt="Inkcadence — your hand, on every page" width="420">
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2f6fed">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-2f6fed">
  <img alt="Classical + Neural" src="https://img.shields.io/badge/writers-classical%20%2B%20neural-2f6fed">
  <img alt="Self-host + SaaS" src="https://img.shields.io/badge/deploy-selfhost%20%7C%20saas-177d4f">
  <img alt="Privacy" src="https://img.shields.io/badge/photos-stay%20on%20device-177d4f">
</p>

<h1 align="center">Inkcadence</h1>

<p align="center">
  <a href="https://mafzalkalwardev.github.io/inkcadence/"><b>▶ Live site</b></a>
  &nbsp;·&nbsp;
  <a href="https://mafzalkalwardev.github.io/inkcadence/classic/"><b>Classic writer</b></a>
  &nbsp;·&nbsp;
  <a href="https://mafzalkalwardev.github.io/inkcadence/app/#/"><b>Vite app</b></a>
  &nbsp;·&nbsp;
  <a href="SELFHOST.md">Self-host</a>
  &nbsp;·&nbsp;
  <a href="SAAS.md">SaaS</a>
  &nbsp;·&nbsp;
  <a href="ML.md">ML</a>
</p>

> **Inkcadence learns your handwriting from full written assignments** — no alphabet sheet required. Ten built-in hands, letter-crop harvest, lined or blank A4, PNG/PDF export. Classical by default; optional neural when ML is hosted. Light and dark themes.

## See it work

The walkthrough below is the **classic writer**: upload assignment pages, analyze the pack, then render a lined A4 page (zoomed so the hand stays readable).

<p align="center">
  <img src="docs/media/working.gif" alt="Inkcadence walkthrough: upload assignment pages, learn the hand, then render a clear lined A4 page" width="880">
</p>

### Light and dark

| Light | Dark |
| --- | --- |
| <img src="docs/media/home-light.jpg" alt="Home, light theme" width="420"> | <img src="docs/media/home-dark.jpg" alt="Home, dark theme" width="420"> |
| <img src="docs/media/write-result-light.jpg" alt="Rendered page in the light theme" width="420"> | <img src="docs/media/write-result-dark.jpg" alt="Rendered page in the dark theme" width="420"> |

<img src="docs/media/result-page.jpg" alt="The rendered ruled page: Week 3 notes and three handwritten lines" width="420">

### Product workflow

<img src="docs/media/workflow-product.svg" alt="Workflow: assignment, match style, harvest, style pack, write, export" width="880">

| Assignment pages | Learned pack |
| --- | --- |
| <img src="docs/media/train-samples-light.jpg" alt="Assignment pages loaded in Train" width="420"> | <img src="docs/media/train-quality-light.jpg" alt="Learned patterns after analyze" width="420"> |
| **Write on lined A4** | **Page zoom** |
| <img src="docs/media/write-result-light.jpg" alt="Rendered lined page in Write" width="420"> | <img src="docs/media/result-page.jpg" alt="Zoomed handwritten A4" width="420"> |

### GitHub workflows

<img src="docs/media/workflow-ci.svg" alt="CI tests and builds images; Pages publishes the landing site and the app" width="880">

Pushing to `main` runs [CI](.github/workflows/ci.yml) and [Pages](.github/workflows/pages.yml) (this guide, screenshots, Vite app at `/app/`, classic writer at `/classic/`).

## Stack

| Package | Role |
|---|---|
| `web/` | Vite ES-module app (Train / Write / marketing) |
| `js/` | Classical engines + GitHub Pages static fallback |
| `server/` | Hardened Express + Postgres (+ Redis rate limits) |
| `ml/` | FastAPI personalization + infer (Compose `--profile ml`) |

Style packs remain the source of truth. Neural artifacts hang off the same pack (`model_status`, `model_uri`, `model_metrics`). Writer mode: `auto | classical | neural` with silent classical fallback.

## Quick start

**Static classical (no backend):** open `index.html` or `npx serve . -l 4173`.

**API + in-memory DB:**

```bash
npm install
npm run dev
```

**Vite UI (proxies `/api` → `:8080`):**

```bash
npm install --prefix web
npm run dev --prefix web
```

**Docker self-host (Postgres + Redis + API):**

```bash
cp .env.example .env
docker compose up -d --build
# optional neural: docker compose --profile ml up -d --build
```

## Tests

```bash
npm test          # API + frontend store + engine helpers
npm run lint
npm run build --prefix web
```

## Docs

- [`SELFHOST.md`](SELFHOST.md) — one-command deploy
- [`SAAS.md`](SAAS.md) — Stripe, email, quotas
- [`ML.md`](ML.md) — train / infer contract
- [`DEPLOY.md`](DEPLOY.md) — production checklist
- [`BACKEND.md`](BACKEND.md) — legacy API notes

## License

MIT
