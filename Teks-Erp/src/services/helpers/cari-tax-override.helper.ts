// =============================================================================
// CARİ KDV / TEVKİFAT GEÇERSİZ KILMASI — yazım doğrulaması (D4-V1k; B-1)
// =============================================================================
// NULL = genel ayar. Kısmi PATCH birleşik hâliyle (kayıtlı ⊕ girdi) doğrulanır: pay/payda ikisi birlikte,
// 1 ≤ pay ≤ payda ≤ 99 — DB CHECK `cari_accounts_withholding_ck` son hat, Türkçe 400 ilk hat (fail-closed).
// Okuma/çözüm burada DEĞİL: `invoice-tax-defaults.helper.resolveInvoiceTaxDefaults` tek çözümleyicidir.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import type { CariTaxOverride } from "./invoice-tax-defaults.helper";
import { WITHHOLDING_MAX_DENOMINATOR as MAX_WITHHOLDING_DENOMINATOR } from "../system-setting.service";


export interface CariTaxOverrideInput {
  vatRate?: Prisma.Decimal.Value | null;
  withholdingEnabled?: boolean | null;
  withholdingNumerator?: number | null;
  withholdingDenominator?: number | null;
}

type Stored = { vatRate: Prisma.Decimal | null; withholdingNumerator: number | null; withholdingDenominator: number | null };

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
  const numIn = input.withholdingNumerator !== undefined;
  const denIn = input.withholdingDenominator !== undefined;
  if (numIn || denIn) {
    const num = numIn ? input.withholdingNumerator ?? null : existing.withholdingNumerator;
    const den = denIn ? input.withholdingDenominator ?? null : existing.withholdingDenominator;
    if ((num === null) !== (den === null)) bad("Tevkifat oranının payı ve paydası birlikte girilmeli (ör. 5/10) ya da ikisi de boş bırakılmalı.", "withholdingNumerator");
    if (num !== null && den !== null) {
      if (!Number.isInteger(num) || !Number.isInteger(den) || num < 1 || den > MAX_WITHHOLDING_DENOMINATOR || num > den) {
        bad(`Tevkifat oranı 1 ≤ pay ≤ payda ≤ ${MAX_WITHHOLDING_DENOMINATOR} tam sayıları olmalı (ör. 5/10).`, "withholdingNumerator");
      }
    }
    if (numIn) data.withholdingNumerator = num;
    if (denIn) data.withholdingDenominator = den;
  }
  return data;
}

/** Liste/kart satırına taşınan ham geçersiz kılma (null = genel ayar). */
export function taxOverrideOf(row: CariTaxOverride & { vatRate: Prisma.Decimal | null }) {
  return {
    vatRate: row.vatRate,
    withholdingEnabled: row.withholdingEnabled,
    withholdingNumerator: row.withholdingNumerator,
    withholdingDenominator: row.withholdingDenominator,
  };
}
