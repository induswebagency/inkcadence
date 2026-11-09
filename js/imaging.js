/* imaging.js — pure-JS analysis of a scanned handwriting page.
   Extracts: paper colour, ink palette (pen / marker), slant, stroke width,
   line spacing, x-height, coverage and a thumbnail. No dependencies. */
(function (global) {
  'use strict';

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = canvas(img.naturalWidth * s, img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image file.')); };
      img.src = url;
    });
  }

  function toGrayscale(src, maxDim) {
    maxDim = maxDim || 1400;
    var s = Math.min(1, maxDim / Math.max(src.width, src.height));
    var c = canvas(src.width * s, src.height * s);
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    var w = c.width, h = c.height;
    var data = ctx.getImageData(0, 0, w, h).data;
    var gray = new Uint8ClampedArray(w * h);
    var hist = new Uint32Array(256);
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      var g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      gray[p] = g;
      hist[g]++;
    }
    return { gray: gray, hist: hist, w: w, h: h, data: data, canvas: c };
  }

  function otsu(hist) {
    var total = 0, sum = 0, i;
    for (i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
    if (!total) return 128;
    var sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > bestVar) { bestVar = v; best = i; }
    }
    return best;
  }

  function inkMask(gray, w, h, th) {
    var ink = new Uint8Array(w * h);
    for (var i = 0; i < gray.length; i++) ink[i] = gray[i] < th ? 1 : 0;
    return ink;
  }

  /* Colour-aware ink: dark enough, not bright highlighter streaks. */
  function inkMaskRGBA(data, w, h, th) {
    var ink = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum >= th) { ink[p] = 0; continue; }
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var sat = mx ? (mx - mn) / mx : 0;
      /* Drop fluorescent highlighter / marker washes (bright + saturated). */
      if (lum > 140 && sat > 0.28) { ink[p] = 0; continue; }
      if (lum > 165) { ink[p] = 0; continue; }
      ink[p] = 1;
    }
    return ink;
  }

  function estimateSlant(ink, w, h) {
    var xs = [], ys = [];
    for (var y = 0; y < h; y += 2) {
      for (var x = 0; x < w; x += 2) {
        if (ink[y * w + x]) { xs.push(x); ys.push(y); }
      }
    }
    if (xs.length < 300) return 0;
    var best = 0, bestVar = -1;
    for (var si = -12; si <= 12; si++) {
      var sh = si / 20, mn = 1e9, mx = -1e9, k;
      for (k = 0; k < xs.length; k++) {
        var v = xs[k] + sh * ys[k];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx - mn < 5) continue;
      var hist = new Float64Array(160), span = mx - mn;
      for (k = 0; k < xs.length; k++) {
        var vv = xs[k] + sh * ys[k];
        var b = ((vv - mn) / span * 159) | 0;
        hist[b]++;
      }
      var mean = 0;
      for (var b2 = 0; b2 < 160; b2++) mean += hist[b2];
      mean /= 160;
      var vs = 0;
      for (b2 = 0; b2 < 160; b2++) { var d = hist[b2] - mean; vs += d * d; }
      vs /= 160;
      if (vs > bestVar) { bestVar = vs; best = sh; }
    }
    return best;
  }

  function estimateStroke(ink, w, h) {
    var runs = [];
    for (var y = 0; y < h; y += 3) {
      var run = 0;
      for (var x = 0; x < w; x++) {
        if (ink[y * w + x]) run++;
        else { if (run > 0 && run < 40) runs.push(run); run = 0; }
      }
    }
    if (!runs.length) return 2;
    runs.sort(function (a, b) { return a - b; });
    return runs[(runs.length * 0.5) | 0];
  }

  function estimateLines(ink, w, h) {
    var rows = new Float32Array(h), y, x, mx = 0;
    for (y = 0; y < h; y++) {
      var s = 0;
      for (x = 0; x < w; x++) s += ink[y * w + x];
      rows[y] = s;
      if (s > mx) mx = s;
    }
    if (!mx) return { gap: Math.round(h / 30), bands: 0 };
    var bands = [], cur = 0;
    for (y = 0; y < h; y++) {
      if (rows[y] > mx * 0.05) { if (!cur) cur = y; }
      else if (cur) { bands.push([cur, y]); cur = 0; }
    }
    if (cur) bands.push([cur, h]);
    bands = bands.filter(function (b) { return b[1] - b[0] >= 6; });
    var gaps = [];
    for (var i = 1; i < bands.length; i++) gaps.push(bands[i][0] - bands[i - 1][0]);
    gaps.sort(function (a, b) { return a - b; });
    return { gap: gaps.length ? gaps[(gaps.length * 0.5) | 0] : Math.round(h / 30), bands: bands.length };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
    }).join('');
  }

  function clusterColors(data, w, h) {
    var pts = [], step = 2, i;
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        i = (y * w + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (lum < 150 || (mx - mn > 55 && lum < 238)) pts.push([r, g, b, lum]);
      }
    }
    if (pts.length < 40) return [];

    pts.sort(function (a, b) { return a[3] - b[3]; });
    var K = Math.min(3, pts.length);
    var cen = [pts[0], pts[(pts.length * 0.5) | 0], pts[pts.length - 1]].slice(0, K)
      .map(function (p) { return [p[0], p[1], p[2]]; });

    for (var it = 0; it < 8; it++) {
      var sums = cen.map(function () { return [0, 0, 0, 0]; });
      for (var k = 0; k < pts.length; k++) {
        var p = pts[k], bi = 0, bd = Infinity;
        for (var c = 0; c < cen.length; c++) {
          var dr = p[0] - cen[c][0], dg = p[1] - cen[c][1], db = p[2] - cen[c][2];
          var d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; bi = c; }
        }
        sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; sums[bi][3]++;
      }
      for (c = 0; c < cen.length; c++) {
        if (sums[c][3] > 0) {
          cen[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
        }
      }
    }

    var out = [];
    for (var c2 = 0; c2 < cen.length; c2++) {
      var col = cen[c2];
      var share = 0;
      for (k = 0; k < pts.length; k++) {
        var q = pts[k];
        var dd = Math.pow(q[0] - col[0], 2) + Math.pow(q[1] - col[1], 2) + Math.pow(q[2] - col[2], 2);
        if (dd < 2400) share++;
      }
      share /= pts.length;
      if (share < 0.05) continue;
      var R = col[0], G = col[1], B = col[2];
      var lum2 = 0.299 * R + 0.587 * G + 0.114 * B;
      var sat = (Math.max(R, G, B) - Math.min(R, G, B)) / 255;
      var kind = lum2 < 115 ? 'pen' : (sat > 0.18 ? 'marker' : 'faint');
      out.push({ hex: rgbToHex(R, G, B), share: Math.round(share * 100), kind: kind });
    }
    out.sort(function (a, b) { return b.share - a.share; });
    return out;
  }

  function paperColour(data, w, h) {
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < data.length; i += 16) {
      var R = data[i], G = data[i + 1], B = data[i + 2];
      var lum = 0.299 * R + 0.587 * G + 0.114 * B;
      if (lum > 205 && Math.max(R, G, B) - Math.min(R, G, B) < 40) { r += R; g += G; b += B; n++; }
    }
    if (!n) return '#fdfcf7';
    return rgbToHex(r / n, g / n, b / n);
  }

  function deskewGray(gray, w, h, slant) {
    if (!slant || Math.abs(slant) < 0.02) return { gray: gray, w: w, h: h };
    var out = new Uint8ClampedArray(w * h);
    for (var y = 0; y < h; y++) {
      var shift = slant * y;
      for (var x = 0; x < w; x++) {
        var sx = x - shift;
        var x0 = sx | 0;
        if (x0 < 0 || x0 >= w - 1) continue;
        var t = sx - x0;
        out[y * w + x] = gray[y * w + x0] * (1 - t) + gray[y * w + x0 + 1] * t;
      }
    }
    return { gray: out, w: w, h: h };
  }

  function strokeConfidence(ink, w, h, strokeWidth) {
    var runs = [];
    for (var y = 0; y < h; y += 4) {
      var run = 0;
      for (var x = 0; x < w; x++) {
        if (ink[y * w + x]) run++;
        else { if (run > 0 && run < 50) runs.push(run); run = 0; }
      }
    }
    if (runs.length < 20) return 0.35;
    var mean = 0;
    for (var i = 0; i < runs.length; i++) mean += runs[i];
    mean /= runs.length;
    var varSum = 0;
    for (i = 0; i < runs.length; i++) {
      var d = runs[i] - mean;
      varSum += d * d;
    }
    var sd = Math.sqrt(varSum / runs.length);
    var cv = mean ? sd / mean : 1;
    var near = Math.abs(mean - strokeWidth) < 3 ? 1 : 0.7;
    return Math.max(0.2, Math.min(1, (1 - Math.min(1, cv)) * near));
  }

  function analyze(srcCanvas) {
    var g = toGrayscale(srcCanvas, 1400);
    var th = Math.min(otsu(g.hist), 175);
    var ink = inkMaskRGBA(g.data, g.w, g.h, th);
    var slant = estimateSlant(ink, g.w, g.h);
    /* Extreme slant is almost always a polluted mask — clamp for style packs. */
    if (Math.abs(slant) > 0.35) slant = Math.max(-0.35, Math.min(0.35, slant * 0.4));
    var deskewed = deskewGray(g.gray, g.w, g.h, slant);
    /* Rebuild RGBA-scale mask on the original colour field (deskew only for lines/stroke). */
    var ink2 = inkMask(deskewed.gray, deskewed.w, deskewed.h, th);
    /* Prefer colour-aware mask for ratio / palette-adjacent stats when it looks sane. */
    var inkCount = 0, i;
    for (i = 0; i < ink.length; i++) inkCount += ink[i];
    var ratio = inkCount / ink.length;
    if (ratio < 0.002 || ratio > 0.22) {
      inkCount = 0;
      for (i = 0; i < ink2.length; i++) inkCount += ink2[i];
      ratio = inkCount / ink2.length;
    }

    var lines = estimateLines(ink2, deskewed.w, deskewed.h);
    var palette = clusterColors(g.data, g.w, g.h);
    var strokeWidth = estimateStroke(ink2, deskewed.w, deskewed.h);
    var conf = +strokeConfidence(ink2, deskewed.w, deskewed.h, strokeWidth).toFixed(3);
    var patterns = estimatePatterns(ink2, deskewed.w, deskewed.h, lines, conf, slant);

    var thumb = canvas(420, 420 * g.h / g.w);
    thumb.getContext('2d').drawImage(g.canvas, 0, 0, thumb.width, thumb.height);

    return {
      width: srcCanvas.width,
      height: srcCanvas.height,
      threshold: th,
      inkRatio: +ratio.toFixed(4),
      slant: +slant.toFixed(3),
      strokeWidth: strokeWidth,
      strokeConfidence: conf,
      lineGap: lines.gap,
      lineBands: lines.bands,
      paper: paperColour(g.data, g.w, g.h),
      palette: palette,
      patterns: patterns,
      thumb: thumb.toDataURL('image/jpeg', 0.6)
    };
  }

  /* Pattern cues from a full assignment page (no alphabet sheet). */
  function estimatePatterns(ink, w, h, lines, conf, slant) {
    var bands = lines.bands || 0;
    var gap = lines.gap || Math.round(h / 30);
    var topInk = 0, midInk = 0, botInk = 0, i;
    var topEnd = Math.floor(h * 0.22), midEnd = Math.floor(h * 0.72);
    for (i = 0; i < ink.length; i++) {
      if (!ink[i]) continue;
      var y = (i / w) | 0;
      if (y < topEnd) topInk++;
      else if (y < midEnd) midInk++;
      else botInk++;
    }
    var total = Math.max(1, topInk + midInk + botInk);
    var topShare = topInk / total;
    /* Headings / titles usually dump more ink in the upper band. */
    var headingWeight = topShare > 0.34 ? 'strong' : (topShare > 0.22 ? 'medium' : 'none');
    var spacingRegular = bands > 4 && gap > 18 && gap < h * 0.12 ? 0.8 : 0.45;
    var neatness = Math.max(0.15, Math.min(0.98,
      conf * 0.55 + spacingRegular * 0.3 + (1 - Math.min(1, Math.abs(slant) * 2)) * 0.15
    ));
    return {
      neatness: +neatness.toFixed(3),
      headingWeight: headingWeight,
      topInkShare: +topShare.toFixed(3),
      lineBands: bands,
      qualityGuess: neatness >= 0.72 ? 'best' : 'normal'
    };
  }

  /* combine several pages into one style statistic */
  function mergeAnalyses(list) {
    if (!list.length) throw new Error('No pages analysed.');
    var byHex = {}, slants = [], strokes = [], gaps = [], ratios = [];
    var paperVotes = {};
    var confs = [];
    list.forEach(function (a) {
      slants.push(a.slant); strokes.push(a.strokeWidth); gaps.push(a.lineGap); ratios.push(a.inkRatio);
      if (a.strokeConfidence != null) confs.push(a.strokeConfidence);
      paperVotes[a.paper] = (paperVotes[a.paper] || 0) + 1;
      a.palette.forEach(function (c) {
        var e = byHex[c.hex] || (byHex[c.hex] = { hex: c.hex, kind: c.kind, share: 0, hits: 0 });
        e.share += c.share; e.hits++;
        if (!e.kind || e.kind === 'faint') e.kind = c.kind;
      });
    });
    function median(arr) {
      arr.sort(function (a, b) { return a - b; });
      return arr[(arr.length * 0.5) | 0];
    }
    var palette = Object.keys(byHex).map(function (k) { return byHex[k]; })
      .sort(function (a, b) { return (b.hits - a.hits) || (b.share - a.share); })
      .slice(0, 6)
      .map(function (c) {
        return { hex: c.hex, kind: c.kind, share: Math.round(c.share / list.length), pages: c.hits };
      });

    var paper = Object.keys(paperVotes).sort(function (a, b) { return paperVotes[b] - paperVotes[a]; })[0];
    var neatVals = [], headingVotes = { strong: 0, medium: 0, none: 0 };
    list.forEach(function (a) {
      if (a.patterns) {
        if (a.patterns.neatness != null) neatVals.push(a.patterns.neatness);
        if (a.patterns.headingWeight) headingVotes[a.patterns.headingWeight] = (headingVotes[a.patterns.headingWeight] || 0) + 1;
      }
    });
    var headingWeight = Object.keys(headingVotes).sort(function (a, b) {
      return headingVotes[b] - headingVotes[a];
    })[0] || 'medium';
    var neatness = neatVals.length ? +median(neatVals.slice()).toFixed(3) : (confs.length ? +median(confs.slice()).toFixed(3) : 0.5);
    return {
      pages: list.length,
      slant: +median(slants.slice()).toFixed(3),
      strokeWidth: median(strokes.slice()),
      strokeConfidence: confs.length ? +median(confs.slice()).toFixed(3) : 0.5,
      lineGap: median(gaps.slice()),
      inkRatio: +median(ratios.slice()).toFixed(4),
      paper: paper || '#fdfcf7',
      palette: palette,
      patterns: {
        neatness: neatness,
        headingWeight: headingWeight,
        qualityGuess: neatness >= 0.72 ? 'best' : 'normal'
      },
      thumbs: list.map(function (a) { return a.thumb; })
    };
  }

  global.Imaging = {
    loadImageFile: loadImageFile,
    canvas: canvas,
    analyze: analyze,
    mergeAnalyses: mergeAnalyses,
    toGrayscale: toGrayscale,
    otsu: otsu,
    deskewGray: deskewGray,
    strokeConfidence: strokeConfidence,
    inkMaskRGBA: inkMaskRGBA
  };
})(window);
