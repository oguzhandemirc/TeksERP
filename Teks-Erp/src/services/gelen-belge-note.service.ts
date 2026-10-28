// =============================================================================
// GELEN BELGE — irsaliye/çeki listesi TASLAĞI (D2): başlık + satır CRUD, liste + cursor + özet
// =============================================================================
// Taslak DEFTER DEĞİLDİR: deftere yazan tek olay onaydaki depo ENTRY'sidir (D4, `createInitialEntry`).
// Bu dosya yalnız DRAFT'ı yazar; her yazma `updateMany WHERE {id, status: DRAFT}` ATOMİK CLAIM'inden
// geçer (count 0 → 409), `findUnique → if → update` yolu YOKTUR. Silme ④ sınıfıdır (deftere hiç
// yazmamış taslak; `docs/kurallar/defter.md` § Hard delete): `deleteMany({id, status: DRAFT})`.
// `noteNo` DOĞUŞTA `GB` serisinden materyalize edilir (`numaralandirma.md`); replay dört durumlu
// `tokenReplay` boğazından. Liste + cursor + özet şeridi TEK where'den türer (`filtre-liste.md`).
// =============================================================================
import { DeliveryNoteSourceKind, DeliveryNoteStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { p2002Mentions } from "../utils/p2002";
import { decodeOffsetCursor, encodeOffsetCursor } from "../utils/cursor";
import { readIdCondition } from "../utils/query-parser";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { nextSeriesNo } from "./number-series.service";
import { SCAN_SELECT } from "./gelen-belge-scan.service";
import { LINE_SELECT, lineColumns, notDraft, text, type DeliveryNoteLineInput } from "./gelen-belge-line.service";

const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const SERIES_KEY = "customerDeliveryNote";

export { addDeliveryNoteLines, deleteDeliveryNoteLine, updateDeliveryNoteLine, type DeliveryNoteLineInput } from "./gelen-belge-line.service";
export const DELIVERY_NOTE_STATUSES = ["DRAFT", "APPROVING", "APPROVED", "PARTIAL", "CANCELLED"] as const;

// ── Girdi tipleri (route Zod'u bunlara daraltır) ────────────────────────────
export interface DeliveryNoteHeaderInput {
  ownerCustomerId?: string | null;
  senderCustomerId?: string | null;
  senderText?: string | null;
  senderDocNo?: string | null;
  /** YYYY-AA-GG — takvim günü. */
  senderDocDate?: string | null;
  customerBatchNo?: string | null;
  processText?: string | null;
  pageCount?: number | null;
  declaredTopCount?: number | null;
  totalsDeclared?: Record<string, unknown> | null;
}
export interface DeliveryNoteCreateInput extends DeliveryNoteHeaderInput {
  clientToken?: string | null;
  sourceKind: Exclude<DeliveryNoteSourceKind, "OCR">;
  /** Önceden yüklenmiş, sahipsiz taramalar (sha256 ile doğmuş) taslağa bağlanır. */
  scanIds?: string[];
  lines?: DeliveryNoteLineInput[];
}
export interface DeliveryNoteListQuery {
  status?: (typeof DELIVERY_NOTE_STATUSES)[number];
  sourceKind?: DeliveryNoteSourceKind;
  ownerCustomerId?: string | string[];
  senderCustomerId?: string | string[];
  q?: string;
  cursor?: string;
  limit?: number;
}

// ── Seçimler ────────────────────────────────────────────────────────────────
const HEADER_SELECT = {
  id: true, noteNo: true, status: true, sourceKind: true, ownerCustomerId: true, senderCustomerId: true, senderText: true,
  senderDocNo: true, senderDocDate: true, customerBatchNo: true, processText: true, templateId: true, templateScore: true,
  pageCount: true, declaredTopCount: true, totalsDeclared: true, varianceReason: true, warnings: true, approvedAt: true,
  approvedById: true, cancelledAt: true, cancelledById: true, cancelReason: true, clientToken: true, createdAt: true,
  updatedAt: true, createdById: true, updatedById: true,
  ownerCustomer: { select: { id: true, code: true, name: true } },
  senderCustomer: { select: { id: true, code: true, name: true } },
  _count: { select: { lines: true, scans: true } },
} as const;
const DETAIL_SELECT = {
  ...HEADER_SELECT,
  lines: { select: LINE_SELECT, orderBy: [{ blockNo: "asc" }, { lineNo: "asc" }] },
  scans: { select: SCAN_SELECT, orderBy: [{ pageNo: "asc" }, { regionNo: "asc" }] },
} satisfies Prisma.CustomerDeliveryNoteSelect;

/** Audit yükü: yalnız başlık künyesi (JSON beyan/uyarı alanları hariç; fotoğraf/OCR zaten burada yok). */
function auditHeader(n: { noteNo: string; status: string; sourceKind: string; ownerCustomerId: string | null; senderCustomerId: string | null; senderText: string | null; senderDocNo: string | null; senderDocDate: Date | null; customerBatchNo: string | null; processText: string | null; pageCount: number | null; declaredTopCount: number | null }) {
  return {
    noteNo: n.noteNo, status: n.status, sourceKind: n.sourceKind, ownerCustomerId: n.ownerCustomerId, senderCustomerId: n.senderCustomerId,
    senderText: n.senderText, senderDocNo: n.senderDocNo, senderDocDate: n.senderDocDate ? n.senderDocDate.toISOString().slice(0, 10) : null,
    customerBatchNo: n.customerBatchNo, processText: n.processText, pageCount: n.pageCount, declaredTopCount: n.declaredTopCount,
  };
}
function parseDay(v: string | null | undefined): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw AppError.badRequest("Belge tarihi geçersiz (YYYY-AA-GG).", { code: "DELIVERY_NOTE_DATE_INVALID" });
  }
  return d;
}

async function headerColumns(input: DeliveryNoteHeaderInput) {
  if (input.ownerCustomerId) {
    const c = await prisma.customer.findUnique({ where: { id: input.ownerCustomerId }, select: { id: true, isActive: true } });
    if (!c) throw AppError.badRequest("Sahip cari bulunamadı.", { code: "DELIVERY_NOTE_OWNER_NOT_FOUND" });
    if (!c.isActive) throw AppError.badRequest("Sahip cari pasif; taslağa bağlanamaz.", { code: "DELIVERY_NOTE_OWNER_INACTIVE" });
  }
  if (input.senderCustomerId) {
    const c = await prisma.customer.findUnique({ where: { id: input.senderCustomerId }, select: { id: true } });
    if (!c) throw AppError.badRequest("Gönderen cari bulunamadı.", { code: "DELIVERY_NOTE_SENDER_NOT_FOUND" });
  }
  return {
    ownerCustomerId: input.ownerCustomerId ?? null,
    senderCustomerId: input.senderCustomerId ?? null,
    senderText: text(input.senderText),
    senderDocNo: text(input.senderDocNo),
    senderDocDate: parseDay(input.senderDocDate),
    customerBatchNo: text(input.customerBatchNo),
    processText: text(input.processText),
    pageCount: input.pageCount ?? null,
    declaredTopCount: input.declaredTopCount ?? null,
    totalsDeclared: input.totalsDeclared === undefined ? undefined : input.totalsDeclared === null ? Prisma.JsonNull : (input.totalsDeclared as Prisma.InputJsonObject),
  };
}

/** Mükerrer gönderen belge numarası (partial unique) → operatöre anlamlı 409. */
function translateUnique(err: unknown): never {
  // Hedef okuma TEK yardımcıdan (pg adaptörü `meta.target` vermez — `p2002.ts` başlığı).
  if (p2002Mentions(err, /owner_sender_doc|senderDocNo/)) {
    throw AppError.conflict("Bu sahip için aynı gönderen belge numarasıyla açık bir taslak/belge zaten var.", { code: "DELIVERY_NOTE_DUPLICATE_DOC_NO" });
  }
  throw err;
}

// ── Okuma ───────────────────────────────────────────────────────────────────
export async function getDeliveryNote(id: string) {
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!note) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  return note;
}

/** Liste where'i — özet şeridi de BUNDAN türer (durum süzgeci hariç; şerit duruma göre sayar). */
export function buildDeliveryNoteBaseWhere(q: DeliveryNoteListQuery): Prisma.CustomerDeliveryNoteWhereInput {
  const where: Prisma.CustomerDeliveryNoteWhereInput = {};
  const owner = readIdCondition(q.ownerCustomerId);
  if (owner) where.ownerCustomerId = owner;
  const sender = readIdCondition(q.senderCustomerId);
  if (sender) where.senderCustomerId = sender;
  if (q.sourceKind) where.sourceKind = q.sourceKind;
  const term = q.q?.trim();
  if (term) {
    where.OR = [
      { noteNo: { contains: term, mode: "insensitive" } },
      { senderDocNo: { contains: term, mode: "insensitive" } },
      { senderText: { contains: term, mode: "insensitive" } },
      { customerBatchNo: { contains: term, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listDeliveryNotes(q: DeliveryNoteListQuery) {
  if (q.status && !DELIVERY_NOTE_STATUSES.includes(q.status)) {
    throw AppError.badRequest("Tanınmayan durum süzgeci.", { code: "DELIVERY_NOTE_FILTER_INVALID" });
  }
  const base = buildDeliveryNoteBaseWhere(q);
  const where: Prisma.CustomerDeliveryNoteWhereInput = q.status ? { AND: [base, { status: q.status }] } : base;
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = decodeOffsetCursor(q.cursor);
  const rows = await prisma.customerDeliveryNote.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: offset, take: limit + 1, select: HEADER_SELECT,
  });
  const page = rows.slice(0, limit);
  const grouped = await prisma.customerDeliveryNote.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const summary = Object.fromEntries(DELIVERY_NOTE_STATUSES.map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0])) as Record<(typeof DELIVERY_NOTE_STATUSES)[number], number>;
  return {
    items: page,
    nextCursor: rows.length > limit ? encodeOffsetCursor(offset + limit) : null,
    summary: { ...summary, total: Object.values(summary).reduce((a, b) => a + b, 0) },
  };
}

// ── Başlık yazma ────────────────────────────────────────────────────────────
type Prior = { id: string; noteNo: string; status: DeliveryNoteStatus; senderDocNo: string | null; ownerCustomerId: string | null };
const PRIOR_SELECT = { id: true, noteNo: true, status: true, senderDocNo: true, ownerCustomerId: true } as const;

function replayFor(input: DeliveryNoteCreateInput) {
  return tokenReplay<Prior, Awaited<ReturnType<typeof getDeliveryNote>>>({
    find: (db, clientToken) => db.customerDeliveryNote.findUnique({ where: { clientToken }, select: PRIOR_SELECT }),
    alive: (p) => {
      if (p.status === "CANCELLED") throw AppError.conflict(`${p.noteNo} iptal edilmiş; yeni taslak açın.`, { code: "DELIVERY_NOTE_CANCELLED" });
    },
    identity: (p) => [
      { ad: "senderDocNo", mevcut: p.senderDocNo, gelen: text(input.senderDocNo) },
      { ad: "ownerCustomerId", mevcut: p.ownerCustomerId, gelen: input.ownerCustomerId ?? null },
    ],
    collision: "Bu işlem kimliği başka bir taslağa ait; formu yeniden gönderin.",
    respond: (p) => getDeliveryNote(p.id),
  });
}

async function nextNoteNo(): Promise<string> {
  return nextSeriesNo(SERIES_KEY, async (prefix) =>
    prisma.customerDeliveryNote.findMany({
      where: { noteNo: { gte: prefix, startsWith: prefix } },
      select: { noteNo: true, createdAt: true },
    }).then((rows) => rows.map((r) => ({ code: r.noteNo, createdAt: r.createdAt }))), new Date());
}

export async function createDeliveryNote(input: DeliveryNoteCreateInput, userId: string) {
  return replayFor(input).run(input.clientToken, async () => {
    const header = await headerColumns(input);
    const lines = (input.lines ?? []).map((l, i) => ({ ...lineColumns(l), lineNo: i + 1 }));
    const scanIds = [...new Set(input.scanIds ?? [])];
    if (scanIds.length) {
      const free = await prisma.documentScan.count({ where: { id: { in: scanIds }, noteId: null } });
      if (free !== scanIds.length) {
        throw AppError.conflict("Taramalardan biri bulunamadı ya da başka bir taslağa bağlı.", { code: "DOCUMENT_SCAN_NOT_FREE" });
      }
    }
    // Numara doğuşta; sayaç türetilmiş → P2002 yarışında yeniden dene (reçete § Yeni numara serisi).
    const created = await withBarcodeRetry(async () => {
      const noteNo = await nextNoteNo();
      return prisma.$transaction(async (tx) => {
        const row = await tx.customerDeliveryNote.create({
          data: {
            ...header, noteNo, sourceKind: input.sourceKind, clientToken: input.clientToken ?? null,
            createdById: userId, updatedById: userId,
            lines: lines.length ? { create: lines } : undefined,
          },
          select: { ...PRIOR_SELECT, sourceKind: true, senderText: true, senderDocDate: true, customerBatchNo: true, processText: true, pageCount: true, declaredTopCount: true, senderCustomerId: true },
        });
        if (scanIds.length) {
          const bound = await tx.documentScan.updateMany({ where: { id: { in: scanIds }, noteId: null }, data: { noteId: row.id } });
          if (bound.count !== scanIds.length) {
            throw AppError.conflict("Taramalardan biri bu arada başka bir taslağa bağlandı.", { code: "DOCUMENT_SCAN_NOT_FREE" });
          }
        }
        return row;
      });
    }, undefined, (err) => p2002TargetsCode(err, "noteNo"), "Gelen belge numarası").catch(translateUnique);
    await AuditService.log({ userId, action: "CREATE", tableName: NOTE_TABLE, recordId: created.id, newData: { ...auditHeader(created), lineCount: lines.length, scanCount: scanIds.length } });
    return getDeliveryNote(created.id);
  });
}

/** Başlık düzeltme — yalnız DRAFT; atomik claim (count 0 → 404/409). */
export async function updateDeliveryNote(id: string, patch: DeliveryNoteHeaderInput, userId: string) {
  const before = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { ...PRIOR_SELECT, sourceKind: true, senderText: true, senderDocDate: true, customerBatchNo: true, processText: true, pageCount: true, declaredTopCount: true, senderCustomerId: true } });
  if (!before) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const cols = await headerColumns({ ...stripUndefined(before), ...patch });
  const res = await prisma.customerDeliveryNote.updateMany({ where: { id, status: "DRAFT" }, data: { ...cols, updatedById: userId } }).catch(translateUnique);
  if (res.count === 0) await notDraft(id);
  const after = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id }, select: { ...PRIOR_SELECT, sourceKind: true, senderText: true, senderDocDate: true, customerBatchNo: true, processText: true, pageCount: true, declaredTopCount: true, senderCustomerId: true } });
  await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: id, oldData: auditHeader(before), newData: auditHeader(after) });
  return getDeliveryNote(id);
}

/** Mevcut satırı patch tabanına çevirir (tarih kolonunu YYYY-AA-GG metnine). */
function stripUndefined(row: { ownerCustomerId: string | null; senderCustomerId: string | null; senderText: string | null; senderDocNo: string | null; senderDocDate: Date | null; customerBatchNo: string | null; processText: string | null; pageCount: number | null; declaredTopCount: number | null }): DeliveryNoteHeaderInput {
  return {
    ownerCustomerId: row.ownerCustomerId, senderCustomerId: row.senderCustomerId, senderText: row.senderText, senderDocNo: row.senderDocNo,
    senderDocDate: row.senderDocDate ? row.senderDocDate.toISOString().slice(0, 10) : null, customerBatchNo: row.customerBatchNo,
    processText: row.processText, pageCount: row.pageCount, declaredTopCount: row.declaredTopCount,
  };
}

/** Claim kaybedildi: taze okumayla 404 ya da 409 (hangi durumda olduğunu söyler). */
/**
 * ④ Deftere hiç yazmamış taslak — fiziksel silme (`docs/kurallar/defter.md` § Hard delete).
 * Taramalar silinmez, taslaktan ÇÖZÜLÜR (fotoğraf izi kalır, yeniden kullanılabilir); satırlar Cascade.
 */
export async function deleteDeliveryNote(id: string, userId: string): Promise<{ id: string; noteNo: string }> {
  const before = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { ...PRIOR_SELECT, sourceKind: true, senderText: true, senderDocDate: true, customerBatchNo: true, processText: true, pageCount: true, declaredTopCount: true, senderCustomerId: true } });
  if (!before) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  if (before.status !== "DRAFT") await notDraft(id);
  await prisma.$transaction(async (tx) => {
    // Çözme önce (FK Restrict); claim kaybedilirse tx geri sarar, taramalar bağlı kalır.
    await tx.documentScan.updateMany({ where: { noteId: id }, data: { noteId: null } });
    const gone = await tx.customerDeliveryNote.deleteMany({ where: { id, status: "DRAFT" } });
    if (gone.count === 0) await notDraft(id);
  });
  void AuditService.log({ userId, action: "DELETE", tableName: NOTE_TABLE, recordId: id, oldData: auditHeader(before) });
  return { id, noteNo: before.noteNo };
}

