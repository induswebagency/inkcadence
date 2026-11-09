/* glyphs.js — printable-sheet spec, cell extraction, alpha glyphs, tinting. */
(function (global) {
  'use strict';

  var CHARS = 'abcdefghijklmnopqrstuvwxyz' +
              'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
              '0123456789' +
              '.,!?-:;"\'()/&@#+*=';
  var COLS = 13;
  var ROWS = Math.ceil(CHARS.length / COLS);

  function baseCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* crop one cell and turn it into a transparent alpha glyph */
  function extractCell(scan, cx, cy, cw, ch, pad) {
    var ctx = scan.getContext('2d');
    var sx = Math.max(0, Math.round(cx)), sy = Math.max(0, Math.round(cy));
    var sw = Math.min(scan.width - sx, Math.round(cw)), shh = Math.min(scan.height - sy, Math.round(ch));
    if (sw < 6 || shh < 6) return null;

    var img = ctx.getImageData(sx, sy, sw, shh);
    var d = img.data, n = sw * shh;
    var lum = new Float32Array(n), hist = new Uint32Array(256), i, p;

    for (i = 0, p = 0; i < d.length; i += 4, p++) {
      var L = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      lum[p] = L;
      hist[L | 0]++;
    }

    /* paper level = 92nd percentile of brightness */
    var target = n * 0.92, acc = 0, paper = 230;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= target) { paper = i; break; } }

    /* ink level = darkest decile */
    target = n * 0.02; acc = 0; var inkLum = 40;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) { inkLum = i; break; } }
    if (paper - inkLum < 70) return null;   /* empty cell: only the faint printed guide */

    var alpha = new Uint8ClampedArray(n);
    var minX = sw, minY = shh, maxX = -1, maxY = -1, count = 0;

    for (var y = 0; y < shh; y++) {
      for (var x = 0; x < sw; x++) {
        p = y * sw + x;
        /* ignore the printed border and the cell tag in the top-left corner */
        if (x < 2 || y < 2 || x > sw - 3 || y > shh - 3 || (x < sw * 0.2 && y < shh * 0.18)) continue;
        var a = (paper - lum[p]) / (paper - inkLum);
        a = a <= 0.12 ? 0 : (a > 1 ? 255 : (a - 0.12) / 0.88 * 255);
        if (a < 12) a = 0;
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

    if (count < n * 0.006 || maxX < 0) return null; /* reject near-empty / noise cells */
    if (pad) {
      minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
      maxX = Math.min(sw - 1, maxX + 1); maxY = Math.min(shh - 1, maxY + 1);
    }

    var gw = maxX - minX + 1, gh = maxY - minY + 1;
    if (gw < 3 || gh < 3) return null;

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
      bx: minX,                                  // left bearing inside the cell
      by: Math.round(ch * 0.76) - minY,          // baseline offset inside the crop
      adv: Math.min(sw, maxX + 1) + Math.round(cw * 0.06),
      cellH: ch,
      cellW: cw
    };
  }

  /* rect is in scan pixels: {x,y,w,h} over the writing grid */
  function extractGlyphs(scan, rect, cols, rows, chars) {
    var cw = rect.w / cols, ch = rect.h / rows;
    var out = [], missing = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var idx = r * cols + c;
        if (idx >= chars.length) continue;
        var ch2 = chars[idx];
        var g = extractCell(scan, rect.x + c * cw, rect.y + r * ch, cw, ch, true);
        if (g) { g.ch = ch2; out.push(g); }
        else missing.push(ch2);
      }
    }
    return { glyphs: out, missing: missing, cols: cols, rows: rows };
  }

  /* ---- tint cache: colourise an alpha glyph for the chosen pen ---- */
  var tintCache = Object.create(null);

  function tint(glyph, colour) {
    var key = glyph.url.length + ':' + glyph.url.slice(-18) + '|' + colour;
    var hit = tintCache[key];
    if (hit) return hit;

    var c = baseCanvas(glyph.w, glyph.h);
    var ctx = c.getContext('2d');
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, glyph.w, glyph.h);
    ctx.globalCompositeOperation = 'destination-in';
    if (glyph._img && glyph._img.complete) ctx.drawImage(glyph._img, 0, 0);
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

  global.Glyphs = {
    CHARS: CHARS, COLS: COLS, ROWS: ROWS,
    extractGlyphs: extractGlyphs,
    hydrate: hydrate,
    tint: tint,
    groupByChar: groupByChar
  };
})(window);
