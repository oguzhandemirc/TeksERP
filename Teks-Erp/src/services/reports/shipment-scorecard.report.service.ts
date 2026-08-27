// =============================================================================
// SEVK & TERMİN KARNESİ (OTIF) — "ne kadar sevk ettik, sözümüzü tuttuk mu"
// =============================================================================
// İki soru tek ekranda, çünkü ikisi de aynı vaadin iki yüzü: MİKTAR (ne kadar
// çıktı) ve ZAMAN (söz verilen tarihte çıktı mı).
//
// ── SEVK HACMİ: tanım `_shipped.ts`'te, BURADA DEĞİL ───────────────────────
// İade Karnesi'nin paydası da aynı fonksiyondan gelir. İki serviste ayrı ayrı
// yazılsalardı biri doğrudan sevkleri, diğeri iade geri-eklemesini unuturdu ve
// aynı ay için iki farklı sevk rakamı dolaşıma girerdi.
//
// ── TERMİN: ÇIPA `Order.completedAt`, `updatedAt` DEĞİL ────────────────────
// `completedAt` şemada "İlk COMPLETED'a düştüğü an" olarak tanımlı — yani
// siparişin gerçekten kapandığı an. Zamanında mı: `completedAt <= deadline`.
//
// ⚠️ TERMİNİ OLMAYAN SİPARİŞ ORANA GİRMEZ, ama GİZLENMEZ de. `deadline` nullable
// (eski kayıtlar + termin verilmeden açılan siparişler). Onları "zamanında"
// saymak oranı sahte olarak yükseltir; "geç" saymak haksız yere düşürür. Doğru
// olan tek şey paydadan çıkarmak ve SAYIYI AYRICA GÖSTERMEK — kullanıcı oranın
// hangi kümeyi temsil ettiğini bilmeli.
//
// ⚠️ İKİ ÇIPA, İKİ AYRI SORU (Fire Karnesi'ndeki ayrımın aynısı): sevk hacmi
// `Shipment.dispatchedAt`'e, termin `Order.completedAt`'e bakar. Bir sipariş
// birden çok sevkiyatla kapanabilir; ikisini tek çıpaya zorlamak birini
// yanlışlardı. Ekranda ayrı bölümler halinde durur.
//
// ── GECİKEN AÇIK SİPARİŞLER: DÖNEMDEN BAĞIMSIZ SNAPSHOT ────────────────────
// "Şu an termini geçmiş ve hâlâ açık" sorusunun tarih filtresiyle işi yok —
// operasyonel bir takip listesidir. Ekranda bu açıkça yazılır.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { attachPrev, buildBreakdown, pctOf, round1, type BreakdownDim, type BreakdownRow } from "./_breakdown";
import { collectShipped, type ShippedCell } from "./_shipped";
import { factoryDaySql } from "../../constants/time";

export interface ShipmentScorecardSummary {
  shippedQty: number;
  shippedRollCount: number;
  /** Dönemde KAPANAN sipariş adedi. */
  completedOrders: number;
  /** Bunlardan termini olan ve zamanında kapananlar. */
  onTimeOrders: number;
  /** Termini olan (orana giren) sipariş adedi. */
  withDeadlineOrders: number;
  /** Termini OLMAYAN — orandan çıkarıldı, gizlenmedi. */
  noDeadlineOrders: number;
  onTimePct: number;
  /** Ortalama gecikme (gün) — yalnız GEÇ kapananlar üzerinden. */
  avgLateDays: number | null;
  prevShippedQty?: number;
  prevOnTimePct?: number;
}

export interface ShipmentScorecard {
  summary: ShipmentScorecardSummary;
  byCustomer: BreakdownRow[];
  byItem: BreakdownRow[];
  daily: Array<{ day: string; qty: number }>;
  /** Şu an termini geçmiş ve hâlâ açık siparişler — DÖNEMDEN BAĞIMSIZ. */
  overdueOpen: Array<{
    orderId: string;
    orderNumber: string;
    customerName: string;
    deadline: string;
    daysLate: number;
    plannedQty: number;
    shippedQty: number;
  }>;
}

const dims = {
  customer: {
    keyOf: (c: ShippedCell) => c.customerId,
    labelOf: (c: ShippedCell) => c.customerName,
    countOf: (c: ShippedCell) => c.rollCount,
    qtyOf: (c: ShippedCell) => c.qty,
  } satisfies BreakdownDim<ShippedCell>,
  item: {
    keyOf: (c: ShippedCell) => c.itemId ?? "__UNKNOWN_ITEM__",
    labelOf: (c: ShippedCell) => c.itemName ?? "Belirtilmemiş",
    countOf: (c: ShippedCell) => c.rollCount,
    qtyOf: (c: ShippedCell) => c.qty,
  } satisfies BreakdownDim<ShippedCell>,
};

interface OtifRow {
  total: bigint;
  onTime: bigint;
  withDeadline: bigint;
  noDeadline: bigint;
  lateDaysSum: number | null;
  lateCount: bigint;
}

/** Dönemde KAPANAN siparişlerin termin performansı. */
async function collectOtif(range: DateRange): Promise<OtifRow> {
  const rows = await prisma.$queryRaw<OtifRow[]>(Prisma.sql`
    SELECT
      COUNT(*)                                                        AS "total",
      COUNT(*) FILTER (WHERE o.deadline IS NOT NULL
                         AND o."completedAt" <= o.deadline)           AS "onTime",
      COUNT(*) FILTER (WHERE o.deadline IS NOT NULL)                  AS "withDeadline",
      COUNT(*) FILTER (WHERE o.deadline IS NULL)                      AS "noDeadline",
      -- tz-ok: iki tarih arasındaki MUTLAK gecikme; takvim günü sorusu değil.
      SUM(EXTRACT(EPOCH FROM (o."completedAt" - o.deadline)) / 86400.0)
        FILTER (WHERE o.deadline IS NOT NULL AND o."completedAt" > o.deadline) AS "lateDaysSum",
      COUNT(*) FILTER (WHERE o.deadline IS NOT NULL
                         AND o."completedAt" > o.deadline)            AS "lateCount"
    FROM orders o
    WHERE o."completedAt" >= ${range.from} AND o."completedAt" <= ${range.to}
      AND o.status <> 'CANCELLED'
  `);
  return (
    rows[0] ?? {
      total: 0n, onTime: 0n, withDeadline: 0n, noDeadline: 0n, lateDaysSum: null, lateCount: 0n,
    }
  );
}

export async function getShipmentScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
): Promise<ShipmentScorecard> {
  const [cells, otif, dailyRows, overdueRows, prevCells, prevOtif] = await Promise.all([
    collectShipped(range),
    collectOtif(range),
    prisma.$queryRaw<Array<{ day: Date; qty: number | null }>>(Prisma.sql`
      SELECT ${factoryDaySql('s."dispatchedAt"')} AS day,
             SUM(r."currentQty")::float           AS qty
      FROM shipments s JOIN rolls r ON r."shipmentId" = s.id
      WHERE s.status = 'DISPATCHED'
        AND s."dispatchedAt" >= ${range.from} AND s."dispatchedAt" <= ${range.to}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<
      Array<{
        orderId: string; orderNumber: string; customerName: string;
        deadline: Date; daysLate: number; plannedQty: number | null; shippedQty: number;
      }>
    >(Prisma.sql`
      SELECT
        o.id AS "orderId", o."orderNumber" AS "orderNumber", cu.name AS "customerName",
        o.deadline AS "deadline",
        -- tz-ok: "kaç gündür gecikmede" — iki an arası mutlak fark.
        EXTRACT(EPOCH FROM (now() - o.deadline)) / 86400.0 AS "daysLate",
        -- aktif-kalem: iptal edilmiş kalemin metrajı "planlanan"a girmez —
        -- yoksa geciken sipariş olduğundan büyük görünür.
        (SELECT SUM(ol.quantity)::float FROM order_lines ol
          WHERE ol."orderId" = o.id AND ol."cancelledAt" IS NULL) AS "plannedQty",
        o."shippedQty"::float AS "shippedQty"
      FROM orders o JOIN customers cu ON cu.id = o."customerId"
      -- tz-ok: "termini geçti mi" bir AN karşılaştırmasıdır (mutlak), takvim
      -- günü sorusu değil — fabrika saat dilimine kesilmez.
      WHERE o.deadline < now()
        AND o.status IN ('PENDING','APPROVED','PARTIAL_SHIPPED')
      ORDER BY o.deadline ASC
      LIMIT 25
    `),
    compareRange ? collectShipped(compareRange) : Promise.resolve<ShippedCell[]>([]),
    compareRange
      ? collectOtif(compareRange)
      : Promise.resolve<OtifRow>({ total: 0n, onTime: 0n, withDeadline: 0n, noDeadline: 0n, lateDaysSum: null, lateCount: 0n }),
  ]);

  const shippedQty = cells.reduce((a, c) => a + c.qty, 0);
  const byCustomer = buildBreakdown(cells, dims.customer);
  const byItem = buildBreakdown(cells, dims.item);
  if (compareRange) {
    attachPrev(byCustomer, prevCells, dims.customer);
    attachPrev(byItem, prevCells, dims.item);
  }

  const lateCount = Number(otif.lateCount);
  const summary: ShipmentScorecardSummary = {
    shippedQty: round1(shippedQty),
    shippedRollCount: cells.reduce((a, c) => a + c.rollCount, 0),
    completedOrders: Number(otif.total),
    onTimeOrders: Number(otif.onTime),
    withDeadlineOrders: Number(otif.withDeadline),
    noDeadlineOrders: Number(otif.noDeadline),
    onTimePct: pctOf(Number(otif.onTime), Number(otif.withDeadline)),
    avgLateDays:
      lateCount > 0 ? Math.round((Number(otif.lateDaysSum ?? 0) / lateCount) * 10) / 10 : null,
  };
  if (compareRange) {
    summary.prevShippedQty = round1(prevCells.reduce((a, c) => a + c.qty, 0));
    summary.prevOnTimePct = pctOf(Number(prevOtif.onTime), Number(prevOtif.withDeadline));
  }

  return {
    summary,
    byCustomer,
    byItem,
    daily: dailyRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      qty: round1(Number(r.qty ?? 0)),
    })),
    overdueOpen: overdueRows.map((r) => ({
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      deadline: r.deadline.toISOString(),
      daysLate: Math.round(Number(r.daysLate) * 10) / 10,
      plannedQty: round1(Number(r.plannedQty ?? 0)),
      shippedQty: round1(Number(r.shippedQty)),
    })),
  };
}
