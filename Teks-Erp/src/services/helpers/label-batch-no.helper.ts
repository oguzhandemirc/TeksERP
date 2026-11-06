// Etiket parti no (Gülkesim 2026-11-06): müşterinin etikete basılmasını istediği serbest metin
// ("J1", "K30"). Bizim parti no'muz değil; tek normalleştirici — kesim yolları + düzeltme ucu.
import { AppError } from "../../utils/app-error";

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
