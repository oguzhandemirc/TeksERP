// /q SAYFASI — QR MATRİSİ (tarayıcı betiği, `qr-page-lib.ts`in `TKLQ` nesnesini genişletir): işlev
// desenleri, kod sözcüklerinin yerleşimi, sekiz maskeden ceza puanı en düşüğü (ISO/IEC 18004 §7.8)
// ve SVG yolu. Doğruluğu satıcı bekçisi `test_qr_sayfasi` altın özetlerle ölçer.

export const QR_PAGE_MATRIX_JS = String.raw`TKLQ.qrMatrix = function (text) {
  "use strict";
  var cw = TKLQ.codewords(TKLQ.utf8(text)), ver = cw.ver, ecl = cw.ecl, size = ver * 4 + 17, mod = [], fn = [], i, j;
  for (i = 0; i < size; i++) {
    var r1 = [], r2 = [];
    for (j = 0; j < size; j++) { r1.push(false); r2.push(false); }
    mod.push(r1); fn.push(r2);
  }
  function setF(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }
  function drawFormat(mask) {
    var data = (TKLQ.FORMAT_BITS[ecl] << 3) | mask, rem = data, k;
    for (k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var bit = function (n) { return ((bits >>> n) & 1) !== 0; };
    for (k = 0; k <= 5; k++) setF(8, k, bit(k));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (k = 9; k < 15; k++) setF(14 - k, 8, bit(k));
    for (k = 0; k < 8; k++) setF(size - 1 - k, 8, bit(k));
    for (k = 8; k < 15; k++) setF(8, size - 15 + k, bit(k));
    setF(8, size - 8, true);
  }
  function finder(cx, cy) {
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
      var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, dist !== 2 && dist !== 4);
    }
  }
  function maskBit(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  }
  function applyMask(m) {
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && maskBit(m, x, y)) mod[y][x] = !mod[y][x];
  }
  function addHistory(len, hist) { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); }
  function countPatterns(h) {
    var n = h[1], core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  }
  function terminate(color, len, hist) {
    if (color) { addHistory(len, hist); len = 0; }
    addHistory(len + size, hist);
    return countPatterns(hist);
  }
  function penalty() {
    var result = 0, pass, a, b;
    for (pass = 0; pass < 2; pass++) for (a = 0; a < size; a++) {
      var runColor = false, run = 0, hist = [0, 0, 0, 0, 0, 0, 0];
      for (b = 0; b < size; b++) {
        var col = pass === 0 ? mod[a][b] : mod[b][a];
        if (col === runColor) { run++; if (run === 5) result += 3; else if (run > 5) result++; }
        else { addHistory(run, hist); if (!runColor) result += countPatterns(hist) * 40; runColor = col; run = 1; }
      }
      result += terminate(runColor, run, hist) * 40;
    }
    for (a = 0; a < size - 1; a++) for (b = 0; b < size - 1; b++) {
      var c = mod[a][b];
      if (c === mod[a][b + 1] && c === mod[a + 1][b] && c === mod[a + 1][b + 1]) result += 3;
    }
    var dark = 0;
    for (a = 0; a < size; a++) for (b = 0; b < size; b++) if (mod[a][b]) dark++;
    var total = size * size;
    return result + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  }
  for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  var align = [];
  if (ver > 1) {
    var na = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    align = [6];
    for (var p = size - 7; align.length < na; p -= step) align.splice(1, 0, p);
  }
  for (i = 0; i < align.length; i++) for (j = 0; j < align.length; j++) {
    var last = align.length - 1;
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) setF(align[i] + ax, align[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
  }
  drawFormat(0);
  if (ver >= 7) {
    var vrem = ver;
    for (i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
    var vbits = (ver << 12) | vrem;
    for (i = 0; i < 18; i++) {
      var dark7 = ((vbits >>> i) & 1) !== 0, va = size - 11 + i % 3, vb = Math.floor(i / 3);
      setF(va, vb, dark7); setF(vb, va, dark7);
    }
  }
  var all = cw.all, bitIdx = 0, totalBits = all.length * 8;
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
      var x = right - jj, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && bitIdx < totalBits) { mod[y][x] = ((all[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0; bitIdx++; }
    }
  }
  var best = 0, min = 1e9;
  for (var m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    var pen = penalty();
    if (pen < min) { best = m; min = pen; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return mod;
};
TKLQ.qrPath = function (matrix, border) {
  var d = "";
  for (var y = 0; y < matrix.length; y++) {
    var x = 0;
    while (x < matrix.length) {
      if (!matrix[y][x]) { x++; continue; }
      var start = x;
      while (x < matrix.length && matrix[y][x]) x++;
      d += "M" + (start + border) + " " + (y + border) + "h" + (x - start) + "v1h-" + (x - start) + "z";
    }
  }
  return d;
};
`;
