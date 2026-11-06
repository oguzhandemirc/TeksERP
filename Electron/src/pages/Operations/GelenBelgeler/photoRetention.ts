// K28 belge fotoğrafı saklama: onaydan önce belge no'yu kontrol ettiren uyarı (fotoğraf sonra küçülür/silinir).
import type { PhotoRetentionMode, ScanContentFields } from "./photoRetentionTypes";

const WHEN: Record<Exclude<PhotoRetentionMode, "FULL">, string> = {
  SHRINK_ON_APPROVAL: "Onaydan sonra fotoğraf küçültülecek",
  DELETE_ON_APPROVAL: "Onaydan sonra fotoğraf silinecek",
  DELETE_ON_DISPATCH: "Toplar sevk edilince fotoğraf silinecek",
};

/** FULL (varsayılan) ya da eski backend (undefined) → uyarı yok. */
export function retentionDocNoWarning(mode: PhotoRetentionMode | null | undefined): string | null {
  if (!mode || mode === "FULL") return null;
  return `${WHEN[mode]} — belge no'yu kontrol edin.`;
}

/**
 * Belgenin saklama kipi — fotoğrafı OLMAYAN belgede (elle/Excel) küçültülecek fotoğraf yok, uyarı da yok (undefined).
 * Başlık formu ve onay diyaloğu bu tek kapıdan okur.
 */
export function retentionModeFor(note: { scans?: ReadonlyArray<unknown>; photoRetention?: PhotoRetentionMode | null }): PhotoRetentionMode | undefined {
  // Tarama listesi bilinmiyorsa (kısmi nesne) bugünkü davranış: kip aynen.
  return note.scans === undefined || note.scans.length > 0 ? (note.photoRetention ?? undefined) : undefined;
}

export function retentionFor(note: { senderDocNo: string | null; scans?: ReadonlyArray<unknown>; photoRetention?: PhotoRetentionMode | null }): { docNo: string | null; mode?: PhotoRetentionMode } {
  return { docNo: note.senderDocNo, mode: retentionModeFor(note) };
}

/** K28: fotoğraf saklama ayarı baytı sildi (backend 410 `DOCUMENT_SCAN_PURGED`); satır/okuma/künye duruyor. */
export const SCAN_PURGED_TEXT = "Fotoğraf saklama ayarı gereği silindi.";

/** Detay künyesi SİLİNDİ diyorsa istek hiç atılmaz; eski backend `contentState` göndermez → istenir. */
/** Kutu koordinatlarının çerçevesi: KÜÇÜK fotoğrafta kutular okuma (2600) çerçevesinde kalır, görüntü bu boyuta gerilir. */
export function scanRectFrame(scan: ScanContentFields | null | undefined): { w: number; h: number } | null {
  const w = scan?.rectFrameWidth;
  const h = scan?.rectFrameHeight;
  return w && h && w > 0 && h > 0 ? { w, h } : null;
}

/** Tanıtma kelime kutuları (`photoRect`) okuma çerçevesindedir; yan dönük sayfada fotoğraf yönüne takas. */
export function wordsRectFrame(d: { imageWidth: number; imageHeight: number; rotation: number }): { w: number; h: number } {
  return d.rotation === 90 || d.rotation === 270 ? { w: d.imageHeight, h: d.imageWidth } : { w: d.imageWidth, h: d.imageHeight };
}

export function isScanPurged(scan: ScanContentFields | null | undefined): boolean {
  return scan?.contentState === "PURGED";
}
