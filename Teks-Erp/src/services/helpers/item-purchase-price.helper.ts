// =============================================================================
// GENEL ALIŞ FİYATI OKUYUCUSU (ticaret modülünün malı) — maliyet köprüsü için
// =============================================================================
// `maliyet-bridge.helper` bunu yalnız ticaret AÇIKKEN ve DİNAMİK import ile çağırır; statik
// bağ `/api/cost`u ticaret kapısına bağlatırdı (`test_ticaret_regime_gate`). Damgalı satır
// okunmaz (`ACTIVE_ITEM_PRICE`, MAL-0b).
// =============================================================================
import { PriceKind, type Currency, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { ACTIVE_ITEM_PRICE } from "./item-price-validity.helper";

/** Kalemin bugün geçerli GENEL (müşteriye özel olmayan) alış fiyatı; birden çok dövizde en yenisi. */
export async function readLatestPurchasePrice(
  itemId: string,
): Promise<{ price: Prisma.Decimal; currency: Currency; at: Date; id: string } | null> {
  const row = await prisma.itemPrice.findFirst({
    where: { itemId, kind: PriceKind.PURCHASE, customerId: null, ...ACTIVE_ITEM_PRICE },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, price: true, currency: true, createdAt: true },
  });
  return row ? { price: row.price, currency: row.currency, at: row.createdAt, id: row.id } : null;
}
