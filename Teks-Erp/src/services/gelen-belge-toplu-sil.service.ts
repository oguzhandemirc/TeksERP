// =============================================================================
// GELEN BELGE — TOPLU TASLAK SİLME (önizleme + uygula)
// =============================================================================
// İkinci bir silme mantığı DEĞİLDİR: uygula, seçilen her kayıt için tekil `deleteDeliveryNote`ı
// (④ deftere hiç yazmamış taslak; `{id, status: DRAFT}` atomik claim + audit) SIRAYLA çağırır; biri
// düşerse (409/404) yalnız o kaydın sonucu başarısızdır, diğerleri etkilenmez. Önizleme YAZMAZ ve
// silinebilirliği aynı yüklemden (`isDeletableNoteStatus`) okur — yıkıcı işlem kuralı (kök CLAUDE.md).
// =============================================================================
import type { DeliveryNoteStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { hata } from "../lib/logger";
import { AppError } from "../utils/app-error";
import { deleteDeliveryNote, isDeletableNoteStatus } from "./gelen-belge-note.service";

/** Tek istekte en çok bu kadar belge (gövde Zod'u da aynı tavanı taşır). */
export const BULK_DELETE_MAX = 200;

/** Silinemezlik nedeni — durum başına Türkçe; DRAFT için null. */
const BLOCK_REASON: Record<Exclude<DeliveryNoteStatus, "DRAFT">, string> = {
  APPROVING: "Onay sürüyor; belge silinemez.",
  APPROVED: "Onaylanmış belge silinemez (topları doğdu); ancak iptal edilir.",
  PARTIAL: "Kısmi onaylı belge silinemez (toplarının bir kısmı doğdu).",
  CANCELLED: "İptal edilmiş belge silinmez; kaydı iz olarak kalır.",
};
const NOT_FOUND_REASON = "Belge bulunamadı (başka bir oturum silmiş olabilir).";

export interface BulkDeletePreviewItem {
  id: string;
  noteNo: string | null;
  status: DeliveryNoteStatus | null;
  deletable: boolean;
  code: "DELIVERY_NOTE_NOT_DRAFT" | "DELIVERY_NOTE_NOT_FOUND" | null;
  reason: string | null;
  lineCount: number;
  scanCount: number;
  ownerName: string | null;
  senderName: string | null;
  senderDocNo: string | null;
}
export interface BulkDeletePreview {
  items: BulkDeletePreviewItem[];
  summary: { requested: number; deletable: number; blocked: number; lines: number; scans: number };
}
export interface BulkDeleteResultItem {
  id: string;
  noteNo: string | null;
  ok: boolean;
  status: number;
  code: string | null;
  message: string | null;
}
export interface BulkDeleteResult {
  results: BulkDeleteResultItem[];
  summary: { deleted: number; failed: number };
}

const PREVIEW_SELECT = {
  id: true, noteNo: true, status: true, senderText: true, senderDocNo: true,
  ownerCustomer: { select: { name: true } },
  senderCustomer: { select: { name: true } },
  _count: { select: { lines: true, scans: true } },
} as const;

/** Sıra korunur, tekrar eden kimlik tek sayılır (istemci iki kez yollasa da tek sonuç). */
const uniqueIds = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Seçilen her belge için: silinebilir mi + nedeni, satır/sayfa sayısı. YAZMAZ. */
export async function previewBulkDeleteDeliveryNotes(ids: readonly string[]): Promise<BulkDeletePreview> {
  const want = uniqueIds(ids);
  const rows = await prisma.customerDeliveryNote.findMany({ where: { id: { in: want } }, select: PREVIEW_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = want.map((id): BulkDeletePreviewItem => {
    const r = byId.get(id);
    if (!r) {
      return { id, noteNo: null, status: null, deletable: false, code: "DELIVERY_NOTE_NOT_FOUND", reason: NOT_FOUND_REASON, lineCount: 0, scanCount: 0, ownerName: null, senderName: null, senderDocNo: null };
    }
    const deletable = isDeletableNoteStatus(r.status);
    return {
      id, noteNo: r.noteNo, status: r.status, deletable,
      code: deletable ? null : "DELIVERY_NOTE_NOT_DRAFT",
      reason: deletable ? null : BLOCK_REASON[r.status as keyof typeof BLOCK_REASON],
      lineCount: r._count.lines, scanCount: r._count.scans,
      ownerName: r.ownerCustomer?.name ?? null,
      senderName: r.senderCustomer?.name ?? r.senderText ?? null,
      senderDocNo: r.senderDocNo,
    };
  });
  const ok = items.filter((i) => i.deletable);
  return {
    items,
    summary: {
      requested: items.length, deletable: ok.length, blocked: items.length - ok.length,
      lines: ok.reduce((s, i) => s + i.lineCount, 0), scans: ok.reduce((s, i) => s + i.scanCount, 0),
    },
  };
}

/** Seçilen her belgeyi tekil silme yolundan geçirir; kayıt başına sonuç (biri düşerse diğerleri sürer). */
export async function applyBulkDeleteDeliveryNotes(ids: readonly string[], userId: string): Promise<BulkDeleteResult> {
  const results: BulkDeleteResultItem[] = [];
  // Sıralı: her kayıt kendi tx'i + claim'i; paralel tx (Promise.all) yasak.
  for (const id of uniqueIds(ids)) results.push(await deleteOne(id, userId));
  const deleted = results.filter((r) => r.ok).length;
  return { results, summary: { deleted, failed: results.length - deleted } };
}

async function deleteOne(id: string, userId: string): Promise<BulkDeleteResultItem> {
  try {
    const r = await deleteDeliveryNote(id, userId);
    return { id, noteNo: r.noteNo, ok: true, status: 200, code: null, message: null };
  } catch (err) {
    if (err instanceof AppError) {
      const code = typeof err.details?.code === "string" ? err.details.code : null;
      return { id, noteNo: null, ok: false, status: err.statusCode, code, message: err.message };
    }
    hata("gelen-belge", "toplu silme beklenmeyen hata", { id, err: err instanceof Error ? err.message : String(err) });
    return { id, noteNo: null, ok: false, status: 500, code: "UNEXPECTED", message: "Beklenmeyen hata; belge silinmedi." };
  }
}
