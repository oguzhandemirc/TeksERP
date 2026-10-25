// =============================================================================
// Temel rapor 9 — "Depoda ne yatıyor?" (`inventory/depo`) — KESİT
// =============================================================================
// Kaynak: Stok & Ölü Stok (`getStockScorecard`). Ana sayı ölü stok (90 günden eski VE
// siparişsiz bitmiş kumaş). Yaşı bilinmeyen metre yaş kovalarına dağıtılmaz, AYRI sayıdır.
// Geçen ay sonuyla kıyas için ay sonu stok görüntüsü yok → kıyas "ölçülemedi" (0 DEĞİL).

import { anlatiUret } from "../anlati/anlati";
import { getStockScorecard } from "../stock-scorecard.report.service";
import type { GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import { factoryDateTr } from "../../../constants/time";
import { capTable, catalogHeader, definitionsOf, metricFigure, plainFigure, type CoreReportResult } from "./_common";

export const NO_MONTH_END_SNAPSHOT = "Geçen ay sonuyla kıyas için ay sonu stok görüntüsü birikmeli; şimdilik kıyas yapılamıyor.";

export async function buildWarehouseReport(now: Date = new Date()): Promise<CoreReportResult> {
  const stock = await getStockScorecard();
  const s = stock.summary;

  // Kıyas istenmez ama ölçülemediği açıkça söylenir: önceki değer `null` → kıyas "ölçülemedi".
  const mainFigure = metricFigure("stok.oluMetre", s.deadQty, { previous: null });
  const sideFigures = [
    plainFigure("stok.bitmisMetre", "Depodaki bitmiş kumaş", s.finishedQty, { unit: "m" }),
    plainFigure("stok.eskiMetre", `${s.deadStockDays} günden eski (siparişli dahil)`, s.agedQty, { unit: "m", direction: "asagi" }),
    metricFigure("stok.yasiBilinmeyenMetre", s.unagedQty),
  ];

  const chart: GrafikBlok | null = stock.byAge.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Depoda bekleme", tur: "kategori" }, y: { ad: "Metre", birim: "m" } },
        kategoriler: stock.byAge.map((b) => b.label),
        seriler: [{ ad: "Bitmiş kumaş", veri: stock.byAge.map((b) => b.qty) }],
      }
    : null;

  const table: TabloBlok = {
    kolonlar: [
      { anahtar: "kumas", baslik: "Kumaş", hiza: "sol" },
      { anahtar: "top", baslik: "Top", birim: "top", hiza: "sag" },
      { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
      { anahtar: "enEski", baslik: "En eski", birim: "gun", hiza: "sag" },
      { anahtar: "siparissiz", baslik: "Siparişi olmayan", birim: "m", hiza: "sag" },
    ],
    satirlar: stock.byItem.map((r) => ({ kumas: r.label, top: r.count, metre: r.qty, enEski: r.oldestDays, siparissiz: r.uncoveredQty })),
  };
  const capped = capTable(table, "Kumaş kırılımı");

  const anlati = anlatiUret({
    veri: { satirSayisi: s.finishedCount },
    esikler: [
      { yer: "Depo", esik: s.deadStockDays, esikBirimi: "gün", sifat: "eski", deger: s.deadQty, birim: "m", nesne: "siparişsiz mal", toplam: s.finishedQty },
    ],
    kirilim: { boyut: "kumaş", birim: "m", adTuru: "ozel", ozneIlgi: "Stokun", satirlar: stock.byItem.map((r) => ({ ad: r.label, deger: r.qty })) },
    kapsam: [{ sayi: s.unagedCount, nesne: "top", neden: "Depoya giriş günü bilinmeyen", sonuc: "yaş gruplarına dağıtılmadı" }],
  });

  const iso = now.toISOString();
  return {
    sunum: {
      ...catalogHeader("inventory/depo"),
      donem: { from: iso, to: iso, etiket: `Bugün itibarıyla (${factoryDateTr(now)})` },
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["stok.oluMetre", "stok.yasiBilinmeyenMetre"]),
      parametreler: [],
      uyarilar: [NO_MONTH_END_SNAPSHOT, ...capped.uyarilar],
    },
  };
}
