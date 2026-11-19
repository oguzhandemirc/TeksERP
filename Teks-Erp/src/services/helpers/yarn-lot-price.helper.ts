// =============================================================================
// İPLİK LOTU BİRİM FİYATI — mal kabuldeki lot fiyatı (TEK KAYNAK; Fasondaki İplik değer sütunu)
// =============================================================================
// Fiyat = lotun ACTIVE mal kabul fişine bağlı `IN` hareketlerinin (unitPrice dolu) kg-ağırlıklı ortalaması, fişin
// para biriminde. Ters kayıt fiyat taşımaz (şema şerhi); iptal fişin satırı sayılmaz. Lotun fişleri birden çok para
// birimindeyse fiyat YOK (`MIXED_CURRENCY`) — kur çevrilmez, 1 varsayılmaz. Lotsuz ya da fiyatsız lot haritada yok.
// =============================================================================
import { Currency, GoodsReceiptStatus, Prisma, YarnMovementKind } from "@prisma/client";

type Db = Pick<Prisma.TransactionClient, "yarnMovement">;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type YarnLotPrice = { kind: "PRICE"; unitPrice: Prisma.Decimal; currency: Currency } | { kind: "MIXED_CURRENCY" };

export async function readYarnLotReceiptPrices(db: Db, lotIds: readonly string[]): Promise<Map<string, YarnLotPrice>> {
  const ids = [...new Set(lotIds)];
  const out = new Map<string, YarnLotPrice>();
  if (ids.length === 0) return out;
  const rows = await db.yarnMovement.findMany({
    where: { lotId: { in: ids }, kind: YarnMovementKind.IN, unitPrice: { not: null }, goodsReceipt: { status: GoodsReceiptStatus.ACTIVE } },
    select: { lotId: true, qtyKg: true, unitPrice: true, goodsReceipt: { select: { currency: true } } },
  });
  const acc = new Map<string, { currencies: Set<Currency>; kg: Prisma.Decimal; amount: Prisma.Decimal }>();
  for (const r of rows) {
    if (!r.lotId || !r.unitPrice || !r.goodsReceipt) continue;
    const a = acc.get(r.lotId) ?? { currencies: new Set<Currency>(), kg: D(0), amount: D(0) };
    a.currencies.add(r.goodsReceipt.currency);
    a.kg = a.kg.plus(r.qtyKg);
    a.amount = a.amount.plus(D(r.qtyKg).mul(r.unitPrice));
    acc.set(r.lotId, a);
  }
  for (const [lotId, a] of acc) {
    if (a.currencies.size > 1) out.set(lotId, { kind: "MIXED_CURRENCY" });
    else if (a.kg.gt(0)) out.set(lotId, { kind: "PRICE", unitPrice: a.amount.div(a.kg).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP), currency: [...a.currencies][0]! });
  }
  return out;
}
