// =============================================================================
// GELEN BELGE — ÇOK PARTİLİ BELGE (S1, Gülkesim 2026-11-03): parti özeti + parti başına iş emri
// =============================================================================
// Bir çeki listesi birden çok partiyi (bölüm) taşıyabilir. Parti özeti (`GET /irsaliyeler/:id/partiler`) canlı satırlardan
// sayılır (`noteParties`, saf). Kayıt (`POST /irsaliyeler/:id/is-emri` + `parties[]`): onay parti başına bir özet satırı/top
// doğurur (`partyLineId`, belirlenimli) → PER_PARTY her parti ayrı iş emri (token = uuidv5(clientToken|blok)), SINGLE tek iş
// emri (partiler ayrı top). Yarıda kalan istek aynı token'la devam eder: top ve iş emri replay olur, ikincisi doğmaz.
// =============================================================================
import { DeliveryNoteLineStatus } from "@prisma/client";
import { v5 as uuidv5 } from "uuid";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";
import { declaredPageCount, noteParties, type NoteParty } from "../lib/gelen-belge/parti-ozet";
import { isSummaryLine, partyLineId } from "./gelen-belge-kontrol.service";
import { readMultiPartyWorkOrder, type MultiPartyWorkOrderMode } from "./system-setting.service";
import { WorkOrderService, type WorkOrderCreateInput } from "./workorder.service";
import { routeInput, type FormWorkOrderRoute } from "./gelen-belge-oto-is-emri.service";

const workOrders = new WorkOrderService();
/** Parti başına iş emri token uzayı (PER_PARTY): aynı mantıksal deneme + aynı blok → aynı token. */
const PARTY_WO_TOKEN_NS = "6f1d2c8e-4b7a-4d39-9e52-a1c0b7f3d814";

export const partyWorkOrderToken = (clientToken: string, blockNo: number): string => uuidv5(`${clientToken}|${blockNo}`, PARTY_WO_TOKEN_NS);

export interface NotePartiesView {
  parties: NoteParty[];
  /** Belge düzeyi canlı uyarılar (eksik sayfa). */
  warnings: string[];
  /** İki ya da daha çok parti → form "Bu belgede N parti var" listesini gösterir. */
  multi: boolean;
  /** Fabrika ayarı (`gelenBelge.multiPartyWorkOrder`) — formun varsayılan seçimi. */
  defaultMode: MultiPartyWorkOrderMode;
}

export async function getNoteParties(noteId: string): Promise<NotePartiesView> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: {
      id: true, totalsDeclared: true, pageCount: true,
      scans: { select: { pageNo: true } },
      lines: { where: { status: { not: DeliveryNoteLineStatus.SKIPPED } }, select: { id: true, blockNo: true, meters: true, weightKg: true } },
    },
  });
  if (!note) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const docLines = note.lines.filter((l) => !isSummaryLine(note.id, l));
  const { parties, warnings } = noteParties(docLines, note.totalsDeclared, { pageCount: note.pageCount ?? declaredPageCount(note.totalsDeclared), scannedPages: note.scans.map((s) => s.pageNo) });
  return { parties, warnings, multi: parties.length > 1, defaultMode: await readMultiPartyWorkOrder() };
}

export interface PartyInput {
  blockNo: number;
  batchNo?: string | null;
  meters: number;
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
  fields?: Pick<WorkOrderCreateInput, "targetItemId" | "targetColorId" | "width" | "targetQuantity" | "targetWeight" | "plannedStartDate" | "plannedEndDate" | "orderLineIds" | "type">;
  /** Hedef metraj verilmedi + fabrika ayarı açık: her İE'nin hedefi kendi toplarının parti metresi (SINGLE = toplam). */
  deriveTargetQuantity?: boolean;
  /** K30-D düzenlenmiş adımlar (çağıran onaydan önce doğruladı): varsa şablonun yerine geçer. */
  steps?: WorkOrderCreateInput["steps"];
}

/** İş emirleri: PER_PARTY parti başına (sıralı; her biri kendi token'ıyla replay), SINGLE tek iş emri tüm parti toplarıyla. */
export async function openPartyWorkOrders(i: OpenInput, userId: string): Promise<{ workOrders: PartyWorkOrder[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: PartyWorkOrder[] = [];
  const run = async ({ token, rolls, targets, plan, batchNo }: { token: string; rolls: OpenInput["rolls"]; targets: OpenInput["targetValues"]; plan: OpenInput["stepPlanning"]; batchNo?: string | null }) => {
    const stepPlanning = plan as WorkOrderCreateInput["stepPlanning"];
    const res = await workOrders.quickStart({
      clientToken: token,
      rollBarcodes: rolls.map((r) => r.barcode),
      ...(i.steps?.length ? { steps: i.steps } : routeInput(i.route)),
      targetValues: targets,
      targetPropertyIds: await i.flagPropertyIds(targets),
      ...(i.foldType ? { foldType: i.foldType } : {}),
      ...(stepPlanning?.length ? { stepPlanning } : {}),
      ...(i.notes ? { notes: i.notes } : {}),
      ...i.fields,
      ...(i.deriveTargetQuantity ? { targetQuantity: partyMeters(i.parties, rolls) } : {}),
      sourceNoteId: i.noteId,
      ...(batchNo ? { sourceBatchNo: batchNo } : {}),
    }, userId);
    const wo = res.data?.workOrder;
    if (!wo) throw AppError.internal(`${TERIM.terbiyeIsEmri.tekil} açılamadı.`);
    if (res.warnings?.length) warnings.push(...res.warnings);
    out.push({ blockNos: rolls.map((r) => r.blockNo), workOrderId: wo.id, workOrderNo: wo.workOrderNumber, batchNumber: res.data?.batch?.batchNumber ?? null, rollIds: rolls.map((r) => r.rollId) });
  };
  if (i.mode === "PER_PARTY") {
    for (const r of i.rolls) {
      const p = i.parties.find((x) => x.blockNo === r.blockNo)!;
      await run({ token: partyWorkOrderToken(i.clientToken, r.blockNo), rolls: [r], targets: p.targetValues ?? i.targetValues, plan: p.stepPlanning ?? i.stepPlanning, batchNo: p.batchNo });
    }
  } else {
    await run({ token: i.clientToken, rolls: i.rolls, targets: i.targetValues, plan: i.stepPlanning });
  }
  return { workOrders: out, warnings };
}

/** Toplarının parti metreleri toplamı (3 hane). */
function partyMeters(parties: ReadonlyArray<PartyInput>, rolls: OpenInput["rolls"]): number {
  const sum = rolls.reduce((s, r) => s + (parties.find((p) => p.blockNo === r.blockNo)?.meters ?? 0), 0);
  return Math.round(sum * 1000) / 1000;
}
