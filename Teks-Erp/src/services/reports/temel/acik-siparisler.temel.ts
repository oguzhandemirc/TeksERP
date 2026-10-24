// =============================================================================
// Temel rapor 4 — "Açık siparişler hazır mı?" (`sales/acik-siparisler`)
// =============================================================================
// Kaynak: Açık Sipariş Karşılanma (`getOpenOrderCoverage`) — ANLIK kesit; tarih ve kıyas
// yok, müşteriye bölünmez (FIFO havuzu). Ana sayı yalnız DEPODAN karşılanan pay (EK alan
// `warehouseCoveragePct`); açık metraj yoksa "ölçülemedi". Üretim zinciri bağlanmaz: o uç
// `report:production` + dokuma kapısı ister, `report:sales` kitlesine sızardı.

import { anlatiUret } from "../anlati/anlati";
import { filterEcho } from "../_filters";
import { getOpenOrderCoverage, type OpenOrderCoverageReport } from "../open-order-coverage.report.service";
import type { GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, listParameter, plainFigure, type CoreReportResult } from "./_common";

export const OPEN_ORDER_FILTER_KEYS = ["itemId"] as const;

export interface OpenOrderReportInput {
  filters: { itemId?: string[] };
  /** Kesit anı (test belirlenimi için verilebilir). */
  now?: Date;
}

/** Kumaş yığın çubuğu (depodan / üretimde / karşılanamayan) + satır tablosu. */
function coverageBlocks(report: OpenOrderCoverageReport): { chart: GrafikBlok | null; table: TabloBlok } {
  const s = report.summary;
  const chart: GrafikBlok | null = report.byItem.length
    ? {
        tur: "yiginCubuk",
        eksen: { x: { ad: "Kumaş", tur: "kategori" }, y: { ad: "Açık sipariş", birim: "m" } },
        kategoriler: report.byItem.map((r) => r.label),
        seriler: [
          { ad: "Depodan", veri: report.byItem.map((r) => r.fromWarehouseQty) },
          { ad: "Üretimde", veri: report.byItem.map((r) => r.fromProductionQty) },
          { ad: "Karşılanamayan", veri: report.byItem.map((r) => r.uncoveredQty) },
        ],
      }
    : null;

  const table: TabloBlok = {
    kolonlar: [
      { anahtar: "siparis", baslik: "Sipariş", hiza: "sol" },
      { anahtar: "musteri", baslik: "Müşteri", hiza: "sol" },
      { anahtar: "kumas", baslik: "Kumaş", hiza: "sol" },
      { anahtar: "renk", baslik: "Renk", hiza: "sol" },
      { anahtar: "termin", baslik: "Termin", hiza: "orta" },
      { anahtar: "gecikme", baslik: "Gecikme", birim: "gun", hiza: "sag" },
      { anahtar: "acik", baslik: "Açık", birim: "m", hiza: "sag" },
      { anahtar: "depodan", baslik: "Depodan", birim: "m", hiza: "sag" },
      { anahtar: "uretimde", baslik: "Üretimde", birim: "m", hiza: "sag" },
      { anahtar: "karsilanamayan", baslik: "Karşılanamayan", birim: "m", hiza: "sag" },
    ],
    satirlar: report.lines.map((l) => ({
      siparis: l.orderNumber,
      musteri: l.customerName,
      kumas: l.itemName,
      renk: l.colorName,
      termin: l.deadline,
      gecikme: l.daysLate,
      acik: l.openQty,
      depodan: l.fromWarehouseQty,
      uretimde: l.fromProductionQty,
      karsilanamayan: l.uncoveredQty,
    })),
    toplam: {
      siparis: "Toplam",
      acik: s.openQty,
      depodan: s.fromWarehouseQty,
      uretimde: s.fromProductionQty,
      karsilanamayan: s.uncoveredQty,
    },
  };
  return { chart, table };
}

export async function buildOpenOrderReport(input: OpenOrderReportInput): Promise<CoreReportResult> {
  const { filters } = input;
  const now = input.now ?? new Date();
  const report = await getOpenOrderCoverage({ itemId: filters.itemId });
  const s = report.summary;
  const suzgec = filterEcho(filters, OPEN_ORDER_FILTER_KEYS, report.dusenSatir);

  const mainFigure = plainFigure("acikSiparis.depodanYuzde", "Depodan karşılanan", s.warehouseCoveragePct, { unit: "yuzde",
    direction: "yukari",
    unmeasured: "Açık sipariş yok",
  });
  const sideFigures = [
    plainFigure("acikSiparis.metre", "Açık sipariş", s.openQty, { unit: "m" }),
    plainFigure("acikSiparis.gecikmisKarsilanamayan", "Termini geçmiş, karşılanamayan", s.overdueUncoveredQty, { unit: "m", direction: "asagi" }),
    plainFigure("acikSiparis.yeniIsEmri", "Yeni iş emri gereken", s.uncoveredQty, { unit: "m", direction: "asagi" }),
  ];

  const { chart, table } = coverageBlocks(report);
  const capped = capTable(table, "Açık sipariş satırları");
  const warnings = [...capped.uyarilar];
  if (report.linesOmitted > 0) {
    warnings.push(`Açık sipariş satırları: ${report.lines.length + report.linesOmitted} satırın ilk ${report.lines.length} satırı gösteriliyor — özet tüm satırları kapsar.`);
    capped.tablo = { ...capped.tablo, kesildi: { gosterilen: report.lines.length, toplam: report.lines.length + report.linesOmitted } };
  }

  const anlati = anlatiUret({
    anaSayi: mainFigure,
    veri: { satirSayisi: s.openLineCount, suzgec },
    kirilim: {
      boyut: "kumaş",
      birim: "m",
      adTuru: "ozel",
      ozneIlgi: "Açık siparişin",
      satirlar: report.byItem.map((r) => ({ ad: r.label, deger: r.openQty })),
    },
    kapsam: [
      { sayi: s.overdueUncoveredLines, nesne: "sipariş satırı", neden: "Termini geçmiş ve karşılanamayan", sonuc: "en acil iş", toplam: s.openLineCount },
      { sayi: s.uncoveredLines, nesne: "sipariş satırı", neden: "Ne depoda ne üretimde karşılığı olmayan", sonuc: "yeni iş emri bekliyor", toplam: s.openLineCount },
    ],
  });

  const nowIso = now.toISOString();
  return {
    suzgec,
    sunum: {
      ...catalogHeader("sales/acik-siparisler"),
      donem: { from: nowIso, to: nowIso, etiket: "Bugün itibarıyla" },
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      // Depodan karşılanma payı tanım sözlüğünde ayrı ölçü değil (kesit ölçüsü); açıklaması kartın kendisidir.
      tanimlar: [
        {
          ad: "Depodan karşılanan",
          aciklama: "Açık siparişlerde kalan metrenin, bugün depoda hazır duran bitmiş kumaşla karşılanabilen payı; en eski termin önce karşılanır.",
        },
      ],
      parametreler: [listParameter("itemId", filters.itemId)],
      uyarilar: warnings,
    },
  };
}
