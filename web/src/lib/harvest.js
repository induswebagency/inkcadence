/* harvest.js — pull letter-like ink crops from full assignment pages.
   Used when no alphabet sheet is provided (or to enrich sheet glyphs with variants). */
'use strict';
var FREQ = 'etaoinshrdlcumwfgypbvkjxqzETAOINSHRDLCUMWFGYPBVKJXQZ0123456789';

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

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
    var paper = 200, acc = 0, target = n * 0.015;
    for (i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= target) { paper = i; break; }
    }
    /* Phone photos often have warmer/dimmer paper — widen ink cut. */
    var cut = paper - (paper < 190 ? 36 : 42);
    if (paper < 170) cut = paper - 28;
    var mask = new Uint8Array(n);
    for (p = 0; p < n; p++) mask[p] = lum[p] < cut ? 1 : 0;
    return { mask: mask, lum: lum, w: w, h: h, scale: scale, paper: paper, canvas: c };
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
        if (count < 28 || bw < 4 || bh < 8) continue;
        if (bw > w * 0.45 || bh > h * 0.28) continue;
        var aspect = bw / bh;
        if (aspect > 2.8 || aspect < 0.12) continue;
        comps.push({ minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: bw, h: bh, count: count });
      }
    }
    comps.sort(function (a, b) { return b.count - a.count; });
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
          a = Math.max(40, Math.min(255, (paper - srcInfo.lum[sp]) * 2.2));
        }
        od.data[op] = 255;
        od.data[op + 1] = 255;
        od.data[op + 2] = 255;
        od.data[op + 3] = a;
      }
    }
    octx.putImageData(od, 0, 0);
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
      confidence: Math.min(0.95, 0.35 + box.count / 400)
    };
  }

  function assignLabels(crops, maxPerChar) {
    maxPerChar = maxPerChar || 4;
    var glyphs = [];
    var counts = Object.create(null);
    var i, ch, g;
    for (i = 0; i < crops.length; i++) {
      ch = FREQ[i % FREQ.length];
      if ((counts[ch] || 0) >= maxPerChar) continue;
      g = crops[i];
      g.ch = ch;
      glyphs.push(g);
      counts[ch] = (counts[ch] || 0) + 1;
    }
    return glyphs;
  }

  /* Harvest letter crops from one or more assignment canvases. */
  function harvestFromPages(canvases, opts) {
    opts = opts || {};
    var maxCrops = opts.maxCrops || 120;
    var maxPerChar = opts.maxPerChar || 4;
    var all = [];
    (canvases || []).forEach(function (src) {
      if (!src) return;
      var info = inkMask(src, opts.maxW || 900);
      var comps = components(info.mask, info.w, info.h).slice(0, 80);
      comps.forEach(function (box) {
        all.push(cropToGlyph(info, box));
      });
    });
    all.sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
    all = all.slice(0, maxCrops);
    return assignLabels(all, maxPerChar);
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
    mergeVariants: mergeVariants,
    FREQ: FREQ
  };

export { Harvest };
export default Harvest;
