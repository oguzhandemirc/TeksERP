// Belge geneli başlık beyanı (çıkış çeki listesi "Müşteri MT"): şablonun `headerTotals` eşlemesinden taslağa
// `totalsDeclared.document`; onay toplam kapısı (`totalsCheck`) Σ canlı satırı bununla da kıyaslar. Ayrı dosya: taslak.ts boyut tavanı.
import type { RegionExtraction } from "./motor";

/** Pozitif sayı metni (sıfır/okunamayan → null) — taslak satırı ve beyan için tek yüklem. */
export const positive = (v: string | null | undefined): string | null => (v && Number(v) > 0 && Number.isFinite(Number(v)) ? v : null);

/** Belge geneli beyan — `gelen-belge-kontrol.service.ts` `totalsCheck` Σ canlı satırı bununla kıyaslar (etiket mesajda). */
export interface DocumentDeclared {
  count: string | null;
  m: string | null;
  kg: string | null;
  labels: Partial<Record<"count" | "m" | "kg", string>>;
}

/** Şablonun belge geneli beyanı (ör. çıkış çeki listesi "Müşteri MT 238"); hiçbir alan pozitif okunmadıysa undefined. */
export function documentDeclared(reg: RegionExtraction | undefined): DocumentDeclared | undefined {
  const spec = reg?.headerTotals;
  const f = reg?.fields?.fields;
  if (!spec || !f) return undefined;
  const out: DocumentDeclared = { count: null, m: null, kg: null, labels: {} };
  for (const k of ["count", "m", "kg"] as const) {
    const v = spec[k] ? positive(f[spec[k]!.key]?.value) : null;
    if (v) (out[k] = v), (out.labels[k] = spec[k]!.label);
  }
  return out.count || out.m || out.kg ? out : undefined;
}

