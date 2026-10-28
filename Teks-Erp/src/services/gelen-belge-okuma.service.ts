// =============================================================================
// Gelen belge OKUMA (D3b): tarama claim → sidecar → motor → DRAFT taslak
// =============================================================================
// DEFTER-ÖNCELİKLİ: burada top DOĞMAZ, OCR deftere yazmaz; yalnız DocumentScan durumu ve DRAFT taslak.
// Claim atomik: `updateMany WHERE {id, status: PENDING}` (READING'de takılı kalan 10 dk sonra yeniden alınır);
// 3 denemede READ_FAILED. Audit yükü: künye (noteNo, satır sayısı, motor adı) — ham OCR metni / bayt GİRMEZ.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { bilgi, uyari } from "../lib/logger";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { extractDocument, loadTemplates } from "../lib/gelen-belge/motor";
import { clip, draftFromExtraction, type DraftLine } from "../lib/gelen-belge/taslak";
import { readerOcr, type ReaderResult } from "../lib/gelen-belge/okuma-istemcisi";
import { AuditService } from "./audit.service";
import { nextNoteNo, translateUnique } from "./gelen-belge-note.service";

export const READ_MAX_ATTEMPTS = 3;
/** READING'de bu kadar kalan tarama (süreç düşmüş) yeniden PENDING sayılır. */
export const READING_STALE_MS = 10 * 60 * 1000;
const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const SCAN_TABLE = "DOCUMENT_SCAN";

// ── Claim ────────────────────────────────────────────────────────────────────

export type ClaimOutcome = { kind: "NONE" } | { kind: "RACED" } | { kind: "CLAIMED"; id: string };

/** En eski PENDING (ya da bayat READING) taramayı atomik alır; yarışta kaybeden RACED döner (çağıran yeniden dener). */
export async function claimNextScan(now: Date = new Date(), skipIds: readonly string[] = []): Promise<ClaimOutcome> {
  const stale = new Date(now.getTime() - READING_STALE_MS);
  const cand = await prisma.documentScan.findFirst({
    // Aynı turda denenmiş tarama yeniden alınmaz (`skipIds`): 5xx'te üç deneme üç AYRI tura yayılır. (`notIn: []` yasak → koşullu.)
    where: { OR: [{ status: "PENDING" }, { status: "READING", updatedAt: { lt: stale } }], ...(skipIds.length ? { id: { notIn: [...skipIds] } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, updatedAt: true },
  });
  if (!cand) return { kind: "NONE" };
  const c = await prisma.documentScan.updateMany({
    where: { id: cand.id, status: cand.status, updatedAt: cand.updatedAt },
    data: { status: "READING", attempts: { increment: 1 } },
  });
  return c.count === 1 ? { kind: "CLAIMED", id: cand.id } : { kind: "RACED" };
}

// ── Okuma + taslak yazımı ────────────────────────────────────────────────────

export type ProcessOutcome = "READ" | "RETRY" | "READ_FAILED" | "LOST";

async function release(id: string, attempts: number, code: string): Promise<ProcessOutcome> {
  const failed = attempts >= READ_MAX_ATTEMPTS;
  const c = await prisma.documentScan.updateMany({ where: { id, status: "READING" }, data: { status: failed ? "READ_FAILED" : "PENDING" } });
  if (c.count === 0) return "LOST";
  (failed ? uyari : bilgi)("gelen-belge", `tarama okunamadı (${code}) — deneme ${attempts}/${READ_MAX_ATTEMPTS}${failed ? ", READ_FAILED" : ", yeniden denenecek"}`);
  return failed ? "READ_FAILED" : "RETRY";
}

function lineRows(lines: DraftLine[]) {
  return lines.map((l, i) => ({
    lineNo: i + 1,
    blockNo: l.blockNo,
    lineKind: l.lineKind,
    senderRollNo: l.senderRollNo,
    meters: new Prisma.Decimal(l.meters),
    weightKg: l.weightKg ? new Prisma.Decimal(l.weightKg) : null,
    widthCm: l.widthCm ? new Prisma.Decimal(l.widthCm) : null,
    itemText: l.itemText,
    colorText: l.colorText,
    confidence: new Prisma.Decimal(l.confidence.toFixed(4)),
    needsReview: l.needsReview,
    sourceRects: l.sourceRects as unknown as Prisma.InputJsonObject,
    ocrRaw: l.ocrRaw as unknown as Prisma.InputJsonObject,
  }));
}

/**
 * READING'deki taramayı sidecar'a okutur, motorla çıkarır, DRAFT'a yazar. Tarama bir taslağa bağlıysa
 * yalnız BOŞ alanlar dolar ve satırsız taslağa satırlar eklenir (operatörün yazdığı ezilmez); bağlı değilse yeni taslak.
 */
export async function processClaimedScan(id: string, readerUrl: string, ocr: typeof readerOcr = readerOcr): Promise<ProcessOutcome> {
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: { id: true, status: true, attempts: true, noteId: true, mimeType: true, content: true, capturedById: true, sha256: true } });
  if (!scan || scan.status !== "READING") return "LOST";
  let r: ReaderResult;
  try {
    r = await ocr(readerUrl, Buffer.from(scan.content), scan.mimeType);
  } catch (err) {
    return release(id, scan.attempts, `PROGRAM_HATASI:${(err as Error).name}`);
  }
  if (!r.ok) return release(id, scan.attempts, r.code);
  const doc = extractDocument(r.result, loadTemplates());
  const draft = draftFromExtraction(doc);
  const envelope = { ocr: r.result, regions: draft.header.regions } as unknown as Prisma.InputJsonObject;
  const scanData = { status: "READ" as const, ocrResult: envelope, ocrEngine: clip(r.engine, 32), ocrVersion: clip(r.version, 32), ocrDurationMs: r.durationMs };
  const userId = scan.capturedById ?? undefined;
  const { header } = draft;
  const headerCols = {
    ownerText: header.ownerText, senderDocNo: header.senderDocNo, senderDocDate: header.senderDocDate, customerBatchNo: header.customerBatchNo,
    processText: header.processText, declaredTopCount: header.declaredTopCount, templateScore: header.templateScore === null ? null : new Prisma.Decimal(header.templateScore),
  };
  const totalsDeclared = header.totalsDeclared as unknown as Prisma.InputJsonObject;
  const warnings = header.warnings as unknown as Prisma.InputJsonArray;

  if (scan.noteId) {
    const noteId = scan.noteId;
    const res = await prisma.$transaction(async (tx) => {
      const claimed = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedAt: new Date() } });
      if (claimed.count === 0) return { noteId, lines: 0, filled: false };
      const note = await tx.customerDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { ownerText: true, senderDocNo: true, senderDocDate: true, customerBatchNo: true, processText: true, declaredTopCount: true, totalsDeclared: true, _count: { select: { lines: true } } } });
      const patch: Prisma.CustomerDeliveryNoteUpdateInput = { warnings };
      if (!note.ownerText) patch.ownerText = headerCols.ownerText;
      if (!note.senderDocNo) patch.senderDocNo = headerCols.senderDocNo;
      if (!note.senderDocDate) patch.senderDocDate = headerCols.senderDocDate;
      if (!note.customerBatchNo) patch.customerBatchNo = headerCols.customerBatchNo;
      if (!note.processText) patch.processText = headerCols.processText;
      if (note.declaredTopCount === null) patch.declaredTopCount = headerCols.declaredTopCount;
      if (note.totalsDeclared === null) patch.totalsDeclared = totalsDeclared;
      patch.templateScore = headerCols.templateScore;
      const addLines = note._count.lines === 0 && draft.lines.length > 0;
      if (addLines) patch.lines = { create: lineRows(draft.lines) };
      await tx.customerDeliveryNote.update({ where: { id: noteId }, data: patch });
      const s = await tx.documentScan.updateMany({ where: { id, status: "READING" }, data: scanData });
      if (s.count === 0) throw new Error("SCAN_LOST");
      return { noteId, lines: addLines ? draft.lines.length : 0, filled: true };
    }).catch((err) => (err instanceof Error && err.message === "SCAN_LOST" ? null : Promise.reject(err)));
    if (!res) return "LOST";
    await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: noteId, newData: { source: "OCR", scanId: id, sha256: scan.sha256, lineCount: res.lines, filled: res.filled, engine: scanData.ocrEngine, warnings: header.warnings.length } });
    return "READ";
  }

  const created = await withBarcodeRetry(async () => {
    const noteNo = await nextNoteNo();
    return prisma.$transaction(async (tx) => {
      const row = await tx.customerDeliveryNote.create({
        data: { ...headerCols, noteNo, sourceKind: "OCR", status: "DRAFT", totalsDeclared, warnings, createdById: scan.capturedById, updatedById: scan.capturedById, lines: draft.lines.length ? { create: lineRows(draft.lines) } : undefined },
        select: { id: true, noteNo: true },
      });
      const s = await tx.documentScan.updateMany({ where: { id, status: "READING", noteId: null }, data: { ...scanData, noteId: row.id } });
      if (s.count === 0) throw new Error("SCAN_LOST");
      return row;
    });
  }, undefined, (err) => p2002TargetsCode(err, "noteNo"), "Gelen belge numarası")
    .catch((err) => (err instanceof Error && err.message === "SCAN_LOST" ? null : translateUnique(err)));
  if (!created) return "LOST";
  await AuditService.log({ userId, action: "CREATE", tableName: NOTE_TABLE, recordId: created.id, newData: { noteNo: created.noteNo, status: "DRAFT", sourceKind: "OCR", scanId: id, sha256: scan.sha256, lineCount: draft.lines.length, blockCount: header.totalsDeclared.blocks.length, engine: scanData.ocrEngine, warnings: header.warnings.length } });
  await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData: { status: "READ", noteId: created.id, engine: scanData.ocrEngine, durationMs: r.durationMs } });
  return "READ";
}

/** Okuma durum özeti (durum ucu): kuyruk sayıları. */
export async function readerQueueCounts(): Promise<{ pending: number; reading: number; failed: number }> {
  const rows = await prisma.documentScan.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { in: ["PENDING", "READING", "READ_FAILED"] } } });
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { pending: n("PENDING"), reading: n("READING"), failed: n("READ_FAILED") };
}

/** Okut ucu: READ_FAILED → PENDING (deneme sayacı sıfır; atomik claim); PENDING/READING ise dokunmaz; READ ise 409. */
export async function requeueScanForReading(id: string, userId: string) {
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: { id: true, status: true, noteId: true } });
  if (!scan) throw AppError.notFound("Tarama bulunamadı.", { code: "DOCUMENT_SCAN_NOT_FOUND" });
  if (scan.status === "READ") throw AppError.conflict("Tarama zaten okunmuş; taslağı düzenleyin.", { code: "DOCUMENT_SCAN_ALREADY_READ" });
  if (scan.status === "READ_FAILED") {
    const c = await prisma.documentScan.updateMany({ where: { id, status: "READ_FAILED" }, data: { status: "PENDING", attempts: 0 } });
    if (c.count === 0) throw AppError.conflict("Tarama bu arada başka durumda; yenileyin.", { code: "DOCUMENT_SCAN_STATE_CHANGED" });
    await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READ_FAILED" }, newData: { status: "PENDING", attempts: 0 } });
  }
  return prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, attempts: true, noteId: true } });
}
