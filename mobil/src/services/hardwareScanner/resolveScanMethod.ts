// Okutma yöntemi çözümü — saf yüklem, tek kaynak (plan §1 "Yöntem çözümü" tablosu).
// Varsayılan = bugünkü davranış: okuyucusuz cihazda Otomatik → kamera.
import type { AdapterId } from './adapters';

/** `Build.MANUFACTURER` karşılaştırması: boşluk/tire/alt çizgi atılır, büyük harf (ASCII; tr yerel ayarı YOK). */
export const compactUpper = (s: string): string => s.replace(/[\s_-]+/g, '').toUpperCase();

/** Ayar: Otomatik · Donanım okuyucu · Kamera. */
export type ScanMethodPref = 'auto' | 'hardware' | 'camera';
/** Donanım bağlantısı: Otomatik (adaptör varsa intent) · Klavye (yedek, wedge'e zorla). */
export type HardwareLink = 'auto' | 'wedge';

export type ScanMethod = { kind: 'camera' } | { kind: 'intent'; adapterId: AdapterId } | { kind: 'wedge' };

/**
 * Donanım okuyuculu el terminali üreten markalar (`Build.MANUFACTURER`, boşluk/tire/alt çizgisiz büyük harf).
 * Tanınan adaptörü olmayan bu cihazlar Otomatik'te klavye kamasına düşer — kamera AÇILMAZ. OTA ile genişler.
 */
export const SCANNER_MANUFACTURERS: readonly string[] = [
  'POINTMOBILE',
  'ZEBRA',
  'ZEBRATECHNOLOGIES',
  'SYMBOL',
  'HONEYWELL',
  'INTERMEC',
  'DATALOGIC',
  'UROVO',
  'NEWLAND',
  'CIPHERLAB',
  'SUNMI',
  'IDATA',
  'CHAINWAY',
  'UNITECH',
  'M3',
  'M3MOBILE',
];

/** Adaptörü olsa da klavye kamasına zorlanan modeller (`MANUFACTURER MODEL`, compactUpper) — OTA ile sahadan. */
export const FORCE_WEDGE_MODELS: readonly string[] = [];

export function isScannerManufacturer(manufacturer: string | null | undefined): boolean {
  return !!manufacturer && SCANNER_MANUFACTURERS.includes(compactUpper(manufacturer));
}

export function isForcedWedgeModel(manufacturer: string | null | undefined, model: string | null | undefined): boolean {
  return FORCE_WEDGE_MODELS.includes(compactUpper(`${manufacturer ?? ''}${model ?? ''}`));
}

export interface ResolveInput {
  pref: ScanMethodPref;
  link: HardwareLink;
  /** Yerel modül var ve bir adaptör eşleşti. */
  adapterId: AdapterId | null;
  /** Üretici okuyuculu el terminali markası. */
  scannerVendor: boolean;
  /** Model OTA tablosuyla wedge'e zorlanmış. */
  forcedWedge?: boolean;
}

export function resolveScanMethod(i: ResolveInput): ScanMethod {
  if (i.pref === 'camera') return { kind: 'camera' };
  if (i.link === 'wedge' || i.forcedWedge) {
    // "Klavye (yedek)" yalnız donanım yolunu seçer; okuyucusuz cihazda Otomatik yine kameradır.
    if (i.pref === 'hardware' || i.adapterId || i.scannerVendor) return { kind: 'wedge' };
    return { kind: 'camera' };
  }
  if (i.adapterId) return { kind: 'intent', adapterId: i.adapterId };
  if (i.pref === 'hardware' || i.scannerVendor) return { kind: 'wedge' };
  return { kind: 'camera' };
}

export function parseScanMethodPref(raw: string | null): ScanMethodPref {
  return raw === 'hardware' || raw === 'camera' ? raw : 'auto';
}

export function parseHardwareLink(raw: string | null): HardwareLink {
  return raw === 'wedge' ? 'wedge' : 'auto';
}

const METHOD_SUMMARY: Record<ScanMethod['kind'], string> = {
  intent: 'Donanım okuyucu',
  wedge: 'Okuyucu (klavye yolu)',
  camera: 'Kamera',
};

/** Ayarlar menüsündeki "Barkod ve Kamera" satırının özeti (yöntem + elle yazma). */
export function scanMenuSummary(kind: ScanMethod['kind'], manualEntry: boolean): string {
  return manualEntry ? `${METHOD_SUMMARY[kind]} + elle yazma` : METHOD_SUMMARY[kind];
}
