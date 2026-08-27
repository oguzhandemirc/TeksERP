// =============================================================================
// SİPARİŞ KARNESİ — "ne kadar iş geliyor" (GİRİŞ tarafı)
// =============================================================================
// Mevcut karnelerin HEPSİ sevk tarafına bakıyordu (Sevk & Termin, İade, Stok):
// hepsi "ne çıktı" sorusunu ölçüyor, "ne GİRDİ" sorusunu hiçbiri ölçmüyordu.
// Kapasite planlamasının, işe alımın ve nakit projeksiyonunun dayandığı sayı
// budur ve bugüne dek yalnız hafızada yaşıyordu.
//
// ── ÇIPA: `Order.orderDate`, `createdAt` DEĞİL ─────────────────────────────
// Sipariş sisteme geç girilmiş olabilir (kâğıttan aktarım, hafta sonu gelen
// sipariş pazartesi kaydı). "Bu ay kaç sipariş ALDIK" sorusu işin alındığı
// tarihe aittir, kaydın yazıldığı ana değil. `orderDate` panelde düzenlenebilir
// ve varsayılanı `now()`'dır — yani veri girişi doğruysa ikisi çakışır, yanlışsa
// doğru olan `orderDate`'tir.
//
// ── İKİ FARKLI PAYDA, BİLİNÇLİ ─────────────────────────────────────────────
// ADET: dönemde AÇILAN tüm siparişler — sonradan iptal edilenler DAHİL. Sipariş
//   alınmıştır; iptal ayrı bir olaydır ve `cancelledCount` ile AYRICA görünür.
//   İptalleri baştan düşmek "iptal oranı" sorusunu cevaplanamaz hale getirirdi.
// METRAJ: iptaller HARİÇ — iptal edilmiş siparişin üretilecek metrajı yoktur.
//   (Sipariş özet şeridindeki asimetrinin aynısı; iki yüzey aynı kuralı söyler.)
// Bu yüzden ORTALAMA sipariş büyüklüğü `totalQty / activeOrderCount`'tur —
// iki farklı paydayı bölmek sessizce yanlış bir sayı üretirdi.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { attachPrev, buildBreakdown, pctOf, round1, type BreakdownDim, type BreakdownRow } from "./_breakdown";
import { factoryDaySql } from "../../constants/time";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";

export interface OrderIntakeSummary {
  /** Dönemde açılan sipariş adedi — sonradan iptal edilenler DAHİL. */
  orderCount: number;
  /** Bunlardan şu an iptal olanlar. */
  cancelledCount: number;
  cancelledPct: number;
  /** İptal olmayanlar — metraj ve ortalama bunun üzerinden. */
  activeOrderCount: number;
  /** Kalem adedi (iptaller hariç). */
  lineCount: number;
  /** İstenen toplam metraj (iptaller hariç). */
  totalQty: number;
  /** Ortalama sipariş büyüklüğü (m) — payda `activeOrderCount`. */
  avgOrderQty: number;
  /** Sipariş başına ortalama kalem. */
  avgLinesPerOrder: number;
  /** Sipariş veren farklı müşteri sayısı. */
  customerCount: number;
  /** Termin verilmiş sipariş adedi (iptaller hariç) — planlanabilirlik göstergesi. */
  withDeadlineCount: number;
  prevOrderCount?: number;
  prevTotalQty?: number;
  prevAvgOrderQty?: number;
}

export interface OrderIntakeReport {
  summary: OrderIntakeSummary;
  byCustomer: BreakdownRow[];
  byItem: BreakdownRow[];
  /** Günlük seri — fabrika takvim günü. */
  daily: Array<{ day: string; orderCount: number; qty: number }>;
}

/** Sipariş düzeyi hücre — müşteri kırılımında "adet" = SİPARİŞ adedi olsun diye. */
interface OrderCell {
  orderId: string;
  customerId: string;
  customerName: string;
  qty: number;
}
/** Kalem düzeyi hücre — kumaş kırılımı (bir sipariş N kumaş içerebilir). */
interface LineCell {
  itemId: string;
  itemName: string;
  qty: number;
}

const dims = {
  customer: {
    keyOf: (c: OrderCell) => c.customerId,
    labelOf: (c: OrderCell) => c.customerName,
    countOf: () => 1,
    qtyOf: (c: OrderCell) => c.qty,
  } satisfies BreakdownDim<OrderCell>,
  item: {
    keyOf: (c: LineCell) => c.itemId,
    labelOf: (c: LineCell) => c.itemName,
    countOf: () => 1,
    qtyOf: (c: LineCell) => c.qty,
  } satisfies BreakdownDim<LineCell>,
};

interface Collected {
  orderCells: OrderCell[];
  lineCells: LineCell[];
  orderCount: number;
  cancelledCount: number;
  lineCount: number;
  totalQty: number;
  customerIds: Set<string>;
  withDeadlineCount: number;
}

/**
 * Dönemdeki siparişleri TEK sorguda toplar ve iki hücre kümesini AYNI veriden
 * türetir. İki ayrı sorgu (biri müşteri, biri kumaş için) çalıştırmak, iki
 * kırılımın toplamlarını birbirinden ayırırdı — `_breakdown` başlığındaki kural.
 */
async function collect(range: DateRange): Promise<Collected> {
  const orders = await prisma.order.findMany({
    where: { orderDate: { gte: range.from, lte: range.to } },
    select: {
      id: true,
      status: true,
      deadline: true,
      customerId: true,
      customer: { select: { name: true } },
      // İptal edilmiş KALEM alınan işe sayılmaz (sipariş iptaliyle aynı kural,
      // bir kademe aşağıda) — tek kaynak `ACTIVE_LINE`.
      lines: {
        where: ACTIVE_LINE,
        select: { quantity: true, itemId: true, item: { select: { name: true } } },
      },
    },
  });

  const out: Collected = {
    orderCells: [],
    lineCells: [],
    orderCount: orders.length,
    cancelledCount: 0,
    lineCount: 0,
    totalQty: 0,
    customerIds: new Set(),
    withDeadlineCount: 0,
  };

  for (const o of orders) {
    if (o.status === "CANCELLED") {
      out.cancelledCount++;
      continue; // metraj/kırılım kapsamı dışında (başlıktaki asimetri)
    }
    out.customerIds.add(o.customerId);
    if (o.deadline) out.withDeadlineCount++;

    let orderQty = new Prisma.Decimal(0);
    for (const l of o.lines) {
      orderQty = orderQty.plus(l.quantity);
      out.lineCount++;
      out.lineCells.push({
        itemId: l.itemId,
        itemName: l.item.name,
        qty: Number(l.quantity),
      });
    }
    const qty = Number(orderQty);
    out.totalQty += qty;
    out.orderCells.push({
      orderId: o.id,
      customerId: o.customerId,
      customerName: o.customer.name,
      qty,
    });
  }
  out.totalQty = round1(out.totalQty);
  return out;
}

/** Günlük seri — gün sınırı FABRİKA takvimine göre kesilir (`factoryDaySql`). */
async function collectDaily(range: DateRange): Promise<Array<{ day: string; orderCount: number; qty: number }>> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; orderCount: bigint; qty: number | null }>>(Prisma.sql`
    SELECT ${factoryDaySql('o."orderDate"')} AS day,
           COUNT(DISTINCT o.id)             AS "orderCount",
           COALESCE(SUM(ol.quantity), 0)::float8 AS qty
    FROM orders o
    -- aktif-kalem: iptal edilmiş kalem alınan işe sayılmaz (ACTIVE_LINE'ın ham
    -- SQL karşılığı; tek kaynak helpers/order-line-scope.helper.ts).
    LEFT JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL
    WHERE o."orderDate" >= ${range.from} AND o."orderDate" <= ${range.to}
      AND o.status <> 'CANCELLED'
    GROUP BY 1
    ORDER BY 1
  `);
  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    orderCount: Number(r.orderCount),
    qty: round1(r.qty ?? 0),
  }));
}

export async function getOrderIntake(
  range: DateRange,
  compareRange: DateRange | null = null,
): Promise<OrderIntakeReport> {
  const [cur, daily, prev] = await Promise.all([
    collect(range),
    collectDaily(range),
    compareRange ? collect(compareRange) : Promise.resolve(null),
  ]);

  const byCustomer = buildBreakdown(cur.orderCells, dims.customer);
  const byItem = buildBreakdown(cur.lineCells, dims.item);
  if (prev) {
    attachPrev(byCustomer, prev.orderCells, dims.customer);
    attachPrev(byItem, prev.lineCells, dims.item);
  }

  const activeOrderCount = cur.orderCount - cur.cancelledCount;
  const avg = (total: number, n: number) => (n > 0 ? round1(total / n) : 0);

  return {
    summary: {
      orderCount: cur.orderCount,
      cancelledCount: cur.cancelledCount,
      cancelledPct: pctOf(cur.cancelledCount, cur.orderCount),
      activeOrderCount,
      lineCount: cur.lineCount,
      totalQty: cur.totalQty,
      avgOrderQty: avg(cur.totalQty, activeOrderCount),
      avgLinesPerOrder: avg(cur.lineCount, activeOrderCount),
      customerCount: cur.customerIds.size,
      withDeadlineCount: cur.withDeadlineCount,
      ...(prev
        ? {
            prevOrderCount: prev.orderCount,
            prevTotalQty: prev.totalQty,
            prevAvgOrderQty: avg(prev.totalQty, prev.orderCount - prev.cancelledCount),
          }
        : {}),
    },
    byCustomer,
    byItem,
    daily,
  };
}
