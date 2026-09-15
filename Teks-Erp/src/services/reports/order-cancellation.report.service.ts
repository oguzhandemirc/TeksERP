// =============================================================================
// SİPARİŞ İPTAL KARNESİ — "müşteriler neden vazgeçiyor"
// =============================================================================
// Bu rapor bir ÖLÇÜMDEN doğdu: 2026-08-26'ya kadar iptal sebebi hiçbir yerde
// tutulmuyordu (`Order`'da kolon yok, uç parametre almıyor, audit yalnız statü
// yazıyor). Önce sebep kaydı açıldı, rapor sonra yazıldı — tersi, boş sütunlu
// bir ekran üretirdi.
//
// ── ÇIPA `cancelledAt`, `orderDate` DEĞİL ──────────────────────────────────
// "Bu ay kaç iptal aldık" sorusu iptalin OLDUĞU aya aittir. Sipariş Ocak'ta
// alınıp Mart'ta iptal edilebilir; `orderDate` çıpası o iptali Ocak'a yazar ve
// Mart'ın gerçeği kaybolur. (Sipariş Karnesi'ndeki `cancelledPct` FARKLI bir
// soruyu cevaplar: "bu ay ALINAN siparişlerin kaçı sonradan iptal oldu". İki
// rakam birbirini tutmak ZORUNDA DEĞİLDİR ve ikisi de doğrudur.)
//
// ── İKİ MALİYET SINIFI AYRI SAYILIR ────────────────────────────────────────
// İptal ne zaman gelirse o kadar pahalıdır: sipariş girildiği gün iptal edilen
// bir işle, sevkiyat başladıktan sonra iptal edilen iş aynı şey değildir.
// `daysToCancel` medyanı ve `afterShipmentCount` bu ayrımı taşır.
//
// ⚠️ BİLİNEN SINIR — "iş emri açılmış mıydı" ÖLÇÜLEMİYOR: iptal akışı WO
// bağlarını koparır (`UNLINK_ONLY` matrisi), yani karar anındaki bağ sonradan
// okunamaz. Bunu ölçmek istersek iptal anında sayıyı DONDURMAK gerekir; bugün
// vekil ölçü `daysToCancel` + `afterShipmentCount`.
//
// ── KAPSAM DIŞI: "DEĞİŞİKLİK GEÇMİŞİ" (karar, 2026-08-27) ──────────────────
// Bu raporun planlanan ikinci yarısı ("sipariş sonrası ne değişti") BİLEREK
// yazılmadı — eksik değil, ölçülüp vazgeçilmiş bir karardır:
//   ① Gerçek siparişlerdeki 29 `ORDER UPDATE` audit kaydının HEPSİNDE `changes`
//      kolonu NULL → alan bazlı değişiklik çıkarılamıyor.
//   ② Plan sapmalarının ZATEN kendi karnesi var (`plan-deviation-scorecard`) —
//      o yarı tekrar olurdu.
//   ③ Geriye kalan tek ölçülebilir şey "kaç sipariş düzenlendi" sayacıydı ve
//      iptal oranı ZATEN Sipariş Karnesi'nde.
// Boş sütunlu bir rapor yüzeyi eklemek yanıltıcı olurdu (2026-08-09'da tam bu
// sebeple iki rapor kaldırılmıştı). İleride istenirse ÖN KOŞUL: `AuditService`in
// ORDER UPDATE'te `changes` alanını doldurması. Tam not:
// docs/history/CLAUDE-NOT-ARSIVI.md → 2026-08-27 sipariş görünürlüğü.
//
// ⚠️ DAMGASIZ ESKİ İPTALLER: `cancelledAt` bu tarihte eklendi; öncesinde iptal
// edilmiş siparişlerde NULL'dur ve dönem raporuna GİRMEZ. Sayıları ayrıca
// döner (`undatedCancelCount`) — sessizce yok sayılmaları "geçmişte hiç iptal
// olmamış" yanılgısı üretirdi. Geriye dönük damga UYDURULMADI.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { pctOf, round1 } from "./_breakdown";
import { factoryDaySql } from "../../constants/time";
import { idWhere, inSql, orderScopeSql, orderScopeWhere, type ReportFilterInput } from "./_filters";

/** Sebebi girilmemiş iptallerin kovası — gizlenmez, adlandırılır. */
export const NO_REASON_KEY = "__NO_REASON__";

export interface CancellationReasonRow {
  code: string;
  label: string;
  count: number;
  qty: number;
  sharePct: number;
}

export interface CancellationCustomerRow {
  customerId: string;
  customerName: string;
  count: number;
  qty: number;
  /** O müşterinin dönemde açtığı sipariş sayısına oranı (%) — payda 0 ise null. */
  cancelRatePct: number | null;
  topReasonLabel: string | null;
}

export interface CancellationDetailRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  cancelledAt: string;
  daysToCancel: number;
  qty: number;
  shippedQty: number;
  reasonLabel: string | null;
  reasonCode: string | null;
}

export interface OrderCancellationSummary {
  cancelledCount: number;
  cancelledQty: number;
  /** Sebebi girilmiş iptal adedi — veri kalitesi göstergesi. */
  withReasonCount: number;
  reasonFillPct: number;
  /** Sipariş alındıktan kaç gün sonra iptal edildi (medyan). */
  medianDaysToCancel: number | null;
  /** Sevkiyat başladıktan SONRA iptal edilenler — en pahalı sınıf. */
  afterShipmentCount: number;
  afterShipmentQty: number;
  /** Aynı dönemde AÇILAN sipariş sayısı — oranın paydası. */
  openedInPeriod: number;
  /** cancelledCount / openedInPeriod (%) — iki farklı küme, oran YAKLAŞIKTIR. */
  cancelRatePct: number | null;
  /** `cancelledAt` damgası olmayan (2026-08-26 öncesi) iptaller — dönem dışı. */
  undatedCancelCount: number;
}

export interface OrderCancellationReport {
  summary: OrderCancellationSummary;
  byReason: CancellationReasonRow[];
  byCustomer: CancellationCustomerRow[];
  daily: Array<{ day: string; count: number; qty: number }>;
  orders: CancellationDetailRow[];
}

interface RawCancel {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  orderDate: Date;
  cancelledAt: Date;
  cancelReason: string | null;
  cancelReasonCode: string | null;
  qty: number | null;
  shippedQty: number | null;
}

export async function getOrderCancellationScorecard(
  range: DateRange,
  filters: ReportFilterInput = {},
): Promise<OrderCancellationReport> {
  // R5b-c: müşteri/hedef süzgeci PAY ve PAYDANIN hepsine (beş sorgu); `reasonCode` yalnız iptal satırlarına —
  // açılan sipariş sebep taşımaz, oran "bu sebeple iptal ÷ açılan" olur.
  const scope = orderScopeWhere(filters);
  const scopeSql = orderScopeSql(filters);
  const reasonSql = inSql('o."cancelReasonCode"', filters.reasonCode, "text");
  const reason = idWhere(filters.reasonCode);
  const [rows, openedInPeriod, undated, presets, daily] = await Promise.all([
    prisma.$queryRaw<RawCancel[]>(Prisma.sql`
      SELECT o.id AS "orderId", o."orderNumber", c.id AS "customerId", c.name AS "customerName",
             o."orderDate", o."cancelledAt", o."cancelReason", o."cancelReasonCode",
             COALESCE(l.qty, 0)::float8 AS qty,
             o."shippedQty"::float8     AS "shippedQty"
      FROM orders o
      JOIN customers c ON c.id = o."customerId"
      LEFT JOIN LATERAL (
        -- aktif-kalem: kalemi ayrıca iptal edilmişse metrajı İKİ KEZ sayılmasın
        -- (kalem iptali kendi raporunda görünür).
        SELECT SUM(ol.quantity) AS qty FROM order_lines ol
        WHERE ol."orderId" = o.id AND ol."cancelledAt" IS NULL
      ) l ON true
      WHERE o.status = 'CANCELLED'
        AND o."cancelledAt" >= ${range.from} AND o."cancelledAt" <= ${range.to} ${scopeSql} ${reasonSql}
    `),
    prisma.order.count({ where: { orderDate: { gte: range.from, lte: range.to }, ...scope } }),
    prisma.order.count({ where: { status: "CANCELLED", cancelledAt: null, ...scope, ...(reason !== undefined ? { cancelReasonCode: reason } : {}) } }),
    prisma.reasonPreset.findMany({
      where: { kind: "ORDER_CANCEL" },
      select: { code: true, label: true },
    }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint; qty: number | null }>>(Prisma.sql`
      SELECT ${factoryDaySql('o."cancelledAt"')} AS day,
             COUNT(*)                             AS count,
             COALESCE(SUM(l.qty), 0)::float8      AS qty
      FROM orders o
      LEFT JOIN LATERAL (
        -- aktif-kalem (yukarıdaki gerekçe).
        SELECT SUM(ol.quantity) AS qty FROM order_lines ol
        WHERE ol."orderId" = o.id AND ol."cancelledAt" IS NULL
      ) l ON true
      WHERE o.status = 'CANCELLED'
        AND o."cancelledAt" >= ${range.from} AND o."cancelledAt" <= ${range.to} ${scopeSql} ${reasonSql}
      GROUP BY 1 ORDER BY 1
    `),
  ]);

  // Etiket katalogdan okunur (fabrika düzenlemiş olabilir); kod bilinmiyorsa
  // kodun kendisi basılır — satır KAYBOLMAZ.
  const labelOf = new Map(presets.map((p) => [p.code, p.label]));

  const totalQty = round1(rows.reduce((s, r) => s + (r.qty ?? 0), 0));
  const daysToCancel: number[] = [];
  const reasonMap = new Map<string, { label: string; count: number; qty: number }>();
  const custMap = new Map<
    string,
    { name: string; count: number; qty: number; reasons: Map<string, number> }
  >();
  const orders: CancellationDetailRow[] = [];
  let withReason = 0;
  let afterShipmentCount = 0;
  let afterShipmentQty = 0;

  for (const r of rows) {
    // tz-ok: iki AN arası fark — takvim günü sorusu değil.
    const d = round1(Math.max(0, (r.cancelledAt.getTime() - r.orderDate.getTime()) / 86_400_000));
    daysToCancel.push(d);

    const qty = round1(r.qty ?? 0);
    const shipped = round1(r.shippedQty ?? 0);
    if (shipped > 0) {
      afterShipmentCount++;
      afterShipmentQty += qty;
    }

    // Sebep kovası: kod varsa kod, yoksa AYRI ve ADLANDIRILMIŞ kova. Metin var
    // ama kod yoksa (serbest yazı) yine kodsuz sayılır — kod uydurulmadığı için.
    const key = r.cancelReasonCode ?? NO_REASON_KEY;
    if (r.cancelReasonCode) withReason++;
    const label =
      r.cancelReasonCode !== null
        ? (labelOf.get(r.cancelReasonCode) ?? r.cancelReasonCode)
        : r.cancelReason
          ? "Serbest metin (kodsuz)"
          : "Sebep girilmemiş";
    const bucket = reasonMap.get(key) ?? { label, count: 0, qty: 0 };
    bucket.count++;
    bucket.qty += qty;
    reasonMap.set(key, bucket);

    const cust = custMap.get(r.customerId) ?? {
      name: r.customerName,
      count: 0,
      qty: 0,
      reasons: new Map<string, number>(),
    };
    cust.count++;
    cust.qty += qty;
    cust.reasons.set(label, (cust.reasons.get(label) ?? 0) + 1);
    custMap.set(r.customerId, cust);

    orders.push({
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      orderDate: r.orderDate.toISOString(),
      cancelledAt: r.cancelledAt.toISOString(),
      daysToCancel: d,
      qty,
      shippedQty: shipped,
      reasonLabel: r.cancelReason ?? (r.cancelReasonCode ? label : null),
      reasonCode: r.cancelReasonCode,
    });
  }

  // Müşteri başına dönemde açılan sipariş — oranın paydası.
  const openedByCustomer = await prisma.order.groupBy({
    where: { orderDate: { gte: range.from, lte: range.to }, ...scope },
    by: ["customerId"],
    _count: { _all: true },
  });
  const openedOf = new Map(openedByCustomer.map((o) => [o.customerId, o._count._all]));

  const sorted = [...daysToCancel].sort((a, b) => a - b);
  const median = sorted.length
    ? round1(sorted[Math.min(Math.ceil(sorted.length / 2), sorted.length) - 1]!)
    : null;

  return {
    summary: {
      cancelledCount: rows.length,
      cancelledQty: totalQty,
      withReasonCount: withReason,
      reasonFillPct: pctOf(withReason, rows.length),
      medianDaysToCancel: median,
      afterShipmentCount,
      afterShipmentQty: round1(afterShipmentQty),
      openedInPeriod,
      cancelRatePct: openedInPeriod > 0 ? pctOf(rows.length, openedInPeriod) : null,
      undatedCancelCount: undated,
    },
    byReason: [...reasonMap.entries()]
      .map(([code, v]) => ({
        code,
        label: v.label,
        count: v.count,
        qty: round1(v.qty),
        sharePct: pctOf(v.count, rows.length),
      }))
      // Deterministik: adet DESC → metraj DESC → etiket.
      .sort((a, b) => b.count - a.count || b.qty - a.qty || a.label.localeCompare(b.label, "tr")),
    byCustomer: [...custMap.entries()]
      .map(([customerId, v]) => {
        const opened = openedOf.get(customerId) ?? 0;
        const top = [...v.reasons.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
          customerId,
          customerName: v.name,
          count: v.count,
          qty: round1(v.qty),
          cancelRatePct: opened > 0 ? pctOf(v.count, opened) : null,
          topReasonLabel: top?.[0] ?? null,
        };
      })
      .sort((a, b) => b.count - a.count || b.qty - a.qty || a.customerName.localeCompare(b.customerName, "tr")),
    daily: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      count: Number(d.count),
      qty: round1(d.qty ?? 0),
    })),
    // En pahalı (en geç) iptal üste.
    orders: orders.sort(
      (a, b) => b.daysToCancel - a.daysToCancel || b.qty - a.qty || a.orderNumber.localeCompare(b.orderNumber, "tr"),
    ),
  };
}
