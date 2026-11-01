// =============================================================================
// DOKUMA GERÇEK MALİYETİ — TEK KAYNAK (SY-D3; TASARIM-2026-10-31 §5.5 madde 2, K7)
// =============================================================================
// Pay = Σ koşum makine-saat maliyeti; "saat × ücret" ve as-of ücret Gülkesim kârlılık hattının paylaşılan
// fonksiyonlarından (`profitability-machine.helper`: machineRateAt · normHours · machineHourCostTry) — burada
// ikinci çarpım YAZILMAZ (bekçi `test_dokuma_gercek_maliyet` §6 ölçer). Payda = işin CANLI top metresi, A + B
// yolu (`liveRollMetersByWeavingOrder`; iptal topu girmez). Saklanmaz, her okumada türer (S3 RED: koşum geri
// alınabilir, metre düzeltilebilir). Bilinmeyen değer 0 DEĞİLDİR: null + eksik kodu.
// Süre kaynağı ikinci ayar açmaz (§15.1 notu): `maliyet.karlilik.makineSuresi` NORM ise metre ÷ norm, diğer
// kiplerde (OTURUM varsayılan · VARDIYA) tezgâhın süresi KOŞUMDUR (`KOSUM`).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ProfitMachineTimeMode } from "../system-setting.service";
import { machineCostRateHistory } from "./cost-rate-validity.helper";
import { machineHourCostTry, machineRateAt, normHours } from "./profitability-machine.helper";
import { liveRollMetersByWeavingOrder } from "./weaving-order-of-roll.helper";

type Dec = Prisma.Decimal;
type Db = Prisma.TransactionClient | typeof prisma;
const D0 = () => new Prisma.Decimal(0);
const HOUR_MS = 3_600_000;

export type WeavingTimeSource = "KOSUM" | "NORM";
export type WeavingActualMissing =
  | "FASON" | "KOSUM_YOK" | "MAKINE_TARIFESI" | "MAKINE_NORMU" | "KOSUM_METRESI" | "TOP_YOK" | "STANDART_YOK";

/** Standart maliyetin DOKUMA satırları (tezgah saati yöntemi üç satır, atkı ücreti yöntemi tek satır). */
export const WEAVING_STANDARD_COMPONENTS = ["LOOM_MACHINE", "LOOM_LABOR", "ENERGY", "WEAVING_PICK"] as const;

export interface WeavingActualCost {
  weavingOrderId: string;
  weavingOrderNumber: string;
  itemId: string;
  itemLabel: string;
  status: string;
  executionKind: string;
  machines: Array<{ id: string; code: string }>;
  timeSource: WeavingTimeSource;
  runCount: number;
  openRunCount: number;
  machineHours: Dec | null;
  actualCostTry: Dec | null;
  metersViaRun: Dec;
  metersViaOrder: Dec;
  totalMeters: Dec;
  actualPerMTry: Dec | null;
  standardPerMTry: Dec | null;
  standardPick: boolean;
  theoreticalMPerHour: Dec | null;
  realizedMPerHour: Dec | null;
  /** Koşum içi duruş süresi ÷ koşum süresi (yalnız kapanmış koşumlar; hiç yoksa null). */
  stopShare: Dec | null;
  ongoing: boolean;
  missing: WeavingActualMissing[];
}

export function weavingTimeSourceOf(mode: ProfitMachineTimeMode): WeavingTimeSource {
  return mode === "NORM" ? "NORM" : "KOSUM";
}

/** Aralıkta koşumu ya da A/B yolundan doğan topu olan iptalsiz işler (rapor satır kümesi). */
export async function weavingOrdersActiveIn(db: Db, range: { from: Date; to: Date }): Promise<string[]> {
  const rows = await db.weavingOrder.findMany({
    where: {
      status: { not: "CANCELLED" },
      OR: [
        { machineRuns: { some: { revokedAt: null, startedAt: { lt: range.to }, OR: [{ endedAt: null }, { endedAt: { gte: range.from } }] } } },
        { rolls: { some: { createdAt: { gte: range.from, lt: range.to } } } },
        { machineRuns: { some: { revokedAt: null, doffEvents: { some: { revokedAt: null, rolls: { some: { createdAt: { gte: range.from, lt: range.to } } } } } } } },
      ],
    },
    select: { id: true },
    orderBy: { weavingOrderNumber: "asc" },
  });
  return rows.map((r) => r.id);
}

type RunRow = { machineId: string; startedAt: Date; endedAt: Date | null; producedM: Dec | null; stopSecAtClose: number | null };
type RateList = Awaited<ReturnType<typeof machineCostRateHistory>>;

/** Koşum toplamları: süre ve maliyet (biri bilinmezse null — kısmi toplam 0 sayılmaz), duruş payı terimleri. */
function runTotals(runs: RunRow[], ctx: { rates: RateList; timeSource: WeavingTimeSource; now: Date; missing: WeavingActualMissing[] }) {
  const { rates, timeSource, now, missing } = ctx;
  let hours: Dec | null = D0();
  let cost: Dec | null = D0();
  let runSec = 0;
  let stopSec = 0;
  let closedRuns = 0;
  for (const r of runs) {
    const rate = machineRateAt(rates, r.machineId, r.startedAt);
    let h: Dec | null;
    if (timeSource === "NORM") {
      h = r.producedM === null ? null : normHours(r.producedM, rate);
      if (r.producedM === null) missing.push("KOSUM_METRESI");
      else if (!h) missing.push("MAKINE_NORMU");
    } else {
      h = new Prisma.Decimal((r.endedAt ?? now).getTime() - r.startedAt.getTime()).div(HOUR_MS);
    }
    if (!rate) missing.push("MAKINE_TARIFESI");
    const c = machineHourCostTry(h, rate);
    hours = hours && h ? hours.plus(h) : null;
    cost = cost && c ? cost.plus(c) : null;
    if (r.endedAt && r.stopSecAtClose !== null) {
      closedRuns += 1;
      runSec += (r.endedAt.getTime() - r.startedAt.getTime()) / 1000;
      stopSec += r.stopSecAtClose;
    }
  }
  return { hours, cost, runSec, stopSec, closedRuns };
}

/** İş başına gerçek ve standart dokuma TL/m. Sıra `weavingOrderIds` sırasıdır. */
export async function weavingActualCostTx(
  db: Db, weavingOrderIds: string[], mode: ProfitMachineTimeMode, now: Date = new Date(),
): Promise<WeavingActualCost[]> {
  if (weavingOrderIds.length === 0) return [];
  const timeSource = weavingTimeSourceOf(mode);
  const orders = await db.weavingOrder.findMany({
    where: { id: { in: weavingOrderIds } },
    select: {
      id: true, weavingOrderNumber: true, itemId: true, recipeId: true, status: true, executionKind: true,
      item: { select: { code: true, name: true } },
      machineRuns: {
        where: { revokedAt: null },
        select: { machineId: true, startedAt: true, endedAt: true, producedM: true, stopSecAtClose: true, machine: { select: { code: true } } },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      },
    },
  });
  const meters = await liveRollMetersByWeavingOrder(db, weavingOrderIds);
  const machineIds = [...new Set(orders.flatMap((o) => o.machineRuns.map((r) => r.machineId)))].sort();
  const rates = await machineCostRateHistory(db, machineIds);
  const itemIds = [...new Set(orders.map((o) => o.itemId))];
  // SY-N3: varyantlı işte varyantın ACTIVE sürümü önce; yoksa desen geneli (recipeId null) sürüm — varyantsızda bugünkü sorgu.
  const recipeIds = [...new Set(orders.flatMap((o) => (o.recipeId ? [o.recipeId] : [])))];
  const versions = await db.standardCostVersion.findMany({
    where: { itemId: { in: itemIds }, recipeId: null, status: "ACTIVE" },
    select: { itemId: true, loomMPerHour: true, lines: { where: { component: { in: [...WEAVING_STANDARD_COMPONENTS] } }, select: { component: true, amountPerMTry: true } } },
  });
  const variantVersions = recipeIds.length === 0 ? [] : await db.standardCostVersion.findMany({
    where: { itemId: { in: itemIds }, recipeId: { in: recipeIds }, status: "ACTIVE" },
    select: { itemId: true, recipeId: true, loomMPerHour: true, lines: { where: { component: { in: [...WEAVING_STANDARD_COMPONENTS] } }, select: { component: true, amountPerMTry: true } } },
  });
  const genericOf = new Map(versions.map((v) => [v.itemId, v]));
  const variantOf = new Map(variantVersions.map((v) => [`${v.itemId}|${v.recipeId}`, v]));
  const versionOf = (o: { itemId: string; recipeId: string | null }) =>
    (o.recipeId ? variantOf.get(`${o.itemId}|${o.recipeId}`) : undefined) ?? genericOf.get(o.itemId);
  const byId = new Map(orders.map((o) => [o.id, o]));

  return weavingOrderIds.flatMap((id) => {
    const o = byId.get(id);
    if (!o) return [];
    const missing: WeavingActualMissing[] = [];
    const m = meters.get(id) ?? { viaRun: D0(), viaOrder: D0() };
    const totalMeters = m.viaRun.plus(m.viaOrder);
    const v = versionOf(o);
    const standardPerMTry = v ? v.lines.reduce((a, l) => a.plus(l.amountPerMTry), D0()) : null;
    if (!v) missing.push("STANDART_YOK");

    const { hours, cost, runSec, stopSec, closedRuns } = runTotals(o.machineRuns, { rates, timeSource, now, missing });
    const fason = o.executionKind === "SUBCONTRACTED";
    if (fason) missing.push("FASON");
    else if (o.machineRuns.length === 0) missing.push("KOSUM_YOK");
    if (totalMeters.lte(0)) missing.push("TOP_YOK");
    const measurable = !fason && o.machineRuns.length > 0;
    const actualCostTry = measurable ? cost : null;
    const machineHours = measurable ? hours : null;
    const machines = [...new Map(o.machineRuns.map((r) => [r.machineId, { id: r.machineId, code: r.machine.code }])).values()];
    return [{
      weavingOrderId: o.id,
      weavingOrderNumber: o.weavingOrderNumber,
      itemId: o.itemId,
      itemLabel: `${o.item.code} · ${o.item.name}`,
      status: o.status,
      executionKind: o.executionKind,
      machines,
      timeSource,
      runCount: o.machineRuns.length,
      openRunCount: o.machineRuns.filter((r) => r.endedAt === null).length,
      machineHours,
      actualCostTry,
      metersViaRun: m.viaRun,
      metersViaOrder: m.viaOrder,
      totalMeters,
      actualPerMTry: actualCostTry && totalMeters.gt(0) ? actualCostTry.div(totalMeters) : null,
      standardPerMTry,
      standardPick: v?.lines.some((l) => l.component === "WEAVING_PICK") ?? false,
      theoreticalMPerHour: v?.loomMPerHour ?? null,
      realizedMPerHour: machineHours && machineHours.gt(0) && totalMeters.gt(0) ? totalMeters.div(machineHours) : null,
      stopShare: closedRuns > 0 && runSec > 0 ? new Prisma.Decimal(stopSec).div(runSec) : null,
      ongoing: o.status !== "COMPLETED" || o.machineRuns.some((r) => r.endedAt === null),
      missing: [...new Set(missing)],
    }];
  });
}
