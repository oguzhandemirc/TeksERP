// =============================================================================
// Temel rapor 5 — "Üretim nerede takıldı?" (`production/uretim-akisi`)
// =============================================================================
// Kaynak: Nerede Takıldı (`getWipScorecard`) + Operatör İş Hacmi (`getOperatorPerformance`).
// Bekleyen = ANLIK kesit (dönemden bağımsız, kıyası yok); geçen metre = DÖNEM (kıyaslı).
// Operatör görünümü KİŞİ ADI taşır → sonuç `kisiAdi:true` döner (buluta gitmez, R1-BULUT).
// Birim top/metre/iş kaydı; puanlama dili ("performans") kullanılmaz.

import { anlatiUret } from "../anlati/anlati";
import { TERIM } from "../../../constants/terim";
import type { DateRange } from "../_shared";
import { getOperatorPerformance, type OperatorPerformanceRow } from "../production.report.service";
import type { GrafikBlok, ParametreBeyani, TabloBlok } from "../sunum/sunum.types";
import { getWipScorecard, type WipStationRow } from "../wip-scorecard.report.service";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, rangeParameters, type CoreReportResult } from "./_common";
import type { CompareMode } from "../_shared";

export const PRODUCTION_FLOW_VIEWS = ["istasyon", "operator"] as const;
export type ProductionFlowView = (typeof PRODUCTION_FLOW_VIEWS)[number];

/** Operatör listesinin tavanı — kaynak ucun varsayılanıyla aynı (eşitlik aynı parametreyle ölçülür). */
export const OPERATOR_LIMIT = 50;

export interface ProductionFlowInput {
  range: DateRange;
  compareRange: DateRange | null;
  compareMode: CompareMode;
  view?: ProductionFlowView;
}

/** En uzun kuyruk: en çok topun beklediği istasyon (eşitlikte en eski bekleyen öne). */
export function longestQueue(rows: readonly WipStationRow[]): WipStationRow | null {
  let best: WipStationRow | null = null;
  for (const r of rows) {
    if (r.waitingCount <= 0) continue;
    if (!best || r.waitingCount > best.waitingCount || (r.waitingCount === best.waitingCount && (r.oldestDays ?? 0) > (best.oldestDays ?? 0))) best = r;
  }
  return best;
}

function viewParameter(view: ProductionFlowView): ParametreBeyani {
  return {
    ad: "varyant",
    etiket: "Görünüm",
    tur: "secim",
    deger: view,
    secenekler: [
      { deger: "istasyon", etiket: "İstasyona göre" },
      { deger: "operator", etiket: "Operatöre göre" },
    ],
  };
}

function operatorTable(operators: readonly OperatorPerformanceRow[]): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "operator", baslik: "Operatör", hiza: "sol" },
      { anahtar: "toplam", baslik: "İş kaydı", birim: "adet", hiza: "sag" },
      { anahtar: "kursun", baslik: "Kurşun", birim: "adet", hiza: "sag" },
      { anahtar: "kalite", baslik: "Kalite kontrol", birim: "adet", hiza: "sag" },
      { anahtar: "tambur", baslik: "Tambur", birim: "adet", hiza: "sag" },
      { anahtar: "fason", baslik: "Fason", birim: "adet", hiza: "sag" },
    ],
    satirlar: operators.map((o) => ({
      operator: o.fullName || o.username,
      toplam: o.totalOps,
      kursun: o.kursunCount,
      kalite: o.qc2Count,
      tambur: o.tamburCount,
      fason: o.subcontractorOps,
    })),
  };
}

function stationTable(rows: readonly WipStationRow[]): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "istasyon", baslik: "İstasyon", hiza: "sol" },
      { anahtar: "bekleyenTop", baslik: "Bekleyen", birim: "top", hiza: "sag" },
      { anahtar: "bekleyenMetre", baslik: "Bekleyen metre", birim: "m", hiza: "sag" },
      { anahtar: "enEski", baslik: "En uzun bekleme", birim: "gun", hiza: "sag" },
      { anahtar: "ortBekleme", baslik: "Ortalama bekleme", birim: "gun", hiza: "sag" },
      { anahtar: "gecenTop", baslik: "Geçen", birim: "top", hiza: "sag" },
      { anahtar: "gecenMetre", baslik: "Geçen metre", birim: "m", hiza: "sag" },
      { anahtar: "kalis", baslik: "Ortalama kalış", birim: "saat", hiza: "sag" },
    ],
    satirlar: rows.map((r) => ({
      istasyon: r.label,
      bekleyenTop: r.waitingCount,
      bekleyenMetre: r.waitingQty,
      enEski: r.oldestDays,
      ortBekleme: r.avgWaitDays,
      gecenTop: r.passedCount,
      gecenMetre: r.passedQty,
      kalis: r.avgDurationHours,
    })),
  };
}

export async function buildProductionFlowReport(input: ProductionFlowInput): Promise<CoreReportResult> {
  const { range, compareRange } = input;
  const view = input.view ?? "istasyon";
  const [wip, previous, operators] = await Promise.all([
    getWipScorecard(range),
    compareRange ? getWipScorecard(compareRange) : Promise.resolve(null),
    view === "operator" ? getOperatorPerformance(range, OPERATOR_LIMIT) : Promise.resolve(null),
  ]);
  const s = wip.summary;
  const queue = longestQueue(wip.byStation);

  const mainFigure = metricFigure("uretim.bekleyenTop", s.waitingCount, { unit: "top" });
  const sideFigures = [
    metricFigure("uretim.gecenMetre", s.passedQty, previous ? { previous: previous.summary.passedQty } : {}),
    plainFigure("uretim.ortalamaBeklemeGun", "Ortalama bekleme", s.avgWaitDays, {
      unit: "gun",
      direction: "asagi",
      unmeasured: "Şu an istasyonlarda bekleyen top yok",
    }),
    plainFigure("uretim.enUzunKuyruk", queue ? `En uzun kuyruk: ${queue.label}` : "En uzun kuyruk", queue ? queue.waitingCount : null, {
      unit: "top",
      direction: "asagi",
      unmeasured: "Şu an istasyonlarda bekleyen top yok",
    }),
  ];

  const stations = wip.byStation.filter((r) => r.waitingCount > 0 || r.passedCount > 0);
  const chart: GrafikBlok | null = stations.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "İstasyon", tur: "kategori" }, y: { ad: "Metre", birim: "m" } },
        kategoriler: stations.map((r) => r.label),
        seriler: [
          { ad: "Bekleyen", veri: stations.map((r) => r.waitingQty) },
          { ad: "Dönemde geçen", veri: stations.map((r) => r.passedQty) },
        ],
      }
    : null;

  const table = operators ? operatorTable(operators) : stationTable(wip.byStation);
  const capped = capTable(table, operators ? "Operatör listesi" : "İstasyon listesi");

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: sideFigures[0],
    anaSayiIfadesi: { yuklem: "kumaş istasyonlardan geçti" },
    veri: { satirSayisi: s.waitingCount + s.passedCount },
    kirilim: {
      boyut: "istasyon",
      birim: "top",
      adTuru: "ozel",
      ozneIlgi: "Bekleyen topların",
      satirlar: wip.byStation.filter((r) => r.waitingCount > 0).map((r) => ({ ad: r.label, deger: r.waitingCount })),
    },
    kapsam: [
      { sayi: s.neverStartedWorkOrders, nesne: TERIM.terbiyeIsEmri.tekilKucuk, neden: "Açılıp hiç malzeme girmemiş", sonuc: "bekleyen toplara katılmadı" },
    ],
  });

  const warnings = [...capped.uyarilar];
  if (operators && operators.length >= OPERATOR_LIMIT) warnings.push(`Operatör listesi en çok iş kaydı olan ${OPERATOR_LIMIT} kişiyle sınırlı.`);

  return {
    sunum: {
      ...catalogHeader("production/uretim-akisi"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["uretim.bekleyenTop", "uretim.gecenMetre"]),
      parametreler: [...rangeParameters(range, input.compareMode), viewParameter(view)],
      uyarilar: warnings,
      ...(operators ? { kisiAdi: true as const } : {}),
    },
  };
}
