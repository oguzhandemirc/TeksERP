// =============================================================================
// CARİ KDV / TEVKİFAT GEÇERSİZ KILMASI — yazım doğrulaması (D4-V1k; B-1)
// =============================================================================
// NULL = genel ayar. Kısmi PATCH birleşik hâliyle (kayıtlı ⊕ girdi) doğrulanır: pay/payda ikisi birlikte,
// 1 ≤ pay ≤ payda ≤ 99 — DB CHECK `cari_accounts_withholding_ck` son hat, Türkçe 400 ilk hat (fail-closed).
// Okuma/çözüm burada DEĞİL: `invoice-tax-defaults.helper.resolveInvoiceTaxDefaults` tek çözümleyicidir.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import type { CariPurchaseTaxOverride, CariTaxOverride } from "./invoice-tax-defaults.helper";
import { WITHHOLDING_MAX_DENOMINATOR as MAX_WITHHOLDING_DENOMINATOR } from "../system-setting.service";


export interface CariTaxOverrideInput {
  vatRate?: Prisma.Decimal.Value | null;
  withholdingEnabled?: boolean | null;
  withholdingNumerator?: number | null;
  withholdingDenominator?: number | null;
  /** F7: ALIŞ tevkifatı geçersiz kılması (fason firma bize keserken); null = genel alış ayarı. */
  purchaseWithholdingEnabled?: boolean | null;
  purchaseWithholdingNumerator?: number | null;
  purchaseWithholdingDenominator?: number | null;
}

type Stored = {
  vatRate: Prisma.Decimal | null;
  withholdingNumerator: number | null;
  withholdingDenominator: number | null;
  purchaseWithholdingNumerator: number | null;
  purchaseWithholdingDenominator: number | null;
};

function bad(message: string, field: string): never {
  throw AppError.badRequest(message, { code: "CARI_TAX_OVERRIDE_INVALID", field });
}

/** Girdiyi doğrular ve Prisma `data` parçasını döner (yalnız gelen alanlar). */
export function cariTaxOverrideData(input: CariTaxOverrideInput, existing: Stored): Prisma.CariAccountUpdateInput {
  const data: Prisma.CariAccountUpdateInput = {};
  if (input.vatRate !== undefined) {
    if (input.vatRate === null) data.vatRate = null;
    else {
      let v: Prisma.Decimal;
      try {
        v = new Prisma.Decimal(input.vatRate);
      } catch {
        bad("KDV oranı sayı olmalı (ör. 20).", "vatRate");
      }
      if (!v.isFinite() || v.lt(0) || v.gt(100) || v.decimalPlaces() > 2) bad("KDV oranı 0–100 arasında, en çok 2 haneli olmalı.", "vatRate");
      data.vatRate = v;
    }
  }
  if (input.withholdingEnabled !== undefined) {
    if (input.withholdingEnabled !== null && typeof input.withholdingEnabled !== "boolean") bad("Tevkifat seçimi uygulanır / uygulanmaz ya da genel ayar olmalı.", "withholdingEnabled");
    data.withholdingEnabled = input.withholdingEnabled;
  }
  const sales = ratioData({ num: input.withholdingNumerator, den: input.withholdingDenominator }, { num: existing.withholdingNumerator, den: existing.withholdingDenominator }, "withholdingNumerator", "Tevkifat");
  if (sales.num !== undefined) data.withholdingNumerator = sales.num;
  if (sales.den !== undefined) data.withholdingDenominator = sales.den;
  if (input.purchaseWithholdingEnabled !== undefined) {
    if (input.purchaseWithholdingEnabled !== null && typeof input.purchaseWithholdingEnabled !== "boolean") bad("Alış tevkifatı seçimi uygulanır / uygulanmaz ya da genel ayar olmalı.", "purchaseWithholdingEnabled");
    data.purchaseWithholdingEnabled = input.purchaseWithholdingEnabled;
  }
  const purchase = ratioData({ num: input.purchaseWithholdingNumerator, den: input.purchaseWithholdingDenominator }, { num: existing.purchaseWithholdingNumerator, den: existing.purchaseWithholdingDenominator }, "purchaseWithholdingNumerator", "Alış tevkifat");
  if (purchase.num !== undefined) data.purchaseWithholdingNumerator = purchase.num;
  if (purchase.den !== undefined) data.purchaseWithholdingDenominator = purchase.den;
  return data;
}

/** Pay/payda çiftinin birleşik (kayıtlı ⊕ girdi) doğrulaması — satış ve alış aynı yüklemden; undefined = gelmedi. */
function ratioData(
  input: { num: number | null | undefined; den: number | null | undefined },
  stored: { num: number | null; den: number | null },
  field: string,
  label: string,
): { num?: number | null; den?: number | null } {
  const numIn = input.num !== undefined;
  const denIn = input.den !== undefined;
  if (!numIn && !denIn) return {};
  const num = numIn ? input.num ?? null : stored.num;
  const den = denIn ? input.den ?? null : stored.den;
  if ((num === null) !== (den === null)) bad(`${label} oranının payı ve paydası birlikte girilmeli (ör. 5/10) ya da ikisi de boş bırakılmalı.`, field);
  if (num !== null && den !== null) {
    if (!Number.isInteger(num) || !Number.isInteger(den) || num < 1 || den > MAX_WITHHOLDING_DENOMINATOR || num > den) {
      bad(`${label} oranı 1 ≤ pay ≤ payda ≤ ${MAX_WITHHOLDING_DENOMINATOR} tam sayıları olmalı (ör. 5/10).`, field);
    }
  }
  return { ...(numIn ? { num } : {}), ...(denIn ? { den } : {}) };
}

/** Liste/kart satırına taşınan ham geçersiz kılma (null = genel ayar). */
export function taxOverrideOf(row: CariTaxOverride & CariPurchaseTaxOverride & { vatRate: Prisma.Decimal | null }) {
  return {
    vatRate: row.vatRate,
    withholdingEnabled: row.withholdingEnabled,
    withholdingNumerator: row.withholdingNumerator,
    withholdingDenominator: row.withholdingDenominator,
    purchaseWithholdingEnabled: row.purchaseWithholdingEnabled,
    purchaseWithholdingNumerator: row.purchaseWithholdingNumerator,
    purchaseWithholdingDenominator: row.purchaseWithholdingDenominator,
  };
}
