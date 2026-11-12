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
import { suggestOwnerForNote } from "./gelen-belge-sahip-onerisi.service";
import { cariHoldNotice } from "./helpers/cari-hold.helper";
import { DeliveryNoteStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { resolveRangeEnd, resolveRangeStart } from "../constants/time";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { p2002Mentions } from "../utils/p2002";
import { decodeOffsetCursor, encodeOffsetCursor } from "../utils/cursor";
import { readIdCondition } from "../utils/query-parser";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { reserveSeriesNo } from "./helpers/series-counter-store.helper";
import { PDF_MIME, SCAN_SELECT } from "./gelen-belge-scan.service";
import { applyStoredReadsTx, auditPhotoSource, auditStoredReads, markPhotoSourceTx, prepareStoredReads, type StoredReadOutcome } from "./gelen-belge-taslak-doldur.service";
import { LINE_SELECT, lineColumns, notDraft, text, type DeliveryNoteLineInput } from "./gelen-belge-line.service";
import { hasDocumentDeclared, isSummaryLine, lineItemFallback, lineProblems, perDocumentGate, totalsCheck } from "./gelen-belge-kontrol.service";
import { batchAndMeterColumns, type DeliveryNoteHeaderPatch } from "./gelen-belge-baslik-alan.service";
import { resolveEffectiveDefaultItem, usableDefaultItem } from "./gelen-belge-varsayilan.service";
import { noteNotices } from "../lib/gelen-belge/uyari";
import { sameBatchNotes } from "./gelen-belge-parti-tekrar.service";
import { readDocumentTotalCheck, readDuplicateDocNoMode, readIncomingDocEntryMode, readPhotoRetention, readUnreviewedApprovalMode } from "./system-setting.service";
import { assertDocNoUniqueTx, duplicateDocNoNotice, lockDocNosTx } from "./helpers/gelen-belge-mukerrer.helper";
import { noteBatchAndMeters } from "./gelen-belge-parti-metre.service";
import { serverReaderState } from "./gelen-belge-sunucu-okuyucu.service";
import { noteTanitim } from "./gelen-belge-tanitim-guveni.service";
import { noteTanima } from "./gelen-belge-tanima-ozeti.service";
import { withDocLineCount } from "./gelen-belge-satir-sayim.service";
import { withNoteWorkOrders } from "./gelen-belge-liste-is-emri.service";
import type { DeliveryNoteCreateInput, DeliveryNoteHeaderInput, DeliveryNoteListQuery } from "./gelen-belge-note-types";

const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const SERIES_KEY = "customerDeliveryNote";

export type { DeliveryNoteHeaderPatch } from "./gelen-belge-baslik-alan.service";
export { addDeliveryNoteLines, deleteDeliveryNoteLine, updateDeliveryNoteLine, type DeliveryNoteLineInput } from "./gelen-belge-line.service";
// Durum kümesi Prisma enum'undan TÜRETİLİR (elle kopya bayatlar; D4 yeni değer eklerse tek yer).
export const DELIVERY_NOTE_STATUSES = Object.values(DeliveryNoteStatus) as readonly DeliveryNoteStatus[];

export type { DeliveryNoteCreateInput, DeliveryNoteHeaderInput, DeliveryNoteListQuery } from "./gelen-belge-note-types";

// ── Seçimler ────────────────────────────────────────────────────────────────
const HEADER_SELECT = {
  id: true, noteNo: true, status: true, sourceKind: true, ownerCustomerId: true, senderCustomerId: true, senderText: true,
  senderDocNo: true, senderDocDate: true, customerBatchNo: true, customerOrderNo: true, processText: true, templateId: true, templateScore: true,
  ourBatchNo: true, ourBatchNoKey: true, kursunMeters: true, kursunMetersSource: true, kursunMetersReview: true,
  pageCount: true, declaredTopCount: true, totalsDeclared: true, varianceReason: true, warnings: true, approvedAt: true,
  approvedById: true, cancelledAt: true, cancelledById: true, cancelReason: true, clientToken: true, createdAt: true,
  updatedAt: true, createdById: true, updatedById: true,
  ownerCustomer: { select: { id: true, code: true, name: true } },
  senderCustomer: { select: { id: true, code: true, name: true } },
  _count: { select: { lines: true, scans: true } },
} as const;
const DETAIL_SELECT = {
  ...HEADER_SELECT,
  // ocrRaw yalnız şüpheli işareti (`lineProblems` SUSPECT_VALUE) için okunur; yanıta konmaz.
  lines: { select: { ...LINE_SELECT, ocrRaw: true }, orderBy: [{ blockNo: "asc" }, { lineNo: "asc" }] },
  scans: { select: SCAN_SELECT, orderBy: [{ pageNo: "asc" }, { regionNo: "asc" }] },
} satisfies Prisma.CustomerDeliveryNoteSelect;

/** Audit yükü: yalnız başlık künyesi (JSON beyan/uyarı alanları hariç; fotoğraf/OCR zaten burada yok). */
function auditHeader(n: { noteNo: string; status: string; sourceKind: string; ownerCustomerId: string | null; senderCustomerId: string | null; senderText: string | null; senderDocNo: string | null; senderDocDate: Date | null; customerBatchNo: string | null; customerOrderNo: string | null; processText: string | null; pageCount: number | null; declaredTopCount: number | null; ourBatchNo?: string | null; ourBatchNoKey?: string | null; kursunMeters?: Prisma.Decimal | null; kursunMetersSource?: string | null; kursunMetersReview?: boolean }) {
  // Parti no / kurşun metresi yalnız PATCH görüntüsünde seçilir (yaratma yükü bugünkü gibi kalır).
  const extra = n.kursunMetersReview === undefined ? {} : {
    ourBatchNo: n.ourBatchNo ?? null, ourBatchNoKey: n.ourBatchNoKey ?? null, kursunMeters: n.kursunMeters?.toString() ?? null,
    kursunMetersSource: n.kursunMetersSource ?? null, kursunMetersReview: n.kursunMetersReview,
  };
  return {
    ...extra,
    noteNo: n.noteNo, status: n.status, sourceKind: n.sourceKind, ownerCustomerId: n.ownerCustomerId, senderCustomerId: n.senderCustomerId,
    senderText: n.senderText, senderDocNo: n.senderDocNo, senderDocDate: n.senderDocDate ? n.senderDocDate.toISOString().slice(0, 10) : null,
    customerBatchNo: n.customerBatchNo, customerOrderNo: n.customerOrderNo, processText: n.processText, pageCount: n.pageCount, declaredTopCount: n.declaredTopCount,
  };
}
export function parseDay(v: string | null | undefined): Date | null {
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
    customerOrderNo: text(input.customerOrderNo),
    processText: text(input.processText),
    pageCount: input.pageCount ?? null,
    declaredTopCount: input.declaredTopCount ?? null,
    totalsDeclared: input.totalsDeclared === undefined ? undefined : input.totalsDeclared === null ? Prisma.JsonNull : (input.totalsDeclared as Prisma.InputJsonObject),
  };
}

/** Mükerrer gönderen belge numarası (partial unique) → operatöre anlamlı 409. */
export function translateUnique(err: unknown): never {
  // Hedef okuma TEK yardımcıdan (pg adaptörü `meta.target` vermez — `p2002.ts` başlığı).
  if (p2002Mentions(err, /owner_sender_doc|senderDocNo/)) {
    throw AppError.conflict("Bu sahip için aynı gönderen belge numarasıyla açık bir taslak/belge zaten var.", { code: "DELIVERY_NOTE_DUPLICATE_DOC_NO" });
  }
  throw err;
}

// ── Okuma ───────────────────────────────────────────────────────────────────
/** `readerConfigured` = sunucu okuyucusu bu an kullanılabilir (adres + ayar); `serverOcrEnabled` = panel ayarının kendisi. */
async function readerFlags(): Promise<{ readerConfigured: boolean; serverOcrEnabled: boolean }> {
  const r = await serverReaderState();
  return { readerConfigured: r.url !== null, serverOcrEnabled: r.enabled };
}

export async function getDeliveryNote(id: string) {
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!note) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  // Cari kilidi önizlemesi (D4-I1, INTAKE): onay kapısıyla aynı helper; kilit yoksa null. Eski istemci alanı yok sayar.
  const cariHold = note.ownerCustomerId ? await cariHoldNotice(prisma, note.ownerCustomerId, "INTAKE") : null;
  // Gözden geçirme: onay kapısının AYNI yüklemleri (satır `problems`, toplam `totalsCheck`) — panel yeniden hesaplamaz.
  // Varsayılan ürün onayla AYNI yüklemden: onunla doğacak satır sorunlu değil, `itemFallback` bilgisi taşır (eski istemci yok sayar).
  const fallback = note.lines.some((l) => !l.itemId) ? usableDefaultItem(await resolveEffectiveDefaultItem(note.ownerCustomerId)) : null;
  // `summary`: onayda doğan parti kaydı (özet satırı) — panel belgenin satırlarından ayrı çizer; eski istemci yok sayar.
  const lines = note.lines.map(({ ocrRaw, ...l }) => ({ ...l, summary: isSummaryLine(note.id, l), problems: lineProblems({ ...l, ocrRaw }, fallback), itemFallback: lineItemFallback(l, fallback) }));
  // Taslak uyarıları (okuma özetiyle AYNI helper): eski istemci alanı yok sayar.
  // Aynı müşteri partisinin başka belgeleri (bilgi, engel değil); eski istemci alanı yok sayar.
  const sameBatch = await sameBatchNotes(note);
  // Belge geneli kip onayla AYNI okuyucudan; beyansız belgede ayar okunmaz.
  const documentMode = hasDocumentDeclared(note.totalsDeclared) ? await readDocumentTotalCheck() : "INFO";
  // Belge başına tek kayıt kipi: onayın AYNI kapı yüklemi (yalnız kip açıkken anahtar doğar — PER_LINE yanıtı bugünkü gibi).
  const perDocument = (await readIncomingDocEntryMode()) === "PER_DOCUMENT" ? { gate: perDocumentGate(note, note.kursunMetersReview ? await readUnreviewedApprovalMode() : "WARN") } : null;
  // Parti no adayları + kurşun metre adayları CANLI (saklanmaz); eski istemci alanları yok sayar.
  // "Satır toplamı" toplam kıyasıyla AYNI küme: onayda INFO'ya dönen belge satırları sayılır, onayda doğan özet satırı
  // (kurşun metresinin kendisi) sayılmaz — aksi halde onaydan sonra sayı belgenin satırlarından kopuyordu.
  // Güven kipi okuma özetiyle AYNI (`noteTanitim`): tablet detayı tercih eder; süzgeçsiz aday listesi SORMA'yı delerdi.
  const { trust } = await noteTanitim(note.id);
  const batchMeters = await noteBatchAndMeters(note.id, note.totalsDeclared, note.lines.filter((l) => l.status !== "SKIPPED" && !isSummaryLine(note.id, l)).map((l) => l.meters), trust);
  // Tanıma kartı (2026-11-09): okuma özetiyle AYNI blok; okunmuş sayfa yoksa alan yok. Eski panel yok sayar.
  const tanima = await noteTanima(note.id, trust);
  // Müşteri önerisi (OIE): okunan metinde yazan cari; yalnız sahipsiz taslakta, aksi null. Eski istemci alanı yok sayar.
  const ownerSuggestion = await suggestOwnerForNote(note);
  // `readerConfigured`: okuyucu tanımsız kurulumda bekleyen sayfa hiç okunmaz → panel "okunuyor"da beklemez, formu elle doldurtur.
  // K27 (WARN kipi) `duplicateDocNo`: aynı belge no'lu İŞİ SÜREN eşler — bilgi şeridi; yoksa null. Eski istemci yok sayar.
  // K28: onay ekranı kip FULL değilse belge no'yu vurgular ("fotoğraf küçültülecek/silinecek"); eski istemci yok sayar.
  return { ...note, duplicateDocNo: await duplicateDocNoNotice(note), lines, totalsCheck: totalsCheck(note, note.lines, { documentMode }), notices: noteNotices(note.warnings), cariHold, sameBatch, ...batchMeters, ...(perDocument ? { perDocument: perDocument.gate } : {}), ownerSuggestion, ...(tanima ? { tanima } : {}), ...(await readerFlags()), photoRetention: await readPhotoRetention() };
}

/** Liste where'i — özet şeridi de BUNDAN türer (durum süzgeci hariç; şerit duruma göre sayar). */
export function buildDeliveryNoteBaseWhere(q: DeliveryNoteListQuery): Prisma.CustomerDeliveryNoteWhereInput {
  const where: Prisma.CustomerDeliveryNoteWhereInput = {};
  const owner = readIdCondition(q.ownerCustomerId);
  if (owner) where.ownerCustomerId = owner;
  const sender = readIdCondition(q.senderCustomerId);
  if (sender) where.senderCustomerId = sender;
  if (q.sourceKind) where.sourceKind = q.sourceKind;
  // Gün sınırı TEK kaynaktan (fabrika dilimi, dönem tablosu dahil) — `new Date("YYYY-MM-DD")` UTC gece yarısıdır.
  if (q.from || q.to) {
    const range: Prisma.DateTimeFilter = {};
    if (q.from) range.gte = resolveRangeStart(q.from);
    if (q.to) range.lte = resolveRangeEnd(q.to);
    if ([range.gte, range.lte].some((d) => d instanceof Date && Number.isNaN(d.getTime()))) {
      throw AppError.badRequest("Tarih süzgeci geçersiz (YYYY-AA-GG).", { code: "INVALID_DATE_RANGE" });
    }
    where.createdAt = range;
  }
  const term = q.q?.trim();
  if (term) {
    where.OR = [
      { noteNo: { contains: term, mode: "insensitive" } },
      { senderDocNo: { contains: term, mode: "insensitive" } },
      { senderText: { contains: term, mode: "insensitive" } },
      { customerBatchNo: { contains: term, mode: "insensitive" } }, { customerOrderNo: { contains: term, mode: "insensitive" } },
      { lines: { some: { customerBatchNo: { contains: term, mode: "insensitive" } } } }, // çok partide parti no satırda yaşar
    ];
  }
  return where;
}

/** Liste özet şeridinin durum sayımı — açılış panosunun "onay bekleyen" kutusu da bunu okur (tek kaynak). */
export async function deliveryNoteStatusSummary(base: Prisma.CustomerDeliveryNoteWhereInput): Promise<Record<DeliveryNoteStatus, number>> {
  const grouped = await prisma.customerDeliveryNote.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  return Object.fromEntries(DELIVERY_NOTE_STATUSES.map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0])) as Record<DeliveryNoteStatus, number>;
}

export async function listDeliveryNotes(q: DeliveryNoteListQuery) {
  const base = buildDeliveryNoteBaseWhere(q);
  const where: Prisma.CustomerDeliveryNoteWhereInput = q.status ? { AND: [base, { status: q.status }] } : base;
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = decodeOffsetCursor(q.cursor);
  const rows = await prisma.customerDeliveryNote.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: offset, take: limit + 1, select: HEADER_SELECT });
  const page = rows.slice(0, limit);
  const summary = await deliveryNoteStatusSummary(base);
  // `docLineCount`: özet satırı hariç belge satırı ("Top"; eski istemci `_count.lines`) · `workOrders`: bağlı İE'ler (eski istemci yok sayar).
  return {
    items: await withNoteWorkOrders(await withDocLineCount(page)),
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

/**
 * Sayaç satırlı seri (`reserveSeriesNo`): taslak SİLİNEBİLİR (hard delete) — tarama
 * "max + 1" en son taslak silinince aynı numarayı yeniden verirdi (G3f, GB0111260006).
 * Satır yalnız ilerler; silinen numara boşta kalır. ⚠️ tx DIŞINDA çağrılır.
 */
export async function nextNoteNo(): Promise<string> {
  return reserveSeriesNo(
    SERIES_KEY,
    new Date(),
    async (prefix) =>
      prisma.customerDeliveryNote.findMany({
        where: { noteNo: { gte: prefix, startsWith: prefix } },
        select: { noteNo: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }).then((rows) => rows.map((r) => ({ code: r.noteNo, createdAt: r.createdAt }))),
    async (code) => (await prisma.customerDeliveryNote.findUnique({ where: { noteNo: code }, select: { id: true } })) !== null,
  );
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
    // Okunmuş serbest tarama (taslağı silinmiş fotoğraf) satırlarını saklı zarftan getirir — tx DIŞINDA hazırlanır.
    const plans = await prepareStoredReads(scanIds, userId);
    const photoBound = scanIds.length > 0 && (await prisma.documentScan.count({ where: { id: { in: scanIds }, mimeType: { not: PDF_MIME } } })) > 0;
    let restored: StoredReadOutcome[] = [];
    let sourceMarked = false;
    // K27 BLOCK: başlığın ve saklı okumaların yazabileceği belge no'ları 8044 kilidi altında (tx'in İLK ifadesi).
    const [dupMode, docNoKeys] = [await readDuplicateDocNoMode(), [header.senderDocNo, ...plans.map((p) => p.built?.headerCols.senderDocNo)]];
    // Numara doğuşta; sayaç türetilmiş → P2002 yarışında yeniden dene (reçete § Yeni numara serisi).
    const created = await withBarcodeRetry(async () => {
      const noteNo = await nextNoteNo();
      return prisma.$transaction(async (tx) => {
        await lockDocNosTx(tx, dupMode, docNoKeys);
        const row = await tx.customerDeliveryNote.create({
          data: {
            ...header, noteNo, sourceKind: input.sourceKind, clientToken: input.clientToken ?? null,
            createdById: userId, updatedById: userId,
            lines: lines.length ? { create: lines } : undefined,
          },
          select: { ...PRIOR_SELECT, sourceKind: true, senderText: true, senderDocDate: true, customerBatchNo: true, customerOrderNo: true, processText: true, pageCount: true, declaredTopCount: true, senderCustomerId: true },
        });
        if (scanIds.length) {
          const bound = await tx.documentScan.updateMany({ where: { id: { in: scanIds }, noteId: null }, data: { noteId: row.id } });
          if (bound.count !== scanIds.length) {
            throw AppError.conflict("Taramalardan biri bu arada başka bir taslağa bağlandı.", { code: "DOCUMENT_SCAN_NOT_FREE" });
          }
          sourceMarked = photoBound ? await markPhotoSourceTx(tx, row.id) : false;
          restored = await applyStoredReadsTx(tx, row.id, plans);
        }
        await assertDocNoUniqueTx(tx, row.id, dupMode, docNoKeys);
        return row;
      });
    }, undefined, (err) => p2002TargetsCode(err, "noteNo"), "Gelen belge numarası").catch(translateUnique);
    await AuditService.log({ userId, action: "CREATE", tableName: NOTE_TABLE, recordId: created.id, newData: { ...auditHeader(created), lineCount: lines.length, scanCount: scanIds.length } });
    if (sourceMarked) await auditPhotoSource(created.id, userId);
    await auditStoredReads(created.id, restored, userId);
    return getDeliveryNote(created.id);
  });
}

/** Başlık düzeltme — yalnız DRAFT; atomik claim (count 0 → 404/409). */
export async function updateDeliveryNote(id: string, patch: DeliveryNoteHeaderPatch, userId: string) {
  const before = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: HEADER_AUDIT_SELECT });
  if (!before) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  // Yalnız patch'te TANIMLI anahtarlar yazılır (undefined → dokunma): farklı alanları düzenleyen iki yazar
  // (tablet başlık · panel gözden geçirme) birbirini bayat anlık görüntüyle EZMEZ; sahip/gönderen doğrulaması
  // da yalnız anahtar patch'teyse koşar (pasifleşmiş sahip ilgisiz düzeltmeyi 400'e düşürmez).
  const cols = patchColumns(await headerColumns(patch), patch);
  const extra = batchAndMeterColumns(patch, before);
  // Onay-yalnız metre işareti (değer değişmeden) yarışta başka metreyi onaylamasın: claim mevcut metreye bağlanır.
  const meterGuard = patch.kursunMetersReviewed && patch.kursunMeters === undefined ? { kursunMeters: before.kursunMeters } : {};
  const write = (client: Pick<typeof prisma, "customerDeliveryNote">) => client.customerDeliveryNote.updateMany({ where: { id, status: "DRAFT", ...meterGuard }, data: { ...cols, ...extra, updatedById: userId } });
  // K27 BLOCK: sahip ya da belge no değişiyorsa 8044 kilidi (tx'in İLK ifadesi) + yazımdan sonra gerçek çiftle kontrol.
  const dupMode = patch.ownerCustomerId !== undefined || patch.senderDocNo !== undefined ? await readDuplicateDocNoMode() : null;
  const docNoKey = patch.senderDocNo !== undefined ? text(patch.senderDocNo) : before.senderDocNo;
  const res = dupMode === "BLOCK" ? await prisma.$transaction(async (tx) => {
    await lockDocNosTx(tx, dupMode, [docNoKey]);
    const r = await write(tx);
    return r.count === 1 ? assertDocNoUniqueTx(tx, id, dupMode, [docNoKey]).then(() => r) : r;
  })
    : await write(prisma).catch(translateUnique);
  if (res.count === 0) await notDraft(id);
  const after = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id }, select: HEADER_AUDIT_SELECT });
  await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: id, oldData: auditHeader(before), newData: auditHeader(after) });
  return getDeliveryNote(id);
}

const HEADER_AUDIT_SELECT = { ...PRIOR_SELECT, sourceKind: true, senderText: true, senderDocDate: true, customerBatchNo: true, customerOrderNo: true, processText: true, pageCount: true, declaredTopCount: true, senderCustomerId: true, ourBatchNo: true, ourBatchNoKey: true, kursunMeters: true, kursunMetersSource: true, kursunMetersReview: true } as const;

/** Tam kolon kümesinden yalnız patch'te tanımlı anahtarları bırakır (kısmi güncelleme; kayıp güncelleme yok). */
function patchColumns<T extends Record<string, unknown>>(full: T, patch: DeliveryNoteHeaderInput): Partial<T> {
  return Object.fromEntries(Object.entries(full).filter(([k]) => patch[k as keyof DeliveryNoteHeaderInput] !== undefined)) as Partial<T>;
}

/** Silinebilir mi — tekil ve toplu silmenin (önizleme dahil) TEK yüklemi; claim WHERE'i aynı değeri taşır. */
export const NOTE_DELETE_STATUS = "DRAFT" as const satisfies DeliveryNoteStatus;
export const isDeletableNoteStatus = (s: DeliveryNoteStatus): boolean => s === NOTE_DELETE_STATUS;

/**
 * ④ Deftere hiç yazmamış taslak — fiziksel silme (`docs/kurallar/defter.md` § Hard delete).
 * Taramalar silinmez, taslaktan ÇÖZÜLÜR (fotoğraf izi kalır, yeniden kullanılabilir); satırlar Cascade.
 */
export async function deleteDeliveryNote(id: string, userId: string): Promise<{ id: string; noteNo: string }> {
  const before = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { ...PRIOR_SELECT, sourceKind: true, senderText: true, senderDocDate: true, customerBatchNo: true, customerOrderNo: true, processText: true, pageCount: true, declaredTopCount: true, senderCustomerId: true } });
  if (!before) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  if (!isDeletableNoteStatus(before.status)) await notDraft(id);
  await prisma.$transaction(async (tx) => {
    // Çözme önce (FK Restrict); claim kaybedilirse tx geri sarar, taramalar bağlı kalır.
    await tx.documentScan.updateMany({ where: { noteId: id }, data: { noteId: null } });
    const gone = await tx.customerDeliveryNote.deleteMany({ where: { id, status: NOTE_DELETE_STATUS } });
    if (gone.count === 0) await notDraft(id);
  });
  void AuditService.log({ userId, action: "DELETE", tableName: NOTE_TABLE, recordId: id, oldData: auditHeader(before) });
  return { id, noteNo: before.noteNo };
}

