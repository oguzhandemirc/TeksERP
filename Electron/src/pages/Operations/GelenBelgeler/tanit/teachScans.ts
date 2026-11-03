// Tanıtılabilir sayfa = okunmuş fotoğraf (OCR kelimeleri var); PDF okunmaz (K6). Tanınmadı = okunmuş sayfa var ama şablon bağı yok
// (motor GENEL yedek sözlükle okudu — `templateId` null).
import { PDF_MIME } from "../uploadPrep";
import type { DocumentScanInfo } from "../types";

type TeachScanFields = Pick<DocumentScanInfo, "status" | "mimeType" | "contentState">;

/** Okunmuş fotoğraf sayfaları (baytı saklama ayarıyla silinmiş olanlar dahil). */
function readPhotoScans<T extends TeachScanFields>(scans: readonly T[]): T[] {
  return scans.filter((s) => s.status === "READ" && s.mimeType !== PDF_MIME);
}

/** K28: SİLİNDİ fotoğrafta tanıtma kapalı (fotoğraf çizilemez); KÜÇÜK'te en iyi çaba açık. */
export function teachableScans<T extends TeachScanFields>(scans: readonly T[]): T[] {
  return readPhotoScans(scans).filter((s) => s.contentState !== "PURGED");
}

/** Okunmuş fotoğrafı var ama hepsi saklama ayarıyla silinmiş → tanıtma kapalı, açıklama gösterilir. */
export function allReadPhotosPurged(scans: readonly TeachScanFields[]): boolean {
  const read = readPhotoScans(scans);
  return read.length > 0 && read.every((s) => s.contentState === "PURGED");
}

export function isUnrecognized(note: { templateId: string | null; scans: readonly TeachScanFields[] }): boolean {
  return note.templateId === null && teachableScans(note.scans).length > 0;
}
