// Nerede Takıldı (WIP) — servis tipleri + dışa aktarım spec'i.

import { reportsClient } from "../_services/reportsClient";
import type { ReportExportSpec } from "../_components/reportExport";
import type { ReportDateParams } from "../_services/types";
import { TERIM } from "@/lib/terim";

export interface WipStationRow {
  key: string;
  label: string;
  kind: string;
  waitingCount: number;
  waitingQty: number;
  oldestDays: number | null;
  avgWaitDays: number | null;
  passedCount: number;
  avgDurationHours: number | null;
}

export interface WipScorecard {
  summary: {
    waitingCount: number;
    waitingQty: number;
    oldestDays: number | null;
    avgWaitDays: number | null;
    neverStartedWorkOrders: number;
    neverStartedOldestDays: number | null;
    passedCount: number;
  };
  byStation: WipStationRow[];
  oldestWaiting: Array<{
    rollId: string;
    barcode: string | null;
    itemName: string;
    colorName: string | null;
    stationName: string;
    workOrderNumber: string | null;
    qty: number;
    daysWaiting: number;
  }>;
  neverStarted: Array<{
    workOrderId: string;
    workOrderNumber: string;
    status: string;
    daysOpen: number;
  }>;
}

/** İstek parametreleri — emanet sahibi süzgeci (D4-KUC3a) SUNUCUDA uygulanır (`ownerCustomerId`, D4-KUC2 h); boşsa gönderilmez. */
export function wipQueryParams(p: ReportDateParams, ownerCustomerId: string | null): Record<string, string | undefined> {
  return { ...p, ownerCustomerId: ownerCustomerId ?? undefined };
}

export const wipScorecardApi = {
  get: (p: ReportDateParams, ownerCustomerId: string | null = null) =>
    reportsClient.get<WipScorecard>("production/wip", wipQueryParams(p, ownerCustomerId)),
};

export function buildWipExport(opts: { sc: WipScorecard; periodLabel: string; ownerFiltered?: boolean }): ReportExportSpec {
  const { sc, periodLabel, ownerFiltered = false } = opts;
  return {
    title: "Nerede Takıldı (WIP)",
    subtitle: periodLabel,
    meta: [
      // İki bölümün zaman anlayışı farklı; bu cümle olmadan kullanıcı bekleyen
      // rakamını da seçtiği döneme ait sanır.
      "BEKLEYEN sütunları ANLIK durumdur — tarih aralığından ETKİLENMEZ.",
      "GEÇEN sütunları seçilen döneme aittir (o aralıkta istasyondan çıkan toplar).",
      "Bekleyen metraj, topun istasyona GİRİŞ metrajıdır. Giriş/çıkış farkı bir kayıp ölçüsü DEĞİLDİR ve bu yüzden basılmaz.",
      ...(ownerFiltered ? ["Yalnız seçilen müşterinin emanet topları (sahip süzgeci); hiç başlamamış iş emirleri süzgeçten etkilenmez."] : []),
    ],
    tables: [
      {
        name: "İstasyon Durumu",
        columns: [
          { header: "İstasyon", key: "label", width: 26 },
          { header: "Bekleyen top", key: "waitingCount", width: 13, numFmt: "#,##0", align: "right" },
          { header: "Bekleyen (m)", key: "waitingQty", width: 14, numFmt: "#,##0.0", align: "right" },
          { header: "En eski (gün)", key: "oldestDays", width: 14, numFmt: "0.0", align: "right" },
          { header: "Ort. bekleme (gün)", key: "avgWaitDays", width: 18, numFmt: "0.0", align: "right" },
          { header: "Dönemde geçen", key: "passedCount", width: 14, numFmt: "#,##0", align: "right" },
          { header: "Ort. süre (saat)", key: "avgDurationHours", width: 16, numFmt: "0.0", align: "right" },
        ],
        rows: sc.byStation.map((r) => ({ ...r })),
        totalRow: {
          label: "TOPLAM",
          waitingCount: sc.summary.waitingCount,
          waitingQty: sc.summary.waitingQty,
          oldestDays: sc.summary.oldestDays,
          avgWaitDays: sc.summary.avgWaitDays,
          passedCount: sc.summary.passedCount,
        },
      },
      {
        name: "En Uzun Bekleyenler",
        columns: [
          { header: "Barkod", key: "barcode", width: 18 },
          { header: "Kumaş", key: "itemName", width: 24 },
          { header: "Renk", key: "colorName", width: 16 },
          { header: "İstasyon", key: "stationName", width: 20 },
          { header: TERIM.terbiyeIsEmri.tekil, key: "workOrderNumber", width: 16 },
          { header: "Metraj (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Bekleme (gün)", key: "daysWaiting", width: 14, numFmt: "0.0", align: "right" },
        ],
        rows: sc.oldestWaiting.map((r) => ({ ...r, colorName: r.colorName ?? "—", workOrderNumber: r.workOrderNumber ?? "—" })),
      },
      {
        name: `Başlamamış ${TERIM.terbiyeIsEmri.cogul}`,
        columns: [
          { header: TERIM.terbiyeIsEmri.tekil, key: "workOrderNumber", width: 18 },
          { header: "Durum", key: "status", width: 14 },
          { header: "Açık (gün)", key: "daysOpen", width: 12, numFmt: "0.0", align: "right" },
        ],
        rows: sc.neverStarted.map((r) => ({ ...r })),
        notes: [
          // Liste ilk 25 ile sınırlı; toplam sayıyı yazmazsak "25 tane var"
          // sanılır — sessiz kırpma, kapsamı olduğundan küçük gösterir.
          `Toplam ${sc.summary.neverStartedWorkOrders} terbiye iş emri; liste en eski 25 tanesini gösterir.`,
          "Açılmış ama hiç malzeme girmemiş canlı terbiye iş emirleri. Planlama backlog'u da olabilir, unutulmuş iş de — rapor yorumlamaz, sayar.",
        ],
      },
    ],
  };
}
