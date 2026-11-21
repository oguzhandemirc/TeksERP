// =============================================================================
// SEVK İRSALİYESİ ÜRÜN LİSTESİ BİRİM FİYATI (SY-C4) — sevk anında snapshot'a DONAR
// =============================================================================
// Fiyat kaynağı faturayla AYNI zincir: çuval → etkin `SackAllocation` → `OrderLine.unitPrice` +
// `Order.currency`. Ürün satırı (stok adı = ürün + renk + en) için TEK (fiyat, döviz) çözülürse
// yazılır; fiyatsız ya da birden çok fiyat → yok (uydurma yok, hücre boş). Kolon müşteri belgesinde
// iç veridir: renderer'da `defaultHidden` (Belge Kişiselleştirme'den açılır, varsayılan KAPALI).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import type { PrintedDocDb } from "../printed-document.service";
import { ACTIVE_SACK_ALLOCATION } from "../helpers/sack-allocation.helper";

export interface DispatchUnitPrice { unitPrice: Prisma.Decimal; currency: Currency }

/** `itemId|colorId` → fiyat kümesi; renksiz sipariş satırı `itemId|` anahtarında (her renge uyar). */
export async function loadDispatchUnitPrices(db: PrintedDocDb, sackIds: string[]): Promise<(keys: Array<{ itemId: string; colorId: string | null }>) => DispatchUnitPrice | null> {
  const rows = sackIds.length
    ? await db.sackAllocation.findMany({
        where: { ...ACTIVE_SACK_ALLOCATION, sackId: { in: sackIds } },
        select: { orderLine: { select: { itemId: true, colorId: true, unitPrice: true, order: { select: { currency: true } } } } },
      })
    : [];
  const byKey = new Map<string, Map<string, DispatchUnitPrice>>();
  for (const r of rows) {
    const ol = r.orderLine;
    if (ol.unitPrice == null) continue;
    const key = `${ol.itemId}|${ol.colorId ?? ""}`;
    const m = byKey.get(key) ?? new Map<string, DispatchUnitPrice>();
    m.set(`${ol.unitPrice.toString()}|${ol.order.currency}`, { unitPrice: ol.unitPrice, currency: ol.order.currency });
    byKey.set(key, m);
  }
  return (keys) => {
    const found = new Map<string, DispatchUnitPrice>();
    for (const k of keys) {
      const exact = byKey.get(`${k.itemId}|${k.colorId ?? ""}`) ?? byKey.get(`${k.itemId}|`);
      for (const [id, p] of exact ?? []) found.set(id, p);
    }
    return found.size === 1 ? [...found.values()][0]! : null;
  };
}
