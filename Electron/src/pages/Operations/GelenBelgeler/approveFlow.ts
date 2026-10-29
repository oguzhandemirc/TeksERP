// Onay akışının saf parçaları: hangi 409 gerekçeyle geçilir, sonuç özeti nasıl okunur.
import axios from "axios";
import type { ApproveResult } from "./types";

/** Gerekçeyle (varianceReason) geçilebilen kapılar — backend `gelen-belge-onay.service.ts` precheck. */
export const VARIANCE_CODES = new Set(["TOTAL_MISMATCH", "DELIVERY_NOTE_PAGES_MISSING"]);

/** Hata kodu YALNIZ `details.code`ten (`body.code` hep undefined — kök kural). */
export function errorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const c = (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof c === "string" ? c : null;
}

export function needsVarianceReason(error: unknown): boolean {
  const c = errorCode(error);
  return c !== null && VARIANCE_CODES.has(c);
}

export interface ApproveOutcome {
  status: "APPROVED" | "PARTIAL" | "OTHER";
  title: string;
  failed: Array<{ lineNo: number; blockNo: number; reason: string }>;
}

export function summarizeApprove(r: ApproveResult): ApproveOutcome {
  const failed = r.note.lines
    .filter((l) => l.status === "FAILED")
    .map((l) => ({ lineNo: l.lineNo, blockNo: l.blockNo, reason: l.failReason ?? "Sebep bildirilmedi" }));
  const s = r.note.status;
  const counts = `${r.summary.entered} top girildi${r.summary.replayed ? `, ${r.summary.replayed} önceden girilmiş` : ""}${r.summary.skipped ? `, ${r.summary.skipped} atlandı` : ""}`;
  if (s === "APPROVED") return { status: "APPROVED", title: `Onaylandı — ${counts}.`, failed };
  if (s === "PARTIAL") return { status: "PARTIAL", title: `Kısmi onay — ${counts}, ${r.summary.failed} satır girilemedi.`, failed };
  return { status: "OTHER", title: `Durum: ${s}`, failed };
}
