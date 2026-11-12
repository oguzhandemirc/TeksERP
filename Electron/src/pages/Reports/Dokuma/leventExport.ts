// =============================================================================
// LEVENT BİTİŞ TAHMİNİ — dışa aktarım (Excel · PDF · Yazdır)
// =============================================================================
// `dokumaExport.ts` değişmezleri burada da geçer: "hesaplanamadı" 0'a düşmez; kaynak kırılımı
// (otomatik/elle) ve ufuk notu kâğıda da basılır. (Levent Sonucu · Kapasite spec'leri sayfalarıyla kalktı.)
// =============================================================================
import type { ReportExportSpec } from "../_components/reportExport";
import { horizonNote } from "./leventShared";
import type { FinishForecastReport } from "./leventReportTypes";

const M = "#,##0.0";
const INT = "#,##0";
const metin = (xs: Array<string | null>): string[] => xs.filter((x): x is string => Boolean(x));
const sayiYaDa = (v: number | null, beyan: string): number | string => (v === null ? beyan : v);

interface Ortak { periodLabel?: string; filterNotes?: string[] }

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
