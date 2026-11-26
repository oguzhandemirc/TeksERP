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
// Devere payı (`warping*`) ve çözgü ipliği payı (`warpYarn*`, dilim 3) ayrı alanlardır, köprüden okunur
// (`loadRollWarpingCosts` · `loadRollWarpYarnCosts`); tezgâh sayıları değişmez. Atkı ipliği payı (`weftYarn*`, K7)
// norm miktar × gerçek fiyattır (`loadRollWeftYarnCosts`; atkının topa lot bağı yok).
// =============================================================================
import { Prisma, type CostComponent } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ProfitMachineTimeMode } from "../system-setting.service";
import { machineCostRateHistory } from "./cost-rate-validity.helper";
import { machineHourCostTry, machineRateAt, normHours } from "./profitability-machine.helper";
import { liveRollMetersByWeavingOrder, liveRollsByWeavingOrder } from "./weaving-order-of-roll.helper";
import { loadRollWarpingCosts, loadRollWarpYarnCosts, loadRollWeftYarnCosts } from "./maliyet-bridge.helper";

type Dec = Prisma.Decimal;
type Db = Prisma.TransactionClient | typeof prisma;
const D0 = () => new Prisma.Decimal(0);
const HOUR_MS = 3_600_000;

export type WeavingTimeSource = "KOSUM" | "NORM";
export type WeavingActualMissing =
  | "FASON" | "KOSUM_YOK" | "MAKINE_TARIFESI" | "MAKINE_NORMU" | "KOSUM_METRESI" | "TOP_YOK" | "STANDART_YOK"
  | "DEVERE_UCRETI" | "DEVERE_FATURASI" | "COZGU_TUKETIMI" | "LEVENT_KOKENI" | "FX_RATE_MISSING" | "IPLIK_FIYATI"
  /** SY-N4 BİLGİ (eksik değil): varyantın sürümü yok, standart desen genelinden — rakam varyantın değil, sessiz kalmasın. */
  | "VARYANT_STANDART_YOK"
  /** BİLGİ: çözgü ipliği müşteri malı (müşteri ipliğiyle devere) — bizim maliyetimize girmez, "eksik" değildir. */
  | "MUSTERI_IPLIGI"
  /** Atkı ipliği (K7): fiyat yok · standart sürümde atkı satırı (norm) yok. */
  | "ATKI_FIYATI" | "ATKI_NORMU";
/** Devere payının kaynağı: onaylı fatura · siparişteki ücretten tahmin · ikisi karışık. */
export type WeavingWarpingSource = "FATURA" | "TARIFE" | "KARMA";
/** Çözgü ipliği payının kaynağı: lot (mal kabul) fiyatı · maliyet kartı iplik fiyatı (tahmini) · ikisi karışık. */
export type WeavingWarpYarnSource = "LOT" | "MALIYET_FIYATI" | "KARMA";

/** Satırı "eksik" yapmayan bilgi kodları — rapor notu olarak düşer. */
export const WEAVING_INFO_CODES: readonly WeavingActualMissing[] = ["VARYANT_STANDART_YOK", "MUSTERI_IPLIGI"];

/** Çözgü ipliğinin tamamı müşteri malı: pay "0 TL" değil, sayı yok + bilgi kodu (karışıkta kendi payımız kalır). */
function customerYarnOnly<S>(y: Covered<S>): Covered<S> {
  const only = y.source === null && y.costTry !== null && y.costTry.isZero() && y.missing?.includes("MUSTERI_IPLIGI") === true;
  return only ? { ...y, costTry: null, perMTry: null, estimatedTry: null } : y;
}

/** Standart sürüm boşluğu: hiç yok → eksik; varyantlı iş desen geneline düştü → bilgi. */
function standardGaps(found: boolean, hasRecipe: boolean, variantHit: boolean): WeavingActualMissing[] {
  if (!found) return ["STANDART_YOK"];
  return hasRecipe && !variantHit ? ["VARYANT_STANDART_YOK"] : [];
}

/** Standart maliyetin DOKUMA satırları (tezgah saati yöntemi üç satır, atkı ücreti yöntemi tek satır). */
export const WEAVING_STANDARD_COMPONENTS = ["LOOM_MACHINE", "LOOM_LABOR", "ENERGY", "WEAVING_PICK"] as const;
/** Okunan satırlar: dokuma + çözgü ipliği (dilim 3 karşılığı); dokuma toplamı yalnız `WEAVING_STANDARD_COMPONENTS`. */
const STANDARD_READ_COMPONENTS: CostComponent[] = [...WEAVING_STANDARD_COMPONENTS, "WARP_YARN", "WEFT_YARN"];
const LINE_SELECT = { component: true, amountPerMTry: true, yarnItemId: true, qty: true, qtyUnit: true } as const;
const isWeavingComponent = (c: string): boolean => (WEAVING_STANDARD_COMPONENTS as readonly string[]).includes(c);

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
  // Devere payı (tezgâh sapması ana sayısına GİRMEZ, K9). Devere modülü kapalıysa hepsi null.
  /** Çözgü tüketimi bağlı topların devere maliyeti, TL (bir pay bilinmiyorsa null). */
  warpingCostTry: Dec | null;
  /** `warpingCostTry` ÷ `warpingCoveredMeters`. */
  warpingPerMTry: Dec | null;
  /** Tüketim satırı (CONSUMED) olan canlı topların kumaş metresi — devere payının paydası. */
  warpingCoveredMeters: Dec | null;
  /** null = fason devere payı yok (yalnız kendi devere leventi) ya da ölçülemedi. */
  warpingSource: WeavingWarpingSource | null;
  /** Payın tahmini (faturasız kabul) kısmı, TL. */
  warpingEstimatedTry: Dec | null;
  /** Yalnız devere payının eksikleri — ana `missing` (tezgâh) bunlardan etkilenmez. */
  warpingMissing: WeavingActualMissing[] | null;
  // Çözgü ipliği payı (dilim 3; aynı tüketim kapsamı, tezgâh sapmasına GİRMEZ). Devere modülü kapalıysa hepsi null.
  /** Standart sürümün çözgü ipliği satırları toplamı (TL/m); sürüm yoksa null. */
  standardWarpYarnPerMTry: Dec | null;
  warpYarnCostTry: Dec | null;
  warpYarnPerMTry: Dec | null;
  warpYarnCoveredMeters: Dec | null;
  warpYarnSource: WeavingWarpYarnSource | null;
  /** Maliyet kartı fiyatından (lot fiyatı yok) gelen kısım, TL. */
  warpYarnEstimatedTry: Dec | null;
  warpYarnMissing: WeavingActualMissing[] | null;
  // Atkı ipliği payı (K7): miktar standart sürümün atkı NORMU × canlı top metresi, fiyat gerçek; devereden bağımsız.
  /** Standart sürümün atkı ipliği satırları toplamı (TL/m); sürüm yoksa null. */
  standardWeftYarnPerMTry: Dec | null;
  weftYarnCostTry: Dec | null;
  weftYarnPerMTry: Dec | null;
  weftYarnCoveredMeters: Dec | null;
  weftYarnSource: WeavingWarpYarnSource | null;
  weftYarnEstimatedTry: Dec | null;
  weftYarnMissing: WeavingActualMissing[] | null;
}

type RollShare = { costTry: Dec | null; estimatedTry: Dec; sources: string[]; missing: WeavingActualMissing[] };
type Covered<S> = { costTry: Dec | null; perMTry: Dec | null; coveredMeters: Dec | null; source: S | null; estimatedTry: Dec | null; missing: WeavingActualMissing[] | null };
const NOT_COVERED: Covered<never> = { costTry: null, perMTry: null, coveredMeters: null, source: null, estimatedTry: null, missing: null };

/** İşin canlı toplarından tüketim payı: tüketimi olmayan top paya da paydaya da girmez (`COZGU_TUKETIMI`, uydurma 0 yok). */
function coveredShare<S extends string>(rolls: Array<{ id: string; initialQty: Dec }>, costs: Map<string, RollShare>, pair: readonly [S, S], mixed: S): Covered<S> {
  const missing = new Set<WeavingActualMissing>();
  const sources = new Set<string>();
  let cost: Dec | null = D0();
  let estimated = D0();
  let covered = D0();
  for (const r of rolls) {
    const c = costs.get(r.id);
    if (!c) { missing.add("COZGU_TUKETIMI"); continue; }
    covered = covered.plus(r.initialQty);
    cost = cost && c.costTry ? cost.plus(c.costTry) : null;
    estimated = estimated.plus(c.estimatedTry);
    c.sources.forEach((s) => sources.add(s));
    c.missing.forEach((m) => missing.add(m));
  }
  const measurable = covered.gt(0);
  const source: S | null = sources.has(pair[0]) && sources.has(pair[1]) ? mixed : sources.has(pair[0]) ? pair[0] : sources.has(pair[1]) ? pair[1] : null;
  return {
    costTry: measurable ? cost : null,
    perMTry: measurable && cost ? cost.div(covered) : null,
    coveredMeters: covered,
    source: measurable && cost ? source : null,
    estimatedTry: measurable && cost ? estimated : null,
    missing: [...missing],
  };
}

type LiveRolls = Awaited<ReturnType<typeof liveRollsByWeavingOrder>>;
type WeftLine = { component: string; yarnItemId: string | null; qty: Dec | null; qtyUnit: string | null };
type WeftFields = Pick<WeavingActualCost,
  "weftYarnCostTry" | "weftYarnPerMTry" | "weftYarnCoveredMeters" | "weftYarnSource" | "weftYarnEstimatedTry" | "weftYarnMissing">;

/** İş başına atkı ipliği alanları: sürümün atkı satırı normu × her canlı topun metresi; normsuz iş `ATKI_NORMU` (0 değil). */
async function weftFieldsFor(db: Db, liveRolls: LiveRolls, linesOf: (id: string) => WeftLine[] | null): Promise<(id: string) => WeftFields> {
  const normOf = (id: string) => (linesOf(id) ?? []).flatMap((l) => (l.component === "WEFT_YARN" && l.yarnItemId && l.qty ? [{ yarnItemId: l.yarnItemId, qty: l.qty, qtyUnit: l.qtyUnit }] : []));
  const input = [...liveRolls.entries()].flatMap(([id, rolls]) => rolls.map((r) => ({ rollId: r.id, lines: normOf(id) })));
  const costs = await loadRollWeftYarnCosts(db, input);
  return (id) => {
    const rolls = liveRolls.get(id) ?? [];
    const f = rolls.length > 0 && normOf(id).length === 0
      ? { ...NOT_COVERED, coveredMeters: D0(), missing: ["ATKI_NORMU"] as WeavingActualMissing[] }
      : customerYarnOnly(coveredShare(rolls, costs, ["LOT", "MALIYET_FIYATI"] as const, "KARMA"));
    return { weftYarnCostTry: f.costTry, weftYarnPerMTry: f.perMTry, weftYarnCoveredMeters: f.coveredMeters, weftYarnSource: f.source, weftYarnEstimatedTry: f.estimatedTry, weftYarnMissing: f.missing };
  };
}

type WarpFields = Pick<WeavingActualCost,
  | "warpingCostTry" | "warpingPerMTry" | "warpingCoveredMeters" | "warpingSource" | "warpingEstimatedTry" | "warpingMissing"
  | "warpYarnCostTry" | "warpYarnPerMTry" | "warpYarnCoveredMeters" | "warpYarnSource" | "warpYarnEstimatedTry" | "warpYarnMissing">;

/** İş başına devere + çözgü ipliği alanları; devere kapalıysa (köprü null) hepsi null. Payda kümesi tezgâh maliyetiyle aynı (canlı top). */
async function warpFieldsFor(db: Db, liveRolls: LiveRolls): Promise<(id: string) => WarpFields> {
  const rollIds = [...liveRolls.values()].flat().map((r) => r.id);
  const fees = await loadRollWarpingCosts(db, rollIds);
  const yarns = fees ? await loadRollWarpYarnCosts(db, rollIds) : null;
  return (id) => {
    const rolls = liveRolls.get(id) ?? [];
    const w = fees ? coveredShare(rolls, fees, ["FATURA", "TARIFE"] as const, "KARMA") : NOT_COVERED;
    const y = yarns ? customerYarnOnly(coveredShare(rolls, yarns, ["LOT", "MALIYET_FIYATI"] as const, "KARMA")) : NOT_COVERED;
    return {
      warpingCostTry: w.costTry, warpingPerMTry: w.perMTry, warpingCoveredMeters: w.coveredMeters, warpingSource: w.source, warpingEstimatedTry: w.estimatedTry, warpingMissing: w.missing,
      warpYarnCostTry: y.costTry, warpYarnPerMTry: y.perMTry, warpYarnCoveredMeters: y.coveredMeters, warpYarnSource: y.source, warpYarnEstimatedTry: y.estimatedTry, warpYarnMissing: y.missing,
    };
  };
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

type OrderKey = { itemId: string; recipeId: string | null };

/** SY-N3: varyantlı işte varyantın ACTIVE sürümü önce; yoksa desen geneli (recipeId null) sürüm — varyantsızda bugünkü sorgu. */
async function standardVersionsFor(db: Db, orders: OrderKey[]) {
  const itemIds = [...new Set(orders.map((o) => o.itemId))];
  const recipeIds = [...new Set(orders.flatMap((o) => (o.recipeId ? [o.recipeId] : [])))];
  const versions = await db.standardCostVersion.findMany({
    where: { itemId: { in: itemIds }, recipeId: null, status: "ACTIVE" },
    select: { itemId: true, loomMPerHour: true, lines: { where: { component: { in: STANDARD_READ_COMPONENTS } }, select: LINE_SELECT, orderBy: { lineNo: "asc" } } },
  });
  const variantVersions = recipeIds.length === 0 ? [] : await db.standardCostVersion.findMany({
    where: { itemId: { in: itemIds }, recipeId: { in: recipeIds }, status: "ACTIVE" },
    select: { itemId: true, recipeId: true, loomMPerHour: true, lines: { where: { component: { in: STANDARD_READ_COMPONENTS } }, select: LINE_SELECT, orderBy: { lineNo: "asc" } } },
  });
  const genericOf = new Map(versions.map((v) => [v.itemId, v]));
  const variantOf = new Map(variantVersions.map((v) => [`${v.itemId}|${v.recipeId}`, v]));
  return {
    versionOf: (o: OrderKey) => (o.recipeId ? variantOf.get(`${o.itemId}|${o.recipeId}`) : undefined) ?? genericOf.get(o.itemId),
    hasVariant: (o: OrderKey) => variantOf.has(`${o.itemId}|${o.recipeId}`),
  };
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
  const liveRolls = await liveRollsByWeavingOrder(db, weavingOrderIds);
  const warpFor = await warpFieldsFor(db, liveRolls);
  const machineIds = [...new Set(orders.flatMap((o) => o.machineRuns.map((r) => r.machineId)))].sort();
  const rates = await machineCostRateHistory(db, machineIds);
  const { versionOf, hasVariant } = await standardVersionsFor(db, orders);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const weftFor = await weftFieldsFor(db, liveRolls, (id) => { const o = byId.get(id); return o ? versionOf(o)?.lines ?? null : null; });

  return weavingOrderIds.flatMap((id) => {
    const o = byId.get(id);
    if (!o) return [];
    const missing: WeavingActualMissing[] = [];
    const m = meters.get(id) ?? { viaRun: D0(), viaOrder: D0() };
    const totalMeters = m.viaRun.plus(m.viaOrder);
    const v = versionOf(o);
    const sumOf = (pick: (c: string) => boolean) => (v ? v.lines.filter((l) => pick(l.component)).reduce((a, l) => a.plus(l.amountPerMTry), D0()) : null);
    const standardPerMTry = sumOf(isWeavingComponent);
    const standardWarpYarnPerMTry = sumOf((c) => c === "WARP_YARN");
    const standardWeftYarnPerMTry = sumOf((c) => c === "WEFT_YARN");
    missing.push(...standardGaps(!!v, !!o.recipeId, hasVariant(o)));

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
      missing: [...new Set(missing)], standardWarpYarnPerMTry, ...warpFor(id), standardWeftYarnPerMTry, ...weftFor(id),
    }];
  });
}
