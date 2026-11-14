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
import { buildDraft, fillBoundDraftTx, lineRows, type ServerComplement } from "./gelen-belge-taslak-doldur.service";
import type { OcrResult } from "../lib/gelen-belge/motor";
import { PDF_MIME } from "./gelen-belge-scan.service";
import { photoPurgedError } from "./gelen-belge-foto-saklama.service";
import { readDuplicateDocNoMode } from "./system-setting.service";
import { lockDocNosTx } from "./helpers/gelen-belge-mukerrer.helper";
import { emitIncomingDocCreatedTx } from "./notification-sources/depo";

export const READ_MAX_ATTEMPTS = 3;
/** READING'de bu kadar kalan tarama (süreç düşmüş) yeniden PENDING sayılır. */
export const READING_STALE_MS = 10 * 60 * 1000;
const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const SCAN_TABLE = "DOCUMENT_SCAN";
const LINE_TABLE = "CUSTOMER_DELIVERY_NOTE_LINE";

// ── Claim ────────────────────────────────────────────────────────────────────

export type ClaimOutcome = { kind: "NONE" } | { kind: "RACED" } | { kind: "CLAIMED"; id: string };

/** En eski PENDING (ya da bayat READING) taramayı atomik alır; yarışta kaybeden RACED döner (çağıran yeniden dener). */
export async function claimNextScan(now: Date = new Date(), skipIds: readonly string[] = []): Promise<ClaimOutcome> {
  const stale = new Date(now.getTime() - READING_STALE_MS);
  const cand = await prisma.documentScan.findFirst({
    // Aynı turda denenmiş tarama yeniden alınmaz (`skipIds`): 5xx'te üç deneme üç AYRI tura yayılır. (`notIn: []` yasak → koşullu.)
    // K6: PDF ASLA claim edilmez (yükleme READ_FAILED doğurur; D2 döneminden PENDING kalmış PDF'e karşı savunma).
    // K28: baytı silinmiş tarama okunamaz (claim edilmez; okut ucu 410 verir).
    where: { OR: [{ status: "PENDING" }, { status: "READING", updatedAt: { lt: stale } }], mimeType: { not: PDF_MIME }, contentState: { not: "PURGED" }, ...(skipIds.length ? { id: { notIn: [...skipIds] } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, updatedAt: true },
  });
  if (!cand) return { kind: "NONE" };
  const c = await prisma.documentScan.updateMany({
    where: { id: cand.id, status: cand.status, updatedAt: cand.updatedAt, mimeType: { not: PDF_MIME }, contentState: { not: "PURGED" } },
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

/** Okumanın tamamlayıcısı (cihaz okuması → sunucu okuması): tx DIŞINDA koşar; tamamlama gerekmiyorsa null. */
export type CompleteFn = (result: OcrResult, content: Buffer, mimeType: string) => Promise<ServerComplement | null>;

/**
 * READING'deki taramayı sidecar'a okutur, motorla çıkarır, DRAFT'a yazar. Tarama bir taslağa bağlıysa
 * yalnız BOŞ alanlar dolar ve satırsız taslağa satırlar eklenir (operatörün yazdığı ezilmez); bağlı değilse yeni taslak.
 * `opts.complete` (yalnız cihaz okuması): boş başlık alanı için sunucu okuması — tx'lerden ÖNCE, bir kez.
 */
export async function processClaimedScan(id: string, readerUrl: string, ocr: typeof readerOcr = readerOcr, opts: { complete?: CompleteFn } = {}): Promise<ProcessOutcome> {
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: { id: true, status: true, attempts: true, noteId: true, pageNo: true, mimeType: true, content: true, capturedById: true, sha256: true } });
  if (!scan || scan.status !== "READING") return "LOST";
  if (!scan.content) return release(id, scan.attempts, "CONTENT_PURGED", { permanent: true, userId: scan.capturedById ?? undefined });
  const content = scan.content;
  let r: ReaderResult;
  try {
    r = await ocr(readerUrl, Buffer.from(content), scan.mimeType);
  } catch (err) {
    return release(id, scan.attempts, `PROGRAM_HATASI:${(err as Error).name}`, { userId: scan.capturedById ?? undefined });
  }
  if (!r.ok) return release(id, scan.attempts, r.code, { permanent: r.kind === "HTTP" || r.kind === "INVALID", userId: scan.capturedById ?? undefined });
  const userId = scan.capturedById ?? undefined;
  const complement = opts.complete ? await opts.complete(r.result, Buffer.from(content), scan.mimeType) : null;
  const built = await buildDraft(r.result, userId, { bumpHit: true, complement });
  const serverKunye = complement ? { serverFilled: built.serverFilled, ...(complement.failed ? { serverFailed: complement.failed } : {}) } : {};
  const { draft, firstTemplate, headerCols, totalsDeclared, warnings } = built;
  const { header } = draft;
  const scanData = { status: "READ" as const, ocrResult: built.envelope, ocrEngine: clip(r.engine, 32), ocrVersion: clip(r.version, 32), ocrDurationMs: r.durationMs };

  if (scan.noteId) {
    const noteId = scan.noteId;
    const dupMode = await readDuplicateDocNoMode();
    const res = await prisma.$transaction(async (tx) => {
      // K27 BLOCK: boş belge no bu okumadan dolabilir → 8044 kilidi tx'in İLK ifadesi.
      await lockDocNosTx(tx, dupMode, [headerCols.senderDocNo]);
      const claimed = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedAt: new Date() } });
      if (claimed.count === 0) {
        // Taslak artık DRAFT değil (onay/iptal): veri yalnız zarfta kalır, tarama yine READ'e kapanır — READING'de kalıp bayat döngüye girmez.
        const s0 = await tx.documentScan.updateMany({ where: { id, status: "READING" }, data: scanData });
        if (s0.count === 0) throw new Error("SCAN_LOST");
        return { noteId, lines: 0, filled: false, autoSender: null };
      }
      // Çok sayfalı taslak: sayfanın satırları EKLENİR, elle satırlı taslağa eklenmez, üst üste binen satır atlanır
      // (ortak katman `fillBoundDraftTx`; satırlar DRAFT claim'inin satır kilidinin ARDINDAN okunur).
      const { lines, autoSenderCustomerId: autoSender } = await fillBoundDraftTx(tx, noteId, scan, built);
      const s = await tx.documentScan.updateMany({ where: { id, status: "READING" }, data: scanData });
      if (s.count === 0) throw new Error("SCAN_LOST");
      return { noteId, lines, filled: true, autoSender };
    }).catch((err) => (err instanceof Error && err.message === "SCAN_LOST" ? null : Promise.reject(err)));
    if (!res) return "LOST";
    if (res.filled) await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: noteId, newData: { source: "OCR", scanId: id, sha256: scan.sha256, lineCount: res.lines, engine: scanData.ocrEngine, warnings: header.warnings.length, ...(res.autoSender ? { senderCustomerId: res.autoSender, senderFrom: "TEMPLATE" } : {}) } });
    await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData: { status: "READ", noteId, noteFilled: res.filled, engine: scanData.ocrEngine, durationMs: r.durationMs, ...serverKunye } });
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
      await emitIncomingDocCreatedTx(tx, row.id, scan.capturedById);
      return row;
    });
  }, undefined, (err) => p2002TargetsCode(err, "noteNo"), "Gelen belge numarası")
    .catch((err) => (err instanceof Error && err.message === "SCAN_LOST" ? null : translateUnique(err)));
  if (!created) return "LOST";
  await AuditService.log({ userId, action: "CREATE", tableName: NOTE_TABLE, recordId: created.id, newData: { noteNo: created.noteNo, status: "DRAFT", sourceKind: "OCR", templateCode: firstTemplate, scanId: id, sha256: scan.sha256, lineCount: draft.lines.length, blockCount: header.totalsDeclared.blocks.length, engine: scanData.ocrEngine, warnings: header.warnings.length, ...(headerCols.senderCustomerId ? { senderCustomerId: headerCols.senderCustomerId, senderFrom: "TEMPLATE" } : {}) } });
  await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData: { status: "READ", noteId: created.id, engine: scanData.ocrEngine, durationMs: r.durationMs, ...serverKunye } });
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
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: { id: true, status: true, noteId: true, mimeType: true, contentState: true } });
  if (!scan) throw AppError.notFound("Tarama bulunamadı.", { code: "DOCUMENT_SCAN_NOT_FOUND" });
  // K28: KÜÇÜK fotoğraf en iyi çabayla okunur; SİLİNDİ'de okunacak bayt yok.
  if (scan.contentState === "PURGED") throw photoPurgedError();
  if (scan.mimeType === PDF_MIME) {
    throw AppError.badRequest("PDF belge otomatik okunmaz; satırları elle ya da Excel'le girin.", { code: "DOCUMENT_SCAN_PDF_NOT_READABLE" });
  }
  return scan;
}

/**
 * Okunmuş sayfayı bağlı DRAFT taslakta READ → PENDING/0 döndürür. Satırsız sayfa doğrudan; aynı belgede tanıtma sonrası
 * (K30-B) taslağın TÜM satırları bu taramanın ve okuma işinin yazdığı hâliyle (girilmemiş, hiç düzeltilmemiş: updatedAt =
 * createdAt) duruyorsa satırlar aynı tx'te silinir (deftere yazmamış taslak satırı). Elle satır / düzeltilmiş satır → 409.
 * Taslak claim'i (satır kilidi) satır düzeltme/silme ve okuma işinin satır yazımını serileştirir.
 */
async function rereadEmptyScan(id: string, noteId: string | null, userId: string): Promise<void> {
  if (!noteId) throw AppError.conflict("Tarama okunmuş ve bir taslağa bağlı değil; fotoğrafı bir taslağa yükleyin.", { code: "DOCUMENT_SCAN_ALREADY_READ" });
  const dropped = await prisma.$transaction(async (tx) => {
    const claimed = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedById: userId } });
    if (claimed.count === 0) throw AppError.conflict("Taslak değil; okunmuş sayfa yalnız taslakta yeniden okunur.", { code: "DELIVERY_NOTE_NOT_DRAFT" });
    const rows = await tx.customerDeliveryNoteLine.findMany({ where: { noteId }, select: { id: true, scanId: true, status: true, rollId: true, createdAt: true, updatedAt: true } });
    const own = rows.filter((l) => l.scanId === id).length;
    const pristine = rows.every((l) => l.scanId === id && l.status === "PENDING" && l.rollId === null && l.createdAt.getTime() === l.updatedAt.getTime());
    if (own > 0 && !pristine) throw AppError.conflict("Bu sayfanın satırları taslakta düzenlenmiş; yeniden okumak satırları ikilerdi. Satırları düzenleyin.", { code: "DOCUMENT_SCAN_ALREADY_READ", lineCount: own });
    if (own > 0) {
      const d = await tx.customerDeliveryNoteLine.deleteMany({ where: { id: { in: rows.map((l) => l.id) }, noteId, scanId: id, status: "PENDING", rollId: null } });
      if (d.count !== rows.length) throw AppError.conflict("Taslak satırları bu arada değişti; yenileyin.", { code: "DOCUMENT_SCAN_STATE_CHANGED" });
    }
    const c = await tx.documentScan.updateMany({ where: { id, noteId, status: "READ", mimeType: { not: PDF_MIME } }, data: { status: "PENDING", attempts: 0 } });
    if (c.count === 0) throw AppError.conflict("Tarama bu arada başka durumda; yenileyin.", { code: "DOCUMENT_SCAN_STATE_CHANGED" });
    return own > 0 ? rows.map((l) => l.id) : [];
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READ" }, newData: { status: "PENDING", attempts: 0, noteId, reason: dropped.length > 0 ? "REREAD_UNEDITED_LINES" : "REREAD_NO_LINES", ...(dropped.length > 0 ? { droppedLines: dropped.length } : {}) } });
  if (dropped.length > 0) await AuditService.logMany(dropped.map((lineId) => ({ userId, action: "DELETE" as const, tableName: LINE_TABLE, recordId: lineId, oldData: { noteId, scanId: id, reason: "REREAD_UNEDITED_LINES" } })));
}

/**
 * Okut ucu: READ_FAILED → PENDING (deneme sayacı sıfır; atomik claim); PENDING/READING ise dokunmaz; READ ise yalnız
 * bağlı taslakta satırsız ya da satırları dokunulmamış sayfa yeniden okunur (`rereadEmptyScan`), aksi 409; PDF 400.
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
