// SHA-256 (akışlı) + SHA-512 — saf JS, bağımlılıksız (FIPS 180-4). Tablet APK künyesi için: kurulum dosyası
// belleğe alınmadan parça parça özetlenir; SHA-512 yalnız Ed25519 doğrulamasının kısa girdisi içindir.
// Kâhin: `kripto.test.ts` (node:crypto ile rastgele girdi + parça sınırları).

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Akışlı SHA-256: `update` istediği kadar, `digest` bir kez. */
export class Sha256 {
  private readonly h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly w = new Uint32Array(64);
  private readonly block = new Uint8Array(64);
  private filled = 0;
  private total = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: digest sonrası update');
    let i = 0;
    this.total += data.length;
    if (this.filled > 0) {
      const al = Math.min(64 - this.filled, data.length);
      this.block.set(data.subarray(0, al), this.filled);
      this.filled += al;
      i = al;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.compress(data, i);
    if (i < data.length) {
      this.block.set(data.subarray(i), 0);
      this.filled = data.length - i;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256: ikinci digest');
    const bits = this.total * 8;
    const pad = new Uint8Array((this.filled < 56 ? 64 : 128) - this.filled);
    pad[0] = 0x80;
    const n = pad.length;
    const high = Math.floor(bits / 0x100000000);
    for (let k = 0; k < 4; k++) {
      pad[n - 8 + k] = (high >>> (24 - 8 * k)) & 0xff;
      pad[n - 4 + k] = (bits >>> (24 - 8 * k)) & 0xff;
    }
    const saved = this.total;
    this.update(pad);
    this.total = saved;
    this.finished = true;
    const out = new Uint8Array(32);
    for (let k = 0; k < 8; k++) {
      out[4 * k] = this.h[k] >>> 24;
      out[4 * k + 1] = (this.h[k] >>> 16) & 0xff;
      out[4 * k + 2] = (this.h[k] >>> 8) & 0xff;
      out[4 * k + 3] = this.h[k] & 0xff;
    }
    return out;
  }

  private compress(b: Uint8Array, o: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) w[t] = (b[o + 4 * t] << 24) | (b[o + 4 * t + 1] << 16) | (b[o + 4 * t + 2] << 8) | b[o + 4 * t + 3];
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = this.h;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[t] + w[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    const s = [a, bb, c, d, e, f, g, h];
    for (let k = 0; k < 8; k++) this.h[k] = (this.h[k] + s[k]) | 0;
  }
}

export function sha256(data: Uint8Array): Uint8Array {
  return new Sha256().update(data).digest();
}

export function hex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

// ── SHA-512 (BigInt; yalnız kısa girdi — Ed25519 özeti) ──────────────────────
const M64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const K512 = [
  '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019',
  '923f82a4af194f9b', 'ab1c5ed5da6d8118', 'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
  '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694', 'e49b69c19ef14ad2', 'efbe4786384f25e3',
  '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
  '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725',
  '06ca6351e003826f', '142929670a0e6e70', '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
  '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b', 'a2bfe8a14cf10364', 'a81a664bbc423001',
  'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb',
  '5b9cca4f7763e373', '682e6ff3d6b2b8a3', '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
  '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b', 'ca273eceea26619c', 'd186b8c721c0c207',
  'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
  '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a',
  '5fcb6fab3ad6faec', '6c44198c4a475817',
].map((x) => BigInt(`0x${x}`));
const H512 = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f',
  '1f83d9abfb41bd6b', '5be0cd19137e2179'].map((x) => BigInt(`0x${x}`));
const rotr64 = (x: bigint, n: number): bigint => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;

function compress512(h: bigint[], b: Uint8Array, o: number): void {
  const w: bigint[] = [];
  for (let t = 0; t < 16; t++) {
    let v = BigInt(0);
    for (let k = 0; k < 8; k++) v = (v << BigInt(8)) | BigInt(b[o + 8 * t + k]);
    w.push(v);
  }
  for (let t = 16; t < 80; t++) {
    const s0 = rotr64(w[t - 15], 1) ^ rotr64(w[t - 15], 8) ^ (w[t - 15] >> BigInt(7));
    const s1 = rotr64(w[t - 2], 19) ^ rotr64(w[t - 2], 61) ^ (w[t - 2] >> BigInt(6));
    w.push((w[t - 16] + s0 + w[t - 7] + s1) & M64);
  }
  let [a, bb, c, d, e, f, g, hh] = h;
  for (let t = 0; t < 80; t++) {
    const t1 = (hh + (rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41)) + ((e & f) ^ (~e & M64 & g)) + K512[t] + w[t]) & M64;
    const t2 = ((rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39)) + ((a & bb) ^ (a & c) ^ (bb & c))) & M64;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) & M64;
    d = c;
    c = bb;
    bb = a;
    a = (t1 + t2) & M64;
  }
  const s = [a, bb, c, d, e, f, g, hh];
  for (let k = 0; k < 8; k++) h[k] = (h[k] + s[k]) & M64;
}

export function sha512(data: Uint8Array): Uint8Array {
  const len = data.length;
  const padLen = (len % 128 < 112 ? 128 : 256) - (len % 128);
  const m = new Uint8Array(len + padLen);
  m.set(data);
  m[len] = 0x80;
  const bits = BigInt(len) * BigInt(8);
  for (let k = 0; k < 16; k++) m[m.length - 1 - k] = Number((bits >> BigInt(8 * k)) & BigInt(0xff));
  const h = [...H512];
  for (let o = 0; o < m.length; o += 128) compress512(h, m, o);
  const out = new Uint8Array(64);
  h.forEach((v, i) => {
    for (let k = 0; k < 8; k++) out[8 * i + k] = Number((v >> BigInt(56 - 8 * k)) & BigInt(0xff));
  });
  return out;
}
