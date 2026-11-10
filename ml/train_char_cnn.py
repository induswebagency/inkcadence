"""Train CharCNN on real human handwriting (neat + messy + mixed).

Primary: EMNIST ByClass (NIST writers).
Optional: Kaggle A-Z CSV at ml/data/A_Z_Handwritten_Data.csv or via kagglehub.
"""

from __future__ import annotations

import argparse
import csv
import random
import shutil
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import ConcatDataset, DataLoader, Dataset, Subset
from torchvision import datasets, transforms
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
DATA = ROOT / "data"
ART = ROOT / "artifacts"

sys.path.insert(0, str(ROOT))
from char_cnn import (  # noqa: E402
    INPUT_SIZE,
    NUM_CLASSES,
    CharCNN,
    EMNIST_BYCLASS_LABELS,
    export_browser_weights,
    label_to_index,
)


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


class MessyAugment:
    def __init__(self, strength: float = 1.0) -> None:
        self.strength = strength

    def __call__(self, img: Image.Image) -> Image.Image:
        s = self.strength
        angle = random.uniform(-18, 18) * s
        shear = random.uniform(-12, 12) * s
        img = img.transform(
            img.size,
            Image.AFFINE,
            (1, shear * 0.02, random.uniform(-2, 2) * s, random.uniform(-0.02, 0.02) * s, 1, random.uniform(-2, 2) * s),
            resample=Image.BILINEAR,
            fillcolor=0,
        )
        img = img.rotate(angle, resample=Image.BILINEAR, fillcolor=0)
        mode = random.random()
        if mode < 0.33 * s:
            img = img.filter(ImageFilter.MaxFilter(3))
        elif mode < 0.55 * s:
            img = img.filter(ImageFilter.MinFilter(3))
        if random.random() < 0.45 * s:
            img = img.filter(ImageFilter.GaussianBlur(radius=random.uniform(0.4, 1.6) * s))
        arr = np.asarray(img, dtype=np.float32)
        if random.random() < 0.5 * s:
            arr = arr + np.random.normal(0, 18 * s, arr.shape)
        if random.random() < 0.35 * s:
            arr = arr + np.random.uniform(-12, 12, arr.shape) * s
        if random.random() < 0.25 * s:
            yy, xx = np.ogrid[: arr.shape[0], : arr.shape[1]]
            cy, cx = random.uniform(0, 27), random.uniform(0, 27)
            r = random.uniform(3, 9) * s
            wipe = ((yy - cy) ** 2 + (xx - cx) ** 2) < r * r
            arr = arr.copy()
            arr[wipe] *= random.uniform(0.0, 0.35)
        if random.random() < 0.6:
            arr = arr * random.uniform(0.65, 1.45)
        arr = np.clip(arr, 0, 255).astype(np.uint8)
        return Image.fromarray(arr, mode="L")


class KaggleAZDataset(Dataset):
    def __init__(self, csv_path: Path, train: bool, messy: bool, seed: int = 0) -> None:
        self.samples: List[Tuple[np.ndarray, int]] = []
        self.messy = MessyAugment(1.0 if messy else 0.35)
        self.train = train
        rng = random.Random(seed)
        with csv_path.open("r", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                if not row or not row[0].isdigit():
                    continue
                lab = int(row[0])
                pixels = np.array([int(x) for x in row[1:785]], dtype=np.uint8).reshape(28, 28)
                y = 10 + lab
                self.samples.append((pixels, y))
        rng.shuffle(self.samples)
        cut = int(len(self.samples) * 0.9)
        self.samples = self.samples[:cut] if train else self.samples[cut:]

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        pixels, y = self.samples[idx]
        img = Image.fromarray(pixels, mode="L")
        if float(pixels.mean()) > 127:
            img = ImageOps.invert(img)
        if self.train:
            img = self.messy(img)
        return transforms.ToTensor()(img), y


class EMNISTWrap(Dataset):
    def __init__(self, base: Dataset, messy: bool, train: bool) -> None:
        self.base = base
        self.messy = MessyAugment(1.05 if messy else 0.4)
        self.train = train
        self.to_tensor = transforms.ToTensor()

    def __len__(self) -> int:
        return len(self.base)

    def __getitem__(self, idx: int):
        img, y = self.base[idx]
        img = img.transpose(Image.TRANSPOSE)
        if self.train:
            img = self.messy(img)
        return self.to_tensor(img), int(y)


def try_kaggle_download(dest: Path) -> Optional[Path]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return dest
    for alt in (
        DATA / "A_Z_Handwritten_Data.csv",
        DATA / "Handwritten_Data.csv",
        DATA / "az-handwritten-alphabets-in-csv-format" / "A_Z_Handwritten_Data.csv",
    ):
        if alt.exists():
            return alt
    try:
        import kagglehub  # type: ignore

        print("[train] downloading Kaggle A-Z via kagglehub…", flush=True)
        root = Path(kagglehub.dataset_download("sachinpatel21/az-handwritten-alphabets-in-csv-format"))
        for alt in root.rglob("*.csv"):
            shutil.copy2(alt, dest)
            print(f"[train] Kaggle CSV → {dest}", flush=True)
            return dest
    except Exception as exc:
        print("[train] kagglehub skipped:", exc, flush=True)
    try:
        import kaggle  # type: ignore

        print("[train] downloading Kaggle A-Z via kaggle CLI…", flush=True)
        kaggle.api.authenticate()
        kaggle.api.dataset_download_files(
            "sachinpatel21/az-handwritten-alphabets-in-csv-format", path=str(DATA), unzip=True
        )
        for alt in DATA.rglob("A_Z_Handwritten_Data.csv"):
            return alt
    except Exception as exc:
        print("[train] Kaggle download skipped:", exc, flush=True)
    return None


def build_loaders(batch: int, workers: int, subset: Optional[int], kaggle_csv: Optional[Path], seed: int):
    DATA.mkdir(parents=True, exist_ok=True)
    raw_train = datasets.EMNIST(root=str(DATA), split="byclass", train=True, download=True, transform=None)
    raw_test = datasets.EMNIST(root=str(DATA), split="byclass", train=False, download=True, transform=None)
    train_sets: List[Dataset] = [
        EMNISTWrap(raw_train, messy=False, train=True),
        EMNISTWrap(raw_train, messy=True, train=True),
    ]
    test_sets: List[Dataset] = [
        EMNISTWrap(raw_test, messy=False, train=False),
        EMNISTWrap(raw_test, messy=True, train=False),
    ]
    if kaggle_csv and kaggle_csv.exists():
        print(f"[train] merging Kaggle A-Z from {kaggle_csv}", flush=True)
        train_sets.append(KaggleAZDataset(kaggle_csv, train=True, messy=False, seed=seed))
        train_sets.append(KaggleAZDataset(kaggle_csv, train=True, messy=True, seed=seed + 1))
        test_sets.append(KaggleAZDataset(kaggle_csv, train=False, messy=False, seed=seed + 2))
        test_sets.append(KaggleAZDataset(kaggle_csv, train=False, messy=True, seed=seed + 3))
    else:
        print("[train] Kaggle CSV not found — EMNIST ByClass only (NIST human writers)", flush=True)

    train_ds: Dataset = ConcatDataset(train_sets)
    test_ds: Dataset = ConcatDataset(test_sets)
    if subset and subset > 0:
        g = torch.Generator().manual_seed(seed)
        train_idx = torch.randperm(len(train_ds), generator=g)[:subset].tolist()
        test_idx = torch.randperm(len(test_ds), generator=g)[: max(2000, subset // 10)].tolist()
        train_ds = Subset(train_ds, train_idx)
        test_ds = Subset(test_ds, test_idx)

    train_loader = DataLoader(train_ds, batch_size=batch, shuffle=True, num_workers=workers, pin_memory=False)
    test_loader = DataLoader(test_ds, batch_size=batch, shuffle=False, num_workers=workers, pin_memory=False)
    print(f"[train] train={len(train_ds)} test={len(test_ds)} classes={NUM_CLASSES}", flush=True)
    return train_loader, test_loader


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> float:
    model.eval()
    correct = total = 0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        pred = model(x).argmax(1)
        correct += int((pred == y).sum().item())
        total += y.numel()
    return correct / max(1, total)


def train(args: argparse.Namespace) -> None:
    set_seed(args.seed)
    ART.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    print(f"[train] device={device}", flush=True)

    kaggle_csv = Path(args.kaggle_csv) if args.kaggle_csv else try_kaggle_download(DATA / "A_Z_Handwritten_Data.csv")
    train_loader, test_loader = build_loaders(args.batch, args.workers, args.subset, kaggle_csv, args.seed)

    model = CharCNN(NUM_CLASSES).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(1, args.epochs))
    crit = nn.CrossEntropyLoss(label_smoothing=0.05)

    best = 0.0
    best_path = ART / "charcnn.pt"
    for epoch in range(1, args.epochs + 1):
        model.train()
        running = n = 0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            opt.zero_grad(set_to_none=True)
            loss = crit(model(x), y)
            loss.backward()
            opt.step()
            running += float(loss.item()) * y.size(0)
            n += y.size(0)
        sched.step()
        acc = evaluate(model, test_loader, device)
        print(f"[train] epoch {epoch}/{args.epochs} loss={running/max(1,n):.4f} acc={acc:.4f}", flush=True)
        if acc >= best:
            best = acc
            torch.save({"model": model.state_dict(), "acc": best, "labels": EMNIST_BYCLASS_LABELS, "epoch": epoch}, best_path)

    print(f"[train] best acc={best:.4f} → {best_path}", flush=True)
    ckpt = torch.load(best_path, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model"])
    model.eval()
    browser_path = ART / "charcnn.json"
    export_browser_weights(model, str(browser_path))
    print(f"[train] browser weights → {browser_path} ({browser_path.stat().st_size/1e6:.2f} MB)", flush=True)
    for dest in (REPO / "assets" / "charcnn.json", REPO / "web" / "public" / "charcnn.json"):
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(browser_path, dest)
        print(f"[train] copied → {dest}", flush=True)
    spot_check(model, test_loader, device)


@torch.no_grad()
def spot_check(model: nn.Module, loader: DataLoader, device: torch.device) -> None:
    model.eval()
    q_idx, a_idx = label_to_index("Q"), label_to_index("a")
    q_total = q_as_a = 0
    for x, y in loader:
        pred = model(x.to(device)).argmax(1).cpu()
        for yi, pi in zip(y.tolist(), pred.tolist()):
            if yi == q_idx:
                q_total += 1
                if pi == a_idx:
                    q_as_a += 1
        if q_total >= 200:
            break
    if q_total:
        print(f"[train] spot-check Q→a errors: {q_as_a}/{q_total} ({100*q_as_a/q_total:.1f}%)", flush=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train Inkcadence CharCNN")
    p.add_argument("--epochs", type=int, default=6)
    p.add_argument("--batch", type=int, default=256)
    p.add_argument("--lr", type=float, default=1.5e-3)
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--subset", type=int, default=0)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--kaggle-download", action="store_true")
    p.add_argument("--kaggle-csv", type=str, default="")
    p.add_argument("--quick", action="store_true")
    args = p.parse_args()
    if args.quick:
        args.epochs = 1
        args.subset = 12000
        args.batch = 128
    return args


if __name__ == "__main__":
    train(parse_args())
