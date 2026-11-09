/* app.js — UI wiring: auth, training, style packs, writing. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var S = {
    user: null,
    packs: [],
    activeId: null,
    refImages: [],
    sheetSrc: null,
    lastPages: [],
    pen: null
  };

  function msg(el, text, kind) {
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.textContent = text || '';
  }
  function card(el, text, kind) {
    el.innerHTML = text ? '<div class="' + (kind === 'bad' ? 'err' : 'hint') + '">' + text + '</div>' : '';
  }

  /* ---------------- auth ---------------- */
  function showAuth() {
    $('authView').hidden = false;
    $('appView').hidden = true;
  }
  function showApp() {
    $('authView').hidden = true;
    $('appView').hidden = false;
  }

  function afterLogin(user) {
    S.user = user;
    $('whoami').textContent = user;
    $('avatar').textContent = user.charAt(0).toUpperCase();
    showApp();
    return refreshPacks();
  }

  $('btnLogin').onclick = function () {
    msg($('authMsg'), 'Checking…');
    Store.login($('authUser').value, $('authPass').value)
      .then(afterLogin)
      .then(function () { msg($('authMsg'), ''); })
      .catch(function (e) { msg($('authMsg'), e.message, 'bad'); });
  };

  $('btnSignup').onclick = function () {
    msg($('authMsg'), 'Creating…');
    Store.signup($('authUser').value, $('authPass').value)
      .then(afterLogin)
      .then(function () { msg($('authMsg'), ''); })
      .catch(function (e) { msg($('authMsg'), e.message, 'bad'); });
  };

  $('authPass').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('btnLogin').click();
  });

  $('btnLogout').onclick = function () {
    Store.logout().then(function () { S.user = null; S.packs = []; showAuth(); });
  };

  /* ---------------- packs ---------------- */
  function refreshPacks() {
    return Store.packs(S.user).then(function (list) {
      S.packs = list || [];
      if (!S.activeId && S.packs.length) S.activeId = S.packs[0].id;
      var exists = S.packs.some(function (p) { return p.id === S.activeId; });
      if (!exists) S.activeId = S.packs.length ? S.packs[0].id : null;
      renderPackList();
      renderPackSelect();
      return S.packs;
    });
  }

  function renderPackList() {
    var ul = $('packList');
    ul.innerHTML = '';
    if (!S.packs.length) {
      var li = document.createElement('li');
      li.className = 'muted small';
      li.style.cursor = 'default';
      li.textContent = 'No packs yet — build one in Train.';
      ul.appendChild(li);
      return;
    }
    S.packs.forEach(function (p) {
      var li = document.createElement('li');
      li.className = p.id === S.activeId ? 'active' : '';
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = (p.penColours && p.penColours[0]) || '#2f6fed';
      var name = document.createElement('span');
      name.textContent = p.name;
      name.style.flex = '1';
      var del = document.createElement('button');
      del.className = 'tiny ghost';
      del.textContent = '×';
      del.style.padding = '2px 7px';
      del.onclick = function (ev) {
        ev.stopPropagation();
        if (!confirm('Delete style pack "' + p.name + '"?')) return;
        Store.deletePack(S.user, p.id).then(function (list) {
          S.packs = list;
          if (S.activeId === p.id) S.activeId = list.length ? list[0].id : null;
          renderPackList();
          renderPackSelect();
        });
      };
      li.onclick = function () {
        S.activeId = p.id;
        renderPackList();
        renderPackSelect();
        showResult(p);
      };
      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function renderPackSelect() {
    var sel = $('wPack');
    sel.innerHTML = '';
    if (!S.packs.length) {
      var o = document.createElement('option');
      o.textContent = '— no style pack yet —';
      o.value = '';
      sel.appendChild(o);
      return;
    }
    S.packs.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      if (p.id === S.activeId) o.selected = true;
      sel.appendChild(o);
    });
    syncPenSwatches();
  }

  $('wPack').onchange = function () {
    S.activeId = this.value;
    renderPackList();
    syncPenSwatches();
  };

  function activePack() {
    for (var i = 0; i < S.packs.length; i++) if (S.packs[i].id === S.activeId) return S.packs[i];
    return null;
  }

  function syncPenSwatches() {
    var p = activePack();
    var box = $('wColor');
    box.innerHTML = '';
    var colours = (p && p.penColours && p.penColours.length) ? p.penColours : ['#1b2a4a', '#123a8c', '#111111'];
    S.pen = colours[0];
    colours.forEach(function (hex, i) {
      var b = document.createElement('button');
      b.style.background = hex;
      b.title = hex;
      if (i === 0) b.className = 'on';
      b.onclick = function () {
        S.pen = hex;
        Array.prototype.forEach.call(box.children, function (c) { c.className = ''; });
        b.className = 'on';
      };
      box.appendChild(b);
    });
  }

  /* ---------------- tabs ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.className = ''; });
      b.className = 'on';
      $('tabTrain').hidden = b.dataset.tab !== 'train';
      $('tabWrite').hidden = b.dataset.tab !== 'write';
      if (b.dataset.tab === 'write') syncPenSwatches();
    };
  });

  $('btnNewPack').onclick = function () {
    S.activeId = null;
    $('packName').value = '';
    $('thumbsRef').innerHTML = '';
    S.refImages = [];
    S.sheetSrc = null;
    $('sheetWrap').hidden = true;
    card($('buildMsg'), '');
    document.querySelector('.tabs button[data-tab="train"]').click();
  };

  /* ---------------- training: uploads ---------------- */
  $('btnPickRef').onclick = function () { $('fileRef').click(); };
  $('btnPickSheet').onclick = function () { $('fileSheet').click(); };

  $('fileRef').onchange = function () {
    var files = Array.prototype.slice.call(this.files || []).slice(0, 8);
    if (!files.length) return;
    card($('buildMsg'), 'Reading ' + files.length + ' page(s)…');
    S.refImages = [];
    $('thumbsRef').innerHTML = '';
    Promise.all(files.map(function (f) {
      return Imaging.loadImageFile(f).catch(function () { return null; });
    })).then(function (canvases) {
      S.refImages = canvases.filter(Boolean);
      S.refImages.forEach(function (c) {
        var t = document.createElement('canvas');
        var s = 150 / c.width;
        t.width = 150; t.height = Math.round(c.height * s);
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        t.style.width = '74px';
        t.style.height = 'auto';
        t.style.borderRadius = '6px';
        t.style.border = '1px solid var(--line)';
        $('thumbsRef').appendChild(t);
      });
      card($('buildMsg'), S.refImages.length
        ? S.refImages.length + ' page(s) ready. Add a template sheet for your letterforms, then analyze.'
        : '<span>Could not decode those files.</span>', S.refImages.length ? '' : 'bad');
    });
  };

  $('fileSheet').onchange = function () {
    var f = (this.files || [])[0];
    if (!f) return;
    Imaging.loadImageFile(f).then(function (c) {
      S.sheetSrc = c;
      $('sheetWrap').hidden = false;
      autoAlignSheetGrid();
      drawSheetPreview();
      card($('buildMsg'), 'Sheet loaded. Grid auto-aligned — tweak sliders if a cell looks off.');
    }).catch(function (e) { card($('buildMsg'), e.message, 'bad'); });
  };

  ['gx', 'gy', 'gw', 'gh'].forEach(function (id) {
    $(id).addEventListener('input', drawSheetPreview);
  });

  function setGridPercents(p) {
    if ($('gx')) $('gx').value = String(p.gx);
    if ($('gy')) $('gy').value = String(p.gy);
    if ($('gw')) $('gw').value = String(p.gw);
    if ($('gh')) $('gh').value = String(p.gh);
  }

  function autoAlignSheetGrid() {
    if (!S.sheetSrc || !Glyphs.detectSheetGrid) return;
    var fallback = { gx: 4.5, gy: 8.5, gw: 91, gh: 86 };
    var rect = Glyphs.detectSheetGrid(S.sheetSrc, Glyphs.COLS, Glyphs.ROWS);
    var trial = Glyphs.extractGlyphs(S.sheetSrc, rect, Glyphs.COLS, Glyphs.ROWS, Glyphs.CHARS);
    if (trial.glyphs.length >= Glyphs.CHARS.length * 0.85) {
      setGridPercents(Glyphs.rectToPercents(rect, S.sheetSrc.width, S.sheetSrc.height));
    } else {
      setGridPercents(fallback);
    }
  }

  if ($('btnAutoGrid')) {
    $('btnAutoGrid').onclick = function () {
      if (!S.sheetSrc) { card($('buildMsg'), 'Load a sheet first.', 'bad'); return; }
      autoAlignSheetGrid();
      drawSheetPreview();
      card($('buildMsg'), 'Grid re-aligned from the sheet scan.');
    };
  }

  function gridRect(src) {
    var x = src.width * (+$('gx').value / 100);
    var y = src.height * (+$('gy').value / 100);
    var w = src.width * (+$('gw').value / 100);
    var h = src.height * (+$('gh').value / 100);
    return { x: x, y: y, w: Math.min(w, src.width - x), h: Math.min(h, src.height - y) };
  }

  function drawSheetPreview() {
    var src = S.sheetSrc;
    var cv = $('sheetCanvas');
    if (!src) { cv.hidden = true; return; }
    var W = 520, H = Math.round(W * src.height / src.width);
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.drawImage(src, 0, 0, W, H);

    var rect = gridRect(src);
    var sx = W / src.width, sy = H / src.height;
    var cw = rect.w / Glyphs.COLS, ch = rect.h / Glyphs.ROWS;
    ctx.strokeStyle = 'rgba(47,111,237,.85)';
    ctx.lineWidth = 1;
    for (var i = 0; i <= Glyphs.COLS; i++) {
      var x = (rect.x + i * cw) * sx;
      ctx.beginPath(); ctx.moveTo(x, rect.y * sy); ctx.lineTo(x, (rect.y + rect.h) * sy); ctx.stroke();
    }
    for (var j = 0; j <= Glyphs.ROWS; j++) {
      var y = (rect.y + j * ch) * sy;
      ctx.beginPath(); ctx.moveTo(rect.x * sx, y); ctx.lineTo((rect.x + rect.w) * sx, y); ctx.stroke();
    }
    cv.hidden = false;
  }

  /* ---------------- training: build ---------------- */
  $('btnBuild').onclick = function () {
    var name = $('packName').value.trim();
    if (!name) { card($('buildMsg'), 'Give the style pack a name first.', 'bad'); return; }
    if (!S.refImages.length && !S.sheetSrc) {
      card($('buildMsg'), 'Add at least one old assignment or a template sheet.', 'bad');
      return;
    }

    var btn = $('btnBuild');
    btn.disabled = true;
    $('buildState').textContent = 'working…';
    card($('buildMsg'), 'Analyzing your pages…');

    setTimeout(function () {
      try {
        var stats = null;
        if (S.refImages.length) {
          var analyses = S.refImages.map(function (c) { return Imaging.analyze(c); });
          stats = Imaging.mergeAnalyses(analyses);
        }

        var glyphs = [], missing = [], cellH = 92, cellW = 70;
        if (S.sheetSrc) {
          var rect = gridRect(S.sheetSrc);
          var res = Glyphs.extractGlyphs(S.sheetSrc, rect, Glyphs.COLS, Glyphs.ROWS, Glyphs.CHARS);
          glyphs = res.glyphs;
          missing = res.missing;
          cellH = rect.h / Glyphs.ROWS;
          cellW = rect.w / Glyphs.COLS;
        }

        if (!stats) {
          stats = {
            pages: 0,
            slant: 0.1,
            strokeWidth: 3,
            lineGap: Math.round(cellH * 1.7),
            inkRatio: 0,
            paper: '#fdfcf7',
            palette: [{ hex: '#1b2a4a', kind: 'pen', share: 100 }],
            thumbs: []
          };
        }

        var pens = stats.palette.filter(function (c) { return c.kind !== 'faint'; })
          .map(function (c) { return c.hex; });
        if (!pens.length) pens = ['#1b2a4a'];
        pens = pens.slice(0, 4);

        var pack = {
          id: 'pk_' + Date.now().toString(36),
          name: name,
          created: Date.now(),
          cellH: cellH,
          cellW: cellW,
          glyphs: glyphs,
          missing: missing,
          stats: stats,
          penColours: pens,
          paper: stats.paper
        };

        Store.savePack(S.user, pack).then(function () {
          btn.disabled = false;
          $('buildState').textContent = '';
          S.activeId = pack.id;
          return refreshPacks().then(function () { showResult(pack); });
        }).catch(function (e) {
          btn.disabled = false;
          $('buildState').textContent = '';
          card($('buildMsg'), 'Could not save: ' + e.message + ' — try fewer/smaller pages.', 'bad');
        });
      } catch (e) {
        btn.disabled = false;
        $('buildState').textContent = '';
        card($('buildMsg'), 'Analysis failed: ' + e.message, 'bad');
      }
    }, 30);
  };

  function showResult(pack) {
    if (!pack) return;
    var st = pack.stats || {};
    var body = $('resultBody');
    var html = '';

    html += '<div class="stats">' +
      stat(st.pages || 0, 'reference pages') +
      stat(st.slant ? (st.slant * 100).toFixed(0) + '%' : '—', 'slant') +
      stat(st.strokeWidth || '—', 'stroke px') +
      stat(st.lineGap || '—', 'line spacing') +
      stat((pack.glyphs || []).length, 'letterforms') +
      '</div>';

    if (!(pack.glyphs || []).length) {
      html += '<div class="hint" style="margin-bottom:12px">No letterforms yet — this pack only knows the <b>look</b> ' +
        '(ink, slant, spacing). Writing will use a generic hand. Add a filled <b>template sheet</b> to capture your own letterforms.</div>';
    }

    if (pack.penColours && pack.penColours.length) {
      html += '<div class="field"><label class="small muted">Detected inks</label><div class="swatch" style="margin-top:4px">';
      pack.penColours.forEach(function (h) {
        html += '<button style="background:' + h + '" title="' + h + '"></button>';
      });
      html += '</div></div>';
    }

    if (pack.missing && pack.missing.length) {
      html += '<p class="small muted"><b>' + pack.missing.length + '</b> cell(s) were empty: ' +
        pack.missing.join(' ') + ' — those characters will fall back to a gap. Re-scan the sheet to fix.</p>';
    }

    if ((pack.glyphs || []).length) {
      html += '<div class="field"><label class="small muted">Extracted letterforms</label><div class="glyphgrid">';
      pack.glyphs.slice(0, 90).forEach(function (g) {
        html += '<figure><img src="' + g.url + '" alt="' + esc(g.ch) + '"><figcaption>' + esc(g.ch) + '</figcaption></figure>';
      });
      html += '</div></div>';
    }

    if (st.thumbs && st.thumbs.length) {
      html += '<div class="field"><label class="small muted">Reference pages</label><div class="thumbs">';
      st.thumbs.slice(0, 6).forEach(function (t) { html += '<img src="' + t + '">'; });
      html += '</div></div>';
    }

    body.innerHTML = html;
    $('resultCard').hidden = false;
    card($('buildMsg'), 'Saved to <b>' + esc(pack.name) + '</b> in your account.', '');
  }

  function stat(v, label) {
    return '<div class="stat"><b>' + v + '</b><span>' + label + '</span></div>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------- writing ---------------- */
  $('btnRender').onclick = function () {
    var pack = activePack();
    if (!pack) { card($('writeMsg'), 'Create a style pack in the Train tab first.', 'bad'); return; }

    var btn = $('btnRender');
    btn.disabled = true;
    card($('writeMsg'), 'Laying out pages…');

    Glyphs.hydrate(pack).then(function () {
      var pages = Rendering.renderPages({
        text: $('wText').value,
        pack: pack,
        size: +$('wSize').value,
        jitter: +$('wJitter').value / 100,
        seed: +$('wSeed').value,
        penColour: S.pen || (pack.penColours && pack.penColours[0]) || '#1b2a4a',
        paper: $('wPaper').value,
        paperColour: pack.paper || '#fdfcf7',
        headingStyle: $('wHeading').value,
        watermark: $('wMark').checked
      });

      S.lastPages = pages;
      var host = $('pages');
      host.innerHTML = '';

      var bar = document.createElement('div');
      bar.className = 'pagebar';
      bar.innerHTML = '<div class="small muted">' + pages.length + ' page(s)</div>';
      var dl = document.createElement('button');
      dl.className = 'ghost tiny';
      dl.textContent = 'Download all PNGs';
      dl.onclick = function () {
        pages.forEach(function (c, i) {
          setTimeout(function () {
            var a = document.createElement('a');
            a.download = (pack.name.replace(/[^\w-]+/g, '_') || 'page') + '_p' + (i + 1) + '.png';
            a.href = c.toDataURL('image/png');
            a.click();
          }, i * 350);
        });
      };
      bar.appendChild(dl);
      host.appendChild(bar);

      pages.forEach(function (c, i) {
        var wrap = document.createElement('div');
        wrap.style.marginBottom = '22px';
        var label = document.createElement('div');
        label.className = 'small muted';
        label.style.textAlign = 'center';
        label.style.marginBottom = '6px';
        label.textContent = 'Page ' + (i + 1);
        c.className = 'page';
        wrap.appendChild(label);
        wrap.appendChild(c);
        host.appendChild(wrap);
      });

      card($('writeMsg'), '');
      btn.disabled = false;
    }).catch(function (e) {
      btn.disabled = false;
      card($('writeMsg'), 'Render failed: ' + e.message, 'bad');
    });
  };

  $('btnPrint').onclick = function () {
    if (!S.lastPages.length) { card($('writeMsg'), 'Render the pages first.', 'bad'); return; }
    var w = window.open('', '_blank');
    if (!w) { card($('writeMsg'), 'Allow pop-ups to open the print view.', 'bad'); return; }
    var imgs = S.lastPages.map(function (c) {
      return '<img src="' + c.toDataURL('image/jpeg', 0.92) + '">';
    }).join('');
    w.document.write('<!doctype html><html><head><title>Print</title><style>' +
      '@page{size:A4;margin:0}body{margin:0;background:#fff}' +
      'img{display:block;width:210mm;height:297mm;page-break-after:always}' +
      '</style></head><body>' + imgs + '</body></html>');
    w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 400);
  };

  /* ---------------- boot ---------------- */
  Store.currentUser().then(function (u) {
    if (u) return afterLogin(u);
    showAuth();
  }).catch(function () { showAuth(); });
})();
