// =============================================================================
// FASON DEVERE — deverecide duran iplik okuyucusu: fasoncu × iplik × lot × sahip (D6c · Fasondaki İplik ekranı)
// =============================================================================
// Kaynak `loadWarpingYarnHoldings` (tek okuyucu); id süzgeçleri (fasoncu · iplik · lot) Prisma where'e, metin araması
// toplanmış satıra (`matchesListSearch`) — liste ve ekranın özet şeridi AYNI yanıttan (tek where). Değer alanları
// OPT-IN (`withValue`: fiş fiyatını görme izni; ticaret zinciri uçta `requireIplikEnabled`); fiyat tek kaynak `readYarnLotReceiptPrices`.
// =============================================================================
import { Prisma, type WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { matchesListSearch } from "../../utils/list-search";
import { loadWarpingYarnHoldings } from "../helpers/warping-yarn-open.helper";
import { readYarnLotReceiptPrices } from "../helpers/yarn-lot-price.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);

export interface YarnAtSubcontractorFilter {
  subcontractorIds?: string[];
  yarnItemIds?: string[];
  lotIds?: string[];
  statuses?: WarpingOrderStatus[];
  /** Lot no · iplik kodu/adı · fasoncu kodu/adı · sipariş no (her kelime en az birinde). */
  search?: string;
  /** Lot birim fiyatı + değer alanlarını ekle (çağıran izni çözer). */
  withValue?: boolean;
}

/** `PRICE` fiyatlı · `NO_LOT` lotsuz satır · `NO_PRICE` lotun fiyatlı fişi yok · `MIXED_CURRENCY` lotun fişleri farklı para biriminde. */
export type YarnAtSubPriceStatus = "PRICE" | "NO_LOT" | "NO_PRICE" | "MIXED_CURRENCY";

type Group = {
  subcontractorId: string; yarnItemId: string; lotId: string | null; lotNo: string | null; ownerCustomerId: string | null;
  kg: Prisma.Decimal; oldestDispatchedAt: Date; orders: Array<{ warpingOrderId: string; orderNo: string; status: WarpingOrderStatus; kg: string }>;
};

export interface YarnAtSubcontractorRow extends Omit<Group, "kg" | "oldestDispatchedAt"> {
  kg: string;
  oldestDispatchedAt: string;
  subcontractorCode: string | null;
  subcontractorName: string | null;
  yarnItemCode: string | null;
  yarnItemName: string | null;
  ownerCustomerName: string | null;
  /** Aşağıdakiler yalnız `withValue` iken VAR (anahtar dahil); yoksa yanıtta hiç yok. */
  priceStatus?: YarnAtSubPriceStatus;
  unitPrice?: string | null;
  currency?: string | null;
  value?: string | null;
}

/** Deverecide duran iplik — fasoncu × iplik × lot (× sipariş); `statuses` verilirse yalnız o durumdakiler. */
export async function warpingYarnAtSubcontractors(filter: YarnAtSubcontractorFilter): Promise<YarnAtSubcontractorRow[]> {
  const rows = await loadWarpingYarnHoldings(prisma, filter);
  const groups = new Map<string, Group>();
  for (const h of rows) {
    const k = `${h.subcontractorId}|${h.yarnItemId}|${h.lotId ?? ""}|${h.ownerCustomerId ?? ""}`;
    const g = groups.get(k) ?? { subcontractorId: h.subcontractorId, yarnItemId: h.yarnItemId, lotId: h.lotId, lotNo: h.lotNo, ownerCustomerId: h.ownerCustomerId, kg: D(0), oldestDispatchedAt: h.dispatchedAt, orders: [] };
    g.kg = g.kg.plus(h.kg);
    if (h.dispatchedAt < g.oldestDispatchedAt) g.oldestDispatchedAt = h.dispatchedAt;
    const o = g.orders.find((x) => x.warpingOrderId === h.warpingOrderId);
    if (o) o.kg = D(o.kg).plus(h.kg).toFixed(3);
    else g.orders.push({ warpingOrderId: h.warpingOrderId, orderNo: h.orderNo, status: h.orderStatus, kg: kg(h.kg) });
    groups.set(k, g);
  }
  // D6-be: ad alanları kimliklere EK (geriye uyumlu); sıralama kimlikle kalır.
  const list = [...groups.values()];
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const subIds = uniq(list.map((g) => g.subcontractorId));
  const yarnIds = uniq(list.map((g) => g.yarnItemId));
  const ownerIds = uniq(list.map((g) => g.ownerCustomerId).filter((x): x is string => x !== null));
  const subs = subIds.length > 0 ? await prisma.subcontractor.findMany({ where: { id: { in: subIds } }, select: { id: true, code: true, name: true } }) : [];
  const yarns = yarnIds.length > 0 ? await prisma.item.findMany({ where: { id: { in: yarnIds } }, select: { id: true, code: true, name: true } }) : [];
  const owners = ownerIds.length > 0 ? await prisma.customer.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const subBy = new Map(subs.map((s) => [s.id, s]));
  const yarnBy = new Map(yarns.map((y) => [y.id, y]));
  const ownerBy = new Map(owners.map((o) => [o.id, o.name]));
  const named = list
    .sort((a, b) => a.subcontractorId.localeCompare(b.subcontractorId) || a.yarnItemId.localeCompare(b.yarnItemId) || (a.lotNo ?? "").localeCompare(b.lotNo ?? ""))
    .map((g) => ({
      ...g, kg: kg(g.kg), oldestDispatchedAt: g.oldestDispatchedAt.toISOString(),
      subcontractorCode: subBy.get(g.subcontractorId)?.code ?? null, subcontractorName: subBy.get(g.subcontractorId)?.name ?? null,
      yarnItemCode: yarnBy.get(g.yarnItemId)?.code ?? null, yarnItemName: yarnBy.get(g.yarnItemId)?.name ?? null,
      ownerCustomerName: g.ownerCustomerId ? ownerBy.get(g.ownerCustomerId) ?? null : null,
    }))
    .filter((r) => matchesListSearch(filter.search, [r.lotNo, r.yarnItemCode, r.yarnItemName, r.subcontractorCode, r.subcontractorName, ...r.orders.map((o) => o.orderNo)]));
  if (!filter.withValue) return named;
  const prices = await readYarnLotReceiptPrices(prisma, named.map((r) => r.lotId).filter((x): x is string => x !== null));
  return named.map((r) => {
    const p = r.lotId ? prices.get(r.lotId) : undefined;
    const priceStatus: YarnAtSubPriceStatus = !r.lotId ? "NO_LOT" : !p ? "NO_PRICE" : p.kind;
    const priced = p?.kind === "PRICE" ? p : null;
    return {
      ...r,
      priceStatus,
      unitPrice: priced ? priced.unitPrice.toFixed(4) : null,
      currency: priced ? priced.currency : null,
      value: priced ? D(r.kg).mul(priced.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) : null,
    };
  });
}
