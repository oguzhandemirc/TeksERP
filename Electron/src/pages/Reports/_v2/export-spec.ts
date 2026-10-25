// `RaporSunumu` → dışa aktarım spec'i. Ekranın kartı, anlatısı ve tanımları AYNI metinle girer
// (K4: ekran = PDF = Excel); anlatı PDF/Excel'de ilk `ANLATI_PDF_SAYISI` cümle.
import type { ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { grafikVeriTablosu } from "./grafik/veriTablosu";
import { ANLATI_PDF_SAYISI, SIDE_FIGURE_LIMIT, type ParametreBeyani, type RaporSunumu } from "./sunum";
import { comparisonText, formatFigure } from "./figures";
import { tableToExport } from "./table-model";
import { ALL_LABEL } from "./ParamPickerDialog";
import { emptyLabelOf, periodsToExport, variantToExport } from "./variant-model";

/** "Müşteri: Kaya Tekstil · Renk: Tümü" — sunucunun yankıladığı seçimden. */
export function parameterSentence(params: readonly ParametreBeyani[]): string | undefined {
  const parts = params
    .filter((p) => p.tur !== "tarih")
    .map((p) => {
      const values = p.deger === null ? [] : Array.isArray(p.deger) ? p.deger : [String(p.deger)];
      const labels = values.map((v) => p.secenekler?.find((o) => o.deger === v)?.etiket ?? v);
      return `${p.etiket}: ${labels.length ? labels.join(", ") : (emptyLabelOf(p.ad) ?? ALL_LABEL)}`;
    });
  return parts.length ? parts.join(" · ") : undefined;
}

export function buildExportSpec(p: RaporSunumu): ReportExportSpec {
  const cards = [
    { ad: p.anaSayi.ad, deger: formatFigure(p.anaSayi.deger, p.anaSayi.birim), kiyas: comparisonText(p.anaSayi, p.kiyasDonemi?.etiket) ?? undefined, ana: true },
    ...p.yanSayilar.slice(0, SIDE_FIGURE_LIMIT).map((f) => ({ ad: f.ad, deger: formatFigure(f.deger, f.birim) })),
  ];
  const bloklar: NonNullable<ReportExportSpec["bloklar"]> = [
    { tur: "anaSayi", kartlar: cards },
    { tur: "anlati", cumleler: p.anlati.slice(0, ANLATI_PDF_SAYISI).map((c) => c.metin) },
  ];
  if (p.grafik) bloklar.push({ tur: "grafik", baslik: p.baslik, grafik: p.grafik, veri: grafikVeriTablosu(p.grafik, "Grafik verisi") });
  if (p.tanimlar.length) bloklar.push({ tur: "tanimlar", satirlar: p.tanimlar.map((t) => ({ ad: t.ad, aciklama: t.aciklama })) });
  return {
    title: p.baslik,
    subtitle: p.donem.etiket,
    soru: p.soru,
    kiyasDonemi: p.kiyasDonemi?.etiket,
    parametreCumlesi: parameterSentence(p.parametreler),
    uyarilar: p.uyarilar.length ? p.uyarilar : undefined,
    tables: [
      ...[p.varyant ? variantToExport(p.varyant, p.kiyasDonemi?.etiket) : null, p.donemler ? periodsToExport(p.donemler) : null].filter((t) => t !== null),
      ...(p.tablo ? [tableToExport(p.tablo, "Tablo")] : []),
    ],
    bloklar,
  };
}
