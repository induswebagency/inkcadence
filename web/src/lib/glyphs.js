/* glyphs.js — printable-sheet spec, cell extraction, alpha glyphs, tinting. */
'use strict';
var CHARS = 'abcdefghijklmnopqrstuvwxyz' +
              'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
              '0123456789' +
              '.,!?-:;"\'()/&@#+*=';
  var COLS = 13;
  var ROWS = Math.ceil(CHARS.length / COLS);
  /* Thin / sparse ink — punctuation and slender letters need softer thresholds. */
  var SOFT = '.,!?-:;"\'()/&@#+*=iljI1|`';

  function baseCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function percentileFromHist(hist, n, q) {
    var target = n * q, acc = 0, i;
    for (i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }

  function percentileFromHistDesc(hist, n, q) {
    var target = n * (1 - q), acc = 0, i;
    for (i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= n - target) return i;
    }
    return 0;
  }

  /* crop one cell and turn it into a transparent alpha glyph */
  function extractCell(scan, cx, cy, cw, ch, pad, expectedChar) {
    var ctx = scan.getContext('2d');
    var sx = Math.max(0, Math.round(cx)), sy = Math.max(0, Math.round(cy));
    var sw = Math.min(scan.width - sx, Math.round(cw)), shh = Math.min(scan.height - sy, Math.round(ch));
    if (sw < 6 || shh < 6) return null;

    var soft = expectedChar && SOFT.indexOf(expectedChar) >= 0;
    var img = ctx.getImageData(sx, sy, sw, shh);
    var d = img.data, n = sw * shh;
    var lum = new Float32Array(n), hist = new Uint32Array(256), i, p;

    for (i = 0, p = 0; i < d.length; i += 4, p++) {
      var L = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      lum[p] = L;
      hist[L | 0]++;
    }

    /* Paper = bright tail. Dense ink fills used to poison the 92nd percentile. */
    var paper = percentileFromHistDesc(hist, n, 0.985);
    if (paper < 170) paper = Math.max(paper, percentileFromHistDesc(hist, n, 0.995));
    if (paper < 150) {
      /* Sample corners (printed sheets are bright around the glyph). */
      var corners = [2, 3, sw - 4, sw - 3];
      var bright = 0, bn = 0, yy, xx;
      for (yy = 2; yy < Math.min(12, shh); yy++) {
        for (i = 0; i < corners.length; i++) {
          xx = corners[i];
          if (xx < 0 || xx >= sw) continue;
          bright += lum[yy * sw + xx];
          bn++;
        }
      }
      for (yy = Math.max(2, shh - 12); yy < shh - 2; yy++) {
        for (i = 0; i < corners.length; i++) {
          xx = corners[i];
          if (xx < 0 || xx >= sw) continue;
          bright += lum[yy * sw + xx];
          bn++;
        }
      }
      if (bn) paper = Math.max(paper, bright / bn);
    }

    var inkLum = percentileFromHist(hist, n, soft ? 0.005 : 0.03);
    /* For soft glyphs, also consider absolute darkest pixel so pale dots count. */
    if (soft) {
      var absMin = 255, qi;
      for (qi = 0; qi < 256; qi++) if (hist[qi]) { absMin = qi; break; }
      inkLum = Math.min(inkLum, absMin + 8);
    }
    var minContrast = soft ? 16 : 48;
    if (paper - inkLum < minContrast) return null;

    var floor = soft ? 0.05 : 0.12;
    var alphaCut = soft ? 5 : 12;
    var alpha = new Uint8ClampedArray(n);
    var minX = sw, minY = shh, maxX = -1, maxY = -1, count = 0;
    var span = Math.max(1, paper - inkLum);

    for (var y = 0; y < shh; y++) {
      for (var x = 0; x < sw; x++) {
        p = y * sw + x;
        /* ignore printed border + corner tag */
        if (x < 2 || y < 2 || x > sw - 3 || y > shh - 3 || (x < sw * 0.22 && y < shh * 0.2)) continue;
        var a = (paper - lum[p]) / span;
        a = a <= floor ? 0 : (a > 1 ? 255 : (a - floor) / (1 - floor) * 255);
        if (a < alphaCut) a = 0;
        alpha[p] = a;
        if (a > 0) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    var minDens = soft ? 0.0006 : 0.003;
    if (count < Math.max(soft ? 8 : 20, n * minDens) || maxX < 0) return null;
    if (pad) {
      minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
      maxX = Math.min(sw - 1, maxX + 1); maxY = Math.min(shh - 1, maxY + 1);
    }

    var gw = maxX - minX + 1, gh = maxY - minY + 1;
    if (gw < 2 || gh < 2) return null;
    if (!soft && (gw < 3 || gh < 3)) return null;

    var out = baseCanvas(gw, gh);
    var octx = out.getContext('2d');
    var od = octx.createImageData(gw, gh);
    for (var yy = 0; yy < gh; yy++) {
      for (var xx = 0; xx < gw; xx++) {
        var sp = (yy + minY) * sw + (xx + minX);
        var op = (yy * gw + xx) * 4;
        od.data[op] = 255; od.data[op + 1] = 255; od.data[op + 2] = 255;
        od.data[op + 3] = alpha[sp];
      }
    }
    octx.putImageData(od, 0, 0);

    return {
      url: out.toDataURL('image/png'),
      w: gw, h: gh,
      bx: minX,
      by: Math.round(ch * 0.76) - minY,
      adv: Math.min(sw, maxX + 1) + Math.round(cw * 0.06),
      cellH: ch,
      cellW: cw
    };
  }

  function extractGlyphs(scan, rect, cols, rows, chars) {
    var cw = rect.w / cols, ch = rect.h / rows;
    var out = [], missing = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var idx = r * cols + c;
        if (idx >= chars.length) continue;
        var ch2 = chars[idx];
        var g = extractCell(scan, rect.x + c * cw, rect.y + r * ch, cw, ch, true, ch2);
        if (g) { g.ch = ch2; out.push(g); }
        else missing.push(ch2);
      }
    }
    return { glyphs: out, missing: missing, cols: cols, rows: rows };
  }

  /* Quick score: try a spread of cells and count successful extractions. */
  function scoreSheetGrid(scan, rect, cols, rows, chars) {
    cols = cols || COLS;
    rows = rows || ROWS;
    chars = chars || CHARS;
    var cw = rect.w / cols, ch = rect.h / rows;
    var probes = [
      0, 1, 2, 12, 13, 14, 25, 26, 27, 38, 39, 40,
      51, 52, 53, 62, 63, 64, 70, 75, 79
    ];
    var hit = 0, tried = 0, i;
    for (i = 0; i < probes.length; i++) {
      var idx = probes[i];
      if (idx >= chars.length) continue;
      tried++;
      var r = (idx / cols) | 0, c = idx % cols;
      if (extractCell(scan, rect.x + c * cw, rect.y + r * ch, cw, ch, true, chars[idx])) hit++;
    }
    return tried ? hit / tried : 0;
  }

  function latticeCandidate(scan, cols, rows) {
    var w = scan.width, h = scan.height;
    var maxDim = 900;
    var s = Math.min(1, maxDim / Math.max(w, h));
    var sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
    var tmp = baseCanvas(sw, sh);
    tmp.getContext('2d').drawImage(scan, 0, 0, sw, sh);
    var data = tmp.getContext('2d').getImageData(0, 0, sw, sh).data;

    function isEdge(x, y) {
      var i = (y * sw + x) * 4;
      var L = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      return L < 205;
    }

    var colScore = new Float32Array(sw);
    var rowScore = new Float32Array(sh);
    var x, y;
    for (y = Math.floor(sh * 0.05); y < sh * 0.98; y += 2) {
      for (x = 0; x < sw; x++) if (isEdge(x, y)) colScore[x]++;
    }
    for (x = Math.floor(sw * 0.03); x < sw * 0.97; x += 2) {
      for (y = 0; y < sh; y++) if (isEdge(x, y)) rowScore[y]++;
    }

    function peaks(score, count, minGap, lo, hi) {
      var sorted = [];
      for (var i = lo; i < hi; i++) sorted.push({ i: i, v: score[i] });
      sorted.sort(function (a, b) { return b.v - a.v; });
      var out = [];
      for (var k = 0; k < sorted.length && out.length < count; k++) {
        var p = sorted[k];
        if (p.v < 3) break;
        var ok = true;
        for (var j = 0; j < out.length; j++) {
          if (Math.abs(out[j] - p.i) < minGap) { ok = false; break; }
        }
        if (ok) out.push(p.i);
      }
      out.sort(function (a, b) { return a - b; });
      return out;
    }

    var vPeaks = peaks(colScore, cols + 1, Math.max(5, (sw / (cols + 4)) | 0), 0, sw);
    var hPeaks = peaks(rowScore, rows + 1, Math.max(5, (sh / (rows + 4)) | 0), Math.floor(sh * 0.04), sh);
    if (vPeaks.length < cols || hPeaks.length < rows) return null;
    var vx0 = vPeaks[0], vx1 = vPeaks[Math.min(vPeaks.length - 1, cols)];
    var hy0 = hPeaks[0], hy1 = hPeaks[Math.min(hPeaks.length - 1, rows)];
    if (vx1 <= vx0 + 20 || hy1 <= hy0 + 20) return null;
    return {
      x: vx0 / s,
      y: hy0 / s,
      w: (vx1 - vx0) / s,
      h: (hy1 - hy0) / s
    };
  }

  /* Find the writing grid: score several candidates and keep the best. */
  function detectSheetGrid(scan, cols, rows) {
    cols = cols || COLS;
    rows = rows || ROWS;
    var w = scan.width, h = scan.height;
    var candidates = [];
    var defaults = [
      { x: w * 0.045, y: h * 0.085, w: w * 0.91, h: h * 0.86 },
      { x: w * 0.04, y: h * 0.07, w: w * 0.92, h: h * 0.88 },
      { x: w * 0.05, y: h * 0.1, w: w * 0.9, h: h * 0.84 },
      { x: 70, y: 160, w: w - 140, h: h - 240 },
      { x: w * 0.06, y: h * 0.14, w: w * 0.88, h: h * 0.72 }
    ];
    var i;
    for (i = 0; i < defaults.length; i++) candidates.push(defaults[i]);

    var lat = latticeCandidate(scan, cols, rows);
    if (lat) {
      candidates.push(lat);
      candidates.push({ x: lat.x - 8, y: lat.y + 20, w: lat.w + 16, h: lat.h - 10 });
      candidates.push({ x: lat.x - 15, y: lat.y + 40, w: lat.w + 30, h: lat.h - 20 });
      candidates.push({ x: lat.x + 5, y: lat.y + 60, w: lat.w - 10, h: lat.h - 40 });
    }

    var best = candidates[0], bestScore = -1;
    for (i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c || c.w < 40 || c.h < 40) continue;
      if (c.x < 0) { c.w += c.x; c.x = 0; }
      if (c.y < 0) { c.h += c.y; c.y = 0; }
      c.w = Math.min(c.w, w - c.x);
      c.h = Math.min(c.h, h - c.y);
      var sc = scoreSheetGrid(scan, c, cols, rows, CHARS);
      if (sc > bestScore) { bestScore = sc; best = c; }
      if (sc >= 0.95) break;
    }

    return {
      x: best.x,
      y: best.y,
      w: best.w,
      h: best.h,
      confidence: Math.max(0.2, Math.min(1, bestScore))
    };
  }

  function rectToPercents(rect, scanW, scanH) {
    return {
      gx: Math.round((rect.x / scanW) * 1000) / 10,
      gy: Math.round((rect.y / scanH) * 1000) / 10,
      gw: Math.round((rect.w / scanW) * 1000) / 10,
      gh: Math.round((rect.h / scanH) * 1000) / 10
    };
  }

  var tintCache = Object.create(null);

  function tint(glyph, colour, opts) {
    opts = opts || {};
    var bleed = opts.bleed || 0;
    var key = glyph.url.length + ':' + glyph.url.slice(-18) + '|' + colour + '|b' + (bleed > 0.2 ? '1' : '0');
    var hit = tintCache[key];
    if (hit) return hit;

    var c = baseCanvas(glyph.w, glyph.h);
    var ctx = c.getContext('2d');
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, glyph.w, glyph.h);
    ctx.globalCompositeOperation = 'destination-in';
    if (glyph._img && glyph._img.complete) ctx.drawImage(glyph._img, 0, 0);
    /* Soft pressure fringe without changing glyph bounds. */
    if (bleed > 0.25 && glyph._img && glyph._img.complete) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.18 * Math.min(1, bleed);
      ctx.drawImage(c, 0.6, 0);
      ctx.drawImage(c, -0.6, 0);
      ctx.globalAlpha = 1;
    }
    tintCache[key] = c;
    return c;
  }

  function hydrate(pack) {
    var glyphs = pack.glyphs || [];
    return Promise.all(glyphs.map(function (g, i) {
      g.__id = i;
      return new Promise(function (resolve) {
        var im = new Image();
        im.onload = function () { g._img = im; resolve(); };
        im.onerror = function () { resolve(); };
        im.src = g.url;
      });
    }));
  }

  function groupByChar(glyphs) {
    var map = Object.create(null);
    glyphs.forEach(function (g) {
      (map[g.ch] || (map[g.ch] = [])).push(g);
    });
    return map;
  }

  const Glyphs = {
    CHARS: CHARS, COLS: COLS, ROWS: ROWS,
    extractGlyphs: extractGlyphs,
    detectSheetGrid: detectSheetGrid,
    scoreSheetGrid: scoreSheetGrid,
    rectToPercents: rectToPercents,
    hydrate: hydrate,
    tint: tint,
    groupByChar: groupByChar
  };

export { Glyphs };
export default Glyphs;
