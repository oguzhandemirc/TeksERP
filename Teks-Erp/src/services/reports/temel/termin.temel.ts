// =============================================================================
// Temel rapor 3 — "Sözümüzü tuttuk mu?" (`sales/termin`)
// =============================================================================
// Kaynak: Sevk & Termin Karnesi (zamanında teslim, `getShipmentScorecard`) + Sipariş →
// Teslim Süresi (`getOrderLeadTime`). Terminsiz sipariş PAYDAYA GİRMEZ; sayısı kapsam
// notuyla söylenir. Termini olan tamamlanmış sipariş yoksa oran "ölçülemedi" (0 DEĞİL —
// kaynak 0 döner, burada `withDeadlineOrders` ile ayrılır).

import type { ShipmentDestination } from "@prisma/client";
import { anlatiUret } from "../anlati/anlati";
import { filterEcho } from "../_filters";
import { getOrderLeadTime, MIN_SAMPLE, type LeadTimeStats } from "../order-leadtime.report.service";
import type { CompareMode, DateRange } from "../_shared";
import { getShipmentScorecard, type ShipmentScorecard, type ShipmentScorecardSummary } from "../shipment-scorecard.report.service";
import type { GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import {
  capTable,
  catalogHeader,
  definitionsOf,
  destinationParameter,
  metricFigure,
  periodOf,
  plainFigure,
  rangeParameters,
  type CoreReportResult,
} from "./_common";

export const DEADLINE_FILTER_KEYS = ["destination"] as const;
const NO_DEADLINE_DATA = "Bu dönemde tamamlanan, termini olan sipariş yok";

export interface DeadlineReportInput {
  range: DateRange;
  compareRange: DateRange | null;
  /** Uygulanan kıyas kipi (K-KIYAS: `resolveCoreCompare`). */
  compareMode: CompareMode;
  filters: { destination?: ShipmentDestination };
}

/** Termini olan tamamlanmış sipariş yoksa oran ölçülemez — kaynak 0 verse de `null`. */
export const onTimeValue = (s: ShipmentScorecardSummary): number | null => (s.withDeadlineOrders > 0 ? s.onTimePct : null);

function durationValue(stats: LeadTimeStats, field: "medianDays" | "p90Days"): { value: number | null; reason?: string } {
  if (stats.sampleSize < MIN_SAMPLE) {
    return { value: null, reason: `Az örnek: yalnız ${stats.sampleSize} sipariş tamamen gitti (en az ${MIN_SAMPLE} gerekir)` };
  }
  return { value: stats[field] };
}

/** Tablo: BUGÜN termini geçmiş açık siparişler (dönemden bağımsız; kaynak `overdueOpen`). */
function overdueTable(overdueOpen: ShipmentScorecard["overdueOpen"]): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "siparis", baslik: "Sipariş", hiza: "sol" },
      { anahtar: "musteri", baslik: "Müşteri", hiza: "sol" },
      { anahtar: "termin", baslik: "Termin", hiza: "orta" },
      { anahtar: "gecikme", baslik: "Gecikme", birim: "gun", hiza: "sag" },
      { anahtar: "istenen", baslik: "İstenen", birim: "m", hiza: "sag" },
      { anahtar: "giden", baslik: "Giden", birim: "m", hiza: "sag" },
    ],
    satirlar: overdueOpen.map((o) => ({
      siparis: o.orderNumber,
      musteri: o.customerName,
      termin: o.deadline,
      gecikme: o.daysLate,
      istenen: o.plannedQty,
      giden: o.shippedQty,
    })),
  };
}

export async function buildDeadlineReport(input: DeadlineReportInput): Promise<CoreReportResult> {
  const { range, compareRange, filters } = input;
  const f = { destination: filters.destination };
  const [current, previous, leadTime] = await Promise.all([
    getShipmentScorecard(range, null, f),
    compareRange ? getShipmentScorecard(compareRange, null, f) : Promise.resolve(null),
    getOrderLeadTime(range, { destination: filters.destination }),
  ]);
  const suzgec = filterEcho(filters, DEADLINE_FILTER_KEYS);
  const s = current.summary;

  const mainFigure = metricFigure("termin.zamanindaYuzde", onTimeValue(s), {
    unmeasured: NO_DEADLINE_DATA,
    ...(previous ? { previous: onTimeValue(previous.summary) } : {}),
  });
  const median = durationValue(leadTime.fullClose, "medianDays");
  const p90 = durationValue(leadTime.fullClose, "p90Days");
  const sideFigures = [
    plainFigure("termin.gecikenSiparis", "Geç kalan sipariş", s.withDeadlineOrders - s.onTimeOrders, { unit: "siparis",
      direction: "asagi",
      ...(previous ? { previous: previous.summary.withDeadlineOrders - previous.summary.onTimeOrders } : {}),
    }),
    metricFigure("termin.yariSureGun", median.value, { unmeasured: median.reason }),
    metricFigure("termin.dokuzdaDokuzGun", p90.value, { unmeasured: p90.reason }),
  ];

  const customerRows = leadTime.byCustomer.filter((r) => r.fullClose.sampleSize > 0);
  const chart: GrafikBlok | null = customerRows.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Müşteri", tur: "kategori" }, y: { ad: "Teslim süresi", birim: "gun" } },
        kategoriler: customerRows.map((r) => r.label),
        seriler: [{ ad: "Teslim süresi", veri: customerRows.map((r) => r.fullClose.medianDays) }],
      }
    : null;

  const table = overdueTable(current.overdueOpen);
  const capped = capTable(table, "Termini geçmiş açık siparişler");

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "zamanında gitti", ozne: "Termini olan siparişlerin" },
    veri: { satirSayisi: s.completedOrders, suzgec },
    kapsam: [
      { sayi: s.noDeadlineOrders, nesne: "sipariş", neden: "Termini olmayan", sonuc: "orana katılmadı", toplam: s.completedOrders },
      { sayi: leadTime.neverShippedCount, nesne: "sipariş", neden: "Dönemde açılıp hiç sevk görmemiş", sonuc: "teslim süresine katılmadı" },
      { sayi: current.overdueOpen.length, nesne: "açık sipariş", neden: "Bugün termini geçmiş", sonuc: "tabloda listelendi" },
    ],
  });

  return {
    suzgec,
    sunum: {
      ...catalogHeader("sales/termin"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["termin.zamanindaYuzde", "termin.yariSureGun", "termin.dokuzdaDokuzGun"]),
      parametreler: [...rangeParameters(range, input.compareMode), destinationParameter(filters.destination)],
      uyarilar: capped.uyarilar,
    },
  };
}
