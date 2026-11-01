// =============================================================================
// FATURA KDV / TEVKİFAT ÖN DEĞERİ — TEK ÇÖZÜMLEYİCİ (D4-V1k; B-1 kullanıcı kararı 2026-10-31)
// =============================================================================
// Zincir: MÜŞTERİ cari geçersiz kılması ?? genel ayar ?? bugünkü davranış (KDV `finance.defaultVatRate`,
// tevkifat 0). Yalnız ÖN DEĞERDİR: satır oranı doğuşta damgalanır, muhasebe taslakta değiştirir.
// Geçersiz kılma yalnız SATIŞ faturasında okunur ("müşteri bazında"); ALIŞ taslağı bugünkü gibi genel KDV
// + tevkifat 0 (tedarikçinin tevkifatı ayrı bir yasal soru — bu dilimde tasarlanmadı).
// Bekçi `test_kdv_tevkifat_ayari` ikinci çözümleyiciyi AST'den yakalar: `readFinanceDefaultVatRate` ve
// carinin vergi alanları bu dosya dışında (ayar servisi + cari CRUD hariç) okunmaz.
// =============================================================================
import { InvoiceType, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readFinanceDefaultVatRate, readFinanceWithholdingFlags, type WithholdingFlags } from "../system-setting.service";
import { findCariAccountForCardTx } from "./finance.helper";

/** Carinin geçersiz kılması (NULL = genel ayar). */
export interface CariTaxOverride {
  vatRate: Prisma.Decimal | number | null;
  withholdingEnabled: boolean | null;
  withholdingNumerator: number | null;
  withholdingDenominator: number | null;
}

export type TaxDefaultSource = "CARI" | "GENERAL";

export interface InvoiceTaxDefaults {
  /** KDV oranı, %. */
  vatRate: number;
  /** Tevkifat, KDV'nin %'si (5/10 → 50) — satır kolonu `withholdingRate` sözleşmesi; 0 = tevkifat yok. */
  withholdingRate: number;
  /** Pay/payda (gösterim için); tevkifat yoksa null. */
  withholdingRatio: { numerator: number; denominator: number } | null;
  source: { vat: TaxDefaultSource; withholding: TaxDefaultSource };
}

export const CARI_TAX_SELECT = {
  vatRate: true,
  withholdingEnabled: true,
  withholdingNumerator: true,
  withholdingDenominator: true,
} as const satisfies Prisma.CariAccountSelect;

/** Pay/payda → KDV yüzdesi, 2 hane (Decimal(5,2) kolonu). */
export function withholdingPercent(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10000) / 100;
}

/** SAF çözüm — servis ve bekçi aynı fonksiyonu koşar. */
export function computeInvoiceTaxDefaults(
  type: InvoiceType,
  override: CariTaxOverride | null,
  general: { vatRate: number } & WithholdingFlags,
): InvoiceTaxDefaults {
  const sales = type === InvoiceType.SALES;
  const o = sales ? override : null;
  const vatRate = o?.vatRate != null ? Number(o.vatRate) : general.vatRate;
  const vatSource: TaxDefaultSource = o?.vatRate != null ? "CARI" : "GENERAL";

  const cariDecides = o?.withholdingEnabled != null;
  const enabled = sales && (cariDecides ? Boolean(o?.withholdingEnabled) : general.financeWithholdingEnabled);
  const cariRatio = o?.withholdingNumerator != null && o.withholdingDenominator != null;
  const numerator = cariRatio ? (o?.withholdingNumerator as number) : general.financeWithholdingNumerator;
  const denominator = cariRatio ? (o?.withholdingDenominator as number) : general.financeWithholdingDenominator;
  const whSource: TaxDefaultSource = cariDecides || cariRatio ? "CARI" : "GENERAL";
  // Açık ama oran yok (genel pay 0 ve carinin oranı boş) → tevkifat UYDURULMAZ, 0 kalır.
  const valid = enabled && numerator >= 1 && denominator >= numerator;
  return {
    vatRate,
    withholdingRate: valid ? withholdingPercent(numerator, denominator) : 0,
    withholdingRatio: valid ? { numerator, denominator } : null,
    source: { vat: vatSource, withholding: whSource },
  };
}

/**
 * Faturanın ön değeri. Taraf `cariId` ya da kart (`customerId`) ile verilir; hesap yoksa (lazy cari) genel
 * ayar. Okuma `db` üzerinden (tx içinden çağrılabilir).
 */
export async function resolveInvoiceTaxDefaults(
  input: { type: InvoiceType; cariId?: string | null; customerId?: string | null },
  db: Pick<typeof prisma, "cariAccount" | "systemSetting"> = prisma,
): Promise<InvoiceTaxDefaults> {
  const general = { vatRate: await readFinanceDefaultVatRate(db), ...(await readFinanceWithholdingFlags(db)) };
  if (input.type !== InvoiceType.SALES) return computeInvoiceTaxDefaults(input.type, null, general);
  let override: CariTaxOverride | null = null;
  if (input.cariId) {
    override = await db.cariAccount.findUnique({ where: { id: input.cariId }, select: CARI_TAX_SELECT });
  } else if (input.customerId) {
    override = await findCariAccountForCardTx(db, { customerId: input.customerId, subcontractorId: null }, CARI_TAX_SELECT);
  }
  return computeInvoiceTaxDefaults(input.type, override, general);
}

/** Taslak satırına yazılacak alanlar; tevkifat 0 iken alan EKLENMEZ (bugünkü satır şekli bayt-aynı kalır). */
export function taxLineFields(t: InvoiceTaxDefaults): { vatRate: number; withholdingRate?: number } {
  return t.withholdingRate > 0 ? { vatRate: t.vatRate, withholdingRate: t.withholdingRate } : { vatRate: t.vatRate };
}
