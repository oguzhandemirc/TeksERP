// =============================================================================
// FATURA KDV / TEVKİFAT ÖN DEĞERİ — TEK ÇÖZÜMLEYİCİ (D4-V1k; B-1 kullanıcı kararı 2026-10-31)
// =============================================================================
// Zincir: MÜŞTERİ cari geçersiz kılması ?? genel ayar ?? bugünkü davranış (KDV `finance.defaultVatRate`,
// tevkifat 0). Yalnız ÖN DEĞERDİR: satır oranı doğuşta damgalanır, muhasebe taslakta değiştirir.
// SATIŞ: müşteri cari geçersiz kılması ?? genel satış ayarı. ALIŞ (F7, fason planı FK4): KDV hep genel;
// tevkifat = fason firma carisinin `purchaseWithholding*` geçersiz kılması ?? genel `finance.withholding.purchase.*`
// (genel YALNIZ fason rolü olan karta — saf iplik/sarf tedarikçisine uydurulmaz; taraf yoksa 0). Kart hem tedarikçi hem
// fasonsa serbest fatura içeriği ayrılmaz (iplik faturasında da önerilir); fason KABULÜNDEN doğan taslak
// `purchaseContext:"SUBCONTRACT"` taşır → taraf fason sayılır (F6). Bilinmeyen `workOrderId` 404 (sessiz düşme yok).
// F7b MALZEME: işi YAPAN taraf ana hammaddeyi kendisi verdiyse iş fason sayılmayabilir → tevkifat ÖNERİLMEZ.
// `WorkOrder.materialProvidedBy` BU FABRİKANIN bakışıdır: satışta yapan biziz (US → öneri kapanır); alışta yapan
// fasoncudur ve kümede "fasoncu verdi" değeri yok → alış bugünkü gibi (bizim/müşterinin malı fasonda = fason).
// Bekçi `test_kdv_tevkifat_ayari` ikinci çözümleyiciyi AST'den yakalar: `readFinanceDefaultVatRate` ve
// carinin vergi alanları bu dosya dışında (ayar servisi + cari CRUD hariç) okunmaz.
// =============================================================================
import { InvoiceType, type MaterialProvider, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readFinanceDefaultVatRate, readFinancePurchaseWithholdingFlags, readFinanceWithholdingFlags, type PurchaseWithholdingFlags, type WithholdingFlags } from "../system-setting.service";
import { AppError } from "../../utils/app-error";
import { findCariAccountForCardTx } from "./finance.helper";
import { TERIM } from "../../constants/terim";

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
  /** F7b: tevkifat malzeme kuralıyla kapandıysa sebebi (yalnız o durumda; panel açıklama basar). */
  withholdingOffReason?: "PERFORMER_SUPPLIED_MATERIAL";
}

/**
 * F7b: işi yapan taraf ana hammaddeyi kendisi mi verdi? `material` BU FABRİKANIN bakışı (İE alanı).
 * SATIŞ: yapan biziz → US. ALIŞ: yapan fasoncu; CUSTOMER/US/MIXED hiçbiri "fasoncu verdi" demez → hep false.
 * MIXED/NULL karar vermez (bugünkü; nitelik mali müşavirde).
 */
export function performerSuppliedMainMaterial(type: InvoiceType, material: MaterialProvider | null | undefined): boolean {
  return type === InvoiceType.SALES && material === "US";
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

/** SAF malzeme kuralı (F7b): satışta ana hammaddeyi işi yapan bu fabrika verdiyse zincirin tevkifatı 0'a iner. */
export function applyMaterialRule(
  type: InvoiceType,
  material: MaterialProvider | null,
  base: InvoiceTaxDefaults,
): InvoiceTaxDefaults {
  if (!performerSuppliedMainMaterial(type, material) || base.withholdingRate === 0) return base;
  return { ...base, withholdingRate: 0, withholdingRatio: null, withholdingOffReason: "PERFORMER_SUPPLIED_MATERIAL" };
}

/** SAF çözüm (cari ?? genel zinciri) — servis ve bekçi aynı fonksiyonu koşar; malzeme kuralı `applyMaterialRule`. */
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
 * F7b bağlamı (opsiyonel): `materialProvidedBy` doğrudan ya da `workOrderId`den okunur (ikisi verilirse doğrudan
 * değer kazanır). Verilen İE yoksa 404 `WORK_ORDER_NOT_FOUND`. `purchaseContext:"SUBCONTRACT"` = fason kabulü
 * kaynaklı alış (F6): taraf rolüne bakılmadan fason sayılır.
 */
export async function resolveInvoiceTaxDefaults(
  input: {
    type: InvoiceType;
    cariId?: string | null;
    customerId?: string | null;
    workOrderId?: string | null;
    materialProvidedBy?: MaterialProvider | null;
    purchaseContext?: "SUBCONTRACT" | null;
  },
  db: Pick<typeof prisma, "cariAccount" | "systemSetting" | "customer" | "workOrder"> = prisma,
): Promise<InvoiceTaxDefaults> {
  const material = await resolveMaterialContext(input, db);
  const general = { vatRate: await readFinanceDefaultVatRate(db), ...(await readFinanceWithholdingFlags(db)) };
  if (input.type === InvoiceType.PURCHASE) {
    const purchaseGeneral = { ...general, ...(await readFinancePurchaseWithholdingFlags(db)) };
    const party = await resolvePurchaseParty(input, db);
    const scoped = input.purchaseContext === "SUBCONTRACT" ? { override: party?.override ?? null, isSubcontractor: true } : party;
    return applyMaterialRule(input.type, material, computeInvoiceTaxDefaults(input.type, null, purchaseGeneral, scoped));
  }
  if (input.type !== InvoiceType.SALES) return computeInvoiceTaxDefaults(input.type, null, general);
  let override: CariTaxOverride | null = null;
  if (input.cariId) {
    override = await db.cariAccount.findUnique({ where: { id: input.cariId }, select: CARI_TAX_SELECT });
  } else if (input.customerId) {
    override = await findCariAccountForCardTx(db, { customerId: input.customerId, subcontractorId: null }, CARI_TAX_SELECT);
  }
  return applyMaterialRule(input.type, material, computeInvoiceTaxDefaults(input.type, override, general));
}

/** F7b bağlamı: doğrudan değer > İE'nin alanı. Verilen İE her türde var olmalı (yoksa 404); alanı yalnız satışta etkili. */
async function resolveMaterialContext(
  input: { type: InvoiceType; workOrderId?: string | null; materialProvidedBy?: MaterialProvider | null },
  db: Pick<typeof prisma, "workOrder">,
): Promise<MaterialProvider | null> {
  if (input.materialProvidedBy !== undefined) return input.materialProvidedBy;
  if (!input.workOrderId) return null;
  const wo = await db.workOrder.findUnique({ where: { id: input.workOrderId }, select: { materialProvidedBy: true } });
  if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.tekil} bulunamadı.`, { code: "WORK_ORDER_NOT_FOUND" });
  return wo.materialProvidedBy ?? null;
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
