// =============================================================================
// YURTİÇİ/YURTDIŞI SATIŞ — TUTAR TARAFI (R2, 2026-09-23)
// =============================================================================
// Tutar = sevk anındaki tahsis (`SackAllocation` · doğrudan sevkte
// `SubcontractorDirectShipAllocation`) × sipariş satırı fiyatı, sipariş başlığının para
// biriminde. Para birimleri AYRI kalır, çevrim UYDURULMAZ: TL karşılığı yalnız
// `exchange_rates`in SEVK GÜNÜ (fabrika günü) satırıyla verilir; satır yoksa "kur yok".
// Fiyatı girilmemiş satır 0 SAYILMAZ — kapsam "fiyatlı N / M satır" olarak döner.
// Yön: sevkiyatın DONMUŞ yönü; doğrudan sevk "NONE" (yön kaydı yok).
// =============================================================================
import prisma from "../../lib/prisma";
import { Prisma, type Currency } from "@prisma/client";
import { factoryDaySql } from "../../constants/time";
import type { DateRange } from "./_shared";

export type MixBucket = "DOMESTIC" | "EXPORT" | "NONE";

export interface MoneyRow {
  bucket: MixBucket;
  customerId: string;
  itemId: string;
  currency: Currency;
  qty: number;
  unitPrice: number | null;
  /** Sevk günündeki kayıtlı kur (TRY için 1); yoksa null = "kur yok". */
  rate: number | null;
}

/** Dönemde sevk edilen tahsis satırları, fiyat + sevk günü kuru ile. */
export async function collectMoneyRows(range: DateRange): Promise<MoneyRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ bucket: MixBucket; customerId: string; itemId: string; currency: Currency; qty: number; unitPrice: number | null; rate: number | null }>
  >(Prisma.sql`
    WITH al AS (
      SELECT s.destination::text AS bucket, s."customerId", sa."orderLineId", sa.qty, ${factoryDaySql('s."dispatchedAt"')} AS day
      FROM sack_allocations sa
      JOIN sacks k     ON k.id = sa."sackId"
      JOIN shipments s ON s.id = k."shipmentId"
      WHERE sa."clearedAt" IS NULL AND s.status = 'DISPATCHED' AND s."dispatchedAt" >= ${range.from} AND s."dispatchedAt" <= ${range.to}
      UNION ALL
      SELECT 'NONE', ds."customerId", a."orderLineId", a.qty, ${factoryDaySql('ds."shippedAt"')}
      FROM subcontractor_direct_ship_allocations a
      JOIN direct_shipments ds ON ds.id = a."directShipmentId"
      WHERE ds."shippedAt" >= ${range.from} AND ds."shippedAt" <= ${range.to}
    )
    SELECT al.bucket, al."customerId", ol."itemId", o.currency,
           al.qty::float AS qty, ol."unitPrice"::float AS "unitPrice",
           CASE WHEN o.currency = 'TRY' THEN 1 ELSE er.rate::float END AS rate
    FROM al
    -- aktif-kalem-muaf: GEÇMİŞ sorusu — sevk anındaki tahsisin tutarı gerçektir; kalem sonradan
    -- iptal edilse de sevk edilen metre raporda durur, tutarı da durmalı (metre ↔ tutar aynı küme).
    JOIN order_lines ol ON ol.id = al."orderLineId"
    JOIN orders o       ON o.id = ol."orderId"
    LEFT JOIN exchange_rates er ON er."rateDate" = al.day AND er.currency = o.currency
  `);
  return rows.map((r) => ({ ...r, qty: Number(r.qty), unitPrice: r.unitPrice == null ? null : Number(r.unitPrice), rate: r.rate == null ? null : Number(r.rate) }));
}

export interface CurrencyAmount {
  currency: Currency;
  amount: number;
  /** Fiyatlı satırların miktarı — ortalama birim fiyatın paydası. */
  pricedQty: number;
  avgUnitPrice: number;
}

export interface MoneyAgg {
  lineCount: number;
  pricedLineCount: number;
  amounts: CurrencyAmount[];
  /** Kayıtlı kurla TL karşılığı — yalnız kuru bulunan satırlardan. */
  tlTotal: number;
  /** Fiyatlı ama sevk gününde kuru OLMAYAN satır sayısı ("kur yok"). */
  noRateLineCount: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Satırları tek tutar kümesine indirger (para birimi başına ayrı). */
export function aggregateMoney(rows: MoneyRow[]): MoneyAgg {
  const byCur = new Map<Currency, { amount: number; pricedQty: number }>();
  let pricedLineCount = 0;
  let tlTotal = 0;
  let noRateLineCount = 0;
  for (const r of rows) {
    if (r.unitPrice == null) continue;
    pricedLineCount++;
    const amount = r.qty * r.unitPrice;
    const cur = byCur.get(r.currency) ?? { amount: 0, pricedQty: 0 };
    cur.amount += amount;
    cur.pricedQty += r.qty;
    byCur.set(r.currency, cur);
    if (r.rate == null) noRateLineCount++;
    else tlTotal += amount * r.rate;
  }
  const amounts = [...byCur.entries()]
    .map(([currency, v]) => ({ currency, amount: r2(v.amount), pricedQty: r2(v.pricedQty), avgUnitPrice: v.pricedQty > 0 ? r2(v.amount / v.pricedQty) : 0 }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { lineCount: rows.length, pricedLineCount, amounts, tlTotal: r2(tlTotal), noRateLineCount };
}
