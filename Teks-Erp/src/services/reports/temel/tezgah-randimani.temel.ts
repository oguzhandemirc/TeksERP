// =============================================================================
// Temel rapor 11 — "Tezgahlar verimli mi?" (`dokuma/tezgah-randimani`)
// =============================================================================
// Ana sayı randıman TEK oran = Randıman raporunun `toplam.effectivenessPct`i (aynı gün aralığı).
// Yan sayılar Kapasite Kullanımı'ndan: dokunan metre (`ozet.toplamGercekM`) ve kapasitenin kumaşa
// dönen kısmı (`ozet.kullanimPct`). Çalışma payı / hız payı yalnız "neden" açıklamasında, günlük dille.
// Tablo kapasite satırlarının kendisidir (tezgah × hafta) — temel katman toplama yapmaz.

import { anlatiUret } from "../anlati/anlati";
import { efficiencyReport } from "../dokuma.report.service";
import { capacityUsageReport, type CapacityRow } from "../kapasite-kullanimi.report.service";
import type { GrafikBlok, RaporTanimi, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, type CoreReportResult } from "./_common";
import { dayRangeParameters, type ResolvedDayRange } from "./_day-range";

export interface LoomEfficiencyInput {
  window: ResolvedDayRange;
}

/** Randıman kaynağı: yalnız toplam gerekir (sayfa 1 satır — toplam TAM kümeden hesaplanır). */
async function efficiencyTotals(from: string, to: string) {
  return (await efficiencyReport({ from, to, limit: 1 })).toplam;
}

const fmtPct = (v: number): string => `%${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;

/** "Neden" açıklaması — iki pay günlük dille; ölçülemeyen pay söylenmez (uydurulmaz). */
export function efficiencyReasonText(availabilityPct: number | null, performancePct: number | null): string | null {
  const parts: string[] = [];
  if (availabilityPct !== null) parts.push(`Çalışma payı ${fmtPct(availabilityPct)} (planlanan sürenin ne kadarında tezgah çalıştı).`);
  if (performancePct !== null) parts.push(`Hız payı ${fmtPct(performancePct)} (çalışırken hedef hızın ne kadarıyla dokudu).`);
  if (parts.length === 0) return null;
  return `${parts.join(" ")} Hangisi düşükse randımanı o aşağı çeker: çalışma payı düşükse tezgah durmuştur, hız payı düşükse yavaş çalışmıştır.`;
}

/** Tablo kapasite satırlarının kendisidir (tezgah × hafta) — temel katman toplama yapmaz. */
function capacityTable(rows: CapacityRow[]): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "tezgah", baslik: "Tezgah", hiza: "sol" },
      { anahtar: "hafta", baslik: "Hafta", hiza: "sol" },
      { anahtar: "dokunan", baslik: "Dokunan", birim: "m", hiza: "sag" },
      { anahtar: "dokuyabilecegi", baslik: "Dokuyabileceği", birim: "m", hiza: "sag" },
      { anahtar: "kullanim", baslik: "Kumaşa dönen", birim: "yuzde", hiza: "sag" },
      { anahtar: "not", baslik: "Not", hiza: "sol" },
    ],
    satirlar: rows.map((r) => ({
      tezgah: `${r.code} · ${r.name}`,
      hafta: r.hafta,
      dokunan: r.gercekM,
      dokuyabilecegi: r.potansiyelM,
      kullanim: r.kullanimPct,
      not: r.hesaplanamadi ? `Hesaplanamadı: ${r.hesaplanamadi}` : null,
    })),
  };
}

export async function buildLoomEfficiencyReport(input: LoomEfficiencyInput): Promise<CoreReportResult> {
  const { days, range, compareDays, compareRange, mode } = input.window;
  const [eff, cap, prevEff, prevCap] = await Promise.all([
    efficiencyTotals(days.from, days.to),
    capacityUsageReport({ from: days.from, to: days.to }),
    compareDays ? efficiencyTotals(compareDays.from, compareDays.to) : Promise.resolve(null),
    compareDays ? capacityUsageReport({ from: compareDays.from, to: compareDays.to }) : Promise.resolve(null),
  ]);
  const c = cap.data.ozet;

  const mainFigure = metricFigure("dokuma.randimanYuzde", eff.effectivenessPct, {
    unmeasured: eff.rowCount === 0 ? "Bu günlerde tezgah vardiya kaydı yok" : "Planlanan çalışma süresi ya da hedef hız bilinmiyor",
    ...(prevEff ? { previous: prevEff.effectivenessPct } : {}),
  });
  const sideFigures = [
    plainFigure("dokuma.dokunanMetre", "Dokunan kumaş", c.toplamGercekM, { unit: "m", direction: "yukari", ...(prevCap ? { previous: prevCap.data.ozet.toplamGercekM } : {}) }),
    plainFigure("dokuma.kapasiteKullanimYuzde", "Kapasitenin kumaşa dönen kısmı", c.kullanimPct, {
      unit: "yuzde",
      direction: "yukari",
      unmeasured: "Tezgahların dokuyabileceği kumaş hesaplanamadı (hız ya da atkı sıklığı eksik)",
      ...(prevCap ? { previous: prevCap.data.ozet.kullanimPct } : {}),
    }),
  ];

  const rows = cap.data.satirlar;
  const chart: GrafikBlok | null = rows.length
    ? {
        tur: "yiginCubuk",
        eksen: { x: { ad: "Hafta", tur: "kategori" }, y: { ad: "Kumaş", birim: "m" } },
        kategoriler: [...new Set(rows.map((r) => r.hafta))],
        seriler: [...new Set(rows.map((r) => r.code))].map((code) => ({
          ad: code,
          veri: [...new Set(rows.map((r) => r.hafta))].map((h) => rows.find((r) => r.code === code && r.hafta === h)?.gercekM ?? null),
        })),
      }
    : null;

  const table = capacityTable(rows);
  const capped = capTable(table, "Tezgah × hafta");

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "randımanla çalıştı", ozne: "Tezgahlar" },
    veri: { satirSayisi: eff.rowCount },
    kapsam: c.hesaplanamadi > 0
      ? [{ sayi: c.hesaplanamadi, nesne: "tezgah-hafta", neden: "Hızı ya da atkı sıklığı bilinmeyen", sonuc: "kapasite oranına katılmadı" }]
      : [],
  });

  const reason = efficiencyReasonText(eff.availabilityPct, eff.performancePct);
  const tanimlar: RaporTanimi[] = [
    ...definitionsOf(["dokuma.randimanYuzde"]),
    ...(reason ? [{ ad: "Randıman neden bu seviyede?", aciklama: reason }] : []),
  ];

  return {
    sunum: {
      ...catalogHeader("dokuma/tezgah-randimani"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar,
      parametreler: dayRangeParameters(days, mode),
      uyarilar: capped.uyarilar,
    },
  };
}
