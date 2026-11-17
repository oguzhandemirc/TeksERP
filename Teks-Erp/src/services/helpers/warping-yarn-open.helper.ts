// =============================================================================
// FASON DEVERE — deverecide duran iplik (TEK OKUYUCU: sevk önizlemesi, sevk/aktarma/iade kapıları, iptal, warp-plan)
// =============================================================================
// Kalem açık bakiyesi = çıkış − net iade − (eski) WOUND bağı; yalnız iptal edilmemiş, `warpingOrderId` dolu başlıkların
// iplik kalemleri. Sanal depo yok — iplik defterinden (`YarnMovement` SUBCONTRACT_*) türetilir. D4b-2 TUTMA modeli:
//   holding(kalem, sipariş) = [kendi siparişi ise açık bakiye] + Σ net aktarım(hedef = sipariş) − Σ net aktarım(kaynak = sipariş)
// Σ_sipariş holding = kalemin açık bakiyesi (aktarma stok hareketi değildir). Sahip = lotun `ownerCustomerId`si (lotsuz null).
// =============================================================================
import { Prisma, SubcontractorDispatchItemKind, WarpingOrderStatus, YarnMovementKind } from "@prisma/client";
import { sequentialTx } from "./tx-sequential-relations.helper";

type Db = Pick<Prisma.TransactionClient, "subcontractorDispatchItem" | "warpingOrder">;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const WARPING_TRANSFER = "TRANSFER" as const;
export const WARPING_TRANSFER_CANCEL = "TRANSFER_CANCEL" as const;

export interface WarpingYarnItem {
  dispatchItemId: string;
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: Date;
  /** Kalemin KENDİ siparişi (sevk başlığı). */
  warpingOrderId: string;
  /** Kalem bakılan siparişin kendi sevkinden mi (false = aktarımla gelen). */
  own: boolean;
  yarnItemId: string;
  warehouseId: string;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  /** Kalemin brüt çıkışı (sevk rakamı her yüzeyde BRÜT). */
  outKg: Prisma.Decimal;
  /** Net iade (SUBCONTRACT_RETURN − SUBCONTRACT_RETURN_CANCEL). */
  returnedKg: Prisma.Decimal;
  /** Eski tek kalem bağıyla (G1c) sarılan nominal kg — devere sevkinde D5'e kadar 0. */
  woundKg: Prisma.Decimal;
  /** Kalemin deverecideki toplamı (bütün siparişler) = çıkış − iade − sarılan. */
  itemOpenKg: Prisma.Decimal;
  /** Bakılan siparişe net gelen / ondan net giden aktarım. */
  transferInKg: Prisma.Decimal;
  transferOutKg: Prisma.Decimal;
  /** Bakılan siparişin bu kalemden TUTTUĞU (holding). */
  openKg: Prisma.Decimal;
}

export const WARPING_YARN_ITEM_SELECT = {
  id: true, yarnItemId: true, warehouseId: true, lotId: true, dispatchedQty: true,
  lot: { select: { lotNo: true, ownerCustomerId: true } },
  dispatch: { select: { id: true, dispatchNo: true, dispatchedAt: true, warpingOrderId: true, subcontractorId: true } },
  yarnMovements: { select: { kind: true, qtyKg: true } },
  warpBeamEvents: { where: { kind: "WOUND" as const, reversal: null }, select: { theoreticalKg: true } },
  warpingYarnTransfers: { select: { kind: true, qtyKg: true, fromWarpingOrderId: true, toWarpingOrderId: true } },
} satisfies Prisma.SubcontractorDispatchItemSelect;
type Row = Prisma.SubcontractorDispatchItemGetPayload<{ select: typeof WARPING_YARN_ITEM_SELECT }>;

function ownOpen(r: Row) {
  const returned = r.yarnMovements.reduce((acc, m) => {
    if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN) return acc.plus(m.qtyKg);
    if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN_CANCEL) return acc.minus(m.qtyKg);
    return acc;
  }, D(0));
  const wound = r.warpBeamEvents.reduce((acc, e) => acc.plus(e.theoreticalKg ?? 0), D(0));
  const out = D(r.dispatchedQty);
  return { out, returned, wound, open: out.minus(returned).minus(wound) };
}

/** Kalemin sipariş başına net aktarımı (+ gelen, − giden); storno satırı aynı kaynak/hedefle eksi sayılır. */
export function netTransfersByOrder(transfers: Row["warpingYarnTransfers"]): Map<string, Prisma.Decimal> {
  const m = new Map<string, Prisma.Decimal>();
  for (const t of transfers) {
    const q = t.kind === WARPING_TRANSFER ? D(t.qtyKg) : D(t.qtyKg).neg();
    m.set(t.toWarpingOrderId, (m.get(t.toWarpingOrderId) ?? D(0)).plus(q));
    m.set(t.fromWarpingOrderId, (m.get(t.fromWarpingOrderId) ?? D(0)).minus(q));
  }
  return m;
}

/** Kalemin bütün siparişlerdeki tutması (sıfırlar dahil değil). */
export function holdingsOf(r: Row): Map<string, Prisma.Decimal> {
  const own = r.dispatch.warpingOrderId!;
  const m = netTransfersByOrder(r.warpingYarnTransfers);
  m.set(own, (m.get(own) ?? D(0)).plus(ownOpen(r).open));
  for (const [k, v] of m) if (v.isZero()) m.delete(k);
  return m;
}

export function toWarpingYarnItem(r: Row, viewOrderId?: string): WarpingYarnItem {
  const ownId = r.dispatch.warpingOrderId!;
  const view = viewOrderId ?? ownId;
  const base = ownOpen(r);
  let tin = D(0);
  let tout = D(0);
  // Kaynak/hedef çifti başına net (TRANSFER − TRANSFER_CANCEL); bakılan siparişin gelen/giden toplamı.
  const pair = new Map<string, Prisma.Decimal>();
  for (const t of r.warpingYarnTransfers) {
    const k = `${t.fromWarpingOrderId}>${t.toWarpingOrderId}`;
    pair.set(k, (pair.get(k) ?? D(0)).plus(t.kind === WARPING_TRANSFER ? D(t.qtyKg) : D(t.qtyKg).neg()));
  }
  for (const [k, v] of pair) {
    const [from, to] = k.split(">");
    if (to === view) tin = tin.plus(v);
    if (from === view) tout = tout.plus(v);
  }
  const own = view === ownId;
  return {
    dispatchItemId: r.id, dispatchId: r.dispatch.id, dispatchNo: r.dispatch.dispatchNo, dispatchedAt: r.dispatch.dispatchedAt,
    warpingOrderId: ownId, own, yarnItemId: r.yarnItemId!, warehouseId: r.warehouseId!, lotId: r.lotId,
    lotNo: r.lot?.lotNo ?? null, ownerCustomerId: r.lot?.ownerCustomerId ?? null,
    outKg: base.out, returnedKg: base.returned, woundKg: base.wound, itemOpenKg: base.open,
    transferInKg: tin, transferOutKg: tout,
    openKg: (own ? base.open : D(0)).plus(tin).minus(tout),
  };
}

const ITEM_ORDER = [{ dispatch: { dispatchedAt: "asc" as const } }, { createdAt: "asc" as const }, { id: "asc" as const }];

/**
 * Siparişin iplik kalemleri — kendi canlı sevkleri + aktarma geçmişi olan başka sipariş kalemleri (sevk sırası).
 * `{ dispatchId }`: tek sevkin kalemleri, kendi siparişi gözünden.
 */
export async function loadWarpingYarnItems(db: Pick<Db, "subcontractorDispatchItem">, where: { warpingOrderId: string } | { dispatchId: string }): Promise<WarpingYarnItem[]> {
  // Beş ilişki aynı düzeyde: tx içinde paralel SQL (pg uyarısı) olmasın diye sıralı yükle.
  const rows = await sequentialTx(db).subcontractorDispatchItem.findMany({
    where: "warpingOrderId" in where
      ? {
          kind: SubcontractorDispatchItemKind.YARN,
          dispatch: { warpingOrderId: { not: null }, cancelledAt: null },
          OR: [
            { dispatch: { warpingOrderId: where.warpingOrderId } },
            { warpingYarnTransfers: { some: { OR: [{ fromWarpingOrderId: where.warpingOrderId }, { toWarpingOrderId: where.warpingOrderId }] } } },
          ],
        }
      : { kind: SubcontractorDispatchItemKind.YARN, dispatch: { id: where.dispatchId, warpingOrderId: { not: null } } },
    select: WARPING_YARN_ITEM_SELECT,
    orderBy: ITEM_ORDER,
  });
  return rows.map((r) => toWarpingYarnItem(r, "warpingOrderId" in where ? where.warpingOrderId : undefined));
}

export interface YarnSums { outKg: Prisma.Decimal; returnedKg: Prisma.Decimal; transferInKg: Prisma.Decimal; transferOutKg: Prisma.Decimal; openKg: Prisma.Decimal }

/** İplik başına toplam — kendi brüt çıkışı · kendi iadesi · net gelen/giden aktarım · deverecide tutulan. */
export function sumByYarn(items: WarpingYarnItem[]): Map<string, YarnSums> {
  const m = new Map<string, YarnSums>();
  for (const it of items) {
    const cur = m.get(it.yarnItemId) ?? { outKg: D(0), returnedKg: D(0), transferInKg: D(0), transferOutKg: D(0), openKg: D(0) };
    m.set(it.yarnItemId, {
      outKg: it.own ? cur.outKg.plus(it.outKg) : cur.outKg,
      returnedKg: it.own ? cur.returnedKg.plus(it.returnedKg) : cur.returnedKg,
      transferInKg: cur.transferInKg.plus(it.transferInKg),
      transferOutKg: cur.transferOutKg.plus(it.transferOutKg),
      openKg: cur.openKg.plus(it.openKg),
    });
  }
  return m;
}

/** Siparişe "gelen" iplik = kendi çıkışı − iade + net gelen − net giden (sarılan dahil; öneri ve fazla uyarısı bunu okur). */
export const receivedKg = (s: YarnSums): Prisma.Decimal => s.outKg.minus(s.returnedKg).plus(s.transferInKg).minus(s.transferOutKg);

/** Lot kümesi anahtarı — lotsuz satır ayrı bir "lot" sayılır (karışımın bilinmediği hâl). */
export const lotKey = (lotId: string | null): string => lotId ?? "∅";

/** Kalem satırlarını `id` sırasıyla kilitle (iade/aktarma/storno aynı kalemde sıraya girer; K4 belirlenimli sıra). */
export async function lockDispatchItemsTx(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  await tx.$queryRaw`SELECT id FROM subcontractor_dispatch_items WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
}

// ── Deverecide duran iplik (fasoncu × iplik × lot × sipariş) ────────────────

export interface WarpingYarnHolding {
  subcontractorId: string;
  warpingOrderId: string;
  orderNo: string;
  orderStatus: WarpingOrderStatus;
  dispatchItemId: string;
  dispatchNo: string;
  dispatchedAt: Date;
  yarnItemId: string;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  kg: Prisma.Decimal;
}

/** Devereci(ler)deki iplik tutmaları — `statuses` verilirse yalnız o durumdaki siparişler (devreden = COMPLETED). */
export async function loadWarpingYarnHoldings(
  db: Db,
  filter: { subcontractorIds?: string[]; yarnItemIds?: string[]; statuses?: WarpingOrderStatus[] },
): Promise<WarpingYarnHolding[]> {
  if (filter.subcontractorIds?.length === 0 || filter.yarnItemIds?.length === 0) return [];
  const rows = await sequentialTx(db).subcontractorDispatchItem.findMany({
    where: {
      kind: SubcontractorDispatchItemKind.YARN,
      ...(filter.yarnItemIds ? { yarnItemId: { in: filter.yarnItemIds } } : {}),
      dispatch: { warpingOrderId: { not: null }, cancelledAt: null, ...(filter.subcontractorIds ? { subcontractorId: { in: filter.subcontractorIds } } : {}) },
    },
    select: WARPING_YARN_ITEM_SELECT,
    orderBy: ITEM_ORDER,
  });
  const pending: Array<{ r: Row; orderId: string; kg: Prisma.Decimal }> = [];
  for (const r of rows) for (const [orderId, kg] of holdingsOf(r)) if (kg.gt(0)) pending.push({ r, orderId, kg });
  const orderIds = [...new Set(pending.map((p) => p.orderId))];
  const orders = orderIds.length > 0 ? await db.warpingOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true, status: true } }) : [];
  const byId = new Map(orders.map((o) => [o.id, o]));
  const out: WarpingYarnHolding[] = [];
  for (const p of pending) {
    const o = byId.get(p.orderId);
    if (!o || (filter.statuses && !filter.statuses.includes(o.status))) continue;
    out.push({
      subcontractorId: p.r.dispatch.subcontractorId, warpingOrderId: o.id, orderNo: o.orderNo, orderStatus: o.status,
      dispatchItemId: p.r.id, dispatchNo: p.r.dispatch.dispatchNo, dispatchedAt: p.r.dispatch.dispatchedAt,
      yarnItemId: p.r.yarnItemId!, lotId: p.r.lotId, lotNo: p.r.lot?.lotNo ?? null, ownerCustomerId: p.r.lot?.ownerCustomerId ?? null, kg: p.kg,
    });
  }
  return out;
}

/** Devreden bakiye: COMPLETED siparişlerin tutması, iplik başına; `owner` verilirse yalnız o sahip (null = fabrika malı). */
export function carryOverByYarn(holdings: WarpingYarnHolding[], owner?: string | null): Map<string, Prisma.Decimal> {
  const m = new Map<string, Prisma.Decimal>();
  for (const h of holdings) {
    if (h.orderStatus !== WarpingOrderStatus.COMPLETED) continue;
    if (owner !== undefined && h.ownerCustomerId !== owner) continue;
    m.set(h.yarnItemId, (m.get(h.yarnItemId) ?? D(0)).plus(h.kg));
  }
  return m;
}
