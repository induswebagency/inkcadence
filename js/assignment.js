/* assignment.js — structured paste + layout presets for written pages. */
(function (global) {
  'use strict';

  var LAYOUTS = [
    {
      id: 'exam_lined',
      name: 'Exam · lined A4',
      paper: 'ruled',
      headingStyle: 'double',
      marginL: 136,
      top: 196,
      pageNumbers: true,
      continuity: true
    },
    {
      id: 'blank_essay',
      name: 'Essay · blank A4',
      paper: 'plain',
      headingStyle: 'underline',
      marginL: 128,
      top: 180,
      pageNumbers: true,
      continuity: true
    },
    {
      id: 'lab_grid',
      name: 'Lab · grid A4',
      paper: 'grid',
      headingStyle: 'underline',
      marginL: 120,
      top: 170,
      pageNumbers: false,
      continuity: true
    },
    {
      id: 'homework_lined',
      name: 'Homework · lined',
      paper: 'ruled',
      headingStyle: 'underline',
      marginL: 136,
      top: 200,
      pageNumbers: true,
      continuity: true
    }
  ];

  function layouts() {
    return LAYOUTS.map(function (l) { return Object.assign({}, l); });
  }

  function layoutById(id) {
    for (var i = 0; i < LAYOUTS.length; i++) {
      if (LAYOUTS[i].id === id) return Object.assign({}, LAYOUTS[i]);
    }
    return Object.assign({}, LAYOUTS[0]);
  }

  /* Normalize pasted assignment text into Inkcadence layout:
     # headings, numbered questions, blank lines for spacing. */
  function formatAssignment(raw) {
    var lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var i, line, t;
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      t = line.trim();
      if (!t) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        continue;
      }
      if (/^#{1,3}\s+/.test(t)) {
        out.push('# ' + t.replace(/^#{1,3}\s+/, ''));
        continue;
      }
      if (/^(title|assignment|subject|name|roll|class)\b/i.test(t) && t.length < 80) {
        if (!out.length || out[0].charAt(0) !== '#') out.unshift('# ' + t.replace(/^#\s*/, ''));
        else out.push(t);
        continue;
      }
      if (/^\d+[\).:\-]\s*/.test(t)) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        out.push(t.replace(/^(\d+)[\).:\-]\s*/, '$1. '));
        continue;
      }
      if (/^[A-Za-z][\).]\s+/.test(t)) {
        out.push(t);
        continue;
      }
      out.push(t);
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  }

  function styleScore(stats) {
    var pats = (stats && stats.patterns) || {};
    var neat = pats.neatness != null ? pats.neatness : (stats && stats.strokeConfidence) || 0.5;
    var coverage = Math.min(1, ((stats && stats.pages) || 0) / 3);
    var ink = Math.min(1, Math.max(0, ((stats && stats.inkRatio) || 0.02) / 0.08));
    var score = Math.round((neat * 0.55 + coverage * 0.25 + ink * 0.2) * 100);
    return {
      score: Math.max(12, Math.min(98, score)),
      neatness: neat,
      qualityGuess: pats.qualityGuess || (neat >= 0.72 ? 'best' : 'normal'),
      headingWeight: pats.headingWeight || 'medium'
    };
  }

  global.Assignment = {
    layouts: layouts,
    layoutById: layoutById,
    formatAssignment: formatAssignment,
    styleScore: styleScore
  };
})(window);
