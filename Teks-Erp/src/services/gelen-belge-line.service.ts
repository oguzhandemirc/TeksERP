// =============================================================================
// GELEN BELGE — irsaliye taslağı SATIRLARI (D2): satır ekle/düzelt/sil + DRAFT claim
// =============================================================================
// Her satır yolu önce başlığı `updateMany WHERE {id, status: DRAFT}` ile ATOMİK CLAIM eder (count 0
// → 404/409); satır kilidi = başlık satırıdır. Taslak defter değildir; satır silme ④ sınıfı
// (`docs/kurallar/defter.md`). Başlık CRUD'u `gelen-belge-note.service.ts`te (bu dosya oradan import
// EDİLİR; ters yön yok — döngü yok). TEK istisna `updateDeliveryNoteLine`: PARTIAL belgede yalnız topsuz FAILED
// satır düzeltilir/atlanır (D4 kısmi onayın çıkışı; claim WHERE {id, PARTIAL} + satır WHERE {FAILED, rollId null}).
// =============================================================================
import { DeliveryNoteLineKind, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";

const LINE_TABLE = "CUSTOMER_DELIVERY_NOTE_LINE";

export interface DeliveryNoteLineInput {
  lineKind?: DeliveryNoteLineKind;
  blockNo?: number;
  senderRollNo?: string | null;
  meters: number;
  weightKg?: number | null;
  widthCm?: number | null;
  itemText?: string | null;
  itemId?: string | null;
  colorText?: string | null;
  colorId?: string | null;
  processText?: string | null;
  needsReview?: boolean;
}
export const LINE_SELECT = {
  id: true, noteId: true, lineNo: true, blockNo: true, lineKind: true, senderRollNo: true, meters: true, weightKg: true,
  widthCm: true, itemText: true, itemId: true, colorText: true, colorId: true, processText: true, confidence: true,
  needsReview: true, sourceRects: true, status: true, failReason: true, rollId: true, createdAt: true, updatedAt: true,
  // E4: satırı doğuran tarama (OCR satırı; elle/Excel null) — panel kırpığı doğru sayfadan alır.
  scanId: true,
  item: { select: { id: true, code: true, name: true } },
  color: { select: { id: true, code: true, name: true } },
} as const;

export const text = (v: string | null | undefined): string | null => (v === undefined ? null : (v?.trim() || null));

/** Audit yükü: satır künyesi (sourceRects/confidence yok — OCR ham izi audit'e girmez). */
export function auditLine(l: { lineNo: number; blockNo: number; lineKind: string; senderRollNo: string | null; meters: Prisma.Decimal; weightKg: Prisma.Decimal | null; widthCm: Prisma.Decimal | null; itemText: string | null; itemId: string | null; colorText: string | null; colorId: string | null; processText: string | null; needsReview: boolean; status: string }) {
  return {
    lineNo: l.lineNo, blockNo: l.blockNo, lineKind: l.lineKind, senderRollNo: l.senderRollNo, meters: l.meters.toString(),
    weightKg: l.weightKg?.toString() ?? null, widthCm: l.widthCm?.toString() ?? null, itemText: l.itemText, itemId: l.itemId,
    colorText: l.colorText, colorId: l.colorId, processText: l.processText, needsReview: l.needsReview, status: l.status,
  };
}

export function lineColumns(input: DeliveryNoteLineInput) {
  if (!(input.meters > 0)) throw AppError.badRequest("Satır metrajı sıfırdan büyük olmalı.", { code: "DELIVERY_NOTE_LINE_METERS" });
  return {
    lineKind: input.lineKind ?? "TOP",
    blockNo: input.blockNo ?? 1,
    senderRollNo: text(input.senderRollNo),
    meters: new Prisma.Decimal(input.meters),
    weightKg: input.weightKg === undefined || input.weightKg === null ? null : new Prisma.Decimal(input.weightKg),
    widthCm: input.widthCm === undefined || input.widthCm === null ? null : new Prisma.Decimal(input.widthCm),
    itemText: text(input.itemText),
    itemId: input.itemId ?? null,
    colorText: text(input.colorText),
    colorId: input.colorId ?? null,
    processText: text(input.processText),
    needsReview: input.needsReview ?? false,
    // Elle/Excel satır: güven 1 (OCR satırları D3b'de kendi güvenini yazar).
    confidence: new Prisma.Decimal(1),
  };
}

export async function notDraft(id: string): Promise<never> {
  const cur = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true, noteNo: true } });
  if (!cur) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  throw AppError.conflict(`${cur.noteNo} taslak değil (${cur.status}); yalnız taslak düzenlenir/silinir. Onaylı belge ancak İPTAL edilir.`, { code: "DELIVERY_NOTE_NOT_DRAFT", status: cur.status });
}

// ── Satır yazma — her yol önce başlığı DRAFT olarak claim eder (satır kilidi = başlık satırı) ──
async function claimDraft(tx: Prisma.TransactionClient, noteId: string, userId: string): Promise<void> {
  const c = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedById: userId } });
  if (c.count === 0) await notDraft(noteId);
}

/**
 * Toplu satır ekleme replay'i (K′): başlık satırı `claimDraft` ile kilitlendikten SONRA aynı token'ın satırları okunur —
 * eşzamanlı ikinci deneme kilitte bekler, kazananın partisini bulur ve onu döner (satırlar ikilenmez).
 */
function lineBatchReplay(noteId: string) {
  type Prior = Array<{ id: string; noteId: string; lineNo: number }>;
  return tokenReplay<Prior, Prior>({
    find: async (db, clientToken) => {
      const rows = await db.customerDeliveryNoteLine.findMany({ where: { clientToken }, select: { id: true, noteId: true, lineNo: true }, orderBy: { lineNo: "asc" } });
      return rows.length ? rows : null;
    },
    alive: { neverDies: "taslak satırı; silinmişse parti yoktur ve yeniden yazılır (silme ④ sınıfı, defter değil)" },
    identity: (p) => [{ ad: "noteId", mevcut: p[0]!.noteId, gelen: noteId }],
    collision: "Bu işlem kimliği başka bir taslağın satır partisine ait; satırları yeniden gönderin.",
    respond: (p) => p,
  });
}

export async function addDeliveryNoteLines(noteId: string, inputs: DeliveryNoteLineInput[], userId: string, clientToken?: string | null) {
  if (inputs.length === 0) throw AppError.badRequest("En az bir satır gerekli.", { code: "DELIVERY_NOTE_LINES_EMPTY" });
  const cols = inputs.map(lineColumns);
  const replay = lineBatchReplay(noteId);
  const result = await prisma.$transaction(async (tx) => {
    await claimDraft(tx, noteId, userId);
    const prior = clientToken ? await replay.behindLock(tx, clientToken) : null;
    if (prior) return { ids: prior.map((r) => r.id), replayed: true as const };
    const last = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId }, _max: { lineNo: true } });
    let lineNo = last._max.lineNo ?? 0;
    const rows = [];
    for (const c of cols) {
      lineNo += 1;
      rows.push(await tx.customerDeliveryNoteLine.create({ data: { ...c, noteId, lineNo, clientToken: clientToken ?? null }, select: LINE_SELECT }));
    }
    return { rows, replayed: false as const };
  });
  if (result.replayed) {
    return prisma.customerDeliveryNoteLine.findMany({ where: { id: { in: result.ids } }, select: LINE_SELECT, orderBy: { lineNo: "asc" } });
  }
  const created = result.rows;
  await AuditService.logMany(created.map((l) => ({ userId, action: "CREATE" as const, tableName: LINE_TABLE, recordId: l.id, newData: { noteId, ...auditLine(l) } })));
  return created;
}

export async function updateDeliveryNoteLine(noteId: string, lineId: string, patch: Partial<DeliveryNoteLineInput> & { skip?: true }, userId: string) {
  const before = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: lineId }, select: LINE_SELECT });
  if (!before || before.noteId !== noteId) throw AppError.notFound("Satır bulunamadı.", { code: "DELIVERY_NOTE_LINE_NOT_FOUND" });
  // Yalnız patch'te TANIMLI anahtarlar yazılır: iki yazar farklı alanı düzeltirse ikisi de korunur (kayıp güncelleme yok).
  // `meters` yalnız gelirse sınanır; `lineColumns` tam küme kurar, tanımsızlar aşağıda elenir.
  const full = lineColumns({ ...patch, meters: patch.meters ?? Number(before.meters) });
  const { confidence: _c, ...allCols } = full;
  const cols = Object.fromEntries(Object.entries(allCols).filter(([k]) => patch[k as keyof DeliveryNoteLineInput] !== undefined)) as Partial<typeof allCols>;
  // Gözden geçirme işareti yalnız değer (metre/kg) düzeltilince düşer; kumaş/renk/en eşlemesi el yazısı hücresini görmüş sayılmaz.
  const review = patch.needsReview ?? (patch.meters !== undefined || patch.weightKg !== undefined ? false : undefined);
  const reviewData = review === undefined ? {} : { needsReview: review };
  let closedNoteNo: string | null = null;
  const after = await prisma.$transaction(async (tx) => {
    // PARTIAL yolu yalnız topsuz FAILED satır için açılır; başlık claim'i (updatedAt'i tazeler) eşzamanlı onayı 409'a düşürür.
    const partial = before.status === "FAILED" && before.rollId == null
      ? (await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "PARTIAL" }, data: { updatedById: userId } })).count === 1
      : false;
    if (!partial) {
      await claimDraft(tx, noteId, userId);
      if (patch.skip) throw AppError.badRequest("Taslakta satır atlanmaz; girilmeyecek satırı silin.", { code: "DELIVERY_NOTE_LINE_SKIP_DRAFT" });
      return tx.customerDeliveryNoteLine.update({ where: { id: lineId }, data: { ...cols, ...reviewData }, select: LINE_SELECT });
    }
    const c = await tx.customerDeliveryNoteLine.updateMany({
      where: { id: lineId, noteId, status: "FAILED", rollId: null },
      data: { ...cols, ...reviewData, ...(patch.skip ? { status: "SKIPPED" as const } : {}) },
    });
    if (c.count === 0) throw AppError.conflict("Satır artık düzeltilemez (girilmiş ya da değişmiş); belgeyi yenileyin.", { code: "DELIVERY_NOTE_LINE_NOT_EDITABLE" });
    // Atlamayla topsuz canlı satır kalmadıysa belge kapanır (yeniden onaya "açık satır yok" ile takılmasın).
    if (patch.skip && (await tx.customerDeliveryNoteLine.count({ where: { noteId, rollId: null, status: { not: "SKIPPED" } } })) === 0) {
      const closed = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "PARTIAL" }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: userId, updatedById: userId } });
      if (closed.count === 1) closedNoteNo = (await tx.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { noteNo: true } }))?.noteNo ?? noteId;
    }
    return tx.customerDeliveryNoteLine.findUniqueOrThrow({ where: { id: lineId }, select: LINE_SELECT });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: LINE_TABLE, recordId: lineId, oldData: auditLine(before), newData: auditLine(after) });
  if (closedNoteNo) await AuditService.log({ userId, action: "UPDATE", tableName: "CUSTOMER_DELIVERY_NOTE", recordId: noteId, oldData: { status: "PARTIAL" }, newData: { status: "APPROVED", noteNo: closedNoteNo } });
  return after;
}

export async function deleteDeliveryNoteLine(noteId: string, lineId: string, userId: string): Promise<{ id: string }> {
  const before = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: lineId }, select: LINE_SELECT });
  if (!before || before.noteId !== noteId) throw AppError.notFound("Satır bulunamadı.", { code: "DELIVERY_NOTE_LINE_NOT_FOUND" });
  await prisma.$transaction(async (tx) => {
    await claimDraft(tx, noteId, userId);
    await tx.customerDeliveryNoteLine.deleteMany({ where: { id: lineId, noteId } });
  });
  void AuditService.log({ userId, action: "DELETE", tableName: LINE_TABLE, recordId: lineId, oldData: auditLine(before) });
  return { id: lineId };
}
