/* presets.js — built-in handwriting styles for assignment writing.
   Ten ready packs: mix of neat (exam/best) and everyday (normal) hands,
   with distinct heading treatments. Used when no glyph sheet is provided. */
(function (global) {
  'use strict';

  function pack(partial) {
    return {
      builtin: true,
      glyphs: [],
      missing: [],
      cellH: 92,
      cellW: 70,
      created: 0,
      paper: '#fdfcf7',
      stats: {
        pages: 0,
        slant: partial.slant,
        strokeWidth: partial.strokeWidth,
        strokeConfidence: partial.quality === 'best' ? 0.82 : 0.55,
        lineGap: partial.lineGap,
        inkRatio: 0.02,
        paper: '#fdfcf7',
        palette: (partial.penColours || []).map(function (hex, i) {
          return { hex: hex, kind: i === 0 ? 'pen' : 'marker', share: Math.max(10, 60 - i * 15) };
        }),
        thumbs: [],
        patterns: partial.patterns || {}
      },
      id: partial.id,
      name: partial.name,
      quality: partial.quality,
      fontFamily: partial.fontFamily,
      headingStyle: partial.headingStyle,
      defaultJitter: partial.jitter,
      defaultSize: partial.size || 34,
      tracking: partial.tracking == null ? 0.6 : partial.tracking,
      slant: partial.slant,
      strokeWidth: partial.strokeWidth,
      lineGap: partial.lineGap,
      penColours: partial.penColours.slice(),
      description: partial.description || ''
    };
  }

  var SCRIPT = '"Segoe Script","Lucida Handwriting","Ink Free","Bradley Hand",cursive';
  var CASUAL = '"Ink Free","Segoe Print","Comic Sans MS",cursive';
  var FORMAL = 'Georgia,"Times New Roman",serif';
  var BRUSH = '"Brush Script MT","Segoe Script",cursive';
  var CLEAN = '"Segoe UI","Helvetica Neue",Arial,sans-serif';

  var BUILTINS = [
    pack({
      id: 'builtin_neat_navy',
      name: 'Neat Navy · exam',
      quality: 'best',
      description: 'Careful school-exam hand, double-underlined headings.',
      fontFamily: SCRIPT,
      headingStyle: 'double',
      slant: 0.04,
      strokeWidth: 2.2,
      lineGap: 44,
      jitter: 0.22,
      size: 32,
      tracking: 0.35,
      penColours: ['#1b2a4a', '#2f6fed'],
      patterns: { neatness: 0.9, headingWeight: 'strong' }
    }),
    pack({
      id: 'builtin_everyday_blue',
      name: 'Everyday Blue · notes',
      quality: 'normal',
      description: 'Natural notebook hand with light underline headings.',
      fontFamily: CASUAL,
      headingStyle: 'underline',
      slant: 0.12,
      strokeWidth: 2.8,
      lineGap: 48,
      jitter: 0.58,
      size: 34,
      tracking: 0.7,
      penColours: ['#1e3a8a', '#2563eb'],
      patterns: { neatness: 0.55, headingWeight: 'medium' }
    }),
    pack({
      id: 'builtin_best_black',
      name: 'Best Black · formal',
      quality: 'best',
      description: 'Dark formal pen, tidy slant, strong headings.',
      fontFamily: FORMAL,
      headingStyle: 'double',
      slant: -0.02,
      strokeWidth: 2.0,
      lineGap: 46,
      jitter: 0.18,
      size: 31,
      tracking: 0.25,
      penColours: ['#111827', '#374151'],
      patterns: { neatness: 0.92, headingWeight: 'strong' }
    }),
    pack({
      id: 'builtin_quick_grey',
      name: 'Quick Grey · draft',
      quality: 'normal',
      description: 'Faster class notes, looser spacing, no heading line.',
      fontFamily: CASUAL,
      headingStyle: 'none',
      slant: 0.18,
      strokeWidth: 3.1,
      lineGap: 52,
      jitter: 0.78,
      size: 33,
      tracking: 0.9,
      penColours: ['#334155', '#64748b'],
      patterns: { neatness: 0.35, headingWeight: 'none' }
    }),
    pack({
      id: 'builtin_green_lab',
      name: 'Green Lab · practical',
      quality: 'normal',
      description: 'Science-lab green ink, underlined section titles.',
      fontFamily: SCRIPT,
      headingStyle: 'underline',
      slant: 0.08,
      strokeWidth: 2.6,
      lineGap: 47,
      jitter: 0.48,
      size: 33,
      tracking: 0.55,
      penColours: ['#14532d', '#15803d', '#a3e635'],
      patterns: { neatness: 0.6, headingWeight: 'medium' }
    }),
    pack({
      id: 'builtin_crimson_essay',
      name: 'Crimson Essay · best',
      quality: 'best',
      description: 'Essay hand with red-brown ink and double headings.',
      fontFamily: BRUSH,
      headingStyle: 'double',
      slant: 0.1,
      strokeWidth: 2.4,
      lineGap: 45,
      jitter: 0.3,
      size: 34,
      tracking: 0.4,
      penColours: ['#7f1d1d', '#b91c1c'],
      patterns: { neatness: 0.85, headingWeight: 'strong' }
    }),
    pack({
      id: 'builtin_sky_homework',
      name: 'Sky Homework · normal',
      quality: 'normal',
      description: 'Light blue biro, everyday homework rhythm.',
      fontFamily: SCRIPT,
      headingStyle: 'underline',
      slant: 0.14,
      strokeWidth: 2.5,
      lineGap: 49,
      jitter: 0.62,
      size: 34,
      tracking: 0.75,
      penColours: ['#0369a1', '#0ea5e9'],
      patterns: { neatness: 0.5, headingWeight: 'medium' }
    }),
    pack({
      id: 'builtin_architect',
      name: 'Architect Print · best',
      quality: 'best',
      description: 'Print-like tidy capitals feel, minimal flourish.',
      fontFamily: CLEAN,
      headingStyle: 'underline',
      slant: 0.0,
      strokeWidth: 1.8,
      lineGap: 42,
      jitter: 0.12,
      size: 30,
      tracking: 0.15,
      penColours: ['#0f172a', '#1d4ed8'],
      patterns: { neatness: 0.95, headingWeight: 'medium' }
    }),
    pack({
      id: 'builtin_midnight_marker',
      name: 'Midnight Marker · normal',
      quality: 'normal',
      description: 'Heavier stroke, marker titles, looser body.',
      fontFamily: CASUAL,
      headingStyle: 'double',
      slant: 0.06,
      strokeWidth: 3.6,
      lineGap: 54,
      jitter: 0.7,
      size: 36,
      tracking: 0.85,
      penColours: ['#1e1b4b', '#4c1d95', '#f59e0b'],
      patterns: { neatness: 0.4, headingWeight: 'strong' }
    }),
    pack({
      id: 'builtin_classic_fountain',
      name: 'Classic Fountain · best',
      quality: 'best',
      description: 'Fountain-pen navy with elegant underlined titles.',
      fontFamily: SCRIPT,
      headingStyle: 'underline',
      slant: 0.09,
      strokeWidth: 2.1,
      lineGap: 46,
      jitter: 0.26,
      size: 33,
      tracking: 0.45,
      penColours: ['#172554', '#1e40af'],
      patterns: { neatness: 0.88, headingWeight: 'medium' }
    })
  ];

  function list() {
    return BUILTINS.map(function (p) {
      return JSON.parse(JSON.stringify(p));
    });
  }

  function byId(id) {
    for (var i = 0; i < BUILTINS.length; i++) {
      if (BUILTINS[i].id === id) return JSON.parse(JSON.stringify(BUILTINS[i]));
    }
    return null;
  }

  /* Pick closest built-in hand from analysed assignment stats. */
  function matchFromStats(stats) {
    if (!stats) return byId('builtin_everyday_blue');
    var slant = +stats.slant || 0;
    var stroke = +stats.strokeWidth || 3;
    var neat = (stats.patterns && stats.patterns.neatness != null)
      ? stats.patterns.neatness
      : (stats.strokeConfidence || 0.5);
    var best = BUILTINS[0], bestD = 1e9;
    for (var i = 0; i < BUILTINS.length; i++) {
      var p = BUILTINS[i];
      var pn = p.quality === 'best' ? 0.88 : 0.5;
      var d = Math.abs(p.slant - slant) * 4
        + Math.abs(p.strokeWidth - stroke) * 0.35
        + Math.abs(pn - neat) * 1.2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return JSON.parse(JSON.stringify(best));
  }

  global.Presets = { list: list, byId: byId, matchFromStats: matchFromStats };
})(window);
