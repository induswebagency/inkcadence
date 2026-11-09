# Neural handwriting service

The `ml/` FastAPI service personalizes a **lightweight style embedding** per pack on top of classical glyphs/stats. It does **not** train a giant foundation model.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Readiness |
| `POST` | `/train` | Queue per-pack fine-tune (`jobId`, `packId`, glyphs, stats) |
| `GET` | `/models/:packId` | Model status / URI / metrics |
| `POST` | `/infer` | Text → PNG data URLs (or `{fallback:true}`) |

## Node integration

1. Client or API calls `POST /api/packs/:id/train-model`
2. Node sets `model_status=queued` and POSTs to `ML_URL/train`
3. ML callbacks `POST /api/internal/ml-callback` with `X-ML-Secret`
4. Write view uses `renderMode: auto|classical|neural`
5. If ML is down or not ready → **silent classical fallback**

## Run locally

```bash
docker compose --profile ml up -d --build
# or
cd ml && pip install -r requirements.txt && uvicorn app:APP --port 8090
```

Optional: `pip install torch` for the tiny PyTorch personalization path. Without torch, embedding-v1 still produces a ready checkpoint.

## Self-host vs SaaS

- Self-host: opt in with Compose `--profile ml`
- SaaS: run ML workers continuously beside the API
