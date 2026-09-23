// =============================================================================
// YURTİÇİ / YURTDIŞI SATIŞ RAPORU (R2, 2026-09-23) — "sales/destination-mix"
// =============================================================================
// Soru: satışların ne kadarı yurtiçi, ne kadarı yurtdışı; ihracatta kime, nereye, ne
// kadar ve hangi fiyatla; yurtdışı açık sipariş ve termin durumu.
// Kaynaklar (her sayının kaynağı ekranda da yazar):
//   · metre/top  → `_shipped.collectShipped` (brüt, sevkiyatın DONMUŞ yönü)
//   · kg         → `_shipped.collectShippedWeight` (brüt, tartısız çuval "ölçülmedi")
//   · tutar      → `_destination-mix-money` (tahsis × satır fiyatı; kur yalnız kayıtlıysa)
//   · iade       → `roll_returns` (sevk dönemindeki sevkiyatlardan; brüt DÜŞÜLMEZ, ayrı sütun)
//   · backlog/termin → `_destination-mix-orders` (siparişin açılışta donmuş yönü)
// Kova: DOMESTIC · EXPORT · NONE (doğrudan sevk, yön kaydı yok) — sipariş tarafında UNSET.
// =============================================================================
import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { collectShipped, collectShippedWeight, type ShippedCell } from "./_shipped";
import { aggregateMoney, collectMoneyRows, type MixBucket, type MoneyAgg, type MoneyRow } from "./_destination-mix-money";
import { collectBacklog, collectFulfillment, type BacklogRow, type FulfillmentBucket, type OrderBucket } from "./_destination-mix-orders";

export const MIX_BUCKET_LABELS: Record<MixBucket | OrderBucket, string> = {
  DOMESTIC: "Yurtiçi",
  EXPORT: "Yurtdışı",
  NONE: "Yön kaydı yok (doğrudan sevk)",
  UNSET: "Yön belirsiz (kartta yön yok)",
};
export const KUR_KAYNAGI = "Kayıtlı kur tablosunun SEVK GÜNÜ (fabrika günü) satırı; satır yoksa TL karşılığı verilmez (\"kur yok\")";
const BUCKETS: MixBucket[] = ["DOMESTIC", "EXPORT", "NONE"];
const bucketOf = (d: string | null): MixBucket => (d === "DOMESTIC" || d === "EXPORT" ? d : "NONE");
const r1 = (n: number): number => Math.round(n * 10) / 10;

export interface MixBucketSummary {
  bucket: MixBucket;
  label: string;
  meters: number;
  rollCount: number;
  shipmentCount: number;
  kg: number;
  weighedSacks: number;
  totalSacks: number;
  /** Bu dönemde sevk edilenlerden iade edilen metre — brütten DÜŞÜLMEZ. */
  returnQty: number;
  money: MoneyAgg;
}

export interface MixBreakdownRow { key: string; label: string; bucket: MixBucket; meters: number; money: MoneyAgg; customerCount?: number; country?: string }

export interface DestinationMixReport {
  kapsam: { kurKaynagi: string; customersInPeriod: number; customersWithCountry: number };
  buckets: MixBucketSummary[];
  prevBuckets?: MixBucketSummary[];
  byCustomer: MixBreakdownRow[];
  byCountry: MixBreakdownRow[];
  byItem: MixBreakdownRow[];
  backlog: BacklogSummary[];
  backlogExport: BacklogRow[];
  fulfillment: FulfillmentBucket[];
}

export interface BacklogSummary {
  bucket: OrderBucket;
  label: string;
  openQty: number;
  overdueQty: number;
  openLines: number;
  overdueOrders: number;
  nonMtLines: number;
  pricedOpenQty: number;
  amounts: Array<{ currency: string; amount: number }>;
}

/** Kova özetleri — metre, kg, sevk sayısı, iade, tutar. */
async function summarize(range: DateRange, cells: ShippedCell[], money: MoneyRow[]): Promise<MixBucketSummary[]> {
  const [weights, counts, returns] = await Promise.all([
    collectShippedWeight(range),
    prisma.$queryRaw<Array<{ bucket: string; n: bigint }>>(Prisma.sql`
      SELECT destination::text AS bucket, COUNT(*) AS n FROM shipments
      WHERE status = 'DISPATCHED' AND "dispatchedAt" >= ${range.from} AND "dispatchedAt" <= ${range.to} GROUP BY 1
      UNION ALL
      SELECT 'NONE', COUNT(*) FROM direct_shipments WHERE "shippedAt" >= ${range.from} AND "shippedAt" <= ${range.to}`),
    prisma.$queryRaw<Array<{ bucket: string; qty: number }>>(Prisma.sql`
      SELECT s.destination::text AS bucket, SUM(rr.qty)::float AS qty
      FROM roll_returns rr JOIN shipments s ON s.id = rr."fromShipmentId"
      WHERE rr."cancelledAt" IS NULL AND s.status = 'DISPATCHED' AND s."dispatchedAt" >= ${range.from} AND s."dispatchedAt" <= ${range.to}
      GROUP BY 1`),
  ]);
  return BUCKETS.map((b) => {
    const cs = cells.filter((c) => bucketOf(c.destination) === b);
    const ws = weights.filter((w) => w.destination === b);
    return {
      bucket: b,
      label: MIX_BUCKET_LABELS[b],
      meters: r1(cs.reduce((a, c) => a + c.qty, 0)),
      rollCount: cs.reduce((a, c) => a + c.rollCount, 0),
      shipmentCount: counts.filter((c) => c.bucket === b).reduce((a, c) => a + Number(c.n), 0),
      kg: r1(ws.reduce((a, w) => a + w.kg, 0)),
      weighedSacks: ws.reduce((a, w) => a + w.weighedSacks, 0),
      totalSacks: ws.reduce((a, w) => a + w.totalSacks, 0),
      returnQty: r1(returns.filter((x) => x.bucket === b).reduce((a, x) => a + Number(x.qty), 0)),
      money: aggregateMoney(money.filter((m) => m.bucket === b)),
    };
  });
}

/** Kova × anahtar kırılımı (müşteri · ürün · ülke) — metre `collectShipped`ten, tutar tahsisten. */
function breakdown(
  cells: ShippedCell[],
  money: MoneyRow[],
  keyOfCell: (c: ShippedCell) => [string, string],
  keyOfMoney: (m: MoneyRow) => string,
): MixBreakdownRow[] {
  const rows = new Map<string, MixBreakdownRow & { moneyRows: MoneyRow[] }>();
  const at = (b: MixBucket, key: string, label: string) => {
    const id = `${b}|${key}`;
    const r = rows.get(id) ?? { key, label, bucket: b, meters: 0, money: aggregateMoney([]), moneyRows: [] };
    rows.set(id, r);
    return r;
  };
  for (const c of cells) {
    const [key, label] = keyOfCell(c);
    at(bucketOf(c.destination), key, label).meters += c.qty;
  }
  for (const m of money) {
    const key = keyOfMoney(m);
    const existing = rows.get(`${m.bucket}|${key}`);
    (existing ?? at(m.bucket, key, key)).moneyRows.push(m);
  }
  return [...rows.values()]
    .map(({ moneyRows, ...r }) => ({ ...r, meters: r1(r.meters), money: aggregateMoney(moneyRows) }))
    .sort((a, b) => b.meters - a.meters);
}

/** Müşteri → ülke (serbest metin; trim + katlanmış anahtarla gruplanır, düzeltilmez). */
async function customerCountries(ids: string[]): Promise<Map<string, { key: string; label: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; label: string | null; key: string | null }>>(Prisma.sql`
    SELECT id, NULLIF(btrim(country), '') AS label, NULLIF(public.tr_fold(btrim(country)), '') AS key
    FROM customers WHERE id IN (${Prisma.join(ids.map((x) => Prisma.sql`${x}::uuid`))})`);
  return new Map(rows.map((r) => [r.id, r.key ? { key: r.key, label: r.label ?? r.key } : { key: "__NONE__", label: "Belirtilmemiş" }]));
}

function summarizeBacklog(rows: BacklogRow[]): BacklogSummary[] {
  return (["DOMESTIC", "EXPORT", "UNSET"] as OrderBucket[]).map((b) => {
    const rs = rows.filter((r) => r.bucket === b);
    const byCur = new Map<string, number>();
    for (const r of rs) if (r.openAmount) byCur.set(r.currency, (byCur.get(r.currency) ?? 0) + r.openAmount);
    const sum = (f: (r: BacklogRow) => number) => rs.reduce((a, r) => a + f(r), 0);
    return {
      bucket: b,
      label: MIX_BUCKET_LABELS[b],
      openQty: r1(sum((r) => r.openQty)),
      overdueQty: r1(sum((r) => r.overdueQty)),
      openLines: sum((r) => r.openLines),
      overdueOrders: sum((r) => r.overdueOrders),
      nonMtLines: sum((r) => r.nonMtLines),
      pricedOpenQty: r1(sum((r) => r.pricedOpenQty)),
      amounts: [...byCur.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
    };
  });
}

export async function getDestinationMix(range: DateRange, compareRange: DateRange | null = null): Promise<DestinationMixReport> {
  const [cells, money, prevCells, prevMoney, backlogRows, fulfillment] = await Promise.all([
    collectShipped(range),
    collectMoneyRows(range),
    compareRange ? collectShipped(compareRange) : Promise.resolve<ShippedCell[]>([]),
    compareRange ? collectMoneyRows(compareRange) : Promise.resolve<MoneyRow[]>([]),
    collectBacklog(),
    collectFulfillment(range),
  ]);
  const customerIds = [...new Set([...cells.map((c) => c.customerId), ...money.map((m) => m.customerId)])];
  const countries = await customerCountries(customerIds);
  const countryOf = (id: string) => countries.get(id) ?? { key: "__NONE__", label: "Belirtilmemiş" };
  const byCountry = breakdown(cells, money, (c) => [countryOf(c.customerId).key, countryOf(c.customerId).label], (m) => countryOf(m.customerId).key);
  for (const row of byCountry) {
    row.customerCount = new Set(cells.filter((c) => countryOf(c.customerId).key === row.key && bucketOf(c.destination) === row.bucket).map((c) => c.customerId)).size;
  }
  const byCustomer = breakdown(cells, money, (c) => [c.customerId, c.customerName], (m) => m.customerId);
  for (const row of byCustomer) row.country = countryOf(row.key).label;
  return {
    kapsam: {
      kurKaynagi: KUR_KAYNAGI,
      customersInPeriod: customerIds.length,
      customersWithCountry: customerIds.filter((id) => countryOf(id).key !== "__NONE__").length,
    },
    buckets: await summarize(range, cells, money),
    ...(compareRange ? { prevBuckets: await summarize(compareRange, prevCells, prevMoney) } : {}),
    byCustomer,
    byCountry,
    byItem: breakdown(cells, money, (c) => [c.itemId ?? "__UNKNOWN_ITEM__", c.itemName ?? "Belirtilmemiş"], (m) => m.itemId),
    backlog: summarizeBacklog(backlogRows),
    backlogExport: backlogRows.filter((r) => r.bucket === "EXPORT").sort((a, b) => b.openQty - a.openQty),
    fulfillment,
  };
}
