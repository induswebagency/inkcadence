<p align="center">
  <img src="assets/inkcadence-wordmark.svg" alt="Inkcadence — your hand, on every page" width="420">
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2f6fed">
  <img alt="Dependencies: none" src="https://img.shields.io/badge/dependencies-0-2f6fed">
  <img alt="Runs in the browser" src="https://img.shields.io/badge/runs-in%20browser-2f6fed">
  <img alt="Backend: none" src="https://img.shields.io/badge/backend-none-177d4f">
  <img alt="Privacy: on-device" src="https://img.shields.io/badge/data-stays%20on%20device-177d4f">
</p>

<h1 align="center">Inkcadence</h1>

> **Inkcadence is an open-source, browser-based handwriting generator that learns your handwriting from your own old assignments and writes new pages in it.**

Inkcadence analyses uploaded pages of your handwriting to extract ink colours, slant, stroke weight, line spacing and paper tone, then captures your individual letterforms from a printable template sheet. It stores that profile as a reusable *style pack* in a local account and renders new A4 pages — assignments, notes, letters — in your own hand, with your own pen colours and heading style.

## At a glance

| | |
|---|---|
| **What it is** | A handwriting synthesis tool that reproduces one specific person's writing |
| **Category** | AI handwriting generation · handwriting style transfer · document rendering |
| **Input** | Photos or scans of your own handwritten pages, plus one filled template sheet |
| **Output** | Multi-page A4 PNG images, or print-to-PDF |
| **Learns** | Ink and marker colours, slant, stroke weight, line spacing, paper tone, 80 letterforms |
| **Runs on** | Any modern browser — no install, no build step, no server |
| **Data** | 100% on-device (IndexedDB / localStorage); zero network calls at runtime |
| **Stack** | Vanilla JavaScript, Canvas 2D, IndexedDB — no frameworks, no dependencies |
| **License** | MIT |
| **Good for** | Writing in your own hand when you cannot physically write, note reconstruction, letters, personal archiving |

## What it is

- **A handwriting synthesis tool.** It generates images of handwriting from typed text, matching a specific person's writing.
- **A style extractor.** It measures slant, stroke width, line spacing, ink palette and paper colour directly from photographs of your pages.
- **Local-first.** Every computation runs in the browser. No page, no photo and no generated output is uploaded to any server.
- **Free and open source.** MIT licensed, dependency-free vanilla JavaScript.

## What it is not

- Not a document forger. It does not reproduce signatures, certificates or official documents, and it embeds an optional "written with AI assistance" mark.
- Not a cloud service. Accounts and style packs live on the device, in IndexedDB (or localStorage).

## Features

- Handwriting style extraction from 1–8 uploaded assignment photos
- K-means ink clustering that separates **pen** from **marker/highlighter** and returns your real hex colours
- Slant, stroke-width, line-spacing and paper-colour estimation
- Per-character letterform capture from a printable A4 template sheet (80 glyphs)
- Transparent alpha glyphs, recoloured at render time so one set of letterforms serves every pen you own
- Multi-page A4 rendering with ruled, grid or plain paper
- Heading detection via `#`, with underline and double-underline styles
- Deterministic per-page seeds, so a stack of pages looks written over time rather than cloned
- PNG export and print-to-PDF
- Runs offline from a single folder

## Quick start

```bash
git clone <this repository>
cd inkcadence
```

Then open `index.html` in a browser. No build step, no install.

If your browser restricts local storage on `file://`, serve the folder instead:

```bash
npx --yes serve . -l 4173
# open http://localhost:4173
```

## How it works

1. **Create an account.** Local only — a username and a salted SHA-256 password hash kept in IndexedDB.
2. **Upload old assignments.** 1–8 photos. The analyser returns your ink palette, slant, stroke weight and line spacing.
3. **Upload the template sheet.** Print `sheet.html`, write each of the 80 characters once on the printed baseline, photograph it flat, then align the grid overlay with four sliders.
4. **Save the style pack.** Letterforms, palette and statistics are stored under your account.
5. **Write.** Paste text, pick a pen colour from your own palette, choose paper and heading style, render, export.

## Architecture

```
index.html        app shell: auth, train, write
sheet.html        printable character sheet (A4)
js/store.js       local accounts + style-pack persistence
js/imaging.js     ink clustering, slant, stroke, spacing, paper tone
js/glyphs.js      sheet-grid → alpha glyphs, tint cache
js/render.js      layout, jitter synthesis, pagination
assets/           mark and wordmark (SVG)
```

No frameworks, no bundler, no network requests at runtime.

## How it compares

| | **Inkcadence** | Handwriting font (TTF) | Cloud handwriting service |
|---|:--:|:--:|:--:|
| Learns your actual hand from samples | ✅ | ❌ one fixed shape per letter | ✅ |
| Keeps your real pen and marker colours | ✅ | ❌ | ⚠️ partial |
| Keeps your pages on your own device | ✅ | ✅ | ❌ upload required |
| Multi-page A4 assignment layout | ✅ | ❌ | ⚠️ partial |
| Works offline | ✅ | ✅ | ❌ |
| Cost | Free (MIT) | Varies | Subscription |

The difference that matters: a handwriting font gives every `a` the same shape. Inkcadence stores your measured letterforms, spacing and ink, then varies each glyph per occurrence — so a page looks written, not printed.

## Frequently asked questions

**Does Inkcadence upload my handwriting anywhere?**
No. Image analysis, glyph extraction and rendering all run in the browser. Style packs are stored locally in IndexedDB, or localStorage as a fallback.

**Can it copy my handwriting exactly?**
It reproduces your measured slant, stroke weight, spacing, ink colour and letterforms, with per-glyph jitter to avoid a mechanical look. It is a close, consistent imitation rather than a forensic copy — and it is not intended for signatures or official documents.

**Do I need to install anything?**
No. Open `index.html`. A local server is only needed if your browser blocks storage on `file://`.

**How many pages of handwriting do I need to upload?**
One good, evenly lit page is enough. Three to eight improves the accuracy of the colour and slant estimates.

**Why is there a separate template sheet?**
Free-form prose has no character boundaries, so cutting individual letters out of an old assignment needs line segmentation plus character recognition. Writing 80 characters into a printed grid makes the crop exact and needs no OCR.

**Does it work offline?**
Yes, after the first load. There are no runtime network calls.

**What formats can I export?**
PNG per page, or print to PDF through the browser's print dialog at A4.

## Responsible use

Inkcadence is built for accessibility, note reconstruction, letter-writing and personal archiving — writing in your own hand when you cannot physically write. Using it to forge signatures, certificates, prescriptions, official records or examination answer sheets is a misuse of the tool and may be unlawful. The renderer can stamp every page with a faint "written with AI assistance" mark; keep it on unless you have a specific, legitimate reason not to.

Only train on samples you own.

## License

MIT — see [LICENSE](LICENSE).
