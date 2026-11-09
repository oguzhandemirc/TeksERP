// Etiket parti no (Gülkesim 2026-11-06): müşterinin etikete basılmasını istediği serbest metin
// ("J1", "K30"). Bizim parti no'muz değil; tek normalleştirici — kesim yolları + düzeltme ucu.
import { AppError } from "../../utils/app-error";
import { normalizeDisplayName } from "./name-normalize.helper";

export const LABEL_BATCH_NO_MAX = 64;

/** `undefined` → dokunma · null/boş → null (temizle) · metin → kırpılmış metin; 64 üstü 400. */
export function normalizeLabelBatchNo(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  if (t.length > LABEL_BATCH_NO_MAX) {
    throw AppError.badRequest(`Etiket parti no en çok ${LABEL_BATCH_NO_MAX} karakter olabilir.`, { code: "LABEL_BATCH_INVALID" });
  }
  return t === "" ? null : t;
}

// Etiket kumaş adı / rengi (Gülkesim 2026-11-09): müşterinin etikete istediği ad, topa kesimde yazılır.
// Müşteri adı zinciriyle aynı biçim (trim + tek boşluk + TR büyük harf) → öneri listesinde tekrar doğmaz.
export const LABEL_TEXT_MAX = 80;

/** `undefined`/null/boş → null · metin → normalize; 80 üstü 400. Kesimde "dokunma" anlamı yok: yeni top. */
export function normalizeRollLabelText(v: string | null | undefined, alan: "Etiket kumaş adı" | "Etiket rengi"): string | null {
  if (v == null) return null;
  const t = normalizeDisplayName(v);
  if (t.length > LABEL_TEXT_MAX) {
    throw AppError.badRequest(`${alan} en çok ${LABEL_TEXT_MAX} karakter olabilir.`, { code: "LABEL_TEXT_INVALID" });
  }
  return t === "" ? null : t;
}

/** Kesim gövdesinden topa yazılacak etiket ad/renk çifti (iki alan da opsiyonel). */
export function resolveRollLabelTexts(data: { labelItemName?: string | null; labelColorName?: string | null }): {
  labelItemName: string | null;
  labelColorName: string | null;
} {
  return {
    labelItemName: normalizeRollLabelText(data.labelItemName, "Etiket kumaş adı"),
    labelColorName: normalizeRollLabelText(data.labelColorName, "Etiket rengi"),
  };
}
