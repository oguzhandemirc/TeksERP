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
import { readFilterList } from "../utils/query-parser";
import { rollWorkOrderEdgesSql, whereRollsOfWorkOrder } from "./helpers/workorder-rolls.helper";

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

type PartyOut = Omit<PartyMeters, "rootIds" | "rollIds" | "firstAt">;

/** İE toplamı — tekil uç (`totals`) ve liste özeti (`meterSummary`) AYNI fonksiyondan; ikinci formül yok. */
export function meterTotalsOf(parties: PartyOut[]): MeterComparison["totals"] {
  return {
    declaredM: sumOrNull(parties.map((p) => p.declaredM)),
    measuredMaxM: sumOrNull(parties.map((p) => p.measuredMaxM)),
    billedM: sumOrNull(parties.map((p) => p.billedM)),
    diffM: sumOrNull(parties.map((p) => p.diffM)),
  };
}

const stripParty = ({ rootIds: _r, rollIds: _i, firstAt: _f, ...p }: PartyMeters): PartyOut => p;

/** İE detayının parti satırları: İE'nin (iptal dışı) toplarının partileri. */
export async function workOrderMeterComparison(workOrderId: string, db: Db = prisma): Promise<MeterComparison> {
  const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
  if (!wo) throw AppError.notFound("İş emri bulunamadı", { code: "WORK_ORDER_NOT_FOUND" });
  const rolls = await db.roll.findMany({ where: { AND: [whereRollsOfWorkOrder(workOrderId), { status: { not: RollStatus.CANCELLED } }] }, select: { id: true } });
  const { parties } = await resolvePartyMeters(rolls.map((r) => r.id), db);
  const out = parties.map(stripParty);
  return { tolerancePct: METER_COMPARE_TOLERANCE_PCT, parties: out, totals: meterTotalsOf(out) };
}

// ── İE LİSTESİ: satır başına toplu metre özeti + "Beyandan uzun" süzgeci ─────────

type MeterTotals = MeterComparison["totals"];
export interface WorkOrderMeterSummary extends MeterTotals {
  /** Ölçülmüş partilerin Σ farkı ÷ Σ beyanı (%); ölçüm yoksa null. */
  diffPct: number | null;
  /** Ölçülmüş her parti tolerans içinde (en az bir ölçülmüş parti varken). */
  withinTolerance: boolean;
  /** En az bir partide ölçülen beyandan tolerans dışı uzun (faturalanan > beyan). */
  longerThanDeclared: boolean;
}

/**
 * Sayfadaki İE'lerin metre özeti — İE başına sorgu YOK: bütün İE'lerin (iptal dışı) topları tek kenar sorgusuyla,
 * partiler TEK `resolvePartyMeters` çağrısıyla. Parti sonucu tohumdan bağımsızdır (parti = kök yapısı), bu yüzden
 * İE'nin parti kümesi tekil uçtakiyle aynıdır (`test_ie_liste_metre` §1 ölçer). Partisi olmayan İE → null.
 */
export async function workOrderMeterSummaries(workOrderIds: string[], db: Db = prisma): Promise<Map<string, WorkOrderMeterSummary | null>> {
  const ids = [...new Set(workOrderIds)];
  const out = new Map<string, WorkOrderMeterSummary | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return out;
  const edges = await db.$queryRaw<Array<{ roll_id: string; wo_id: string }>>(Prisma.sql`
    SELECT e.roll_id, e.wo_id FROM (${rollWorkOrderEdgesSql(Prisma.sql`r.status <> 'CANCELLED'`)}) e
    WHERE e.wo_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
  if (edges.length === 0) return out;
  const { parties, partyOfRoll } = await resolvePartyMeters([...new Set(edges.map((e) => e.roll_id))], db);
  const byKey = new Map(parties.map((p) => [p.partyKey, stripParty(p)]));
  const keysOf = new Map<string, Set<string>>();
  for (const e of edges) {
    const k = partyOfRoll.get(e.roll_id);
    if (k === undefined) continue;
    keysOf.set(e.wo_id, (keysOf.get(e.wo_id) ?? new Set()).add(k));
  }
  for (const [woId, keys] of keysOf) {
    const ps = [...keys].map((k) => byKey.get(k)).filter((p): p is PartyOut => p !== undefined);
    if (ps.length === 0) continue;
    const measured = ps.filter((p) => p.diffM !== null);
    const measuredDeclared = sumOrNull(measured.map((p) => p.declaredM));
    const totals = meterTotalsOf(ps);
    out.set(woId, {
      ...totals,
      diffPct: totals.diffM !== null && measuredDeclared ? Number(new Prisma.Decimal(totals.diffM).div(measuredDeclared).mul(100).toFixed(2)) : null,
      withinTolerance: measured.length > 0 && measured.every((p) => p.withinTolerance),
      longerThanDeclared: ps.some((p) => p.longerThanDeclared),
    });
  }
  return out;
}

/** `filter[meterCheck]` değerleri: yalnız LONGER (beyandan uzun). Boş = süzgeç yok; tanınmayan 400 (fail-closed). */
export const METER_CHECK_VALUES = ["LONGER"] as const;
export type MeterCheck = (typeof METER_CHECK_VALUES)[number];
/** Süzgeç adayı üst sınırı — üstünde sessiz kırpma yerine 400 (tarih/süzgeçle daraltılır). */
export const METER_CHECK_MAX_CANDIDATES = 2000;

export function readMeterCheckFilter(value: string | string[] | undefined): MeterCheck | null {
  const list = readFilterList(value);
  if (list.length === 0) return null;
  const bad = list.filter((v) => !(METER_CHECK_VALUES as readonly string[]).includes(v));
  if (bad.length > 0) throw AppError.badRequest(`Tanınmayan metre süzgeci: ${bad.join(", ")}`, { code: "INVALID_FILTER_VALUE", field: "meterCheck", allowed: [...METER_CHECK_VALUES] });
  return "LONGER";
}

/**
 * "Beyandan uzun" hesaplanmış bir değerdir (parti beyanı ↔ en büyük ölçüm), where ile yazılamaz: taban where'in
 * İE'leri (≤ üst sınır) özet çözücüsünden geçer, uzun olanlar `id IN` olarak geri döner — liste, cursor ve sayım
 * aynı where'i görür. Aday sayısı üst sınırı aşarsa 400 `METER_FILTER_TOO_BROAD`.
 */
export async function meterCheckWhere(base: Prisma.WorkOrderWhereInput, db: Db = prisma): Promise<Prisma.WorkOrderWhereInput> {
  const cands = await db.workOrder.findMany({ where: base, select: { id: true }, take: METER_CHECK_MAX_CANDIDATES + 1 });
  if (cands.length > METER_CHECK_MAX_CANDIDATES) {
    throw AppError.badRequest(`"Beyandan uzun" süzgeci en çok ${METER_CHECK_MAX_CANDIDATES} kayıtta çalışır; tarih ya da başka süzgeçle daraltın.`, { code: "METER_FILTER_TOO_BROAD", max: METER_CHECK_MAX_CANDIDATES });
  }
  const sums = await workOrderMeterSummaries(cands.map((c) => c.id), db);
  return { id: { in: [...sums].filter(([, s]) => s?.longerThanDeclared).map(([id]) => id) } };
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
