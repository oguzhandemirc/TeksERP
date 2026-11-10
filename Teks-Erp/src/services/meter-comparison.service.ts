// =============================================================================
// BEYAN ↔ ÖLÇÜLEN METRE — okuma uçlarının servisi (İE parti karşılaştırması · Tambur top izi)
// =============================================================================
// Hesap tek çözücüdedir (`helpers/meter-compare.helper.ts`); burası uç girdisini doğrular ve yanıt şeklini kurar.
// =============================================================================
import { MachineDataSource, MeterPhase, Prisma, RollStatus } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { METER_COMPARE_TOLERANCE_PCT, resolvePartyMeters, rollDeclaredMeters, type PartyMeters } from "./helpers/meter-compare.helper";
import { KURSUN_PROPERTY_CODE } from "./helpers/quality-station.helper";
import { whereRollsOfWorkOrder } from "./helpers/workorder-rolls.helper";

type Db = Prisma.TransactionClient | typeof prisma;
type D = Prisma.Decimal;
const D0 = () => new Prisma.Decimal(0);
const num = (v: D | null): number | null => (v === null ? null : Number(v.toFixed(3)));


function uuidOr400(id: unknown, message: string): string {
  const r = z.uuid().safeParse(id);
  if (!r.success) throw AppError.badRequest(message, { code: "INVALID_ID" });
  return r.data;
}

export async function getWorkOrderMeterComparison(id: unknown): Promise<MeterComparison> {
  return workOrderMeterComparison(uuidOr400(id, "Geçersiz iş emri ID"));
}

export async function getRollMeterTrail(id: unknown): Promise<RollMeterTrail> {
  return rollMeterTrail(uuidOr400(id, "Geçersiz top ID"));
}

// ── Uç şekilleri (sözleşme: alan adları değişmez) ──────────────────────────────

export interface MeterComparison {
  tolerancePct: number;
  parties: Array<Omit<PartyMeters, "rootIds" | "rollIds" | "firstAt">>;
  totals: { declaredM: number | null; measuredMaxM: number | null; billedM: number | null; diffM: number | null };
}

const sumOrNull = (vals: Array<number | null>): number | null => {
  const v = vals.filter((x): x is number => x !== null);
  return v.length === 0 ? null : Number(v.reduce((a, b) => a.plus(b), D0()).toFixed(3));
};

/** İE detayının parti satırları: İE'nin (iptal dışı) toplarının partileri. */
export async function workOrderMeterComparison(workOrderId: string, db: Db = prisma): Promise<MeterComparison> {
  const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
  if (!wo) throw AppError.notFound("İş emri bulunamadı", { code: "WORK_ORDER_NOT_FOUND" });
  const rolls = await db.roll.findMany({ where: { AND: [whereRollsOfWorkOrder(workOrderId), { status: { not: RollStatus.CANCELLED } }] }, select: { id: true } });
  const { parties } = await resolvePartyMeters(rolls.map((r) => r.id), db);
  const out = parties.map(({ rootIds: _r, rollIds: _i, firstAt: _f, ...p }) => p);
  return {
    tolerancePct: METER_COMPARE_TOLERANCE_PCT,
    parties: out,
    totals: {
      declaredM: sumOrNull(out.map((p) => p.declaredM)),
      measuredMaxM: sumOrNull(out.map((p) => p.measuredMaxM)),
      billedM: sumOrNull(out.map((p) => p.billedM)),
      diffM: sumOrNull(out.map((p) => p.diffM)),
    },
  };
}

export interface RollMeterTrail {
  rollId: string;
  declaredM: number | null;
  prior: { kind: "KURSUN_OUT" | "STATION_OUT"; stationName: string; meters: number; at: string } | null;
  referenceM: number | null;
  cutSoFarM: number;
  remainingM: number | null;
  overReference: boolean;
}

/** Tambur şeridi: topun beyanı, önceki ölçümü (kurşun çıkışı → başka ölçen istasyon), kesilen ve kalan. */
export async function rollMeterTrail(rollId: string, db: Db = prisma): Promise<RollMeterTrail> {
  const roll = await db.roll.findUnique({ where: { id: rollId }, select: { id: true } });
  if (!roll) throw AppError.notFound("Top bulunamadı", { code: "ROLL_NOT_FOUND" });
  const declared = (await rollDeclaredMeters([rollId], db)).get(rollId) ?? null;
  const outs = await db.rollMeterReading.findMany({
    where: { rollId, revokedAt: null, source: { not: MachineDataSource.SIMULATED }, phase: MeterPhase.OUT },
    select: { meters: true, createdAt: true, step: { select: { station: { select: { name: true, propertyCapabilities: { where: { property: { code: KURSUN_PROPERTY_CODE } }, select: { stationId: true }, take: 1 } } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const k = outs.find((o) => o.step.station.propertyCapabilities.length > 0);
  const hit = k ?? outs[0];
  const prior = hit ? { kind: k ? "KURSUN_OUT" as const : "STATION_OUT" as const, stationName: hit.step.station.name, meters: Number(hit.meters.toFixed(3)), at: hit.createdAt.toISOString() } : null;
  const kids = await db.roll.findMany({
    where: { parentRollId: rollId, entrySource: "TAMBUR_SPLIT", status: { not: RollStatus.CANCELLED } },
    select: { id: true, initialQty: true, meterReadings: { where: { phase: MeterPhase.CUT, revokedAt: null, source: { not: MachineDataSource.SIMULATED } }, select: { meters: true }, take: 1 } },
  });
  const cut = kids.reduce((a, c) => a.plus(c.meterReadings[0]?.meters ?? c.initialQty), D0());
  const reference = prior ? new Prisma.Decimal(prior.meters) : declared;
  const remaining = reference === null ? null : reference.minus(cut);
  return {
    rollId, declaredM: num(declared), prior, referenceM: num(reference), cutSoFarM: Number(cut.toFixed(3)),
    remainingM: num(remaining), overReference: remaining !== null && remaining.lt(0),
  };
}
