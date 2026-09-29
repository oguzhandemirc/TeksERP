// =============================================================================
// ÇOK PARÇALI QR (TKLQ1) — lisans çevrimdışı aktarmasının parça biçimi.
// TEK KAYNAK: Teks-Erp/src/lib/license/qr-parca.ts. Panel (Electron), tablet (mobil) ve satıcı
// sunucusu BAYT-EŞİT ayna taşır (bekçi `test_lisans_qr_parca_aynasi`); satıcının /q sayfasındaki
// tarayıcı eşinin eşdeğerliğini satıcı bekçisi `test_qr_sayfasi` ölçer.
//
// Biçim: `TKLQ1|<i>/<n>|<kimlik>|<özet>|<veri>` — n 1…4, i 1…n; kimlik = tam metnin sha256'sının
// ilk 8 onaltılığı (küme kimliği + birleşik bütünlük), özet = parça verisinin sha256'sının ilk 8
// onaltılığı; veri tam metnin ardışık dilimidir ve `|` içerebilir (ilk dört ayraçtan sonrası veri).
// Neden: lisans yanıtı 3–5 KB'tır, tek QR'da telefondan okunamayacak kadar yoğun olur. Özetler
// yanlış/yarım okumayı backend'e gitmeden yakalar; bütünlüğün asıl bekçisi backend'deki imzadır.
// =============================================================================

export const QR_PART_PREFIX = "TKLQ1";
export const QR_PART_MAX_COUNT = 4;
/** Bir parçadaki hedef veri boyu — ekrandan okunabilir yoğunluk (≈ sürüm 20–25, düzeltme L). */
export const QR_PART_TARGET_CHARS = 1000;
/** Dört parçaya bölününce parça başına üst sınır; aşan metin QR'la taşınmaz (metin kopyalanır). */
export const QR_PART_MAX_CHARS = 1500;
const HASH_PREFIX_LEN = 8;

export interface QrPart {
  readonly index: number;
  readonly total: number;
  readonly setId: string;
  readonly digest: string;
  readonly data: string;
}

/** Okutma sırasında toplanan küme — parçalar `index - 1` konumunda, gelmeyen `null`. */
export interface QrPartState {
  readonly setId: string;
  readonly total: number;
  readonly parts: readonly (string | null)[];
}

export type QrPartOutcome =
  | { readonly kind: "gecersiz" }
  | { readonly kind: "tekrar"; readonly state: QrPartState; readonly received: number }
  | { readonly kind: "eklendi"; readonly state: QrPartState; readonly received: number }
  | { readonly kind: "tamam"; readonly text: string }
  | { readonly kind: "bozuk" };

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** UTF-8 baytları; eşsiz vekil U+FFFD olur (TextEncoder ve Node ile aynı). Hermes'te TextEncoder'a dayanmaz. */
function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Saf SHA-256 (onaltılık) — tablette WebCrypto yok; üç istemcide aynı sonuç için tek uygulama. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let s = 56; s >= 0; s -= 8) bytes.push(s >= 32 ? Math.floor(bitLen / 2 ** s) & 255 : (bitLen >>> s) & 255);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w: number[] = new Array<number>(64).fill(0);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 64; t++) {
      if (t < 16) {
        const b = (k: number): number => bytes[off + t * 4 + k] ?? 0;
        w[t] = ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
      } else {
        const w15 = w[t - 15] ?? 0;
        const w2 = w[t - 2] ?? 0;
        const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
        const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
        w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
      }
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (SHA256_K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (next[i] ?? 0)) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

const shortHash = (text: string): string => sha256Hex(text).slice(0, HASH_PREFIX_LEN);

/** Okutulan metin bir TKLQ1 parçası gibi mi başlıyor (ayrıştırmadan önce ucuz süzgeç)? */
export function isQrPart(raw: string): boolean {
  return raw.startsWith(`${QR_PART_PREFIX}|`);
}

/**
 * Metni 1…4 çerçeveli parçaya böler. Boş metin ya da parça başına üst sınırı aşan metin → null
 * (çağıran "metni kopyala" yoluna düşer). Kesim vekil çiftini bölmez.
 */
export function splitIntoQrParts(text: string): string[] | null {
  if (!text) return null;
  const count = Math.min(QR_PART_MAX_COUNT, Math.ceil(text.length / QR_PART_TARGET_CHARS));
  const size = Math.ceil(text.length / count);
  if (size > QR_PART_MAX_CHARS) return null;
  const cuts = [0];
  for (let i = 1; i < count; i++) {
    let at = i * size;
    const prev = text.charCodeAt(at - 1);
    if (prev >= 0xd800 && prev <= 0xdbff) at++;
    cuts.push(at);
  }
  cuts.push(text.length);
  const setId = shortHash(text);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const data = text.slice(cuts[i] ?? 0, cuts[i + 1] ?? text.length);
    parts.push([QR_PART_PREFIX, `${i + 1}/${count}`, setId, shortHash(data), data].join("|"));
  }
  return parts;
}

/** Çerçeveyi ayrıştırır ve parçanın kendi özetini doğrular; biçimsiz ya da bozuk parça → null. */
export function parseQrPart(raw: string): QrPart | null {
  const fields = raw.split("|");
  if (fields.length < 5 || fields[0] !== QR_PART_PREFIX) return null;
  const pos = /^([1-9])\/([1-9])$/.exec(fields[1] ?? "");
  const index = Number(pos?.[1]);
  const total = Number(pos?.[2]);
  if (!pos || total > QR_PART_MAX_COUNT || index > total) return null;
  const setId = fields[2] ?? "";
  const digest = fields[3] ?? "";
  if (!/^[0-9a-f]{8}$/.test(setId) || !/^[0-9a-f]{8}$/.test(digest)) return null;
  const data = fields.slice(4).join("|");
  if (!data || shortHash(data) !== digest) return null;
  return { index, total, setId, digest, data };
}

/**
 * Okutulan bir parçayı kümeye ekler. Başka kümenin parçası gelirse yeni küme başlar (eski yarım
 * küme bırakılır); son parça gelince birleşik metnin özeti kimlikle karşılaştırılır.
 */
export function addQrPart(state: QrPartState | null, raw: string): QrPartOutcome {
  const part = parseQrPart(raw);
  if (!part) return { kind: "gecersiz" };
  const base =
    state && state.setId === part.setId && state.total === part.total
      ? state
      : { setId: part.setId, total: part.total, parts: new Array<string | null>(part.total).fill(null) };
  if (base.parts[part.index - 1] !== null) {
    return { kind: "tekrar", state: base, received: base.parts.filter((p) => p !== null).length };
  }
  const parts = base.parts.map((p, i) => (i === part.index - 1 ? part.data : p));
  const received = parts.filter((p) => p !== null).length;
  if (received < part.total) return { kind: "eklendi", state: { ...base, parts }, received };
  const text = parts.join("");
  return shortHash(text) === part.setId ? { kind: "tamam", text } : { kind: "bozuk" };
}

/** Parça listesini (sırası önemsiz) tek metne birleştirir; eksik/bozuk/karışık küme → null. */
export function joinQrParts(raws: readonly string[]): string | null {
  let state: QrPartState | null = null;
  for (const raw of raws) {
    const r = addQrPart(state, raw);
    if (r.kind === "gecersiz" || r.kind === "bozuk") return null;
    if (r.kind === "tamam") return state === null || parseQrPart(raw)?.setId === state.setId ? r.text : null;
    if (state !== null && r.state.setId !== state.setId) return null;
    state = r.state;
  }
  return null;
}
