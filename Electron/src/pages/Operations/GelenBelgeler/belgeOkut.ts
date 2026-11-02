// İş emri ekranından "Belge okut" (P3 → K6): okuma aşaması. Kaydetme kapısı belgeden iş emri formunda (`oie/docDraft`).
import { PDF_MIME } from "./uploadPrep";

export type BelgeOkutStage = "READING" | "READ_FAILED" | "READY" | "CLOSED";

interface ScanLike {
  mimeType: string;
  status: string;
}

/** Okunabilir sayfa okunurken READING; hiçbiri okunamadıysa READ_FAILED; belge taslak/kısmi değilse CLOSED. */
export function belgeOkutStage(note: { status: string; scans: readonly ScanLike[] }): BelgeOkutStage {
  if (note.status !== "DRAFT" && note.status !== "PARTIAL") return "CLOSED";
  const readable = note.scans.filter((s) => s.mimeType !== PDF_MIME);
  if (readable.some((s) => s.status === "PENDING" || s.status === "READING")) return "READING";
  if (readable.length > 0 && readable.every((s) => s.status === "READ_FAILED")) return "READ_FAILED";
  return "READY";
}
