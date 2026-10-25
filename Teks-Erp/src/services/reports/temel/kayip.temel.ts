// =============================================================================
// Temel rapor 7 — "Ne kaybettik?" (`quality/kayip`) — TEK FİRE TANIMI
// =============================================================================
// Fire = satılabilir olmaktan çıkan kumaş metresi; üç kaynak, her biri KENDİ helper'ından:
//   hurda → Fire Karnesi (`scrapQty`, payda üretilen metre) · fason → Fason Karnesi
//   (`fireQty`, YALNIZ kapanmış kalem, payda kapanmış giden metre) · levent → Levent Sonucu
//   (`ozet.fireM`, YALNIZ biten levent, payda beklenen metre).
// Ana sayı kaynak metrelerinin toplamıdır. Paydalar farklı şeyleri ölçtüğü için TOPLAM ORAN
// YOKTUR — oran yalnız kaynak satırında (bekçi `test_temel_rapor_esitlik` ölçer).
// Dokuma ya da devere kapalıysa levent satırı "kapalı" notuyla çıkar; 0 basılmaz.

import { anlatiUret } from "../anlati/anlati";
import { beamResultReport } from "../levent-sonucu.report.service";
import type { DateRange } from "../_shared";
import { getScrapScorecard } from "../scrap-scorecard.report.service";
import { getSubcontractScorecard } from "../subcontract-scorecard.report.service";
import type { GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import { readDevereEnabled, readDokumaEnabled } from "../../system-setting.service";
import { round1 } from "../_breakdown";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, rangeParameters, type CoreReportResult } from "./_common";
import type { CompareMode } from "../_shared";

export type LossSourceKey = "hurda" | "fason" | "levent";

/** Bir fire kaynağının dönem sonucu. `qty === null` → kaynak bu kurulumda ölçülmüyor (`note`). */
export interface LossSource {
  key: LossSourceKey;
  metric: "fire.hurdaMetre" | "fire.fasonMetre" | "fire.leventMetre";
  qty: number | null;
  /** Kaynağın KENDİ paydasına oranı; payda 0 ya da kaynak kapalıysa `null`. */
  pct: number | null;
  base: number | null;
  baseLabel: string;
  previousQty?: number | null;
  note?: string;
}

export interface LossReportInput {
  range: DateRange;
  compareRange: DateRange | null;
  compareMode: CompareMode;
}

const LEVENT_CLOSED_NOTE = "Dokuma ya da devere modülü kapalı; levent farkı ölçülmüyor";

/** Kaynakların toplamı — ölçülmeyen kaynak toplamdan DÜŞER (0 sayılmaz); hiçbiri yoksa `null`. */
export function totalLoss(sources: readonly LossSource[], pick: (s: LossSource) => number | null | undefined): number | null {
  const measured = sources.map(pick).filter((v): v is number => typeof v === "number");
  return measured.length ? round1(measured.reduce((a, v) => a + v, 0)) : null;
}

async function beamSource(range: DateRange, compareRange: DateRange | null): Promise<LossSource> {
  const base = { key: "levent" as const, metric: "fire.leventMetre" as const, baseLabel: "Biten leventlerden beklenen kumaş" };
  const [dokuma, devere] = await Promise.all([readDokumaEnabled(), readDevereEnabled()]);
  if (!dokuma || !devere) return { ...base, qty: null, pct: null, base: null, note: LEVENT_CLOSED_NOTE };
  const [now, prev] = await Promise.all([
    beamResultReport({ from: range.from.toISOString(), to: range.to.toISOString() }),
    compareRange ? beamResultReport({ from: compareRange.from.toISOString(), to: compareRange.to.toISOString() }) : Promise.resolve(null),
  ]);
  const o = now.data.ozet;
  return {
    ...base,
    qty: o.fireM,
    pct: o.firePct,
    base: o.beklenenM,
    ...(prev ? { previousQty: prev.data.ozet.fireM } : {}),
    ...(o.olculemedi > 0 ? { note: `Çekme payı bilinmeyen ${o.olculemedi} levent fireye katılmadı` } : {}),
  };
}

/** Üç kaynak, her biri kendi karnesinden (eşitlik bekçisi bu fonksiyonun satırlarını kaynakla ölçer). */
export async function collectLossSources(range: DateRange, compareRange: DateRange | null): Promise<{ sources: LossSource[]; openSubcontractItems: number }> {
  const [scrap, sub, beam] = await Promise.all([
    getScrapScorecard(range, compareRange),
    getSubcontractScorecard(range, compareRange),
    beamSource(range, compareRange),
  ]);
  const ss = scrap.summary;
  const fs = sub.summary;
  return {
    openSubcontractItems: fs.openItems,
    sources: [
      {
        key: "hurda",
        metric: "fire.hurdaMetre",
        qty: ss.scrapQty,
        pct: ss.producedQty > 0 ? ss.scrapPct : null,
        base: ss.producedQty,
        baseLabel: "Dönemde biten kumaş",
        ...(compareRange ? { previousQty: ss.prevScrapQty ?? null } : {}),
      },
      {
        key: "fason",
        metric: "fire.fasonMetre",
        qty: fs.fireQty,
        pct: fs.closedDispatchedQty > 0 ? fs.firePct : null,
        base: fs.closedDispatchedQty,
        baseLabel: "Dönüşü tamamlanan fason gönderisi",
        ...(compareRange ? { previousQty: fs.prevFireQty ?? null } : {}),
      },
      beam,
    ],
  };
}

const SOURCE_NAME: Readonly<Record<LossSourceKey, string>> = { hurda: "Hurda", fason: "Fason farkı", levent: "Levent farkı" };

export async function buildLossReport(input: LossReportInput): Promise<CoreReportResult> {
  const { range, compareRange } = input;
  const { sources, openSubcontractItems } = await collectLossSources(range, compareRange);

  const total = totalLoss(sources, (s) => s.qty);
  const mainFigure = metricFigure("fire.metre", total, {
    ...(compareRange ? { previous: totalLoss(sources, (s) => s.previousQty) } : {}),
  });
  const sideFigures = sources.map((s) =>
    metricFigure(s.metric, s.qty, { unmeasured: s.note, ...(compareRange && s.qty !== null ? { previous: s.previousQty ?? null } : {}) }),
  );

  const measured = sources.filter((s) => s.qty !== null);
  const chart: GrafikBlok | null = measured.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Kaynak", tur: "kategori" }, y: { ad: "Fire", birim: "m" } },
        kategoriler: measured.map((s) => SOURCE_NAME[s.key]),
        seriler: [
          { ad: periodOf(range).etiket, veri: measured.map((s) => s.qty) },
          ...(compareRange ? [{ ad: periodOf(compareRange).etiket, veri: measured.map((s) => s.previousQty ?? null), soluk: true }] : []),
        ],
      }
    : null;

  // Oran YALNIZ kaynak satırında, kendi paydasıyla; toplam satırı oran TAŞIMAZ.
  const table: TabloBlok = {
    kolonlar: [
      { anahtar: "kaynak", baslik: "Kaynak", hiza: "sol" },
      { anahtar: "fire", baslik: "Fire", birim: "m", hiza: "sag" },
      { anahtar: "oran", baslik: "Kendi payına oranı", birim: "yuzde", hiza: "sag" },
      { anahtar: "payda", baslik: "Neye oranlandı", hiza: "sol" },
      { anahtar: "paydaMetre", baslik: "Payda", birim: "m", hiza: "sag" },
      { anahtar: "not", baslik: "Not", hiza: "sol" },
    ],
    satirlar: sources.map((s) => ({
      kaynak: SOURCE_NAME[s.key],
      fire: s.qty,
      oran: s.pct,
      payda: s.baseLabel,
      paydaMetre: s.base,
      not: s.note ?? null,
    })),
    toplam: { kaynak: "Toplam", fire: total },
  };
  const capped = capTable(table, "Fire kaynakları");

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "kumaş fireye gitti" },
    kirilim: { boyut: "kaynak", birim: "m", adTuru: "ozel", ozneIlgi: "Firenin", satirlar: measured.map((s) => ({ ad: SOURCE_NAME[s.key], deger: s.qty })) },
    kapsam: [{ sayi: openSubcontractItems, nesne: "fason kalemi", neden: "Henüz dönmemiş", sonuc: "fireye katılmadı" }],
  });

  return {
    sunum: {
      ...catalogHeader("quality/kayip"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["fire.metre", "fire.hurdaMetre", "fire.fasonMetre", "fire.leventMetre"]),
      parametreler: rangeParameters(range, input.compareMode),
      uyarilar: [...capped.uyarilar, ...sources.filter((s) => s.qty === null && s.note).map((s) => `${SOURCE_NAME[s.key]}: ${s.note}.`)],
    },
  };
}
