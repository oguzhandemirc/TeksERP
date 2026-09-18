// =============================================================================
// KART FORMU "FİNANS" BÖLÜMÜ — saf katman (Z-B ①, 2026-09-18)
// =============================================================================
// Terimler HESAPTA kalır (kartta kolon yok): form alanları `finance{…}` alt nesnesi olarak gövdeye girer; alt nesne yalnız
// kullanıcı `finance:write` taşıyor ve modül açıkken konur (yoksa bölüm salt-okunur, gövdeye alt nesne KONMAZ — sunucu 403
// PERMISSION_DENIED verirdi). Okuma opt-in: `GET /customers/:id` `finance`i yalnız `finance:read` ile taşır.
// =============================================================================
import type { Currency } from "@/pages/Finance/service";

export const FINANCE_CURRENCIES: readonly Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

/** `GET /customers/:id` opt-in alanı (riskLimit STRING — Decimal). */
export interface CustomerFinanceView {
  paymentTermDays: number | null;
  defaultCurrency: Currency;
  taxOffice: string | null;
  riskLimit: string | null;
  isActive: boolean;
}

/** Formdaki finans alanları — hepsi metin, "" = boş/dokunulmamış. */
export interface FinanceFormFields {
  financePaymentTermDays: string;
  financeDefaultCurrency: string;
  financeTaxOffice: string;
  financeRiskLimit: string;
}

export const financeFormDefaults: FinanceFormFields = { financePaymentTermDays: "", financeDefaultCurrency: "", financeTaxOffice: "", financeRiskLimit: "" };

/** DTO → form alanları (düzenleme açılışı). */
export function financeFieldsFromView(v: CustomerFinanceView | null | undefined): FinanceFormFields {
  if (!v) return financeFormDefaults;
  return {
    financePaymentTermDays: v.paymentTermDays == null ? "" : String(v.paymentTermDays),
    financeDefaultCurrency: v.defaultCurrency,
    financeTaxOffice: v.taxOffice ?? "",
    financeRiskLimit: v.riskLimit == null ? "" : String(Number(v.riskLimit)),
  };
}

export const TERM_DAYS_ERROR = "Vade 0–3650 gün arasında tam sayı olmalı.";
export const RISK_LIMIT_ERROR = "Risk limiti 0 ya da pozitif bir sayı olmalı.";

export function termDaysError(s: string): string | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? null : TERM_DAYS_ERROR;
}
export function riskLimitError(s: string): string | null {
  if (s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? null : RISK_LIMIT_ERROR;
}

export interface FinanceSubBody {
  paymentTermDays?: number | null;
  defaultCurrency?: Currency;
  taxOffice?: string | null;
  riskLimit?: string | null;
}

/**
 * Gövdeye girecek `finance` alt nesnesi. `canWrite=false` ya da modül kapalı → `{}` (alt nesne HİÇ yok). Boş vade/risk/vergi
 * dairesi → null (temizler); para birimi boşsa anahtar konmaz (sunucu varsayılanı korur).
 */
export function financeSubBody(v: FinanceFormFields, opts: { canWrite: boolean; enabled: boolean }): { finance?: FinanceSubBody } {
  if (!opts.canWrite || !opts.enabled) return {};
  const term = v.financePaymentTermDays.trim();
  const risk = v.financeRiskLimit.trim().replace(",", ".");
  return {
    finance: {
      paymentTermDays: term === "" ? null : Number(term),
      ...(v.financeDefaultCurrency ? { defaultCurrency: v.financeDefaultCurrency as Currency } : {}),
      taxOffice: v.financeTaxOffice.trim() || null,
      riskLimit: risk === "" ? null : String(Number(risk)),
    },
  };
}
