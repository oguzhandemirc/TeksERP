// =============================================================================
// GELEN BELGE — okuma sonucunu DRAFT taslağa yazan ORTAK katman (canlı okuma + saklı zarf)
// =============================================================================
// İki yazar tek yoldan geçer: okuma işi (`processClaimedScan`, sidecar yanıtı) ve okunmuş taramanın başka taslağa
// yeniden bağlanması (silinen taslağın fotoğrafı yeniden yüklenir → OCR yeniden koşmadan `DocumentScan.ocrResult`
// zarfından). İkisi de bağlı taslakta yalnız BOŞ başlık alanını doldurur, elle satırlı taslağa satır eklemez, üst üste
// binen çekim süzgecinden geçer. Bu dosya tarama/taslak servislerini İÇE AKTARMAZ (değer döngüsü yok —
// `test_import_cycles`): scan · note · okuma servisleri buradan okur.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { extractDocument, loadTemplates, type OcrResult } from "../lib/gelen-belge/motor";
import { draftFromExtraction, dropOverlapDuplicates, linesToPhotoFrame, type DraftFromOcr, type DraftLine } from "../lib/gelen-belge/taslak";
import { OcrResultSchema } from "../lib/gelen-belge/okuma-istemcisi";
import { AuditService } from "./audit.service";
import { FALLBACK_TEMPLATE_CODE, bumpTemplateHit, ensureSenderTemplate } from "./gelen-belge-sablon.service";

const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const SCAN_TABLE = "DOCUMENT_SCAN";

/** Düz nesneyi Prisma Json girdisine çevirir (tip zorlaması yok: JSON gidiş-dönüş; rect/raw/uyarı zaten düz veridir). */
export function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v));
}

/** Motorun çıkardığı taslak + taslağa yazılacak hazır kolonlar (şablon satırı tx DIŞINDA idempotent doğmuştur). */
export interface BuiltDraft {
  draft: DraftFromOcr;
  firstTemplate: string | null;
  headerCols: {
    ownerText: string | null; senderDocNo: string | null; senderDocDate: Date | null; customerBatchNo: string | null;
    processText: string | null; declaredTopCount: number | null; senderText: string | null; templateId: string | null; templateScore: Prisma.Decimal | null;
  };
  totalsDeclared: Prisma.InputJsonValue;
  warnings: Prisma.InputJsonValue;
  /** `DocumentScan.ocrResult` zarfı: sidecar sonucu + bölge başlıkları (saklı okumadan yeniden kurulumun kaynağı). */
  envelope: Prisma.InputJsonValue;
}

/**
 * OCR sonucu → motor → taslak parçaları. E2: eşleşen motor şablonunun DB satırı yoksa idempotent doğar; `bumpHit`
 * yalnız GERÇEK okumada (saklı zarftan yeniden kurulum yeni bir okuma değildir, isabet sayılmaz).
 */
export async function buildDraft(result: OcrResult, userId: string | undefined, opts: { bumpHit: boolean }): Promise<BuiltDraft> {
  const extracted = draftFromExtraction(extractDocument(result, loadTemplates(), FALLBACK_TEMPLATE_CODE));
  // Yan dönük sayfa: kutular panelin çizdiği (dönmemiş) fotoğrafın çerçevesine döner.
  const draft = { ...extracted, lines: linesToPhotoFrame(extracted.lines, result) };
  const code = draft.header.regions[0]?.templateId ?? null;
  const template = code ? await ensureSenderTemplate(code, userId) : null;
  if (template && opts.bumpHit) await bumpTemplateHit(template.id);
  const { header } = draft;
  return {
    draft,
    firstTemplate: code,
    headerCols: {
      ownerText: header.ownerText, senderDocNo: header.senderDocNo, senderDocDate: header.senderDocDate, customerBatchNo: header.customerBatchNo,
      processText: header.processText, declaredTopCount: header.declaredTopCount, senderText: header.senderText, templateId: template?.id ?? null,
      templateScore: header.templateScore === null ? null : new Prisma.Decimal(header.templateScore),
    },
    totalsDeclared: toJson(header.totalsDeclared),
    warnings: toJson(header.warnings),
    envelope: toJson({ ocr: result, regions: header.regions }),
  };
}

/** Saklı zarftan (`{ ocr, regions }`) yeniden kurulum; zarf yok ya da şema dışı → null (FAIL-CLOSED: çağıran yeniden okumaya döner). */
export async function buildDraftFromEnvelope(envelope: Prisma.JsonValue | null, userId: string | undefined): Promise<BuiltDraft | null> {
  const ocr = envelope !== null && typeof envelope === "object" && !Array.isArray(envelope) ? (envelope as Record<string, unknown>).ocr : undefined;
  const parsed = OcrResultSchema.safeParse(ocr);
  if (!parsed.success) return null;
  return buildDraft(parsed.data as OcrResult, userId, { bumpHit: false });
}

/** `scanId`: satırı doğuran tarama (E4) — çok sayfalı taslakta her sayfanın satırı KENDİ taramasını taşır. */
export function lineRows(lines: DraftLine[], scanId: string, lineBase = 0, blockBase = 0) {
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
    processText: l.processText,
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

type HeaderFillable = Omit<BuiltDraft["headerCols"], "templateScore">;

/** Bağlı taslakta yalnız BOŞ başlık alanları OCR'dan dolar — operatörün yazdığı ezilmez. */
function fillEmptyHeader(patch: Prisma.CustomerDeliveryNoteUpdateInput, note: HeaderFillable, headerCols: HeaderFillable): void {
  if (!note.ownerText) patch.ownerText = headerCols.ownerText;
  if (!note.senderText) patch.senderText = headerCols.senderText;
  if (!note.templateId && headerCols.templateId) patch.template = { connect: { id: headerCols.templateId } };
  if (!note.senderDocNo) patch.senderDocNo = headerCols.senderDocNo;
  if (!note.senderDocDate) patch.senderDocDate = headerCols.senderDocDate;
  if (!note.customerBatchNo) patch.customerBatchNo = headerCols.customerBatchNo;
  if (!note.processText) patch.processText = headerCols.processText;
  if (note.declaredTopCount === null) patch.declaredTopCount = headerCols.declaredTopCount;
}

/**
 * Bağlı DRAFT taslağa bir taramanın sonucunu yazar; ÇAĞIRAN aynı tx'te `{id, status: DRAFT}` claim'ini ÖNCE almıştır
 * (satır kilidi paralel sayfayı serileştirir; mevcut satırlar claim'in ARDINDAN okunur). Eklenen satır sayısını döner.
 * Çok sayfalı taslak: her sayfanın satırları EKLENİR (blok no kaydırılır, uyarılar birikir).
 */
export async function fillBoundDraftTx(tx: Prisma.TransactionClient, noteId: string, scan: { id: string; pageNo: number }, built: BuiltDraft): Promise<number> {
  const { draft, headerCols } = built;
  const { header } = draft;
  const note = await tx.customerDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { ownerText: true, senderText: true, templateId: true, senderDocNo: true, senderDocDate: true, customerBatchNo: true, processText: true, declaredTopCount: true, totalsDeclared: true, warnings: true } });
  const overlap = await linesToAppend(tx, noteId, scan, draft.lines);
  const agg = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId }, _max: { lineNo: true, blockNo: true } });
  const lineBase = agg._max.lineNo ?? 0;
  const blockBase = agg._max.blockNo ?? 0;
  const prevWarnings = Array.isArray(note.warnings) ? note.warnings : [];
  const patch: Prisma.CustomerDeliveryNoteUpdateInput = { warnings: toJson([...prevWarnings, ...header.warnings, ...overlap.warnings]) };
  fillEmptyHeader(patch, note, headerCols);
  const addLines = overlap.lines.length > 0;
  const prevBlocks = (note.totalsDeclared as { blocks?: unknown[] } | null)?.blocks;
  if (note.totalsDeclared === null || !Array.isArray(prevBlocks)) patch.totalsDeclared = built.totalsDeclared;
  else if (addLines && blockBase > 0) patch.totalsDeclared = toJson({ blocks: [...prevBlocks, ...header.totalsDeclared.blocks.map((b) => ({ ...b, blockNo: blockBase + b.blockNo }))] });
  patch.templateScore = headerCols.templateScore;
  if (addLines) patch.lines = { create: lineRows(overlap.lines, scan.id, lineBase, blockBase) };
  await tx.customerDeliveryNote.update({ where: { id: noteId }, data: patch });
  return addLines ? overlap.lines.length : 0;
}

// ── Kaynak: fotoğrafla açılan taslak ─────────────────────────────────────────

/**
 * Fotoğraf (PDF olmayan tarama) bağlanan, henüz SATIRSIZ MANUAL taslak OCR kaynaklıdır: panel ve tablet yükleme akışı
 * taslağı MANUAL açıp sayfayı sonra bağlar. Bağlama claim'iyle AYNI tx'te, atomik (`updateMany` WHERE durum + kaynak + satırsız);
 * elle satırlı taslak ve PDF MANUAL kalır. Değişti mi döner (audit tx dışında çağıranda).
 */
export async function markPhotoSourceTx(tx: Prisma.TransactionClient, noteId: string): Promise<boolean> {
  const c = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT", sourceKind: "MANUAL", lines: { none: {} } }, data: { sourceKind: "OCR" } });
  return c.count === 1;
}

export async function auditPhotoSource(noteId: string, userId: string | undefined): Promise<void> {
  await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: noteId, oldData: { sourceKind: "MANUAL" }, newData: { sourceKind: "OCR", reason: "PHOTO_BOUND" } });
}

// ── Okunmuş taramanın yeniden bağlanması (silinen taslağın fotoğrafı) ──────────

export interface StoredReadPlan {
  scanId: string;
  pageNo: number;
  sha256: string;
  /** null → zarf yok/şema dışı: tarama yeniden okumaya (PENDING) döner. */
  built: BuiltDraft | null;
}

export type StoredReadOutcome = { scanId: string; sha256: string; mode: "REBUILT"; lines: number } | { scanId: string; sha256: string; mode: "REQUEUED" };

/**
 * tx DIŞINDA: bağlanacak taramalardan OKUNMUŞ (READ) olanların saklı sonucu hazırlanır (motor + şablon satırı). Serbest READ
 * tarama yalnız taslağı silinmiş taramadır; serbestken durumu değişmez (okuma işi yalnız PENDING/READING alır, yeniden okuma
 * bağlı tarama ister) — bağlama `noteId: null` claim'i bu varsayımı tx içinde korur.
 */
export async function prepareStoredReads(scanIds: readonly string[], userId: string | undefined): Promise<StoredReadPlan[]> {
  if (!scanIds.length) return [];
  const rows = await prisma.documentScan.findMany({ where: { id: { in: [...scanIds] }, status: "READ" }, select: { id: true, pageNo: true, sha256: true, ocrResult: true }, orderBy: [{ pageNo: "asc" }, { createdAt: "asc" }] });
  const plans: StoredReadPlan[] = [];
  for (const r of rows) plans.push({ scanId: r.id, pageNo: r.pageNo, sha256: r.sha256, built: await buildDraftFromEnvelope(r.ocrResult, userId) });
  return plans;
}

/**
 * Bağlama tx'inin İÇİNDE, DRAFT claim'i + `noteId` bağlamasından SONRA: hazır sonuçla satırları kurar (OCR koşmaz);
 * zarfı olmayan tarama READ → PENDING/0 olur, okuma işi bağlı taslağa okur. Durum değişmişse 409 (tx geri sarar).
 */
export async function applyStoredReadsTx(tx: Prisma.TransactionClient, noteId: string, plans: readonly StoredReadPlan[]): Promise<StoredReadOutcome[]> {
  const out: StoredReadOutcome[] = [];
  for (const p of plans) {
    if (p.built) {
      out.push({ scanId: p.scanId, sha256: p.sha256, mode: "REBUILT", lines: await fillBoundDraftTx(tx, noteId, { id: p.scanId, pageNo: p.pageNo }, p.built) });
      continue;
    }
    const c = await tx.documentScan.updateMany({ where: { id: p.scanId, noteId, status: "READ" }, data: { status: "PENDING", attempts: 0 } });
    if (c.count === 0) throw AppError.conflict("Tarama bu arada başka durumda; yenileyin.", { code: "DOCUMENT_SCAN_STATE_CHANGED" });
    out.push({ scanId: p.scanId, sha256: p.sha256, mode: "REQUEUED" });
  }
  return out;
}

/** Yeniden kurulumun izi — tx DIŞINDA, yalnız künye (ham OCR/bayt yok). */
export async function auditStoredReads(noteId: string, outcomes: readonly StoredReadOutcome[], userId: string | undefined): Promise<void> {
  for (const o of outcomes) {
    if (o.mode === "REBUILT") {
      await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: noteId, newData: { source: "OCR_STORED", scanId: o.scanId, sha256: o.sha256, lineCount: o.lines } });
    } else {
      await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: o.scanId, oldData: { status: "READ" }, newData: { status: "PENDING", attempts: 0, noteId, reason: "STORED_RESULT_MISSING" } });
    }
  }
}
