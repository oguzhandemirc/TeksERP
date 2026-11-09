// Okuma bandının satır seçimi (saf): detayın "Dikkat" kutusu da aynı yüklemle karar verir — iki ayrı koşul yazılmasın.
import { PDF_MIME } from "./uploadPrep";
import type { DeliveryNoteLine, DocumentScanInfo } from "./types";

/**
 * Okunmuş ama kendisinden satır çıkmamış sayfa. `scanId` göndermeyen eski backend'de (undefined) karar
 * verilemez → band yok; satırlar verilmediyse de yok.
 */
export function readWithoutLines(s: DocumentScanInfo, lines: DeliveryNoteLine[] | undefined): boolean {
  if (!lines || s.status !== "READ" || s.mimeType === PDF_MIME) return false;
  if (lines.some((l) => l.scanId === undefined)) return false;
  return !lines.some((l) => l.scanId === s.id);
}

/** Bantta satırı olan sayfalar: PDF · okunmamış/düşmüş · okunmuş ama satırsız. */
export function scanBannerRows(scans: DocumentScanInfo[], lines: DeliveryNoteLine[] | undefined): DocumentScanInfo[] {
  return scans.filter((s) => s.mimeType === PDF_MIME || s.status !== "READ" || readWithoutLines(s, lines));
}
