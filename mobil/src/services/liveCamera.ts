// Canlı okuma (L2) — native canlı kamera görünümünün (mobil/modules/teks-erp-belge-tarayici `LiveCameraView`) saf JS
// katmanı: kullanılabilirlik yoklaması + olay ayrıştırma/doğrulama + kare→görünüm dönüşümü. Modül ya da işlev yoksa
// (eski APK) `isLiveCameraAvailable()` false döner; bu dosya hiçbir yolda fırlatmaz. Kotlin sabitleri `LiveTuning.kt`.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { toClientOcr, type ClientOcr } from './deviceOcr';

/** Native sözleşme sürümü: `liveCameraInfo().version` en az bu olmalı. */
export const LIVE_CAMERA_MIN_VERSION = 1;
/** `torch` görünüm özelliği bu sürümle geldi; eski APK'da fener düğmesi çizilmez (çalışmayan düğme yok). */
export const LIVE_CAMERA_TORCH_VERSION = 2;

interface LiveCameraNativeInfo {
  liveCameraInfo: () => unknown;
}

/** Native canlı kamera sözleşme sürümü; modül/işlev yok ya da bozuk → 0 (fırlatmaz). */
function liveCameraVersion(): number {
  if (Platform.OS !== 'android') return 0;
  try {
    const m = requireOptionalNativeModule<Partial<LiveCameraNativeInfo>>('TeksErpBelgeTarayici');
    if (!m || typeof m.liveCameraInfo !== 'function') return 0;
    const info = m.liveCameraInfo() as { version?: unknown } | null;
    return typeof info?.version === 'number' ? info.version : 0;
  } catch {
    return 0;
  }
}

/** Yeni APK'da `true`; eski APK, iOS/web ya da bozuk köprüde `false` (canlı okuma seçeneği gizlenir). */
export function isLiveCameraAvailable(): boolean {
  return liveCameraVersion() >= LIVE_CAMERA_MIN_VERSION;
}

/** Canlı kamera feneri yönetebiliyor mu (native `torch` özelliği). */
export function isLiveTorchAvailable(): boolean {
  return liveCameraVersion() >= LIVE_CAMERA_TORCH_VERSION;
}

/** `onText`: o anki karenin okuması. `ocr` sunucuya AYNEN gidebilir (koordinatlar dik kare çerçevesinde, rotation 0). */
export interface LiveTextFrame {
  ocr: ClientOcr;
  /** Algılayıcının kareye uyguladığı dönüş (bilgi; koordinatlar zaten dik). */
  sensorRotation: 0 | 90 | 180 | 270;
  /** Okumanın bittiği an (epoch ms). */
  at: number;
}

/** `onStability`: `still` = kamera art arda birkaç kare kıpırtısız; `sharpness` = orta bölge netliği (parlaklık birimi 0–255). */
export interface LiveStability {
  still: boolean;
  sharpness: number;
}

export type LiveCameraErrorCode = 'NO_PERMISSION' | 'NO_ACTIVITY' | 'CAMERA_UNAVAILABLE' | 'READER_FAILED' | 'UNKNOWN';

export interface LiveCameraError {
  code: LiveCameraErrorCode;
  message: string;
}

export interface LiveStill {
  uri: string;
  width: number;
  height: number;
}

const ROTATIONS = new Set([0, 90, 180, 270]);
const ERROR_CODES = new Set<LiveCameraErrorCode>(['NO_PERMISSION', 'NO_ACTIVITY', 'CAMERA_UNAVAILABLE', 'READER_FAILED']);

/** Native `onText` yükü → kare; şekil bozuk ya da tavan aşılmışsa null (kare atlanır). Doğrulama `toClientOcr`ta TEK yerde. */
export function parseLiveText(raw: unknown): LiveTextFrame | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if ((o.rotation ?? 0) !== 0) return null;
  const ocr = toClientOcr(o);
  if (!ocr) return null;
  const sensorRotation = o.sensorRotation ?? 0;
  if (typeof sensorRotation !== 'number' || !ROTATIONS.has(sensorRotation)) return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now();
  return { ocr, sensorRotation: sensorRotation as LiveTextFrame['sensorRotation'], at };
}

export function parseLiveStability(raw: unknown): LiveStability | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.still !== 'boolean') return null;
  if (typeof o.sharpness !== 'number' || !Number.isFinite(o.sharpness) || o.sharpness < 0) return null;
  return { still: o.still, sharpness: Math.min(255, o.sharpness) };
}

/** Bilinmeyen kod `UNKNOWN`a iner; mesaj yoksa genel Türkçe metin. Hiç null dönmez (hata kaybolmaz). */
export function parseLiveError(raw: unknown): LiveCameraError {
  const o = (raw ?? {}) as Record<string, unknown>;
  const code = typeof o.code === 'string' && ERROR_CODES.has(o.code as LiveCameraErrorCode) ? (o.code as LiveCameraErrorCode) : 'UNKNOWN';
  const message = typeof o.message === 'string' && o.message.trim() ? o.message : 'Kamera çalışmadı';
  return { code, message };
}

/** `captureStill` dönüşü; bozuksa fırlatır (çağıran yükleme yoluna geçmez). */
export function parseLiveStill(raw: unknown): LiveStill {
  const o = raw as Record<string, unknown> | null;
  const okInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 20000;
  if (!o || typeof o.uri !== 'string' || !o.uri.startsWith('file://') || !okInt(o.width) || !okInt(o.height)) {
    throw new Error('Fotoğraf çekilemedi');
  }
  return { uri: o.uri, width: o.width as number, height: o.height as number };
}

/**
 * Kare koordinatı → görünüm koordinatı. Önizleme FIT_CENTER'dır: kare görünüme oranı korunarak sığar, boşluk ortalanır.
 * Dönüş `{ scale, dx, dy }`: viewX = x·scale + dx. Boyut geçersizse null.
 */
export function frameToView(frame: { width: number; height: number }, view: { width: number; height: number }): { scale: number; dx: number; dy: number } | null {
  if (!(frame.width > 0 && frame.height > 0 && view.width > 0 && view.height > 0)) return null;
  const scale = Math.min(view.width / frame.width, view.height / frame.height);
  return { scale, dx: (view.width - frame.width * scale) / 2, dy: (view.height - frame.height * scale) / 2 };
}
