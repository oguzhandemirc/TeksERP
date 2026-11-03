// Tanıtılabilir sayfa = okunmuş fotoğraf (OCR kelimeleri var); PDF okunmaz (K6). Tanınmadı = okunmuş sayfa var ama şablon bağı yok
// (motor GENEL yedek sözlükle okudu — `templateId` null).
import { PDF_MIME } from "../uploadPrep";
import type { DocumentScanInfo } from "../types";

export function teachableScans<T extends Pick<DocumentScanInfo, "status" | "mimeType">>(scans: readonly T[]): T[] {
  return scans.filter((s) => s.status === "READ" && s.mimeType !== PDF_MIME);
}

export function isUnrecognized(note: { templateId: string | null; scans: readonly Pick<DocumentScanInfo, "status" | "mimeType">[] }): boolean {
  return note.templateId === null && teachableScans(note.scans).length > 0;
}
