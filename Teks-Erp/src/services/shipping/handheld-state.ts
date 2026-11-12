// =============================================================================
// Shipping Service / handheld-state — el terminali sevkiyat durumu (A2 `HandheldLoadState`)
// =============================================================================
// Okutma ekranının TEK verisi: her A-ucu yanıtında güncel hâli taşır; istemci yerel hesap yapmaz.
// Özet (`summary.kg`) kuralı burada: çuvalda elle kg varsa o, yoksa içerik kg toplamı; dökmede top kg toplamı.
// Sevk edilmiş sevkiyatta iade edilen toplar çuvallarına GERİ eklenir (sevk rakamı BRÜT, `returned: true`).
// =============================================================================
import { LoadUnitKind, PrintedDocType, Prisma, RollStatus, ShipmentStatus } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import { LIVE_LOAD_UNIT_WHERE } from "../helpers/load-unit.helper";
import { formatSackSeqLabel, readSackSeqFormat } from "../helpers/sack-seq.helper";
import { readinessClassOf } from "../helpers/ship-readiness.helper";
import { readShipmentHandheldCreateEnabled } from "../system-setting.service";

export interface HandheldRoll {
  id: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  meters: number;
  weightKg: number | null;
  readinessClass: "READY" | "IN_PROCESS";
  status: RollStatus;
  /** Yalnız sevk edilmiş sevkiyatta: iade edilmiş top (brüt gösterim). */
  returned?: true;
}

export interface HandheldSack {
  id: string;
  sackNo: string;
  seq: number | null;
  seqLabel: string | null;
  weightKg: number | null;
  weightSource: "MANUAL" | "SCALE" | "SIMULATED" | null;
  rollKgSum: number | null;
  rollKgMissing: number;
  meters: number;
  labelDirty: boolean;
  rolls: HandheldRoll[];
}

export interface HandheldLoadState {
  shipment: {
    id: string; shipmentNo: string; status: "PLANNED" | "DISPATCHED"; customer: { id: string; name: string };
    branch: { id: string; name: string } | null; createdAt: string; dispatchedAt: string | null;
    plateNumber: string | null; driverName: string | null; documentNo: string | null;
  };
  sacks: HandheldSack[];
  loose: { unitId: string | null; rolls: HandheldRoll[] };
  summary: { sackCount: number; nonEmptySackCount: number; rollCount: number; looseRollCount: number; meters: number; kg: number | null; kgMissing: number };
}

/** Bayrak kapısı — tüm A-uçlarının ilk adımı (fail-closed; eski uçlar etkilenmez). */
export async function assertHandheldEnabled(): Promise<void> {
  if (await readShipmentHandheldCreateEnabled()) return;
  throw AppError.forbidden(`El terminalinden sevk kurma bu kurulumda kapalı (${settingRowPath("shipmentHandheldCreateEnabled")}).`, { code: "HANDHELD_DISABLED" });
}

/** Dökme birimin ve taşıma bildiriminin etiketi. */
export const LOOSE_LABEL = "Çuvalsız";

const r3 = (d: Prisma.Decimal): number => Number(d.toDecimalPlaces(3));

const ROLL_SELECT = {
  id: true, barcode: true, currentQty: true, weightKg: true, status: true, preShipStatus: true,
  item: { select: { name: true } }, color: { select: { name: true } },
} as const;
type RollRow = Prisma.RollGetPayload<{ select: typeof ROLL_SELECT }>;

function toRoll(r: RollRow): HandheldRoll {
  const cls = readinessClassOf(r.status === RollStatus.SHIPPED ? (r.preShipStatus ?? r.status) : r.status);
  return {
    id: r.id, barcode: r.barcode, itemName: r.item.name, colorName: r.color?.name ?? null,
    meters: Number(r.currentQty), weightKg: r.weightKg != null ? Number(r.weightKg) : null,
    readinessClass: cls === "IN_PROCESS" ? "IN_PROCESS" : "READY", status: r.status,
  };
}

/** İçerik kg toplamı (kg'lı top yoksa null) + kg'sız top sayısı + metre. */
function rollTotals(rolls: HandheldRoll[]): { kgSum: number | null; kgMissing: number; meters: number } {
  let kg = new Prisma.Decimal(0);
  let any = false;
  let meters = new Prisma.Decimal(0);
  for (const r of rolls) {
    meters = meters.plus(r.meters);
    if (r.weightKg != null) { kg = kg.plus(r.weightKg); any = true; }
  }
  return { kgSum: any ? r3(kg) : null, kgMissing: rolls.filter((r) => r.weightKg == null).length, meters: r3(meters) };
}

/** İade edilmiş topları (`RollReturn.prevSackId`) birimlerine geri ekler — yalnız sevk edilmiş sevkiyat. */
async function returnedRollsByUnit(shipmentId: string, liveIds: Set<string>): Promise<Map<string, HandheldRoll[]>> {
  const rows = await prisma.rollReturn.findMany({
    where: { fromShipmentId: shipmentId, cancelledAt: null },
    select: { rollId: true, prevSackId: true, qty: true, roll: { select: ROLL_SELECT } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const out = new Map<string, HandheldRoll[]>();
  for (const rr of rows) {
    if (!rr.prevSackId || liveIds.has(rr.rollId)) continue;
    const row: HandheldRoll = { ...toRoll(rr.roll), meters: Number(rr.qty), returned: true };
    out.set(rr.prevSackId, [...(out.get(rr.prevSackId) ?? []), row]);
  }
  return out;
}

function buildSummary(sacks: HandheldSack[], loose: HandheldRoll[]): HandheldLoadState["summary"] {
  const lt = rollTotals(loose);
  let kg = new Prisma.Decimal(0);
  let anyKg = lt.kgSum != null;
  if (lt.kgSum != null) kg = kg.plus(lt.kgSum);
  let kgMissing = lt.kgMissing;
  let meters = new Prisma.Decimal(lt.meters);
  for (const s of sacks) {
    meters = meters.plus(s.meters);
    const part = s.weightKg ?? s.rollKgSum;
    if (part != null) { kg = kg.plus(part); anyKg = true; }
    if (s.weightKg == null) kgMissing += s.rollKgMissing;
  }
  const sackRolls = sacks.reduce((n, s) => n + s.rolls.length, 0);
  return {
    sackCount: sacks.length, nonEmptySackCount: sacks.filter((s) => s.rolls.length > 0).length,
    rollCount: sackRolls + loose.length, looseRollCount: loose.length,
    meters: r3(meters), kg: anyKg ? r3(kg) : null, kgMissing,
  };
}

/** A2 — sevkiyatın el terminali durumu. CANCELLED 409, yoksa 404. */
export async function getHandheldLoadState(shipmentId: string): Promise<HandheldLoadState> {
  const sh = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true, shipmentNo: true, status: true, createdAt: true, dispatchedAt: true, plateNumber: true, driverName: true, sackSeqPrefix: true,
      customer: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } },
      sacks: {
        where: LIVE_LOAD_UNIT_WHERE,
        orderBy: [{ seq: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, sackNo: true, seq: true, unitKind: true, weightKg: true, weightSource: true, labelDirty: true, rolls: { select: ROLL_SELECT, orderBy: [{ updatedAt: "asc" }, { id: "asc" }] } },
      },
    },
  });
  if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
  if (sh.status === ShipmentStatus.CANCELLED) throw AppError.conflict(`Sevkiyat ${sh.shipmentNo} iptal edilmiş.`, { code: "SHIPMENT_CANCELLED" });
  const dispatched = sh.status === ShipmentStatus.DISPATCHED;
  const liveIds = new Set(sh.sacks.flatMap((u) => u.rolls.map((r) => r.id)));
  const returned = dispatched ? await returnedRollsByUnit(sh.id, liveIds) : new Map<string, HandheldRoll[]>();
  const seqFmt = await readSackSeqFormat(sh.sackSeqPrefix);
  const sackUnits = sh.sacks.filter((u) => u.unitKind === LoadUnitKind.SACK);
  const bulk = sh.sacks.find((u) => u.unitKind === LoadUnitKind.BULK) ?? null;
  const sacks: HandheldSack[] = sackUnits.map((u) => {
    const rolls = [...u.rolls.map(toRoll), ...(returned.get(u.id) ?? [])];
    const t = rollTotals(rolls);
    const label = formatSackSeqLabel(u.seq, sh.sacks.length, seqFmt);
    return {
      id: u.id, sackNo: u.sackNo, seq: u.seq, seqLabel: label || null,
      weightKg: u.weightKg != null ? Number(u.weightKg) : null, weightSource: u.weightSource,
      rollKgSum: t.kgSum, rollKgMissing: t.kgMissing, meters: t.meters, labelDirty: u.labelDirty, rolls,
    };
  });
  const looseRolls = bulk ? [...bulk.rolls.map(toRoll), ...(returned.get(bulk.id) ?? [])] : [];
  const doc = dispatched
    ? await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: sh.id, status: "ACTIVE" }, orderBy: { version: "desc" }, select: { documentNo: true } })
    : null;
  return {
    shipment: {
      id: sh.id, shipmentNo: sh.shipmentNo, status: dispatched ? "DISPATCHED" : "PLANNED", customer: sh.customer, branch: sh.branch,
      createdAt: sh.createdAt.toISOString(), dispatchedAt: sh.dispatchedAt?.toISOString() ?? null,
      plateNumber: sh.plateNumber, driverName: sh.driverName, documentNo: dispatched ? (doc?.documentNo ?? sh.shipmentNo) : null,
    },
    sacks,
    loose: { unitId: bulk?.id ?? null, rolls: looseRolls },
    summary: buildSummary(sacks, looseRolls),
  };
}

export type LiveUnit = { id: string; unitKind: LoadUnitKind; sackNo: string; warehouseId: string | null };

/** Canlı yük birimlerini kilitler (id sırası; öteki yük yollarıyla aynı düzen). */
export async function lockLiveUnitsTx(tx: Prisma.TransactionClient, shipmentId: string): Promise<LiveUnit[]> {
  return tx.$queryRaw<LiveUnit[]>`
    SELECT id, "unitKind", "sackNo", "warehouseId" FROM sacks
    WHERE "shipmentId" = ${shipmentId}::uuid AND "dissolvedAt" IS NULL ORDER BY id FOR UPDATE`;
}
