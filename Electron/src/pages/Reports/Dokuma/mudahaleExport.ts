// =============================================================================
// MÜDAHALE / ÇÖZÜM SÜRESİ (B4) — dışa aktarım spec'i: Excel · PDF · Yazdır TEK spec'ten
// =============================================================================
import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import { fmtPercent } from "../_components/formatters";
import type { AlarmResponseReport, AlarmResponseRow } from "./service";

/** Saniye → "4 dk 45 sn" / "1 sa 05 dk"; null → "—". Müdahale süreleri dakikanın altına iner, saniye düşürülmez. */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h} sa ${String(m).padStart(2, "0")} dk`;
  return m > 0 ? `${m} dk ${String(s).padStart(2, "0")} sn` : `${s} sn`;
}

export type MudahaleAxis = "sebepler" | "holler" | "vardiyalar" | "tezgahlar" | "kisiler";
export const MUDAHALE_AXIS_LABELS: Record<MudahaleAxis, string> = {
  sebepler: "Sebep", holler: "Hol", vardiyalar: "Vardiya", tezgahlar: "Tezgah", kisiler: "Usta (ilk üstlenen)",
};

/** Raporun taşıdığı eksenler — kişi ekseni yalnız sunucu döndürdüyse (yetki kararı sunucuda). */
export function mudahaleAxes(rapor: AlarmResponseReport | undefined): MudahaleAxis[] {
  const base: MudahaleAxis[] = ["sebepler", "holler", "vardiyalar", "tezgahlar"];
  return rapor?.kisiler ? [...base, "kisiler"] : base;
}

export const MUDAHALE_NOTE =
  "Üstlenme: alarmın doğuşundan ilk üstlenmeye · Çözüm: doğuştan duruşun kapanışına · Hedef: K2 vadesi (hedef + pay). " +
  "Aşım oranının paydası sonucu belli olan alarmlardır; canlı (vadesi gelmemiş), hedefsiz ve iptal alarmlar paydada değildir, sayısı ayrıca basılır.";

function axisTable(axis: MudahaleAxis, rows: AlarmResponseRow[]): ReportTableSpec {
  return {
    name: `${MUDAHALE_AXIS_LABELS[axis]} kırılımı`,
    columns: [
      { header: MUDAHALE_AXIS_LABELS[axis], key: "etiket", width: 30 },
      { header: "Alarm", key: "alarm", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Ort. üstlenme", key: "ustlenme", width: 16, align: "right" },
      { header: "Ort. çözüm", key: "cozum", width: 16, align: "right" },
      { header: "Aşım", key: "asim", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Zamanında", key: "zamaninda", width: 12, numFmt: "#,##0", align: "right" },
      { header: "Aşım oranı (%)", key: "oran", width: 14, numFmt: "#,##0.0", align: "right" },
      { header: "Belirsiz", key: "belirsiz", width: 10, numFmt: "#,##0", align: "right" },
      { header: "Hedefsiz", key: "hedefsiz", width: 10, numFmt: "#,##0", align: "right" },
      { header: "İptal", key: "iptal", width: 10, numFmt: "#,##0", align: "right" },
    ],
    rows: rows.map((r) => ({
      etiket: r.etiket, alarm: r.alarm, ustlenme: fmtDuration(r.ustlenmeOrtSn), cozum: fmtDuration(r.cozumOrtSn),
      asim: r.asim, zamaninda: r.zamaninda, oran: r.asimOraniPct ?? "—", belirsiz: r.belirsiz, hedefsiz: r.hedefsiz, iptal: r.iptal,
    })),
  };
}

/** Özet satırı + seçili eksen (ekranda görünen) — kâğıt ekranla aynı rakamı basar. */
export function buildMudahaleExport(opts: { rapor: AlarmResponseReport; axis: MudahaleAxis; periodLabel: string; warnings?: string[] }): ReportExportSpec {
  const { rapor, axis, periodLabel, warnings = [] } = opts;
  const o = rapor.ozet;
  return {
    title: "Müdahale ve Çözüm Süresi",
    subtitle: periodLabel,
    orientation: "landscape",
    meta: [
      `Alarm: ${o.alarm} · Ort. üstlenme: ${fmtDuration(o.ustlenmeOrtSn)} (${o.ustlenilen} alarm) · Ort. çözüm: ${fmtDuration(o.cozumOrtSn)} (${o.cozulen} alarm) · ` +
        `Hedef aşımı: ${fmtPercent(o.asimOraniPct)} (${o.asim}/${o.asim + o.zamaninda})`,
      `Belirsiz: ${o.belirsiz} · Hedefsiz: ${o.hedefsiz} · İptal: ${o.iptal}`,
      MUDAHALE_NOTE,
      ...warnings,
    ],
    tables: [axisTable(axis, rapor[axis] ?? [])],
  };
}
