// =============================================================================
// ÇÖZGÜ İPLİĞİ GERÇEK MALİYETİ — İPLİK OKUMASI (devere maliyet dilim 3; plan PLAN-devere-maliyet-1126 §3)
// =============================================================================
// Yalnız `maliyet-bridge.helper` içinden, iplik açıkken DİNAMİK import edilir (maliyet.md köprü kuralı).
// Lot fiyatı = lotun mal kabul (IN + fiş) satırlarındaki donuk `unitPrice` × kabul günü kuru, kg ağırlıklı;
// kendi devere makinemizde sarılan leventin lotları WARP_ISSUE satırlarından. YALNIZ OKUR, paylaştırma yapmaz.
// =============================================================================
import { GoodsReceiptStatus, Prisma, YarnMovementKind, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;
type Dec = Prisma.Decimal;

export interface LotPriceRead {
  /** TL/kg; fiyatlı mal kabul satırı yoksa ya da kuru bulunamadıysa null. */
  priceTry: Dec | null;
  /** Fiyat var ama kuru yok (eksik kodu ayrımı için). */
  fxMissing: boolean;
}

/** Lotların TL/kg fiyatı (fiyatlı mal kabulü olmayan lot haritada YOKTUR). */
export async function readLotPricesTry(db: Db, lotIds: string[], fxRate: (c: Currency, at: Date) => Promise<Dec | null>): Promise<Map<string, LotPriceRead>> {
  const out = new Map<string, LotPriceRead>();
  if (lotIds.length === 0) return out;
  const rows = await db.yarnMovement.findMany({
    // İptal edilen fişin fiyatı lotun fiyatı değildir (fiş geri sarıldı); taslak fiş IN yazmaz.
    where: { lotId: { in: lotIds }, kind: YarnMovementKind.IN, unitPrice: { not: null }, goodsReceipt: { status: GoodsReceiptStatus.ACTIVE } },
    select: { lotId: true, qtyKg: true, unitPrice: true, createdAt: true, goodsReceipt: { select: { currency: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const acc = new Map<string, { amount: Dec; kg: Dec; fxMissing: boolean }>();
  for (const r of rows) {
    if (!r.lotId || !r.unitPrice || !r.goodsReceipt) continue;
    const a = acc.get(r.lotId) ?? { amount: new Prisma.Decimal(0), kg: new Prisma.Decimal(0), fxMissing: false };
    const rate = await fxRate(r.goodsReceipt.currency, r.createdAt);
    if (rate === null) a.fxMissing = true;
    else a.amount = a.amount.plus(r.unitPrice.mul(r.qtyKg).mul(rate));
    a.kg = a.kg.plus(r.qtyKg);
    acc.set(r.lotId, a);
  }
  for (const [lotId, a] of acc) {
    out.set(lotId, { priceTry: a.fxMissing || a.kg.lte(0) ? null : a.amount.div(a.kg), fxMissing: a.fxMissing });
  }
  return out;
}

export interface BeamIssueLot { beamId: string; yarnItemId: string; lotId: string; kg: Dec }

/** Kendi devere makinemizde sarılan leventlere çıkan lotlar (WARP_ISSUE) — yalnız fiyat ağırlığı için. */
export async function readBeamIssueLots(db: Db, beamIds: string[]): Promise<BeamIssueLot[]> {
  if (beamIds.length === 0) return [];
  const rows = await db.yarnMovement.findMany({
    where: { warpBeamId: { in: beamIds }, kind: YarnMovementKind.WARP_ISSUE, lotId: { not: null } },
    select: { warpBeamId: true, itemId: true, lotId: true, qtyKg: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ beamId: r.warpBeamId!, yarnItemId: r.itemId, lotId: r.lotId!, kg: r.qtyKg }));
}
