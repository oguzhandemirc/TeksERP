// İE listesi "Metre" sütunu — beyan ↔ ölçülen özeti (`GET /api/work-orders?withMeterSummary=true`).
// Sınıf ve fark SUNUCUDA (tek çözücü); burası yalnız detay kartının sınıflandırıcısıyla tonu seçer ve biçimler.
import { classifyMeterDiff, type MeterDiffTone } from "./detail-v3/meterComparison";
import { formatQty } from "@/lib/format";

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
  /** Hücre ve dışa aktarım metni: "Giren 241 · Çıkan 300 · +59 m" (tabletle aynı dil). */
  text: string;
  /** Rozet mi (uzun/kısa) yoksa sade gri metin mi. */
  badge: boolean;
  title: string;
}

const fmt = (n: number) => formatQty(n, 0);
const m = (n: number | null) => (n == null ? "—" : `${fmt(n)} m`);

/** "Giren" = beyan, "Çıkan" = en yüksek ölçüm (yoksa "—"); fark: uzunda faturaya eklenen (billed − beyan, hep artı), kısada ölçülen − beyan. */
export function meterCellView(s: WorkOrderMeterSummary | null | undefined): MeterCellView | null {
  if (!s) return null;
  const tone = classifyMeterDiff(s);
  const title = `Beyan ${m(s.declaredM)} · Ölçülen ${m(s.measuredMaxM)} · Faturalanan ${m(s.billedM)}`;
  const out = s.measuredMaxM == null ? "—" : fmt(s.measuredMaxM);
  if (s.declaredM == null) {
    const base = s.measuredMaxM ?? s.billedM;
    return base == null ? null : { tone: "none", badge: false, title, text: `Çıkan ${fmt(base)}` };
  }
  const head = `Giren ${fmt(s.declaredM)} · Çıkan ${out}`;
  if (tone === "longer" && s.billedM != null) {
    return { tone, badge: true, title, text: `${head} · +${fmt(s.billedM - s.declaredM)} m` };
  }
  if (tone === "shorter" && s.diffM != null) {
    return { tone, badge: true, title, text: `${head} · −${fmt(Math.abs(s.diffM))} m` };
  }
  return { tone: tone === "longer" || tone === "shorter" ? "within" : tone, badge: false, title, text: head };
}

export const meterCellText = (s: WorkOrderMeterSummary | null | undefined): string => meterCellView(s)?.text ?? "";

export const METER_CELL_BADGE_CLASS: Record<"longer" | "shorter", string> = {
  longer: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  shorter: "border-border bg-muted text-muted-foreground",
};

/** "Beyandan uzun" süzgeci — sunucu `filter[meterCheck]=LONGER` (tanınmayan değer 400). */
export const METER_CHECK_PARAM = "filter[meterCheck]";
export const METER_CHECK_LONGER = "LONGER";
