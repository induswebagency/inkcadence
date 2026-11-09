/* app.js — UI wiring: auth, training, style packs, writing. */
(function () {
  'use strict';

  var THEME_KEY = 'inkcadence-theme';
  function paintThemeToggles(theme) {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
      buttons[i].setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }
  function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    }
    paintThemeToggles(theme);
  }
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    var theme = saved || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme, false);
  })();
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-theme-toggle]') : null;
    if (!t) return;
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
  });

  function $(id) { return document.getElementById(id); }

  var S = {
    user: null,
    packs: [],
    activeId: null,
    refImages: [],
    refRegions: [],
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

  function syncAccountMode() {
    var el = $('accountMode');
    if (!el || !window.Store) return;
    var remote = Store.mode() === 'remote';
    el.textContent = remote ? 'synced' : 'on device';
    el.className = 'mode-pill ' + (remote ? 'synced' : 'on-device');
  }

  function builtinPacks() {
    return (window.Presets && Presets.list) ? Presets.list() : [];
  }

  function allPacks() {
    return builtinPacks().concat(S.packs || []);
  }

  function findPack(id) {
    var all = allPacks();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function fillBaseStyleSelect() {
    var sel = $('baseStyle');
    if (!sel) return;
    var builtins = builtinPacks();
    sel.innerHTML = '<option value="auto">Auto-match from my pages</option>';
    builtins.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.quality === 'best' ? ' · best' : ' · normal');
      sel.appendChild(opt);
    });
  }

  function fillLayoutSelect() {
    var sel = $('wLayout');
    if (!sel || !window.Assignment) return;
    sel.innerHTML = '';
    Assignment.layouts().forEach(function (l) {
      var opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      sel.appendChild(opt);
    });
  }

  function applyLayoutPreset() {
    if (!$('wLayout') || !window.Assignment) return;
    var lay = Assignment.layoutById($('wLayout').value);
    if ($('wPaper')) $('wPaper').value = lay.paper;
    if ($('wHeading')) $('wHeading').value = lay.headingStyle;
    if ($('wContinuity')) $('wContinuity').checked = !!lay.continuity;
    if ($('wPageNums')) $('wPageNums').checked = !!lay.pageNumbers;
  }

  function afterLogin(user) {
    S.user = user;
    $('whoami').textContent = user;
    $('avatar').textContent = user.charAt(0).toUpperCase();
    syncAccountMode();
    fillBaseStyleSelect();
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
      var all = allPacks();
      if (!S.activeId && all.length) S.activeId = all[0].id;
      var exists = all.some(function (p) { return p.id === S.activeId; });
      if (!exists) S.activeId = all.length ? all[0].id : null;
      renderPackList();
      renderPackSelect();
      return S.packs;
    });
  }

  function activePack() {
    return findPack(S.activeId);
  }

  function renderPackList() {
    var ul = $('packList');
    var count = $('packCount');
    var all = allPacks();
    if (count) count.textContent = String(all.length);
    ul.innerHTML = '';
    if (!all.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No packs yet. Built-in styles load with the app — try Write, or train from an assignment.';
      ul.appendChild(empty);
      return;
    }
    all.forEach(function (p) {
      var li = document.createElement('li');
      li.className = p.id === S.activeId ? 'active' : '';
      li.title = p.description || p.name;

      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = (p.penColours && p.penColours[0]) || '#2f6fed';

      var body = document.createElement('div');
      body.style.flex = '1';
      body.style.minWidth = '0';
      var name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.name;
      var meta = document.createElement('span');
      meta.className = 'pmeta';
      if (p.builtin) {
        meta.textContent = (p.quality === 'best' ? 'Built-in · best hand' : 'Built-in · normal hand');
      } else {
        var glyphs = (p.glyphs && p.glyphs.length) || 0;
        var pats = (p.stats && p.stats.patterns) || {};
        meta.textContent = pats.qualityGuess
          ? ('From pages · ' + pats.qualityGuess)
          : (glyphs ? glyphs + ' glyphs' : 'Custom from assignment');
      }
      body.appendChild(name);
      body.appendChild(meta);

      li.onclick = function () {
        S.activeId = p.id;
        renderPackList();
        renderPackSelect();
        applyPackDefaults(p);
        if (!p.builtin) showResult(p);
      };

      li.appendChild(dot);
      li.appendChild(body);
      if (!p.builtin) {
        var del = document.createElement('button');
        del.className = 'pack-del';
        del.type = 'button';
        del.setAttribute('aria-label', 'Delete ' + p.name);
        del.textContent = '×';
        del.onclick = function (ev) {
          ev.stopPropagation();
          if (!confirm('Delete style pack "' + p.name + '"?')) return;
          Store.deletePack(S.user, p.id).then(function (list) {
            S.packs = list;
            if (S.activeId === p.id) S.activeId = allPacks()[0] ? allPacks()[0].id : null;
            renderPackList();
            renderPackSelect();
          });
        };
        li.appendChild(del);
      }
      ul.appendChild(li);
    });
  }

  function applyPackDefaults(pack) {
    if (!pack) return;
    if ($('wHeading') && pack.headingStyle) $('wHeading').value = pack.headingStyle;
    if ($('wJitter') && pack.defaultJitter != null) $('wJitter').value = String(Math.round(pack.defaultJitter * 100));
    if ($('wSize') && pack.defaultSize) $('wSize').value = String(pack.defaultSize);
    syncPenSwatches();
  }

  function renderPackSelect() {
    var sel = $('wPack');
    sel.innerHTML = '';
    var all = allPacks();
    if (!all.length) {
      var o = document.createElement('option');
      o.textContent = '— no style pack yet —';
      o.value = '';
      sel.appendChild(o);
      return;
    }
    all.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.builtin
        ? (p.name + (p.quality === 'best' ? ' ★' : ''))
        : p.name;
      if (p.id === S.activeId) o.selected = true;
      sel.appendChild(o);
    });
    syncPenSwatches();
  }

  $('wPack').onchange = function () {
    S.activeId = this.value;
    renderPackList();
    applyPackDefaults(activePack());
    syncPenSwatches();
  };

  function syncPenSwatches() {
    var p = activePack();
    var box = $('wColor');
    if (!box) return;
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
    S.refRegions = [];
    $('thumbsRef').innerHTML = '';
    Promise.all(files.map(function (f) {
      return Imaging.loadImageFile(f).catch(function () { return null; });
    })).then(function (canvases) {
      S.refImages = canvases.filter(Boolean);
      S.refRegions = S.refImages.map(function () { return 'body'; });
      S.refImages.forEach(function (c, idx) {
        var wrap = document.createElement('div');
        wrap.style.display = 'inline-block';
        wrap.style.margin = '4px';
        wrap.style.textAlign = 'center';
        var t = document.createElement('canvas');
        var s = 150 / c.width;
        t.width = 150; t.height = Math.round(c.height * s);
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        t.style.width = '74px';
        t.style.height = 'auto';
        t.style.borderRadius = '6px';
        t.style.border = '1px solid var(--line)';
        t.style.display = 'block';
        var sel = document.createElement('select');
        sel.className = 'tiny';
        sel.style.marginTop = '4px';
        sel.innerHTML = '<option value="body">Body</option><option value="heading">Heading</option><option value="mixed">Mixed</option>';
        sel.value = 'body';
        sel.onchange = function () { S.refRegions[idx] = sel.value; };
        wrap.appendChild(t);
        wrap.appendChild(sel);
        $('thumbsRef').appendChild(wrap);
      });
      card($('buildMsg'), S.refImages.length
        ? S.refImages.length + ' assignment page(s) ready. Pick a base style (or Auto-match) and analyze.'
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
    var rect = Glyphs.detectSheetGrid(S.sheetSrc, Glyphs.COLS, Glyphs.ROWS);
    setGridPercents(Glyphs.rectToPercents(rect, S.sheetSrc.width, S.sheetSrc.height));
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
  function headingFromPatterns(patterns, baseHeading) {
    if (baseHeading) return baseHeading;
    var hw = patterns && patterns.headingWeight;
    if (hw === 'strong') return 'double';
    if (hw === 'none') return 'none';
    return 'underline';
  }

  $('btnBuild').onclick = function () {
    var name = $('packName').value.trim();
    if (!name) { card($('buildMsg'), 'Give the style pack a name first.', 'bad'); return; }
    if (!S.refImages.length) {
      card($('buildMsg'), 'Upload at least one full written assignment page first.', 'bad');
      return;
    }

    var btn = $('btnBuild');
    btn.disabled = true;
    $('buildState').textContent = 'working…';
    card($('buildMsg'), 'Reading ink, slant, spacing and heading patterns…');

    setTimeout(function () {
      try {
        var analyses = S.refImages.map(function (c) { return Imaging.analyze(c); });
        var stats = Imaging.mergeAnalyses(analyses);

        var baseId = ($('baseStyle') && $('baseStyle').value) || 'auto';
        var base = (baseId === 'auto')
          ? Presets.matchFromStats(stats)
          : (Presets.byId(baseId) || Presets.matchFromStats(stats));

        var glyphs = [], missing = [], cellH = 92, cellW = 70;
        if (S.sheetSrc) {
          var rect = gridRect(S.sheetSrc);
          var res = Glyphs.extractGlyphs(S.sheetSrc, rect, Glyphs.COLS, Glyphs.ROWS, Glyphs.CHARS);
          glyphs = res.glyphs;
          missing = res.missing;
          cellH = rect.h / Glyphs.ROWS;
          cellW = rect.w / Glyphs.COLS;
        }

        var harvested = [];
        var hadSheetGlyphs = glyphs.length > 0;
        if (window.Harvest && S.refImages.length) {
          harvested = Harvest.harvestFromPages(S.refImages, { maxCrops: 120, maxPerChar: 4 });
          glyphs = Harvest.mergeVariants(glyphs, harvested);
          /* Only adopt harvested cell metrics when there is no alphabet sheet. */
          if (!hadSheetGlyphs && harvested.length) {
            var med = Harvest.medianCellMetrics
              ? Harvest.medianCellMetrics(harvested)
              : null;
            if (med) {
              cellH = med.cellH;
              cellW = med.cellW;
            } else if (harvested[0].cellH) {
              cellH = harvested[0].cellH;
              cellW = harvested[0].cellW;
            }
          }
        }

        var pens = (stats.palette || []).filter(function (c) { return c.kind !== 'faint'; })
          .map(function (c) { return c.hex; });
        if (!pens.length) pens = (base.penColours || ['#1b2a4a']).slice();
        pens = pens.slice(0, 4);

        var pats = stats.patterns || {};
        if (S.refRegions && S.refRegions.length) {
          var hVotes = 0, bVotes = 0;
          S.refRegions.forEach(function (r) {
            if (r === 'heading') hVotes++;
            else if (r === 'body') bVotes++;
            else { hVotes++; bVotes++; }
          });
          pats.regions = S.refRegions.slice();
          if (hVotes > bVotes) pats.headingWeight = 'strong';
          else if (bVotes && !hVotes) pats.headingWeight = 'none';
          stats.patterns = pats;
        }
        var jitter;
        if (pats.neatness != null) {
          jitter = pats.neatness >= 0.72 ? 0.28 : (pats.neatness >= 0.5 ? 0.48 : 0.7);
        } else {
          jitter = base.defaultJitter != null ? base.defaultJitter
            : (pats.qualityGuess === 'best' ? 0.28 : 0.55);
        }
        var scored = window.Assignment ? Assignment.styleScore(stats) : { score: 70 };
        var paperStyle = pats.paperStyle || stats.paperStyle || 'ruled';

        var pack = {
          id: 'pk_' + Date.now().toString(36),
          name: name,
          created: Date.now(),
          cellH: cellH,
          cellW: cellW,
          glyphs: glyphs,
          missing: missing,
          harvestedCount: harvested.length,
          stats: stats,
          patterns: pats,
          penColours: pens,
          paper: stats.paper || '#fdfcf7',
          paperStyle: paperStyle,
          slant: stats.slant,
          strokeWidth: stats.strokeWidth,
          lineGap: stats.lineGap || base.lineGap,
          fontFamily: glyphs.length ? null : base.fontFamily,
          headingStyle: headingFromPatterns(pats, base.headingStyle),
          defaultJitter: jitter,
          defaultSize: base.defaultSize || 34,
          tracking: base.tracking != null ? base.tracking : 0.55,
          baseStyleId: base.id,
          baseStyleName: base.name,
          quality: pats.qualityGuess || base.quality,
          styleScore: scored.score
        };

        Store.savePack(S.user, pack).then(function () {
          btn.disabled = false;
          $('buildState').textContent = '';
          S.activeId = pack.id;
          return refreshPacks().then(function () {
            applyPackDefaults(pack);
            showResult(pack);
          });
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
    var pats = st.patterns || {};
    var scored = window.Assignment ? Assignment.styleScore(st) : { score: pack.styleScore || 70 };
    var body = $('resultBody');
    var html = '';

    html += '<div class="stats">' +
      stat(scored.score + '/100', 'style score') +
      stat(st.pages || 0, 'assignment pages') +
      stat(st.slant != null ? (st.slant * 100).toFixed(0) + '%' : '—', 'slant') +
      stat(st.strokeWidth != null ? st.strokeWidth : '—', 'stroke px') +
      stat((pack.glyphs || []).length, 'letter crops') +
      '</div>';

    html += '<div class="hint" style="margin-bottom:12px">Matched writing style: <b>' +
      esc(pack.baseStyleName || 'built-in') + '</b>' +
      (pack.headingStyle ? (' · headings: ' + esc(pack.headingStyle)) : '') +
      (pats.headingWeight ? (' · heading weight: ' + esc(pats.headingWeight)) : '') +
      (pack.harvestedCount ? (' · harvested ' + pack.harvestedCount + ' ink crops') : '') +
      '.</div>';

    html += '<div class="field"><label class="small muted">Side-by-side · your page vs generated hand</label>' +
      '<div id="compareStrip" class="thumbs" style="align-items:flex-start"></div></div>';

    if (pack.penColours && pack.penColours.length) {
      html += '<div class="field"><label class="small muted">Detected inks</label><div class="swatch" style="margin-top:4px">';
      pack.penColours.forEach(function (h) {
        html += '<button style="background:' + h + '" title="' + h + '"></button>';
      });
      html += '</div></div>';
    }

    if (pack.missing && pack.missing.length) {
      html += '<p class="small muted"><b>' + pack.missing.length + '</b> alphabet cell(s) were empty: ' +
        pack.missing.join(' ') + '</p>';
    }

    if ((pack.glyphs || []).length) {
      html += '<div class="field"><label class="small muted">Letterforms / harvested crops</label><div class="glyphgrid">';
      pack.glyphs.slice(0, 90).forEach(function (g) {
        html += '<figure><img src="' + g.url + '" alt="' + esc(g.ch) + '"><figcaption>' + esc(g.ch) + '</figcaption></figure>';
      });
      html += '</div></div>';
    }

    body.innerHTML = html;
    $('resultCard').hidden = false;
    card($('buildMsg'), 'Saved <b>' + esc(pack.name) + '</b> — switch to Write to generate on blank or lined A4.', '');

    var strip = $('compareStrip');
    if (strip) {
      if (st.thumbs && st.thumbs[0]) {
        var img = document.createElement('img');
        img.src = st.thumbs[0];
        img.title = 'Your assignment';
        img.style.maxWidth = '160px';
        strip.appendChild(img);
      }
      var ready = (pack.glyphs && pack.glyphs.length) ? Glyphs.hydrate(pack) : Promise.resolve(pack);
      ready.then(function () {
        var preview = Rendering.previewLine({
          pack: pack,
          text: 'The quick brown fox writes this line.',
          penColour: (pack.penColours && pack.penColours[0]) || '#1b2a4a'
        });
        preview.style.maxWidth = '100%';
        preview.style.border = '1px solid var(--line)';
        preview.style.borderRadius = '6px';
        strip.appendChild(preview);
      });
    }
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
  function layoutOpts() {
    var lay = (window.Assignment && $('wLayout'))
      ? Assignment.layoutById($('wLayout').value)
      : { marginL: 136, top: 196, pageNumbers: true, continuity: true };
    return {
      marginL: lay.marginL,
      top: lay.top,
      pageNumbers: $('wPageNums') ? $('wPageNums').checked : !!lay.pageNumbers,
      continuity: $('wContinuity') ? $('wContinuity').checked : lay.continuity !== false
    };
  }

  function showPages(pages, pack) {
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
          a.download = ((pack && pack.name) || 'page').replace(/[^\w-]+/g, '_') + '_p' + (i + 1) + '.png';
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
  }

  function classicalRender(pack) {
    var lo = layoutOpts();
    return Rendering.renderPages({
      text: $('wText').value,
      pack: pack,
      size: +$('wSize').value,
      jitter: +$('wJitter').value / 100,
      seed: +$('wSeed').value,
      penColour: S.pen || (pack.penColours && pack.penColours[0]) || '#1b2a4a',
      paper: $('wPaper').value,
      paperColour: pack.paper || '#fdfcf7',
      headingStyle: $('wHeading').value,
      fontFamily: pack.fontFamily,
      tracking: pack.tracking,
      watermark: $('wMark').checked,
      continuity: lo.continuity,
      pageNumbers: lo.pageNumbers,
      marginL: lo.marginL,
      top: lo.top
    });
  }

  function tryNeuralRender(pack) {
    if (!window.INKCADENCE_CONFIG || !INKCADENCE_CONFIG.apiBase || Store.mode() !== 'remote') {
      return Promise.reject(new Error('Neural needs a remote API. Using classical.'));
    }
    return fetch(INKCADENCE_CONFIG.apiBase + '/api/packs/' + encodeURIComponent(pack.id) + '/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (Store.token && Store.token()) },
      body: JSON.stringify({
        text: $('wText').value,
        options: {
          size: +$('wSize').value,
          jitter: +$('wJitter').value / 100,
          seed: +$('wSeed').value,
          penColour: S.pen,
          paper: $('wPaper').value,
          headingStyle: $('wHeading').value
        }
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('Neural infer failed');
      return r.json();
    }).then(function (data) {
      if (data.glyphs && data.glyphs.length) {
        var neuralPack = Object.assign({}, pack, { glyphs: data.glyphs, fontFamily: null });
        return Glyphs.hydrate(neuralPack).then(function () { return classicalRender(neuralPack); });
      }
      if (data.pages && data.pages.length) {
        return data.pages.map(function (url) {
          var c = document.createElement('canvas');
          c.width = Rendering.PAGE_W; c.height = Rendering.PAGE_H;
          var img = new Image();
          img.src = url;
          /* Sync draw may be blank; classical fallback if images not ready. */
          return c;
        });
      }
      throw new Error('No neural glyphs');
    });
  }

  $('btnRender').onclick = function () {
    var pack = activePack();
    if (!pack) { card($('writeMsg'), 'Pick a built-in style or train from an assignment first.', 'bad'); return; }

    var btn = $('btnRender');
    btn.disabled = true;
    card($('writeMsg'), 'Laying out pages…');
    var mode = ($('wMode') && $('wMode').value) || 'classical';

    var ready = (pack.glyphs && pack.glyphs.length) ? Glyphs.hydrate(pack) : Promise.resolve(pack);
    ready.then(function () {
      if (mode === 'neural' || (mode === 'auto' && pack.modelStatus === 'ready')) {
        return tryNeuralRender(pack).catch(function () { return classicalRender(pack); });
      }
      return classicalRender(pack);
    }).then(function (pages) {
      showPages(pages, pack);
      card($('writeMsg'), '');
      btn.disabled = false;
    }).catch(function (e) {
      btn.disabled = false;
      card($('writeMsg'), 'Render failed: ' + e.message, 'bad');
    });
  };

  if ($('btnFormatText')) {
    $('btnFormatText').onclick = function () {
      if (!window.Assignment) return;
      $('wText').value = Assignment.formatAssignment($('wText').value);
      card($('writeMsg'), 'Formatted headings and numbered questions.', '');
    };
  }

  if ($('wLayout')) {
    $('wLayout').onchange = applyLayoutPreset;
  }

  if ($('btnExportPdf')) {
    $('btnExportPdf').onclick = function () {
      if (!S.lastPages.length) { card($('writeMsg'), 'Render the pages first.', 'bad'); return; }
      var pack = activePack();
      var name = ((pack && pack.name) || 'inkcadence').replace(/[^\w-]+/g, '_');
      PackShare.downloadPdf(S.lastPages, name + '.pdf');
      card($('writeMsg'), 'PDF download started.', '');
    };
  }

  if ($('btnSharePack')) {
    $('btnSharePack').onclick = function () {
      var pack = activePack();
      if (!pack || pack.builtin) {
        card($('writeMsg'), 'Export works on trained packs (not built-ins). Train from an assignment first.', 'bad');
        return;
      }
      PackShare.exportPackFile(pack);
      card($('writeMsg'), 'Style pack exported (photos stripped).', '');
    };
  }

  if ($('btnImportPack') && $('filePack')) {
    $('btnImportPack').onclick = function () { $('filePack').click(); };
    $('filePack').onchange = function () {
      var f = (this.files || [])[0];
      if (!f) return;
      PackShare.readFileAsText(f).then(function (text) {
        var pack = PackShare.decodeShare(text);
        return Store.savePack(S.user, pack).then(function () {
          S.activeId = pack.id;
          return refreshPacks();
        }).then(function () {
          card($('writeMsg'), 'Imported style pack <b>' + esc(pack.name) + '</b>.', '');
        });
      }).catch(function (e) {
        card($('writeMsg'), 'Import failed: ' + e.message, 'bad');
      });
    };
  }

  if ($('btnTrainNeural')) {
    $('btnTrainNeural').onclick = function () {
      var pack = activePack();
      if (!pack || pack.builtin) {
        card($('writeMsg'), 'Train neural on a saved assignment pack (remote API required).', 'bad');
        return;
      }
      if (!window.INKCADENCE_CONFIG || !INKCADENCE_CONFIG.apiBase || Store.mode() !== 'remote') {
        card($('writeMsg'), 'Neural training needs a hosted API. Classical harvest still works offline.', 'bad');
        return;
      }
      card($('writeMsg'), 'Queuing neural train…');
      fetch(INKCADENCE_CONFIG.apiBase + '/api/packs/' + encodeURIComponent(pack.id) + '/train-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (Store.token && Store.token()) },
        body: '{}'
      }).then(function (r) {
        if (!r.ok) throw new Error('Train request failed');
        card($('writeMsg'), 'Neural training started. Switch writer mode to Neural when ready.', '');
      }).catch(function (e) {
        card($('writeMsg'), e.message, 'bad');
      });
    };
  }

  $('btnPrint').onclick = function () {
    if (!S.lastPages.length) { card($('writeMsg'), 'Render the pages first.', 'bad'); return; }
    var w = window.open('', '_blank');
    if (!w) { card($('writeMsg'), 'Allow pop-ups to open the print view.', 'bad'); return; }
    w.document.write(Rendering.exportPrintDocument(S.lastPages, (activePack() && activePack().name) || 'Inkcadence'));
    w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 400);
  };

  /* ---------------- boot ---------------- */
  fillBaseStyleSelect();
  fillLayoutSelect();
  applyLayoutPreset();
  Promise.resolve(Store.ready).then(function () {
    syncAccountMode();
    return Store.currentUser();
  }).then(function (u) {
    if (u) return afterLogin(u);
    showAuth();
  }).catch(function () { showAuth(); });
})();
