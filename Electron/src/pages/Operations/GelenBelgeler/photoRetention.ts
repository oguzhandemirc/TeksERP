// K28 belge fotoğrafı saklama: onaydan önce belge no'yu kontrol ettiren uyarı (fotoğraf sonra küçülür/silinir).
import type { DocumentScanInfo, PhotoRetentionMode } from "./types";

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

/** K28: fotoğraf saklama ayarı baytı sildi (backend 410 `DOCUMENT_SCAN_PURGED`); satır/okuma/künye duruyor. */
export const SCAN_PURGED_TEXT = "Fotoğraf saklama ayarı gereği silindi.";

/** Detay künyesi SİLİNDİ diyorsa istek hiç atılmaz; eski backend `contentState` göndermez → istenir. */
export function isScanPurged(scan: Pick<DocumentScanInfo, "contentState"> | null | undefined): boolean {
  return scan?.contentState === "PURGED";
}
