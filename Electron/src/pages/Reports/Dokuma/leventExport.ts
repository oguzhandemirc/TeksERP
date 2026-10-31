// =============================================================================
// LEVENT SONUCU · KAPASİTE KULLANIMI · LEVENT BİTİŞ TAHMİNİ — dışa aktarım (Excel · PDF · Yazdır)
// =============================================================================
// `dokumaExport.ts` değişmezleri burada da geçer: oranlar METİN (`formatPct` — "ölçülemedi"
// 0'a düşmez); kaynak kırılımı (otomatik/elle) ve ufuk notu kâğıda da basılır.
// =============================================================================
import type { ReportExportSpec } from "../_components/reportExport";
import { fmtDate, fmtMeters } from "../_components/formatters";
import { formatPct } from "./dokuma-regime";
import { kumasKaynakNotu, horizonNote } from "./leventShared";
import { warpSpecCellText, type BeamResultReport, type BeamResultRow, type CapacityReport, type FinishForecastReport } from "./leventReportTypes";

const M = "#,##0.0";
const INT = "#,##0";
const metin = (xs: Array<string | null>): string[] => xs.filter((x): x is string => Boolean(x));
const sayiYaDa = (v: number | null, beyan: string): number | string => (v === null ? beyan : v);

interface Ortak { periodLabel?: string; filterNotes?: string[] }

function beamRows(rows: BeamResultRow[], acik: boolean): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    levent: r.physicalBeamNo ? `${r.beamNo} · ${r.physicalBeamNo}` : r.beamNo,
    cozgu: warpSpecCellText(r),
    tezgah: r.tezgahlar.join(", ") || "—",
    sarilan: r.sarilanM, gercek: r.gercekKumasM, otomatik: r.gercekKaynak.otomatik, elle: r.gercekKaynak.elle,
    ...(acik
      ? { kalan: r.kalanM, kullanim: formatPct(r.kullanimPct) }
      : { beklenen: sayiYaDa(r.beklenenKumasM, "ölçülemedi"), fire: sayiYaDa(r.fireM, "ölçülemedi"), firePct: formatPct(r.firePct), kapanis: fmtDate(r.kapanisAt) }),
  }));
}

const BEAM_COLS = [
  { header: "Levent", key: "levent", width: 22 },
  { header: "Çözgü kartı", key: "cozgu", width: 26 },
  { header: "Tezgah", key: "tezgah", width: 14 },
  { header: "Sarılan (m)", key: "sarilan", width: 12, numFmt: M, align: "right" as const },
  { header: "Gerçek kumaş (m)", key: "gercek", width: 14, numFmt: M, align: "right" as const },
  { header: "Otomatik (m)", key: "otomatik", width: 12, numFmt: M, align: "right" as const },
  { header: "Elle (m)", key: "elle", width: 10, numFmt: M, align: "right" as const },
];

export function buildLeventSonucuExport(opts: Ortak & { rapor: BeamResultReport }): ReportExportSpec {
  const { rapor, periodLabel, filterNotes = [] } = opts;
  const o = rapor.ozet;
  return {
    title: "Levent Sonucu",
    subtitle: periodLabel,
    orientation: "landscape",
    meta: metin([
      `Kapanan levent: ${o.leventSayisi} · açık: ${o.acikLeventSayisi} · beklenen ${fmtMeters(o.beklenenM)} · gerçek ${fmtMeters(o.gercekM)} · fire ${fmtMeters(o.fireM)} (${formatPct(o.firePct)}) · ölçülemedi ${o.olculemedi}`,
      kumasKaynakNotu(o.gercekKaynak, "Gerçek kumaş kaynağı"),
      rapor.meta.duzeltilmisTop > 0 ? `Düzeltilmiş top: ${rapor.meta.duzeltilmisTop} (gerçek kumaş tüketim anındaki metredir)` : null,
      rapor.meta.kumasiOlculmeyenTuketim > 0 ? `Kumaş metresi girilmeden yazılan tüketim: ${rapor.meta.kumasiOlculmeyenTuketim} (fire içinde kalır)` : null,
      horizonNote(rapor.meta),
      ...filterNotes,
    ]),
    tables: [
      { name: "Kapanan leventler", columns: [...BEAM_COLS, { header: "Beklenen (m)", key: "beklenen", width: 12, numFmt: M, align: "right" }, { header: "Fire (m)", key: "fire", width: 10, numFmt: M, align: "right" }, { header: "Fire %", key: "firePct", width: 10, align: "right" }, { header: "Kapanış", key: "kapanis", width: 12 }], rows: beamRows(rapor.kapananlar, false) },
      { name: "Açık leventler (kesit)", columns: [...BEAM_COLS, { header: "Kalan (m)", key: "kalan", width: 12, numFmt: M, align: "right" }, { header: "Kullanım", key: "kullanim", width: 10, align: "right" }], rows: beamRows(rapor.acikLeventler, true) },
    ],
  };
}

export function buildKapasiteExport(opts: Ortak & { rapor: CapacityReport }): ReportExportSpec {
  const { rapor, periodLabel, filterNotes = [] } = opts;
  const o = rapor.ozet;
  return {
    title: "Kapasite Kullanımı",
    subtitle: periodLabel,
    orientation: "landscape",
    meta: metin([
      `Kullanım: ${formatPct(o.kullanimPct)} (Σ gerçek ${fmtMeters(o.gercekM)} / Σ potansiyel ${fmtMeters(o.potansiyelM)}) · hesaplanamadı ${o.hesaplanamadi} satır (${fmtMeters(o.hesaplanamayanGercekM)} oran dışı) · toplam gerçek ${fmtMeters(o.toplamGercekM)}`,
      "Teorik m/saat = nominal atkı/dk ÷ atkı/cm × 0,6; potansiyel = teorik × takvim saati.",
      horizonNote(rapor.meta),
      ...filterNotes,
    ]),
    tables: [{
      name: "Tezgah × hafta",
      columns: [
        { header: "Tezgah", key: "tezgah", width: 22 }, { header: "Hafta", key: "hafta", width: 12 },
        { header: "Nominal atkı/dk", key: "nominal", width: 12, numFmt: M, align: "right" }, { header: "Atkı/cm", key: "atki", width: 10, numFmt: M, align: "right" },
        { header: "Teorik m/sa", key: "teorik", width: 12, numFmt: M, align: "right" }, { header: "Takvim saati", key: "saat", width: 12, numFmt: M, align: "right" },
        { header: "Potansiyel (m)", key: "potansiyel", width: 14, numFmt: M, align: "right" }, { header: "Gerçek (m)", key: "gercek", width: 12, numFmt: M, align: "right" },
        { header: "Kullanım", key: "kullanim", width: 10, align: "right" }, { header: "Hesaplanamadı", key: "gerekce", width: 14 },
      ],
      rows: rapor.satirlar.map((r) => ({
        tezgah: `${r.code} · ${r.name}`, hafta: r.hafta, nominal: sayiYaDa(r.nominalUnitsPerMin, "—"), atki: sayiYaDa(r.unitsPerCm, "—"),
        teorik: sayiYaDa(r.teorikMSaat, "—"), saat: r.takvimSaat, potansiyel: sayiYaDa(r.potansiyelM, "—"), gercek: r.gercekM,
        kullanim: formatPct(r.kullanimPct), gerekce: r.hesaplanamadi ?? "—",
      })),
    }],
  };
}

export function buildBitisTahminiExport(opts: Ortak & { rapor: FinishForecastReport }): ReportExportSpec {
  const { rapor, filterNotes = [] } = opts;
  const o = rapor.ozet;
  return {
    title: "Levent Bitiş Tahmini",
    subtitle: `Kesit · günlük ortalama son ${rapor.meta.pencereGun} fabrika günü (${rapor.meta.pencereBaslangic} itibarıyla)`,
    orientation: "landscape",
    meta: metin([`Tezgahtaki levent: ${o.leventSayisi} · tahminli: ${o.tahminli} · hesaplanamadı: ${o.hesaplanamadi}`, horizonNote(rapor.meta), ...filterNotes]),
    tables: [{
      name: "Leventler",
      columns: [
        { header: "Levent", key: "levent", width: 18 }, { header: "Tezgah", key: "tezgah", width: 22 }, { header: "Yuva", key: "yuva", width: 8, numFmt: INT, align: "right" },
        { header: "Kalan (m)", key: "kalan", width: 12, numFmt: M, align: "right" }, { header: "Günlük ort. (m)", key: "ort", width: 14, numFmt: M, align: "right" },
        { header: "Otomatik (m)", key: "otomatik", width: 12, numFmt: M, align: "right" }, { header: "Elle (m)", key: "elle", width: 10, numFmt: M, align: "right" },
        { header: "Tahmini bitiş", key: "bitis", width: 14 }, { header: "Kalan gün", key: "gun", width: 10, numFmt: M, align: "right" }, { header: "Hesaplanamadı", key: "gerekce", width: 18 },
      ],
      rows: rapor.satirlar.map((r) => ({
        levent: r.beamNo, tezgah: `${r.machine.code} · ${r.machine.name}`, yuva: sayiYaDa(r.position, "—"), kalan: r.kalanM,
        ort: sayiYaDa(r.gunlukOrtM, "—"), otomatik: r.kaynak.otomatik, elle: r.kaynak.elle,
        bitis: r.tahminiBitisGun ?? "—", gun: sayiYaDa(r.kalanGun, "—"), gerekce: r.hesaplanamadi ?? "—",
      })),
    }],
  };
}
