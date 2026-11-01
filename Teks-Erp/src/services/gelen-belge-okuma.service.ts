// =============================================================================
// Gelen belge OKUMA (D3b): tarama claim → sidecar → motor → DRAFT taslak
// =============================================================================
// DEFTER-ÖNCELİKLİ: burada top DOĞMAZ, OCR deftere yazmaz; yalnız DocumentScan durumu ve DRAFT taslak.
// Claim atomik: `updateMany WHERE {id, status: PENDING}` (READING'de takılı kalan 10 dk sonra yeniden alınır);
// 3 denemede (4xx / şema dışı gövdede hemen) READ_FAILED. Audit yükü: künye (noteNo, satır sayısı, motor adı) — ham OCR metni / bayt GİRMEZ.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { bilgi, uyari } from "../lib/logger";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { extractDocument, loadTemplates } from "../lib/gelen-belge/motor";
import { clip, draftFromExtraction, dropOverlapDuplicates, linesToPhotoFrame, type DraftLine } from "../lib/gelen-belge/taslak";
import { readerOcr, type ReaderResult } from "../lib/gelen-belge/okuma-istemcisi";
import { AuditService } from "./audit.service";
import { nextNoteNo, translateUnique } from "./gelen-belge-note.service";
import { FALLBACK_TEMPLATE_CODE, bumpTemplateHit, ensureSenderTemplate } from "./gelen-belge-sablon.service";
import { PDF_MIME } from "./gelen-belge-scan.service";

export const READ_MAX_ATTEMPTS = 3;
/** READING'de bu kadar kalan tarama (süreç düşmüş) yeniden PENDING sayılır. */
export const READING_STALE_MS = 10 * 60 * 1000;
const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
/** Düz nesneyi Prisma Json girdisine çevirir (tip zorlaması yok: JSON gidiş-dönüş; rect/raw/uyarı zaten düz veridir). */
function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v));
}
const SCAN_TABLE = "DOCUMENT_SCAN";

// ── Claim ────────────────────────────────────────────────────────────────────

export type ClaimOutcome = { kind: "NONE" } | { kind: "RACED" } | { kind: "CLAIMED"; id: string };

/** En eski PENDING (ya da bayat READING) taramayı atomik alır; yarışta kaybeden RACED döner (çağıran yeniden dener). */
export async function claimNextScan(now: Date = new Date(), skipIds: readonly string[] = []): Promise<ClaimOutcome> {
  const stale = new Date(now.getTime() - READING_STALE_MS);
  const cand = await prisma.documentScan.findFirst({
    // Aynı turda denenmiş tarama yeniden alınmaz (`skipIds`): 5xx'te üç deneme üç AYRI tura yayılır. (`notIn: []` yasak → koşullu.)
    // K6: PDF ASLA claim edilmez (yükleme READ_FAILED doğurur; D2 döneminden PENDING kalmış PDF'e karşı savunma).
    where: { OR: [{ status: "PENDING" }, { status: "READING", updatedAt: { lt: stale } }], mimeType: { not: PDF_MIME }, ...(skipIds.length ? { id: { notIn: [...skipIds] } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, updatedAt: true },
  });
  if (!cand) return { kind: "NONE" };
  const c = await prisma.documentScan.updateMany({
    where: { id: cand.id, status: cand.status, updatedAt: cand.updatedAt, mimeType: { not: PDF_MIME } },
    data: { status: "READING", attempts: { increment: 1 } },
  });
  return c.count === 1 ? { kind: "CLAIMED", id: cand.id } : { kind: "RACED" };
}

// ── Okuma + taslak yazımı ────────────────────────────────────────────────────

export type ProcessOutcome = "READ" | "RETRY" | "READ_FAILED" | "LOST";

/**
 * READING'i bırakır. `attempts` sahiplik damgasıdır: bayat sayılıp başka turda yeniden alınmış taramayı eski tur geri çekemez.
 * `permanent` (4xx / şema dışı gövde) yeniden denemeye değmez → doğrudan READ_FAILED; READ_FAILED geçişi audit'e düşer.
 */
async function release(id: string, attempts: number, code: string, opts: { permanent?: boolean; userId?: string } = {}): Promise<ProcessOutcome> {
  const { permanent = false, userId } = opts;
  const failed = permanent || attempts >= READ_MAX_ATTEMPTS;
  const c = await prisma.documentScan.updateMany({ where: { id, status: "READING", attempts }, data: { status: failed ? "READ_FAILED" : "PENDING" } });
  if (c.count === 0) return "LOST";
  (failed ? uyari : bilgi)("gelen-belge", `tarama okunamadı (${code}) — deneme ${attempts}/${READ_MAX_ATTEMPTS}${failed ? ", READ_FAILED" : ", yeniden denenecek"}`);
  if (failed) await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData: { status: "READ_FAILED", attempts, code } });
  return failed ? "READ_FAILED" : "RETRY";
}

/** `scanId`: satırı doğuran tarama (E4) — çok sayfalı taslakta her sayfanın satırı KENDİ taramasını taşır. */
function lineRows(lines: DraftLine[], scanId: string, lineBase = 0, blockBase = 0) {
  return lines.map((l, i) => ({
    scanId,
    lineNo: lineBase + i + 1,
    blockNo: blockBase + l.blockNo,
    lineKind: l.lineKind,
    senderRollNo: l.senderRollNo,
    meters: new Prisma.Decimal(l.meters),
    weightKg: l.weightKg ? new Prisma.Decimal(l.weightKg) : null,
    widthCm: l.widthCm ? new Prisma.Decimal(l.widthCm) : null,
    itemText: l.itemText,
    colorText: l.colorText,
    confidence: new Prisma.Decimal(l.confidence.toFixed(4)),
    needsReview: l.needsReview,
    sourceRects: toJson(l.sourceRects),
    ocrRaw: toJson(l.ocrRaw),
  }));
}

/**
 * Bağlı taslağa eklenecek OCR satırları. Elle girilmiş satır (ocrRaw yok) varsa hiç satır eklenmez — panelin elle işi
 * ezilmez/ikizlenmez; yoksa BAŞKA taramalardan gelmiş satırlara karşı üst üste binen çekim süzgeci (`dropOverlapDuplicates`).
 */
async function linesToAppend(tx: Prisma.TransactionClient, noteId: string, scan: { id: string; pageNo: number }, lines: DraftLine[]) {
  const rows = await tx.customerDeliveryNoteLine.findMany({ where: { noteId }, select: { scanId: true, senderRollNo: true, meters: true, weightKg: true, ocrRaw: true } });
  if (rows.some((r) => r.ocrRaw === null)) return { lines: [], warnings: [] };
  const existing = rows.filter((r) => r.scanId !== scan.id).map((r) => ({ senderRollNo: r.senderRollNo, meters: r.meters.toString(), weightKg: r.weightKg?.toString() ?? null, ocrRaw: r.ocrRaw }));
  return dropOverlapDuplicates(lines, existing, scan.pageNo);
}

/** Bağlı taslakta yalnız BOŞ başlık alanları OCR'dan dolar — operatörün yazdığı ezilmez. */
function fillEmptyHeader(
  patch: Prisma.CustomerDeliveryNoteUpdateInput,
  note: { ownerText: string | null; senderText: string | null; templateId: string | null; senderDocNo: string | null; senderDocDate: Date | null; customerBatchNo: string | null; processText: string | null; declaredTopCount: number | null },
  headerCols: { ownerText: string | null; senderText: string | null; templateId: string | null; senderDocNo: string | null; senderDocDate: Date | null; customerBatchNo: string | null; processText: string | null; declaredTopCount: number | null },
): void {
  if (!note.ownerText) patch.ownerText = headerCols.ownerText;
  if (!note.senderText) patch.senderText = headerCols.senderText;
  if (!note.templateId && headerCols.templateId) patch.template = { connect: { id: headerCols.templateId } };
  if (!note.senderDocNo) patch.senderDocNo = headerCols.senderDocNo;
  if (!note.senderDocDate) patch.senderDocDate = headerCols.senderDocDate;
  if (!note.customerBatchNo) patch.customerBatchNo = headerCols.customerBatchNo;
  if (!note.processText) patch.processText = headerCols.processText;
  if (note.declaredTopCount === null) patch.declaredTopCount = headerCols.declaredTopCount;
}

/** E2: eşleşen motor şablonunun DB satırı (yoksa idempotent doğar) taslağa bağlanır — gönderen önerisi buradan; isabet best-effort. */
async function bindDraftTemplate(code: string | null, userId: string | undefined) {
  const template = code ? await ensureSenderTemplate(code, userId) : null;
  if (template) await bumpTemplateHit(template.id);
  return { code, template };
}

/**
 * READING'deki taramayı sidecar'a okutur, motorla çıkarır, DRAFT'a yazar. Tarama bir taslağa bağlıysa
 * yalnız BOŞ alanlar dolar ve satırsız taslağa satırlar eklenir (operatörün yazdığı ezilmez); bağlı değilse yeni taslak.
 */
export async function processClaimedScan(id: string, readerUrl: string, ocr: typeof readerOcr = readerOcr): Promise<ProcessOutcome> {
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: { id: true, status: true, attempts: true, noteId: true, pageNo: true, mimeType: true, content: true, capturedById: true, sha256: true } });
  if (!scan || scan.status !== "READING") return "LOST";
  let r: ReaderResult;
  try {
    r = await ocr(readerUrl, Buffer.from(scan.content), scan.mimeType);
  } catch (err) {
    return release(id, scan.attempts, `PROGRAM_HATASI:${(err as Error).name}`, { userId: scan.capturedById ?? undefined });
  }
  if (!r.ok) return release(id, scan.attempts, r.code, { permanent: r.kind === "HTTP" || r.kind === "INVALID", userId: scan.capturedById ?? undefined });
  const extracted = draftFromExtraction(extractDocument(r.result, loadTemplates(), FALLBACK_TEMPLATE_CODE));
  // Yan dönük sayfa: kutular panelin çizdiği (dönmemiş) fotoğrafın çerçevesine döner.
  const draft = { ...extracted, lines: linesToPhotoFrame(extracted.lines, r.result) };
  const { code: firstTemplate, template } = await bindDraftTemplate(draft.header.regions[0]?.templateId ?? null, scan.capturedById ?? undefined);
  const envelope = toJson({ ocr: r.result, regions: draft.header.regions });
  const scanData = { status: "READ" as const, ocrResult: envelope, ocrEngine: clip(r.engine, 32), ocrVersion: clip(r.version, 32), ocrDurationMs: r.durationMs };
  const userId = scan.capturedById ?? undefined;
  const { header } = draft;
  const headerCols = {
    ownerText: header.ownerText, senderDocNo: header.senderDocNo, senderDocDate: header.senderDocDate, customerBatchNo: header.customerBatchNo,
    processText: header.processText, declaredTopCount: header.declaredTopCount, senderText: header.senderText, templateId: template?.id ?? null, templateScore: header.templateScore === null ? null : new Prisma.Decimal(header.templateScore),
  };
  const totalsDeclared = toJson(header.totalsDeclared);
  const warnings = toJson(header.warnings);

  if (scan.noteId) {
    const noteId = scan.noteId;
    const res = await prisma.$transaction(async (tx) => {
      const claimed = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedAt: new Date() } });
      if (claimed.count === 0) {
        // Taslak artık DRAFT değil (onay/iptal): veri yalnız zarfta kalır, tarama yine READ'e kapanır — READING'de kalıp bayat döngüye girmez.
        const s0 = await tx.documentScan.updateMany({ where: { id, status: "READING" }, data: scanData });
        if (s0.count === 0) throw new Error("SCAN_LOST");
        return { noteId, lines: 0, filled: false };
      }
      const note = await tx.customerDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { ownerText: true, senderText: true, templateId: true, senderDocNo: true, senderDocDate: true, customerBatchNo: true, processText: true, declaredTopCount: true, totalsDeclared: true, warnings: true } });
      // Çok sayfalı taslak: her sayfanın taraması satırlarını EKLER (blok no kaydırılır, uyarılar birikir);
      // elle satır varsa OCR satır eklemez; başka sayfada birebir olan satır (üst üste binen çekim) atlanır. Okuma DRAFT
      // claim'inin satır kilidinin ARDINDAN: paralel ikinci sayfa claim'de bekler, READ COMMITTED ile birincinin satırlarını görür.
      const overlap = await linesToAppend(tx, noteId, scan, draft.lines);
      const agg = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId }, _max: { lineNo: true, blockNo: true } });
      const lineBase = agg._max.lineNo ?? 0;
      const blockBase = agg._max.blockNo ?? 0;
      const prevWarnings = Array.isArray(note.warnings) ? note.warnings : [];
      const patch: Prisma.CustomerDeliveryNoteUpdateInput = { warnings: toJson([...prevWarnings, ...header.warnings, ...overlap.warnings]) };
      fillEmptyHeader(patch, note, headerCols);
      const addLines = overlap.lines.length > 0;
      const prevBlocks = (note.totalsDeclared as { blocks?: unknown[] } | null)?.blocks;
      if (note.totalsDeclared === null || !Array.isArray(prevBlocks)) patch.totalsDeclared = totalsDeclared;
      else if (addLines && blockBase > 0) patch.totalsDeclared = toJson({ blocks: [...prevBlocks, ...header.totalsDeclared.blocks.map((b) => ({ ...b, blockNo: blockBase + b.blockNo }))] });
      patch.templateScore = headerCols.templateScore;
      if (addLines) patch.lines = { create: lineRows(overlap.lines, id, lineBase, blockBase) };
      await tx.customerDeliveryNote.update({ where: { id: noteId }, data: patch });
      const s = await tx.documentScan.updateMany({ where: { id, status: "READING" }, data: scanData });
      if (s.count === 0) throw new Error("SCAN_LOST");
      return { noteId, lines: addLines ? overlap.lines.length : 0, filled: true };
    }).catch((err) => (err instanceof Error && err.message === "SCAN_LOST" ? null : Promise.reject(err)));
    if (!res) return "LOST";
    if (res.filled) await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: noteId, newData: { source: "OCR", scanId: id, sha256: scan.sha256, lineCount: res.lines, engine: scanData.ocrEngine, warnings: header.warnings.length } });
    await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData: { status: "READ", noteId, noteFilled: res.filled, engine: scanData.ocrEngine, durationMs: r.durationMs } });
    return "READ";
  }

  const created = await withBarcodeRetry(async () => {
    const noteNo = await nextNoteNo();
    return prisma.$transaction(async (tx) => {
      const row = await tx.customerDeliveryNote.create({
        data: { ...headerCols, noteNo, sourceKind: "OCR", status: "DRAFT", totalsDeclared, warnings, createdById: scan.capturedById, updatedById: scan.capturedById, lines: draft.lines.length ? { create: lineRows(draft.lines, id) } : undefined },
        select: { id: true, noteNo: true },
      });
      const s = await tx.documentScan.updateMany({ where: { id, status: "READING", noteId: null }, data: { ...scanData, noteId: row.id } });
      if (s.count === 0) throw new Error("SCAN_LOST");
      return row;
    });
  }, undefined, (err) => p2002TargetsCode(err, "noteNo"), "Gelen belge numarası")
    .catch((err) => (err instanceof Error && err.message === "SCAN_LOST" ? null : translateUnique(err)));
  if (!created) return "LOST";
  await AuditService.log({ userId, action: "CREATE", tableName: NOTE_TABLE, recordId: created.id, newData: { noteNo: created.noteNo, status: "DRAFT", sourceKind: "OCR", templateCode: firstTemplate, scanId: id, sha256: scan.sha256, lineCount: draft.lines.length, blockCount: header.totalsDeclared.blocks.length, engine: scanData.ocrEngine, warnings: header.warnings.length } });
  await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData: { status: "READ", noteId: created.id, engine: scanData.ocrEngine, durationMs: r.durationMs } });
  return "READ";
}

/** Okuma durum özeti (durum ucu): kuyruk sayıları — PDF okuma işine ait değildir, hiçbir sayaca girmez (K6). */
export async function readerQueueCounts(): Promise<{ pending: number; reading: number; failed: number }> {
  const rows = await prisma.documentScan.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { in: ["PENDING", "READING", "READ_FAILED"] }, mimeType: { not: PDF_MIME } } });
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { pending: n("PENDING"), reading: n("READING"), failed: n("READ_FAILED") };
}

/** Okutulabilir mi: yok → 404; PDF → 400 (K6: otomatik okunmaz, satırlar elle/Excel). */
export async function assertScanReadable(id: string): Promise<{ id: string; status: string; noteId: string | null }> {
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: { id: true, status: true, noteId: true, mimeType: true } });
  if (!scan) throw AppError.notFound("Tarama bulunamadı.", { code: "DOCUMENT_SCAN_NOT_FOUND" });
  if (scan.mimeType === PDF_MIME) {
    throw AppError.badRequest("PDF belge otomatik okunmaz; satırları elle ya da Excel'le girin.", { code: "DOCUMENT_SCAN_PDF_NOT_READABLE" });
  }
  return scan;
}

/** Okut ucu: READ_FAILED → PENDING (deneme sayacı sıfır; atomik claim); PENDING/READING ise dokunmaz; READ ise 409; PDF 400. */
export async function requeueScanForReading(id: string, userId: string) {
  const scan = await assertScanReadable(id);
  if (scan.status === "READ") throw AppError.conflict("Tarama zaten okunmuş; taslağı düzenleyin.", { code: "DOCUMENT_SCAN_ALREADY_READ" });
  if (scan.status === "READ_FAILED") {
    const c = await prisma.documentScan.updateMany({ where: { id, status: "READ_FAILED", mimeType: { not: PDF_MIME } }, data: { status: "PENDING", attempts: 0 } });
    if (c.count === 0) throw AppError.conflict("Tarama bu arada başka durumda; yenileyin.", { code: "DOCUMENT_SCAN_STATE_CHANGED" });
    await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READ_FAILED" }, newData: { status: "PENDING", attempts: 0 } });
  }
  return prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, attempts: true, noteId: true } });
}
