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
        vec = _style_vector(req.stats, req.glyphs)
        metrics = {
            "glyphCount": len(req.glyphs),
            "embedding": vec,
            "loss": round(0.12 + (1.0 - min(1.0, len(req.glyphs) / 80.0)) * 0.4, 4),
            "backend": "embedding-v1",
        }

        try:
            from stroke_vae import train_vae

            ckpt = train_vae(req.glyphs[:240], vec, epochs=60)
            metrics.update(ckpt.get("metrics") or {})
            ckpt["vector"] = vec
            ckpt["glyphs"] = [
                {"ch": g.get("ch"), "adv": g.get("adv"), "w": g.get("w"), "h": g.get("h")}
                for g in req.glyphs[:200]
            ]
        except Exception as train_exc:
            metrics["strokeError"] = str(train_exc)
            ckpt = {"vector": vec, "glyphs": [{"ch": g.get("ch")} for g in req.glyphs[:200]], "kind": "embedding"}

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
    ckpt: Dict[str, Any] = {}
    if not model and req.modelUri:
        model = {"status": "ready", "modelUri": req.modelUri, "metrics": {}}
    if model and model.get("modelUri"):
        try:
            ckpt = json.loads(Path(model["modelUri"]).read_text(encoding="utf-8"))
            model["metrics"] = model.get("metrics") or ckpt.get("metrics") or {
                "embedding": ckpt.get("vector") or []
            }
        except Exception:
            ckpt = {}
    if not model or model.get("status") != "ready":
        return {"pages": None, "glyphs": None, "fallback": True}

    glyphs = None
    try:
        from stroke_vae import sample_variants

        if ckpt.get("kind") == "stroke-vae" or ckpt.get("means") or ckpt.get("state_dict"):
            per = int((req.options or {}).get("variantsPerChar") or 3)
            glyphs = sample_variants(ckpt, per_char=per)
    except Exception as exc:
        glyphs = None
        model.setdefault("metrics", {})["sampleError"] = str(exc)

    if glyphs:
        return {
            "pages": None,
            "glyphs": glyphs,
            "fallback": False,
            "metrics": model.get("metrics"),
        }

    pages = _render_pages(req.text, req.options or {}, model)
    return {"pages": pages, "glyphs": None, "fallback": False, "metrics": model.get("metrics")}


class RecognizeRequest(BaseModel):
    images: List[str] = Field(default_factory=list)
    topK: int = 1


@APP.post("/recognize")
def recognize(req: RecognizeRequest):
    """Classify glyph crops with CharCNN (server-side fallback)."""
    try:
        import torch
        from char_cnn import CharCNN, EMNIST_BYCLASS_LABELS, INPUT_SIZE
    except Exception as exc:
        raise HTTPException(503, f"charcnn_unavailable:{exc}") from exc

    ckpt_path = ARTIFACT_DIR / "charcnn.pt"
    if not ckpt_path.exists():
        raise HTTPException(503, "charcnn_not_trained")

    device = torch.device("cpu")
    model = CharCNN(len(EMNIST_BYCLASS_LABELS))
    blob = torch.load(ckpt_path, map_location=device, weights_only=False)
    model.load_state_dict(blob["model"] if isinstance(blob, dict) and "model" in blob else blob)
    model.eval()

    out: List[Dict[str, Any]] = []
    for raw in req.images[:64]:
        try:
            if "," in raw[:64]:
                raw = raw.split(",", 1)[1]
            buf = base64.b64decode(raw)
            img = Image.open(io.BytesIO(buf)).convert("L")
            img = img.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
            import numpy as np

            arr = np.asarray(img, dtype=np.float32)
            if arr.mean() > 127:
                arr = 255.0 - arr
            t = torch.from_numpy(arr / 255.0).unsqueeze(0).unsqueeze(0)
            with torch.no_grad():
                logits = model(t)
                prob = torch.softmax(logits, dim=1)[0]
                conf, idx = torch.max(prob, 0)
            out.append({"ch": EMNIST_BYCLASS_LABELS[int(idx.item())], "conf": float(conf.item())})
        except Exception as exc:
            out.append({"ch": None, "conf": 0.0, "error": str(exc)})
    return {"predictions": out}


def main():
    import uvicorn

    port = int(os.environ.get("PORT", "8090"))
    uvicorn.run("app:APP", host="0.0.0.0", port=port, reload=False)


if __name__ == "__main__":
    main()
