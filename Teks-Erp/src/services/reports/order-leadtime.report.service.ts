// =============================================================================
// SİPARİŞ → TESLİM SÜRESİ — "kaç gün termin sözü verebilirim"
// =============================================================================
// Sevk & Termin Karnesi "sözümüzü tuttuk mu" sorusunu ölçer. Bu rapor bir
// öncesini sorar: SÖZ NE OLMALI. Bugün teklif verilirken termin tahminle
// söyleniyor; buradaki medyan onun yerine geçer.
//
// ── İKİ AYRI SÜRE, İKİ AYRI SORU ───────────────────────────────────────────
// İLK SEVK süresi  : "ne zaman mal çıkmaya başlar" — müşteriye ilk teslimat.
// TAM KAPANIŞ süresi: "ne zaman biter" — siparişin tamamı çıkana kadar.
// İkisi çok farklı olabilir (kısmi sevkli sipariş haftalarca açık kalır) ve
// tek sayıya indirmek termin sözünü sistematik olarak yanlışlar.
//
// ── ORTALAMA DEĞİL MEDYAN ──────────────────────────────────────────────────
// Ortalama tek bir felaket siparişle (6 ay bekleyen bir iş) yukarı çekilir ve
// "ortalama 45 gün" diye söz verilen bir termin, siparişlerin yarısında
// tutmayabilir. Medyan bu yüzden ana rakamdır; ortalama YANINDA gösterilir ki
// ikisi arasındaki açıklık (çarpıklık) da görünsün. P90 da döner: "her 10
// siparişten 9'u şu kadar günde çıktı" — taahhüt verirken doğru dayanak.
//
// ⚠️ ÇIPA `orderDate`'tir (işin alındığı an). Sürenin başlangıcı kaydın
// yazıldığı an olsaydı, geç girilen siparişler kendiliğinden "hızlı" görünürdü.
//
// ⚠️ VERİ YETERSİZLİĞİ GİZLENMEZ. Az örnekle hesaplanan medyan bir istatistik
// değil bir tesadüftür; `sampleSize` her seviyede döner ve ekran eşiğin altında
// sayı yerine uyarı basar.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { round1 } from "./_breakdown";

/** Altında istatistiğin anlamsız sayıldığı örnek sayısı. */
export const MIN_SAMPLE = 5;

export interface LeadTimeStats {
  sampleSize: number;
  medianDays: number | null;
  avgDays: number | null;
  p90Days: number | null;
  minDays: number | null;
  maxDays: number | null;
}

export interface LeadTimeBucketRow {
  key: string;
  label: string;
  /** İlk sevke kadar geçen süre. */
  firstShip: LeadTimeStats;
  /** Tam kapanışa kadar geçen süre. */
  fullClose: LeadTimeStats;
}

export interface LeadTimeOrderRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  firstShipDate: string | null;
  firstShipDays: number | null;
  completedAt: string | null;
  fullCloseDays: number | null;
  /** Hâlâ açık ve hiç sevk görmemişse kaç gündür bekliyor. */
  openDays: number | null;
}

export interface OrderLeadTimeReport {
  firstShip: LeadTimeStats;
  fullClose: LeadTimeStats;
  byCustomer: LeadTimeBucketRow[];
  byItem: LeadTimeBucketRow[];
  orders: LeadTimeOrderRow[];
  /** Dönemde açılan ama hiç sevk görmemiş sipariş adedi — medyanın DIŞINDA. */
  neverShippedCount: number;
  /** Ekranın "yeterli veri yok" kararını verdiği eşik. */
  minSample: number;
}

const EMPTY: LeadTimeStats = {
  sampleSize: 0,
  medianDays: null,
  avgDays: null,
  p90Days: null,
  minDays: null,
  maxDays: null,
};

/**
 * Yüzdelik — "nearest rank" yöntemi. Enterpolasyonlu varyantlar küçük
 * örneklerde var olmayan bir gün değeri üretir ("13.4 gün"); termin sözü
 * verilirken gerçekten gözlenmiş bir gün daha savunulabilir.
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] ?? null;
}

function stats(values: number[]): LeadTimeStats {
  if (values.length === 0) return { ...EMPTY };
  const s = [...values].sort((a, b) => a - b);
  return {
    sampleSize: s.length,
    medianDays: round1(percentile(s, 50) ?? 0),
    avgDays: round1(s.reduce((a, b) => a + b, 0) / s.length),
    p90Days: round1(percentile(s, 90) ?? 0),
    minDays: round1(s[0]!),
    maxDays: round1(s[s.length - 1]!),
  };
}

interface RawRow {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  orderDate: Date;
  completedAt: Date | null;
  firstShipAt: Date | null;
  itemIds: string[] | null;
  itemNames: string[] | null;
}

/**
 * Dönemde AÇILAN siparişler + ilk sevk anı.
 *
 * İlk sevk iki kaynaktan gelebilir ve ikisinin EN ERKENİ alınır:
 *   • çuval sevkiyatı (SackAllocation → Sack → Shipment, yalnız DISPATCHED)
 *   • fason doğrudan sevk (SubcontractorDirectShipAllocation → DirectShipment)
 * Tek kaynağa bakmak, fasondan doğrudan çıkan siparişleri "hiç sevk edilmemiş"
 * gösterirdi (`getOrderShipments` de aynı iki kaynağı birleştirir).
 */
async function collect(range: DateRange): Promise<RawRow[]> {
  return prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT o.id                AS "orderId",
           o."orderNumber"     AS "orderNumber",
           c.id                AS "customerId",
           c.name              AS "customerName",
           o."orderDate"       AS "orderDate",
           o."completedAt"     AS "completedAt",
           LEAST(sack.first_at, direct.first_at) AS "firstShipAt",
           items.ids           AS "itemIds",
           items.names         AS "itemNames"
    FROM orders o
    JOIN customers c ON c.id = o."customerId"
    LEFT JOIN LATERAL (
      SELECT MIN(sh."dispatchedAt") AS first_at
      -- aktif-kalem-muaf: GEÇMİŞ sorusu. "İlk sevk ne zaman oldu" olgusu, kalem
      -- sonradan iptal edilse de değişmez — mal çıktıysa çıkmıştır. Süzgeç
      -- konsaydı kısmi sevk sonrası iptal edilen kalemin sevki kaybolur ve
      -- sipariş "hiç sevk görmemiş" sayılırdı.
      FROM order_lines ol
      JOIN sack_allocations sa ON sa."orderLineId" = ol.id AND sa."clearedAt" IS NULL
      JOIN sacks s             ON s.id = sa."sackId"
      JOIN shipments sh        ON sh.id = s."shipmentId" AND sh.status = 'DISPATCHED'
      WHERE ol."orderId" = o.id
    ) sack ON true
    LEFT JOIN LATERAL (
      SELECT MIN(ds."shippedAt") AS first_at
      -- aktif-kalem-muaf: GEÇMİŞ sorusu (yukarıdaki gerekçe, fason dalı).
      FROM order_lines ol
      JOIN subcontractor_direct_ship_allocations dsa ON dsa."orderLineId" = ol.id
      JOIN direct_shipments ds ON ds.id = dsa."directShipmentId"
      WHERE ol."orderId" = o.id
    ) direct ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT ol."itemId"::text) AS ids,
             array_agg(DISTINCT i.name)            AS names
      FROM order_lines ol
      JOIN items i ON i.id = ol."itemId"
      -- aktif-kalem: iptal edilmiş kalemin kumaşı teslim süresi kırılımına girmez.
      WHERE ol."orderId" = o.id AND ol."cancelledAt" IS NULL
    ) items ON true
    WHERE o."orderDate" >= ${range.from} AND o."orderDate" <= ${range.to}
      AND o.status <> 'CANCELLED'
  `);
}

/** İki an arası TAM gün. tz-ok: mutlak pencere, takvim günü sorusu değil. */
const days = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);

export async function getOrderLeadTime(range: DateRange): Promise<OrderLeadTimeReport> {
  const rows = await collect(range);
  const now = Date.now();

  const firstShipAll: number[] = [];
  const fullCloseAll: number[] = [];
  const byCustomer = new Map<string, { label: string; fs: number[]; fc: number[] }>();
  const byItem = new Map<string, { label: string; fs: number[]; fc: number[] }>();
  const orders: LeadTimeOrderRow[] = [];
  let neverShipped = 0;

  for (const r of rows) {
    const fs = r.firstShipAt ? round1(days(r.orderDate, r.firstShipAt)) : null;
    const fc = r.completedAt ? round1(days(r.orderDate, r.completedAt)) : null;
    if (fs === null) neverShipped++;
    if (fs !== null) firstShipAll.push(fs);
    if (fc !== null) fullCloseAll.push(fc);

    const push = (
      map: Map<string, { label: string; fs: number[]; fc: number[] }>,
      key: string,
      label: string,
    ) => {
      let e = map.get(key);
      if (!e) {
        e = { label, fs: [], fc: [] };
        map.set(key, e);
      }
      if (fs !== null) e.fs.push(fs);
      if (fc !== null) e.fc.push(fc);
    };
    push(byCustomer, r.customerId, r.customerName);
    // Çok kumaşlı sipariş her kumaşa SAYILIR — "bu kumaş ne kadar sürüyor"
    // sorusu sipariş bazlı değil kumaş bazlıdır. Toplamların sipariş sayısını
    // aşması bu yüzden beklenen bir sonuçtur, hata değil.
    (r.itemIds ?? []).forEach((id, i) => push(byItem, id, r.itemNames?.[i] ?? "—"));

    orders.push({
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      orderDate: r.orderDate.toISOString(),
      firstShipDate: r.firstShipAt ? r.firstShipAt.toISOString() : null,
      firstShipDays: fs,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      fullCloseDays: fc,
      openDays: fs === null ? round1(days(r.orderDate, new Date(now))) : null,
    });
  }

  const buckets = (map: Map<string, { label: string; fs: number[]; fc: number[] }>): LeadTimeBucketRow[] =>
    [...map.entries()]
      .map(([key, v]) => ({ key, label: v.label, firstShip: stats(v.fs), fullClose: stats(v.fc) }))
      // Deterministik: örneklem büyük olan üste (güvenilir satır önce), sonra ad.
      .sort(
        (a, b) =>
          b.firstShip.sampleSize - a.firstShip.sampleSize ||
          a.label.localeCompare(b.label, "tr"),
      );

  // Aksiyon sırası: en uzun bekleyen açık sipariş üste, sonra en yavaş kapanan.
  orders.sort(
    (a, b) =>
      (b.openDays ?? -1) - (a.openDays ?? -1) ||
      (b.firstShipDays ?? -1) - (a.firstShipDays ?? -1) ||
      a.orderNumber.localeCompare(b.orderNumber, "tr"),
  );

  return {
    firstShip: stats(firstShipAll),
    fullClose: stats(fullCloseAll),
    byCustomer: buckets(byCustomer),
    byItem: buckets(byItem),
    orders,
    neverShippedCount: neverShipped,
    minSample: MIN_SAMPLE,
  };
}
