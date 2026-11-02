// Belgeden PARTİ NO adayları + seçim (Gülkesim, 2026-11-02; saf, DB yok). Kaynak: şablonun `batchNoCandidates` sırası ve
// okunmuş bölge alanları (`regions[0].fields`). Taslak doldurma, detay ve okuma özeti AYNI fonksiyonlardan türetir.
import { turkishUpper, type BatchNoCandidateKind, type DocumentTemplate } from "./motor";

/** `CustomerDeliveryNote.ourBatchNo` kolon boyu. */
export const BATCH_NO_MAX = 64;
/** Elle yazılan parti no'nun anahtarı (aday değil; hatırlamaya girmez). */
export const BATCH_NO_KEY_MANUAL = "MANUAL";

export interface BatchNoCandidate {
  key: string;
  kind: BatchNoCandidateKind;
  label: string;
  value: string;
}

/** trim + boşluk daraltma + Code39 yıldızları (`*…*`) soyma + Türkçe büyük harf (motorun `upper`ı) + 64 karakter; boş → null. */
export function normalizeBatchNo(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().replace(/^\*+|\*+$/g, "").replace(/\s+/g, " ").trim();
  return t ? turkishUpper(t).slice(0, BATCH_NO_MAX) : null;
}

/** Şablon sırasıyla değeri okunmuş adaylar; aynı değer ikinci kez listelenmez. Şablon adaysızsa boş. */
export function batchNoCandidates(template: DocumentTemplate | undefined, fields: Record<string, string | null | undefined>): BatchNoCandidate[] {
  const out: BatchNoCandidate[] = [];
  for (const spec of template?.batchNoCandidates ?? []) {
    const value = normalizeBatchNo(fields[spec.field]);
    if (!value || out.some((c) => c.value === value)) continue;
    const label = template?.fields.find((f) => f.key === spec.field)?.label ?? spec.field;
    out.push({ key: spec.field, kind: spec.kind, label, value });
  }
  return out;
}

/** Seçim (§2.4): hatırlanan anahtarın değeri varsa o → aday tekse o → aksi null (panel "Parti no seçin"; onay kapısı değil). */
export function pickBatchNo(candidates: readonly BatchNoCandidate[], rememberedKey: string | null | undefined): { value: string; key: string } | null {
  const remembered = rememberedKey ? candidates.find((c) => c.key === rememberedKey) : undefined;
  const c = remembered ?? (candidates.length === 1 ? candidates[0] : undefined);
  return c ? { value: c.value, key: c.key } : null;
}
