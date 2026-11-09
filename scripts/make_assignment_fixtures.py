"""Generate diverse synthetic written-assignment sample pictures (no copyrighted scans).

Writes under test/fixtures/samples/assignments/:
  lined exam, blank essay, lab grid, neat vs messy, blue/black/green ink,
  phone-photo skew + shadow variants.
"""
from __future__ import annotations

import math
import os
import random
from typing import Iterable, Sequence, Tuple

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", "samples")
OUT = os.path.join(ROOT, "assignments")
os.makedirs(OUT, exist_ok=True)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\Inkfree.ttf",
    r"C:\Windows\Fonts\LHANDW.TTF",
    r"C:\Windows\Fonts\FRSCRIPT.TTF",
    r"C:\Windows\Fonts\comic.ttf",
    r"C:\Windows\Fonts\segoepr.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
    "/usr/share/fonts/truetype/croscore/Tinos-Italic.ttf",
    "/usr/share/fonts/truetype/croscore/Arimo-Italic.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/System/Library/Fonts/Supplemental/Chalkboard.ttc",
]
TAG_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/croscore/Arimo-Regular.ttf",
]

RGB = Tuple[int, int, int]
INK = {
    "black": (22, 24, 28),
    "blue": (28, 55, 140),
    "green": (28, 95, 55),
}


def pick_fonts() -> list[str]:
    found = [p for p in FONT_CANDIDATES if os.path.exists(p)]
    if not found:
        raise SystemExit(
            "No handwriting-like / italic fonts found. Install Liberation or DejaVu fonts."
        )
    return found


def pick_tag_font() -> str | None:
    for p in TAG_FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


FONTS = pick_fonts()
TAG_FONT = pick_tag_font()


def paper(w: int, h: int, cream: RGB = (253, 252, 247), seed: int = 7) -> Image.Image:
    im = Image.new("RGB", (w, h), cream)
    px = im.load()
    rnd = random.Random(seed)
    for _ in range(w * h // 40):
        x, y = rnd.randrange(w), rnd.randrange(h)
        n = rnd.randint(-8, 8)
        r, g, b = px[x, y]
        px[x, y] = (
            max(0, min(255, r + n)),
            max(0, min(255, g + n)),
            max(0, min(255, b + n)),
        )
    return im


def draw_ruled(draw: ImageDraw.ImageDraw, w: int, h: int, gap: int = 54, left: int = 90) -> None:
    y = 140
    while y < h - 80:
        draw.line([(left, y), (w - 70, y)], fill=(170, 195, 220), width=2)
        y += gap
    draw.line([(70, 110), (70, h - 80)], fill=(210, 120, 120), width=3)


def draw_grid(draw: ImageDraw.ImageDraw, w: int, h: int, gap: int = 40, left: int = 90) -> None:
    y = 140
    while y < h - 80:
        draw.line([(left, y), (w - 70, y)], fill=(175, 200, 215), width=1)
        y += gap
    x = left
    while x < w - 70:
        draw.line([(x, 140), (x, h - 80)], fill=(175, 200, 215), width=1)
        x += gap
    draw.line([(70, 110), (70, h - 80)], fill=(210, 120, 120), width=2)


def wavy_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: Tuple[float, float],
    font: ImageFont.ImageFont,
    fill: RGB,
    rnd: random.Random,
    jitter: float = 2.2,
) -> float:
    x, y = xy
    for ch in text:
        dx = rnd.uniform(-jitter, jitter)
        dy = rnd.uniform(-jitter * 0.85, jitter * 0.85)
        # Soft double-strike for denser ink (survives phone JPEG).
        draw.text((x + dx, y + dy), ch, font=font, fill=fill)
        if rnd.random() < 0.35:
            draw.text((x + dx + 0.5, y + dy + 0.4), ch, font=font, fill=fill)
        bbox = draw.textbbox((0, 0), ch, font=font)
        adv = bbox[2] - bbox[0]
        x += max(7, adv) * rnd.uniform(0.90, 1.10)
    return x


def highlight(im: Image.Image, box: Tuple[int, int, int, int], rgba=(255, 235, 80, 90)) -> Image.Image:
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle(list(box), fill=rgba)
    return Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")


def apply_phone_photo(
    im: Image.Image,
    seed: int,
    rotate: float = 1.6,
    shadow: bool = True,
    quality: int = 74,
) -> Image.Image:
    rnd = random.Random(seed)
    W, H = im.size
    # Perspective-ish skew via affine + rotate.
    shear = rnd.uniform(-0.03, 0.04)
    im = im.transform(
        (W, H),
        Image.AFFINE,
        (1, shear, -shear * H * 0.1, rnd.uniform(-0.01, 0.01), 1, 0),
        resample=Image.BICUBIC,
        fillcolor=(240, 238, 230),
    )
    im = im.rotate(rotate, resample=Image.BICUBIC, expand=False, fillcolor=(236, 234, 226))
    if shadow:
        shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shade)
        # Soft corner vignette / desk shadow
        for i, alpha in enumerate((55, 38, 22, 12)):
            pad = 18 + i * 28
            sd.rectangle([pad, pad, W - pad, H - pad], outline=(40, 35, 30, alpha), width=26)
        sd.polygon(
            [(0, 0), (W // 3, 0), (0, H // 4)],
            fill=(30, 28, 24, 70),
        )
        sd.polygon(
            [(W, H), (W - W // 3, H), (W, H - H // 4)],
            fill=(25, 22, 18, 55),
        )
        shade = shade.filter(ImageFilter.GaussianBlur(radius=28))
        im = Image.alpha_composite(im.convert("RGBA"), shade).convert("RGB")
        # Uneven lighting
        enh = ImageEnhance.Brightness(im)
        im = enh.enhance(0.92 + rnd.uniform(0, 0.08))
    im = im.filter(ImageFilter.GaussianBlur(radius=0.45))
    # Re-encode through JPEG buffer for generation loss
    from io import BytesIO

    buf = BytesIO()
    im.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


BIO_LINES = [
    ("# Biology notes - week 3", True),
    ("The mitochondria produce ATP for the cell.", False),
    ("Photosynthesis converts light into chemical energy.", False),
    ("DNA stores genetic information in base pairs.", False),
    ("Enzymes lower the activation energy of reactions.", False),
    ("Osmosis is the diffusion of water across a membrane.", False),
    ("I need to revise chapter four before Friday.", False),
]

EXAM_LINES = [
    ("# Midterm exam - Section A", True),
    ("1. Define homeostasis and give one example.", False),
    ("Homeostasis keeps internal conditions stable.", False),
    ("2. Explain why enzymes are specific to substrates.", False),
    ("The active site shape matches one substrate.", False),
    ("3. Outline the stages of mitosis briefly.", False),
    ("Prophase, metaphase, anaphase, telophase.", False),
]

ESSAY_LINES = [
    ("# Why literacy still matters", True),
    ("Writing trains attention in a distracted age.", False),
    ("Students who draft by hand often revise more carefully.", False),
    ("Clear sentences make difficult ideas usable.", False),
    ("Practice turns private thought into shared work.", False),
    ("That habit is worth protecting in every classroom.", False),
]

LAB_LINES = [
    ("# Lab 4 - titration results", True),
    ("Trial 1 volume: 24.6 mL", False),
    ("Trial 2 volume: 24.8 mL", False),
    ("Trial 3 volume: 24.5 mL", False),
    ("Mean titre is close to the expected value.", False),
    ("Sources of error: parallax and endpoint timing.", False),
]


def write_page(
    path: str,
    *,
    seed: int,
    ink: RGB,
    paper_style: str = "ruled",
    lines: Sequence[Tuple[str, bool]] = BIO_LINES,
    jitter: float = 2.4,
    font_size: int = 42,
    title_size: int = 48,
    cream: RGB = (253, 252, 247),
    do_highlight: bool = False,
    phone: bool = False,
    rotate: float = 1.4,
    shadow: bool = True,
) -> None:
    rnd = random.Random(seed)
    W, H = 1240, 1754
    im = paper(W, H, cream, seed=seed)
    draw = ImageDraw.Draw(im)
    if paper_style == "ruled":
        draw_ruled(draw, W, H)
    elif paper_style == "grid":
        draw_grid(draw, W, H, gap=42)
    # plain: no rules

    body_font = ImageFont.truetype(FONTS[seed % len(FONTS)], font_size)
    title_font = ImageFont.truetype(FONTS[(seed + 1) % len(FONTS)], title_size)

    y = 168 if paper_style != "plain" else 150
    for text, heading in lines:
        f = title_font if heading else body_font
        fill = (20, 55, 120) if heading and ink[2] > ink[0] else ink
        body = text[2:].strip() if heading and text.startswith("#") else text
        j = jitter * (0.55 if heading else 1.0)
        end_x = wavy_text(draw, body, (110, y), f, fill, rnd, jitter=j)
        if heading:
            bb = draw.textbbox((110, y), body, font=f)
            draw.line([(110, bb[3] + 4), (min(end_x, bb[2]), bb[3] + 6)], fill=fill, width=2)
        y += 82 if heading else (56 + int(jitter))
    if do_highlight:
        im = highlight(im, (200, 430, 980, 470))
    im = im.filter(ImageFilter.GaussianBlur(radius=0.35))
    if phone:
        im = apply_phone_photo(im, seed=seed + 99, rotate=rotate, shadow=shadow, quality=72)
    im.save(path, quality=90 if not phone else 78)
    print("wrote", path, im.size, "style", paper_style, "ink", ink)


def main() -> None:
    fixtures = [
        # Lined exam — neat blue
        dict(
            path=os.path.join(OUT, "exam_lined_neat_blue.jpg"),
            seed=101,
            ink=INK["blue"],
            paper_style="ruled",
            lines=EXAM_LINES,
            jitter=1.4,
            do_highlight=False,
        ),
        # Lined exam — messy black
        dict(
            path=os.path.join(OUT, "exam_lined_messy_black.jpg"),
            seed=111,
            ink=INK["black"],
            paper_style="ruled",
            lines=EXAM_LINES,
            jitter=4.6,
            font_size=40,
        ),
        # Blank essay — neat black
        dict(
            path=os.path.join(OUT, "essay_blank_neat_black.jpg"),
            seed=121,
            ink=INK["black"],
            paper_style="plain",
            lines=ESSAY_LINES,
            jitter=1.6,
            cream=(255, 255, 252),
        ),
        # Blank essay — messy green
        dict(
            path=os.path.join(OUT, "essay_blank_messy_green.jpg"),
            seed=131,
            ink=INK["green"],
            paper_style="plain",
            lines=ESSAY_LINES,
            jitter=4.2,
            cream=(252, 251, 245),
        ),
        # Lab grid — neat green
        dict(
            path=os.path.join(OUT, "lab_grid_neat_green.jpg"),
            seed=141,
            ink=INK["green"],
            paper_style="grid",
            lines=LAB_LINES,
            jitter=1.5,
        ),
        # Lab grid — messy blue
        dict(
            path=os.path.join(OUT, "lab_grid_messy_blue.jpg"),
            seed=151,
            ink=INK["blue"],
            paper_style="grid",
            lines=LAB_LINES,
            jitter=4.0,
        ),
        # Homework lined — blue with highlighter (classic sample cousin)
        dict(
            path=os.path.join(OUT, "homework_lined_blue_highlight.jpg"),
            seed=161,
            ink=INK["blue"],
            paper_style="ruled",
            lines=BIO_LINES,
            jitter=2.5,
            do_highlight=True,
        ),
        # Phone photo: skew + shadow on lined exam
        dict(
            path=os.path.join(OUT, "exam_lined_phone_skew_shadow.jpg"),
            seed=171,
            ink=INK["blue"],
            paper_style="ruled",
            lines=EXAM_LINES,
            jitter=2.2,
            phone=True,
            rotate=2.1,
            shadow=True,
        ),
        # Phone photo: essay blank, black ink, milder skew
        dict(
            path=os.path.join(OUT, "essay_blank_phone_skew.jpg"),
            seed=181,
            ink=INK["black"],
            paper_style="plain",
            lines=ESSAY_LINES,
            jitter=2.0,
            phone=True,
            rotate=-1.5,
            shadow=True,
        ),
        # Phone photo: lab grid green with hard shadow
        dict(
            path=os.path.join(OUT, "lab_grid_phone_shadow.jpg"),
            seed=191,
            ink=INK["green"],
            paper_style="grid",
            lines=LAB_LINES,
            jitter=2.8,
            phone=True,
            rotate=1.1,
            shadow=True,
        ),
    ]

    for spec in fixtures:
        write_page(**spec)

    manifest = os.path.join(OUT, "manifest.txt")
    with open(manifest, "w", encoding="utf-8") as f:
        f.write("# Synthetic assignment fixtures (no student scans / no copyrighted corpus)\n")
        for spec in fixtures:
            f.write(os.path.basename(spec["path"]) + "\n")
    print("done ->", os.path.abspath(OUT))
    print("count", len(fixtures))


if __name__ == "__main__":
    main()
