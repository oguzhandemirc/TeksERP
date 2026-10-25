// =============================================================================
// Temel rapor 12 — "Tezgahlar neden duruyor?" (`dokuma/duruslar`)
// =============================================================================
// Ana sayı toplam duruş süresi = Duruş Pareto `toplam.stopSec` (dakikaya çevrilir). Yan sayılar:
// en sık sebep (Pareto `sebepler[]` içinde en çok tekrarlanan), duruş sayısı (`toplam.stopCount`),
// ortalama müdahale (Müdahale raporu `ozet.ustlenmeOrtSn`). Vardiya süzgeci iki kaynağa da AYNI
// vardiya tanımı kümesiyle gider (ShiftInstance penceresi; genel vardiya takvimi R1-SEMCEK'in işi).

import prisma from "../../../lib/prisma";
import { AppError } from "../../../utils/app-error";
import { readIdCondition } from "../../../utils/query-parser";
import { anlatiUret } from "../anlati/anlati";
import { alarmResponseReport } from "../alarm-response.report.service";
import { durusParetoReport, type ParetoReport } from "../dokuma.report.service";
import type { AnaSayi, GrafikBlok, ParametreBeyani, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, type CoreReportResult } from "./_common";
import { dayRangeParameters, type ResolvedDayRange } from "./_day-range";

export interface LoomStopsInput {
  window: ResolvedDayRange;
  /** Vardiya tanımı kimlikleri (`readFilterList`ten; boş = tümü). */
  shiftDefinitionId?: string[];
}

/** Saniye → dakika (1 ondalık); kaynağın saniyesi değişmeden gösterim birimine çevrilir. */
export const secondsToMinutes = (sec: number | null | undefined): number | null => (sec == null ? null : Math.round(sec / 6) / 10);

/** Dönemin en sık tekrarlanan sebebi (eşitlikte süresi uzun olan — Pareto sırası). */
export function mostFrequentReason(p: ParetoReport): ParetoReport["sebepler"][number] | null {
  return p.sebepler.reduce<ParetoReport["sebepler"][number] | null>((best, r) => (best === null || r.stopCount > best.stopCount ? r : best), null);
}

const reasonName = (r: { reasonLabel: string | null; reasonCode: string }): string => r.reasonLabel ?? r.reasonCode;

/** Bilinmeyen vardiya kimliği 404 (fail-closed) — sessizce boş rapor dönmez. */
async function shiftOptions(selected: string[] | undefined): Promise<{ ids: string[] | undefined; param: ParametreBeyani }> {
  const all = await prisma.shiftDefinition.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const ids = selected && selected.length > 0 ? [...new Set(selected)] : undefined;
  if (ids) {
    const found = await prisma.shiftDefinition.count({ where: { id: readIdCondition(ids) ?? undefined } });
    if (found !== ids.length) throw AppError.notFound("Vardiya tanımı bulunamadı", { shiftDefinitionId: ids });
  }
  return {
    ids,
    param: { ad: "shiftDefinitionId", etiket: "Vardiya", tur: "cokluSecim", deger: ids ?? null, secenekler: all.map((s) => ({ deger: s.id, etiket: s.name })) },
  };
}

/** Sebep satırları + iki ayrı blok (kısa duruşlar süre sınıfıdır, sebep değil; sebepsizler ayrı). */
function reasonTable(pareto: ParetoReport) {
  const tableRows = [
    ...pareto.sebepler.map((r) => ({ sebep: reasonName(r), adet: r.stopCount, dakika: secondsToMinutes(r.stopSec) })),
    ...(pareto.mikroDuruslar.stopCount > 0
      ? [{ sebep: "Kısa duruşlar (birkaç dakikalık)", adet: pareto.mikroDuruslar.stopCount, dakika: secondsToMinutes(pareto.mikroDuruslar.stopSec) }]
      : []),
    ...(pareto.siniflandirilmamis.stopCount > 0
      ? [{ sebep: "Sebebi girilmemiş", adet: pareto.siniflandirilmamis.stopCount, dakika: secondsToMinutes(pareto.siniflandirilmamis.stopSec) }]
      : []),
  ];
  const table: TabloBlok = {
    kolonlar: [
      { anahtar: "sebep", baslik: "Sebep", hiza: "sol" },
      { anahtar: "adet", baslik: "Duruş sayısı", birim: "adet", hiza: "sag" },
      { anahtar: "dakika", baslik: "Süre", birim: "dakika", hiza: "sag" },
    ],
    satirlar: tableRows,
    toplam: { sebep: "Toplam", adet: pareto.toplam.stopCount, dakika: secondsToMinutes(pareto.toplam.stopSec) },
  };
  return { tableRows, table };
}

export async function buildLoomStopsReport(input: LoomStopsInput): Promise<CoreReportResult> {
  const { days, range, compareDays, compareRange, mode } = input.window;
  const shift = await shiftOptions(input.shiftDefinitionId);
  const sel = shift.ids ? { shiftDefinitionIds: shift.ids } : {};
  const [pareto, alarm, prevPareto, prevAlarm] = await Promise.all([
    durusParetoReport({ from: days.from, to: days.to, ...sel }),
    alarmResponseReport({ from: days.from, to: days.to, withPeople: false, ...sel }), // kişi adı sunuma girmez
    compareDays ? durusParetoReport({ from: compareDays.from, to: compareDays.to, ...sel }) : Promise.resolve(null),
    compareDays ? alarmResponseReport({ from: compareDays.from, to: compareDays.to, withPeople: false, ...sel }) : Promise.resolve(null),
  ]);

  const mainFigure = metricFigure("dokuma.durusSure", secondsToMinutes(pareto.toplam.stopSec), {
    ...(prevPareto ? { previous: secondsToMinutes(prevPareto.toplam.stopSec) } : {}),
  });
  const top = mostFrequentReason(pareto);
  const sideFigures: AnaSayi[] = [
    plainFigure("dokuma.enSikSebep", top ? `En sık sebep: ${reasonName(top)}` : "En sık sebep", top ? top.stopCount : null, {
      unit: "adet",
      unmeasured: "Sebebi girilmiş duruş yok",
    }),
    plainFigure("dokuma.durusSayisi", "Duruş sayısı", pareto.toplam.stopCount, {
      unit: "adet",
      direction: "asagi",
      ...(prevPareto ? { previous: prevPareto.toplam.stopCount } : {}),
    }),
    metricFigure("dokuma.mudahaleDakika", secondsToMinutes(alarm.data.ozet.ustlenmeOrtSn), {
      unmeasured: "Bu dönemde üstlenilen tezgah alarmı yok",
      ...(prevAlarm ? { previous: secondsToMinutes(prevAlarm.data.ozet.ustlenmeOrtSn) } : {}),
    }),
  ];

  const { tableRows, table } = reasonTable(pareto);
  const capped = capTable(table, "Duruş sebepleri");

  const chartRows = tableRows.slice(0, 10);
  const chart: GrafikBlok | null = chartRows.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Sebep", tur: "kategori" }, y: { ad: "Süre", birim: "dakika" } },
        kategoriler: chartRows.map((r) => r.sebep),
        seriler: [{ ad: periodOf(range).etiket, veri: chartRows.map((r) => r.dakika) }],
      }
    : null;

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "durdu", ozne: "Tezgahlar" },
    kirilim: { boyut: "sebep", birim: "dakika", adTuru: "ozel", ozneIlgi: "Duruşların", satirlar: tableRows.map((r) => ({ ad: r.sebep, deger: r.dakika })) },
    kapsam: pareto.siniflandirilmamis.stopCount > 0
      ? [{ sayi: pareto.siniflandirilmamis.stopCount, nesne: "duruş", neden: "Sebebi girilmemiş", sonuc: "sebep sıralamasında ayrı satırda gösterildi" }]
      : [],
  });

  const warnings = [...capped.uyarilar, ...alarm.warnings];
  return {
    sunum: {
      ...catalogHeader("dokuma/duruslar"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["dokuma.durusSure", "dokuma.mudahaleDakika"]),
      parametreler: [...dayRangeParameters(days, mode), shift.param],
      uyarilar: warnings,
    },
  };
}
