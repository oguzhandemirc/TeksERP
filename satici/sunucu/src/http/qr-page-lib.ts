// /q SAYFASININ TARAYICI KÜTÜPHANESİ — sayfaya satır içi gömülür (CSP: yalnız satır içi betik,
// dış kaynak yok). İçerik: saf SHA-256, TKLQ1 parça bölme/toplama (TS eşi `./qr-parca.ts`, o da
// fabrikanın `Teks-Erp/src/lib/license/qr-parca.ts` aynası) ve bayt kipli QR kodlayıcı (ISO/IEC 18004,
// tablolar standarttan). Eşdeğerlik ve QR doğruluğu satıcı bekçisi `test_qr_sayfasi`nda ölçülür:
// bölme/toplama TS eşiyle birebir, QR matrisi altın özetlerle. Betik ES5 düzeyinde, `var TKLQ` tanımlar.

export const QR_PAGE_LIB_JS = String.raw`var TKLQ = (function () {
  "use strict";
  var PREFIX = "TKLQ1", MAX_COUNT = 4, TARGET = 1000, MAX_CHARS = 1500;
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

  function utf8(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256Hex(text) {
    var bytes = utf8(text), bitLen = bytes.length * 8, s, t, i;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (s = 56; s >= 0; s -= 8) bytes.push(s >= 32 ? Math.floor(bitLen / Math.pow(2, s)) & 255 : (bitLen >>> s) & 255);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = [];
    for (var off = 0; off < bytes.length; off += 64) {
      for (t = 0; t < 64; t++) {
        if (t < 16) {
          var p = off + t * 4;
          w[t] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
        } else {
          var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
          var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
          w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
        var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      var next = [a, b, c, d, e, f, g, hh];
      for (i = 0; i < 8; i++) h[i] = (h[i] + next[i]) >>> 0;
    }
    return h.map(function (x) { return ("00000000" + x.toString(16)).slice(-8); }).join("");
  }
  function shortHash(text) { return sha256Hex(text).slice(0, 8); }

  function split(text) {
    if (!text) return null;
    var count = Math.min(MAX_COUNT, Math.ceil(text.length / TARGET)), size = Math.ceil(text.length / count);
    if (size > MAX_CHARS) return null;
    var cuts = [0], i;
    for (i = 1; i < count; i++) {
      var at = i * size, prev = text.charCodeAt(at - 1);
      if (prev >= 0xd800 && prev <= 0xdbff) at++;
      cuts.push(at);
    }
    cuts.push(text.length);
    var setId = shortHash(text), parts = [];
    for (i = 0; i < count; i++) {
      var data = text.slice(cuts[i], cuts[i + 1]);
      parts.push([PREFIX, (i + 1) + "/" + count, setId, shortHash(data), data].join("|"));
    }
    return parts;
  }
  function parse(raw) {
    var fields = String(raw).split("|");
    if (fields.length < 5 || fields[0] !== PREFIX) return null;
    var pos = /^([1-9])\/([1-9])$/.exec(fields[1]);
    if (!pos) return null;
    var index = Number(pos[1]), total = Number(pos[2]);
    if (total > MAX_COUNT || index > total) return null;
    if (!/^[0-9a-f]{8}$/.test(fields[2]) || !/^[0-9a-f]{8}$/.test(fields[3])) return null;
    var data = fields.slice(4).join("|");
    if (!data || shortHash(data) !== fields[3]) return null;
    return { index: index, total: total, setId: fields[2], digest: fields[3], data: data };
  }
  function add(state, raw) {
    var part = parse(raw);
    if (!part) return { kind: "gecersiz" };
    var base = state && state.setId === part.setId && state.total === part.total ? state : null;
    if (!base) {
      base = { setId: part.setId, total: part.total, parts: [] };
      for (var k = 0; k < part.total; k++) base.parts.push(null);
    }
    var count = function (list) { return list.filter(function (x) { return x !== null; }).length; };
    if (base.parts[part.index - 1] !== null) return { kind: "tekrar", state: base, received: count(base.parts) };
    var parts = base.parts.map(function (x, i) { return i === part.index - 1 ? part.data : x; });
    var received = count(parts);
    if (received < part.total) return { kind: "eklendi", state: { setId: base.setId, total: base.total, parts: parts }, received: received };
    var text = parts.join("");
    return shortHash(text) === part.setId ? { kind: "tamam", text: text } : { kind: "bozuk" };
  }

  // ── QR kodlayıcı (bayt kipi; en küçük sürüm, sığdıkça daha yüksek düzeltme) ──
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]];
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]];
  var FORMAT_BITS = [1, 0, 3, 2];
  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver, ecl) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver]; }
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDivisor(degree) {
    var result = [], root = 1, i, j;
    for (i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    for (i = 0; i < degree; i++) {
      for (j = 0; j < result.length; j++) { result[j] = gfMul(result[j], root); if (j + 1 < result.length) result[j] ^= result[j + 1]; }
      root = gfMul(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }
  function codewords(bytes) {
    var ver, used, ecl = 0, e, i;
    for (ver = 1; ; ver++) {
      used = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (used <= dataCodewords(ver, 0) * 8) break;
      if (ver >= 40) throw new Error("QR için veri çok uzun");
    }
    for (e = 1; e < 4; e++) if (used <= dataCodewords(ver, e) * 8) ecl = e;
    var bits = [], cap = dataCodewords(ver, ecl) * 8;
    var put = function (val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    var data = [];
    for (i = 0; i < bits.length; i += 8) { var v = 0; for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; data.push(v); }
    var numBlocks = NUM_BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver], raw = Math.floor(rawModules(ver) / 8);
    var numShort = numBlocks - raw % numBlocks, shortLen = Math.floor(raw / numBlocks), div = rsDivisor(eccLen), blocks = [], pos = 0;
    for (i = 0; i < numBlocks; i++) {
      var dat = data.slice(pos, pos + shortLen - eccLen + (i < numShort ? 0 : 1));
      pos += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++) for (var j = 0; j < blocks.length; j++) if (i !== shortLen - eccLen || j >= numShort) all.push(blocks[j][i]);
    return { ver: ver, ecl: ecl, all: all };
  }
  return { sha256Hex: sha256Hex, split: split, parse: parse, add: add, utf8: utf8, codewords: codewords, FORMAT_BITS: FORMAT_BITS };
})();
`;
