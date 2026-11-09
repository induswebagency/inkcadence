"""CharStrokeVAE — few-shot per-character ink-mask autoencoder for Inkcadence.

Trains on pack glyphs (and harvested crops) as 48x48 alpha masks, conditioned
on character id + a small style vector. Samples variants at infer time.
Falls back gracefully when torch is unavailable.
"""

from __future__ import annotations

import base64
import io
import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

SIZE = 48
LATENT = 24
CHAR_EMB = 16


def _decode_glyph_png(url: str) -> Optional[np.ndarray]:
    if not url:
        return None
    try:
        if "," in url:
            url = url.split(",", 1)[1]
        raw = base64.b64decode(url)
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im = im.resize((SIZE, SIZE), Image.BILINEAR)
        arr = np.asarray(im, dtype=np.float32)
        alpha = arr[:, :, 3] / 255.0
        return alpha
    except Exception:
        return None


def _encode_mask_png(mask: np.ndarray) -> str:
    mask = np.clip(mask, 0, 1)
    rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    rgba[:, :, :3] = 255
    rgba[:, :, 3] = (mask * 255).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _char_index(ch: str, table: List[str]) -> int:
    if ch in table:
        return table.index(ch)
    return 0


def build_charset(glyphs: List[Dict[str, Any]]) -> List[str]:
    seen = []
    for g in glyphs:
        ch = str(g.get("ch") or "")
        if ch and ch not in seen:
            seen.append(ch)
    if not seen:
        seen = list("abcdefghijklmnopqrstuvwxyz")
    return seen


def prepare_dataset(glyphs: List[Dict[str, Any]], charset: List[str]) -> Tuple[np.ndarray, np.ndarray]:
    xs, ys = [], []
    for g in glyphs:
        mask = _decode_glyph_png(g.get("url") or "")
        if mask is None:
            continue
        xs.append(mask.reshape(-1))
        ys.append(_char_index(str(g.get("ch") or ""), charset))
    if not xs:
        return np.zeros((0, SIZE * SIZE), dtype=np.float32), np.zeros((0,), dtype=np.int64)
    return np.stack(xs).astype(np.float32), np.asarray(ys, dtype=np.int64)


def train_vae(
    glyphs: List[Dict[str, Any]],
    style_vec: List[float],
    epochs: int = 80,
) -> Dict[str, Any]:
    charset = build_charset(glyphs)
    X, y = prepare_dataset(glyphs, charset)
    metrics: Dict[str, Any] = {
        "backend": "stroke-vae-numpy-v1",
        "glyphCount": int(len(X)),
        "charsetSize": len(charset),
        "loss": 1.0,
    }

    if len(X) < 4:
        return {
            "kind": "stroke-vae",
            "charset": charset,
            "style": style_vec,
            "means": {},
            "metrics": metrics,
        }

    # Per-character mean masks (always available; used without torch).
    means: Dict[str, List[float]] = {}
    for i, ch in enumerate(charset):
        rows = X[y == i]
        if len(rows):
            means[ch] = rows.mean(axis=0).tolist()

    try:
        import torch
        import torch.nn as nn

        n_char = len(charset)
        style = torch.tensor(style_vec[:5] + [0.0] * max(0, 5 - len(style_vec)), dtype=torch.float32)

        class CharStrokeVAE(nn.Module):
            def __init__(self):
                super().__init__()
                self.char_emb = nn.Embedding(n_char, CHAR_EMB)
                self.enc = nn.Sequential(
                    nn.Linear(SIZE * SIZE + CHAR_EMB + 5, 128),
                    nn.ReLU(),
                    nn.Linear(128, LATENT * 2),
                )
                self.dec = nn.Sequential(
                    nn.Linear(LATENT + CHAR_EMB + 5, 128),
                    nn.ReLU(),
                    nn.Linear(128, SIZE * SIZE),
                    nn.Sigmoid(),
                )

            def encode(self, x, c, s):
                h = self.enc(torch.cat([x, c, s.expand(x.size(0), -1)], dim=1))
                mu, logvar = h[:, :LATENT], h[:, LATENT:]
                return mu, logvar

            def reparam(self, mu, logvar):
                std = torch.exp(0.5 * logvar)
                eps = torch.randn_like(std)
                return mu + eps * std

            def forward(self, x, char_ids, s):
                c = self.char_emb(char_ids)
                mu, logvar = self.encode(x, c, s)
                z = self.reparam(mu, logvar)
                recon = self.dec(torch.cat([z, c, s.expand(x.size(0), -1)], dim=1))
                return recon, mu, logvar

        model = CharStrokeVAE()
        opt = torch.optim.Adam(model.parameters(), lr=2e-3)
        xt = torch.tensor(X)
        yt = torch.tensor(y)
        model.train()
        last = 1.0
        for _ in range(epochs):
            opt.zero_grad()
            recon, mu, logvar = model(xt, yt, style)
            recon_loss = ((recon - xt) ** 2).mean()
            kld = -0.5 * torch.mean(1 + logvar - mu.pow(2) - logvar.exp())
            loss = recon_loss + 0.02 * kld
            loss.backward()
            opt.step()
            last = float(loss.detach().cpu())

        metrics["backend"] = "stroke-vae-torch-v1"
        metrics["loss"] = round(last, 5)
        state = {k: v.detach().cpu().tolist() for k, v in model.state_dict().items()}
        return {
            "kind": "stroke-vae",
            "charset": charset,
            "style": style_vec,
            "means": means,
            "state_dict": state,
            "metrics": metrics,
        }
    except Exception as exc:
        metrics["torchError"] = str(exc)
        return {
            "kind": "stroke-vae",
            "charset": charset,
            "style": style_vec,
            "means": means,
            "metrics": metrics,
        }


def sample_variants(
    ckpt: Dict[str, Any],
    per_char: int = 3,
    noise: float = 0.12,
) -> List[Dict[str, Any]]:
    charset = ckpt.get("charset") or list("abcdefghijklmnopqrstuvwxyz")
    means = ckpt.get("means") or {}
    out: List[Dict[str, Any]] = []
    rng = np.random.default_rng(7)

    # Prefer torch decoder when weights exist.
    state = ckpt.get("state_dict")
    if state:
        try:
            import torch
            import torch.nn as nn

            n_char = len(charset)
            style_vec = ckpt.get("style") or [0.1, 0.3, 0.4, 0.5, 0.5]
            style = torch.tensor(style_vec[:5] + [0.0] * max(0, 5 - len(style_vec)), dtype=torch.float32)

            class CharStrokeVAE(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.char_emb = nn.Embedding(n_char, CHAR_EMB)
                    self.enc = nn.Sequential(
                        nn.Linear(SIZE * SIZE + CHAR_EMB + 5, 128),
                        nn.ReLU(),
                        nn.Linear(128, LATENT * 2),
                    )
                    self.dec = nn.Sequential(
                        nn.Linear(LATENT + CHAR_EMB + 5, 128),
                        nn.ReLU(),
                        nn.Linear(128, SIZE * SIZE),
                        nn.Sigmoid(),
                    )

                def forward_decode(self, z, char_ids, s):
                    c = self.char_emb(char_ids)
                    return self.dec(torch.cat([z, c, s.expand(z.size(0), -1)], dim=1))

            model = CharStrokeVAE()
            with torch.no_grad():
                sd = {k: torch.tensor(v) for k, v in state.items()}
                model.load_state_dict(sd, strict=False)
                model.eval()
                for ci, ch in enumerate(charset):
                    for _ in range(per_char):
                        z = torch.randn(1, LATENT) * noise
                        ids = torch.tensor([ci])
                        recon = model.forward_decode(z, ids, style).cpu().numpy().reshape(SIZE, SIZE)
                        url = _encode_mask_png(recon)
                        out.append(_glyph_record(ch, url))
            if out:
                return out
        except Exception:
            pass

    for ch in charset:
        base = np.asarray(means.get(ch) or [0.0] * (SIZE * SIZE), dtype=np.float32).reshape(SIZE, SIZE)
        if base.max() < 0.01:
            continue
        for _ in range(per_char):
            jitter = base + rng.normal(0, noise, base.shape).astype(np.float32)
            # slight morphological feel
            shift = int(rng.integers(-1, 2))
            if shift:
                jitter = np.roll(jitter, shift, axis=1)
            url = _encode_mask_png(np.clip(jitter, 0, 1))
            out.append(_glyph_record(ch, url))
    return out


def _glyph_record(ch: str, url: str) -> Dict[str, Any]:
    return {
        "ch": ch,
        "url": url,
        "w": SIZE,
        "h": SIZE,
        "bx": 0,
        "by": int(SIZE * 0.82),
        "adv": SIZE + 4,
        "cellH": int(SIZE * 1.15),
        "cellW": int(SIZE * 1.2),
        "neural": True,
    }
