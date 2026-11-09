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

<p align="center">
  <a href="https://mafzalkalwardev.github.io/inkcadence/"><b>▶ Open the live app</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/mafzalkalwardev/inkcadence">Source</a>
</p>

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
| **Runs on** | Any modern browser — no install, no build step. An optional self-hosted backend adds accounts and sync |
| **Data** | On-device by default (IndexedDB / localStorage). With the backend enabled, accounts and style packs live on your own server |
| **Stack** | Vanilla JavaScript, Canvas 2D, IndexedDB. Optional backend: Node + Express + PostgreSQL |
| **License** | MIT |
| **Good for** | Writing in your own hand when you cannot physically write, note reconstruction, letters, personal archiving |

## What it is

- **A handwriting synthesis tool.** It generates images of handwriting from typed text, matching a specific person's writing.
- **A style extractor.** It measures slant, stroke width, line spacing, ink palette and paper colour directly from photographs of your pages.
- **Local-first by default.** Out of the box every computation runs in the browser and no page, photo or generated output is uploaded anywhere. If you switch on the optional backend, only the extracted style profile is sent to your own server — never the source photos.
- **Free and open source.** MIT licensed, dependency-free vanilla JavaScript.

## What it is not

- Not a document forger. It does not reproduce signatures, certificates or official documents, and it embeds an optional "written with AI assistance" mark.
- Not a cloud service. Out of the box accounts and style packs live on the device, in IndexedDB (or localStorage). You can optionally run your own server instead — see `BACKEND.md`.

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
git clone https://github.com/mafzalkalwardev/inkcadence.git
cd inkcadence
```

Then open `index.html` in a browser. No build step, no install.

If your browser restricts local storage on `file://`, serve the folder instead:

```bash
npx --yes serve . -l 4173
# open http://localhost:4173
```

## Running it with the backend

The app works with no server. To run accounts and style packs on a server of your
own, you need Node 18+ and about a minute:

```bash
npm install
npm run dev
# open http://localhost:8080
```

`npm run dev` starts the real server against an in-memory database, so there is
nothing else to install. Data is lost when it stops — it is for trying the app out.
Point `DATABASE_URL` at a real PostgreSQL server (or run `docker compose up
--build`) when you want it to persist.

To check the backend without opening a browser:

```bash
npm test
```

That runs 81 assertions against the live API and the browser storage adapter,
using an in-memory PostgreSQL. No database server needed.

Then, to put the page and the API on different origins, edit `js/config.js`.
Full instructions, including GitHub Pages and VPS deployment, are in
[`BACKEND.md`](BACKEND.md).

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
assets/           mark, light mark and wordmark (SVG)
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
