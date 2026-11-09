"""Generate diverse synthetic written-assignment photos for Inkcadence training tests.

Types: lined exam, blank essay, lab grid, neat vs messy, multi-ink, phone-photo skew.
No copyrighted student work — PIL + local fonts only.
"""
from __future__ import annotations

import math
import os
import random
from typing import Tuple

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", "samples", "assignments")
os.makedirs(ROOT, exist_ok=True)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\Inkfree.ttf",
    r"C:\Windows\Fonts\segoepr.ttf",
    r"C:\Windows\Fonts\segoesc.ttf",
    r"C:\Windows\Fonts\comic.ttf",
    r"C:\Windows\Fonts\FRSCRIPT.TTF",
    r"C:\Windows\Fonts\arial.ttf",
]
FONTS = [p for p in FONT_CANDIDATES if os.path.exists(p)]
if not FONTS:
    raise SystemExit("No usable fonts found")


def pick_font(i: int = 0) -> str:
    return FONTS[i % len(FONTS)]


def paper(w: int, h: int, cream=(253, 252, 247)) -> Image.Image:
    im = Image.new("RGB", (w, h), cream)
    px = im.load()
    rnd = random.Random(3)
    for _ in range(w * h // 50):
        x, y = rnd.randrange(w), rnd.randrange(h)
        n = rnd.randint(-10, 10)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return im


def ruled(draw: ImageDraw.ImageDraw, w: int, h: int, gap: int = 52) -> None:
    y = 150
    while y < h - 90:
        draw.line([(110, y), (w - 90, y)], fill=(170, 195, 220), width=2)
        y += gap
    draw.line([(88, 120), (88, h - 90)], fill=(214, 120, 120), width=3)


def grid(draw: ImageDraw.ImageDraw, w: int, h: int, gap: int = 36) -> None:
    for y in range(140, h - 80, gap):
        draw.line([(100, y), (w - 80, y)], fill=(190, 205, 215), width=1)
    for x in range(100, w - 80, gap):
        draw.line([(x, 140), (x, h - 80)], fill=(200, 210, 220), width=1)
    draw.line([(88, 120), (88, h - 90)], fill=(214, 120, 120), width=2)


def wavy(draw, text, xy, font, fill, rnd, jitter=2.4):
    x, y = xy
    for ch in text:
        dx = rnd.uniform(-jitter, jitter)
        dy = rnd.uniform(-jitter * 0.85, jitter * 0.85)
        draw.text((x + dx, y + dy), ch, font=font, fill=fill)
        bb = draw.textbbox((0, 0), ch, font=font)
        x += max(7, bb[2] - bb[0]) * rnd.uniform(0.9, 1.1)


def phone_photo(im: Image.Image, seed: int, rotate: float = 1.4) -> Image.Image:
    rnd = random.Random(seed)
    im = im.rotate(rotate, resample=Image.BICUBIC, expand=False, fillcolor=(240, 238, 230))
    # Uneven light
    overlay = Image.new("RGB", im.size, (255, 240, 210))
    mask = Image.new("L", im.size, 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([im.width * 0.1, im.height * 0.05, im.width * 0.95, im.height * 0.7], fill=120)
    mask = mask.filter(ImageFilter.GaussianBlur(80))
    im = Image.composite(Image.blend(im, overlay, 0.18), im, mask)
    # Soft shadow band
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rectangle([0, int(im.height * 0.72), im.width, im.height], fill=(40, 30, 20, 35))
    im = Image.alpha_composite(im.convert("RGBA"), sh).convert("RGB")
    im = ImageEnhance.Contrast(im).enhance(0.92 + rnd.random() * 0.1)
    im = im.filter(ImageFilter.GaussianBlur(radius=0.45))
    return im


def write_page(
    path: str,
    *,
    seed: int,
    ink: Tuple[int, int, int],
    style: str,
    neat: bool,
    lines: list,
    font_i: int = 0,
    phone: bool = False,
) -> None:
    rnd = random.Random(seed)
    W, H = 1240, 1754
    im = paper(W, H)
    draw = ImageDraw.Draw(im)
    if style == "ruled":
        ruled(draw, W, H)
    elif style == "grid":
        grid(draw, W, H)
    # blank = no lines

    size = 34 if neat else 38
    jitter = 1.4 if neat else 3.6
    body_font = ImageFont.truetype(pick_font(font_i), size)
    title_font = ImageFont.truetype(pick_font(font_i + 1), size + 6)
    y = 168
    for text, heading in lines:
        f = title_font if heading else body_font
        fill = ink if not heading else (max(0, ink[0] - 10), max(0, ink[1] - 10), min(255, ink[2] + 30))
        body = text[2:].strip() if heading and text.startswith("#") else text
        wavy(draw, body, (118, y), f, fill, rnd, jitter=jitter if not heading else jitter * 0.55)
        if heading:
            bb = draw.textbbox((118, y), body, font=f)
            draw.line([(118, bb[3] + 3), (min(W - 100, bb[2] + 20), bb[3] + 5)], fill=fill, width=2 if neat else 3)
            if neat:
                draw.line([(118, bb[3] + 7), (min(W - 100, bb[2] + 20), bb[3] + 9)], fill=fill, width=1)
        y += 72 if heading else (52 if neat else 58)
        if y > H - 140:
            break

    if phone:
        im = phone_photo(im, seed=seed + 99, rotate=rnd.uniform(0.6, 2.0) * (1 if seed % 2 == 0 else -1))
    else:
        im = im.filter(ImageFilter.GaussianBlur(radius=0.35))

    im.save(path, quality=88 if phone else 93)
    print("wrote", path)


EXAM = [
    ("# Assignment 4 — Machine Learning", True),
    ("Name: A. Student     Roll: 21CS042", False),
    ("1. Explain the working of a transformer network.", False),
    ("A transformer uses self attention to weigh every", False),
    ("token against every other token in the sequence.", False),
    ("2. Difference between supervised and unsupervised.", False),
    ("Supervised learning uses labelled data while", False),
    ("unsupervised finds structure without labels.", False),
]

ESSAY = [
    ("# Essay: Why cities need green space", True),
    ("Urban parks cool neighbourhoods, cut noise, and", False),
    ("give people a place to rest between work days.", False),
    ("When planners keep trees near roads and schools,", False),
    ("air quality improves and walking feels safer.", False),
    ("I argue every new block should keep ten percent", False),
    ("of land for shared outdoor ground.", False),
]

LAB = [
    ("# Lab 2 — Circuit measurements", True),
    ("Aim: measure voltage across resistor R1.", False),
    ("Procedure: connect ammeter in series, voltmeter", False),
    ("in parallel, record three trials.", False),
    ("Trial 1: 4.9 V   Trial 2: 5.0 V   Trial 3: 5.1 V", False),
    ("Conclusion: Ohm's law held within 2 percent.", False),
]

MESSY = [
    ("# quick notes before class", True),
    ("dont forget: chapter 4 + diagrams", False),
    ("mitochondria = powerhouse (ATP)", False),
    ("ask sir about osmosis question 3", False),
    ("revise enzymes — activation energy!!", False),
]


def main() -> None:
    write_page(
        os.path.join(ROOT, "exam_lined_navy_neat.jpg"),
        seed=1, ink=(27, 42, 74), style="ruled", neat=True, lines=EXAM, font_i=0,
    )
    write_page(
        os.path.join(ROOT, "exam_lined_blue_messy.jpg"),
        seed=2, ink=(20, 55, 140), style="ruled", neat=False, lines=EXAM, font_i=1,
    )
    write_page(
        os.path.join(ROOT, "essay_blank_black_neat.jpg"),
        seed=3, ink=(15, 15, 18), style="blank", neat=True, lines=ESSAY, font_i=0,
    )
    write_page(
        os.path.join(ROOT, "lab_grid_green_normal.jpg"),
        seed=4, ink=(25, 90, 45), style="grid", neat=True, lines=LAB, font_i=2,
    )
    write_page(
        os.path.join(ROOT, "notes_lined_grey_messy.jpg"),
        seed=5, ink=(55, 55, 60), style="ruled", neat=False, lines=MESSY, font_i=3,
    )
    write_page(
        os.path.join(ROOT, "exam_phone_photo_blue.jpg"),
        seed=6, ink=(18, 48, 130), style="ruled", neat=True, lines=EXAM, font_i=0, phone=True,
    )
    write_page(
        os.path.join(ROOT, "essay_phone_photo_black.jpg"),
        seed=7, ink=(20, 20, 22), style="blank", neat=False, lines=ESSAY, font_i=1, phone=True,
    )
    write_page(
        os.path.join(ROOT, "lab_phone_photo_green.jpg"),
        seed=8, ink=(30, 100, 50), style="grid", neat=True, lines=LAB, font_i=2, phone=True,
    )
    print("done ->", os.path.abspath(ROOT))


if __name__ == "__main__":
    main()
