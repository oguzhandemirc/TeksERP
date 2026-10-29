// Saf etiketler: durum · kaynak rozeti · onay kipi · eşik metni. SIMULATED canlı veri gibi görünmez (kesif-cihaz).
import type { ApprovalMode, DeviationStatus, MeterDeviationRow, MeterSource } from "./types";

export const STATUS_LABEL: Record<DeviationStatus, string> = {
  PENDING: "İmza bekliyor",
  UNSIGNED: "İmzasız sapma",
  ACKED: "Onaylı",
};

export const STATUS_HINT: Record<DeviationStatus, string> = {
  PENDING: "Onaylanmadan adım kapanmaz.",
  UNSIGNED: "Fark işaretli; onay kipi imza istemiyor ya da fark okuma sonrası düzeltmeyle doğdu. Adımı tutmaz.",
  ACKED: "İmzalandı.",
};

export const STATUS_TONE_CLASS: Record<DeviationStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  UNSIGNED: "bg-orange-50 text-orange-900 border border-orange-300 dark:bg-orange-950 dark:text-orange-200",
  ACKED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

export const MODE_LABEL: Record<ApprovalMode, string> = {
  NONE: "Onaysız",
  OPERATOR_REASON: "Operatör sebebi",
  SUPERVISOR_PIN: "Süpervizör PIN'i",
  OFFICE: "Ofis onayı",
};

const SOURCE: Record<MeterSource, { label: string; className: string; hint: string }> = {
  MACHINE: { label: "Makine", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200", hint: "Makine sayacından okundu." },
  OPERATOR: { label: "Operatör", className: "bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-200", hint: "Operatör elle girdi." },
  SUPERVISOR: { label: "Süpervizör", className: "bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-200", hint: "Süpervizör elle girdi." },
  SIMULATED: {
    label: "Simüle",
    className: "bg-fuchsia-100 text-fuchsia-900 border border-dashed border-fuchsia-500 dark:bg-fuchsia-950 dark:text-fuchsia-200",
    hint: "SİMÜLASYON — gerçek sayaç verisi değil.",
  },
  INFERRED: { label: "Türetilmiş", className: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200", hint: "Başka kayıtlardan türetildi." },
};

export function sourceBadge(s: string): { label: string; className: string; hint: string } {
  return SOURCE[s as MeterSource] ?? { label: s, className: SOURCE.INFERRED.className, hint: "Tanınmayan kaynak." };
}

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });

export function fmtMeters(v: number | null): string {
  return v == null ? "—" : `${nf.format(v)} m`;
}

export function fmtDiff(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${nf.format(v)} m`;
}

/** "2 m / %1" — okuma anındaki politika kopyası. */
export function thresholdText(r: Pick<MeterDeviationRow, "thresholdM" | "thresholdPct">): string {
  const parts: string[] = [];
  if (r.thresholdM != null && r.thresholdM > 0) parts.push(`${nf.format(r.thresholdM)} m`);
  if (r.thresholdPct != null && r.thresholdPct > 0) parts.push(`%${nf.format(r.thresholdPct)}`);
  return parts.length ? parts.join(" / ") : "—";
}

/** Ofis "Onayla" düğmesi yalnız OFFICE kipli, imza bekleyen satırda. */
export function canOfficeAck(r: Pick<MeterDeviationRow, "status" | "approvalMode">): boolean {
  return r.status === "PENDING" && r.approvalMode === "OFFICE";
}
