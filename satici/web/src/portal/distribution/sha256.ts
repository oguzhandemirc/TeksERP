// Artımlı SHA-256 — WebCrypto yalnız tek parça özet verir; bütün dosyanın özeti parçalar okunurken
// biriktirilir (dosya belleğe alınmaz). Sunucunun yükleme sayfasındaki betiğin (upload-page-script.ts)
// TS eşidir; iki uygulama da Node'un sha256'sıyla ölçülür (bu projede vitest, sunucuda bekçi).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export class Sha256 {
  private readonly h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly buf = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private fill = 0;
  private total = 0;

  private block(b: Uint8Array, o: number): void {
    const w = this.w;
    const h = this.h;
    for (let i = 0; i < 16; i++) w[i] = (b[o + 4 * i]! << 24) | (b[o + 4 * i + 1]! << 16) | (b[o + 4 * i + 2]! << 8) | b[o + 4 * i + 3]!;
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      w[i] = (w[i - 16]! + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7]! + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))) | 0;
    }
    let [a, bb, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    const add = [a, bb, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + add[i]!) | 0;
  }

  update(data: Uint8Array): this {
    let i = 0;
    this.total += data.length;
    if (this.fill > 0) {
      while (i < data.length && this.fill < 64) this.buf[this.fill++] = data[i++]!;
      if (this.fill < 64) return this;
      this.block(this.buf, 0);
      this.fill = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    while (i < data.length) this.buf[this.fill++] = data[i++]!;
    return this;
  }

  hex(): string {
    const bits = this.total * 8;
    const pad = new Uint8Array((this.fill < 56 ? 56 : 120) - this.fill + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 4294967296);
    const lo = bits >>> 0;
    const n = pad.length;
    for (let k = 0; k < 4; k++) {
      pad[n - 8 + k] = (hi >>> (24 - 8 * k)) & 0xff;
      pad[n - 4 + k] = (lo >>> (24 - 8 * k)) & 0xff;
    }
    this.total -= pad.length;
    this.update(pad);
    return Array.from(this.h, (x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
}
