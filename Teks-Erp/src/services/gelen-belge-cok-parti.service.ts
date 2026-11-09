// =============================================================================
// GELEN BELGE — ÇOK PARTİLİ BELGE (S1, Gülkesim 2026-11-03): parti özeti + parti başına iş emri
// =============================================================================
// Bir çeki listesi birden çok partiyi (bölüm) taşıyabilir. Parti özeti (`GET /irsaliyeler/:id/partiler`) canlı satırlardan
// sayılır (`noteParties`, saf). Kayıt (`POST /irsaliyeler/:id/is-emri` + `parties[]`): onay parti başına bir özet satırı/top
// doğurur (`partyLineId`, belirlenimli) → PER_PARTY her parti ayrı iş emri (token = uuidv5(clientToken|blok)), SINGLE tek iş
// emri (partiler ayrı top). Yarıda kalan istek aynı token'la devam eder: top ve iş emri replay olur, ikincisi doğmaz.
// =============================================================================
import { DeliveryNoteLineStatus, WorkOrderStatus } from "@prisma/client";
import { v5 as uuidv5 } from "uuid";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";
import { declaredPageCount, noteParties, type NoteParty } from "../lib/gelen-belge/parti-ozet";
import { isSummaryLine, partyLineId } from "./gelen-belge-kontrol.service";
import { type MultiPartyWorkOrderMode } from "./system-setting.service";
import { resolveMultiPartyMode, type MultiPartyModeSource } from "./gelen-belge-parti-kipi.service";
import { WorkOrderService, type WorkOrderCreateInput } from "./workorder.service";
import { routeInput, type FormWorkOrderRoute } from "./gelen-belge-oto-is-emri.service";
import { whereWorkOrdersOfRolls } from "./helpers/workorder-rolls.helper";

const workOrders = new WorkOrderService();
/** Parti başına iş emri token uzayı (PER_PARTY): aynı mantıksal deneme + aynı blok → aynı token. */
const PARTY_WO_TOKEN_NS = "6f1d2c8e-4b7a-4d39-9e52-a1c0b7f3d814";

export const partyWorkOrderToken = (clientToken: string, blockNo: number): string => uuidv5(`${clientToken}|${blockNo}`, PARTY_WO_TOKEN_NS);

export interface NotePartiesView {
  parties: Array<NoteParty & { workOrders: Array<{ id: string; workOrderNumber: string; status: string }> }>;
  /** Belge düzeyi canlı uyarılar (eksik sayfa). */
  warnings: string[];
  /** İki ya da daha çok parti → form "Bu belgede N parti var" listesini gösterir. */
  multi: boolean;
  /** Formun varsayılan seçimi: notun okunduğu şablon sürümünün kuralı, yoksa fabrika ayarı (`resolveMultiPartyMode`). */
  defaultMode: MultiPartyWorkOrderMode;
  /** `defaultMode` nereden: TEMPLATE (belge tipi kuralı) · FACTORY (fabrika ayarı). Eski tablet yok sayar. */
  defaultModeSource: MultiPartyModeSource;
}

export async function getNoteParties(noteId: string): Promise<NotePartiesView> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: {
      id: true, totalsDeclared: true, pageCount: true,
      scans: { select: { pageNo: true } },
      lines: { where: { status: { not: DeliveryNoteLineStatus.SKIPPED } }, select: { id: true, blockNo: true, meters: true, weightKg: true, processText: true, rollId: true } },
    },
  });
  if (!note) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const docLines = note.lines.filter((l) => !isSummaryLine(note.id, l));
  // Elle düzeltilen parti metresi yalnız parti kaydında (özet satırı) yaşar; kart Σ satırı değil bunu göstersin (2. prova).
  const recorded = new Map(note.lines.filter((l) => l.rollId && isSummaryLine(note.id, l)).map((l) => [l.blockNo, Number(l.meters)]));
  const { parties: read, warnings } = noteParties(docLines, note.totalsDeclared, { pageCount: note.pageCount ?? declaredPageCount(note.totalsDeclared), scannedPages: note.scans.map((s) => s.pageNo) });
  const parties = read.map((p) => ({ ...p, recordedMeters: recorded.get(p.blockNo) ?? null }));
  const withWos = [];
  for (const p of parties) withWos.push({ ...p, workOrders: await partyLinkedWorkOrders(note.id, p.blockNo) });
  const { mode, source } = await resolveMultiPartyMode(note.id);
  return { parties: withWos, warnings, multi: parties.length > 1, defaultMode: mode, defaultModeSource: source };
}

/** D7: partinin bağlı İE'leri — özet satırı (`partyLineId`) → top → İE zinciri (istemci türetmez); onaysız belgede boş. */
async function partyLinkedWorkOrders(noteId: string, blockNo: number): Promise<Array<{ id: string; workOrderNumber: string; status: string }>> {
  const line = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: partyLineId(noteId, blockNo) }, select: { rollId: true } });
  if (!line?.rollId) return [];
  return prisma.workOrder.findMany({
    where: whereWorkOrdersOfRolls({ id: line.rollId }), select: { id: true, workOrderNumber: true, status: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5,
  });
}

export interface PartyInput {
  blockNo: number;
  batchNo?: string | null;
  meters: number;
  /** Yalnız "Toplar ayrı geldi" (`rollsAsParties`): topun kilosu ve gönderen top no'su özet satırına yazılır. */
  weightKg?: number | null;
  /** Partinin gelen kg'si (operatör düzeltmesi); yoksa `/partiler` önerisi (`suggestedKg`). Özet satırına yazılır, topa geçmez. */
  incomingKg?: number | null;
  /** Partinin gelen eni (cm, operatör düzeltmesi); yoksa belgenin şablon `en`i. Özet satırına yazılır, topa geçmez. */
  incomingWidth?: number | null;
  senderRollNo?: string | null;
  targetValues?: Array<{ propertyId: string; valueId: string }>;
  stepPlanning?: Array<{ sequence: number; plannedMachineId?: string | null }>;
}

/** Gövde kapısı: blok no tekil (çift parti ikinci top doğururdu). */
export function assertPartiesShape(parties: ReadonlyArray<PartyInput>): void {
  const seen = new Set<number>();
  for (const p of parties) {
    if (seen.has(p.blockNo)) throw AppError.badRequest(`Parti listesinde ${p.blockNo}. parti iki kez var.`, { code: "DELIVERY_NOTE_PARTY_DUPLICATE", blockNo: p.blockNo });
    seen.add(p.blockNo);
  }
}

/** Partilerin özet satırı topları (blok sırasıyla); top doğmamış parti → 409. */
export async function partyRolls(noteId: string, noteNo: string, parties: ReadonlyArray<PartyInput>): Promise<Array<{ blockNo: number; rollId: string; barcode: string }>> {
  const sorted = [...parties].sort((a, b) => a.blockNo - b.blockNo);
  const ids = sorted.map((p) => partyLineId(noteId, p.blockNo));
  const rows = await prisma.customerDeliveryNoteLine.findMany({ where: { id: { in: ids } }, select: { id: true, rollId: true, failReason: true, roll: { select: { barcode: true } } } });
  return sorted.map((p, i) => {
    const r = rows.find((x) => x.id === ids[i]);
    if (!r?.rollId || !r.roll?.barcode) throw AppError.conflict(`${noteNo} ${p.blockNo}. parti için top doğmadı${r?.failReason ? `: ${r.failReason}` : ""}.`, { code: "DELIVERY_NOTE_ROLL_MISSING", blockNo: p.blockNo });
    return { blockNo: p.blockNo, rollId: r.rollId, barcode: r.roll.barcode };
  });
}

/** Partilerin topları üretim bekliyor mu — hepsinin özet satırında top varsa onay atlanır (yarıda kalan devam). */
export async function allPartiesEntered(noteId: string, parties: ReadonlyArray<PartyInput>): Promise<boolean> {
  const ids = parties.map((p) => partyLineId(noteId, p.blockNo));
  const n = await prisma.customerDeliveryNoteLine.count({ where: { id: { in: ids }, rollId: { not: null } } });
  return n === ids.length;
}

export interface PartyWorkOrder {
  blockNos: number[];
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string | null;
  rollIds: string[];
  /** D4 (2026-11-06): bu partinin topu önceki bir denemede açılmış canlı İE'deydi — yeniden açılmadı. */
  existing?: boolean;
}

/** D4: deterministik 4xx ile açılamayan parti (öteki partiler açıldı; belge yarım kalmaz, düzeltilip yeniden gönderilir). */
export interface PartyWorkOrderFailure {
  blockNo: number;
  code: string | null;
  message: string;
}

/** İptal/devredilmiş dışındaki İE'ler — "bu partinin İE'si zaten var" sorusu (yeni token'lı yeniden deneme 409'a düşmesin). */
const LIVE_WO_STATUSES = [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED];

async function existingPartyWorkOrder(rolls: OpenInput["rolls"]): Promise<PartyWorkOrder | null> {
  const wo = await prisma.workOrder.findFirst({
    where: { AND: [whereWorkOrdersOfRolls({ id: { in: rolls.map((r) => r.rollId) } }), { status: { in: LIVE_WO_STATUSES } }] },
    select: { id: true, workOrderNumber: true, batches: { select: { batchNumber: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!wo) return null;
  return { blockNos: rolls.map((r) => r.blockNo), workOrderId: wo.id, workOrderNo: wo.workOrderNumber, batchNumber: wo.batches[0]?.batchNumber ?? null, rollIds: rolls.map((r) => r.rollId), existing: true };
}

/** K4: gönderenin (boyahane) İE no'su bizim İE'nin künyesine (`parameters.senderWorkOrderNo`) — kaynak sunucudaki okuma beyanı. */
async function senderWorkOrderNos(noteId: string): Promise<Map<number, string>> {
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { totalsDeclared: true } });
  const { parties } = noteParties([], note?.totalsDeclared ?? null);
  return new Map(parties.filter((p) => p.senderWorkOrderNo).map((p) => [p.blockNo, p.senderWorkOrderNo!]));
}

interface OpenInput {
  noteId: string;
  clientToken: string;
  /** Şablon ya da K29 rotasız (`resolveFormWorkOrderRoute` tek kapısından). */
  route: FormWorkOrderRoute;
  mode: MultiPartyWorkOrderMode;
  parties: ReadonlyArray<PartyInput>;
  rolls: ReadonlyArray<{ blockNo: number; rollId: string; barcode: string }>;
  targetValues: Array<{ propertyId: string; valueId: string }>;
  /** K22 istasyon kat varsayılanı (tek parti yoluyla aynı); yoksa kat yazılmaz. */
  foldType?: string | null;
  stepPlanning?: Array<{ sequence: number; plannedMachineId?: string | null }>;
  notes?: string | null;
  flagPropertyIds: (targets: ReadonlyArray<{ propertyId: string }>) => Promise<string[]>;
  /** K30 S16a form alanları (verilenler) — her iş emrine aynen geçer; PER_PARTY'de hedef metraj/kg çağıranda reddedilir. */
  fields?: Pick<WorkOrderCreateInput, "targetItemId" | "targetColorId" | "width" | "targetQuantity" | "targetWeight" | "plannedStartDate" | "plannedEndDate" | "orderLineIds" | "type" | "customerId">;
  /** Hedef metraj verilmedi + fabrika ayarı açık: her İE'nin hedefi kendi toplarının parti metresi (SINGLE = toplam). */
  deriveTargetQuantity?: boolean;
  /** K30-D düzenlenmiş adımlar (çağıran onaydan önce doğruladı): varsa şablonun yerine geçer. */
  steps?: WorkOrderCreateInput["steps"];
}

/** İş emirleri: PER_PARTY parti başına (sıralı; her biri kendi token'ıyla replay), SINGLE tek iş emri tüm parti toplarıyla. */
export async function openPartyWorkOrders(i: OpenInput, userId: string): Promise<{ workOrders: PartyWorkOrder[]; failed: PartyWorkOrderFailure[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: PartyWorkOrder[] = [];
  const failed: PartyWorkOrderFailure[] = [];
  const senderNos = await senderWorkOrderNos(i.noteId);
  const run = async ({ token, rolls, targets, plan, batchNo }: { token: string; rolls: OpenInput["rolls"]; targets: OpenInput["targetValues"]; plan: OpenInput["stepPlanning"]; batchNo?: string | null }) => {
    const stepPlanning = plan as WorkOrderCreateInput["stepPlanning"];
    const sender = [...new Set(rolls.map((r) => senderNos.get(r.blockNo)).filter((x): x is string => !!x))].join(", ");
    const customerBatch = partyBatchNos(i.parties, rolls);
    const parameters = { ...(sender ? { senderWorkOrderNo: sender } : {}), ...(customerBatch ? { customerBatchNo: customerBatch } : {}) };
    const res = await workOrders.quickStart({
      clientToken: token,
      rollBarcodes: rolls.map((r) => r.barcode),
      ...(i.steps?.length ? { steps: i.steps } : routeInput(i.route)),
      targetValues: targets,
      targetPropertyIds: await i.flagPropertyIds(targets),
      ...(i.foldType ? { foldType: i.foldType } : {}),
      ...(stepPlanning?.length ? { stepPlanning } : {}),
      ...(i.notes ? { notes: i.notes } : {}),
      ...(Object.keys(parameters).length ? { parameters } : {}),
      ...i.fields,
      ...(i.deriveTargetQuantity ? { targetQuantity: partyMeters(i.parties, rolls) } : {}),
      sourceNoteId: i.noteId,
      ...(batchNo ? { sourceBatchNo: batchNo } : {}),
    }, userId).catch(async (e: unknown) => {
      // D4: yeni token'lı yeniden denemede partinin topu önceki denemenin canlı İE'sinde → 4xx; o İE "zaten açık" döner,
      // ikinci İE açılmaz (aynı token'da quickStart replay'i zaten bayt-aynı yanıt verir, buraya düşmez).
      const existing = e instanceof AppError && e.statusCode < 500 ? await existingPartyWorkOrder(rolls) : null;
      if (existing) return existing;
      throw e;
    });
    if ("workOrderId" in res) { out.push(res); return; }
    const wo = res.data?.workOrder;
    if (!wo) throw AppError.internal(`${TERIM.terbiyeIsEmri.tekil} açılamadı.`);
    if (res.warnings?.length) warnings.push(...res.warnings);
    out.push({ blockNos: rolls.map((r) => r.blockNo), workOrderId: wo.id, workOrderNo: wo.workOrderNumber, batchNumber: res.data?.batch?.batchNumber ?? null, rollIds: rolls.map((r) => r.rollId) });
  };
  if (i.mode === "PER_PARTY") {
    let firstErr: AppError | null = null;
    for (const r of i.rolls) {
      const p = i.parties.find((x) => x.blockNo === r.blockNo)!;
      try {
        await run({ token: partyWorkOrderToken(i.clientToken, r.blockNo), rolls: [r], targets: p.targetValues ?? i.targetValues, plan: p.stepPlanning ?? i.stepPlanning, batchNo: p.batchNo });
      } catch (e) {
        // Yalnız deterministik 4xx partiyi düşürür; 5xx/ağ belirsizdir → istemci AYNI token'la yeniden dener (açılanlar replay).
        if (!(e instanceof AppError) || e.statusCode >= 500) throw e;
        failed.push({ blockNo: r.blockNo, code: errorCode(e), message: e.message });
        firstErr ??= e;
      }
    }
    if (out.length === 0 && firstErr) throw firstErr;
    for (const f of failed) warnings.push(`${f.blockNo}. parti için ${TERIM.terbiyeIsEmri.tekilKucuk} açılamadı: ${f.message} — düzeltip yeniden kaydedin; açılanlar yeniden açılmaz.`);
  } else {
    await run({ token: i.clientToken, rolls: i.rolls, targets: i.targetValues, plan: i.stepPlanning });
  }
  return { workOrders: out, failed, warnings };
}

const errorCode = (e: AppError): string | null => {
  const c = (e.details as { code?: unknown } | undefined)?.code;
  return typeof c === "string" ? c : null;
};


/**
 * Toplarının partilerinde formda onaylanan parti no'ları (kağıttaki ayırt edici no). `batchNumberSource=SERIES`te İE partisi
 * seriden doğar; kağıttaki no sessizce kaybolmasın diye künyeye (`parameters.customerBatchNo`) yazılır ve aranır.
 */
function partyBatchNos(parties: ReadonlyArray<PartyInput>, rolls: OpenInput["rolls"]): string {
  const nos = rolls.map((r) => parties.find((p) => p.blockNo === r.blockNo)?.batchNo?.trim()).filter((x): x is string => !!x);
  return [...new Set(nos)].join(", ").slice(0, 200);
}

/** Toplarının parti metreleri toplamı (3 hane). */
function partyMeters(parties: ReadonlyArray<PartyInput>, rolls: OpenInput["rolls"]): number {
  const sum = rolls.reduce((s, r) => s + (parties.find((p) => p.blockNo === r.blockNo)?.meters ?? 0), 0);
  return Math.round(sum * 1000) / 1000;
}
