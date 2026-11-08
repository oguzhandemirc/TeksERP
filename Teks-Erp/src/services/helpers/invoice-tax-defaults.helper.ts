// =============================================================================
// FATURA KDV / TEVKİFAT ÖN DEĞERİ — TEK ÇÖZÜMLEYİCİ (D4-V1k; B-1 kullanıcı kararı 2026-10-31)
// =============================================================================
// Zincir: MÜŞTERİ cari geçersiz kılması ?? genel ayar ?? bugünkü davranış (KDV `finance.defaultVatRate`,
// tevkifat 0). Yalnız ÖN DEĞERDİR: satır oranı doğuşta damgalanır, muhasebe taslakta değiştirir.
// SATIŞ: müşteri cari geçersiz kılması ?? genel satış ayarı. ALIŞ (F7, fason planı FK4): KDV hep genel;
// tevkifat = fason firma carisinin `purchaseWithholding*` geçersiz kılması ?? genel `finance.withholding.purchase.*`
// (genel YALNIZ fason rolü olan karta — saf iplik/sarf tedarikçisine uydurulmaz; taraf yoksa 0). Kart hem tedarikçi hem
// fasonsa fatura içeriği ayrılmaz: iplik faturasında da önerilir, muhasebe satırda düzeltir (F6 kabul bağlamını taşır).
// Bekçi `test_kdv_tevkifat_ayari` ikinci çözümleyiciyi AST'den yakalar: `readFinanceDefaultVatRate` ve
// carinin vergi alanları bu dosya dışında (ayar servisi + cari CRUD hariç) okunmaz.
// =============================================================================
import { InvoiceType, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readFinanceDefaultVatRate, readFinancePurchaseWithholdingFlags, readFinanceWithholdingFlags, type PurchaseWithholdingFlags, type WithholdingFlags } from "../system-setting.service";
import { findCariAccountForCardTx } from "./finance.helper";

/** Carinin geçersiz kılması (NULL = genel ayar). */
export interface CariTaxOverride {
  vatRate: Prisma.Decimal | number | null;
  withholdingEnabled: boolean | null;
  withholdingNumerator: number | null;
  withholdingDenominator: number | null;
}

/** F7: carinin ALIŞ tevkifatı geçersiz kılması (bu cari bize fatura kesince); NULL = genel alış ayarı. */
export interface CariPurchaseTaxOverride {
  purchaseWithholdingEnabled: boolean | null;
  purchaseWithholdingNumerator: number | null;
  purchaseWithholdingDenominator: number | null;
}

/** ALIŞ çözümünün tarafı: geçersiz kılma + taraf fason rolünde mi (genel alış ayarı yalnız ona uygulanır). */
export interface PurchaseParty {
  override: CariPurchaseTaxOverride | null;
  isSubcontractor: boolean;
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
  purchaseWithholdingEnabled: true,
  purchaseWithholdingNumerator: true,
  purchaseWithholdingDenominator: true,
} as const satisfies Prisma.CariAccountSelect;

/** Genel ayarın tam şekli; alış üçlüsü eksikse (eski çağıran) KAPALI sayılır. */
export type GeneralTaxSettings = { vatRate: number } & WithholdingFlags & Partial<PurchaseWithholdingFlags>;

/** Pay/payda → KDV yüzdesi, 2 hane (Decimal(5,2) kolonu). */
export function withholdingPercent(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10000) / 100;
}

/** SAF çözüm — servis ve bekçi aynı fonksiyonu koşar. */
export function computeInvoiceTaxDefaults(
  type: InvoiceType,
  override: CariTaxOverride | null,
  general: GeneralTaxSettings,
  purchase: PurchaseParty | null = null,
): InvoiceTaxDefaults {
  if (type === InvoiceType.PURCHASE) return computePurchaseTaxDefaults(purchase, general);
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

/** ALIŞ kolu: KDV genel; tevkifat cari ?? (genel ∧ fason taraf) — satış zincirinin aynası, ayrı alanlardan. */
function computePurchaseTaxDefaults(party: PurchaseParty | null, general: GeneralTaxSettings): InvoiceTaxDefaults {
  const o = party?.override ?? null;
  const cariDecides = o?.purchaseWithholdingEnabled != null;
  const generalOn = general.financePurchaseWithholdingEnabled === true && party?.isSubcontractor === true;
  const enabled = cariDecides ? Boolean(o?.purchaseWithholdingEnabled) : generalOn;
  const cariRatio = o?.purchaseWithholdingNumerator != null && o.purchaseWithholdingDenominator != null;
  const numerator = cariRatio ? (o?.purchaseWithholdingNumerator as number) : general.financePurchaseWithholdingNumerator ?? 0;
  const denominator = cariRatio ? (o?.purchaseWithholdingDenominator as number) : general.financePurchaseWithholdingDenominator ?? 0;
  // Açık ama oran yok → tevkifat UYDURULMAZ (satış kolu ile aynı sigorta).
  const valid = enabled && Number.isInteger(numerator) && Number.isInteger(denominator) && numerator >= 1 && denominator >= numerator;
  return {
    vatRate: general.vatRate,
    withholdingRate: valid ? withholdingPercent(numerator, denominator) : 0,
    withholdingRatio: valid ? { numerator, denominator } : null,
    source: { vat: "GENERAL", withholding: cariDecides || cariRatio ? "CARI" : "GENERAL" },
  };
}

/**
 * Faturanın ön değeri. Taraf `cariId` ya da kart (`customerId`) ile verilir; hesap yoksa (lazy cari) genel
 * ayar. Okuma `db` üzerinden (tx içinden çağrılabilir).
 */
export async function resolveInvoiceTaxDefaults(
  input: { type: InvoiceType; cariId?: string | null; customerId?: string | null },
  db: Pick<typeof prisma, "cariAccount" | "systemSetting" | "customer"> = prisma,
): Promise<InvoiceTaxDefaults> {
  const general = { vatRate: await readFinanceDefaultVatRate(db), ...(await readFinanceWithholdingFlags(db)) };
  if (input.type === InvoiceType.PURCHASE) {
    const purchaseGeneral = { ...general, ...(await readFinancePurchaseWithholdingFlags(db)) };
    return computeInvoiceTaxDefaults(input.type, null, purchaseGeneral, await resolvePurchaseParty(input, db));
  }
  if (input.type !== InvoiceType.SALES) return computeInvoiceTaxDefaults(input.type, null, general);
  let override: CariTaxOverride | null = null;
  if (input.cariId) {
    override = await db.cariAccount.findUnique({ where: { id: input.cariId }, select: CARI_TAX_SELECT });
  } else if (input.customerId) {
    override = await findCariAccountForCardTx(db, { customerId: input.customerId, subcontractorId: null }, CARI_TAX_SELECT);
  }
  return computeInvoiceTaxDefaults(input.type, override, general);
}

const PURCHASE_PARTY_SELECT = {
  kind: true,
  purchaseWithholdingEnabled: true,
  purchaseWithholdingNumerator: true,
  purchaseWithholdingDenominator: true,
  customer: { select: { isSubcontractorRole: true } },
} as const satisfies Prisma.CariAccountSelect;

/** Fason rolü TEK yüklemden (iki dal aynı cevabı verir): kart rolü ya da kartsız/eski fason hesabı (`kind` SUBCONTRACTOR). */
export function isSubcontractorParty(p: { kind: string | null; isSubcontractorRole: boolean | null }): boolean {
  return p.kind === "SUBCONTRACTOR" || p.isSubcontractorRole === true;
}

/** Alış tarafı: cari (ya da kartın hesabı) + fason rolü. */
async function resolvePurchaseParty(
  input: { cariId?: string | null; customerId?: string | null },
  db: Pick<typeof prisma, "cariAccount" | "customer">,
): Promise<PurchaseParty | null> {
  if (input.cariId) {
    const acc = await db.cariAccount.findUnique({ where: { id: input.cariId }, select: PURCHASE_PARTY_SELECT });
    if (!acc) return null;
    return { override: acc, isSubcontractor: isSubcontractorParty({ kind: acc.kind, isSubcontractorRole: acc.customer?.isSubcontractorRole ?? null }) };
  }
  if (input.customerId) {
    const card = await db.customer.findUnique({ where: { id: input.customerId }, select: { isSubcontractorRole: true } });
    if (!card) return null;
    const acc = await findCariAccountForCardTx(db, { customerId: input.customerId, subcontractorId: null }, PURCHASE_PARTY_SELECT);
    return { override: acc, isSubcontractor: isSubcontractorParty({ kind: acc?.kind ?? null, isSubcontractorRole: card.isSubcontractorRole }) };
  }
  return null;
}

/** Taslak satırına yazılacak alanlar; tevkifat 0 iken alan EKLENMEZ (bugünkü satır şekli bayt-aynı kalır). */
export function taxLineFields(t: InvoiceTaxDefaults): { vatRate: number; withholdingRate?: number } {
  return t.withholdingRate > 0 ? { vatRate: t.vatRate, withholdingRate: t.withholdingRate } : { vatRate: t.vatRate };
}
