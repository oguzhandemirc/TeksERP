// =============================================================================
// GELEN BELGE — tablet OKUMA ÖZETİ: "okundu mu, kaç satır, toplam tutuyor mu" (salt okunur)
// =============================================================================
// Tablet (Belge Tara, `gelen-belge:write`) taslağı doğurup sayfaları yükler ama `gelen-belge:read` taşımaz; okumanın
// bittiğini bu özetten izler. Durum + Türkçe neden SUNUCUDA türetilir (istemci kural yazmaz); toplam kapısı onayın
// AYNI saf helper'ından (`totalMismatches`/`totalWarnings`) — ikinci toplam mantığı yok. Yazmaz, audit'e düşmez.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { PDF_MIME } from "./gelen-belge-scan.service";
import { READ_MAX_ATTEMPTS } from "./gelen-belge-okuma.service";
import { totalMismatches, totalWarnings } from "./gelen-belge-onay.service";

export type ReadSummaryState = "NO_PAGES" | "READING" | "NO_SERVICE" | "READ" | "PARTIAL" | "FAILED";

export interface ReadSummaryScan {
  status: "PENDING" | "READING" | "READ" | "READ_FAILED";
  attempts: number;
  mimeType: string;
}

export interface ReadSummaryPages {
  total: number;
  waiting: number;
  read: number;
  failed: number;
}

/**
 * Taramaların toplu okuma durumu + Türkçe neden — saf (bekçi doğrudan sınar). PDF okunmaz (K6), sayaca girmez.
 * Bekleyen sayfa varken servis adresi yoksa NO_SERVICE (sonsuza dek "okunuyor" denmez); bekleyen sayfa önceki denemede
 * düştüyse (PENDING + deneme > 0) neden "yeniden deneniyor" olur. Hepsi düştüyse FAILED, bir kısmı düştüyse PARTIAL.
 */
export function readSummaryState(
  scans: ReadonlyArray<ReadSummaryScan>,
  readerConfigured: boolean,
  lineCount: number,
): { state: ReadSummaryState; reason: string | null; pages: ReadSummaryPages } {
  const photos = scans.filter((s) => s.mimeType !== PDF_MIME);
  const waitingScans = photos.filter((s) => s.status === "PENDING" || s.status === "READING");
  const pages: ReadSummaryPages = {
    total: photos.length,
    waiting: waitingScans.length,
    read: photos.filter((s) => s.status === "READ").length,
    failed: photos.filter((s) => s.status === "READ_FAILED").length,
  };
  if (!photos.length) {
    const reason = scans.length ? "PDF sayfa otomatik okunmaz; satırlar panelde girilir." : "Taslakta okunacak sayfa fotoğrafı yok.";
    return { state: "NO_PAGES", reason, pages };
  }
  if (pages.waiting) {
    if (!readerConfigured) return { state: "NO_SERVICE", reason: "Bu kurulumda okuma servisi yok; satırlar panelde elle girilir.", pages };
    const retry = waitingScans.filter((s) => s.status === "PENDING" && s.attempts > 0).reduce((m, s) => Math.max(m, s.attempts), 0);
    const reason = retry ? `Okuma servisi yanıt vermedi; yeniden deneniyor (deneme ${Math.min(retry + 1, READ_MAX_ATTEMPTS)}/${READ_MAX_ATTEMPTS}).` : null;
    return { state: "READING", reason, pages };
  }
  if (pages.failed === pages.total) {
    return { state: "FAILED", reason: `Okuma servisi ${pages.failed === 1 ? "sayfayı" : `${pages.failed} sayfayı`} okuyamadı. Panelden yeniden okutun ya da satırları elle girin.`, pages };
  }
  if (pages.failed) return { state: "PARTIAL", reason: `${pages.failed} sayfa okunamadı; panelden yeniden okutun.`, pages };
  if (lineCount === 0) return { state: "READ", reason: "Sayfa okundu ama satır çıkmadı; satırları panelde girin.", pages };
  return { state: "READ", reason: null, pages };
}

/** Tablet okuma özeti (`GET /irsaliyeler/:id/okuma-ozeti`). Satır sayıları canlı satırdır (SKIPPED hariç; onay kapısıyla aynı küme). */
export async function getReadSummary(noteId: string) {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: {
      id: true, noteNo: true, status: true, declaredTopCount: true, totalsDeclared: true,
      lines: { select: { blockNo: true, meters: true, weightKg: true, status: true, needsReview: true } },
      scans: { select: { status: true, attempts: true, mimeType: true } },
    },
  });
  if (!note) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const live = note.lines.filter((l) => l.status !== "SKIPPED");
  const { state, reason, pages } = readSummaryState(note.scans, getReaderUrl().url !== null, live.length);
  const blocks = (note.totalsDeclared as { blocks?: unknown[] } | null)?.blocks;
  const declared = Array.isArray(blocks) && blocks.length > 0;
  const mismatches = declared ? totalMismatches(note, note.lines) : [];
  return {
    noteId: note.id,
    noteNo: note.noteNo,
    noteStatus: note.status,
    state,
    reason,
    pages,
    lineCount: live.length,
    reviewCount: live.filter((l) => l.needsReview).length,
    // ok: null = belgede toplam beyanı yok (kıyas yapılamaz); true/false onay kapısının cevabı.
    totals: { declared, ok: declared ? mismatches.length === 0 : null, mismatches },
    warnings: totalWarnings(note, note.lines),
  };
}
