// =============================================================================
// GELEN BELGE — istasyonda belgeden iş emri bulma (Gülkesim K17; fabrika cevabı 23 / 23-ek)
// =============================================================================
// Refakat kartı yok: boyahane belgesi kumaşla gezer. Kurşun / KK / tambur tableti belgenin fotoğrafını gönderir,
// sunucu EŞLEME OKUMASI yapar — DocumentScan, taslak, şablon satırı DOĞMAZ (okuma işi `buildDraft` değil, saf
// `extractDraft`). Gönderen belge no (+ sahip/gönderen metni) → canlı gelen belge → topları → iş emri(leri).
// Aynı fotoğraf (sha256) zaten taranmışsa OCR koşmaz: o taramanın belgesi ya da saklı okuması kullanılır.
// K30-E: belge no tutmazsa / okunamazsa (kullanıcı şablonunda Evrak No atanmamış) okunan PARTİ NO açık iş emirlerinde
// aranır; iki yol da OCR'a toleranslı karşılaştırmayı `helpers/doc-code-match.helper.ts`ten alır.
// Elle arama (`q`) ve istasyon/panel liste araması aynı helper'dan (`workOrderDocSearchWhere`) beslenir.
// Çok İE (2026-11-06): tablet ekranını bildirirse her İE "burada bekliyor mu" (ekranın açık kart listesinin yüklemi,
// `helpers/station-open-step.helper.ts`) + şu an nerede ile döner; satır yükleme ve sınıflama `helpers/station-lookup-rows.helper.ts`.
// =============================================================================
import { type Prisma, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { readerOcr } from "../lib/gelen-belge/okuma-istemcisi";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { whereWorkOrdersOfRolls } from "./helpers/workorder-rolls.helper";
import { LOOKUP_NOTE_STATUSES, stationWorkSearchWhere } from "./helpers/workorder-doc-search.helper";
import { decodeScanUpload, PDF_MIME } from "./gelen-belge-scan.service";
import { extractDraft, ocrFromEnvelope } from "./gelen-belge-taslak-doldur.service";
import { readIncomingDocStationLookup, readProductionEnabled, SETTING_KEYS } from "./system-setting.service";
import { licenseModuleError } from "../lib/license/module-ceiling";
import { latestScanBySha, NOTE_WORK_ONGOING_WHERE } from "./helpers/gelen-belge-mukerrer.helper";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { type CodeMatchTier, matchCodes } from "./helpers/doc-code-match.helper";
import { uyari } from "../lib/logger";
import type { DraftHeader } from "../lib/gelen-belge/taslak";
import type { StationScreen } from "./helpers/station-open-step.helper";
import {
  type LoadedWorkOrders, loadWorkOrders, markAtStation, MAX_WORK_ORDERS, type StationLookupContext, stationLabel, type StationLookupWorkOrder,
} from "./helpers/station-lookup-rows.helper";

export type { AtStation, StationLookupContext, StationLookupWorkOrder } from "./helpers/station-lookup-rows.helper";
export { stationLookupContext } from "./helpers/station-lookup-rows.helper";

/** Parti no yedeği ve toleranslı belge no yalnız AÇIK iş emrine bakar (bitmiş / devredilmiş / iptal eşleşmez). */
const OPEN_WORK_ORDER_STATUSES: WorkOrderStatus[] = [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS];
/**
 * Toleranslı karşılaştırmanın bellekteki aday evreni tavanı (işi süren belge kodları / açık parti no'ları). Tam eşleşme
 * evrenden ÖNCE DB'de aranır (tavana bağlı değil); tavan dolarsa uyarı loglanır — kesilen evren sessiz kalmaz.
 */
const TOLERANT_UNIVERSE_CAP = 2000;

export type StationLookupOutcome = "SINGLE" | "MULTIPLE" | "NO_WORK_ORDER" | "NO_DOCUMENT" | "NO_DOC_NO" | "UNREADABLE";
export type StationLookupSource = "SAME_PHOTO" | "STORED_READ" | "OCR" | "SEARCH";


export interface StationLookupResult {
  readonly outcome: StationLookupOutcome;
  readonly source: StationLookupSource;
  /** Okunan künye (fotoğraf yolunda); elle aramada null. */
  readonly read: { senderDocNo: string | null; ownerText: string | null; senderText: string | null } | null;
  readonly notes: Array<{ id: string; noteNo: string; senderDocNo: string | null; ownerName: string | null; senderName: string | null }>;
  readonly workOrders: StationLookupWorkOrder[];
  /** Eşleşen ama aktif refakat kartı olmayan (tamamlanmış/kartı iptal) İE no'ları — seçilemez, yalnız cümlede. */
  readonly closedWorkOrderNumbers?: string[];
  /** Türkçe: tabletin göstereceği sonuç cümlesi. */
  readonly message: string;
  /** Ekran bildirildiyse hangi istasyon için "burada" denildi; yoksa null. */
  readonly station?: { screen: StationScreen; label: string } | null;
}

export async function stationLookupStatus(): Promise<{ enabled: boolean; readerConfigured: boolean }> {
  return { enabled: (await readIncomingDocStationLookup()) && (await readProductionEnabled()), readerConfigured: getReaderUrl().url !== null };
}

async function assertStationLookupEnabled(): Promise<void> {
  if (!(await readIncomingDocStationLookup())) {
    throw AppError.forbidden(`İstasyonda belge okutma kapalı (${settingScreenPath("gelen-belge")}).`, { code: "GELEN_BELGE_STATION_LOOKUP_DISABLED" });
  }
  if (!(await readProductionEnabled())) {
    throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim")
      ?? AppError.forbidden(`Üretim modülü kapalı; ${TERIM.terbiyeIsEmri.tekilKucuk} aranamaz.`, { code: "MODULE_DISABLED", module: "production" });
  }
}

export type StationLookupInput = { contentBase64: string; sha256?: string | null } | { q: string };

export async function stationDocLookup(input: StationLookupInput, ctx: StationLookupContext | null = null): Promise<StationLookupResult> {
  await assertStationLookupEnabled();
  const label = ctx ? await stationLabel(ctx) : null;
  const result = "q" in input ? await searchLookup(input.q) : await photoLookup(input.contentBase64, input.sha256 ?? null);
  if (!ctx || !label) return { ...result, station: null };
  return { ...result, workOrders: await markAtStation(result.workOrders, ctx), station: { screen: ctx.screen, label } };
}


async function searchLookup(q: string): Promise<StationLookupResult> {
  const where = stationWorkSearchWhere(q);
  const { workOrders, closed } = where ? await loadWorkOrders(where, null) : { workOrders: [], closed: [] };
  return finish({ source: "SEARCH", read: null, notes: [], workOrders, closed, noteCount: null });
}

async function photoLookup(contentBase64: string, sha256: string | null): Promise<StationLookupResult> {
  const upload = await decodeScanUpload(contentBase64, sha256);
  if (upload.mime === PDF_MIME) {
    throw AppError.badRequest("PDF belge okunmaz; belgenin fotoğrafını çekin.", { code: "DOCUMENT_SCAN_PDF_NOT_READABLE" });
  }
  // Aynı fotoğraf daha önce yüklendiyse OCR koşmaz (okuma belirlenimli değil; aynı bayt aynı belgedir).
  // sha256 UNIQUE değil (K27): en yeni tarama TEK helper'dan.
  const known = await latestScanBySha(prisma, upload.sha256, {
    ocrResult: true, note: { select: { id: true, status: true, senderDocNo: true, ownerText: true, senderText: true } },
  });
  if (known?.note && LOOKUP_NOTE_STATUSES.includes(known.note.status)) {
    const notes = await loadNotes({ id: known.note.id });
    const read = { senderDocNo: known.note.senderDocNo, ownerText: known.note.ownerText, senderText: known.note.senderText };
    return finish({ source: "SAME_PHOTO", read, notes, ...(await workOrdersOfNotes(notes)), noteCount: notes.length });
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
  // Sınıflandırma gelen belge okumasıyla aynı: aktif dosya + aktif kullanıcı (`u-…`) şablonları (`engineTemplates` her okumada yükler).
  const { header } = await extractDraft(ocr);
  const read = { senderDocNo: header.senderDocNo, ownerText: header.ownerText, senderText: header.senderText };
  const docNo = header.senderDocNo?.trim() || null;
  const batchNos = readBatchNos(header);
  const readValues = { docNo, batchNos };
  if (!docNo && batchNos.length === 0) return finish({ source, read, notes: [], workOrders: [], noteCount: null, noDocNo: true });
  // (a) belge no — önce (bugünkü yol); TAM eşleşme açık İE verirse biter.
  let byDoc: { notes: NoteRow[]; loaded: LoadedWorkOrders } | null = null;
  if (docNo) {
    const templateCode = header.regions[0]?.templateId ?? null;
    const found = await loadDocNoNotesTolerant(docNo);
    const notes = narrowNotes(found.notes, read, await templateSenderId(templateCode));
    const loaded = await workOrdersOfNotes(notes);
    if (loaded.workOrders.length > 0 && found.tier !== "TOLERANT") return finish({ source, read, notes, ...loaded, noteCount: notes.length });
    byDoc = { notes, loaded };
  }
  // (b) parti no yedeği — açık iş emirleri. Belge no yalnız TOLERANSLA tuttuysa parti no da denenir (OCR tahmini
  // doğru parti eşleşmesini gölgelemesin): kesişim varsa o, çelişirse birleşim (seçtirir).
  const byBatch = batchNos.length > 0 ? await workOrdersOfBatchNos(batchNos) : null;
  if (byDoc && byDoc.loaded.workOrders.length > 0) {
    const merged = mergeTolerantDoc(byDoc.loaded.workOrders, byBatch);
    return finish({ source, read, notes: byDoc.notes, workOrders: merged, noteCount: byDoc.notes.length });
  }
  if (byBatch && byBatch.loaded.workOrders.length > 0) return finish({ source, read, notes: [], ...byBatch.loaded, noteCount: null });
  // Belge bulundu ama açık İE yok → bugünkü cümle (kapanmış İE no'su / "bu belgeye ait İE yok").
  if (byDoc && byDoc.notes.length > 0) return finish({ source, read, notes: byDoc.notes, ...byDoc.loaded, noteCount: byDoc.notes.length });
  return finish({ source, read, notes: [], workOrders: [], noteCount: 0, readValues });
}

/**
 * Toleranslı belge no İE'leri ↔ parti no İE'leri: parti eşleşmesi yoksa belge no'nunkiler; kesişim boş değilse kesişim
 * (iki okuma aynı işi gösteriyor); kesişim boşsa ve parti TAM eşleştiyse birleşim (çelişki → tablet seçtirir).
 */
export function mergeTolerantDoc(
  byDoc: StationLookupWorkOrder[],
  byBatch: { tier: CodeMatchTier; loaded: LoadedWorkOrders } | null,
): StationLookupWorkOrder[] {
  const batchWos = byBatch?.loaded.workOrders ?? [];
  if (batchWos.length === 0) return byDoc;
  const batchIds = new Set(batchWos.map((w) => w.id));
  const both = byDoc.filter((w) => batchIds.has(w.id));
  if (both.length > 0) return both;
  if (byBatch!.tier !== "EXACT") return byDoc;
  const docIds = new Set(byDoc.map((w) => w.id));
  return [...byDoc, ...batchWos.filter((w) => !docIds.has(w.id))].slice(0, MAX_WORK_ORDERS);
}

/** Okunan parti no'ları: başlığın parti no'su + şablonun parti adayları (tekil, boşsuz). */
function readBatchNos(header: Pick<DraftHeader, "customerBatchNo" | "batchNoCandidates">): string[] {
  const all = [header.customerBatchNo, ...header.batchNoCandidates.map((c) => c.value)].map((v) => v?.trim() ?? "").filter((v) => v.length > 0);
  return [...new Set(all)];
}

const NOTE_SELECT = {
  id: true, noteNo: true, senderDocNo: true, ownerText: true, senderText: true, senderCustomerId: true,
  ownerCustomer: { select: { name: true } }, senderCustomer: { select: { name: true } },
} satisfies Prisma.CustomerDeliveryNoteSelect;
export type NoteRow = Prisma.CustomerDeliveryNoteGetPayload<{ select: typeof NOTE_SELECT }>;

function loadNotes(where: Prisma.CustomerDeliveryNoteWhereInput): Promise<NoteRow[]> {
  return prisma.customerDeliveryNote.findMany({
    where: { AND: [where, { status: { in: [...LOOKUP_NOTE_STATUSES] } }] },
    select: NOTE_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_WORK_ORDERS,
  });
}

/**
 * Belge no'lu belgeler: İŞİ SÜRENLER varsa yalnız onlar (K27 — boyahane no'yu yeniden kullanır, bitmiş belge tavanı
 * doldurmaz); hiç yoksa bugünkü küme (kapanmış iş emri cümlesi korunur).
 */
export async function loadDocNoNotes(docNo: string): Promise<NoteRow[]> {
  const byNo: Prisma.CustomerDeliveryNoteWhereInput = { senderDocNo: { equals: docNo, mode: "insensitive" } };
  const ongoing = await loadNotes({ AND: [byNo, NOTE_WORK_ONGOING_WHERE] });
  return ongoing.length > 0 ? ongoing : loadNotes(byNo);
}

/** İşi süren, topu doğmuş belge filtresi — toleranslı evrenlerin ortak tabanı. */
const ONGOING_LOOKUP_NOTE: Prisma.CustomerDeliveryNoteWhereInput = { AND: [{ status: { in: [...LOOKUP_NOTE_STATUSES] } }, NOTE_WORK_ONGOING_WHERE] };

/** Belge no: tam (harf duyarsız) eşleşme yoksa işi süren belgelerin no'larında OCR-toleranslı eşleşme. */
async function loadDocNoNotesTolerant(docNo: string): Promise<{ tier: CodeMatchTier | null; notes: NoteRow[] }> {
  const exact = await loadDocNoNotes(docNo);
  if (exact.length > 0) return { tier: "EXACT", notes: exact };
  const universe = await prisma.customerDeliveryNote.findMany({
    where: { AND: [ONGOING_LOOKUP_NOTE, { senderDocNo: { not: null } }] },
    select: { senderDocNo: true }, distinct: ["senderDocNo"], orderBy: [{ senderDocNo: "asc" }], take: TOLERANT_UNIVERSE_CAP,
  });
  warnIfCapped("belge no", universe.length);
  const m = matchCodes([docNo], universe.map((n) => n.senderDocNo));
  return m ? { tier: m.tier, notes: await loadNotes({ AND: [{ senderDocNo: { in: m.values } }, NOTE_WORK_ONGOING_WHERE] }) } : { tier: null, notes: [] };
}

function warnIfCapped(what: string, size: number): void {
  if (size >= TOLERANT_UNIVERSE_CAP) uyari("istasyon-okutma", `Toleranslı ${what} evreni tavanda (${TOLERANT_UNIVERSE_CAP}); evrenin dışındaki kod yalnız tam eşleşir`);
}

/**
 * Parti no yedeği: açık İE'lerin parti no'ları + işi süren belgelerin parti no'ları (bizim / müşterinin) evreninde
 * toleranslı eşleşme → eşleşen KAYITLI değerlerle açık İE'ler. Arama sorusudur (elle aramanın parti dalı gibi);
 * partinin kimliği yine `id`dir.
 */
async function workOrdersOfBatchNos(reads: string[]): Promise<{ tier: CodeMatchTier; loaded: LoadedWorkOrders } | null> {
  const open: Prisma.WorkOrderWhereInput = { status: { in: OPEN_WORK_ORDER_STATUSES }, isActive: true };
  const noteHasBatch: Prisma.CustomerDeliveryNoteWhereInput = { OR: [{ ourBatchNo: { not: null } }, { customerBatchNo: { not: null } }] };
  const fetch = async (batchWhere: Prisma.BatchWhereInput, noteWhere: Prisma.CustomerDeliveryNoteWhereInput, cap: number | undefined) => {
    const batches = await prisma.batch.findMany({ where: { AND: [{ workOrder: open }, batchWhere] }, select: { batchNumber: true }, distinct: ["batchNumber"], orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: cap });
    const notes = await prisma.customerDeliveryNote.findMany({
      where: { AND: [ONGOING_LOOKUP_NOTE, noteHasBatch, noteWhere] },
      select: { ourBatchNo: true, customerBatchNo: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: cap,
    });
    return { size: Math.max(batches.length, notes.length), values: [...batches.map((b) => b.batchNumber), ...notes.flatMap((n) => [n.ourBatchNo, n.customerBatchNo])] };
  };
  // Tam eşleşme önce DB'de (tavansız); kayıttaki yazım `matchCodes`la süzülür (ölçü TEK helper'da).
  const eq = (v: string) => ({ equals: v, mode: "insensitive" as const });
  const exact = await fetch(
    { OR: reads.map((r) => ({ batchNumber: eq(r) })) },
    { OR: reads.flatMap((r) => [{ ourBatchNo: eq(r) }, { customerBatchNo: eq(r) }]) },
    undefined,
  );
  let m = matchCodes(reads, exact.values);
  if (!m) {
    const universe = await fetch({}, {}, TOLERANT_UNIVERSE_CAP);
    warnIfCapped("parti no", universe.size);
    m = matchCodes(reads, universe.values);
  }
  if (!m) return null;
  const byNote = whereWorkOrdersOfRolls({ deliveryNoteLine: { note: { status: { in: [...LOOKUP_NOTE_STATUSES] }, OR: [{ ourBatchNo: { in: m.values } }, { customerBatchNo: { in: m.values } }] } } });
  return { tier: m.tier, loaded: await loadWorkOrders({ AND: [open, { OR: [{ batches: { some: { batchNumber: { in: m.values } } } }, byNote] }] }, null) };
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

function workOrdersOfNotes(notes: NoteRow[]): Promise<LoadedWorkOrders> {
  if (notes.length === 0) return Promise.resolve({ workOrders: [], closed: [] });
  const noteIds = notes.map((n) => n.id);
  return loadWorkOrders(whereWorkOrdersOfRolls({ deliveryNoteLine: { noteId: { in: noteIds } } }), noteIds);
}


function finish(p: {
  source: StationLookupSource;
  read: StationLookupResult["read"];
  notes: NoteRow[];
  workOrders: StationLookupWorkOrder[];
  closed?: string[];
  noteCount: number | null;
  unreadable?: boolean;
  noDocNo?: boolean;
  /** Hiçbir yol açık İE bulmadı: cümle okunan değerleri söyler. */
  readValues?: { docNo: string | null; batchNos: string[] };
}): StationLookupResult {
  const notes = p.notes.map((n) => ({ id: n.id, noteNo: n.noteNo, senderDocNo: n.senderDocNo, ownerName: n.ownerCustomer?.name ?? null, senderName: n.senderCustomer?.name ?? null }));
  const base = { source: p.source, read: p.read, notes, workOrders: p.workOrders };
  if (p.unreadable) return { ...base, outcome: "UNREADABLE", message: "Belge okunamadı; fiş no ile elle arayın." };
  if (p.noDocNo) return { ...base, outcome: "NO_DOC_NO", message: `Belgede evrak no da parti no da okunamadı; evrak no, parti no ya da ${TERIM.terbiyeIsEmri.tekilKucuk} no ile elle arayın.` };
  if (p.readValues) {
    const v = p.readValues;
    const said = `Okunan evrak no: ${v.docNo ?? "okunamadı"} · parti no: ${v.batchNos.length > 0 ? v.batchNos.join(", ") : "okunamadı"}`;
    return { ...base, outcome: v.docNo ? "NO_DOCUMENT" : "NO_DOC_NO", message: `${said} — eşleşen açık ${TERIM.terbiyeIsEmri.tekilKucuk} yok; elle arayın.` };
  }
  if (p.workOrders.length === 0 && p.closed && p.closed.length > 0) {
    return { ...base, closedWorkOrderNumbers: p.closed, outcome: "NO_WORK_ORDER", message: `${TERIM.terbiyeIsEmri.tekil} kapanmış, açık kartı yok: ${p.closed.join(", ")}.` };
  }
  if (p.workOrders.length === 0) {
    return { ...base, outcome: "NO_WORK_ORDER", message: p.source === "SEARCH" ? `Aramaya uyan ${TERIM.terbiyeIsEmri.tekilKucuk} yok.` : `Bu belgeye ait ${TERIM.terbiyeIsEmri.tekilKucuk} yok.` };
  }
  if (p.workOrders.length === 1) return { ...base, outcome: "SINGLE", message: `${TERIM.terbiyeIsEmri.tekil} bulundu: ${p.workOrders[0]!.workOrderNumber}` };
  return { ...base, outcome: "MULTIPLE", message: `${p.workOrders.length} ${TERIM.terbiyeIsEmri.tekilKucuk} bulundu; açılacak olanı seçin.` };
}
