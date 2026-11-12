// =============================================================================
// SARF TÜKETİM MALİYETİ — ağırlıklı ortalama alış fiyatı, TEK OKUYUCU (2026-11-10, GK sarf K4)
// =============================================================================
// Soru: "bu tüketim satırı kaç TL?" = qty × kalemin TÜKETİM ANINDAKİ ağırlıklı ortalama alış birim fiyatı.
// Ortalama, o ana kadarki mal kabul girişlerinden (`RECEIPT_IN`, fiyatlı) — o andan ÖNCE iptal edilenler
// (`RECEIPT_CANCEL_OUT`) düşülür; fiş para birimi TL'ye fişin gününün kuruyla (`suggestFxRate`, finans köprüsü).
// Fiyat AYRI TABLOYA YAZILMAZ, her okumada defterden türetilir. Fiyatlı alış yoksa ya da kur bulunamazsa
// `null` = "bilinmiyor" (sessiz 0 YOK). Aritmetik `Prisma.Decimal`; yuvarlama sunumda.
// =============================================================================
import { ConsumableMovementKind, Prisma, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { suggestFxRate } from "./maliyet-bridge.helper";

type Dec = Prisma.Decimal;

interface PricedReceipt {
  at: number;
  cancelledAt: number | null;
  qty: Dec;
  /** TL birim fiyat; kur yoksa null (o ana düşen ortalama bilinmiyor olur). */
  unitTry: Dec | null;
}

/** Kalem → fiyatlı alış girişleri (zaman sıralı). TL çevrimi fişin gününün kuruyla, (döviz, gün) önbellekli. */
async function loadPricedReceipts(itemIds: string[]): Promise<Map<string, PricedReceipt[]>> {
  const out = new Map<string, PricedReceipt[]>();
  if (itemIds.length === 0) return out;
  const rows = await prisma.consumableMovement.findMany({
    where: { itemId: { in: itemIds }, kind: ConsumableMovementKind.RECEIPT_IN, unitPrice: { not: null } },
    select: { itemId: true, qty: true, unitPrice: true, createdAt: true, goodsReceipt: { select: { currency: true } }, reversedBy: { select: { createdAt: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const fxMemo = new Map<string, Promise<Dec | null>>();
  const fx = (currency: Currency, at: Date) => {
    const k = `${currency}:${at.toISOString().slice(0, 10)}`;
    if (!fxMemo.has(k)) fxMemo.set(k, suggestFxRate(currency, at));
    return fxMemo.get(k)!;
  };
  for (const r of rows) {
    const rate = await fx(r.goodsReceipt?.currency ?? "TRY", r.createdAt);
    const list = out.get(r.itemId) ?? [];
    list.push({ at: r.createdAt.getTime(), cancelledAt: r.reversedBy?.createdAt.getTime() ?? null, qty: r.qty, unitTry: rate ? r.unitPrice!.mul(rate) : null });
    out.set(r.itemId, list);
  }
  return out;
}

/** `at` anında geçerli ağırlıklı ortalama TL birim fiyat; fiyatlı alış yok ya da bir girişin kuru yok → null. */
export function weightedAverageAt(receipts: PricedReceipt[] | undefined, at: Date): Dec | null {
  const t = at.getTime();
  const live = (receipts ?? []).filter((r) => r.at <= t && (r.cancelledAt === null || r.cancelledAt > t));
  if (live.length === 0 || live.some((r) => r.unitTry === null)) return null;
  const qty = live.reduce((a, r) => a.plus(r.qty), new Prisma.Decimal(0));
  if (qty.lte(0)) return null;
  return live.reduce((a, r) => a.plus(r.qty.mul(r.unitTry!)), new Prisma.Decimal(0)).div(qty);
}

/** Tüketim satırlarının TL maliyeti (satır sırası korunur); bilinmeyen satır `null`. */
export async function consumptionCostsTry(rows: Array<{ itemId: string; qty: Dec; createdAt: Date }>): Promise<Array<{ unitTry: Dec | null; costTry: Dec | null }>> {
  const receipts = await loadPricedReceipts([...new Set(rows.map((r) => r.itemId))]);
  return rows.map((r) => {
    const unitTry = weightedAverageAt(receipts.get(r.itemId), r.createdAt);
    return { unitTry, costTry: unitTry ? r.qty.mul(unitTry) : null };
  });
}
