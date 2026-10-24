// =============================================================================
// Temel rapor 6 — "Kalite nasıl gidiyor?" (`quality/kalite`)
// =============================================================================
// Kaynak: Kalite Karnesi (1. kalite payı — METRE ağırlıklı, K18 dışı, SCRAP dahil) + Fire
// Karnesi (bin metrede hata, `defectsPerThousandM`) + Plan-Sapma Karnesi (plan dışı onaylı
// metre). Biten kumaş yoksa oran "ölçülemedi" (kaynak 0 verir; burada `totalQty` ile ayrılır).
// Plan-Sapma levent/lot süzgecini TAŞIMAZ → süzgeçliyken o yan sayı ölçülemedi (uydurulmaz).

import { anlatiUret } from "../anlati/anlati";
import { formatValue } from "../anlati/sayi-bicim";
import { round1 } from "../_breakdown";
import type { DateRange } from "../_shared";
import { filterEcho } from "../_filters";
import { getPlanDeviationScorecard } from "../plan-deviation-scorecard.report.service";
import { getQualityScorecard, type QualityScorecard, type QualityScorecardSummary, type ScorecardBreakdownRow } from "../quality-scorecard.report.service";
import { getScrapScorecard } from "../scrap-scorecard.report.service";
import type { GrafikBlok, ParametreBeyani, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, rangeParameters, type CoreReportResult } from "./_common";
import type { CompareMode } from "../_shared";

export const QUALITY_FILTER_KEYS = ["warpBeamId", "lotNo"] as const;
export const QUALITY_VIEWS = ["urun", "renk", "fasoncu"] as const;
export type QualityView = (typeof QUALITY_VIEWS)[number];

const VIEW_LABEL: Readonly<Record<QualityView, { etiket: string; boyut: string; kolon: string }>> = {
  urun: { etiket: "Kumaşa göre", boyut: "kumaş", kolon: "Kumaş" },
  renk: { etiket: "Renge göre", boyut: "renk", kolon: "Renk" },
  fasoncu: { etiket: "Fasoncuya göre", boyut: "fasoncu", kolon: "Üretim yeri" },
};

export interface QualityReportInput {
  range: DateRange;
  compareRange: DateRange | null;
  compareMode: CompareMode;
  view?: QualityView;
  filters: { warpBeamId?: string; lotNo?: string };
}

/** 1. kalite payı: rol atanmamışsa ya da dönemde biten kumaş yoksa ölçülemez (0 DEĞİL). */
export function firstQualityValue(s: QualityScorecardSummary): { value: number | null; reason?: string } {
  if (!s.topGrade) return { value: null, reason: "Kalite kataloğunda birinci kalite olarak işaretlenmiş kademe yok" };
  if (!(s.totalQty > 0)) return { value: null, reason: "Bu dönemde kalitesi verilip biten kumaş yok" };
  return { value: s.topGrade.pct };
}

/** Kıyas dönemi payı — önceki dönemde biten kumaş yoksa ölçülemez. */
export function previousFirstQualityValue(s: QualityScorecardSummary): number | null {
  if (!s.topGrade || !(s.prevTotalQty && s.prevTotalQty > 0)) return null;
  return s.prevTopGradePct ?? null;
}

function viewRows(view: QualityView, q: { byItem: ScorecardBreakdownRow[]; byColor: ScorecardBreakdownRow[]; bySubcontractor: ScorecardBreakdownRow[] }): ScorecardBreakdownRow[] {
  return view === "renk" ? q.byColor : view === "fasoncu" ? q.bySubcontractor : q.byItem;
}

/** "2026-10-24" → "24.10" (fabrika günü anahtarından; saat dilimi yorumu yok). */
const dayLabel = (ymd: string): string => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

function viewParameter(view: QualityView): ParametreBeyani {
  return { ad: "varyant", etiket: "Görünüm", tur: "secim", deger: view, secenekler: QUALITY_VIEWS.map((v) => ({ deger: v, etiket: VIEW_LABEL[v].etiket })) };
}

function dailyChart(daily: QualityScorecard["daily"], topName: string): GrafikBlok | null {
  if (!daily.length) return null;
  return {
    tur: "yiginCubuk",
    eksen: { x: { ad: "Gün", tur: "zaman" }, y: { ad: "Metre", birim: "m" } },
    kategoriler: daily.map((d) => dayLabel(d.day)),
    seriler: [
      { ad: topName, veri: daily.map((d) => d.topGradeQty) },
      { ad: "Diğer kademeler", veri: daily.map((d) => round1(d.totalQty - d.topGradeQty)) },
    ],
  };
}

function breakdownTable(view: QualityView, rows: ScorecardBreakdownRow[], withCompare: boolean): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "ad", baslik: VIEW_LABEL[view].kolon, hiza: "sol" },
      { anahtar: "top", baslik: "Top", birim: "top", hiza: "sag" },
      { anahtar: "metre", baslik: "Biten", birim: "m", hiza: "sag" },
      { anahtar: "birinciMetre", baslik: "Birinci kalite", birim: "m", hiza: "sag" },
      { anahtar: "birinciPay", baslik: "Birinci kalite payı", birim: "yuzde", hiza: "sag" },
      ...(withCompare ? [{ anahtar: "oncekiPay", baslik: "Önceki dönem payı", birim: "yuzde" as const, hiza: "sag" as const }] : []),
    ],
    satirlar: rows.map((r) => ({
      ad: r.label,
      top: r.rollCount,
      metre: r.totalQty,
      birinciMetre: r.topGradeQty,
      birinciPay: r.totalQty > 0 ? r.topGradePct : null,
      ...(withCompare ? { oncekiPay: r.prevTotalQty && r.prevTotalQty > 0 ? (r.prevTopGradePct ?? null) : null } : {}),
    })),
  };
}

export async function buildQualityReport(input: QualityReportInput): Promise<CoreReportResult> {
  const { range, compareRange, filters } = input;
  const view = input.view ?? "urun";
  const beam = { warpBeamId: filters.warpBeamId, lotNo: filters.lotNo };
  const beamFiltered = !!(filters.warpBeamId || filters.lotNo);
  const [quality, scrap, deviation] = await Promise.all([
    getQualityScorecard(range, compareRange, beam),
    getScrapScorecard(range, compareRange, beam),
    beamFiltered ? Promise.resolve(null) : getPlanDeviationScorecard(range, compareRange),
  ]);
  const suzgec = filterEcho(filters, QUALITY_FILTER_KEYS);
  const s = quality.summary;

  const first = firstQualityValue(s);
  const mainFigure = metricFigure("kalite.birinciYuzde", first.value, {
    unmeasured: first.reason,
    ...(compareRange ? { previous: previousFirstQualityValue(s) } : {}),
  });
  const sideFigures = [
    metricFigure("kalite.binMetredeHata", scrap.summary.defectsPerThousandM, {
      unmeasured: "Bu dönemde biten kumaş yok",
      ...(compareRange ? { previous: scrap.summary.prevDefectsPerThousandM ?? null } : {}),
    }),
    plainFigure("kalite.planDisiMetre", "Plan dışı onaylı", deviation ? deviation.summary.deviatedQtyM : null, {
      unit: "m",
      direction: "asagi",
      unmeasured: "Levent/lot süzgeciyle ölçülmüyor (plan dışı onay leventle bağlanmaz)",
      ...(compareRange && deviation ? { previous: deviation.previous?.deviatedQtyM ?? null } : {}),
    }),
    plainFigure("kalite.bitenMetre", "Biten kumaş", s.totalQty, { unit: "m", ...(compareRange ? { previous: s.prevTotalQty ?? null } : {}) }),
  ];

  const chart = dailyChart(quality.daily, s.topGrade?.name ?? "Birinci kalite");
  const rows = viewRows(view, quality);
  const table = breakdownTable(view, rows, compareRange !== null);
  const capped = capTable(table, `${VIEW_LABEL[view].kolon} kırılımı`);

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { ozne: "Biten kumaşın", yuklem: "birinci kalite çıktı" },
    veri: { satirSayisi: s.rollCount, suzgec },
    kirilim: { boyut: VIEW_LABEL[view].boyut, birim: "m", adTuru: "ozel", ozneIlgi: "Biten kumaşın", satirlar: rows.map((r) => ({ ad: r.label, deger: r.totalQty })) },
    kapsam: [
      { sayi: quality.unanchoredRollCount, nesne: "top", neden: "Bitiş anı kaydedilmemiş", sonuc: "hiçbir döneme girmedi" },
    ],
  });

  const warnings = [...capped.uyarilar];
  if (s.ungradedQty > 0) warnings.push(`Kalitesi girilmemiş ${formatValue(s.ungradedQty, "m")} kumaş birinci kalite payının paydasında sayıldı.`);

  return {
    suzgec,
    sunum: {
      ...catalogHeader("quality/kalite"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["kalite.birinciYuzde", "kalite.binMetredeHata"]),
      parametreler: [
        ...rangeParameters(range, input.compareMode),
        viewParameter(view),
        { ad: "warpBeamId", etiket: "Levent", tur: "secim", deger: filters.warpBeamId ?? null },
        { ad: "lotNo", etiket: "Lot", tur: "metin", deger: filters.lotNo ?? null },
      ],
      uyarilar: warnings,
    },
  };
}
