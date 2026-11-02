// =============================================================================
// GELEN BELGE — istasyonda belgeden iş emri bulma (Gülkesim K17; fabrika cevabı 23 / 23-ek)
// =============================================================================
// Refakat kartı yok: boyahane belgesi kumaşla gezer. Kurşun / KK / tambur tableti belgenin fotoğrafını gönderir,
// sunucu EŞLEME OKUMASI yapar — DocumentScan, taslak, şablon satırı DOĞMAZ (okuma işi `buildDraft` değil, saf
// `extractDraft`). Gönderen belge no (+ sahip/gönderen metni) → canlı gelen belge → topları → iş emri(leri).
// Aynı fotoğraf (sha256) zaten taranmışsa OCR koşmaz: o taramanın belgesi ya da saklı okuması kullanılır.
// Elle arama (`q`) ve istasyon/panel liste araması aynı helper'dan (`workOrderDocSearchWhere`) beslenir.
// =============================================================================
import { DeliveryNoteStatus, type Prisma, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildTextSearch } from "../utils/query-parser";
import { TERIM } from "../constants/terim";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { readerOcr } from "../lib/gelen-belge/okuma-istemcisi";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { whereRollsOfWorkOrder, whereWorkOrdersOfRolls } from "./helpers/workorder-rolls.helper";
import { decodeScanUpload, PDF_MIME } from "./gelen-belge-scan.service";
import { extractDraft, ocrFromEnvelope } from "./gelen-belge-taslak-doldur.service";
import { readIncomingDocStationLookup, readProductionEnabled } from "./system-setting.service";

const IE = TERIM.terbiyeIsEmri;

/** Topu doğmuş (onaylı) belgeler — taslakta top yok, iptal edilen belge mükerrerden de eşlemeden de çıkar (K15). */
export const LOOKUP_NOTE_STATUSES: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.PARTIAL];
/** Belgede aranan KOD alanları: fiş/evrak no (gönderen belge no) · GB no · müşteri parti no · bizim parti no · sipariş no. */
export const NOTE_SEARCH_CODE_FIELDS = ["senderDocNo", "noteNo", "customerBatchNo", "ourBatchNo", "customerOrderNo"] as const;
/** Yanıt tavanı — tablet listesi; daha fazlası belge no'nun yanlış okunduğunu gösterir. */
const MAX_WORK_ORDERS = 20;

/** "Bu belge alanlarından birini taşıyan canlı belgenin topu bu iş emrinde" — liste aramasının belge dalı. */
export function workOrderDocSearchWhere(q: string): Prisma.WorkOrderWhereInput | null {
  const leaves = buildTextSearch<Prisma.CustomerDeliveryNoteWhereInput>(q, { code: NOTE_SEARCH_CODE_FIELDS });
  if (leaves.length === 0) return null;
  return whereWorkOrdersOfRolls({ deliveryNoteLine: { note: { status: { in: [...LOOKUP_NOTE_STATUSES] }, OR: leaves } } });
}

/** İstasyon iş listesi araması: İE no · parti no · belge alanları (kurşun + tambur açık kartları, elle arama). */
export function stationWorkSearchWhere(q: string): Prisma.WorkOrderWhereInput | null {
  const own = buildTextSearch<Prisma.WorkOrderWhereInput>(q, { code: ["workOrderNumber", "batches.some.batchNumber"] });
  const doc = workOrderDocSearchWhere(q);
  const ors = doc ? [...own, doc] : own;
  return ors.length > 0 ? { OR: ors } : null;
}

export type StationLookupOutcome = "SINGLE" | "MULTIPLE" | "NO_WORK_ORDER" | "NO_DOCUMENT" | "NO_DOC_NO" | "UNREADABLE";
export type StationLookupSource = "SAME_PHOTO" | "STORED_READ" | "OCR" | "SEARCH";

export interface StationLookupWorkOrder {
  readonly id: string;
  readonly workOrderNumber: string;
  readonly status: WorkOrderStatus;
  /** Tabletin mevcut kart çözümüne verilecek kod (aktif refakat kartı barkodu; yoksa İE no — tek kod). */
  readonly cardBarcode: string;
  readonly batchNumbers: string[];
  /** Bu İE'ye top vermiş canlı belgeler (GB no + gönderen belge no). */
  readonly documents: Array<{ noteNo: string; senderDocNo: string | null }>;
  readonly createdAt: Date;
}

export interface StationLookupResult {
  readonly outcome: StationLookupOutcome;
  readonly source: StationLookupSource;
  /** Okunan künye (fotoğraf yolunda); elle aramada null. */
  readonly read: { senderDocNo: string | null; ownerText: string | null; senderText: string | null } | null;
  readonly notes: Array<{ id: string; noteNo: string; senderDocNo: string | null; ownerName: string | null; senderName: string | null }>;
  readonly workOrders: StationLookupWorkOrder[];
  /** Türkçe: tabletin göstereceği sonuç cümlesi. */
  readonly message: string;
}

export async function stationLookupStatus(): Promise<{ enabled: boolean; readerConfigured: boolean }> {
  return { enabled: (await readIncomingDocStationLookup()) && (await readProductionEnabled()), readerConfigured: getReaderUrl().url !== null };
}

async function assertStationLookupEnabled(): Promise<void> {
  if (!(await readIncomingDocStationLookup())) {
    throw AppError.forbidden("İstasyonda belge okutma kapalı (Genel Ayarlar → Gelen Belge).", { code: "GELEN_BELGE_STATION_LOOKUP_DISABLED" });
  }
  if (!(await readProductionEnabled())) {
    throw AppError.forbidden(`Üretim modülü kapalı; ${IE.tekilKucuk} aranamaz.`, { code: "MODULE_DISABLED", module: "production" });
  }
}

export type StationLookupInput = { contentBase64: string; sha256?: string | null } | { q: string };

export async function stationDocLookup(input: StationLookupInput): Promise<StationLookupResult> {
  await assertStationLookupEnabled();
  if ("q" in input) return searchLookup(input.q);
  return photoLookup(input.contentBase64, input.sha256 ?? null);
}

async function searchLookup(q: string): Promise<StationLookupResult> {
  const where = stationWorkSearchWhere(q);
  const workOrders = where ? await loadWorkOrders(where, null) : [];
  return finish({ source: "SEARCH", read: null, notes: [], workOrders, noteCount: null });
}

async function photoLookup(contentBase64: string, sha256: string | null): Promise<StationLookupResult> {
  const upload = await decodeScanUpload(contentBase64, sha256);
  if (upload.mime === PDF_MIME) {
    throw AppError.badRequest("PDF belge okunmaz; belgenin fotoğrafını çekin.", { code: "DOCUMENT_SCAN_PDF_NOT_READABLE" });
  }
  // Aynı fotoğraf daha önce yüklendiyse OCR koşmaz (okuma belirlenimli değil; aynı bayt aynı belgedir).
  const known = await prisma.documentScan.findUnique({
    where: { sha256: upload.sha256 },
    select: { ocrResult: true, note: { select: { id: true, status: true, senderDocNo: true, ownerText: true, senderText: true } } },
  });
  if (known?.note && LOOKUP_NOTE_STATUSES.includes(known.note.status)) {
    const notes = await loadNotes({ id: known.note.id });
    const read = { senderDocNo: known.note.senderDocNo, ownerText: known.note.ownerText, senderText: known.note.senderText };
    return finish({ source: "SAME_PHOTO", read, notes, workOrders: await workOrdersOfNotes(notes), noteCount: notes.length });
  }
  const stored = known ? ocrFromEnvelope(known.ocrResult) : null;
  let source: StationLookupSource = "STORED_READ";
  let ocr = stored;
  if (!ocr) {
    const url = getReaderUrl().url;
    if (!url) throw new AppError("Okuma servisi bu kurulumda yok; fiş no ile elle arayın.", 503, true, { code: "OCR_SERVICE_UNAVAILABLE" });
    const r = await readerOcr(url, upload.content, upload.mime);
    if (!r.ok) {
      if (r.kind === "UNAVAILABLE") throw new AppError("Okuma servisine ulaşılamadı; fiş no ile elle arayın.", 503, true, { code: "OCR_SERVICE_UNAVAILABLE" });
      return finish({ source: "OCR", read: null, notes: [], workOrders: [], noteCount: null, unreadable: true });
    }
    ocr = r.result;
    source = "OCR";
  }
  const { header } = await extractDraft(ocr);
  const read = { senderDocNo: header.senderDocNo, ownerText: header.ownerText, senderText: header.senderText };
  const docNo = header.senderDocNo?.trim();
  if (!docNo) return finish({ source, read, notes: [], workOrders: [], noteCount: null, noDocNo: true });
  const templateCode = header.regions[0]?.templateId ?? null;
  const notes = narrowNotes(await loadNotes({ senderDocNo: { equals: docNo, mode: "insensitive" } }), read, await templateSenderId(templateCode));
  return finish({ source, read, notes, workOrders: await workOrdersOfNotes(notes), noteCount: notes.length });
}

const NOTE_SELECT = {
  id: true, noteNo: true, senderDocNo: true, ownerText: true, senderText: true, senderCustomerId: true,
  ownerCustomer: { select: { name: true } }, senderCustomer: { select: { name: true } },
} satisfies Prisma.CustomerDeliveryNoteSelect;
type NoteRow = Prisma.CustomerDeliveryNoteGetPayload<{ select: typeof NOTE_SELECT }>;

function loadNotes(where: Prisma.CustomerDeliveryNoteWhereInput): Promise<NoteRow[]> {
  return prisma.customerDeliveryNote.findMany({
    where: { AND: [where, { status: { in: [...LOOKUP_NOTE_STATUSES] } }] },
    select: NOTE_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_WORK_ORDERS,
  });
}

async function templateSenderId(code: string | null): Promise<string | null> {
  if (!code) return null;
  const t = await prisma.senderTemplate.findUnique({ where: { code }, select: { isActive: true, senderCustomerId: true } });
  return t?.isActive ? t.senderCustomerId : null;
}

/**
 * Aynı gönderen belge no'yu birden çok belge taşıyorsa (farklı sahip/gönderen) okunan künyeyle daralt: şablonun bağlı
 * göndereni → okunan sahip metni → okunan gönderen metni. Her adım yalnız boş olmayan bir alt küme bırakırsa uygulanır;
 * daraltılamayan küme olduğu gibi döner (tablet seçtirir) — yanlış belgeyi sessizce seçmekten iyidir.
 */
export function narrowNotes<T extends Pick<NoteRow, "senderCustomerId" | "ownerText" | "senderText" | "ownerCustomer" | "senderCustomer">>(
  notes: T[],
  read: { ownerText: string | null; senderText: string | null },
  templateSender: string | null,
): T[] {
  let out = notes;
  const keep = (pred: (n: T) => boolean) => {
    const sub = out.filter(pred);
    if (sub.length > 0 && sub.length < out.length) out = sub;
  };
  if (out.length > 1 && templateSender) keep((n) => n.senderCustomerId === templateSender);
  const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && foldNameForCompare(a) === foldNameForCompare(b);
  if (out.length > 1 && read.ownerText) keep((n) => same(n.ownerText, read.ownerText) || same(n.ownerCustomer?.name, read.ownerText));
  if (out.length > 1 && read.senderText) keep((n) => same(n.senderText, read.senderText) || same(n.senderCustomer?.name, read.senderText));
  return out;
}

function workOrdersOfNotes(notes: NoteRow[]): Promise<StationLookupWorkOrder[]> {
  if (notes.length === 0) return Promise.resolve([]);
  const noteIds = notes.map((n) => n.id);
  return loadWorkOrders(whereWorkOrdersOfRolls({ deliveryNoteLine: { noteId: { in: noteIds } } }), noteIds);
}

/** İptal edilmemiş, arşivlenmemiş İE'ler; `noteIds` verilirse belge listesi o belgelerle sınırlanır. */
async function loadWorkOrders(where: Prisma.WorkOrderWhereInput, noteIds: string[] | null): Promise<StationLookupWorkOrder[]> {
  const rows = await prisma.workOrder.findMany({
    where: { AND: [where, { status: { not: WorkOrderStatus.CANCELLED }, isActive: true }] },
    select: {
      id: true, workOrderNumber: true, status: true, createdAt: true,
      travelerCards: { where: { status: "ACTIVE" }, select: { barcode: true }, take: 1 },
      batches: { select: { batchNumber: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_WORK_ORDERS,
  });
  const out: StationLookupWorkOrder[] = [];
  // İE başına tek sorgu (≤ 20): hangi belgeler bu İE'ye top verdi — bağ tanımı `whereRollsOfWorkOrder`dan.
  for (const w of rows) {
    const docs = await prisma.customerDeliveryNote.findMany({
      where: { status: { in: [...LOOKUP_NOTE_STATUSES] }, ...(noteIds ? { id: { in: noteIds } } : {}), lines: { some: { roll: whereRollsOfWorkOrder(w.id) } } },
      select: { noteNo: true, senderDocNo: true },
      orderBy: { noteNo: "asc" },
      take: 5,
    });
    out.push({
      id: w.id, workOrderNumber: w.workOrderNumber, status: w.status, createdAt: w.createdAt,
      cardBarcode: w.travelerCards[0]?.barcode ?? w.workOrderNumber,
      batchNumbers: [...new Set(w.batches.map((b) => b.batchNumber))],
      documents: docs,
    });
  }
  return out;
}

function finish(p: {
  source: StationLookupSource;
  read: StationLookupResult["read"];
  notes: NoteRow[];
  workOrders: StationLookupWorkOrder[];
  noteCount: number | null;
  unreadable?: boolean;
  noDocNo?: boolean;
}): StationLookupResult {
  const notes = p.notes.map((n) => ({ id: n.id, noteNo: n.noteNo, senderDocNo: n.senderDocNo, ownerName: n.ownerCustomer?.name ?? null, senderName: n.senderCustomer?.name ?? null }));
  const base = { source: p.source, read: p.read, notes, workOrders: p.workOrders };
  if (p.unreadable) return { ...base, outcome: "UNREADABLE", message: "Belge okunamadı; fiş no ile elle arayın." };
  if (p.noDocNo) return { ...base, outcome: "NO_DOC_NO", message: "Belgede fiş/evrak numarası okunamadı; fiş no ile elle arayın." };
  if (p.noteCount === 0) return { ...base, outcome: "NO_DOCUMENT", message: `Bu numarayla kayıtlı gelen belge yok (${p.read?.senderDocNo ?? ""}); fiş no ile elle arayın.` };
  if (p.workOrders.length === 0) {
    return { ...base, outcome: "NO_WORK_ORDER", message: p.source === "SEARCH" ? `Aramaya uyan ${IE.tekilKucuk} yok.` : `Bu belgeye ait ${IE.tekilKucuk} yok.` };
  }
  if (p.workOrders.length === 1) return { ...base, outcome: "SINGLE", message: `${IE.tekil} bulundu: ${p.workOrders[0]!.workOrderNumber}` };
  return { ...base, outcome: "MULTIPLE", message: `${p.workOrders.length} ${IE.tekilKucuk} bulundu; açılacak olanı seçin.` };
}
