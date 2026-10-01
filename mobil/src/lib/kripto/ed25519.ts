// Ed25519 imza DOĞRULAMASI (RFC 8032 §5.1.7) — saf JS (BigInt), bağımlılıksız; yalnız doğrular, imzalamaz.
// KATI kip (libsodium kuralı): S < L (kanonik) · A ve R kanonik kodlamalı, çözülebilir nokta (y < p, x=0 iken işaret
// biti 0) · A ve R küçük mertebeli DEĞİL ([8]P ≠ O) · kofaktörsüz denklem R = [S]B − [k]A, encode(R') bayt-eşit.
// Dürüst anahtar/imzada karar node:crypto (OpenSSL) ile aynıdır; yalnız dejenere anahtar/imzayı ondan sıkı reddeder.
// Kâhin: `kripto.test.ts` (RFC 8032 · Wycheproof EdDSA 151 vektör · node:crypto rastgele/bozulma · katı kurallar).
// GEÇİCİ: denetlenmiş kütüphane (@noble/curves) kullanıcı onayıyla gelirse bu dosya ona bırakılır.
import { sha512 } from './sha2';

const n0 = BigInt(0);
const n1 = BigInt(1);
const n2 = BigInt(2);
const P = (n1 << BigInt(255)) - BigInt(19);
const L = (n1 << BigInt(252)) + BigInt('27742317777372353535851937790883648493');

const mod = (a: bigint, m: bigint = P): bigint => {
  const r = a % m;
  return r >= n0 ? r : r + m;
};

function powMod(base: bigint, exponent: bigint): bigint {
  let r = n1;
  let b = mod(base);
  let e = exponent;
  while (e > n0) {
    if (e & n1) r = (r * b) % P;
    b = (b * b) % P;
    e >>= n1;
  }
  return r;
}

const inv = (x: bigint): bigint => powMod(x, P - n2);
const D = mod(-BigInt(121665) * inv(BigInt(121666)));
const D2 = mod(n2 * D);
const SQRT_M1 = powMod(n2, (P - n1) / BigInt(4));

/** Genişletilmiş koordinat (X, Y, Z, T), x = X/Z, y = Y/Z, xy = T/Z. */
interface Point {
  readonly x: bigint;
  readonly y: bigint;
  readonly z: bigint;
  readonly t: bigint;
}

const IDENTITY: Point = { x: n0, y: n1, z: n1, t: n0 };

function add(p: Point, q: Point): Point {
  const a = mod((p.y - p.x) * (q.y - q.x));
  const b = mod((p.y + p.x) * (q.y + q.x));
  const c = mod(p.t * D2 * q.t);
  const d = mod(p.z * n2 * q.z);
  const e = b - a;
  const f = d - c;
  const g = d + c;
  const h = b + a;
  return { x: mod(e * f), y: mod(g * h), z: mod(f * g), t: mod(e * h) };
}

function multiply(k: bigint, p: Point): Point {
  let r = IDENTITY;
  let q = p;
  let e = k;
  while (e > n0) {
    if (e & n1) r = add(r, q);
    q = add(q, q);
    e >>= n1;
  }
  return r;
}

const negate = (p: Point): Point => ({ x: mod(-p.x), y: p.y, z: p.z, t: mod(-p.t) });

/** [8]P = O mu (mertebesi 1/2/4/8 — küçük alt gruptaki nokta)? */
function hasSmallOrder(p: Point): boolean {
  let q = p;
  for (let i = 0; i < 3; i++) q = add(q, q);
  return mod(q.x) === n0 && mod(q.y - q.z) === n0;
}

function fromLittleEndian(b: Uint8Array): bigint {
  let v = n0;
  for (let i = b.length - 1; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[i]);
  return v;
}

/** 32 bayt → nokta; geçersiz kodlama null. */
function decodePoint(b: Uint8Array): Point | null {
  if (b.length !== 32) return null;
  const value = fromLittleEndian(b);
  const sign = (value >> BigInt(255)) & n1;
  const y = value & ((n1 << BigInt(255)) - n1);
  if (y >= P) return null;
  const y2 = mod(y * y);
  const u = mod(y2 - n1);
  const v = mod(D * y2 + n1);
  const x2 = mod(u * inv(v));
  let x = powMod(x2, (P + BigInt(3)) / BigInt(8));
  if (mod(x * x - x2) !== n0) x = mod(x * SQRT_M1);
  if (mod(x * x - x2) !== n0) return null;
  if (x === n0 && sign === n1) return null;
  if ((x & n1) !== sign) x = mod(-x);
  return { x, y, z: n1, t: mod(x * y) };
}

function encodePoint(p: Point): Uint8Array {
  const zi = inv(p.z);
  const x = mod(p.x * zi);
  let y = mod(p.y * zi);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(y & BigInt(0xff));
    y >>= BigInt(8);
  }
  if (x & n1) out[31] |= 0x80;
  return out;
}

const BASE_Y = mod(BigInt(4) * inv(BigInt(5)));
const B = (() => {
  const b = new Uint8Array(32);
  let y = BASE_Y;
  for (let i = 0; i < 32; i++) {
    b[i] = Number(y & BigInt(0xff));
    y >>= BigInt(8);
  }
  const point = decodePoint(b);
  if (!point) throw new Error('ed25519: taban nokta çözülemedi');
  return point;
})();

/** Yalnız bekçi: kodlama → geçerli nokta mı (kanonik + çözülebilir) ve küçük mertebeli mi — katı kuralların birim ölçümü. */
export const _testing = {
  isValidEncoding: (b: Uint8Array): boolean => decodePoint(b) !== null,
  isSmallOrder: (b: Uint8Array): boolean => {
    const p = decodePoint(b);
    return p !== null && hasSmallOrder(p);
  },
};

/** İmza doğru mu? Biçimsiz anahtar/imza da `false` (atmaz). */
export function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const a = decodePoint(publicKey);
  const rPoint = decodePoint(signature.subarray(0, 32));
  if (!a || !rPoint || hasSmallOrder(a) || hasSmallOrder(rPoint)) return false;
  const s = fromLittleEndian(signature.subarray(32));
  if (s >= L) return false;
  const input = new Uint8Array(64 + message.length);
  input.set(signature.subarray(0, 32), 0);
  input.set(publicKey, 32);
  input.set(message, 64);
  const k = mod(fromLittleEndian(sha512(input)), L);
  const r = add(multiply(s, B), multiply(k, negate(a)));
  const expected = encodePoint(r);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected[i] ^ signature[i];
  return diff === 0;
}
