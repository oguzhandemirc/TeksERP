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
  key: { itemId: string; customerId: string | null; propertyValueId?: string | null; kind: PriceKind; currency: Currency };
  rowId: string;
  previous: PriceVersionRef | null;
  /** İleri tarihli fiyat değişince yerine geçilen bekleyen satır (hiç yürürlüğe girmeden kapandı). */
  replacedPending?: { id: string; price: Prisma.Decimal } | null;
  price: Prisma.Decimal;
  priceUnit: ServiceQtyUnit | null;
  /** İleri tarihli yeni sürümün başlangıcı; doluysa önceki sürüm o tarihte kapanır (zamanlanmış damga). */
  validFrom?: Date | null;
}): void {
  const { userId, key, rowId, previous, replacedPending, price, priceUnit, validFrom } = args;
  if (replacedPending) {
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ITEM_PRICE",
      recordId: replacedPending.id,
      oldData: { revokeReason: null },
      newData: { ...key, price: replacedPending.price.toFixed(4), revokeReason: ITEM_PRICE_REVOKE_REASON.CHANGED },
    });
  }
  if (previous) {
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ITEM_PRICE",
      recordId: previous.id,
      oldData: { revokeReason: null },
      newData: {
        ...key,
        price: previous.price.toFixed(4),
        revokeReason: validFrom ? ITEM_PRICE_REVOKE_REASON.SCHEDULED : ITEM_PRICE_REVOKE_REASON.CHANGED,
        ...(validFrom ? { revokedAt: validFrom.toISOString() } : {}),
      },
    });
  }
  void AuditService.log({
    userId,
    action: "CREATE",
    tableName: "ITEM_PRICE",
    recordId: rowId,
    oldData: previous ? { price: previous.price.toFixed(4), ...(previous.priceUnit ? { priceUnit: previous.priceUnit } : {}) } : null,
    newData: { ...key, price: price.toFixed(4), ...(priceUnit ? { priceUnit } : {}), ...(validFrom ? { validFrom: validFrom.toISOString() } : {}) },
  });
}
