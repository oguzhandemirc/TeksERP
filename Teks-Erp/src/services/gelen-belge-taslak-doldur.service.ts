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
import { batchAndMeterColumns, deriveBatchAndMeters, readFirstRegion, rememberedBatchKey, toRegion, type BatchAndMeterColumns } from "./gelen-belge-parti-metre.service";
import { readHandwritingOutlierFactor, readHeaderLineMeterSource, readIncomingDocAutoSender } from "./system-setting.service";

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
    customerOrderNo: string | null; processText: string | null; declaredTopCount: number | null; senderText: string | null; templateId: string | null; templateScore: Prisma.Decimal | null;
    /** S1: sayfa damgasının toplamı ("1/2" → 2); okunmadıysa null. */
    pageCount: number | null;
    /** Yalnız `gelenBelge.autoSenderFromTemplate` açıkken: aktif şablonun aktif gönderen carisi; aksi null. */
    senderCustomerId: string | null;
  } & BatchAndMeterColumns;
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
  // Şüphe oranı her kurulumda o anki fabrika ayarından (saklı zarftan yeniden kurulum da güncel oranla işaretler).
  const outlierFactor = await readHandwritingOutlierFactor();
  const headerLineSource = await readHeaderLineMeterSource();
  const extracted = draftFromExtraction(extractDocument(result, loadTemplates(), FALLBACK_TEMPLATE_CODE), { outlierFactor, headerLineSource });
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
      customerOrderNo: header.customerOrderNo, processText: header.processText, declaredTopCount: header.declaredTopCount, senderText: header.senderText, templateId: template?.id ?? null,
      pageCount: header.page?.of ?? null,
      templateScore: header.templateScore === null ? null : new Prisma.Decimal(header.templateScore),
      senderCustomerId: template ? await templateSender(template.id) : null,
      // Parti no + kurşun metresi (Gülkesim): seçim hatırlanan form anahtarıyla; kolonlar yalnız boşken yazılır.
      ...batchAndMeterColumns({ batchNoCandidates: header.batchNoCandidates, kursun: header.kursun }, await rememberedBatchKey(prisma, template?.id)),
    },
    totalsDeclared: toJson(header.totalsDeclared),
    warnings: toJson(header.warnings),
    envelope: toJson({ ocr: result, regions: header.regions }),
  };
}

/**
 * S3(b): ayar açıksa şablonun bağlı gönderen carisi — şablon ve cari AKTİF olmalı (eşleme önerisinin `TEMPLATE` kaynağıyla
 * aynı koşul); ayar kapalı (varsayılan) → null = bugünkü (OCR gönderen doldurmaz).
 */
async function templateSender(templateId: string): Promise<string | null> {
  if (!(await readIncomingDocAutoSender())) return null;
  const t = await prisma.senderTemplate.findUnique({ where: { id: templateId }, select: { isActive: true, senderCustomer: { select: { id: true, isActive: true } } } });
  return t?.isActive && t.senderCustomer?.isActive ? t.senderCustomer.id : null;
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

type HeaderFillable = Omit<BuiltDraft["headerCols"], "templateScore" | keyof BatchAndMeterColumns>;
type NoteBatchMeter = Pick<BatchAndMeterColumns, "ourBatchNo" | "kursunMeters"> & { kursunMetersSource: string | null; templateId: string | null; totalsDeclared: Prisma.JsonValue };

/**
 * Parti no + kurşun metresi NOT DÜZEYİNDE (ilk okunmuş sayfanın bölgesi + birleşik beyan + canlı ve eklenen satırlar).
 * Parti no yalnız boşken; metre boşken ya da makine değeriyken (MANUAL değil) yeni sayfa satır eklediyse — sayfalar
 * boyunca birikir (R3); operatörün değeri (MANUAL) ve yeniden okuma kolonu ezmez.
 */
async function fillBatchAndMeters(tx: Prisma.TransactionClient, noteId: string, note: NoteBatchMeter, ctx: { patch: Prisma.CustomerDeliveryNoteUpdateInput; built: BuiltDraft; added: DraftLine[]; pageAppended: boolean }): Promise<void> {
  const { patch, built, added } = ctx;
  if (note.ourBatchNo && note.kursunMeters !== null && (note.kursunMetersSource === "MANUAL" || !ctx.pageAppended)) return;
  const region = (await readFirstRegion(tx, noteId)) ?? toRegion(built.draft.header.regions[0]);
  const live = await tx.customerDeliveryNoteLine.findMany({ where: { noteId, status: { notIn: ["SKIPPED", "INFO"] } }, select: { meters: true } });
  const totals = patch.totalsDeclared !== undefined ? patch.totalsDeclared : note.totalsDeclared;
  const d = deriveBatchAndMeters(region, totals, [...live.map((l) => l.meters), ...added.map((l) => l.meters)]);
  const cols = batchAndMeterColumns(d, await rememberedBatchKey(tx, note.templateId ?? built.headerCols.templateId));
  if (!note.ourBatchNo && cols.ourBatchNo) Object.assign(patch, { ourBatchNo: cols.ourBatchNo, ourBatchNoKey: cols.ourBatchNoKey });
  const refresh = note.kursunMeters === null || (note.kursunMetersSource !== "MANUAL" && ctx.pageAppended);
  if (refresh && cols.kursunMeters) Object.assign(patch, { kursunMeters: cols.kursunMeters, kursunMetersSource: cols.kursunMetersSource, kursunMetersReview: cols.kursunMetersReview });
}

/** Bağlı taslakta yalnız BOŞ başlık alanları OCR'dan dolar — operatörün yazdığı ezilmez. Şablondan yazılan gönderen döner. */
function fillEmptyHeader(patch: Prisma.CustomerDeliveryNoteUpdateInput, note: HeaderFillable, headerCols: HeaderFillable): string | null {
  if (!note.ownerText) patch.ownerText = headerCols.ownerText;
  if (!note.senderText) patch.senderText = headerCols.senderText;
  if (!note.templateId && headerCols.templateId) patch.template = { connect: { id: headerCols.templateId } };
  if (!note.senderDocNo) patch.senderDocNo = headerCols.senderDocNo;
  if (!note.senderDocDate) patch.senderDocDate = headerCols.senderDocDate;
  if (!note.customerBatchNo) patch.customerBatchNo = headerCols.customerBatchNo;
  if (!note.customerOrderNo) patch.customerOrderNo = headerCols.customerOrderNo;
  if (!note.processText) patch.processText = headerCols.processText;
  if (note.declaredTopCount === null) patch.declaredTopCount = headerCols.declaredTopCount;
  if (note.pageCount === null && headerCols.pageCount !== null) patch.pageCount = headerCols.pageCount;
  if (note.senderCustomerId || !headerCols.senderCustomerId) return null;
  patch.senderCustomer = { connect: { id: headerCols.senderCustomerId } };
  return headerCols.senderCustomerId;
}

/**
 * Önceki sayfaların beyan blokları + yeni sayfanınkiler. Aynı blok no (devam sayfası) BİRLEŞİR: kimlik (parti/sipariş/yazan top)
 * önceki sayfadan korunur, beyan toplamı (T.Adet) yeni sayfada okunduysa onunki alınır — son sayfanın toplamı bölümün toplamıdır.
 */
function mergeDeclaredBlocks(prev: unknown[], next: Array<Record<string, unknown> & { blockNo: number }>): unknown[] {
  const out = [...prev];
  for (const b of next) {
    const i = out.findIndex((x) => typeof x === "object" && x !== null && (x as { blockNo?: unknown }).blockNo === b.blockNo);
    if (i < 0) { out.push(b); continue; }
    const old = out[i] as Record<string, unknown>;
    const has = (k: string) => b[k] !== null && b[k] !== undefined;
    out[i] = { ...old, ...(has("count") || has("m") || has("kg") ? { count: b.count ?? null, m: b.m ?? null, kg: b.kg ?? null } : {}), batchNo: old.batchNo ?? b.batchNo ?? null, orderNo: old.orderNo ?? b.orderNo ?? null, topCount: old.topCount ?? b.topCount ?? null };
  }
  return out;
}

/** Doldurma sonucu: eklenen satır sayısı + şablondan yazılan gönderen (audit künyesi; yoksa null). */
export interface FillResult {
  lines: number;
  autoSenderCustomerId: string | null;
}

/**
 * Bağlı DRAFT taslağa bir taramanın sonucunu yazar; ÇAĞIRAN aynı tx'te `{id, status: DRAFT}` claim'ini ÖNCE almıştır
 * (satır kilidi paralel sayfayı serileştirir; mevcut satırlar claim'in ARDINDAN okunur). Eklenen satır sayısını döner.
 * Çok sayfalı taslak: her sayfanın satırları EKLENİR (blok no kaydırılır, uyarılar birikir).
 */
export async function fillBoundDraftTx(tx: Prisma.TransactionClient, noteId: string, scan: { id: string; pageNo: number }, built: BuiltDraft): Promise<FillResult> {
  const { draft, headerCols } = built;
  const { header } = draft;
  const note = await tx.customerDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { ownerText: true, senderText: true, senderCustomerId: true, templateId: true, senderDocNo: true, senderDocDate: true, customerBatchNo: true, customerOrderNo: true, processText: true, declaredTopCount: true, pageCount: true, totalsDeclared: true, warnings: true, ourBatchNo: true, kursunMeters: true, kursunMetersSource: true } });
  const overlap = await linesToAppend(tx, noteId, scan, draft.lines);
  const agg = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId }, _max: { lineNo: true, blockNo: true } });
  const lineBase = agg._max.lineNo ?? 0;
  // Başlıksız başlayan sayfa (S1 devam): blok 1 satırları önceki sayfanın SON bölümüne eklenir (yeni parti doğmaz).
  const blockBase = Math.max(0, (agg._max.blockNo ?? 0) - (header.continuesPrevious && agg._max.blockNo ? 1 : 0));
  const prevWarnings = Array.isArray(note.warnings) ? note.warnings : [];
  const patch: Prisma.CustomerDeliveryNoteUpdateInput = { warnings: toJson([...prevWarnings, ...header.warnings, ...overlap.warnings]) };
  const autoSenderCustomerId = fillEmptyHeader(patch, note, headerCols);
  const addLines = overlap.lines.length > 0;
  const prevBlocks = (note.totalsDeclared as { blocks?: unknown[] } | null)?.blocks;
  if (note.totalsDeclared === null || !Array.isArray(prevBlocks)) patch.totalsDeclared = built.totalsDeclared;
  else if (addLines && lineBase > 0) {
    // Belge geneli beyan (ilk sayfanın başlığı) sonraki sayfada KORUNUR; ilk sayfada yoksa yeni sayfanınki alınır.
    const prevDoc = (note.totalsDeclared as { document?: unknown }).document ?? header.totalsDeclared.document;
    patch.totalsDeclared = toJson({ blocks: mergeDeclaredBlocks(prevBlocks, header.totalsDeclared.blocks.map((b) => ({ ...b, blockNo: blockBase + b.blockNo }))), ...(prevDoc ? { document: prevDoc } : {}) });
  }
  patch.templateScore = headerCols.templateScore;
  await fillBatchAndMeters(tx, noteId, note, { patch, built, added: overlap.lines, pageAppended: addLines && lineBase > 0 });
  if (addLines) patch.lines = { create: lineRows(overlap.lines, scan.id, lineBase, blockBase) };
  await tx.customerDeliveryNote.update({ where: { id: noteId }, data: patch });
  return { lines: addLines ? overlap.lines.length : 0, autoSenderCustomerId };
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

export type StoredReadOutcome = { scanId: string; sha256: string; mode: "REBUILT"; lines: number; autoSenderCustomerId: string | null } | { scanId: string; sha256: string; mode: "REQUEUED" };

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
      const filled = await fillBoundDraftTx(tx, noteId, { id: p.scanId, pageNo: p.pageNo }, p.built);
      out.push({ scanId: p.scanId, sha256: p.sha256, mode: "REBUILT", lines: filled.lines, autoSenderCustomerId: filled.autoSenderCustomerId });
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
      await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: noteId, newData: { source: "OCR_STORED", scanId: o.scanId, sha256: o.sha256, lineCount: o.lines, ...(o.autoSenderCustomerId ? { senderCustomerId: o.autoSenderCustomerId, senderFrom: "TEMPLATE" } : {}) } });
    } else {
      await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: o.scanId, oldData: { status: "READ" }, newData: { status: "PENDING", attempts: 0, noteId, reason: "STORED_RESULT_MISSING" } });
    }
  }
}
