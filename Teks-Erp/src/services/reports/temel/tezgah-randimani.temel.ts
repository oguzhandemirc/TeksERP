// =============================================================================
// Temel rapor 11 — "Tezgahlar verimli mi?" (`dokuma/tezgah-randimani`)
// =============================================================================
// Ana sayı randıman TEK oran = Randıman raporunun `toplam.effectivenessPct`i (aynı gün aralığı).
// Yan sayılar Kapasite Kullanımı'ndan: dokunan metre (`ozet.toplamGercekM`) ve kapasitenin kumaşa
// dönen kısmı (`ozet.kullanimPct`). Çalışma payı / hız payı yalnız "neden" açıklamasında, günlük dille.
// Tablo kapasite satırlarının kendisidir (tezgah × hafta) — temel katman toplama yapmaz.

import { anlatiUret } from "../anlati/anlati";
import { efficiencyReport, type EfficiencyRow } from "../dokuma.report.service";
import { SHIFT_STAT_PAGE_MAX } from "../../machine-shift-stat.service";
import { capacityUsageReport, type CapacityRow } from "../kapasite-kullanimi.report.service";
import type { GrafikBlok, RaporTanimi, TabloBlok } from "../sunum/sunum.types";
import { factoryDateTr, factoryDayStartOfKey } from "../../../constants/time";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, viewParameter, type CoreReportResult } from "./_common";
import { dayRangeParameters, type ResolvedDayRange } from "./_day-range";
import { secondsToMinutes } from "./duruslar.temel";

/** Tablo görünümleri — eski Randıman / Vardiya Karnesi satırları (tezgah × vardiya × gün, aynı `efficiencyReport`). */
export const LOOM_EFFICIENCY_VIEWS = ["ozet", "kapasite", "vardiyalar"] as const;
export type LoomEfficiencyView = (typeof LOOM_EFFICIENCY_VIEWS)[number];
const LOOM_EFFICIENCY_VIEW_LABEL: Readonly<Record<LoomEfficiencyView, string>> = { ozet: "Tezgah × hafta", kapasite: "Kapasite ayrıntısı", vardiyalar: "Vardiya satırları" };
const SOURCE_LABEL: Readonly<Record<EfficiencyRow["source"], string>> = {
  MACHINE: "Makine", INFERRED: "Hesaplanan", OPERATOR: "Operatör", SUPERVISOR: "Şef", SIMULATED: "Benzetim",
};
/** Fabrika günü anahtarı (UTC gece yarısı) → "gg.aa.yyyy" (tek kaynak `constants/time`). */
const dayKeyTr = (d: Date): string => factoryDateTr(factoryDayStartOfKey(d.toISOString().slice(0, 10)));

/** Vardiya satırları: her hücre `EfficiencyRow`un aynı alanı (K · P · E ayrı kolon). */
export function shiftRowsTable(rows: readonly EfficiencyRow[]): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "tezgah", baslik: "Tezgah", hiza: "sol" },
      { anahtar: "gun", baslik: "Gün", hiza: "sol" },
      { anahtar: "vardiya", baslik: "Vardiya", hiza: "sol" },
      { anahtar: "planli", baslik: "Planlı", birim: "dakika", hiza: "sag" },
      { anahtar: "calisti", baslik: "Çalıştı", birim: "dakika", hiza: "sag" },
      { anahtar: "durus", baslik: "Duruş", birim: "dakika", hiza: "sag" },
      { anahtar: "kullanilabilirlik", baslik: "Çalışma payı", birim: "yuzde", hiza: "sag" },
      { anahtar: "performans", baslik: "Hız payı", birim: "yuzde", hiza: "sag" },
      { anahtar: "randiman", baslik: "Randıman", birim: "yuzde", hiza: "sag" },
      { anahtar: "atki", baslik: "Atkı", birim: "adet", hiza: "sag" },
      { anahtar: "metre", baslik: "Kumaş", birim: "m", hiza: "sag" },
      { anahtar: "kaynak", baslik: "Kaynak", hiza: "sol" },
      { anahtar: "durum", baslik: "Durum", hiza: "sol" },
    ],
    satirlar: rows.map((r) => ({
      tezgah: r.machine.code, gun: dayKeyTr(r.factoryDayKey), vardiya: r.shift.name,
      planli: secondsToMinutes(r.potSec), calisti: secondsToMinutes(r.aptSec), durus: secondsToMinutes(r.durusSec),
      kullanilabilirlik: r.availabilityPct, performans: r.performancePct, randiman: r.effectivenessPct,
      atki: r.unitsActual, metre: r.producedM, kaynak: r.emptyLoom ? "Boş tezgah" : SOURCE_LABEL[r.source],
      durum: r.live ? "Sürüyor" : r.sealState === "SEALED" ? "Mühürlü" : "Açık",
    })),
  };
}

export interface LoomEfficiencyInput {
  window: ResolvedDayRange;
  /** Tablo görünümü; yoksa `ozet`. */
  view?: LoomEfficiencyView;
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

/** Kapasite ayrıntısı: eski Kapasite Kullanımı satırı kolon kolon (`CapacityRow`un aynı alanları). */
export function capacityDetailTable(rows: readonly CapacityRow[]): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "tezgah", baslik: "Tezgah", hiza: "sol" },
      { anahtar: "hafta", baslik: "Hafta", hiza: "sol" },
      { anahtar: "nominal", baslik: "Nominal atkı/dk", hiza: "sag" },
      { anahtar: "atkiCm", baslik: "Atkı/cm", hiza: "sag" },
      { anahtar: "teorik", baslik: "Teorik m/sa", hiza: "sag" },
      { anahtar: "takvim", baslik: "Takvim saati", birim: "saat", hiza: "sag" },
      { anahtar: "potansiyel", baslik: "Potansiyel", birim: "m", hiza: "sag" },
      { anahtar: "gercek", baslik: "Gerçek", birim: "m", hiza: "sag" },
      { anahtar: "kullanim", baslik: "Kullanım", birim: "yuzde", hiza: "sag" },
      { anahtar: "hesaplanamadi", baslik: "Hesaplanamadı", hiza: "sol" },
    ],
    satirlar: rows.map((r) => ({
      tezgah: r.code, hafta: r.hafta, nominal: r.nominalUnitsPerMin, atkiCm: r.unitsPerCm, teorik: r.teorikMSaat, takvim: r.takvimSaat,
      potansiyel: r.potansiyelM, gercek: r.gercekM, kullanim: r.kullanimPct, hesaplanamadi: r.hesaplanamadi,
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

  const view = input.view ?? "ozet";
  // Vardiya satırları yalnız istendiğinde çekilir (ana görünüm 1 satırlık toplam okur).
  const table = view === "vardiyalar"
    ? shiftRowsTable((await efficiencyReport({ from: days.from, to: days.to, limit: SHIFT_STAT_PAGE_MAX })).satirlar)
    : view === "kapasite" ? capacityDetailTable(rows) : capacityTable(rows);
  const capped = capTable(table, LOOM_EFFICIENCY_VIEW_LABEL[view]);

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
      parametreler: [...dayRangeParameters(days, mode), viewParameter(LOOM_EFFICIENCY_VIEW_LABEL, view)],
      uyarilar: capped.uyarilar,
    },
  };
}
