// ML Kit belge tarayıcısına tek erişim noktası (mobil/modules/teks-erp-belge-tarayici).
// Modül yoksa (eski APK), Play Hizmetleri/tarayıcı modülü hazır değilse ya da köprü beklenmedik biçimdeyse
// sonuç "kullanılamaz"dır ve ekran klasik kameraya düşer — bu dosya hiçbir yolda fırlatmaz.
import { requireOptionalNativeModule } from 'expo';

/** Native tarafın sayfa çıktısı (JPEG; uzun kenar hedefe indirilmiş). */
export interface RawScannedPage {
  uri: string;
  base64: string;
  width: number;
  height: number;
  bytes: number;
}

interface BelgeTarayiciNative {
  availabilityAsync: (timeoutMs: number) => Promise<{ available: boolean; reason: string }>;
  scanAsync: (options: {
    pageLimit: number;
    longEdge: number;
    maxBytes: number;
    /** Yüzde (50–100). */
    quality: number;
    startTimeoutMs: number;
  }) => Promise<{ canceled: boolean; pages: RawScannedPage[] }>;
}

export interface ScanRequest {
  pageLimit: number;
  longEdge: number;
  maxBytes: number;
  /** 0–1 (kamera yolundaki CAPTURE_QUALITY ile aynı ölçek). */
  quality: number;
}

export type ScannerOutcome =
  | { kind: 'pages'; pages: RawScannedPage[] }
  | { kind: 'canceled' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; message: string };

/** Uygunluk yoklaması süresi: Play Hizmetleri yanıt vermezse tarama beklemeden kameraya düşer. */
export const AVAILABILITY_TIMEOUT_MS = 3000;
/** Tarayıcı ekranının açılma süresi (modül inmekteyse sınırsız beklenmez). */
export const START_TIMEOUT_MS = 8000;

function nativeModule(): BelgeTarayiciNative | null {
  let m: Partial<BelgeTarayiciNative> | null;
  try {
    m = requireOptionalNativeModule<Partial<BelgeTarayiciNative>>('TeksErpBelgeTarayici');
  } catch {
    return null;
  }
  if (!m || typeof m.availabilityAsync !== 'function' || typeof m.scanAsync !== 'function') return null;
  return m as BelgeTarayiciNative;
}

function isRawPage(p: unknown): p is RawScannedPage {
  const o = p as Partial<RawScannedPage> | null;
  return (
    !!o &&
    typeof o.uri === 'string' &&
    typeof o.base64 === 'string' &&
    o.base64.length > 0 &&
    typeof o.width === 'number' &&
    typeof o.height === 'number'
  );
}

/** Tarayıcıyı aç: önce uygunluk (modül inmemişse native indirmeyi arka plana bırakır), sonra tarama. */
export async function scanWithDocScanner(req: ScanRequest): Promise<ScannerOutcome> {
  const m = nativeModule();
  if (!m) return { kind: 'unavailable', reason: 'no_module' };
  try {
    const a = await m.availabilityAsync(AVAILABILITY_TIMEOUT_MS);
    if (!a || a.available !== true) return { kind: 'unavailable', reason: a?.reason ?? 'unknown' };
  } catch {
    return { kind: 'unavailable', reason: 'error' };
  }
  try {
    const quality = Math.round(Math.min(1, Math.max(0.5, req.quality)) * 100);
    const r = await m.scanAsync({ pageLimit: req.pageLimit, longEdge: req.longEdge, maxBytes: req.maxBytes, quality, startTimeoutMs: START_TIMEOUT_MS });
    if (r?.canceled) return { kind: 'canceled' };
    const pages = Array.isArray(r?.pages) ? r.pages.filter(isRawPage) : [];
    if (!pages.length) return { kind: 'canceled' };
    return { kind: 'pages', pages };
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    // Başlatılamadı (modül inmekte, etkinlik yok): kullanıcı hiçbir şey görmedi → sessiz kamera yedeği.
    if (code === 'ERR_DOC_SCAN_UNAVAILABLE') return { kind: 'unavailable', reason: 'start_failed' };
    return { kind: 'error', message: e instanceof Error && e.message ? e.message : 'Belge tarayıcı hatası' };
  }
}
