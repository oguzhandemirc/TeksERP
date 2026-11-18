// =============================================================================
// FASON DEVERE GECİKMELERİ (D8b) — açık devere siparişlerinden termini geçmiş / yaklaşmış / terminsiz olanlar
// =============================================================================
// Etkin termin = sipariş termini (`WarpingOrder.expectedReturnAt`), yoksa iptal edilmemiş iplik sevklerinin en erken
// termini (sevkte girilir; varsayılanı sipariş termini). Durum fason termin TEK çözücüsünden (`expectedReturnStateOf`,
// fabrika günü) — kokpitle aynı sınırlar. Gelen metre `warp-supply` `receivedMByWarpingOrder` (mutabakatla aynı tanım).
// Sayaçlar durum süzgecinden BAĞIMSIZ (çip sayıları), firma süzgecine bağlı; liste aynı kümenin durum süzülmüş hâli.
// =============================================================================
import { WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { expectedReturnStateOf, overdueDaysOf } from "../helpers/fason-expected-return.helper";
import { OPEN_WARPING_STATUSES, receivedMByWarpingOrder } from "../helpers/warp-supply.helper";

export const WARPING_DELAY_STATES = ["ALL", "OVERDUE", "DUE_SOON", "NO_DUE_DATE"] as const;
export type WarpingDelayState = (typeof WARPING_DELAY_STATES)[number];
/** Açık sipariş tavanı — aşılırsa ilk N (en eski) değerlendirilir ve `warnings` döner (sessiz kırpma yok). */
export const WARPING_DELAY_CEILING = 500;

export type WarpingDueState = "OVERDUE" | "DUE_SOON" | "NO_DUE_DATE" | "LATER";

export interface WarpingDelayRow {
  warpingOrderId: string;
  orderNo: string;
  status: WarpingOrderStatus;
  subcontractor: { id: string; name: string };
  warpSpec: { id: string; code: string; name: string };
  /** Etkin termin (ISO) ve kaynağı: sipariş termini ya da sevk termini; ikisi de yoksa null. */
  expectedReturnAt: string | null;
  dueSource: "ORDER" | "DISPATCH" | null;
  /** Fabrika günü farkı (gecikmede pozitif); termin yoksa null. */
  overdueDays: number | null;
  state: WarpingDueState;
  firstDispatchedAt: string | null;
  targetLengthM: string;
  receivedLengthM: string;
  remainingLengthM: string;
}

export interface WarpingDelayResult {
  data: WarpingDelayRow[];
  summary: { openCount: number; overdueCount: number; dueSoonCount: number; noDueDateCount: number };
}

const m3 = (n: number): string => n.toFixed(3);

/** Bellek-içi süzgeç ikizi: `ALL` her şey; `LATER` (termini ileride) yalnız `ALL`da görünür. */
export function matchesDelayState(state: WarpingDueState, filter: WarpingDelayState): boolean {
  return filter === "ALL" || state === filter;
}

/** Etkin termin: sipariş > en erken sevk termini. */
export function effectiveDue(orderDue: Date | null, dispatchDues: ReadonlyArray<Date | null>): { at: Date | null; source: "ORDER" | "DISPATCH" | null } {
  if (orderDue) return { at: orderDue, source: "ORDER" };
  const ds = dispatchDues.filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime());
  return ds.length > 0 ? { at: ds[0]!, source: "DISPATCH" } : { at: null, source: null };
}

export async function listWarpingDelays(
  f: { state: WarpingDelayState; subcontractorIds?: string[] },
  now: Date = new Date(),
): Promise<{ data: WarpingDelayResult; warnings?: string[] }> {
  const where = {
    status: { in: [...OPEN_WARPING_STATUSES] },
    ...(f.subcontractorIds && f.subcontractorIds.length > 0 ? { subcontractorId: { in: f.subcontractorIds } } : {}),
  };
  const total = await prisma.warpingOrder.count({ where });
  const orders = await prisma.warpingOrder.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: WARPING_DELAY_CEILING,
    select: {
      id: true, orderNo: true, status: true, targetLengthM: true, expectedReturnAt: true,
      subcontractor: { select: { id: true, name: true } },
      warpSpec: { select: { id: true, code: true, name: true } },
      dispatches: { where: { cancelledAt: null }, select: { dispatchedAt: true, expectedReturnAt: true } },
    },
  });
  const received = await receivedMByWarpingOrder(prisma, orders.map((o) => o.id));
  const all: WarpingDelayRow[] = orders.map((o) => {
    const due = effectiveDue(o.expectedReturnAt, o.dispatches.map((d) => d.expectedReturnAt));
    const first = o.dispatches.map((d) => d.dispatchedAt).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const targetM = Number(o.targetLengthM);
    const recvM = received.get(o.id) ?? 0;
    return {
      warpingOrderId: o.id, orderNo: o.orderNo, status: o.status, subcontractor: o.subcontractor, warpSpec: o.warpSpec,
      expectedReturnAt: due.at?.toISOString() ?? null, dueSource: due.source,
      overdueDays: overdueDaysOf(due.at, now), state: expectedReturnStateOf(due.at, now) ?? "LATER",
      firstDispatchedAt: first?.toISOString() ?? null,
      targetLengthM: m3(targetM), receivedLengthM: m3(recvM), remainingLengthM: m3(Math.max(0, targetM - recvM)),
    };
  });
  const summary = {
    openCount: total,
    overdueCount: all.filter((r) => r.state === "OVERDUE").length,
    dueSoonCount: all.filter((r) => r.state === "DUE_SOON").length,
    noDueDateCount: all.filter((r) => r.state === "NO_DUE_DATE").length,
  };
  // En geç kalan önce; terminsiz sonda; eşitlikte sipariş no.
  const data = all
    .filter((r) => matchesDelayState(r.state, f.state))
    .sort((a, b) => (b.overdueDays ?? -Infinity) - (a.overdueDays ?? -Infinity) || a.orderNo.localeCompare(b.orderNo, "tr"));
  const warnings = total > WARPING_DELAY_CEILING
    ? [`Açık devere siparişi ${total}; gecikme listesi en eski ${WARPING_DELAY_CEILING} siparişten hesaplandı — devereci süzgeci kullanın.`]
    : undefined;
  return { data: { data, summary }, ...(warnings ? { warnings } : {}) };
}
