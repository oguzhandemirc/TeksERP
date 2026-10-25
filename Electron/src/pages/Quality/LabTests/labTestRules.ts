// K4P-LAB — saf görünüm kuralları (React'siz; birim testine açık).
import type { LabResult, LabResultKind, LabTestStatus, LabTestType, LabVerdict } from "./service";

export const STATUS_LABEL: Record<LabTestStatus, string> = { DRAFT: "Taslak", APPROVED: "Onaylı", VOIDED: "İptal" };
export const STATUS_BADGE: Record<LabTestStatus, "secondary" | "default" | "muted"> = { DRAFT: "secondary", APPROVED: "default", VOIDED: "muted" };
export const VERDICT_LABEL: Record<LabVerdict, string> = { PASS: "Geçti", FAIL: "Kaldı" };
export const KIND_LABEL: Record<LabResultKind, string> = { NUMERIC: "Sayısal ölçüm", SCALE: "Gri ölçek", PASS_FAIL: "Geçti / Kaldı" };

export interface LabFilterState { status: LabTestStatus | ""; verdict: LabVerdict | ""; testTypeId: string; batchNo: string; q: string; from: string; to: string }
export const EMPTY_LAB_FILTERS: LabFilterState = { status: "", verdict: "", testTypeId: "", batchNo: "", q: "", from: "", to: "" };
export const isLabFilterDirty = (f: LabFilterState) => Object.entries(f).some(([, v]) => v !== "");

const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** Backend `formatScaleValue` aynası: gri ölçekte 4,5 → "4-5" (yalnız görünüm; değer ondalık tutulur). */
export function formatScaleValue(value: number): string {
  return Number.isInteger(value) ? String(value) : `${Math.floor(value)}-${Math.ceil(value)}`;
}

/** Sonuç hücresi metni — tür biçimine göre. */
export function resultValueText(r: Pick<LabResult, "resultKind" | "value" | "unit" | "verdict">): string {
  const v = num(r.value);
  if (r.resultKind === "PASS_FAIL" || v === null) return VERDICT_LABEL[r.verdict];
  if (r.resultKind === "SCALE") return formatScaleValue(v);
  return `${v.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}${r.unit ? ` ${r.unit}` : ""}`;
}

/** Sınır aralığı metni ("200–220", "≥ 4", "≤ 3"); sınır yoksa null. */
export function specRangeText(min: string | number | null, max: string | number | null, kind: LabResultKind): string | null {
  const a = num(min), b = num(max);
  const f = (x: number) => (kind === "SCALE" ? formatScaleValue(x) : x.toLocaleString("tr-TR", { maximumFractionDigits: 3 }));
  if (a !== null && b !== null) return `${f(a)}–${f(b)}`;
  if (a !== null) return `≥ ${f(a)}`;
  if (b !== null) return `≤ ${f(b)}`;
  return null;
}

export type SpecSource = "CUSTOMER" | "TYPE" | "NONE";
/** Sonucun sınırı türün varsayılanından farklıysa müşteri spesifikasyonudur (sonuçta snapshot tutulur). */
export function specSource(r: Pick<LabResult, "specMin" | "specMax">, type: Pick<LabTestType, "specMin" | "specMax"> | undefined): SpecSource {
  const rMin = num(r.specMin), rMax = num(r.specMax);
  if (rMin === null && rMax === null) return "NONE";
  if (!type) return "TYPE";
  return rMin === num(type.specMin) && rMax === num(type.specMax) ? "TYPE" : "CUSTOMER";
}

/** Değer sınırın içinde mi — rozet için; PASS_FAIL ya da sınırsızda null (karşılaştırma yok). */
export function withinSpec(r: Pick<LabResult, "resultKind" | "value" | "specMin" | "specMax">): boolean | null {
  const v = num(r.value), a = num(r.specMin), b = num(r.specMax);
  if (r.resultKind === "PASS_FAIL" || v === null || (a === null && b === null)) return null;
  return (a === null || v >= a) && (b === null || v <= b);
}

/** Virgüllü giriş ("4,5") sayıya; boş → null; geçersiz → NaN. */
export function parseDecimalInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

export function labEmptyMessage(f: LabFilterState): string {
  return isLabFilterDirty(f) ? "Süzgeçlere uyan lab testi yok." : "Henüz lab testi yok. “Yeni Test” ile ilk numuneyi kaydedin.";
}
