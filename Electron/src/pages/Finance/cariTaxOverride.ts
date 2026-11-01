// =============================================================================
// CARİ KDV / TEVKİFAT GEÇERSİZ KILMASI — saf form katmanı (D4-V1k; B-1 kullanıcı kararı 2026-10-31)
// =============================================================================
// Boş alan = genel ayar (gövdede null). Oran "pay/payda" metnidir (5/10); yarım oran yazılamaz. Sunucu aynı
// kuralı 400 CARI_TAX_OVERRIDE_INVALID ile ayrıca uygular — bu katman yalnız kullanıcıya erken söyler.
// =============================================================================
import type { CariRow, CariTaxOverrideBody } from "./service";

/** "FACTORY" = genel ayar (null) · "APPLY" = uygulanır · "NONE" = bu müşteride uygulanmaz. */
export type WithholdingChoice = "FACTORY" | "APPLY" | "NONE";

export interface CariTaxForm {
  /** HAM METİN, % — "" = genel ayar. */
  vatRate: string;
  withholding: WithholdingChoice;
  /** HAM METİN "pay/payda" — "" = genel ayarın oranı. */
  ratio: string;
}

export const WITHHOLDING_CHOICES: Array<{ value: WithholdingChoice; label: string }> = [
  { value: "FACTORY", label: "Genel ayar" },
  { value: "APPLY", label: "Uygulanır" },
  { value: "NONE", label: "Uygulanmaz" },
];

/** Satırdan forma; alanı göndermeyen eski backend'de `null` (alan çizilmez, gövdeye girmez). */
export function taxFormFromCari(c: CariRow): CariTaxForm | null {
  if (c.withholdingEnabled === undefined) return null;
  return {
    vatRate: c.vatRate == null ? "" : String(c.vatRate),
    withholding: c.withholdingEnabled == null ? "FACTORY" : c.withholdingEnabled ? "APPLY" : "NONE",
    ratio: c.withholdingNumerator != null && c.withholdingDenominator != null ? `${c.withholdingNumerator}/${c.withholdingDenominator}` : "",
  };
}

/** "" → null · "20" / "1,5" → "20" / "1.5" (0–100, en çok 2 hane) · geçersiz → undefined. */
export function parseVatRate(raw: string): string | null | undefined {
  const t = raw.trim().replace("%", "").trim();
  if (t === "") return null;
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const v = m[2] ? `${m[1]}.${m[2]}` : (m[1] as string);
  return Number(v) <= 100 ? v : undefined;
}

/** "" → null · "5/10" → { 5, 10 } (1 ≤ pay ≤ payda ≤ 99) · geçersiz → undefined. */
export function parseWithholdingRatio(raw: string): { numerator: number; denominator: number } | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const numerator = Number(m[1]);
  const denominator = Number(m[2]);
  return numerator >= 1 && numerator <= denominator ? { numerator, denominator } : undefined;
}

export function buildTaxOverrideBody(f: CariTaxForm): { ok: true; body: CariTaxOverrideBody } | { ok: false; error: string } {
  const vat = parseVatRate(f.vatRate);
  if (vat === undefined) return { ok: false, error: "KDV oranı 0–100 arasında olmalı (ör. 20 ya da 1,5); genel ayar için boş bırakın." };
  const ratio = parseWithholdingRatio(f.ratio);
  if (ratio === undefined) return { ok: false, error: "Tevkifat oranını pay/payda yazın (ör. 5/10; pay paydadan büyük olamaz); genel oran için boş bırakın." };
  return {
    ok: true,
    body: {
      vatRate: vat,
      withholdingEnabled: f.withholding === "FACTORY" ? null : f.withholding === "APPLY",
      withholdingNumerator: ratio?.numerator ?? null,
      withholdingDenominator: ratio?.denominator ?? null,
    },
  };
}
