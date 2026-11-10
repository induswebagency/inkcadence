"""Compact CNN for handwritten character recognition (EMNIST ByClass + Kaggle A-Z).

62 classes: 0-9, A-Z, a-z. Trained with heavy messy-writing augmentations so
browser harvest can label real assignment crops instead of frequency cycling.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import List, Sequence, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

EMNIST_BYCLASS_LABELS: List[str] = (
    [str(i) for i in range(10)]
    + [chr(ord("A") + i) for i in range(26)]
    + [chr(ord("a") + i) for i in range(26)]
)

NUM_CLASSES = len(EMNIST_BYCLASS_LABELS)  # 62
INPUT_SIZE = 28


class CharCNN(nn.Module):
    """Small CNN (~100k params) suitable for browser Float32 export."""

    def __init__(self, num_classes: int = NUM_CLASSES) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(1, 32, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(64)
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        self.bn3 = nn.BatchNorm2d(128)
        self.pool = nn.MaxPool2d(2)
        self.drop = nn.Dropout(0.35)
        self.fc1 = nn.Linear(128 * 3 * 3, 256)
        self.fc2 = nn.Linear(256, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.pool(F.relu(self.bn1(self.conv1(x))))  # 14x14
        x = self.pool(F.relu(self.bn2(self.conv2(x))))  # 7x7
        x = self.pool(F.relu(self.bn3(self.conv3(x))))  # 3x3
        x = x.flatten(1)
        x = self.drop(F.relu(self.fc1(x)))
        return self.fc2(x)


def labels() -> List[str]:
    return list(EMNIST_BYCLASS_LABELS)


def label_to_index(ch: str) -> int:
    try:
        return EMNIST_BYCLASS_LABELS.index(ch)
    except ValueError as exc:
        raise KeyError(ch) from exc


def fuse_batchnorm(model: CharCNN) -> CharCNN:
    """Fold BN into conv for simpler browser inference (eval-only)."""
    model.eval()
    fused = CharCNN(num_classes=model.fc2.out_features)
    fused.load_state_dict(model.state_dict())

    def _fuse(conv: nn.Conv2d, bn: nn.BatchNorm2d) -> Tuple[torch.Tensor, torch.Tensor]:
        w = conv.weight.data.clone()
        b = conv.bias.data.clone() if conv.bias is not None else torch.zeros(w.size(0))
        mean = bn.running_mean
        var = bn.running_var
        eps = bn.eps
        gamma = bn.weight
        beta = bn.bias
        scale = gamma / torch.sqrt(var + eps)
        w = w * scale.reshape(-1, 1, 1, 1)
        b = beta + scale * (b - mean)
        return w, b

    with torch.no_grad():
        for name in ("1", "2", "3"):
            conv = getattr(fused, f"conv{name}")
            bn = getattr(fused, f"bn{name}")
            w, b = _fuse(conv, bn)
            conv.weight.copy_(w)
            if conv.bias is None:
                conv.bias = nn.Parameter(b)
            else:
                conv.bias.copy_(b)
            bn.weight.fill_(1)
            bn.bias.zero_()
            bn.running_mean.zero_()
            bn.running_var.fill_(1)
    return fused


def export_browser_weights(model: CharCNN, path: str, labels_seq: Sequence[str] | None = None) -> dict:
    """Export fused weights as compact JSON (float32 arrays as base64)."""
    model = fuse_batchnorm(model)
    model.eval()
    sd = model.state_dict()

    def b64(t: torch.Tensor) -> str:
        arr = t.detach().cpu().float().contiguous().numpy()
        return base64.b64encode(arr.tobytes()).decode("ascii")

    def layer(wkey: str, bkey: str, meta: dict) -> dict:
        return {**meta, "w": b64(sd[wkey]), "b": b64(sd[bkey]), "encoding": "f32b64"}

    labels_list = list(labels_seq or EMNIST_BYCLASS_LABELS)
    payload = {
        "version": 2,
        "inputSize": INPUT_SIZE,
        "labels": labels_list,
        "encoding": "f32b64",
        "conv1": layer("conv1.weight", "conv1.bias", {"out": 32, "k": 3, "pad": 1, "inC": 1}),
        "conv2": layer("conv2.weight", "conv2.bias", {"out": 64, "k": 3, "pad": 1, "inC": 32}),
        "conv3": layer("conv3.weight", "conv3.bias", {"out": 128, "k": 3, "pad": 1, "inC": 64}),
        "fc1": layer("fc1.weight", "fc1.bias", {"in": 128 * 3 * 3, "out": 256}),
        "fc2": layer("fc2.weight", "fc2.bias", {"in": 256, "out": len(labels_list)}),
        "note": "Ink on black, float32 [0,1], 28x28. BN folded into conv. Weights are base64 float32 LE.",
    }
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return payload
