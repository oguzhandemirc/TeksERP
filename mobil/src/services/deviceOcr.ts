// Cihazda OCR (S16c): sayfa fotoğrafını tabletin ML Kit metin tanımasıyla okur (mobil/modules/teks-erp-belge-tarayici,
// gömülü model). Sonuç yüklemeye `clientOcr` olarak eklenir; sunucu okuma servisini atlar. Modül yoksa (eski APK), hata,
// zaman aşımı ya da beklenmeyen biçimde sonuç `null`dır ve sayfa bugünkü gibi sunucuda okunur — bu dosya hiç fırlatmaz.
import { requireOptionalNativeModule } from 'expo';

/** Tel sözleşmesi — sunucu `Teks-Erp/src/lib/gelen-belge/istemci-ocr.ts` `ClientOcrSchema` ile aynı (katı). */
export interface ClientOcr {
  engine: 'mlkit';
  width: number;
  height: number;
  rotation?: 0 | 90 | 180 | 270;
  ms?: number;
  words: { t: string; c: [number, number][]; l?: number; p?: number | null }[];
  lines?: { c: [number, number][]; p?: number | null }[];
}

/** Sunucu tavanları (aşan okuma gönderilmez; sayfa sunucuda okunur). */
export const CLIENT_OCR_MAX_WORDS = 4000;
export const CLIENT_OCR_MAX_LINES = 2000;
const MAX_WORD_CHARS = 200;
const MAX_COORD = 20000;
/** Cihaz okumasının en uzun süresi (okumanın başından): aşılırsa sayfa beklemeden sunucuya gider. */
export const DEVICE_OCR_TIMEOUT_MS = 4000;
const CACHE_LIMIT = 40;

interface TextReaderNative {
  recognizeTextAsync: (uri: string, timeoutMs: number) => Promise<unknown>;
}

function nativeModule(): TextReaderNative | null {
  let m: Partial<TextReaderNative> | null;
  try {
    m = requireOptionalNativeModule<Partial<TextReaderNative>>('TeksErpBelgeTarayici');
  } catch {
    return null;
  }
  if (!m || typeof m.recognizeTextAsync !== 'function') return null;
  return m as TextReaderNative;
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function quad(v: unknown): [number, number][] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const out: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return null;
    out.push([x, y]);
  }
  return out;
}

function conf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

/** Native dönüşü → tel sözleşmesi; şekil bozuk ya da tavan aşılmışsa null (sunucu yolu). Boş kelime atılır. */
export function toClientOcr(raw: unknown): ClientOcr | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if (!isInt(o.width, 1, 10000) || !isInt(o.height, 1, 10000)) return null;
  const rotation = o.rotation ?? 0;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) return null;
  if (!Array.isArray(o.words) || !Array.isArray(o.lines)) return null;
  if (o.words.length > CLIENT_OCR_MAX_WORDS || o.lines.length > CLIENT_OCR_MAX_LINES) return null;
  const lines: NonNullable<ClientOcr['lines']> = [];
  for (const l of o.lines as unknown[]) {
    const c = quad((l as { c?: unknown } | null)?.c);
    if (!c) return null;
    lines.push({ c, p: conf((l as { p?: unknown }).p) });
  }
  const words: ClientOcr['words'] = [];
  for (const w of o.words as unknown[]) {
    const r = w as { t?: unknown; c?: unknown; l?: unknown; p?: unknown } | null;
    if (!r || typeof r.t !== 'string') return null;
    const c = quad(r.c);
    // Satır sırası ZORUNLU: sunucu tablo satırlarını cihazın satırından kurar (geometrik yedek tabloyu birleştirir).
    if (!c || !isInt(r.l, 0, lines.length - 1)) return null;
    const t = r.t.trim().slice(0, MAX_WORD_CHARS);
    if (!t) continue;
    words.push({ t, c, l: r.l, p: conf(r.p) });
  }
  const ms = typeof o.ms === 'number' && Number.isFinite(o.ms) && o.ms >= 0 ? Math.round(o.ms) : undefined;
  return { engine: 'mlkit', width: o.width, height: o.height, rotation, ...(ms !== undefined ? { ms } : {}), words, lines };
}

interface Entry {
  startedAt: number;
  promise: Promise<ClientOcr | null>;
}
const cache = new Map<string, Entry>();

function devLog(message: string): void {
  // Yalnız geliştirme yapısı: saha süre ölçümü (çekim → OCR → yanıt).
  if (__DEV__) console.warn(`[cihaz-ocr] ${message}`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

/**
 * Sayfayı oku (özet anahtarlı önbellek: çekimde başlayan okuma gönderimde yeniden kullanılır). Süre okumanın başından
 * sayılır; native de aynı süreyle kendi kuyruğunda vazgeçer. Her başarısızlık → null.
 */
export function readPageText(page: { sha256: string; uri: string }, timeoutMs = DEVICE_OCR_TIMEOUT_MS): Promise<ClientOcr | null> {
  const hit = cache.get(page.sha256);
  if (hit) return hit.promise;
  const m = nativeModule();
  if (!m) return Promise.resolve(null);
  const startedAt = Date.now();
  let call: Promise<unknown>;
  try {
    call = m.recognizeTextAsync(page.uri, timeoutMs);
  } catch {
    return Promise.resolve(null);
  }
  const promise = withTimeout(call, timeoutMs).then((raw) => {
    const r = raw == null ? null : toClientOcr(raw);
    devLog(`${page.sha256.slice(0, 8)} okuma ${Date.now() - startedAt} ms · ${r ? `${r.words.length} kelime, native ${r.ms ?? '?'} ms` : 'YOK → sunucu'}`);
    // Başarısız okuma önbellekte kalmaz: aynı sayfa sonraki gönderimde yeniden denenebilir.
    if (!r) cache.delete(page.sha256);
    return r;
  });
  cache.set(page.sha256, { startedAt, promise });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return promise;
}

/**
 * Çekim anında okumayı başlat (sonucu bekleme); gönderimde `readPageText` aynı sözü döner. Tarayıcının çok sayfalı
 * sonucunda yalnız İLK yeni sayfa verilir: native kuyruk sıralıdır, kalanlar gönderimde okunur (i yüklenirken i+1).
 */
export function prefetchPageText(page: { sha256: string; uri: string } | undefined): void {
  if (page) void readPageText(page);
}

/** Gönderim yanıtı geldiğinde çekimden yanıta toplam süre (yalnız geliştirme yapısı). */
export function logDeviceOcrResponse(sha256: string, outcome: string | null | undefined): void {
  const e = cache.get(sha256);
  if (e) devLog(`${sha256.slice(0, 8)} çekim → yanıt ${Date.now() - e.startedAt} ms · sunucu: ${outcome ?? 'cihaz okuması kullanılmadı'}`);
}

/** Yalnız test: önbelleği boşalt. */
export function resetDeviceOcrCache(): void {
  cache.clear();
}
