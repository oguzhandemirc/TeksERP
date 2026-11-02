// İş emri ekranından "Belge okut" (P3 → K6): okuma aşaması. Kaydetme kapısı belgeden iş emri formunda (`oie/docDraft`).
import { PDF_MIME } from "./uploadPrep";

export type BelgeOkutStage = "READING" | "READ_FAILED" | "NO_SERVICE" | "READY" | "CLOSED";

interface ScanLike {
  mimeType: string;
  status: string;
}

/**
 * Okunabilir sayfa okunurken READING; okuyucusuz kurulumda bekleyen sayfa NO_SERVICE (hiç okunmayacak — form elle dolar);
 * hiçbiri okunamadıysa READ_FAILED; belge taslak/kısmi değilse CLOSED. `readerConfigured` yoksa (eski backend) bugünkü davranış.
 */
export function belgeOkutStage(note: { status: string; scans: readonly ScanLike[]; readerConfigured?: boolean }): BelgeOkutStage {
  if (note.status !== "DRAFT" && note.status !== "PARTIAL") return "CLOSED";
  const readable = note.scans.filter((s) => s.mimeType !== PDF_MIME);
  if (readable.some((s) => s.status === "PENDING" || s.status === "READING")) return note.readerConfigured === false ? "NO_SERVICE" : "READING";
  if (readable.length > 0 && readable.every((s) => s.status === "READ_FAILED")) return "READ_FAILED";
  return "READY";
}
