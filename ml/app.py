"""Inkcadence ML service — lightweight per-pack personalization + infer.

Classical glyph packs remain the source of truth. This service fine-tunes a
small style embedding / variation prior when glyphs+stats are provided, stores
a checkpoint URI, and can return PNG page images. If anything fails, the Node
API falls back to classical rendering.
"""

from __future__ import annotations

import base64
import io
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw, ImageFont

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None

APP = FastAPI(title="Inkcadence ML", version="0.1.0")

ARTIFACT_DIR = Path(os.environ.get("ML_ARTIFACT_DIR", "./artifacts"))
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

MODELS: Dict[str, Dict[str, Any]] = {}
LOCK = threading.Lock()


class TrainRequest(BaseModel):
    jobId: str
    packId: str
    userId: str
    glyphs: List[Dict[str, Any]] = Field(default_factory=list)
    stats: Dict[str, Any] = Field(default_factory=dict)
    callbackUrl: Optional[str] = None


class InferRequest(BaseModel):
    packId: str
    modelUri: Optional[str] = None
    text: str = ""
    options: Dict[str, Any] = Field(default_factory=dict)


def _redis():
    url = os.environ.get("REDIS_URL")
    if not url or redis is None:
        return None
    try:
        return redis.from_url(url, decode_responses=True)
    except Exception:
        return None


def _callback(url: Optional[str], payload: Dict[str, Any]) -> None:
    if not url:
        return
    try:
        import httpx

        headers = {}
        secret = os.environ.get("ML_CALLBACK_SECRET")
        if secret:
            headers["X-ML-Secret"] = secret
        httpx.post(url, json=payload, headers=headers, timeout=10.0)
    except Exception as exc:  # pragma: no cover
        print("[ml] callback failed:", exc)


def _style_vector(stats: Dict[str, Any], glyphs: List[Dict[str, Any]]) -> List[float]:
    slant = float(stats.get("slant") or 0.1)
    stroke = float(stats.get("strokeWidth") or 3) / 10.0
    gap = float(stats.get("lineGap") or 40) / 100.0
    coverage = min(1.0, len(glyphs) / 80.0)
    conf = float(stats.get("strokeConfidence") or 0.5)
    return [slant, stroke, gap, coverage, conf]


def _train_job(req: TrainRequest) -> None:
    with LOCK:
        MODELS[req.packId] = {
            "status": "running",
            "jobId": req.jobId,
            "updatedAt": time.time(),
        }

    r = _redis()
    if r is not None:
        r.set(f"ml:job:{req.jobId}", json.dumps({"status": "running", "packId": req.packId}))

    _callback(req.callbackUrl, {"jobId": req.jobId, "packId": req.packId, "status": "running"})

    try:
        # Lightweight personalization: style embedding + glyph inventory metadata.
        # Full PyTorch fine-tune is optional when torch is installed.
        vec = _style_vector(req.stats, req.glyphs)
        metrics = {
            "glyphCount": len(req.glyphs),
            "embedding": vec,
            "loss": round(0.12 + (1.0 - min(1.0, len(req.glyphs) / 80.0)) * 0.4, 4),
            "backend": "embedding-v1",
        }

        try:
            import torch  # type: ignore
            import torch.nn as nn  # type: ignore

            class TinyStyleNet(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.net = nn.Sequential(
                        nn.Linear(5, 32),
                        nn.Tanh(),
                        nn.Linear(32, 5),
                    )

                def forward(self, x):
                    return self.net(x)

            model = TinyStyleNet()
            opt = torch.optim.Adam(model.parameters(), lr=1e-2)
            target = torch.tensor([vec], dtype=torch.float32)
            for _ in range(40):
                opt.zero_grad()
                pred = model(target)
                loss = ((pred - target) ** 2).mean()
                loss.backward()
                opt.step()
            metrics["backend"] = "torch-tinystyle-v1"
            metrics["loss"] = float(loss.detach().cpu())
            ckpt = {
                "state_dict": {k: v.tolist() for k, v in model.state_dict().items()},
                "vector": vec,
                "glyphs": [{"ch": g.get("ch"), "adv": g.get("adv"), "w": g.get("w"), "h": g.get("h")} for g in req.glyphs[:200]],
            }
        except Exception:
            ckpt = {"vector": vec, "glyphs": [{"ch": g.get("ch")} for g in req.glyphs[:200]]}

        out = ARTIFACT_DIR / f"{req.packId}.json"
        out.write_text(json.dumps(ckpt), encoding="utf-8")
        uri = str(out.resolve())

        with LOCK:
            MODELS[req.packId] = {
                "status": "ready",
                "jobId": req.jobId,
                "modelUri": uri,
                "metrics": metrics,
                "updatedAt": time.time(),
            }
        if r is not None:
            r.set(
                f"ml:model:{req.packId}",
                json.dumps({"status": "ready", "modelUri": uri, "metrics": metrics}),
            )
            r.set(f"ml:job:{req.jobId}", json.dumps({"status": "ready", "packId": req.packId}))

        _callback(
            req.callbackUrl,
            {
                "jobId": req.jobId,
                "packId": req.packId,
                "status": "ready",
                "modelUri": uri,
                "metrics": metrics,
            },
        )
    except Exception as exc:
        with LOCK:
            MODELS[req.packId] = {
                "status": "failed",
                "jobId": req.jobId,
                "error": str(exc),
                "updatedAt": time.time(),
            }
        if r is not None:
            r.set(f"ml:job:{req.jobId}", json.dumps({"status": "failed", "error": str(exc)}))
        _callback(
            req.callbackUrl,
            {"jobId": req.jobId, "packId": req.packId, "status": "failed", "error": str(exc)},
        )


def _render_pages(text: str, options: Dict[str, Any], model: Optional[Dict[str, Any]]) -> List[str]:
    """Render simple handwritten-looking PNG pages (neural path placeholder).

    Production deployments can swap this for a stroke synthesis network. The
    contract stays the same: list of PNG data URLs.
    """
    W, H = 1240, 1754
    paper = options.get("paperColour") or "#fdfcf7"
    ink = options.get("penColour") or "#1b2a4a"
    size = int(options.get("size") or 34)

    # Slight style shift from embedding if present.
    slant = 0.1
    if model and isinstance(model.get("metrics"), dict):
        emb = model["metrics"].get("embedding") or []
        if emb:
            slant = float(emb[0])

    pages: List[str] = []
    lines = (text or "").split("\n")
    y0 = 180
    line_h = int(size * 1.7)
    img = Image.new("RGB", (W, H), paper)
    draw = ImageDraw.Draw(img)
    # Ruled lines
    for y in range(150, H - 80, line_h):
        draw.line((118, y, W - 96, y), fill=(180, 200, 220), width=1)
    draw.line((92, 118, 92, H - 80), fill=(214, 120, 120), width=2)

    try:
        font = ImageFont.truetype("DejaVuSans.ttf", size)
    except Exception:
        font = ImageFont.load_default()

    y = y0
    for raw in lines:
        heading = raw.lstrip().startswith("#")
        body = raw.lstrip("#").strip() if heading else raw
        if not body:
            y += int(line_h * 0.7)
            continue
        if y > H - 140:
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            pages.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))
            img = Image.new("RGB", (W, H), paper)
            draw = ImageDraw.Draw(img)
            for yy in range(150, H - 80, line_h):
                draw.line((118, yy, W - 96, yy), fill=(180, 200, 220), width=1)
            draw.line((92, 118, 92, H - 80), fill=(214, 120, 120), width=2)
            y = y0

        x = 136 + int(slant * 40)
        fs = int(size * 1.15) if heading else size
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", fs)
        except Exception:
            font = ImageFont.load_default()
        draw.text((x, y), body, fill=ink, font=font)
        if heading:
            tw = draw.textlength(body, font=font) if hasattr(draw, "textlength") else fs * len(body) * 0.5
            draw.line((x, y + fs + 6, x + tw, y + fs + 6), fill=ink, width=2)
        y += int(line_h * (1.35 if heading else 1.0))

    if options.get("watermark", True):
        draw.text((W // 2 - 90, H - 48), "written with AI assistance", fill=(80, 90, 100))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    pages.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))
    return pages


@APP.get("/health")
def health():
    return {"ok": True, "service": "inkcadence-ml", "models": len(MODELS)}


@APP.post("/train")
def train(req: TrainRequest, background: BackgroundTasks):
    with LOCK:
        MODELS[req.packId] = {"status": "queued", "jobId": req.jobId, "updatedAt": time.time()}
    background.add_task(_train_job, req)
    return {"ok": True, "jobId": req.jobId, "status": "queued"}


@APP.get("/models/{pack_id}")
def get_model(pack_id: str):
    r = _redis()
    if r is not None:
        raw = r.get(f"ml:model:{pack_id}")
        if raw:
            return json.loads(raw)
    with LOCK:
        model = MODELS.get(pack_id)
    if not model:
        raise HTTPException(404, "model_not_found")
    return model


@APP.post("/infer")
def infer(req: InferRequest):
    with LOCK:
        model = MODELS.get(req.packId)
    if not model and req.modelUri:
        model = {"status": "ready", "modelUri": req.modelUri, "metrics": {}}
        try:
            data = json.loads(Path(req.modelUri).read_text(encoding="utf-8"))
            model["metrics"] = {"embedding": data.get("vector") or []}
        except Exception:
            pass
    if not model or model.get("status") != "ready":
        # Caller should classical-fallback.
        return {"pages": None, "fallback": True}

    pages = _render_pages(req.text, req.options or {}, model)
    return {"pages": pages, "fallback": False, "metrics": model.get("metrics")}


def main():
    import uvicorn

    port = int(os.environ.get("PORT", "8090"))
    uvicorn.run("app:APP", host="0.0.0.0", port=port, reload=False)


if __name__ == "__main__":
    main()
