// İE listesi "Metre" sütunu — beyan ↔ ölçülen özeti (`GET /api/work-orders?withMeterSummary=true`).
// Sınıf ve fark SUNUCUDA (tek çözücü); burası yalnız detay kartının sınıflandırıcısıyla tonu seçer ve biçimler.
import { classifyMeterDiff, type MeterDiffTone } from "./detail-v3/meterComparison";

export interface WorkOrderMeterSummary {
  declaredM: number | null;
  measuredMaxM: number | null;
  billedM: number | null;
  diffM: number | null;
  diffPct: number | null;
  withinTolerance: boolean;
  longerThanDeclared: boolean;
}

export interface MeterCellView {
  tone: MeterDiffTone;
  /** Hücre ve dışa aktarım metni: "241 m" · "241 → 300 (+59)" · "241 → 230 (−11)". */
  text: string;
  /** Rozet mi (uzun/kısa) yoksa sade gri metin mi. */
  badge: boolean;
  title: string;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });
const m = (n: number | null) => (n == null ? "—" : `${fmt(n)} m`);

/** Uzunda sağ taraf FATURALANAN (çok partide yalnız uzun partiler artar); kısada beyan + fark (tek partide ölçülen). */
export function meterCellView(s: WorkOrderMeterSummary | null | undefined): MeterCellView | null {
  if (!s) return null;
  const tone = classifyMeterDiff(s);
  const title = `Beyan ${m(s.declaredM)} · Ölçülen ${m(s.measuredMaxM)} · Faturalanan ${m(s.billedM)}`;
  if (tone === "longer" && s.declaredM != null && s.billedM != null) {
    return { tone, badge: true, title, text: `${fmt(s.declaredM)} → ${fmt(s.billedM)} (+${fmt(s.billedM - s.declaredM)})` };
  }
  if (tone === "shorter" && s.declaredM != null && s.diffM != null) {
    return { tone, badge: true, title, text: `${fmt(s.declaredM)} → ${fmt(s.declaredM + s.diffM)} (−${fmt(Math.abs(s.diffM))})` };
  }
  const base = s.declaredM ?? s.measuredMaxM ?? s.billedM;
  if (base == null) return null;
  return { tone: tone === "longer" || tone === "shorter" ? "within" : tone, badge: false, title, text: `${fmt(base)} m` };
}

export const meterCellText = (s: WorkOrderMeterSummary | null | undefined): string => meterCellView(s)?.text ?? "";

export const METER_CELL_BADGE_CLASS: Record<"longer" | "shorter", string> = {
  longer: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  shorter: "border-border bg-muted text-muted-foreground",
};

/** "Beyandan uzun" süzgeci — sunucu `filter[meterCheck]=LONGER` (tanınmayan değer 400). */
export const METER_CHECK_PARAM = "filter[meterCheck]";
export const METER_CHECK_LONGER = "LONGER";
