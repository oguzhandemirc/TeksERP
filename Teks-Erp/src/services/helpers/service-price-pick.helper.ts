// =============================================================================
// HİZMET FİYAT SIRASI — tek kaynak (hizmet fiyat tablosu, kullanıcı kararı K1/K5 2026-11-06)
// =============================================================================
// Soru: "bu hizmet işinin birim fiyatı nereden gelir?" Sıra (K1): müşteri KADEME fiyatı → müşteri
// GRAM fiyatı (iş anında geçerli) → genel KADEME fiyatı → istasyon gram fiyatı / sonradan girilmiş gram
// → kalem fiyatı (müşteri > genel). K5: kalemin o anda geçerli kademe satırı varsa ve işin kademesi
// tabloda yoksa kalem fiyatına DÜŞÜLMEZ → fiyatsız + uyarı (gram formülü yine uygulanır).
// Kademe satırı hiç yokken sıra bugünküyle aynıdır (gram > kalem). İkinci kopya yasak (`test_hizmet_fiyati` §8).
// =============================================================================
import { Prisma, PriceKind, type Currency, type ServiceQtyUnit } from "@prisma/client";
import prisma from "../../lib/prisma";
import { itemPriceValidAt } from "./item-price-validity.helper";
import type { KursunGramCandidate } from "./kursun-gram-price.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Fiyatın kaynağı — panel rozeti ve tablo ucu aynı adı kullanır. */
export type ServicePriceSource = "CUSTOMER_TIER" | "CUSTOMER_GRAM" | "TIER" | "STATION_GRAM" | "ITEM";

export interface TierPriceRow {
  id: string;
  price: Prisma.Decimal;
  priceUnit: ServiceQtyUnit | null;
  customerId: string | null;
  validFrom: Date | null;
}

/** Bir an için kademe tablosu: kademesi olan kalemler + `${itemId}:${valueId}` → müşteri/genel satır. */
export interface ServiceTierTable {
  itemsWithTiers: Set<string>;
  byKey: Map<string, { customer?: TierPriceRow; general?: TierPriceRow }>;
}

export const tierKey = (itemId: string, valueId: string): string => `${itemId}:${valueId}`;

/** `at` anında geçerli kademe satırları (müşteri + genel) — tek sorgu. */
export async function loadServiceTierPrices(params: {
  itemIds: string[];
  currency: Currency;
  customerId: string | null;
  at: Date;
  db?: Db;
}): Promise<ServiceTierTable> {
  const out: ServiceTierTable = { itemsWithTiers: new Set(), byKey: new Map() };
  const ids = [...new Set(params.itemIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const rows = await (params.db ?? prisma).itemPrice.findMany({
    where: {
      AND: [
        itemPriceValidAt(params.at),
        {
          itemId: { in: ids },
          propertyValueId: { not: null },
          kind: PriceKind.SALE,
          currency: params.currency,
          ...(params.customerId ? { OR: [{ customerId: params.customerId }, { customerId: null }] } : { customerId: null }),
        },
      ],
    },
    select: { id: true, itemId: true, propertyValueId: true, customerId: true, price: true, priceUnit: true, validFrom: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const r of rows) {
    out.itemsWithTiers.add(r.itemId);
    const k = tierKey(r.itemId, r.propertyValueId!);
    const slot = out.byKey.get(k) ?? {};
    // Başka müşterinin satırı sorgudan gelmez; `customerId` eşitliği ikinci sed.
    if (r.customerId && r.customerId === params.customerId) slot.customer ??= r;
    else if (!r.customerId) slot.general ??= r;
    out.byKey.set(k, slot);
  }
  return out;
}

/** Hizmet başına güncel + bekleyen kademe satırı sayısı (tablonun sol listesi; fiyat SEÇMEZ). */
export async function countServiceTierRows(itemIds: string[], now: Date, db: Db = prisma): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  // `revokedAt` SÜZÜLMEZ — açık ya da zamanlanmış damgalı (yürürlükte) satırlar sayılır.
  const counts = await db.itemPrice.groupBy({
    by: ["itemId"],
    where: { itemId: { in: itemIds }, propertyValueId: { not: null }, OR: [{ revokedAt: null }, { revokedAt: { gt: now } }] },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.itemId, c._count._all]));
}

export interface ServicePriceCandidates {
  customerTier: Prisma.Decimal | null;
  generalTier: Prisma.Decimal | null;
  gram: KursunGramCandidate | null;
  item: Prisma.Decimal | null;
  /** Kalemin bu anda geçerli herhangi bir kademe satırı var mı (K5). */
  itemHasTiers: boolean;
  /** İşin kademesinin (değer) tabloda satırı var mı (K5). */
  valueInTable: boolean;
}

export type ServicePricePick =
  | { unitPrice: Prisma.Decimal; source: ServicePriceSource; gram: KursunGramCandidate | null; tierMissing: false }
  | { unitPrice: null; source: null; gram: null; tierMissing: boolean };

/** ÇÖZÜM SIRASININ TEK UYGULAMA NOKTASI (K1 + K5). Saf fonksiyon. */
export function pickServicePrice(c: ServicePriceCandidates): ServicePricePick {
  if (c.customerTier) return { unitPrice: c.customerTier, source: "CUSTOMER_TIER", gram: null, tierMissing: false };
  if (c.gram && c.gram.owner === "CUSTOMER" && !c.gram.late) return { unitPrice: c.gram.unitPrice, source: "CUSTOMER_GRAM", gram: c.gram, tierMissing: false };
  if (c.generalTier) return { unitPrice: c.generalTier, source: "TIER", gram: null, tierMissing: false };
  if (c.gram) return { unitPrice: c.gram.unitPrice, source: c.gram.owner === "CUSTOMER" ? "CUSTOMER_GRAM" : "STATION_GRAM", gram: c.gram, tierMissing: false };
  if (c.itemHasTiers && !c.valueInTable) return { unitPrice: null, source: null, gram: null, tierMissing: true };
  if (c.item) return { unitPrice: c.item, source: "ITEM", gram: null, tierMissing: false };
  return { unitPrice: null, source: null, gram: null, tierMissing: false };
}

/** K5 uyarı metni — bekçi aynı cümleyi arar. */
export function tierMissingWarning(itemName: string, count: number): string {
  return `"${itemName}" hizmet fiyat tablosunda ${count} işin kademesi yok — satır fiyatsız (kalem fiyatına düşülmedi); tabloya kademe fiyatı girin.`;
}
