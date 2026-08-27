// Sipariş İptal Karnesi — servis tipleri + dışa aktarım spec'i.
// Backend `order-cancellation.report.service.ts` tipinin aynası.

import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams, ReportResponse } from "../_services/types";
import type { ReportExportSpec } from "../_components/reportExport";

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

export interface OrderCancellation {
  summary: {
    cancelledCount: number;
    cancelledQty: number;
    withReasonCount: number;
    reasonFillPct: number;
    medianDaysToCancel: number | null;
    afterShipmentCount: number;
    afterShipmentQty: number;
    openedInPeriod: number;
    cancelRatePct: number | null;
    undatedCancelCount: number;
  };
  byReason: CancellationReasonRow[];
  byCustomer: CancellationCustomerRow[];
  daily: Array<{ day: string; count: number; qty: number }>;
  orders: CancellationDetailRow[];
}

export const orderCancellationApi = {
  get: (params: ReportDateParams): Promise<ReportResponse<OrderCancellation>> =>
    reportsClient.get<OrderCancellation>("sales/order-cancellation", params),
};

export function buildCancellationExport(opts: {
  oc: OrderCancellation;
  periodLabel: string;
}): ReportExportSpec {
  const { oc, periodLabel } = opts;
  return {
    title: "Sipariş İptal Karnesi",
    subtitle: periodLabel,
    meta: [
      "ÇIPA: iptalin OLDUĞU an (cancelledAt). Sipariş Karnesi'ndeki iptal oranı farklı bir soruyu cevaplar ('bu ay ALINAN siparişlerin kaçı sonradan iptal oldu') — iki rakam birbirini tutmak zorunda değildir.",
      "SEBEP KODU rapor anahtarıdır ve asla değişmez; etiketi fabrika panelden düzenleyebilir.",
      "Sebebi girilmemiş ve serbest metinle girilmiş iptaller AYRI kovalarda görünür — gizlenmezler.",
      `SEBEP DOLULUĞU %${oc.summary.reasonFillPct}: bu oran düşükken dağılım gerçeği temsil etmez.`,
      "GEÇ İPTAL PAHALIDIR: 'gün' sütunu sipariş alındıktan iptale kadar geçen süredir; sevk başladıktan sonraki iptaller ayrıca sayılır.",
      "BİLİNEN SINIR: 'iptal anında iş emri açılmış mıydı' ölçülemiyor — iptal akışı iş emri bağlarını koparır, karar anındaki bağ sonradan okunamaz.",
      oc.summary.undatedCancelCount > 0
        ? `⚠️ ${oc.summary.undatedCancelCount} eski iptalde tarih damgası YOK (alan 2026-08-26'da eklendi) — dönem raporuna girmezler. Geriye dönük damga uydurulmadı.`
        : "Tüm iptaller tarih damgalı.",
    ],
    tables: [
      {
        name: "Sebep",
        columns: [
          { header: "Sebep", key: "label", width: 28 },
          { header: "Kod", key: "code", width: 20 },
          { header: "Adet", key: "count", width: 10, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
          { header: "Pay %", key: "sharePct", width: 10, numFmt: "#,##0.#" },
        ],
        rows: oc.byReason.map((r) => ({ ...r, code: r.code === NO_REASON_KEY ? "—" : r.code })),
        totalRow: { label: "TOPLAM", count: oc.summary.cancelledCount, qty: oc.summary.cancelledQty },
      },
      {
        name: "Müşteri",
        columns: [
          { header: "Müşteri", key: "customerName", width: 28 },
          { header: "İptal", key: "count", width: 10, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
          { header: "İptal oranı %", key: "cancelRatePct", width: 14, numFmt: "#,##0.#" },
          { header: "En sık sebep", key: "topReasonLabel", width: 26 },
        ],
        rows: oc.byCustomer.map((c) => ({
          ...c,
          cancelRatePct: c.cancelRatePct ?? "",
          topReasonLabel: c.topReasonLabel ?? "—",
        })),
        notes: ["İptal oranının paydası: o müşterinin DÖNEMDE AÇTIĞI sipariş sayısı."],
      },
      {
        name: "İptaller",
        columns: [
          { header: "Sipariş", key: "orderNumber", width: 18 },
          { header: "Müşteri", key: "customerName", width: 24 },
          { header: "Sipariş tarihi", key: "orderDateText", width: 14 },
          { header: "İptal tarihi", key: "cancelledAtText", width: 14 },
          { header: "Gün", key: "daysToCancel", width: 8, numFmt: "#,##0.#" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
          { header: "Sevk edilmiş (m)", key: "shippedQty", width: 16, numFmt: "#,##0.#" },
          { header: "Sebep", key: "reasonText", width: 30 },
        ],
        rows: oc.orders.map((o) => ({
          ...o,
          orderDateText: new Date(o.orderDate).toLocaleDateString("tr-TR"),
          cancelledAtText: new Date(o.cancelledAt).toLocaleDateString("tr-TR"),
          reasonText: o.reasonLabel ?? "—",
        })),
      },
      {
        name: "Günlük",
        columns: [
          { header: "Gün", key: "day", width: 12 },
          { header: "İptal", key: "count", width: 10, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
        ],
        rows: oc.daily as unknown as Record<string, unknown>[],
      },
    ],
  };
}
