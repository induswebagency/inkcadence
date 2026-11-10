/* charcnn.js — browser CharCNN inference for harvested glyph crops.
   Loads assets/charcnn.json (EMNIST ByClass + optional Kaggle A-Z, messy-aug trained).
   Input: white ink on transparent / dark-on-light crop → 28×28 ink-on-black. */
(function (global) {
  'use strict';

  var WEIGHTS_URLS = [
    'assets/charcnn.json',
    'charcnn.json',
    '../assets/charcnn.json',
    '/assets/charcnn.json',
    '/charcnn.json'
  ];

  var model = null;
  var readyPromise = null;
  var ready = false;

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function relu(x) {
    return x > 0 ? x : 0;
  }

  function softmaxArgmax(logits) {
    var max = -Infinity, i, e, sum = 0, best = 0, bestV = -Infinity;
    for (i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
    var probs = new Float32Array(logits.length);
    for (i = 0; i < logits.length; i++) {
      e = Math.exp(logits[i] - max);
      probs[i] = e;
      sum += e;
    }
    for (i = 0; i < probs.length; i++) {
      probs[i] /= sum;
      if (probs[i] > bestV) {
        bestV = probs[i];
        best = i;
      }
    }
    return { index: best, conf: bestV, probs: probs };
  }

  function convPool(input, C, H, W, layer) {
    var outC = layer.out;
    var k = layer.k;
    var pad = layer.pad;
    var w = layer.w;
    var b = layer.b;
    var outH = H;
    var outW = W;
    var conv = new Float32Array(outC * outH * outW);
    var cOut, y, x, cIn, ky, kx, iy, ix, acc, wi;
    for (cOut = 0; cOut < outC; cOut++) {
      for (y = 0; y < outH; y++) {
        for (x = 0; x < outW; x++) {
          acc = b[cOut];
          for (cIn = 0; cIn < C; cIn++) {
            for (ky = 0; ky < k; ky++) {
              iy = y + ky - pad;
              if (iy < 0 || iy >= H) continue;
              for (kx = 0; kx < k; kx++) {
                ix = x + kx - pad;
                if (ix < 0 || ix >= W) continue;
                wi = ((cOut * C + cIn) * k + ky) * k + kx;
                acc += w[wi] * input[(cIn * H + iy) * W + ix];
              }
            }
          }
          conv[(cOut * outH + y) * outW + x] = relu(acc);
        }
      }
    }
    var pH = (outH / 2) | 0;
    var pW = (outW / 2) | 0;
    var pooled = new Float32Array(outC * pH * pW);
    var yy, xx, m, v;
    for (cOut = 0; cOut < outC; cOut++) {
      for (yy = 0; yy < pH; yy++) {
        for (xx = 0; xx < pW; xx++) {
          m = -Infinity;
          for (ky = 0; ky < 2; ky++) {
            for (kx = 0; kx < 2; kx++) {
              v = conv[(cOut * outH + yy * 2 + ky) * outW + xx * 2 + kx];
              if (v > m) m = v;
            }
          }
          pooled[(cOut * pH + yy) * pW + xx] = m;
        }
      }
    }
    return { data: pooled, C: outC, H: pH, W: pW };
  }

  function dense(input, layer, applyRelu) {
    var out = new Float32Array(layer.out);
    var i, j, acc;
    for (i = 0; i < layer.out; i++) {
      acc = layer.b[i];
      for (j = 0; j < layer.in; j++) {
        acc += layer.w[i * layer.in + j] * input[j];
      }
      out[i] = applyRelu ? relu(acc) : acc;
    }
    return out;
  }

  function forward(ink28) {
    var x = { data: ink28, C: 1, H: 28, W: 28 };
    x = convPool(x.data, x.C, x.H, x.W, model.conv1);
    x = convPool(x.data, x.C, x.H, x.W, model.conv2);
    x = convPool(x.data, x.C, x.H, x.W, model.conv3);
    var h = dense(x.data, model.fc1, true);
    var logits = dense(h, model.fc2, false);
    var sm = softmaxArgmax(logits);
    return { ch: model.labels[sm.index], conf: sm.conf, index: sm.index };
  }

  function glyphToTensor(imgOrCanvas) {
    var size = model.inputSize || 28;
    var tmp = canvas(size, size);
    var ctx = tmp.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    var iw = imgOrCanvas.width || imgOrCanvas.naturalWidth;
    var ih = imgOrCanvas.height || imgOrCanvas.naturalHeight;
    var scale = Math.min(size / Math.max(1, iw), size / Math.max(1, ih));
    var dw = Math.max(1, Math.round(iw * scale));
    var dh = Math.max(1, Math.round(ih * scale));
    var ox = ((size - dw) / 2) | 0;
    var oy = ((size - dh) / 2) | 0;
    ctx.drawImage(imgOrCanvas, 0, 0, iw, ih, ox, oy, dw, dh);

    var data = ctx.getImageData(0, 0, size, size).data;
    var out = new Float32Array(size * size);
    var i, p, r, g, b, lum, ink, sum = 0;
    for (i = 0, p = 0; i < size * size; i++, p += 4) {
      r = data[p];
      g = data[p + 1];
      b = data[p + 2];
      lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      ink = lum;
      out[i] = ink;
      sum += ink;
    }
    if (sum > size * size * 0.55) {
      sum = 0;
      for (i = 0; i < out.length; i++) {
        out[i] = 1 - out[i];
        sum += out[i];
      }
    }
    if (sum < 2) return out;
    var max = 0;
    for (i = 0; i < out.length; i++) if (out[i] > max) max = out[i];
    if (max > 1e-6) {
      for (i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / max);
    }
    return out;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  function decodeWeights(raw) {
    if (!raw) return new Float32Array(0);
    if (typeof raw !== 'string') return Float32Array.from(raw);
    var bin = atob(raw);
    var buf = new ArrayBuffer(bin.length);
    var bytes = new Uint8Array(buf);
    var i;
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(buf);
  }

  function hydrate(raw) {
    function layer(L, fallbackIn) {
      return {
        out: L.out,
        k: L.k || 3,
        pad: L.pad || 1,
        in: L.in || fallbackIn,
        w: decodeWeights(L.w),
        b: decodeWeights(L.b)
      };
    }
    model = {
      version: raw.version,
      inputSize: raw.inputSize || 28,
      labels: raw.labels,
      conv1: layer(raw.conv1),
      conv2: layer(raw.conv2),
      conv3: layer(raw.conv3),
      fc1: layer(raw.fc1, 128 * 3 * 3),
      fc2: layer(raw.fc2, 256)
    };
    ready = true;
    return model;
  }

  function fetchWeights(url) {
    return fetch(url, { cache: 'force-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function load(urls) {
    if (ready && model) return Promise.resolve(model);
    if (readyPromise) return readyPromise;
    var list = urls && urls.length ? urls : WEIGHTS_URLS;
    readyPromise = (function tryNext(i) {
      if (i >= list.length) {
        return Promise.reject(new Error('CharCNN weights not found'));
      }
      return fetchWeights(list[i]).then(hydrate, function () {
        return tryNext(i + 1);
      });
    })(0);
    return readyPromise.then(function (m) {
      return m;
    }, function (err) {
      readyPromise = null;
      throw err;
    });
  }

  function isReady() {
    return ready && !!model;
  }

  function predictTensor(ink28) {
    if (!isReady()) throw new Error('CharCNN not ready');
    return forward(ink28);
  }

  function predictImage(imgOrCanvas) {
    return predictTensor(glyphToTensor(imgOrCanvas));
  }

  function predictDataUrl(url) {
    return loadImage(url).then(predictImage);
  }

  function labelCrops(crops, maxPerChar) {
    maxPerChar = maxPerChar || 4;
    if (!isReady()) return Promise.resolve([]);
    var counts = Object.create(null);
    var out = [];
    var chain = Promise.resolve();
    crops.forEach(function (crop) {
      chain = chain.then(function () {
        return predictDataUrl(crop.url).then(function (pred) {
          if (!pred || pred.conf < 0.18) return;
          var ch = pred.ch;
          if ((counts[ch] || 0) >= maxPerChar) return;
          var g = Object.assign({}, crop);
          g.ch = ch;
          g.cnnConf = pred.conf;
          g.confidence = Math.min(0.99, 0.35 * (crop.confidence || 0.5) + 0.65 * pred.conf);
          out.push(g);
          counts[ch] = (counts[ch] || 0) + 1;
        }).catch(function () { /* skip */ });
      });
    });
    return chain.then(function () {
      out.sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
      return out;
    });
  }

  function labelCropsSync(crops, maxPerChar) {
    maxPerChar = maxPerChar || 4;
    if (!isReady()) return [];
    var counts = Object.create(null);
    var out = [];
    var i, crop, pred, ch, g;
    for (i = 0; i < crops.length; i++) {
      crop = crops[i];
      if (!crop._img && !crop._canvas) continue;
      pred = predictImage(crop._img || crop._canvas);
      if (!pred || pred.conf < 0.18) continue;
      ch = pred.ch;
      if ((counts[ch] || 0) >= maxPerChar) continue;
      g = Object.assign({}, crop);
      g.ch = ch;
      g.cnnConf = pred.conf;
      g.confidence = Math.min(0.99, 0.35 * (crop.confidence || 0.5) + 0.65 * pred.conf);
      out.push(g);
      counts[ch] = (counts[ch] || 0) + 1;
    }
    return out;
  }

  global.CharCNN = {
    load: load,
    isReady: isReady,
    predictImage: predictImage,
    predictDataUrl: predictDataUrl,
    predictTensor: predictTensor,
    labelCrops: labelCrops,
    labelCropsSync: labelCropsSync,
    glyphToTensor: glyphToTensor,
    WEIGHTS_URLS: WEIGHTS_URLS
  };
})(window);
