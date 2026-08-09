// Parti İzleme — servis tipleri + dışa aktarım spec'i.

import apiClient from "@/services/apiClient";
import type { ReportExportSpec } from "../_components/reportExport";

export interface BatchCandidate {
  batchId: string;
  batchNumber: string;
  workOrderNumber: string | null;
  createdAt: string;
  rollCount: number;
  qty: number;
  /** Başka partiye birleştirilmiş tarihçe partisi. */
  merged: boolean;
}

export interface BatchTrace {
  batch: {
    batchId: string; batchNumber: string;
    workOrderNumber: string | null; createdAt: string; merged: boolean;
  };
  totals: { rollCount: number; qty: number };
  byStatus: Array<{ status: string; count: number; qty: number }>;
  customers: Array<{
    customerId: string; customerName: string; shipmentCount: number;
    rollCount: number; qty: number; lastDispatchedAt: string | null;
  }>;
  returns: Array<{ returnId: string; customerName: string; qty: number; reason: string; createdAt: string }>;
  subcontractorDispatches: Array<{
    dispatchId: string; dispatchNo: string; subcontractorName: string;
    dispatchedAt: string; qty: number; cancelled: boolean;
  }>;
}

export const batchTraceApi = {
  search: async (q: string): Promise<BatchCandidate[]> => {
    const res = await apiClient.get<{ success: true; data: BatchCandidate[] }>(
      `/api/reports/production/batch-search?q=${encodeURIComponent(q)}`,
    );
    return res.data.data;
  },
  trace: async (batchId: string): Promise<BatchTrace> => {
    const res = await apiClient.get<{ success: true; data: BatchTrace }>(
      `/api/reports/production/batch-trace/${batchId}`,
    );
    return res.data.data;
  },
};

export function buildBatchTraceExport(t: BatchTrace): ReportExportSpec {
  return {
    title: `Parti İzleme — ${t.batch.batchNumber}`,
    subtitle: t.batch.workOrderNumber ? `İş Emri ${t.batch.workOrderNumber}` : "İş emri bağı yok",
    meta: [
      // Numaranın benzersiz olmadığı ÇIKTIDA da yazılı olmalı: kâğıt elden ele
      // dolaşırken "P46" tek bir partiyi işaret ediyor sanılır.
      "⚠ Parti numarası benzersiz DEĞİLDİR (P01…P99 arasında döner). Bu döküm tek bir partiye aittir; aynı numarayı taşıyan başka partiler olabilir.",
      "Müşteri listesi İADE EDİLMİŞ malı da içerir — iade, topun sevkiyat bağını kopardığı için canlı sorguda görünmezdi.",
      "Kesimde doğan çocuk toplar partiyi miras alır ve bu dökümde bir kez sayılır.",
    ],
    tables: [
      {
        name: "Müşteriler",
        columns: [
          { header: "Müşteri", key: "customerName", width: 28 },
          { header: "Sevkiyat", key: "shipmentCount", width: 11, numFmt: "#,##0", align: "right" },
          { header: "Top", key: "rollCount", width: 9, numFmt: "#,##0", align: "right" },
          { header: "Metraj (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Son sevk", key: "lastDispatchedAt", width: 14 },
        ],
        rows: t.customers.map((c) => ({ ...c, lastDispatchedAt: c.lastDispatchedAt?.slice(0, 10) ?? "—" })),
        totalRow: {
          customerName: "TOPLAM",
          rollCount: t.customers.reduce((a, c) => a + c.rollCount, 0),
          qty: Math.round(t.customers.reduce((a, c) => a + c.qty, 0) * 10) / 10,
        },
      },
      {
        name: "Durum Dağılımı",
        columns: [
          { header: "Durum", key: "status", width: 26 },
          { header: "Top", key: "count", width: 9, numFmt: "#,##0", align: "right" },
          { header: "Metraj (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
        ],
        rows: t.byStatus.map((r) => ({ ...r })),
        totalRow: { status: "TOPLAM", count: t.totals.rollCount, qty: t.totals.qty },
      },
      {
        name: "İadeler",
        columns: [
          { header: "Müşteri", key: "customerName", width: 26 },
          { header: "Metraj (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Neden", key: "reason", width: 26 },
          { header: "Tarih", key: "createdAt", width: 14 },
        ],
        rows: t.returns.map((r) => ({ ...r, createdAt: r.createdAt.slice(0, 10) })),
      },
      {
        name: "Fason Sevkleri",
        columns: [
          { header: "Sevk No", key: "dispatchNo", width: 18 },
          { header: "Fason firma", key: "subcontractorName", width: 26 },
          { header: "Metraj (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Tarih", key: "dispatchedAt", width: 14 },
          { header: "Durum", key: "cancelled", width: 12 },
        ],
        rows: t.subcontractorDispatches.map((d) => ({
          ...d, dispatchedAt: d.dispatchedAt.slice(0, 10), cancelled: d.cancelled ? "İPTAL" : "Geçerli",
        })),
      },
    ],
  };
}
