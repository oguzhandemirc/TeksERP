// İE "Metre karşılaştırması" (`GET /api/work-orders/:id/meter-comparison`) — beyan ↔ ölçülen, parti bazında.
// Hesap (tolerans, faturalanan, fark) SUNUCUDA; panel yalnız sınıflar ve biçimler. Eski backend 404 / yetkisiz 403 → kart yok.
import { toast } from "sonner";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface MeterDefectBeyond {
  rollId: string;
  barcode: string | null;
  startMeter: number;
  rollDeclaredM: number;
}

export interface MeterComparisonParty {
  partyKey: string;
  batchNo: string | null;
  declaredM: number | null;
  declaredSource: "DOCUMENT" | "WORK_ORDER" | "ROLL_INITIAL" | null;
  kursunOutM: number | null;
  tamburInM: number | null;
  tamburCutM: number | null;
  measuredMaxM: number | null;
  billedM: number | null;
  billedBasis: "DECLARED" | "MEASURED" | null;
  diffM: number | null;
  diffPct: number | null;
  withinTolerance: boolean;
  longerThanDeclared: boolean;
  defectsBeyondDeclared: MeterDefectBeyond[];
}

export interface MeterComparison {
  tolerancePct: number;
  parties: MeterComparisonParty[];
  totals: { declaredM: number | null; measuredMaxM: number | null; billedM: number | null; diffM: number | null };
}

export const METER_COMPARISON_KEY = "work-order-meter-comparison";

/** Eski backend (uç yok) ya da izin dışı: kart sessizce çizilmez. */
export const isHiddenStatus = (status: number | undefined): boolean => status === 404 || status === 403;

export async function getWorkOrderMeterComparison(workOrderId: string): Promise<MeterComparison | null> {
  try {
    const r = await apiClient.get<ApiResponse<MeterComparison>>(`/api/work-orders/${workOrderId}/meter-comparison`, {
      suppressErrorToast: true,
    });
    return r.data.data ?? null;
  } catch (e) {
    const status = (e as { response?: { status?: number } } | null)?.response?.status;
    // Bastırılan interceptor toast'ının yerine TEK bildirim; 404/403 bilinçli sessiz.
    if (!isHiddenStatus(status)) toast.error("Metre karşılaştırması alınamadı.", { id: "wo-meter-comparison" });
    return null;
  }
}

export type MeterDiffTone = "none" | "within" | "longer" | "shorter";

/** Sınıf sunucu bayraklarından: tolerans içi gri, uzun yeşil, kısa amber; ölçüm/beyan yoksa nötr. */
export function classifyMeterDiff(p: Pick<MeterComparisonParty, "diffM" | "withinTolerance" | "longerThanDeclared">): MeterDiffTone {
  if (p.diffM == null) return "none";
  if (p.withinTolerance) return "within";
  if (p.longerThanDeclared) return "longer";
  return p.diffM < 0 ? "shorter" : "within";
}

export const METER_TONE_CLASS: Record<MeterDiffTone, string> = {
  none: "text-muted-foreground",
  within: "text-muted-foreground",
  longer: "font-semibold text-emerald-700 dark:text-emerald-400",
  shorter: "font-medium text-amber-700 dark:text-amber-400",
};

const num = (v: number, digits = 2) => v.toLocaleString("tr-TR", { maximumFractionDigits: digits });

export const meterText = (v: number | null | undefined): string => (v == null ? "—" : `${num(v)} m`);

/** "+40 m (%8)" · "−12,5 m (%2,5)" · "—". */
export function formatMeterDiff(diffM: number | null, diffPct: number | null): string {
  if (diffM == null) return "—";
  const sign = diffM > 0 ? "+" : diffM < 0 ? "−" : "";
  const m = `${sign}${num(Math.abs(diffM))} m`;
  return diffPct == null ? m : `${m} (%${num(Math.abs(diffPct), 1)})`;
}

export const basisBadge = (b: MeterComparisonParty["billedBasis"]): string | null =>
  b === "DECLARED" ? "beyan" : b === "MEASURED" ? "ölçülen" : null;

export function defectNote(d: MeterDefectBeyond): string {
  return `Beyandan uzun: ${d.barcode ?? "top"} ${num(d.startMeter)}. metrede hata (beyan ${num(d.rollDeclaredM)} m)`;
}
