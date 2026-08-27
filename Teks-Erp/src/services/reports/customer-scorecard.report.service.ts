// =============================================================================
// MÜŞTERİ KARNESİ — ABC (Pareto) + RFM
// =============================================================================
// Üç soruyu tek ekranda cevaplar:
//   • EN ÇOK kim veriyor?  → metraj sıralaması + kümülatif %80 çizgisi (ABC)
//   • EN SIK kim veriyor?  → sipariş adedi + ortalama kaç günde bir
//   • Kimi KAYBEDİYORUM?   → kendi ritmine göre gecikmiş müşteri (risk listesi)
//
// ── İKİ FARKLI ZAMAN KAPSAMI, BİLİNÇLİ ─────────────────────────────────────
// ABC ve dönem metrikleri SEÇİLİ DÖNEME aittir ("bu çeyrekte kim taşıdı").
// Ama RECENCY (kaç gündür sessiz) ve RİTİM (ortalama sipariş aralığı) dönem
// içine hapsedilemez: "son 30 günde sipariş vermedi" cümlesi, 30 günlük pencere
// seçildiğinde HERKES için doğrudur ve hiçbir şey söylemez. Bu iki ölçü
// TÜM GEÇMİŞTEN hesaplanır ve ekranda öyle etiketlenir.
//
// ── "KAYBOLAN MÜŞTERİ" TANIMI — mutlak gün DEĞİL, KENDİ RİTMİNE GÖRE ───────
// "90 gündür sipariş yok" herkes için aynı şeyi ifade etmez: haftalık sipariş
// veren müşteri için felaket, yılda iki kez alan için normaldir. Bu yüzden ölçü
// ORANDIR: geçen süre / o müşterinin ortalama sipariş aralığı. Eşik 2× —
// müşteri kendi ritminin iki katı kadar sessizse listeye girer.
//
// ⚠️ RİTİM EN AZ 3 SİPARİŞ İSTER. İki siparişten çıkan "ortalama aralık" tek bir
// gözlemdir; onunla risk hesaplamak, tek veriden trend çıkarmaktır. Az geçmişli
// müşteriler listeye GİRMEZ ve sayıları AYRICA döner (`insufficientHistory`) —
// sessizce elenmeleri "riskli müşterim yok" yanılgısı üretirdi.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { pctOf, round1 } from "./_breakdown";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";

/** Kümülatif pay eşikleri — klasik ABC (Pareto) sınıflandırması. */
const A_THRESHOLD = 80;
const B_THRESHOLD = 95;
/** Kendi ritminin kaç katı sessizlik "risk" sayılır. */
const AT_RISK_RATIO = 2;
/** Ritim hesabı için gereken en az sipariş adedi (aralık sayısı = n − 1). */
const MIN_ORDERS_FOR_RHYTHM = 3;

export type AbcClass = "A" | "B" | "C";

export interface CustomerRankRow {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  /** Dönemdeki sipariş adedi. */
  orderCount: number;
  /** Dönemdeki kalem adedi. */
  lineCount: number;
  /** Dönemdeki istenen metraj (iptaller hariç). */
  totalQty: number;
  avgOrderQty: number;
  /** Dönem metrajındaki payı (%). */
  sharePct: number;
  /** Sıralamada bu satıra kadarki kümülatif pay (%). */
  cumulativePct: number;
  abcClass: AbcClass;
  /** TÜM GEÇMİŞ — dönemle sınırlı değil. */
  lifetimeOrderCount: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  /** Ortalama sipariş aralığı (gün) — en az 3 sipariş yoksa null. */
  avgIntervalDays: number | null;
  /** Dönemde en çok istediği kumaş. */
  topItemName: string | null;
  prevQty?: number;
}

export interface AtRiskCustomerRow {
  customerId: string;
  customerName: string;
  lastOrderDate: string;
  daysSinceLastOrder: number;
  avgIntervalDays: number;
  /** Geçen süre / ortalama aralık — 2 ve üzeri riskli. */
  overdueRatio: number;
  lifetimeOrderCount: number;
  lifetimeQty: number;
}

export interface CustomerScorecardSummary {
  /** Dönemde sipariş veren müşteri sayısı. */
  customerCount: number;
  orderCount: number;
  totalQty: number;
  aClassCount: number;
  bClassCount: number;
  cClassCount: number;
  /** A sınıfının dönem metrajındaki payı (%) — yoğunlaşma göstergesi. */
  aClassQtyPct: number;
  /** Geçmişte sipariş vermiş ama BU DÖNEMDE hiç vermemiş müşteri sayısı. */
  dormantCount: number;
  /** Kendi ritmine göre gecikmiş müşteri sayısı. */
  atRiskCount: number;
  /** Ritim hesaplanamayacak kadar az geçmişi olan müşteri sayısı (risk dışı). */
  insufficientHistoryCount: number;
  prevCustomerCount?: number;
  prevTotalQty?: number;
}

export interface CustomerScorecard {
  summary: CustomerScorecardSummary;
  /** Metraja göre sıralı — Pareto eğrisi bu sırayla okunur. */
  ranking: CustomerRankRow[];
  atRisk: AtRiskCustomerRow[];
}

interface PeriodAgg {
  orderCount: number;
  lineCount: number;
  qty: number;
  itemQty: Map<string, { name: string; qty: number }>;
}

/** Dönemdeki sipariş/kalem toplamları — müşteri bazlı. İptaller HARİÇ. */
async function collectPeriod(range: DateRange): Promise<Map<string, PeriodAgg>> {
  const orders = await prisma.order.findMany({
    where: {
      orderDate: { gte: range.from, lte: range.to },
      status: { not: "CANCELLED" },
    },
    select: {
      customerId: true,
      lines: {
        where: ACTIVE_LINE, // iptal edilmiş kalem müşterinin verdiği işe sayılmaz
        select: { quantity: true, itemId: true, item: { select: { name: true } } },
      },
    },
  });
  const map = new Map<string, PeriodAgg>();
  for (const o of orders) {
    let a = map.get(o.customerId);
    if (!a) {
      a = { orderCount: 0, lineCount: 0, qty: 0, itemQty: new Map() };
      map.set(o.customerId, a);
    }
    a.orderCount++;
    for (const l of o.lines) {
      a.lineCount++;
      const q = Number(l.quantity);
      a.qty += q;
      const it = a.itemQty.get(l.itemId) ?? { name: l.item.name, qty: 0 };
      it.qty += q;
      a.itemQty.set(l.itemId, it);
    }
  }
  return map;
}

interface LifetimeAgg {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  orderCount: number;
  qty: number;
  firstOrder: Date;
  lastOrder: Date;
}

/**
 * TÜM GEÇMİŞ toplamları — recency ve ritim için. Dönemle sınırlı DEĞİL
 * (başlıktaki gerekçe). İptal edilmiş siparişler ritmi bozmasın diye dışlanır:
 * iptal edilen sipariş "temas" sayılır ama "iş" sayılmaz ve ikisini karıştırmak
 * risk listesini sessizce boşaltırdı.
 */
async function collectLifetime(): Promise<LifetimeAgg[]> {
  return prisma.$queryRaw<
    Array<{
      customerId: string;
      customerName: string;
      customerCode: string | null;
      orderCount: bigint;
      qty: number | null;
      firstOrder: Date;
      lastOrder: Date;
    }>
  >(Prisma.sql`
    SELECT c.id                                   AS "customerId",
           c.name                                 AS "customerName",
           c.code                                 AS "customerCode",
           COUNT(DISTINCT o.id)                   AS "orderCount",
           COALESCE(SUM(ol.quantity), 0)::float8  AS qty,
           MIN(o."orderDate")                     AS "firstOrder",
           MAX(o."orderDate")                     AS "lastOrder"
    FROM customers c
    JOIN orders o        ON o."customerId" = c.id AND o.status <> 'CANCELLED'
    -- aktif-kalem: ömür boyu metraj da iptal edilmiş kalemi saymaz.
    LEFT JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL
    WHERE c."mergedIntoId" IS NULL
    GROUP BY c.id, c.name, c.code
  `).then((rows) =>
    rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      customerCode: r.customerCode,
      orderCount: Number(r.orderCount),
      qty: round1(r.qty ?? 0),
      firstOrder: r.firstOrder,
      lastOrder: r.lastOrder,
    })),
  );
}

export async function getCustomerScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
): Promise<CustomerScorecard> {
  const [period, lifetime, prevPeriod] = await Promise.all([
    collectPeriod(range),
    collectLifetime(),
    compareRange ? collectPeriod(compareRange) : Promise.resolve(null),
  ]);

  const byId = new Map(lifetime.map((l) => [l.customerId, l]));
  // tz-ok: "kaç gündür sessiz" iki AN arasındaki farktır, takvim günü değil.
  const now = Date.now();
  const daysBetween = (a: Date, b: number) => Math.floor((b - a.getTime()) / 86_400_000);

  /**
   * Ortalama sipariş aralığı = (ilk↔son sipariş süresi) / (sipariş sayısı − 1).
   * Aralık sayısı n−1'dir; n'e bölmek ritmi sistematik olarak KISA gösterir ve
   * herkesi riskli yapardı.
   */
  const rhythm = (l: LifetimeAgg): number | null => {
    if (l.orderCount < MIN_ORDERS_FOR_RHYTHM) return null;
    const spanDays = (l.lastOrder.getTime() - l.firstOrder.getTime()) / 86_400_000;
    if (spanDays <= 0) return null;
    return round1(spanDays / (l.orderCount - 1));
  };

  const totalQty = round1([...period.values()].reduce((s, a) => s + a.qty, 0));
  const orderCount = [...period.values()].reduce((s, a) => s + a.orderCount, 0);

  const rows: CustomerRankRow[] = [...period.entries()]
    .map(([customerId, agg]) => {
      const lt = byId.get(customerId);
      const topItem = [...agg.itemQty.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;
      return {
        customerId,
        customerName: lt?.customerName ?? "—",
        customerCode: lt?.customerCode ?? null,
        orderCount: agg.orderCount,
        lineCount: agg.lineCount,
        totalQty: round1(agg.qty),
        avgOrderQty: agg.orderCount > 0 ? round1(agg.qty / agg.orderCount) : 0,
        sharePct: pctOf(agg.qty, totalQty),
        cumulativePct: 0, // aşağıda doldurulur
        abcClass: "C" as AbcClass,
        lifetimeOrderCount: lt?.orderCount ?? agg.orderCount,
        lastOrderDate: lt ? lt.lastOrder.toISOString() : null,
        daysSinceLastOrder: lt ? daysBetween(lt.lastOrder, now) : null,
        avgIntervalDays: lt ? rhythm(lt) : null,
        topItemName: topItem?.name ?? null,
        ...(prevPeriod ? { prevQty: round1(prevPeriod.get(customerId)?.qty ?? 0) } : {}),
      };
    })
    // Deterministik: metraj DESC, eşitlikte sipariş adedi, sonra ad.
    .sort(
      (a, b) =>
        b.totalQty - a.totalQty ||
        b.orderCount - a.orderCount ||
        a.customerName.localeCompare(b.customerName, "tr"),
    );

  // Kümülatif pay + ABC sınıfı — sıralı liste üzerinde tek geçiş.
  let cum = 0;
  for (const r of rows) {
    cum += r.sharePct;
    r.cumulativePct = round1(Math.min(cum, 100));
    r.abcClass = r.cumulativePct <= A_THRESHOLD ? "A" : r.cumulativePct <= B_THRESHOLD ? "B" : "C";
  }
  // Sınır düzeltmesi: %80'i AŞAN ilk satır da A'dır — aksi halde eşiği tek
  // başına aşan büyük bir müşteri B'ye düşer ve "A sınıfı %80 taşır" cümlesi
  // yalan olur (klasik Pareto kesme kuralı).
  const firstNonA = rows.findIndex((r) => r.abcClass !== "A");
  if (firstNonA > 0 && rows[firstNonA - 1]!.cumulativePct < A_THRESHOLD) {
    rows[firstNonA]!.abcClass = "A";
  } else if (firstNonA === 0 && rows.length > 0) {
    rows[0]!.abcClass = "A";
  }

  // ── Risk listesi: TÜM müşteriler üzerinden (dönemde sipariş vermeyenler de) ──
  const atRisk: AtRiskCustomerRow[] = [];
  let insufficientHistory = 0;
  let dormant = 0;
  for (const l of lifetime) {
    if (!period.has(l.customerId)) dormant++;
    const interval = rhythm(l);
    if (interval === null) {
      insufficientHistory++;
      continue;
    }
    const days = daysBetween(l.lastOrder, now);
    const ratio = round1(days / interval);
    if (ratio >= AT_RISK_RATIO) {
      atRisk.push({
        customerId: l.customerId,
        customerName: l.customerName,
        lastOrderDate: l.lastOrder.toISOString(),
        daysSinceLastOrder: days,
        avgIntervalDays: interval,
        overdueRatio: ratio,
        lifetimeOrderCount: l.orderCount,
        lifetimeQty: l.qty,
      });
    }
  }
  // En çok gecikmiş ve en değerli olan üste; deterministik son anahtar ad.
  atRisk.sort(
    (a, b) =>
      b.overdueRatio - a.overdueRatio ||
      b.lifetimeQty - a.lifetimeQty ||
      a.customerName.localeCompare(b.customerName, "tr"),
  );

  const aRows = rows.filter((r) => r.abcClass === "A");
  return {
    summary: {
      customerCount: rows.length,
      orderCount,
      totalQty,
      aClassCount: aRows.length,
      bClassCount: rows.filter((r) => r.abcClass === "B").length,
      cClassCount: rows.filter((r) => r.abcClass === "C").length,
      aClassQtyPct: pctOf(
        aRows.reduce((s, r) => s + r.totalQty, 0),
        totalQty,
      ),
      dormantCount: dormant,
      atRiskCount: atRisk.length,
      insufficientHistoryCount: insufficientHistory,
      ...(prevPeriod
        ? {
            prevCustomerCount: prevPeriod.size,
            prevTotalQty: round1([...prevPeriod.values()].reduce((s, a) => s + a.qty, 0)),
          }
        : {}),
    },
    ranking: rows,
    atRisk,
  };
}
