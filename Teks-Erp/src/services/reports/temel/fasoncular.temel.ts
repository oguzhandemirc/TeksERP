// =============================================================================
// Temel rapor 10 — "Fasoncular zamanında dönüyor mu?" (`subcontract/fasoncular`)
// =============================================================================
// Kaynak: Fason Karnesi (`getSubcontractScorecard`), aynı süzgeç kümesi (fasoncu/kumaş/renk).
// ⚠️ ZAMANINDA DÖNÜŞ ÖLÇÜLEMİYOR: söz verilen dönüş günü KAYDEDİLMİYOR (`SubcontractorDispatch`te alan
// yok) → K-FASON: ana sayı kapanmış kalemlerin ortalama dönüş süresi; "zamanında %" ayrı dilimde (alan).
// Fason farkı (fire) yan sayıdır; TANIMI ve öteki kaynaklarla birlikte "Ne kaybettik?"te.

import { anlatiUret } from "../anlati/anlati";
import type { DateRange } from "../_shared";
import { filterEcho, type ReportFilterInput } from "../_filters";
import { getSubcontractScorecard, type SubcontractScorecardRow } from "../subcontract-scorecard.report.service";
import type { GrafikBlok, ParametreBeyani, TabloBlok } from "../sunum/sunum.types";
import { OLCU_BY_KIMLIK } from "../semantik/tanimlar";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, rangeParameters, type CoreReportResult } from "./_common";
import type { CompareMode } from "../_shared";

export const SUBCONTRACT_FILTER_KEYS = ["subcontractorId", "itemId", "colorId"] as const;

export interface SubcontractorsReportInput {
  range: DateRange;
  compareRange: DateRange | null;
  compareMode: CompareMode;
  filters: Pick<ReportFilterInput, "subcontractorId" | "itemId" | "colorId">;
}

const listParam = (ad: string, etiket: string, v: string[] | undefined): ParametreBeyani => ({ ad, etiket, tur: "cokluSecim", deger: v && v.length ? v : null });

function subcontractorTable(rows: readonly SubcontractScorecardRow[]): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "fasoncu", baslik: "Fasoncu", hiza: "sol" },
      { anahtar: "gonderilen", baslik: "Gönderilen", birim: "m", hiza: "sag" },
      { anahtar: "donen", baslik: "Dönen", birim: "m", hiza: "sag" },
      { anahtar: "musteriye", baslik: "Fasondan müşteriye", birim: "m", hiza: "sag" },
      { anahtar: "fark", baslik: "Fason farkı", birim: "m", hiza: "sag" },
      { anahtar: "farkOrani", baslik: "Fark oranı", birim: "yuzde", hiza: "sag" },
      { anahtar: "bekleyen", baslik: "Fasonda bekleyen", birim: "m", hiza: "sag" },
      { anahtar: "donusGun", baslik: "Ortalama dönüş", birim: "gun", hiza: "sag" },
    ],
    satirlar: rows.map((r) => ({
      fasoncu: r.label,
      gonderilen: r.dispatchedQty,
      donen: r.returnedQty,
      musteriye: r.deliveredQty,
      fark: r.fireQty,
      farkOrani: r.closedDispatchedQty > 0 ? r.firePct : null,
      bekleyen: r.openQty,
      donusGun: r.avgTurnaroundDays,
    })),
  };
}

export async function buildSubcontractorsReport(input: SubcontractorsReportInput): Promise<CoreReportResult> {
  const { range, compareRange, filters } = input;
  const card = await getSubcontractScorecard(range, compareRange, filters);
  const suzgec = filterEcho(filters, SUBCONTRACT_FILTER_KEYS, card.dusenSatir);
  const s = card.summary;

  // K-FASON: "zamanında dönüş %" ölçülemez (söz verilen gün yok) → ana sayı kapanmış kalemlerin ortalama dönüşü.
  const mainFigure = metricFigure("fason.ortalamaDonusGun", s.avgTurnaroundDays, {
    unmeasured: "Bu dönemde dönüşü tamamlanan fason gönderisi yok",
    ...(compareRange ? { previous: s.prevAvgTurnaroundDays ?? null } : {}),
  });
  const sideFigures = [
    plainFigure("fason.bekleyenMetre", "Fasonda bekleyen", s.openQty, { unit: "m", direction: "asagi" }),
    metricFigure("fire.fasonMetre", s.fireQty, { name: "Eksik dönen", ...(compareRange ? { previous: s.prevFireQty ?? null } : {}) }),
  ];

  const rows = card.bySubcontractor;
  const chart: GrafikBlok | null = rows.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Fasoncu", tur: "kategori" }, y: { ad: "Metre", birim: "m" } },
        kategoriler: rows.map((r) => r.label),
        seriler: [
          { ad: "Gönderilen", veri: rows.map((r) => r.dispatchedQty) },
          { ad: "Dönen", veri: rows.map((r) => r.returnedQty) },
          { ad: "Fasonda bekleyen", veri: rows.map((r) => r.openQty) },
        ],
      }
    : null;

  const table = subcontractorTable(rows);
  const capped = capTable(table, "Fasoncu kırılımı");

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    veri: { satirSayisi: rows.length, suzgec },
    kirilim: { boyut: "fasoncu", birim: "m", adTuru: "ozel", ozneIlgi: "Fasona gidenin", satirlar: rows.map((r) => ({ ad: r.label, deger: r.dispatchedQty })) },
    kapsam: [
      { sayi: s.openItems, nesne: "kalem", neden: "Henüz dönmemiş", sonuc: "fason farkına katılmadı" },
      { sayi: s.unattributedItems, nesne: "kalem", neden: "Başka bir sevkle çıkmış", sonuc: "ölçülemedi" },
    ],
  });

  const fireDef = OLCU_BY_KIMLIK.get("fire.fasonMetre");
  return {
    suzgec,
    sunum: {
      ...catalogHeader("subcontract/fasoncular"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: [
        ...definitionsOf(["fason.ortalamaDonusGun"]),
        { ad: fireDef?.ad ?? "Fason farkı", aciklama: `${fireDef?.aciklama ?? ""} Fire tanımı ve öteki kaynaklar "Ne kaybettik?" raporunda.`.trim() },
      ],
      parametreler: [
        ...rangeParameters(range, input.compareMode),
        listParam("subcontractorId", "Fasoncu", filters.subcontractorId),
        listParam("itemId", "Kumaş", filters.itemId),
        listParam("colorId", "Renk", filters.colorId),
      ],
      uyarilar: capped.uyarilar,
    },
  };
}
