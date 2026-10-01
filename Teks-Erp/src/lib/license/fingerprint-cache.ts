// Parmak izi 24 SAAT ÖNBELLEĞİ (K8): etken başına son başarılı okumanın tuzlu özeti `LICENSE_DIR`de. Etken bir
// yoldan okunamadığında özet 24 saate dek bu kayıttan kullanılır; o süre üst üste hiçbir yoldan okunamazsa etken
// KAYIP'tır (özet `null` → v2 kararında uyuşmazlık). Ham değer YOK, yalnız özet. Bütünlük: kurulum tuzundan HMAC —
// bozuk ya da başka tuzla yazılmış kayıt yok sayılır (yeniden okumayla dolar). Saf karar `applyFingerprintCache`;
// L2-6 aynı kaydı imzalı durum kaydına ve DB izine taşır.
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  DigestSchema,
  FINGERPRINT_FACTORS,
  FINGERPRINT_LOSS_AFTER_MS,
  b64uDecode,
  b64uEncode,
  isoToMs,
  msToIso,
  IsoTimeSchema,
  type Fingerprint,
  type FingerprintFactor,
} from "./protocol";
import { readFileState, writeFileAtomicSync } from "./store-files";
import { LICENSE_FILES } from "./store";

export const FINGERPRINT_CACHE_FILE = LICENSE_FILES.FINGERPRINT_CACHE;
const CACHE_MAX_BYTES = 8 * 1024;
const MAC_PREFIX = "tekserp-parmak-izi-onbellek";
/** Saat bu kadar geri giderse önbellek hâlâ geçerli sayılır (NTP düzeltmesi); daha fazlası süresi dolmuş sayılır. */
export const CACHE_CLOCK_BACK_TOLERANCE_MS = 10 * 60 * 1000;

export interface CachedFactor {
  readonly ozet: string;
  /** Son başarılı okumanın anı (ms). */
  readonly an: number;
  readonly yol: string | null;
}
export type FingerprintCache = Readonly<Partial<Record<FingerprintFactor, CachedFactor>>>;

export type FactorSource = "okundu" | "onbellek" | "yok";

export interface CacheDecision {
  /** Kullanılan özet: canlı okuma, yoksa ≤ 24 sa önbellek, yoksa `null` (kayıp/ölçülemedi). */
  readonly effective: Fingerprint;
  readonly kaynak: Readonly<Record<FingerprintFactor, FactorSource>>;
  /** Etkenin son başarılı okuması (ms; hiç okunmadıysa `null`). */
  readonly sonOkuma: Readonly<Record<FingerprintFactor, number | null>>;
  readonly next: FingerprintCache;
  readonly changed: boolean;
}

function fresh(c: CachedFactor, nowMs: number): boolean {
  const age = nowMs - c.an;
  return age >= -CACHE_CLOCK_BACK_TOLERANCE_MS && age < FINGERPRINT_LOSS_AFTER_MS;
}

/** Saf karar: canlı okunan etken önbelleği tazeler; okunamayan etken taze önbellekten, değilse `null`. */
export function applyFingerprintCache(
  live: Fingerprint,
  liveYol: Readonly<Record<FingerprintFactor, string | null>>,
  cache: FingerprintCache,
  nowMs: number,
): CacheDecision {
  const effective: Record<FingerprintFactor, string | null> = { f1: null, f2: null, f3: null, f4: null, f5: null };
  const source: Record<FingerprintFactor, FactorSource> = { f1: "yok", f2: "yok", f3: "yok", f4: "yok", f5: "yok" };
  const lastRead: Record<FingerprintFactor, number | null> = { f1: null, f2: null, f3: null, f4: null, f5: null };
  const next: Partial<Record<FingerprintFactor, CachedFactor>> = {};
  let changed = false;
  for (const f of FINGERPRINT_FACTORS) {
    const value = live[f];
    const c = cache[f];
    if (value !== null) {
      effective[f] = value;
      source[f] = "okundu";
      lastRead[f] = nowMs;
      next[f] = { ozet: value, an: nowMs, yol: liveYol[f] };
      changed = true;
    } else if (c) {
      // Süresi dolan kayıt da tutulur: ekran "son okuma N gün önce" der; özet artık kullanılmaz.
      next[f] = c;
      lastRead[f] = c.an;
      if (fresh(c, nowMs)) {
        effective[f] = c.ozet;
        source[f] = "onbellek";
      }
    }
  }
  return { effective, kaynak: source, sonOkuma: lastRead, next, changed };
}

// ── Dosya (HMAC'li) ─────────────────────────────────────────────────────────────
const CachedFactorFileSchema = z.strictObject({ ozet: DigestSchema, an: IsoTimeSchema, yol: z.string().max(64).nullable() });
const CacheFileSchema = z.strictObject({
  v: z.literal(1),
  onbellek: z.strictObject(Object.fromEntries(FINGERPRINT_FACTORS.map((f) => [f, CachedFactorFileSchema.optional()])) as Record<FingerprintFactor, z.ZodOptional<typeof CachedFactorFileSchema>>),
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/** Kayıt gövdesi sabit sırayla (f1..f5, ozet · an · yol): HMAC iki yazımda aynı metni görür. */
function canonicalEntries(cache: FingerprintCache): Record<string, { ozet: string; an: string; yol: string | null }> {
  const out: Record<string, { ozet: string; an: string; yol: string | null }> = {};
  for (const f of FINGERPRINT_FACTORS) {
    const c = cache[f];
    if (c) out[f] = { ozet: c.ozet, an: msToIso(c.an), yol: c.yol };
  }
  return out;
}

function macOf(entries: Record<string, unknown>, salt: Uint8Array): Buffer {
  return createHmac("sha256", salt).update(`${MAC_PREFIX}\u001f${JSON.stringify(entries)}`).digest();
}

export type CacheRead = { readonly cache: FingerprintCache; readonly durum: "YOK" | "GECERLI" | "BOZUK" };

export function readFingerprintCache(dir: string, salt: Uint8Array): CacheRead {
  const r = readFileState(path.join(dir, FINGERPRINT_CACHE_FILE), CACHE_MAX_BYTES);
  if (r.kind === "YOK") return { cache: {}, durum: "YOK" };
  if (r.kind !== "METIN") return { cache: {}, durum: "BOZUK" };
  let raw: unknown;
  try {
    raw = JSON.parse(r.text);
  } catch {
    return { cache: {}, durum: "BOZUK" };
  }
  const p = CacheFileSchema.safeParse(raw);
  if (!p.success) return { cache: {}, durum: "BOZUK" };
  const cache: Partial<Record<FingerprintFactor, CachedFactor>> = {};
  for (const f of FINGERPRINT_FACTORS) {
    const e = p.data.onbellek[f];
    if (e) cache[f] = { ozet: e.ozet, an: isoToMs(e.an), yol: e.yol };
  }
  const given = b64uDecode(p.data.mac);
  const expected = macOf(canonicalEntries(cache), salt);
  if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) return { cache: {}, durum: "BOZUK" };
  return { cache, durum: "GECERLI" };
}

export function writeFingerprintCache(dir: string, salt: Uint8Array, cache: FingerprintCache): void {
  const onbellek = canonicalEntries(cache);
  writeFileAtomicSync(path.join(dir, FINGERPRINT_CACHE_FILE), JSON.stringify({ v: 1, onbellek, mac: b64uEncode(macOf(onbellek, salt)) }));
}

// ── İmzalı durum kaydındaki kopya (L2-6): aynı içerik, an ISO — kayıt kurulum anahtarıyla imzalı, HMAC gerekmez ────
export type RecordCacheCopy = Partial<Record<FingerprintFactor, { ozet: string; an: string; yol: string | null }>>;

export function cacheToRecordCopy(cache: FingerprintCache | undefined): RecordCacheCopy | undefined {
  if (!cache) return undefined;
  const out = canonicalEntries(cache) as RecordCacheCopy;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function cacheFromRecordCopy(copy: RecordCacheCopy | undefined): FingerprintCache {
  const out: Partial<Record<FingerprintFactor, CachedFactor>> = {};
  for (const f of FINGERPRINT_FACTORS) {
    const e = copy?.[f];
    if (e && Number.isFinite(isoToMs(e.an))) out[f] = { ozet: e.ozet, an: isoToMs(e.an), yol: e.yol };
  }
  return out;
}
