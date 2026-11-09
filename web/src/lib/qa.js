'use strict';

import { Glyphs } from './glyphs.js';

/** Completeness + quality score for a classical style pack (0–100). */
export function packQuality(pack) {
  const glyphs = (pack && pack.glyphs) || [];
  const missing = (pack && pack.missing) || [];
  const total = Glyphs.CHARS.length;
  const captured = glyphs.length;
  const completeness = Math.round((captured / total) * 100);

  let strokeConf = 50;
  const sw = pack && pack.stats && pack.stats.strokeWidth;
  if (sw >= 1 && sw <= 12) strokeConf = 85;
  else if (sw) strokeConf = 60;

  let paletteScore = 40;
  const pens = (pack && pack.penColours) || [];
  if (pens.length >= 1) paletteScore = 70;
  if (pens.length >= 2) paletteScore = 90;

  const pages = (pack && pack.stats && pack.stats.pages) || 0;
  const sampleScore = Math.min(100, pages * 20);

  const score = Math.round(
    completeness * 0.45 +
    strokeConf * 0.2 +
    paletteScore * 0.2 +
    sampleScore * 0.15
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    completeness,
    captured,
    total,
    missing,
    strokeConf,
    paletteScore,
    sampleScore,
    ready: completeness >= 60 && score >= 55,
  };
}

export function tryPhrase() {
  return 'The quick brown fox writes with Inkcadence.';
}
