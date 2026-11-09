"""Generate synthetic handwriting fixtures for pipeline testing (no copyrighted corpus)."""
from __future__ import annotations

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", "samples")
os.makedirs(OUT, exist_ok=True)

FONT_PATHS = [
    r"C:\Windows\Fonts\Inkfree.ttf",
    r"C:\Windows\Fonts\LHANDW.TTF",
    r"C:\Windows\Fonts\FRSCRIPT.TTF",
    r"C:\Windows\Fonts\comic.ttf",
]
fonts = [p for p in FONT_PATHS if os.path.exists(p)]
if not fonts:
    raise SystemExit("No handwriting-like fonts found on this machine.")

CHARS = (
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    ".,!?-:;\"'()/&@#+*="
)
COLS = 13
ROWS = math.ceil(len(CHARS) / COLS)


def paper(w: int, h: int, cream=(253, 252, 247)) -> Image.Image:
    im = Image.new("RGB", (w, h), cream)
    px = im.load()
    rnd = random.Random(7)
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


def wavy_text(draw, text, xy, font, fill, rnd, jitter=2.2):
    x, y = xy
    for ch in text:
        dx = rnd.uniform(-jitter, jitter)
        dy = rnd.uniform(-jitter * 0.8, jitter * 0.8)
        draw.text((x + dx, y + dy), ch, font=font, fill=fill)
        bbox = draw.textbbox((0, 0), ch, font=font)
        adv = bbox[2] - bbox[0]
        x += max(8, adv) * rnd.uniform(0.92, 1.08)


def make_assignment(path: str, seed: int = 1, ink=(27, 42, 74)) -> None:
    rnd = random.Random(seed)
    W, H = 1240, 1754
    im = paper(W, H)
    draw = ImageDraw.Draw(im)
    draw_ruled(draw, W, H)
    font = ImageFont.truetype(fonts[0], 42)
    title_font = ImageFont.truetype(fonts[min(1, len(fonts) - 1)], 48)
    lines = [
        ("# Biology notes - week 3", True),
        ("The mitochondria produce ATP for the cell.", False),
        ("Photosynthesis converts light into chemical energy.", False),
        ("DNA stores genetic information in base pairs.", False),
        ("Enzymes lower the activation energy of reactions.", False),
        ("Osmosis is the diffusion of water across a membrane.", False),
        ("I need to revise chapter four before Friday.", False),
    ]
    y = 170
    for text, heading in lines:
        f = title_font if heading else font
        fill = ink if not heading else (20, 55, 120)
        body = text[2:].strip() if heading else text
        wavy_text(draw, body, (110, y), f, fill, rnd, jitter=2.8 if not heading else 1.5)
        if heading:
            bb = draw.textbbox((110, y), body, font=f)
            draw.line([(110, bb[3] + 4), (bb[2], bb[3] + 6)], fill=fill, width=2)
        y += 78 if heading else 58
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle([200, 430, 980, 470], fill=(255, 235, 80, 90))
    im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=0.4))
    im.save(path, quality=92)
    print("wrote", path, im.size)


def make_sheet(path: str, seed: int = 3) -> None:
    rnd = random.Random(seed)
    W, H = 1600, 2200
    im = paper(W, H, (255, 255, 255))
    draw = ImageDraw.Draw(im)
    hf = ImageFont.truetype(fonts[min(2, len(fonts) - 1)], 28)
    draw.text((80, 40), "Inkcadence - character sheet", font=hf, fill=(30, 40, 55))
    margin_x, margin_top, margin_bottom = 70, 160, 80
    grid_w = W - 2 * margin_x
    grid_h = H - margin_top - margin_bottom
    cw, ch = grid_w / COLS, grid_h / ROWS
    font = ImageFont.truetype(fonts[0], int(ch * 0.55))
    ink = (18, 26, 55)
    soft = set(".,!?-:;\"'()/&@#+*=")
    tagf = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 12)
    for r in range(ROWS):
        for c in range(COLS):
            idx = r * COLS + c
            if idx >= len(CHARS):
                continue
            x0 = margin_x + c * cw
            y0 = margin_top + r * ch
            draw.rectangle([x0, y0, x0 + cw - 2, y0 + ch - 2], outline=(200, 210, 220), width=2)
            by = y0 + ch * 0.76
            draw.line([(x0 + 4, by), (x0 + cw - 6, by)], fill=(180, 190, 205), width=1)
            draw.text((x0 + 4, y0 + 3), CHARS[idx], font=tagf, fill=(170, 180, 190))
            chs = CHARS[idx]
            use_font = font
            if chs in soft:
                # Punchier punctuation so thin marks survive scan thresholds.
                use_font = ImageFont.truetype(fonts[0], int(ch * 0.7))
            bb = draw.textbbox((0, 0), chs, font=use_font)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            tx = x0 + (cw - tw) / 2 + rnd.uniform(-3, 3)
            ty = by - th * 0.82 + rnd.uniform(-2, 2)
            draw.text((tx, ty), chs, font=use_font, fill=ink)
            if chs in soft:
                # Second pass for denser ink on dots/commas.
                draw.text((tx + 0.6, ty + 0.6), chs, font=use_font, fill=ink)
    im.save(path, quality=95)
    print("wrote", path, im.size, "chars", len(CHARS), "grid", COLS, ROWS)


def main() -> None:
    make_assignment(os.path.join(OUT, "sample_page_1.jpg"), seed=1, ink=(27, 42, 74))
    make_assignment(os.path.join(OUT, "sample_page_2.jpg"), seed=11, ink=(40, 70, 40))
    make_sheet(os.path.join(OUT, "glyph_sheet.jpg"), seed=5)
    print("done ->", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
