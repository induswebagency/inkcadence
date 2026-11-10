/* harvest.js — pull letter-like ink crops from full assignment pages.
   Used when no alphabet sheet is provided (or to enrich sheet glyphs with variants).
   Hardened against ruled/grid lines, highlighter, blue/green ink, and phone skew. */
'use strict';
var FREQ = 'etaoinshrdlcumwfgypbvkjxqzETAOINSHRDLCUMWFGYPBVKJXQZ0123456789';

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* Colour-aware ink: keep dark pens (incl. blue/green), drop rule lines + highlighter. */
  function inkMask(src, maxW) {
    var scale = Math.min(1, (maxW || 900) / src.width);
    var w = Math.max(32, Math.round(src.width * scale));
    var h = Math.max(32, Math.round(src.height * scale));
    var c = canvas(w, h);
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, w, h);
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data, n = w * h;
    var lum = new Float32Array(n), hist = new Uint32Array(256), i, p;
    for (i = 0, p = 0; i < d.length; i += 4, p++) {
      var L = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      lum[p] = L;
      hist[L | 0]++;
    }
    /* Paper from bright tail — ignore dark desk/shadow corners. */
    var paper = 200, acc = 0, target = n * 0.02;
    for (i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= target) { paper = i; break; }
    }
    /* Phone photos often have warmer/dimmer paper — widen ink cut. */
    var cut = paper - (paper < 190 ? 36 : 48);
    if (paper < 170) cut = paper - 28;
    var mask = new Uint8Array(n);
    for (p = 0, i = 0; p < n; p++, i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var L2 = lum[p];
      if (L2 >= cut) { mask[p] = 0; continue; }
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var sat = mx ? (mx - mn) / mx : 0;
      /* Fluorescent highlighter wash */
      if (L2 > 135 && sat > 0.28) { mask[p] = 0; continue; }
      /* Pale ruled / grid print (light blue-grey, not dark enough to be pen) */
      if (L2 > 155 && b >= r - 5 && b >= g - 5 && sat < 0.35) { mask[p] = 0; continue; }
      /* Soft shadow fringe: mid-dark, nearly grey */
      if (L2 > 145 && sat < 0.08) { mask[p] = 0; continue; }
      mask[p] = 1;
    }
    suppressRuledRows(mask, w, h);
    return { mask: mask, lum: lum, w: w, h: h, scale: scale, paper: paper, canvas: c };
  }

  /* Zero out rows that look like continuous ruled lines (high fill, thin). */
  function suppressRuledRows(mask, w, h) {
    var y, x, fill, runs, run, maxRun;
    for (y = 0; y < h; y++) {
      fill = 0; runs = 0; run = 0; maxRun = 0;
      for (x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          fill++;
          run++;
          if (run > maxRun) maxRun = run;
        } else if (run) {
          runs++;
          run = 0;
        }
      }
      if (run) runs++;
      /* A printed rule spans most of the page as one long run. */
      if (fill > w * 0.42 && maxRun > w * 0.28 && runs <= 6) {
        for (x = 0; x < w; x++) mask[y * w + x] = 0;
        if (y + 1 < h) {
          var fill2 = 0;
          for (x = 0; x < w; x++) if (mask[(y + 1) * w + x]) fill2++;
          if (fill2 > w * 0.35) for (x = 0; x < w; x++) mask[(y + 1) * w + x] = 0;
        }
        if (y > 0) {
          var fill0 = 0;
          for (x = 0; x < w; x++) if (mask[(y - 1) * w + x]) fill0++;
          if (fill0 > w * 0.35) for (x = 0; x < w; x++) mask[(y - 1) * w + x] = 0;
        }
      }
    }
  }

  function components(mask, w, h) {
    var seen = new Uint8Array(mask.length);
    var comps = [];
    var stack = new Int32Array(mask.length);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var start = y * w + x;
        if (!mask[start] || seen[start]) continue;
        var top = 0;
        stack[top++] = start;
        seen[start] = 1;
        var minX = x, maxX = x, minY = y, maxY = y, count = 0;
        while (top) {
          var idx = stack[--top];
          var cx = idx % w, cy = (idx / w) | 0;
          count++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              var nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              var nidx = ny * w + nx;
              if (!mask[nidx] || seen[nidx]) continue;
              seen[nidx] = 1;
              stack[top++] = nidx;
            }
          }
        }
        var bw = maxX - minX + 1, bh = maxY - minY + 1;
        if (count < 22 || bw < 3 || bh < 7) continue;
        if (bw > w * 0.42 || bh > h * 0.22) continue;
        var aspect = bw / bh;
        if (aspect > 2.6 || aspect < 0.1) continue;
        /* Reject leftover horizontal rule fragments */
        if (aspect > 2.0 && bh <= 5) continue;
        var density = count / (bw * bh);
        if (density < 0.12 || density > 0.92) continue;
        /* Margin / hole-punch noise near edges */
        if (minX < 4 && bw < 10) continue;
        comps.push({
          minX: minX, minY: minY, maxX: maxX, maxY: maxY,
          w: bw, h: bh, count: count, density: density
        });
      }
    }
    comps.sort(function (a, b) {
      var sa = a.count * (0.5 + a.density);
      var sb = b.count * (0.5 + b.density);
      return sb - sa;
    });
    return comps;
  }

  function cropToGlyph(srcInfo, box, pad) {
    pad = pad == null ? 2 : pad;
    var x0 = Math.max(0, box.minX - pad);
    var y0 = Math.max(0, box.minY - pad);
    var x1 = Math.min(srcInfo.w - 1, box.maxX + pad);
    var y1 = Math.min(srcInfo.h - 1, box.maxY + pad);
    var gw = x1 - x0 + 1, gh = y1 - y0 + 1;
    var out = canvas(gw, gh);
    var octx = out.getContext('2d');
    var od = octx.createImageData(gw, gh);
    var paper = srcInfo.paper;
    for (var yy = 0; yy < gh; yy++) {
      for (var xx = 0; xx < gw; xx++) {
        var sp = (yy + y0) * srcInfo.w + (xx + x0);
        var op = (yy * gw + xx) * 4;
        var a = 0;
        if (srcInfo.mask[sp]) {
          a = Math.max(40, Math.min(255, (paper - srcInfo.lum[sp]) * 2.4));
        }
        od.data[op] = 255;
        od.data[op + 1] = 255;
        od.data[op + 2] = 255;
        od.data[op + 3] = a;
      }
    }
    octx.putImageData(od, 0, 0);
    var conf = Math.min(0.95, 0.32 + box.count / 380 + (box.density || 0) * 0.15);
    return {
      url: out.toDataURL('image/png'),
      w: gw,
      h: gh,
      bx: 0,
      by: Math.round(gh * 0.82),
      adv: gw + Math.max(2, Math.round(gw * 0.08)),
      cellH: Math.round(gh * 1.15),
      cellW: Math.round(gw * 1.2),
      harvested: true,
      confidence: conf
    };
  }

  /* CNN labels real handwriting. FREQ cycling is only a last-resort offline stub. */
  function assignLabelsFreq(crops, maxPerChar) {
    maxPerChar = maxPerChar || 4;
    var glyphs = [];
    var counts = Object.create(null);
    var i, ch, g;
    for (i = 0; i < crops.length; i++) {
      ch = FREQ[i % FREQ.length];
      if ((counts[ch] || 0) >= maxPerChar) continue;
      g = crops[i];
      g.ch = ch;
      g.freqFallback = true;
      glyphs.push(g);
      counts[ch] = (counts[ch] || 0) + 1;
    }
    return glyphs;
  }

  function assignLabels(crops, maxPerChar, allowFreqFallback) {
    if (allowFreqFallback) return assignLabelsFreq(crops, maxPerChar || 4);
    return [];
  }

  function assignLabelsAsync(crops, maxPerChar) {
    maxPerChar = maxPerChar || 4;
    var cnn = global.CharCNN;
    if (!cnn) return Promise.resolve([]);
    var ensure = cnn.isReady() ? Promise.resolve() : cnn.load();
    return ensure.then(function () {
      return cnn.labelCrops(crops, maxPerChar);
    }).catch(function (err) {
      console.warn('[Harvest] CharCNN label failed:', err && err.message ? err.message : err);
      return [];
    });
  }

  /* Median cell metrics from harvested crops (for packs without a sheet). */
  function medianCellMetrics(crops) {
    if (!crops || !crops.length) return null;
    var hs = crops.map(function (g) { return g.cellH || g.h; }).sort(function (a, b) { return a - b; });
    var ws = crops.map(function (g) { return g.cellW || g.w; }).sort(function (a, b) { return a - b; });
    return {
      cellH: hs[(hs.length * 0.5) | 0],
      cellW: ws[(ws.length * 0.5) | 0]
    };
  }

  function collectCrops(canvases, opts) {
    opts = opts || {};
    var maxCrops = opts.maxCrops || 120;
    var all = [];
    (canvases || []).forEach(function (src) {
      if (!src) return;
      var info = inkMask(src, opts.maxW || 900);
      var comps = components(info.mask, info.w, info.h).slice(0, 90);
      comps.forEach(function (box) {
        all.push(cropToGlyph(info, box));
      });
    });
    all.sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
    return all.slice(0, maxCrops);
  }

  /* Sync harvest — CNN not available here; pass allowFreqFallback only for legacy tests. */
  function harvestFromPages(canvases, opts) {
    opts = opts || {};
    var all = collectCrops(canvases, opts);
    return assignLabels(all, opts.maxPerChar || 4, !!opts.allowFreqFallback);
  }

  /* Preferred: CNN-classify neat/messy human crops from assignment pages. */
  function harvestFromPagesAsync(canvases, opts) {
    opts = opts || {};
    var all = collectCrops(canvases, opts);
    return assignLabelsAsync(all, opts.maxPerChar || 4).then(function (labeled) {
      if (labeled.length) return labeled;
      if (opts.allowFreqFallback) return assignLabelsFreq(all, opts.maxPerChar || 4);
      return labeled;
    });
  }

  function mergeVariants(baseGlyphs, harvested) {
    var out = (baseGlyphs || []).slice();
    var by = Object.create(null);
    out.forEach(function (g) {
      by[g.ch] = (by[g.ch] || 0) + 1;
    });
    (harvested || []).forEach(function (g) {
      if (!g || !g.ch) return;
      if ((by[g.ch] || 0) >= 4) return;
      out.push(g);
      by[g.ch] = (by[g.ch] || 0) + 1;
    });
    return out;
  }

  const Harvest = {
    harvestFromPages: harvestFromPages,
    harvestFromPagesAsync: harvestFromPagesAsync,
    mergeVariants: mergeVariants,
    medianCellMetrics: medianCellMetrics,
    inkMask: inkMask,
    components: components,
    assignLabelsAsync: assignLabelsAsync,
    FREQ: FREQ
  };

export { Harvest };
export default Harvest;
