// =============================================================================
// TEZGÂH YÜK ÇİZELGESİ — "hangi tezgâh ne zamana kadar dolu?" (salt okuma; Seyitoğlu 3. bölüm L2)
// =============================================================================
// İş bir tezgâhta sayılır: açık koşumu (`OPEN_RUN_WHERE`) o tezgâhta ya da koşumsuz ama o tezgâhta TAKILI
// (MOUNTED) leventi bu işe bağlı. Yalnız açık (PLANNED/IN_PROGRESS) kendi tezgâhımızdaki (IN_HOUSE) işler; fason
// dokuma bizim tezgâhı doldurmaz. Kalan = `weavingRemainingM` (üretilen = `weavingProducedM`, liste/genel bakışla
// aynı), süre = `weavingHoursDecimal` (öneri önizlemesiyle AYNI fonksiyon). Boşalma "şimdi kesintisiz 24 saat
// çalışırsa" varsayımıdır (vardiya takvimi uygulanmaz); bir terim bilinmiyorsa null. Sorgu sayısı sabittir (5).
// =============================================================================
import { Prisma, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { LOOM_MACHINE_WHERE } from "../constants/loom-shift";
import { OPEN_RUN_WHERE } from "./helpers/weaving-order-input.helper";
import { rollMetersByWeavingOrder } from "./helpers/weaving-order-of-roll.helper";
import { weavingProducedM, weavingRemainingM } from "./helpers/weaving-order-list-progress.helper";
import { weavingHoursDecimal } from "./helpers/production-proposal-insight.helper";

const round2 = (d: Prisma.Decimal): number => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();

export interface LoomLoadJobBase {
  weavingOrderId: string;
  weavingOrderNumber: string;
  status: WeavingOrderStatus;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Plan ham metre; açık uçlu işte null. */
  plannedM: number | null;
  /** Üretilen metre (doğan top Σ ilk metre); top yoksa null. */
  producedM: number | null;
  /** max(0, plannedM − üretilen); açık uçlu işte null. */
  remainingM: number | null;
  plannedStartDate: string | null;
  /** Süre hesabındaki atkı sıklığı: işin atkı kartı, yoksa ürünün atkı kartı; ikisi de yoksa null. */
  picksPerCm: number | null;
}

export interface LoomLoadJob extends LoomLoadJobBase {
  /** OPEN_RUN = tezgâhta açık koşumu var · MOUNTED_BEAM = koşum yok, işin leventi bu tezgâhta takılı. */
  assignment: "OPEN_RUN" | "MOUNTED_BEAM";
  /** Açık koşumun başlangıcı (OPEN_RUN); MOUNTED_BEAM'de null. */
  runStartedAt: string | null;
  /** İş birden çok tezgâhta açık: kalanın bölüşümü bilinmez → `estimatedHours` null. */
  sharedAcrossLooms: boolean;
  /** Kalan metrenin bu tezgâhta tahmini dokuma saati; devir/randıman/atkı sıklığı/kalan bilinmiyorsa null. */
  estimatedHours: number | null;
}

export interface LoomLoadRow {
  machineId: string;
  code: string;
  name: string;
  planRpm: number | null;
  planEfficiencyPct: number | null;
  /** Sıra: açık koşumlar başlangıca göre, sonra levent-takılı işler planlanan başlangıca (boşlar sonda), sonra numara. */
  jobs: LoomLoadJob[];
  /** Σ estimatedHours; bir iş bile null ise null; işsiz tezgâhta 0. */
  totalEstimatedHours: number | null;
  /** generatedAt + totalEstimatedHours (şimdi başlar, kesintisiz 24 saat varsayımı); toplam null ise null; işsizse generatedAt. */
  estimatedFreeAtIfContinuous: string | null;
}

export interface LoomLoadResponse {
  generatedAt: string;
  /** Boşalma zamanı varsayımı — vardiya/duruş takvimi uygulanmaz. */
  assumption: "CONTINUOUS_24H_FROM_NOW";
  looms: LoomLoadRow[];
  /** Hiçbir tezgâhta açık koşumu ya da takılı leventi olmayan açık IN_HOUSE işler (planlanan başlangıç, numara sırası). */
  unassigned: LoomLoadJobBase[];
}

const OPEN_STATUSES = [WeavingOrderStatus.PLANNED, WeavingOrderStatus.IN_PROGRESS];

export async function getLoomLoad(now: Date = new Date()): Promise<LoomLoadResponse> {
  const looms = await prisma.machine.findMany({
    where: LOOM_MACHINE_WHERE,
    select: { id: true, code: true, name: true, planRpm: true, planEfficiencyPct: true },
    orderBy: [{ code: "asc" }, { id: "asc" }],
  });
  const orders = await prisma.weavingOrder.findMany({
    where: { status: { in: OPEN_STATUSES }, executionKind: WeavingExecutionKind.IN_HOUSE },
    select: {
      id: true, weavingOrderNumber: true, status: true, itemId: true, plannedM: true, plannedStartDate: true,
      weftSpec: { select: { picksPerCm: true } },
      item: { select: { code: true, name: true, weftSpec: { select: { picksPerCm: true } } } },
    },
    orderBy: [{ plannedStartDate: { sort: "asc", nulls: "last" } }, { weavingOrderNumber: "asc" }],
  });
  const ids = orders.map((o) => o.id);
  const loomIds = looms.map((l) => l.id);
  const runs = ids.length && loomIds.length
    ? await prisma.machineRun.findMany({
      where: { weavingOrderId: { in: ids }, machineId: { in: loomIds }, ...OPEN_RUN_WHERE },
      select: { machineId: true, weavingOrderId: true, startedAt: true },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    })
    : [];
  const beams = ids.length && loomIds.length
    ? await prisma.warpBeam.findMany({
      where: { status: "MOUNTED", weavingOrderId: { in: ids }, currentMachineId: { in: loomIds } },
      select: { currentMachineId: true, weavingOrderId: true },
    })
    : [];
  const meters = await rollMetersByWeavingOrder(prisma, ids);

  const base = new Map<string, LoomLoadJobBase>();
  for (const o of orders) {
    const plannedM = o.plannedM == null ? null : Number(o.plannedM);
    const m = meters.get(o.id);
    const producedM = weavingProducedM(WeavingExecutionKind.IN_HOUSE, null, m ? Number(m) : null);
    const picks = o.weftSpec?.picksPerCm ?? o.item.weftSpec?.picksPerCm ?? null;
    base.set(o.id, {
      weavingOrderId: o.id, weavingOrderNumber: o.weavingOrderNumber, status: o.status, itemId: o.itemId, itemCode: o.item.code, itemName: o.item.name,
      plannedM, producedM, remainingM: weavingRemainingM(plannedM, producedM),
      plannedStartDate: o.plannedStartDate?.toISOString() ?? null, picksPerCm: picks == null ? null : Number(picks),
    });
  }

  // tezgâh → [iş, atama, başlangıç]; aynı iş aynı tezgâhta bir kez (birden çok hat/koşum tek satır).
  const placed = new Map<string, Array<{ id: string; assignment: LoomLoadJob["assignment"]; startedAt: Date | null }>>();
  const loomsOfOrder = new Map<string, Set<string>>();
  const place = (machineId: string, orderId: string, assignment: LoomLoadJob["assignment"], startedAt: Date | null) => {
    const list = placed.get(machineId) ?? [];
    if (list.some((p) => p.id === orderId)) return;
    list.push({ id: orderId, assignment, startedAt });
    placed.set(machineId, list);
    loomsOfOrder.set(orderId, (loomsOfOrder.get(orderId) ?? new Set()).add(machineId));
  };
  for (const r of runs) if (r.weavingOrderId) place(r.machineId, r.weavingOrderId, "OPEN_RUN", r.startedAt);
  const orderRank = new Map(orders.map((o, i) => [o.id, i]));
  const sortedBeams = [...beams].sort((a, b) => (orderRank.get(a.weavingOrderId!) ?? 0) - (orderRank.get(b.weavingOrderId!) ?? 0));
  for (const b of sortedBeams) if (b.weavingOrderId && b.currentMachineId) place(b.currentMachineId, b.weavingOrderId, "MOUNTED_BEAM", null);

  const rows: LoomLoadRow[] = looms.map((l) => {
    const computed = (placed.get(l.id) ?? []).map((p) => {
      const b = base.get(p.id)!;
      const shared = (loomsOfOrder.get(p.id)?.size ?? 0) > 1;
      const hours = shared ? null : weavingHoursDecimal(b.remainingM, l.planRpm, l.planEfficiencyPct, b.picksPerCm);
      const job: LoomLoadJob = { ...b, assignment: p.assignment, runStartedAt: p.startedAt?.toISOString() ?? null, sharedAcrossLooms: shared, estimatedHours: hours === null ? null : round2(hours) };
      return { job, hours };
    });
    // Toplam yuvarlanmamış saatlerden; tek bilinmeyen terim toplamı kapatır (0 sayılmaz).
    const total = computed.some((c) => c.hours === null) ? null : computed.reduce((a, c) => a.plus(c.hours!), new Prisma.Decimal(0));
    return {
      machineId: l.id, code: l.code, name: l.name, planRpm: l.planRpm, planEfficiencyPct: l.planEfficiencyPct == null ? null : Number(l.planEfficiencyPct),
      jobs: computed.map((c) => c.job),
      totalEstimatedHours: total === null ? null : round2(total),
      estimatedFreeAtIfContinuous: total === null ? null : new Date(now.getTime() + total.mul(3_600_000).round().toNumber()).toISOString(),
    };
  });
  const unassigned = orders.filter((o) => !loomsOfOrder.has(o.id)).map((o) => base.get(o.id)!);
  return { generatedAt: now.toISOString(), assumption: "CONTINUOUS_24H_FROM_NOW", looms: rows, unassigned };
}
