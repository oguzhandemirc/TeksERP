// SİPARİŞ "NEREDE?" — YÜKLEYİCİ (liste sayfası). Saf türetme `order-nerede.helper.ts`te;
// sorgu bütçesi sayfa başına SABİT (İE/sipariş sayısından bağımsız).
import { Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { outstandingItemOfOpenDispatch } from "./fason-open-dispatch.helper";
import { whereRollsOfWorkOrders, workOrderHasRollWhere } from "./workorder-rolls.helper";
import {
  NEREDE_ACTIVE_WO,
  NEREDE_LIVE,
  NEREDE_READY,
  deriveOrderNerede,
  deriveOrderSevk,
  factoryDaysBetween,
  type Nerede,
  type NeredeLineInput,
  type NeredeOrderInput,
  type NeredePlace,
  type Sevk,
} from "./order-nerede.helper";

// ── Yükleyici (liste sayfası + detay ortak) ──────────────────────────────────
/** Liste `defaultInclude` şeklinin okunan parçası. */
export interface NeredeOrderRow extends NeredeOrderInput {
  id: string;
  lines?: Array<NeredeLineInput & { workOrderLinks?: Array<{ workOrder: { id: string; status: WorkOrderStatus } }> }>;
}

export interface LiveRoll {
  id: string;
  status: RollStatus;
  qty: number;
  stepId: string | null;
  stepWoId: string | null;
  sequence: number;
  stationName: string | null;
  woIds: string[];
  firmId: string | null;
  firmName: string | null;
  dispatchedAt: Date | null;
}

export interface NeredeLoad {
  /** Sipariş id → aktif İE id kümesi. */
  woIdsByOrder: Map<string, string[]>;
  liveRolls: LiveRoll[];
  rollsByWo: Map<string, LiveRoll[]>;
  woWithAnyRoll: Set<string>;
}

function activeWoIdsOf(row: NeredeOrderRow): string[] {
  const set = new Set<string>();
  for (const l of row.lines ?? []) {
    for (const link of l.workOrderLinks ?? []) {
      if (NEREDE_ACTIVE_WO.includes(link.workOrder.status)) set.add(link.workOrder.id);
    }
  }
  return [...set];
}

/** Sayfadaki bütün siparişler için SABİT sayıda sorgu (en çok 3). */
export async function loadNeredeContext(rows: NeredeOrderRow[]): Promise<NeredeLoad> {
  const woIdsByOrder = new Map<string, string[]>();
  const allWo = new Set<string>();
  for (const r of rows) {
    const ids = activeWoIdsOf(r);
    woIdsByOrder.set(r.id, ids);
    ids.forEach((id) => allWo.add(id));
  }
  const woIds = [...allWo];
  const rollsByWo = new Map<string, LiveRoll[]>();
  const woWithAnyRoll = new Set<string>();
  if (woIds.length === 0) return { woIdsByOrder, liveRolls: [], rollsByWo, woWithAnyRoll };

  const raw = await prisma.roll.findMany({
    where: { AND: [{ status: { in: NEREDE_LIVE } }, whereRollsOfWorkOrders(woIds)] },
    select: {
      id: true,
      status: true,
      currentQty: true,
      currentStepId: true,
      producedInStep: { select: { workOrderId: true } },
      currentStep: { select: { workOrderId: true, stepSequence: true, station: { select: { name: true } } } },
      batch: { select: { workOrderId: true } },
    },
  });

  const subIds = raw.filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR).map((r) => r.id);
  const firmByRoll = new Map<string, { firmId: string; firmName: string; at: Date }>();
  if (subIds.length > 0) {
    const items = await prisma.subcontractorDispatchItem.findMany({
      where: { AND: [outstandingItemOfOpenDispatch(), { rollId: { in: subIds } }] },
      select: {
        rollId: true,
        dispatch: { select: { dispatchedAt: true, subcontractorId: true, subcontractor: { select: { name: true } } } },
      },
    });
    for (const it of items) {
      if (!it.rollId) continue;
      const prev = firmByRoll.get(it.rollId);
      // Birden çok açık sevk (beklenmez; ölçüm 534/534 tek) → en yenisi topun bulunduğu yerdir.
      if (!prev || it.dispatch.dispatchedAt > prev.at) {
        firmByRoll.set(it.rollId, {
          firmId: it.dispatch.subcontractorId,
          firmName: it.dispatch.subcontractor.name,
          at: it.dispatch.dispatchedAt,
        });
      }
    }
  }

  const wanted = new Set(woIds);
  const liveRolls: LiveRoll[] = raw.map((r) => {
    const ws = new Set<string>();
    for (const w of [r.producedInStep?.workOrderId, r.currentStep?.workOrderId, r.batch?.workOrderId]) {
      if (w && wanted.has(w)) ws.add(w);
    }
    const f = firmByRoll.get(r.id);
    const roll: LiveRoll = {
      id: r.id,
      status: r.status,
      qty: new Prisma.Decimal(r.currentQty).toNumber(),
      stepId: r.currentStepId,
      stepWoId: r.currentStep?.workOrderId ?? null,
      sequence: r.currentStep?.stepSequence ?? 0,
      stationName: r.currentStep?.station.name ?? null,
      woIds: [...ws],
      firmId: f?.firmId ?? null,
      firmName: f?.firmName ?? null,
      dispatchedAt: f?.at ?? null,
    };
    for (const w of roll.woIds) {
      const arr = rollsByWo.get(w) ?? [];
      arr.push(roll);
      rollsByWo.set(w, arr);
      woWithAnyRoll.add(w);
    }
    return roll;
  });

  const noLive = woIds.filter((w) => !woWithAnyRoll.has(w));
  if (noLive.length > 0) {
    const had = await prisma.workOrder.findMany({
      where: { AND: [{ id: { in: noLive } }, workOrderHasRollWhere({})] },
      select: { id: true },
    });
    had.forEach((w) => woWithAnyRoll.add(w.id));
  }
  return { woIdsByOrder, liveRolls, rollsByWo, woWithAnyRoll };
}

/** Bir top kümesini yerlere ayırır (sipariş satırı ve İE kartı aynı ayrımı kullanır). */
export function placesOf(rolls: LiveRoll[], now: Date = new Date()): NeredePlace[] {
  const m = new Map<string, NeredePlace>();
  for (const r of rolls) {
    let kind: NeredePlace["kind"];
    let key: string;
    let name: string;
    if (NEREDE_READY.includes(r.status)) {
      kind = "READY"; key = "READY"; name = "";
    } else if (r.status === RollStatus.AT_SUBCONTRACTOR) {
      kind = "FASON"; key = `FASON:${r.firmId ?? "?"}`; name = r.firmName ?? "";
    } else {
      kind = "STEP"; name = r.stationName ?? "Üretim"; key = `STEP:${name}`;
    }
    const p = m.get(key) ?? { kind, key, name, rollCount: 0, sequence: kind === "READY" ? Number.MAX_SAFE_INTEGER : 0, days: null };
    p.rollCount += 1;
    if (kind !== "READY") p.sequence = Math.max(p.sequence, r.sequence);
    if (kind === "FASON" && r.dispatchedAt) {
      p.days = Math.max(p.days ?? 0, factoryDaysBetween(r.dispatchedAt, now));
    }
    m.set(key, p);
  }
  return [...m.values()];
}

/** Siparişin canlı topları (bir top birden çok İE yoluyla gelse de bir kez sayılır). */
function rollsOfOrder(ctx: NeredeLoad, orderId: string): LiveRoll[] {
  const seen = new Map<string, LiveRoll>();
  for (const w of ctx.woIdsByOrder.get(orderId) ?? []) {
    for (const r of ctx.rollsByWo.get(w) ?? []) seen.set(r.id, r);
  }
  return [...seen.values()];
}

export function neredeOfRow(row: NeredeOrderRow, ctx: NeredeLoad, now: Date = new Date()): { nerede: Nerede; sevk: Sevk } {
  const wos = ctx.woIdsByOrder.get(row.id) ?? [];
  const nerede = deriveOrderNerede(
    row,
    {
      activeWoCount: wos.length,
      places: placesOf(rollsOfOrder(ctx, row.id), now),
      anyRoll: wos.some((w) => ctx.woWithAnyRoll.has(w)),
    },
    now,
  );
  return { nerede, sevk: deriveOrderSevk(row, row.lines ?? []) };
}

/** Liste sayfasını zenginleştirir (offset + cursor). Satır başına sorgu YOK. */
export async function attachNerede<T>(rows: T[], now: Date = new Date()): Promise<T[]> {
  const typed = rows as unknown as NeredeOrderRow[];
  const ctx = await loadNeredeContext(typed);
  return typed.map((r) => ({ ...r, ...neredeOfRow(r, ctx, now) })) as unknown as T[];
}
