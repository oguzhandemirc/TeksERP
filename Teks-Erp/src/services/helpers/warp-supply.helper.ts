// =============================================================================
// ÇÖZGÜ ARZI — "Bu çözgü kartından elde ya da yolda kaç metre var?" (TEK KAYNAK; fason devere D8)
// =============================================================================
// arz = stok (READY + MOUNTED kalan, `readBeamStockBySpec`) + PLANNED levent (`plannedLengthM`) + açık devere
// siparişi kalanı (OPEN/IN_PROGRESS: hedef − Σ canlı WOUND metresi). Dönen levent READY olup stokta sayıldığı için
// sipariş kalanından düşülür — çift sayım yok. Devere önerisi ihtiyaçtan bunu düşer (`warp-need.service`).
// =============================================================================
import { Prisma, WarpBeamStatus, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readBeamStockBySpec } from "./warp-beam-stock.helper";

type Db = Prisma.TransactionClient | typeof prisma;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export const OPEN_WARPING_STATUSES = [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS] as const;

export interface OpenWarpingRef {
  id: string;
  orderNo: string;
  status: WarpingOrderStatus;
  subcontractorName: string;
  targetM: number;
  receivedM: number;
  /** Henüz dönmemiş metre (hedef − gelen, sıfırın altına inmez). */
  remainingM: number;
}

export interface WarpSupply {
  stockM: number;
  plannedBeamM: number;
  openWarpingM: number;
  totalM: number;
  openWarpingOrders: OpenWarpingRef[];
}

const empty = (): WarpSupply => ({ stockM: 0, plannedBeamM: 0, openWarpingM: 0, totalM: 0, openWarpingOrders: [] });

/** Kart başına arz; listede olmayan kart için sıfır satır döner. */
export async function readWarpSupplyBySpec(db: Db, warpSpecIds: readonly string[]): Promise<Map<string, WarpSupply>> {
  const ids = [...new Set(warpSpecIds)];
  const out = new Map(ids.map((id) => [id, empty()]));
  if (ids.length === 0) return out;

  const stock = await readBeamStockBySpec(db, ids);
  for (const [id, beams] of stock) out.get(id)!.stockM = round3(beams.reduce((s, b) => s + b.remainingM, 0));

  // İçeride sarılacak (planlanmış) levent; devere dönüşü READY doğar, PLANNED olmaz.
  const planned = await db.warpBeam.groupBy({
    by: ["warpSpecId"],
    where: { warpSpecId: { in: ids }, status: WarpBeamStatus.PLANNED, warpingOrderId: null },
    _sum: { plannedLengthM: true },
  });
  for (const p of planned) out.get(p.warpSpecId)!.plannedBeamM = round3(Number(p._sum.plannedLengthM ?? 0));

  const orders = await db.warpingOrder.findMany({
    where: { warpSpecId: { in: ids }, status: { in: [...OPEN_WARPING_STATUSES] } },
    select: { id: true, orderNo: true, status: true, warpSpecId: true, targetLengthM: true, subcontractor: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const received = await receivedMByWarpingOrder(db, orders.map((o) => o.id));
  for (const o of orders) {
    const targetM = Number(o.targetLengthM);
    const receivedM = received.get(o.id) ?? 0;
    const remainingM = round3(Math.max(0, targetM - receivedM));
    const s = out.get(o.warpSpecId)!;
    s.openWarpingM = round3(s.openWarpingM + remainingM);
    s.openWarpingOrders.push({ id: o.id, orderNo: o.orderNo, status: o.status, subcontractorName: o.subcontractor.name, targetM, receivedM, remainingM });
  }
  for (const s of out.values()) s.totalM = round3(s.stockM + s.plannedBeamM + s.openWarpingM);
  return out;
}

/** Siparişin gelen metresi = iptal edilmemiş leventlerinin canlı (stornosuz) WOUND metresi (mutabakatla aynı tanım). */
async function receivedMByWarpingOrder(db: Db, warpingOrderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (warpingOrderIds.length === 0) return out;
  const beams = await db.warpBeam.findMany({
    where: { warpingOrderId: { in: warpingOrderIds }, status: { not: WarpBeamStatus.CANCELLED } },
    select: { warpingOrderId: true, events: { where: { kind: "WOUND" }, select: { lengthM: true, reversal: { select: { id: true } } } } },
  });
  for (const b of beams) {
    const ev = b.events.find((e) => !e.reversal);
    if (!ev || !b.warpingOrderId) continue;
    out.set(b.warpingOrderId, round3((out.get(b.warpingOrderId) ?? 0) + Number(ev.lengthM ?? 0)));
  }
  return out;
}

/** Kartın en son açılan (iptal edilmemiş) devere siparişinin deverecisi — öneri formunu doldurmak için. */
export async function lastWarpingSubcontractorBySpec(db: Db, warpSpecIds: readonly string[]): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  const ids = [...new Set(warpSpecIds)];
  if (ids.length === 0) return out;
  const rows = await db.warpingOrder.findMany({
    where: { warpSpecId: { in: ids }, status: { not: WarpingOrderStatus.CANCELLED } },
    select: { warpSpecId: true, subcontractor: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["warpSpecId"],
  });
  for (const r of rows) out.set(r.warpSpecId, r.subcontractor);
  return out;
}
