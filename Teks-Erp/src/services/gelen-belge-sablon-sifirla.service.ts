// =============================================================================
// Gelen belge KULLANICI ŞABLONU SIFIRLA (2026-11-09): "bu tipi unut" = PASİFE AL (sert silme yok — belge `templateId` FK
// Restrict + defter ilkesi). Önizleme ucu YAZMAZ ve etkilenen her şeyi listeler; sıfırla kayıt başına SIRAYLA atomik claim
// (`updateMany WHERE {code, version, isActive: true}`) + audit (tx dışında). Eski belgeler/okumalar/İE'ler DEĞİŞMEZ; geri al
// mevcut PATCH /sablonlar/:code `isActive: true`. Aynı adla yeniden tanıtım sonekli kod alır (`createUserTemplate`).
// =============================================================================
import { DeliveryNoteStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { loadUserTemplates, USER_TEMPLATE_PREFIX } from "./gelen-belge-ozel-sablon.service";

const TABLE = "SENDER_TEMPLATE";
/** Önizlemede şablon başına listelenen açık taslak tavanı (fazlası `draftsTotal` ile sayılır). */
export const RESET_PREVIEW_DRAFT_LIMIT = 50;

export type ResetFailReason = "NOT_FOUND" | "ALREADY_INACTIVE" | "VERSION_CHANGED";
const FAIL_TEXT: Record<ResetFailReason, string> = {
  NOT_FOUND: "Belge tipi bulunamadı.",
  ALREADY_INACTIVE: "Belge tipi zaten sıfırlanmış.",
  VERSION_CHANGED: "Belge tipi bu arada değişti; önizlemeyi yenileyin.",
};
const failure = (code: string, reason: ResetFailReason) => ({ code, reason, message: FAIL_TEXT[reason] });

const nameOf = (tpl: unknown, code: string): string => {
  const n = (tpl as { name?: unknown } | null)?.name;
  return typeof n === "string" && n.trim() ? n : code;
};

export interface ResetPreviewItem {
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  hitCount: number;
  lastReadAt: Date | null;
  notesByStatus: Partial<Record<DeliveryNoteStatus, number>>;
  drafts: Array<{ id: string; documentNo: string; senderDocNo: string | null; createdAt: Date }>;
  draftsTotal: number;
  sender: { id: string; code: string; name: string } | null;
}

/** Önizleme (salt okunur): şablon başına sürüm, okuma sayısı, belge durumları, açık taslaklar, bağlı gönderen. Bilinmeyen kod `failed`. */
export async function previewUserTemplateReset(codes: readonly string[]): Promise<{ items: ResetPreviewItem[]; failed: Array<ReturnType<typeof failure>> }> {
  const items: ResetPreviewItem[] = [];
  const failed: Array<ReturnType<typeof failure>> = [];
  for (const code of [...new Set(codes)]) {
    const row = code.startsWith(USER_TEMPLATE_PREFIX)
      ? await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true, version: true, isActive: true, hitCount: true, template: true, senderCustomer: { select: { id: true, code: true, name: true } } } })
      : null;
    if (!row) { failed.push(failure(code, "NOT_FOUND")); continue; }
    const groups = await prisma.customerDeliveryNote.groupBy({ by: ["status"], where: { templateId: row.id }, _count: { _all: true } });
    const last = await prisma.customerDeliveryNote.findFirst({ where: { templateId: row.id }, select: { createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const draftWhere = { templateId: row.id, status: DeliveryNoteStatus.DRAFT };
    const drafts = await prisma.customerDeliveryNote.findMany({ where: draftWhere, select: { id: true, noteNo: true, senderDocNo: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: RESET_PREVIEW_DRAFT_LIMIT });
    items.push({
      code, name: nameOf(row.template, code), version: row.version, isActive: row.isActive, hitCount: row.hitCount,
      lastReadAt: last?.createdAt ?? null,
      notesByStatus: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
      drafts: drafts.map((d) => ({ id: d.id, documentNo: d.noteNo, senderDocNo: d.senderDocNo, createdAt: d.createdAt })),
      draftsTotal: drafts.length < RESET_PREVIEW_DRAFT_LIMIT ? drafts.length : await prisma.customerDeliveryNote.count({ where: draftWhere }),
      sender: row.senderCustomer,
    });
  }
  return { items, failed };
}

/**
 * Sıfırla: kayıt başına SIRAYLA (Promise.all yok) atomik claim; tutmayan kayıt nedeniyle `failed`e (öteki kayıtlar sürer).
 * İdempotent: ikinci çağrı `ALREADY_INACTIVE`, yan etkisiz. Sonda motor önbelleği bir kez tazelenir.
 */
export async function resetUserTemplates(items: ReadonlyArray<{ code: string; expectedVersion: number }>, userId: string): Promise<{ done: Array<{ code: string; version: number }>; failed: Array<ReturnType<typeof failure>> }> {
  const done: Array<{ code: string; version: number }> = [];
  const failed: Array<ReturnType<typeof failure>> = [];
  for (const it of items) {
    if (!it.code.startsWith(USER_TEMPLATE_PREFIX)) { failed.push(failure(it.code, "NOT_FOUND")); continue; }
    const c = await prisma.senderTemplate.updateMany({ where: { code: it.code, version: it.expectedVersion, isActive: true }, data: { isActive: false } });
    if (c.count === 0) {
      const now = await prisma.senderTemplate.findUnique({ where: { code: it.code }, select: { isActive: true } });
      failed.push(failure(it.code, !now ? "NOT_FOUND" : !now.isActive ? "ALREADY_INACTIVE" : "VERSION_CHANGED"));
      continue;
    }
    const row = await prisma.senderTemplate.findUniqueOrThrow({ where: { code: it.code }, select: { id: true } });
    await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: row.id, oldData: { code: it.code, version: it.expectedVersion, isActive: true }, newData: { code: it.code, version: it.expectedVersion, isActive: false, reason: "RESET" } });
    done.push({ code: it.code, version: it.expectedVersion });
  }
  if (done.length) await loadUserTemplates();
  return { done, failed };
}
