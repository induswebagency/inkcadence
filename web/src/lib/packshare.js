/* packshare.js — export/import style packs without raw assignment photos. */
'use strict';
function stripPhotos(pack) {
    var p = JSON.parse(JSON.stringify(pack, function (k, v) {
      if (k === '_img' || k === '__id' || k === 'thumbs') return undefined;
      if (typeof v === 'function') return undefined;
      return v;
    }));
    if (p.stats) p.stats.thumbs = [];
    return p;
  }

  function toSharePayload(pack) {
    var clean = stripPhotos(pack);
    return {
      format: 'inkcadence-pack-v1',
      exportedAt: Date.now(),
      pack: clean
    };
  }

  function encodeShare(pack) {
    var json = JSON.stringify(toSharePayload(pack));
    /* Lightweight obfuscation (not cryptography) — enough to discourage casual photo leaks. */
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return 'INK1.' + b64;
  }

  function decodeShare(text) {
    var s = String(text || '').trim();
    if (s.indexOf('INK1.') === 0) s = s.slice(5);
    var json;
    try {
      json = decodeURIComponent(escape(atob(s)));
    } catch (e1) {
      try { json = s; } catch (e2) { throw new Error('Invalid share payload'); }
    }
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data && data.pack) data = data.pack;
    if (data && data.format && data.pack) data = data.pack;
    if (!data || typeof data !== 'object') throw new Error('Invalid pack file');
    data.id = 'pk_import_' + Date.now().toString(36);
    data.created = Date.now();
    data.builtin = false;
    if (data.stats) data.stats.thumbs = [];
    return data;
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  function exportPackFile(pack) {
    var name = (pack.name || 'style').replace(/[^\w\-]+/g, '_').slice(0, 40);
    downloadText(name + '.inkpack', encodeShare(pack));
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('Could not read file')); };
      fr.readAsText(file);
    });
  }

  /* Minimal multi-page PDF (JPEG images) without external deps. */
  function pagesToPdfBlob(pages) {
    var encoder = new TextEncoder();
    var parts = [];
    var offsets = [];
    var objCount = 0;

    function add(str) {
      var u8 = typeof str === 'string' ? encoder.encode(str) : str;
      parts.push(u8);
      return u8.length;
    }

    function beginObj() {
      offsets[++objCount] = parts.reduce(function (n, p) { return n + p.length; }, 0);
      add(objCount + ' 0 obj\n');
    }

    function endObj() { add('\nendobj\n'); }

    var W = pages[0].width, H = pages[0].height;
    var jpegBytes = pages.map(function (c) {
      var dataUrl = c.toDataURL('image/jpeg', 0.92);
      var b64 = dataUrl.split(',')[1];
      var bin = atob(b64);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    });

    add('%PDF-1.4\n');
    beginObj(); add('<< /Type /Catalog /Pages 2 0 R >>'); endObj();

    var kids = [];
    var pageObjs = [];
    for (var i = 0; i < pages.length; i++) {
      var contentId = 3 + i * 3;
      var pageId = contentId + 1;
      var imgId = contentId + 2;
      kids.push(pageId + ' 0 R');
      pageObjs.push({ contentId: contentId, pageId: pageId, imgId: imgId, bytes: jpegBytes[i] });
    }

    beginObj();
    add('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>');
    endObj();

    pageObjs.forEach(function (po) {
      var stream = 'q\n' + W + ' 0 0 ' + H + ' 0 0 cm\n/Im' + po.imgId + ' Do\nQ\n';
      beginObj();
      add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
      endObj();

      beginObj();
      add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] ' +
        '/Contents ' + po.contentId + ' 0 R /Resources << /XObject << /Im' + po.imgId +
        ' ' + po.imgId + ' 0 R >> >> >>');
      endObj();

      beginObj();
      add('<< /Type /XObject /Subtype /Image /Width ' + W + ' /Height ' + H +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        po.bytes.length + ' >>\nstream\n');
      add(po.bytes);
      add('\nendstream');
      endObj();
    });

    var xrefStart = parts.reduce(function (n, p) { return n + p.length; }, 0);
    add('xref\n0 ' + (objCount + 1) + '\n');
    add('0000000000 65535 f \n');
    for (var o = 1; o <= objCount; o++) {
      var off = String(offsets[o] || 0);
      while (off.length < 10) off = '0' + off;
      add(off + ' 00000 n \n');
    }
    add('trailer\n<< /Size ' + (objCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');

    var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return new Blob([out], { type: 'application/pdf' });
  }

  function downloadPdf(pages, filename) {
    var blob = pagesToPdfBlob(pages);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'inkcadence.pdf';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  const PackShare = {
    encodeShare: encodeShare,
    decodeShare: decodeShare,
    exportPackFile: exportPackFile,
    readFileAsText: readFileAsText,
    stripPhotos: stripPhotos,
    downloadPdf: downloadPdf,
    pagesToPdfBlob: pagesToPdfBlob
  };

export { PackShare };
export default PackShare;
