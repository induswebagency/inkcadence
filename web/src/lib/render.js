'use strict';
import { Glyphs } from './glyphs.js';
/* render.js — lays text out and paints it in the trained hand. */
var PAGE_W = 1240, PAGE_H = 1754;   /* A4 @ 150 dpi */

  function makeRng(seed) {
    var s = (seed | 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function gauss(r) { return (r() + r() + r() - 1.5) / 1.5; }

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function drawPaper(ctx, W, H, paperStyle, paperColour, ruleGap, r) {
    ctx.fillStyle = paperColour || '#fdfcf7';
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < 3000; i++) {
      ctx.fillStyle = 'rgba(120,110,90,' + (0.012 + r() * 0.02) + ')';
      ctx.fillRect(r() * W, r() * H, 1 + r() * 1.6, 1);
    }

    var left = 118, right = W - 96;
    if (paperStyle === 'ruled' || paperStyle === 'grid') {
      ctx.strokeStyle = 'rgba(120,160,200,.32)';
      ctx.lineWidth = 1;
      var gap = paperStyle === 'grid' ? Math.round(ruleGap * 0.72) : ruleGap;
      for (var y = 150; y < H - 80; y += gap) {
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      }
      if (paperStyle === 'grid') {
        ctx.strokeStyle = 'rgba(120,160,200,.2)';
        for (var x = left; x < right; x += gap) {
          ctx.beginPath(); ctx.moveTo(x, 150); ctx.lineTo(x, H - 80); ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(214,120,120,.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(92, 118); ctx.lineTo(92, H - 80); ctx.stroke();
    }
  }

  function buildMetrics(pack, size, tracking) {
    var scale = (size * 1.12) / (pack.cellH || 92);
    var groups = pack.glyphs && pack.glyphs.length ? Glyphs.groupByChar(pack.glyphs) : null;
    var avg = Object.create(null);

    if (groups) {
      Object.keys(groups).forEach(function (ch) {
        var list = groups[ch], sum = 0;
        list.forEach(function (g) { sum += g.adv; });
        avg[ch] = (sum / list.length) * scale + tracking;
      });
    }
    return { scale: scale, groups: groups, avg: avg, tracking: tracking };
  }

  function charWidth(ch, m, ctx, family, size) {
    if (m.groups) {
      var a = m.avg[ch];
      if (a) return a;
      if (ch === ' ') return size * 0.34;
      return size * 0.55;
    }
    ctx.font = size + 'px ' + family;
    return ctx.measureText(ch).width + m.tracking;
  }

  function measure(line, m, ctx, family, size) {
    var w = 0;
    for (var i = 0; i < line.length; i++) w += charWidth(line[i], m, ctx, family, size);
    return w;
  }

  function layout(text, maxW, m, ctx, family, size) {
    var out = [];
    var paras = text.split('\n');
    for (var pi = 0; pi < paras.length; pi++) {
      var raw = paras[pi];
      var heading = /^\s*#/.test(raw);
      var body = heading ? raw.replace(/^\s*#+\s*/, '') : raw;
      if (!body.trim()) { out.push({ text: '', heading: false }); continue; }
      var words = body.split(/\s+/).filter(function (w) { return w.length; });
      var line = '', started = false;
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (measure(test, m, ctx, family, size) > maxW && line) {
          out.push({ text: line, heading: heading && !started });
          started = true;
          line = words[i];
        } else {
          line = test;
        }
      }
      if (line) out.push({ text: line, heading: heading && !started });
    }
    return out;
  }

  function pickVariant(list, r) {
    if (list.length === 1) return list[0];
    return list[(r() * list.length) | 0];
  }

  // Sample-derived pairwise kerning: tighten common joins slightly.
  var KERN = { th: -0.12, he: -0.08, in: -0.06, er: -0.1, an: -0.07, re: -0.08, on: -0.06, at: -0.05, en: -0.07, es: -0.05, of: -0.08, to: -0.06 };
  var LIGATURES = { fi: true, fl: true, ff: true, tt: true, ll: true };

  function glyphJitterProfile(ch) {
    // Ascenders / descenders get slightly different noise profiles.
    if ('bdfhklt'.indexOf(ch) >= 0) return { rot: 0.7, dy: 0.85, dx: 1.0 };
    if ('gjpqy'.indexOf(ch) >= 0) return { rot: 0.85, dy: 1.15, dx: 0.9 };
    if ('iw'.indexOf(ch) >= 0) return { rot: 1.1, dy: 1.0, dx: 1.2 };
    return { rot: 1, dy: 1, dx: 1 };
  }

  function pairKern(a, b, size) {
    if (!a || !b) return 0;
    var key = a + b;
    if (KERN[key]) return KERN[key] * size;
    if (LIGATURES[key]) return -0.14 * size;
    return 0;
  }

  function drawGlyphLine(ctx, line, x0, baseline, m, colour, jitter, r, size) {
    var drift = gauss(r) * jitter * 3.2;
    var tilt = gauss(r) * jitter * 0.006;
    var x = x0 + gauss(r) * jitter * 5;
    var prev = '';

    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === ' ') { x += size * 0.34 * (0.75 + r() * 0.7); prev = ''; continue; }

      var list = m.groups[ch];
      if (!list) { x += size * 0.5; prev = ch; continue; }

      x += pairKern(prev, ch, size);

      var g = pickVariant(list, r);
      var jp = glyphJitterProfile(ch);
      var sc = m.scale * (1 + gauss(r) * jitter * 0.10);
      var rot = tilt + gauss(r) * jitter * 0.055 * jp.rot;
      var dy = drift + gauss(r) * jitter * size * 0.07 * jp.dy;
      var dx = gauss(r) * jitter * size * 0.03 * jp.dx;
      var shear = 0.10 + gauss(r) * jitter * 0.05;
      // Ligature-ish join: pull glyphs slightly closer and raise join alpha.
      var lig = LIGATURES[prev + ch];
      if (lig) { dx -= size * 0.04; shear += 0.02; }

      ctx.save();
      ctx.translate(x + dx, baseline + dy);
      ctx.rotate(rot);
      ctx.transform(1, 0, shear, 1, 0, 0);
      ctx.globalAlpha = (lig ? 0.9 : 0.82) + r() * 0.18;
      ctx.drawImage(Glyphs.tint(g, colour), 0, -g.by * sc, g.w * sc, g.h * sc);
      ctx.restore();
      ctx.globalAlpha = 1;

      x += g.adv * m.scale + m.tracking + gauss(r) * jitter * 1.8;
      prev = ch;
    }
    return x;
  }

  function drawFontLine(ctx, line, x0, baseline, family, size, colour, jitter, r) {
    ctx.font = size + 'px ' + family;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colour;
    var drift = gauss(r) * jitter * 2.4;
    var x = x0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var adv = ctx.measureText(ch).width;
      if (ch === ' ') { x += adv * (0.8 + r() * 0.5); continue; }
      ctx.save();
      ctx.translate(x, baseline + drift + gauss(r) * jitter * size * 0.05);
      ctx.rotate(gauss(r) * jitter * 0.05);
      ctx.transform(1, 0, 0.10 + gauss(r) * jitter * 0.05, 1, 0, 0);
      ctx.globalAlpha = 0.82 + r() * 0.18;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      x += adv * (1 + gauss(r) * jitter * 0.04);
    }
    ctx.globalAlpha = 1;
  }

  function underline(ctx, x0, x1, y, colour, r, style) {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    for (var x = x0; x <= x1; x += 8) {
      ctx.lineTo(x, y + Math.sin(x * 0.09) * 1.1 + (r() - 0.5) * 0.6);
    }
    ctx.stroke();
    if (style === 'double') {
      ctx.beginPath();
      ctx.moveTo(x0, y + 4);
      for (var x2 = x0; x2 <= x1; x2 += 8) ctx.lineTo(x2, y + 4 + Math.sin(x2 * 0.09) * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderPages(opts) {
    var pack = opts.pack || {};
    var text = opts.text || '';
    var size = opts.size || 34;
    var jitter = opts.jitter == null ? 0.55 : opts.jitter;
    var colour = opts.penColour || '#1b2a4a';
    var paperStyle = opts.paper || 'ruled';
    var paperColour = opts.paperColour || '#fdfcf7';
    var family = opts.fontFamily || 'cursive';
    var tracking = opts.tracking == null ? 0.8 : opts.tracking;
    var headingStyle = opts.headingStyle || 'underline';
    var watermark = opts.watermark !== false;

    var W = PAGE_W, H = PAGE_H;
    var marginL = 136, marginR = W - 104;
    var top = 196, bottom = H - 118;
    var letterGap = Math.round(size * 1.68);
    var ruleGap = pack.lineGap && pack.lineGap > 8 ? Math.round(size * 1.68) : letterGap;

    var probe = newCanvas(10, 10).getContext('2d');
    var m = buildMetrics(pack, size, tracking);
    var lines = layout(text, marginR - marginL, m, probe, family, size);

    var pages = [];
    var page = null, ctx = null, y = 0, pageIndex = 0;

    function newPage() {
      page = newCanvas(W, H);
      ctx = page.getContext('2d');
      var pr = makeRng((opts.seed || 1) + pageIndex * 7919);
      drawPaper(ctx, W, H, paperStyle, paperColour, ruleGap, pr);
      pages.push(page);
      pageIndex++;
      y = top;
      return pr;
    }

    var r = newPage();

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var h = ln.heading ? letterGap * 1.45 : letterGap;
      if (y + h > bottom) {
        if (watermark) stamp(ctx, W, H);
        r = newPage();
      }
      if (!ln.text) { y += letterGap * 0.7; continue; }

      var fs = ln.heading ? size * 1.18 : size;
      var lineW;

      if (m.groups) {
        var mm = buildMetrics(pack, fs, tracking);
        lineW = drawGlyphLine(ctx, ln.text, marginL, y + fs, mm, colour, jitter, r, fs);
      } else {
        drawFontLine(ctx, ln.text, marginL, y + fs, family, fs, colour, jitter, r);
        ctx.font = fs + 'px ' + family;
        lineW = marginL + ctx.measureText(ln.text).width;
      }

      if (ln.heading && headingStyle !== 'none') {
        underline(ctx, marginL, Math.min(marginR, lineW), y + fs + 6, colour, r,
          headingStyle === 'double' ? 'double' : 'single');
      }
      y += h;
    }

    if (watermark) stamp(ctx, W, H);
    return pages;
  }

  function stamp(ctx, W, H) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#334455';
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('written with AI assistance', W / 2, H - 38);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  /** Multi-page print/PDF helper — opens a print document the browser can save as PDF. */
  function exportPrintDocument(pages, title) {
    var imgs = pages.map(function (c) {
      return '<img src="' + c.toDataURL('image/jpeg', 0.92) + '">';
    }).join('');
    return '<!doctype html><html><head><title>' + (title || 'Inkcadence') + '</title><style>' +
      '@page{size:A4;margin:0}body{margin:0;background:#fff}' +
      'img{display:block;width:210mm;height:297mm;page-break-after:always}' +
      '</style></head><body>' + imgs + '</body></html>';
  }

  const Rendering = {
    renderPages: renderPages,
    exportPrintDocument: exportPrintDocument,
    PAGE_W: PAGE_W,
    PAGE_H: PAGE_H,
    pairKern: pairKern,
    glyphJitterProfile: glyphJitterProfile
  };

export { Rendering };
export default Rendering;
