// Fiyat sürümü yazımının audit ayak izi ve tarife birimi çözümü (`item-price.service` upsert'inden ayrıldı).
import { Prisma, PriceKind, Currency, type ServiceQtyUnit } from "@prisma/client";
import { AuditService } from "../audit.service";
import { ITEM_PRICE_REVOKE_REASON } from "./item-price-validity.helper";

/**
 * İstenen tarife birimi: METER = NULL (bugünkü satırlarla aynı biçim). `undefined` = alan
 * GÖNDERİLMEDİ → çağıran mevcut sürümün birimini korur (eski panel ADET satırını metreye çevirmesin).
 */
export function requestedPriceUnit(input: ServiceQtyUnit | null | undefined): ServiceQtyUnit | null | undefined {
  if (input === undefined) return undefined;
  return input && input !== "METER" ? input : null;
}

interface PriceVersionRef {
  id: string;
  price: Prisma.Decimal;
  priceUnit: ServiceQtyUnit | null;
}

/** Eski sürümün damgası (UPDATE) + yeni sürümün doğumu (CREATE); yalnız sürüm yazıldıysa çağrılır. */
export function logItemPriceVersionWrite(args: {
  userId?: string;
  key: { itemId: string; customerId: string | null; kind: PriceKind; currency: Currency };
  rowId: string;
  previous: PriceVersionRef | null;
  price: Prisma.Decimal;
  priceUnit: ServiceQtyUnit | null;
}): void {
  const { userId, key, rowId, previous, price, priceUnit } = args;
  if (previous) {
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ITEM_PRICE",
      recordId: previous.id,
      oldData: { revokeReason: null },
      newData: { ...key, price: previous.price.toFixed(4), revokeReason: ITEM_PRICE_REVOKE_REASON.CHANGED },
    });
  }
  void AuditService.log({
    userId,
    action: "CREATE",
    tableName: "ITEM_PRICE",
    recordId: rowId,
    oldData: previous ? { price: previous.price.toFixed(4), ...(previous.priceUnit ? { priceUnit: previous.priceUnit } : {}) } : null,
    newData: { ...key, price: price.toFixed(4), ...(priceUnit ? { priceUnit } : {}) },
  });
}
