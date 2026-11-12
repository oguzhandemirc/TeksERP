// Belge fotoğrafındaki barkodlar (2026-11-09): expo-camera'nın paketli ML Kit barkod okuyucusu (`scanFromURLAsync`,
// APK'da zaten var — yeni paket/native yok). Sonuç yüklemeye `barcodes` olarak eklenir; sunucu şablonda "Barkoddan al"
// işaretli alana kesin değer yazar. Modül yok (eski APK/iOS), hata ya da zaman aşımı → [] ve yükleme bugünkü gibi gider.
import { requireOptionalNativeModule } from 'expo';

/** Tel sözleşmesi — sunucu `Teks-Erp/src/lib/gelen-belge/barkod.ts` `PageBarcodesSchema` ile aynı. */
export interface PageBarcode {
  format: string;
  value: string;
}

export const MAX_PAGE_BARCODES = 10;
export const MAX_BARCODE_CHARS = 120;
/** Barkod okumasının en uzun süresi: aşılırsa sayfa barkodsuz gider. */
export const DEVICE_BARCODE_TIMEOUT_MS = 2500;
/** Belgelerde görülen tüm 1B/2B türler (varsayılan yalnız `qr` olduğu için açıkça verilir). */
const TYPES = ['code128', 'code39', 'code93', 'codabar', 'ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'qr', 'datamatrix', 'pdf417', 'aztec'];
const CACHE_LIMIT = 40;

interface CameraNative {
  scanFromURLAsync: (url: string, types: string[]) => Promise<unknown>;
}

function nativeModule(): CameraNative | null {
  let m: Partial<CameraNative> | null;
  try {
    m = requireOptionalNativeModule<Partial<CameraNative>>('ExpoCamera');
  } catch {
    return null;
  }
  return m && typeof m.scanFromURLAsync === 'function' ? (m as CameraNative) : null;
}

/** Native dönüşü → tel sözleşmesi: denetim karakteri atılır, boş/yinelenen atılır, en çok 10 × 120 karakter. */
export function toPageBarcodes(raw: unknown): PageBarcode[] {
  if (!Array.isArray(raw)) return [];
  const out: PageBarcode[] = [];
  const seen = new Set<string>();
  for (const r of raw as unknown[]) {
    const o = r as { type?: unknown; data?: unknown } | null;
    if (!o || typeof o.data !== 'string') continue;
    const value = o.data.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_BARCODE_CHARS);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const format = (typeof o.type === 'string' || typeof o.type === 'number' ? String(o.type) : 'unknown').slice(0, 24);
    out.push({ format, value });
    if (out.length >= MAX_PAGE_BARCODES) break;
  }
  return out;
}

const cache = new Map<string, Promise<PageBarcode[]>>();

/** Sayfanın barkodları (özet anahtarlı önbellek); hiç fırlatmaz — her başarısızlık []. */
export function readPageBarcodes(page: { sha256: string; uri: string }, timeoutMs = DEVICE_BARCODE_TIMEOUT_MS): Promise<PageBarcode[]> {
  const hit = cache.get(page.sha256);
  if (hit) return hit;
  const m = nativeModule();
  if (!m) return Promise.resolve([]);
  let call: Promise<unknown>;
  try {
    call = m.scanFromURLAsync(page.uri, TYPES);
  } catch {
    return Promise.resolve([]);
  }
  const promise = new Promise<PageBarcode[]>((resolve) => {
    const timer = setTimeout(() => resolve([]), timeoutMs);
    call.then(
      (v) => { clearTimeout(timer); resolve(toPageBarcodes(v)); },
      () => { clearTimeout(timer); resolve([]); },
    );
  }).then((r) => {
    // Boş sonuç önbellekte kalmaz: aynı sayfa sonraki gönderimde yeniden denenir.
    if (!r.length) cache.delete(page.sha256);
    return r;
  });
  cache.set(page.sha256, promise);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return promise;
}

/** Yalnız test: önbelleği boşalt. */
export function resetDeviceBarcodeCache(): void {
  cache.clear();
}
