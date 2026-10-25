// =============================================================================
// Temel rapor 1 — "Ne kadar iş aldık?" (`sales/siparis-talep`)
// =============================================================================
// Kaynak: Sipariş Karnesi (`getOrderIntake`) — aynı parametreyle çağrılır, sayı burada
// HESAPLANMAZ (bekçi `test_temel_rapor_esitlik`). Süzgeç kümesi kaynak ucunkiyle aynıdır
// (müşteri · yön · kumaş); kaynakta olmayan eksen (renk) eklenmez.

import type { ShipmentDestination } from "@prisma/client";
import { anlatiUret } from "../anlati/anlati";
import type { ScopeNoteInput } from "../anlati/gozlem.types";
import { filterEcho } from "../_filters";
import { getOrderIntake, type OrderIntakeReport, type OrderIntakeSummary } from "../order-intake.report.service";
import type { CompareMode, DateRange } from "../_shared";
import type { AnaSayi, GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import {
  capTable,
  catalogHeader,
  definitionsOf,
  destinationParameter,
  listParameter,
  metricFigure,
  periodOf,
  plainFigure,
  rangeParameters,
  singleCurrencyUnit,
  type CoreReportResult,
} from "./_common";

export const ORDER_DEMAND_FILTER_KEYS = ["customerId", "destination", "itemId"] as const;

export interface OrderDemandInput {
  range: DateRange;
  compareRange: DateRange | null;
  /** Uygulanan kıyas kipi (K-KIYAS: `resolveCoreCompare`). */
  compareMode: CompareMode;
  filters: { customerId?: string[]; destination?: ShipmentDestination; itemId?: string[] };
}

/** Tutar yan sayısı: tek para birimi → o birimle; çok birim ya da fiyatsız → ölçülemedi (0 DEĞİL). */
function amountFigureOf(amounts: OrderIntakeSummary["amounts"]): AnaSayi {
  const unit = singleCurrencyUnit(amounts);
  if (amounts.length === 0) return metricFigure("siparis.tutar", null, { unit: "TRY", unmeasured: "Fiyatı girilmiş sipariş satırı yok" });
  if (unit) return metricFigure("siparis.tutar", amounts[0].amount, { unit });
  return metricFigure("siparis.tutar", null, {
    unit: "TRY",
    unmeasured: `Siparişler ${amounts.length} ayrı para biriminde; tutarlar tek sayıya toplanmaz`,
  });
}

function customerTable(report: OrderIntakeReport, withCompare: boolean): TabloBlok {
  const s = report.summary;
  return {
    kolonlar: [
      { anahtar: "musteri", baslik: "Müşteri", hiza: "sol" },
      { anahtar: "siparis", baslik: "Sipariş", birim: "siparis", hiza: "sag" },
      { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
      ...(withCompare ? [{ anahtar: "oncekiMetre", baslik: "Önceki dönem", birim: "m" as const, hiza: "sag" as const }] : []),
    ],
    satirlar: report.byCustomer.map((r) => ({
      musteri: r.label,
      siparis: r.count,
      metre: r.qty,
      ...(withCompare ? { oncekiMetre: r.prevQty ?? 0 } : {}),
    })),
    toplam: { musteri: "Toplam", siparis: s.activeOrderCount, metre: s.totalQty },
  };
}

export async function buildOrderDemandReport(input: OrderDemandInput): Promise<CoreReportResult> {
  const { range, compareRange, filters } = input;
  const report = await getOrderIntake(range, compareRange, filters);
  const s = report.summary;
  const suzgec = filterEcho(filters, ORDER_DEMAND_FILTER_KEYS, report.dusenSatir);

  const mainFigure = metricFigure("siparis.metre", s.totalQty, compareRange ? { previous: s.prevTotalQty ?? null } : {});

  const sideFigures = [
    plainFigure("siparis.aktifAdet", "Alınan sipariş adedi", s.activeOrderCount, { unit: "siparis", direction: "yukari" }),
    plainFigure("siparis.musteriSayisi", "Sipariş veren müşteri", s.customerCount, { unit: "adet", direction: "yukari" }),
    amountFigureOf(s.amounts),
  ];

  const chart: GrafikBlok | null = report.daily.length
    ? {
        tur: "cizgi",
        eksen: { x: { ad: "Gün", tur: "zaman" }, y: { ad: "Sipariş metresi", birim: "m" } },
        kategoriler: report.daily.map((d) => d.day),
        seriler: [{ ad: "Sipariş metresi", veri: report.daily.map((d) => d.qty) }],
      }
    : null;

  const table = customerTable(report, compareRange !== null);
  const capped = capTable(table, "Müşteri kırılımı");

  const scope: ScopeNoteInput[] = [
    { sayi: s.cancelledCount, nesne: "sipariş", neden: "Dönemde alınıp sonradan iptal edilen", sonuc: "metreye katılmadı", toplam: s.orderCount },
    { sayi: s.unpricedLineCount, nesne: "sipariş satırı", neden: "Fiyatı girilmemiş", sonuc: "tutara katılmadı", toplam: s.lineCount },
  ];

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "sipariş alındı" },
    veri: { satirSayisi: s.orderCount, suzgec },
    kirilim: {
      boyut: "müşteri",
      birim: "m",
      adTuru: "ozel",
      satirlar: report.byCustomer.map((r) => ({ ad: r.label, deger: r.qty, ...(compareRange ? { onceki: r.prevQty ?? 0 } : {}) })),
    },
    seri: {
      olcuAdi: "Günlük sipariş metresi",
      olcuAdiCumleIci: "günlük sipariş metresi",
      birim: "m",
      zamanBirimi: "gün",
      noktalar: report.daily.map((d) => ({ etiket: d.day, deger: d.qty })),
    },
    kapsam: scope,
  });

  return {
    suzgec,
    sunum: {
      ...catalogHeader("sales/siparis-talep"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["siparis.metre", "siparis.tutar"]),
      parametreler: [
        ...rangeParameters(range, input.compareMode),
        listParameter("customerId", filters.customerId),
        destinationParameter(filters.destination, "Yön (müşteri kartı)"),
        listParameter("itemId", filters.itemId),
      ],
      uyarilar: capped.uyarilar,
    },
  };
}
