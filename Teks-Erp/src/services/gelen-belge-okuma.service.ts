// =============================================================================
// Gelen belge OKUMA (D3b): tarama claim → sidecar → motor → DRAFT taslak
// =============================================================================
// DEFTER-ÖNCELİKLİ: burada top DOĞMAZ, OCR deftere yazmaz; yalnız DocumentScan durumu ve DRAFT taslak.
// Claim atomik: `updateMany WHERE {id, status: PENDING}` (READING'de takılı kalan 10 dk sonra yeniden alınır);
// 3 denemede (4xx / şema dışı gövdede hemen) READ_FAILED. Audit yükü: künye (noteNo, satır sayısı, motor adı) — ham OCR metni / bayt GİRMEZ.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { bilgi, uyari } from "../lib/logger";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { clip } from "../lib/gelen-belge/taslak";
import { readerOcr, type ReaderResult } from "../lib/gelen-belge/okuma-istemcisi";
import { AuditService } from "./audit.service";
import { nextNoteNo, translateUnique } from "./gelen-belge-note.service";
import { buildDraft, fillBoundDraftTx, lineRows } from "./gelen-belge-taslak-doldur.service";
import { PDF_MIME } from "./gelen-belge-scan.service";

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
  const userId = scan.capturedById ?? undefined;
  const built = await buildDraft(r.result, userId, { bumpHit: true });
  const { draft, firstTemplate, headerCols, totalsDeclared, warnings } = built;
  const { header } = draft;
  const scanData = { status: "READ" as const, ocrResult: built.envelope, ocrEngine: clip(r.engine, 32), ocrVersion: clip(r.version, 32), ocrDurationMs: r.durationMs };

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
      // Çok sayfalı taslak: sayfanın satırları EKLENİR, elle satırlı taslağa eklenmez, üst üste binen satır atlanır
      // (ortak katman `fillBoundDraftTx`; satırlar DRAFT claim'inin satır kilidinin ARDINDAN okunur).
      const lines = await fillBoundDraftTx(tx, noteId, scan, built);
      const s = await tx.documentScan.updateMany({ where: { id, status: "READING" }, data: scanData });
      if (s.count === 0) throw new Error("SCAN_LOST");
      return { noteId, lines, filled: true };
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

/**
 * Okunmuş ama taslağa satır vermemiş sayfa (ör. silinen taslağın fotoğrafı eski sürümde yeniden bağlandı): bağlı taslak DRAFT
 * ve bu taramadan doğmuş satır YOKSA READ → PENDING/0. Taslak claim'i (satır kilidi) satır sayımını ve okuma işinin satır
 * yazımını serileştirir; satırı olan sayfa yeniden okunmaz (satırlar ikilenirdi) → 409.
 */
async function rereadEmptyScan(id: string, noteId: string | null, userId: string): Promise<void> {
  if (!noteId) throw AppError.conflict("Tarama okunmuş ve bir taslağa bağlı değil; fotoğrafı bir taslağa yükleyin.", { code: "DOCUMENT_SCAN_ALREADY_READ" });
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedById: userId } });
    if (claimed.count === 0) throw AppError.conflict("Taslak değil; okunmuş sayfa yalnız taslakta yeniden okunur.", { code: "DELIVERY_NOTE_NOT_DRAFT" });
    const own = await tx.customerDeliveryNoteLine.count({ where: { noteId, scanId: id } });
    if (own > 0) throw AppError.conflict("Bu sayfanın satırları taslakta; yeniden okumak satırları ikilerdi. Satırları düzenleyin.", { code: "DOCUMENT_SCAN_ALREADY_READ", lineCount: own });
    const c = await tx.documentScan.updateMany({ where: { id, noteId, status: "READ", mimeType: { not: PDF_MIME } }, data: { status: "PENDING", attempts: 0 } });
    if (c.count === 0) throw AppError.conflict("Tarama bu arada başka durumda; yenileyin.", { code: "DOCUMENT_SCAN_STATE_CHANGED" });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READ" }, newData: { status: "PENDING", attempts: 0, noteId, reason: "REREAD_NO_LINES" } });
}

/**
 * Okut ucu: READ_FAILED → PENDING (deneme sayacı sıfır; atomik claim); PENDING/READING ise dokunmaz; READ ise yalnız
 * bağlı taslakta satırsız sayfa yeniden okunur (`rereadEmptyScan`), aksi 409; PDF 400.
 */
export async function requeueScanForReading(id: string, userId: string) {
  const scan = await assertScanReadable(id);
  if (scan.status === "READ") await rereadEmptyScan(id, scan.noteId, userId);
  if (scan.status === "READ_FAILED") {
    const c = await prisma.documentScan.updateMany({ where: { id, status: "READ_FAILED", mimeType: { not: PDF_MIME } }, data: { status: "PENDING", attempts: 0 } });
    if (c.count === 0) throw AppError.conflict("Tarama bu arada başka durumda; yenileyin.", { code: "DOCUMENT_SCAN_STATE_CHANGED" });
    await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READ_FAILED" }, newData: { status: "PENDING", attempts: 0 } });
  }
  return prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, attempts: true, noteId: true } });
}
