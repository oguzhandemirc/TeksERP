// =============================================================================
// K4P-LAB — sonuç değeri doğrulaması + hüküm (saf; DB'siz)
// =============================================================================
// Sınır snapshot'ı varsa hüküm OTOMATİKTİR (sınır dahil içeride → PASS); sınırsız ya da
// PASS_FAIL türde elle gelir. Kural tek yerde: servis de bekçi de buradan geçer; DB CHECK
// `lab_test_results_value_ck` aynı biçimi ikinci kez seddeder.
// =============================================================================
import type { LabResultKind, LabVerdict, LabVerdictSource } from "@prisma/client";
import { AppError } from "../../utils/app-error";

export interface LabResultSpec {
  resultKind: LabResultKind;
  scaleMax: number | null;
  specMin: number | null;
  specMax: number | null;
}

export interface LabVerdictOutcome {
  verdict: LabVerdict;
  verdictSource: LabVerdictSource;
}

/** SCALE: 1..scaleMax arası 0,5 adım (4,5 = "4-5"); NUMERIC: değer zorunlu; PASS_FAIL: değersiz. */
export function assertLabValue(spec: LabResultSpec, value: number | null): void {
  if (spec.resultKind === "PASS_FAIL") {
    if (value !== null) throw AppError.badRequest("Geçti/kaldı türünde sayısal değer girilmez.", { code: "LAB_VALUE_INVALID" });
    return;
  }
  if (value === null || !Number.isFinite(value)) {
    throw AppError.badRequest("Bu test türü için değer zorunlu.", { code: "LAB_VALUE_INVALID" });
  }
  if (spec.resultKind === "SCALE") {
    const max = spec.scaleMax ?? 5;
    if (value < 1 || value > max || !Number.isInteger(value * 2)) {
      throw AppError.badRequest(`Skala değeri 1 ile ${max} arasında, yarım adımlı olmalı (ör. 4,5 = "4-5").`, { code: "LAB_VALUE_INVALID" });
    }
  }
}

export function hasSpec(spec: Pick<LabResultSpec, "specMin" | "specMax">): boolean {
  return spec.specMin !== null || spec.specMax !== null;
}

/** Hüküm: sınır varsa AUTO (elle gelen hüküm yok sayılır), yoksa elle hüküm zorunlu. */
export function resolveLabVerdict(spec: LabResultSpec, value: number | null, manual: LabVerdict | null): LabVerdictOutcome {
  if (spec.resultKind !== "PASS_FAIL" && hasSpec(spec) && value !== null) {
    const aboveMin = spec.specMin === null || value >= spec.specMin;
    const belowMax = spec.specMax === null || value <= spec.specMax;
    return { verdict: aboveMin && belowMax ? "PASS" : "FAIL", verdictSource: "AUTO" };
  }
  if (!manual) throw AppError.badRequest("Sınır tanımlı değil: sonucu Geçti/Kaldı olarak seçin.", { code: "LAB_VERDICT_REQUIRED" });
  return { verdict: manual, verdictSource: "MANUAL" };
}

/** SCALE gösterimi: 4,5 → "4-5", 4 → "4" (yalnız görünüm; değer Decimal tutulur). */
export function formatScaleValue(value: number): string {
  return Number.isInteger(value) ? String(value) : `${Math.floor(value)}-${Math.ceil(value)}`;
}
