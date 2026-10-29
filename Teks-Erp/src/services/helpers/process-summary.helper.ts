// =============================================================================
// KURŞUN GRAMAJ ÖZETİ — iş emri · parti · rapor TEK kaynağı (KQ-D6, 2026-10-24)
// =============================================================================
// TABLET satırı: aktif + mirassız `KURSUN_APPLIED` (Tambur kopyası çift sayılmaz,
// düzeltilen gramajın eski satırı damgalıdır). KAĞIT satırı: tamamlanmış, iptalsiz
// `KursunBypassAssignment`ın bypass işaretli hareketleri; gramajı boşsa "bilinmiyor".
// METRAJ = o adımın hareket satırı (`qtyOut ?? qtyIn`), topun ANLIK uzunluğu DEĞİL:
// `currentQty` sonraki Tambur kesim/fire ile değişir, geçmiş gün raporu kayardı
// (test DB ölçümü `test_process_summary §0`).
// Rapor ve kartlar AYNI `listKursunApplications` + `aggregateKursunApplications`
// çiftinden geçer → sayılar bayt-eşittir; yeni SQL yok, fabrika günü `time.ts`ten.
// =============================================================================
import { Prisma, RollOperationType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryYmd } from "../../constants/time";
import { ACTIVE_OPERATION, OWN_OPERATION } from "./roll-operation.helper";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";
import { KURSUN_BYPASS_MARKER_PREFIX } from "./kursun-bypass-guard.helper";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";
import { ACTIVE_TARGET_VALUE } from "./workorder-target-value.helper";

export type KursunSource = "TABLET" | "KAGIT";
export type KursunScope =
  | { workOrderId: string }
  | { batchId: string }
  | { from: Date; to: Date; workOrderId?: string }
  /** Hizmet fiyatı çözücüsü (H6): sevkteki/faturalanacak topların uygulamaları. */
  | { rollIds: string[] };

export const UNKNOWN_GRAMAJ_LABEL = "Gramaj bilinmiyor";

/** Tek uygulama (top × adım) — rapor kırılımları bu satırdan türer. */
export interface KursunApplication {
  source: KursunSource;
  rollId: string;
  workOrderId: string;
  workOrderStepId: string;
  valueId: string | null;
  valueName: string;
  valueSortOrder: number;
  meters: Prisma.Decimal;
  at: Date;
  day: string;
  itemName: string;
  machineName: string | null;
  operatorName: string | null;
  deviatesFromTarget: boolean;
}

export interface KursunSummaryRow {
  valueId: string | null;
  valueName: string;
  source: KursunSource;
  rollCount: number;
  stepCount: number;
  meters: string;
  deviatesFromTarget: boolean;
}

export interface KursunSummary {
  target: { propertyId: string; valueId: string; valueName: string } | null;
  rows: KursunSummaryRow[];
  totals: { rollCount: number; meters: string };
}

const ROLL_SELECT = { select: { item: { select: { name: true } } } } as const;
const VALUE_SELECT = { select: { name: true, sortOrder: true, propertyId: true } } as const;

function opWhere(scope: KursunScope): Prisma.RollOperationWhereInput {
  const base = { operationType: RollOperationType.KURSUN_APPLIED, ...ACTIVE_OPERATION, ...OWN_OPERATION };
  if ("batchId" in scope) return { ...base, roll: { batchId: scope.batchId } };
  if ("rollIds" in scope) return { ...base, rollId: { in: scope.rollIds } };
  if ("from" in scope) {
    return { ...base, createdAt: { gte: scope.from, lte: scope.to }, ...(scope.workOrderId ? { step: { workOrderId: scope.workOrderId } } : {}) };
  }
  return { ...base, step: { workOrderId: scope.workOrderId } };
}

async function assignmentWhere(scope: KursunScope): Promise<Prisma.KursunBypassAssignmentWhereInput> {
  const base = { completedAt: { not: null }, cancelledAt: null };
  if ("batchId" in scope) {
    const b = await prisma.batch.findUnique({ where: { id: scope.batchId }, select: { workOrderId: true } });
    return { ...base, workOrderId: b?.workOrderId ?? "00000000-0000-0000-0000-000000000000" };
  }
  if ("rollIds" in scope) {
    // Kâğıt satırı adım düzeyindedir: topların bypass işaretli hareketlerinin adımları.
    const steps = scope.rollIds.length === 0 ? [] : await prisma.rollMovement.findMany({
      where: { ...ACTIVE_MOVEMENT, rollId: { in: scope.rollIds }, notes: { startsWith: KURSUN_BYPASS_MARKER_PREFIX } },
      select: { workOrderStepId: true }, distinct: ["workOrderStepId"],
    });
    return { ...base, workOrderStepId: { in: steps.map((m) => m.workOrderStepId) } };
  }
  if ("from" in scope) {
    return { ...base, completedAt: { gte: scope.from, lte: scope.to }, ...(scope.workOrderId ? { workOrderId: scope.workOrderId } : {}) };
  }
  return { ...base, workOrderId: scope.workOrderId };
}

/** Hareket satırı metrajı — (top, adım) için en son aktif giriş. */
async function loadMeters(pairs: Array<{ rollId: string; stepId: string }>): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (pairs.length === 0) return out;
  const moves = await prisma.rollMovement.findMany({
    where: { ...ACTIVE_MOVEMENT, rollId: { in: [...new Set(pairs.map((p) => p.rollId))] }, workOrderStepId: { in: [...new Set(pairs.map((p) => p.stepId))] } },
    select: { rollId: true, workOrderStepId: true, qtyIn: true, qtyOut: true },
    orderBy: { enteredAt: "asc" },
  });
  for (const m of moves) out.set(`${m.rollId}:${m.workOrderStepId}`, m.qtyOut ?? m.qtyIn);
  return out;
}

/** İE başına aktif hedefler: `${workOrderId}:${propertyId}` → valueId. */
async function loadTargets(workOrderIds: string[]): Promise<Map<string, string>> {
  const rows = workOrderIds.length === 0 ? [] : await prisma.workOrderTargetValue.findMany({
    where: { workOrderId: { in: workOrderIds }, ...ACTIVE_TARGET_VALUE },
    select: { workOrderId: true, propertyId: true, valueId: true },
  });
  return new Map(rows.map((r) => [`${r.workOrderId}:${r.propertyId}`, r.valueId]));
}

async function listTablet(scope: KursunScope) {
  const ops = await prisma.rollOperation.findMany({
    where: { ...ACTIVE_OPERATION, ...opWhere(scope) },
    select: {
      rollId: true, workOrderStepId: true, propertyValueId: true, createdAt: true,
      step: { select: { workOrderId: true } },
      roll: ROLL_SELECT,
      propertyValue: VALUE_SELECT,
      machine: { select: { name: true } },
      operator: { select: { fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return ops.map((o) => ({
    source: "TABLET" as const, rollId: o.rollId, workOrderId: o.step.workOrderId, workOrderStepId: o.workOrderStepId,
    valueId: o.propertyValueId, value: o.propertyValue, at: o.createdAt, itemName: o.roll.item.name,
    machineName: o.machine?.name ?? null, operatorName: o.operator?.fullName ?? null,
  }));
}

async function listKagit(scope: KursunScope) {
  const assignments = await prisma.kursunBypassAssignment.findMany({
    where: await assignmentWhere(scope),
    select: { workOrderId: true, workOrderStepId: true, propertyValueId: true, completedAt: true, propertyValue: VALUE_SELECT, machine: { select: { name: true } } },
  });
  if (assignments.length === 0) return [];
  const moves = await prisma.rollMovement.findMany({
    where: {
      ...ACTIVE_MOVEMENT,
      workOrderStepId: { in: assignments.map((a) => a.workOrderStepId) },
      notes: { startsWith: KURSUN_BYPASS_MARKER_PREFIX },
      ...("batchId" in scope ? { roll: { batchId: scope.batchId } } : {}),
      ...("rollIds" in scope ? { rollId: { in: scope.rollIds } } : {}),
    },
    select: { rollId: true, workOrderStepId: true, exitedAt: true, roll: ROLL_SELECT },
    orderBy: { enteredAt: "asc" },
  });
  return moves.map((m) => {
    const a = assignments.find((x) => x.workOrderStepId === m.workOrderStepId)!;
    return {
      source: "KAGIT" as const, rollId: m.rollId, workOrderId: a.workOrderId, workOrderStepId: m.workOrderStepId,
      valueId: a.propertyValueId, value: a.propertyValue, at: m.exitedAt ?? a.completedAt!, itemName: m.roll.item.name,
      machineName: a.machine.name, operatorName: null,
    };
  });
}

/** Kapsamdaki tüm uygulamalar (TABLET + KAĞIT), metraj ve hedef sapmasıyla. */
export async function listKursunApplications(scope: KursunScope): Promise<KursunApplication[]> {
  const raw = [...(await listTablet(scope)), ...(await listKagit(scope))];
  const meters = await loadMeters(raw.map((r) => ({ rollId: r.rollId, stepId: r.workOrderStepId })));
  const targets = await loadTargets([...new Set(raw.map((r) => r.workOrderId))]);
  return raw.map((r) => {
    const target = r.value ? targets.get(`${r.workOrderId}:${r.value.propertyId}`) : undefined;
    return {
      source: r.source, rollId: r.rollId, workOrderId: r.workOrderId, workOrderStepId: r.workOrderStepId,
      valueId: r.valueId, valueName: r.value?.name ?? UNKNOWN_GRAMAJ_LABEL, valueSortOrder: r.value?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      meters: meters.get(`${r.rollId}:${r.workOrderStepId}`) ?? new Prisma.Decimal(0),
      at: r.at, day: factoryYmd(r.at), itemName: r.itemName, machineName: r.machineName, operatorName: r.operatorName,
      deviatesFromTarget: target !== undefined && r.valueId !== null && r.valueId !== target,
    };
  });
}

/** Satırları (kaynak × gramaj) grubuna indirger — kart, parti izi ve rapor şeridi bunu kullanır. */
export function aggregateKursunApplications(apps: KursunApplication[]): Omit<KursunSummary, "target"> {
  const groups = new Map<string, KursunSummaryRow & { sort: number; meterSum: Prisma.Decimal; steps: Set<string> }>();
  let total = new Prisma.Decimal(0);
  for (const a of apps) {
    const key = `${a.source}:${a.valueId ?? "-"}`;
    const g = groups.get(key) ?? {
      valueId: a.valueId, valueName: a.valueName, source: a.source, rollCount: 0, stepCount: 0, meters: "0.00",
      deviatesFromTarget: false, sort: a.valueSortOrder, meterSum: new Prisma.Decimal(0), steps: new Set<string>(),
    };
    g.rollCount += 1;
    g.meterSum = g.meterSum.plus(a.meters);
    g.steps.add(a.workOrderStepId);
    g.deviatesFromTarget ||= a.deviatesFromTarget;
    groups.set(key, g);
    total = total.plus(a.meters);
  }
  const rows = [...groups.values()]
    .sort((x, y) => (x.source === y.source ? x.sort - y.sort || x.valueName.localeCompare(y.valueName, "tr") : x.source === "TABLET" ? -1 : 1))
    .map(({ sort: _s, meterSum, steps, ...r }) => ({ ...r, stepCount: steps.size, meters: meterSum.toFixed(2) }));
  return { rows, totals: { rollCount: apps.length, meters: total.toFixed(2) } };
}

/** İE'nin kurşun gramajı çeşit özelliğindeki aktif hedefi (yoksa null). */
export async function readKursunTarget(workOrderId: string): Promise<KursunSummary["target"]> {
  const row = await prisma.workOrderTargetValue.findFirst({
    where: { workOrderId, ...ACTIVE_TARGET_VALUE, property: { variantOf: { code: KURSUN_PROPERTY_CODE } } },
    select: { propertyId: true, valueId: true, value: { select: { name: true } } },
  });
  return row ? { propertyId: row.propertyId, valueId: row.valueId, valueName: row.value.name } : null;
}

/** İE / parti / tarih aralığı için gramaj özeti (+ İE kapsamında hedef). */
export async function summarizeKursunApplications(scope: KursunScope): Promise<KursunSummary> {
  const apps = await listKursunApplications(scope);
  let target: KursunSummary["target"] = null;
  if ("workOrderId" in scope && scope.workOrderId && !("from" in scope)) target = await readKursunTarget(scope.workOrderId);
  if ("batchId" in scope) {
    const b = await prisma.batch.findUnique({ where: { id: scope.batchId }, select: { workOrderId: true } });
    if (b) target = await readKursunTarget(b.workOrderId);
  }
  return { target, ...aggregateKursunApplications(apps) };
}
