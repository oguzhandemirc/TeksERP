// =============================================================================
// TeksERP - System Setting / finance
// =============================================================================
// Muhasebe · tevkifat · fatura toleransı · hizmet faturası okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { applyModuleCeiling } from "../../lib/license/module-ceiling";
import { AppError } from "../../utils/app-error";
import { asBoolean, asNumber } from "./core";
import { CARI_HOLD_DEFAULT_SCOPES, DEFAULT_CARI_HOLD_SCOPE, DEFAULT_EXPENSE_ALLOCATION_CLOSED_WORK_ORDER, DEFAULT_EXPENSE_ALLOCATION_FIELD, DEFAULT_EXPENSE_CATEGORY_SUGGESTIONS, DEFAULT_FINANCE_VAT_RATE, DEFAULT_KURSUN_GRAM_PRICE_BASIS, DEFAULT_SERVICE_BILLING_BRODE_UNIT, DEFAULT_SERVICE_BILLING_METER_BASIS, DEFAULT_SERVICE_BILLING_MISSING_METER, DEFAULT_SERVICE_BILLING_PRICE_DATE, DEFAULT_SERVICE_BILLING_TRIGGER, EXPENSE_ALLOCATION_CLOSED_WORK_ORDER_MODES, EXPENSE_ALLOCATION_FIELD_MODES, EXPENSE_CATEGORY_SUGGESTION_MODES, KURSUN_GRAM_PRICE_BASES, MAX_FINANCE_VAT_RATE, MIN_FINANCE_VAT_RATE, SERVICE_BILLING_BRODE_UNITS, SERVICE_BILLING_METER_BASES, SERVICE_BILLING_MISSING_METER_MODES, SERVICE_BILLING_PRICE_DATES, SERVICE_BILLING_TRIGGERS, type CariHoldDefaultScope, type ExpenseAllocationClosedWorkOrder, type ExpenseAllocationField, type ExpenseCategorySuggestions, type KursunGramPriceBasis, type ServiceBillingBrodeUnit, type ServiceBillingMeterBasis, type ServiceBillingMissingMeter, type ServiceBillingPriceDate, type ServiceBillingTrigger } from "./defaults";
import { type FeatureFlags } from "./feature-flags-types";
import { SETTING_KEYS } from "./keys";


/**
 * Transaction içinden çağrılabilen tolerance okuma. tx verilirse aynı tx'i
 * kullanır (recomputeOrderStatusTx için kritik). tx yoksa dış prisma client.
 */
export async function readShippingToleranceMeters(
  tx?: Pick<typeof prisma, "systemSetting">
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
    select: { value: true },
  });
  if (!setting) return 5;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return 5;
  return parsed;
}

/**
 * Pricing/currency UI gösterilsin mi? Default false (kayıt yoksa). Frontend
 * bu flag'e göre order create/list/detail ekranlarındaki currency dropdown +
 * unitPrice + totalAmount alanlarını render eder.
 */
export async function readPricingEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_PRICING_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Ön muhasebe modülü açık mı? Default false.
 *
 * ⚠️ Bu bayrak GÖRÜNÜRLÜK değil REJİM anahtarıdır: kapalıyken menü satırı
 * çizilmez, route 403 verir ve otomatik taslak kancaları no-op olur. Üçü de
 * ayrı ayrı test edilir (`test_finance_flag_off`) — yalnız menüyü gizlemek,
 * adresi bilen birine modülü açık bırakırdı.
 */
export async function readFinanceEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readFinanceEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readFinanceEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.FINANCE_ENABLED, await readFinanceEnabledRaw(tx));
}

/**
 * Kasa eksi bakiye engeli açık mı? Default false.
 *
 * ENFORCEMENT READER — bilerek cache'siz (`readTamburOverQuantityEnabled`
 * emsali): guard tx içinde her seferinde taze okur; panelden kapatılan bayrak
 * bir sonraki işlemde anında etkisizleşir (acil kapatma yolu). Tek tüketici:
 * `helpers/cash-balance-guard.helper.assertCashBalanceCoversTx`.
 */
export async function readFinanceBlockNegativeCashEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** D4-V1k: genel tevkifat ayarının sınırları (müşteri geçersiz kılması DB CHECK'iyle aynı: 1 ≤ pay ≤ payda). */
export const WITHHOLDING_MAX_DENOMINATOR = 99;
export const DEFAULT_WITHHOLDING_DENOMINATOR = 10;
export type WithholdingFlags = Pick<FeatureFlags, "financeWithholdingEnabled" | "financeWithholdingNumerator" | "financeWithholdingDenominator">;

/** Türkçe hata cümlesi ya da null — servis yazımı ve bekçi aynı yüklemi okur. */
export type WithholdingInput = { financeWithholdingEnabled?: boolean; financeWithholdingNumerator?: number | null; financeWithholdingDenominator?: number | null };

export function withholdingSettingProblem(v: WithholdingFlags): string | null {
  return withholdingTripleProblem(v.financeWithholdingEnabled, v.financeWithholdingNumerator, v.financeWithholdingDenominator, "Genel tevkifat");
}

/** Satış ve alış üçlüsünün ORTAK yüklemi (tek kaynak); `label` yalnız cümlenin öznesi. */
function withholdingTripleProblem(enabled: unknown, num: number, den: number, label: string): string | null {
  if (typeof enabled !== "boolean") return `${label} açık/kapalı (true/false) olmalı`;
  if (!Number.isInteger(num) || num < 0 || num > WITHHOLDING_MAX_DENOMINATOR) return `Tevkifat payı 0–${WITHHOLDING_MAX_DENOMINATOR} arasında tam sayı olmalı`;
  if (!Number.isInteger(den) || den < 1 || den > WITHHOLDING_MAX_DENOMINATOR) return `Tevkifat paydası 1–${WITHHOLDING_MAX_DENOMINATOR} arasında tam sayı olmalı`;
  if (num > den) return "Tevkifat payı paydadan büyük olamaz (ör. 5/10)";
  if (enabled && num < 1) return `${label} açıkken oran girilmeli (ör. 5/10)`;
  return null;
}

/** F7: fason ALIŞ taslağının genel tevkifatı (satış üçlüsünün ikizi, ayrı anahtarlar). */
export type PurchaseWithholdingFlags = Pick<FeatureFlags, "financePurchaseWithholdingEnabled" | "financePurchaseWithholdingNumerator" | "financePurchaseWithholdingDenominator">;
export type PurchaseWithholdingInput = { financePurchaseWithholdingEnabled?: boolean; financePurchaseWithholdingNumerator?: number | null; financePurchaseWithholdingDenominator?: number | null };

export function purchaseWithholdingSettingProblem(v: PurchaseWithholdingFlags): string | null {
  return withholdingTripleProblem(v.financePurchaseWithholdingEnabled, v.financePurchaseWithholdingNumerator, v.financePurchaseWithholdingDenominator, "Fason alış tevkifatı");
}

/** Satır yoksa KAPALI · pay 0 · payda 10 (bugünkü: alışta tevkifat yok). Bozuk/çöp kayıt kapalıya düşer. */
export async function readFinancePurchaseWithholdingFlags(tx?: Pick<typeof prisma, "systemSetting">): Promise<PurchaseWithholdingFlags> {
  const client = tx ?? prisma;
  const read = async (key: string) => (await client.systemSetting.findUnique({ where: { key }, select: { value: true } }))?.value;
  const flags: PurchaseWithholdingFlags = {
    financePurchaseWithholdingEnabled: asBoolean(await read(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED)),
    financePurchaseWithholdingNumerator: asNumber(await read(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR)) ?? 0,
    financePurchaseWithholdingDenominator: asNumber(await read(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR)) ?? DEFAULT_WITHHOLDING_DENOMINATOR,
  };
  return purchaseWithholdingSettingProblem(flags)
    ? { financePurchaseWithholdingEnabled: false, financePurchaseWithholdingNumerator: 0, financePurchaseWithholdingDenominator: DEFAULT_WITHHOLDING_DENOMINATOR }
    : flags;
}
export async function readFinancePurchaseWithholdingEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  // Anahtar SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED — üçlüyle birlikte doğrulanmış değer.
  return (await readFinancePurchaseWithholdingFlags(tx)).financePurchaseWithholdingEnabled;
}
export async function readFinancePurchaseWithholdingNumerator(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  // Anahtar SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR — üçlüyle birlikte doğrulanmış değer.
  return (await readFinancePurchaseWithholdingFlags(tx)).financePurchaseWithholdingNumerator;
}
export async function readFinancePurchaseWithholdingDenominator(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  // Anahtar SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR — üçlüyle birlikte doğrulanmış değer.
  return (await readFinancePurchaseWithholdingFlags(tx)).financePurchaseWithholdingDenominator;
}

/** Genel tevkifat ayarı; satır yoksa KAPALI · pay 0 · payda 10 (bugünkü davranış: tevkifat yok). Bozuk kayıt kapalıya düşer. */
export async function readFinanceWithholdingFlags(tx?: Pick<typeof prisma, "systemSetting">): Promise<WithholdingFlags> {
  const client = tx ?? prisma;
  const read = async (key: string) => (await client.systemSetting.findUnique({ where: { key }, select: { value: true } }))?.value;
  const flags: WithholdingFlags = {
    financeWithholdingEnabled: asBoolean(await read(SETTING_KEYS.FINANCE_WITHHOLDING_ENABLED)),
    financeWithholdingNumerator: asNumber(await read(SETTING_KEYS.FINANCE_WITHHOLDING_NUMERATOR)) ?? 0,
    financeWithholdingDenominator: asNumber(await read(SETTING_KEYS.FINANCE_WITHHOLDING_DENOMINATOR)) ?? DEFAULT_WITHHOLDING_DENOMINATOR,
  };
  return withholdingSettingProblem(flags) ? { financeWithholdingEnabled: false, financeWithholdingNumerator: 0, financeWithholdingDenominator: DEFAULT_WITHHOLDING_DENOMINATOR } : flags;
}

/** getFeatureFlags satır okuyucuları (panel sözleşme bekçisi okuyucuyu adıyla çözer) — doğrulanmış üçlüden. */
export async function readFinanceWithholdingEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  // Anahtar SETTING_KEYS.FINANCE_WITHHOLDING_ENABLED — üçlüyle birlikte doğrulanmış değer.
  return (await readFinanceWithholdingFlags(tx)).financeWithholdingEnabled;
}
export async function readFinanceWithholdingNumerator(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  // Anahtar SETTING_KEYS.FINANCE_WITHHOLDING_NUMERATOR — üçlüyle birlikte doğrulanmış değer.
  return (await readFinanceWithholdingFlags(tx)).financeWithholdingNumerator;
}
export async function readFinanceWithholdingDenominator(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  // Anahtar SETTING_KEYS.FINANCE_WITHHOLDING_DENOMINATOR — üçlüyle birlikte doğrulanmış değer.
  return (await readFinanceWithholdingFlags(tx)).financeWithholdingDenominator;
}

/**
 * Fatura satırının varsayılan KDV oranı (%). Kayıt yoksa / aralık dışıysa 20
 * (= 2026-08-14 öncesi hardcode; ayar dokunulmamış kurulumda sıfır fark).
 * İki tüketici: `invoice.service.createDraftFromGoodsReceipt` (alış taslağı)
 * ve Electron fatura formunun yeni satırı — ikisi de tek kaynaktan okur.
 */
export async function readFinanceDefaultVatRate(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_DEFAULT_VAT_RATE },
    select: { value: true },
  });
  const parsed = asNumber(setting?.value);
  if (parsed === null || parsed < MIN_FINANCE_VAT_RATE || parsed > MAX_FINANCE_VAT_RATE) {
    return DEFAULT_FINANCE_VAT_RATE;
  }
  return parsed;
}

/** Çek teslim bordrosu hareket fişi bayrağı. Default FALSE (satır yoksa belge-only — bugünkü davranış). HAM değer. */
export async function readFinanceChequeNoteMovementEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_CHEQUE_NOTE_MOVEMENT_ENABLED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** n irsaliye → 1 fatura: tolerans kontrolü bayrağı. Default FALSE (satır yoksa kontrol YOK — bugünkü davranış). HAM değer. */
export async function readFinanceInvoiceMatchTolerance(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_INVOICE_MATCH_TOLERANCE }, select: { value: true } });
  return asBoolean(setting?.value);
}

export const DEFAULT_INVOICE_TOLERANCE_PCT = 0;
async function readTolerancePct(key: string, tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const parsed = asNumber(setting?.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) return DEFAULT_INVOICE_TOLERANCE_PCT;
  return parsed;
}
/** Miktar sapma üst sınırı (%). Default 0. */
export async function readFinanceInvoiceQtyTolerancePct(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  return readTolerancePct(SETTING_KEYS.FINANCE_INVOICE_QTY_TOLERANCE_PCT, tx);
}
/** Tutar sapma üst sınırı (%). Default 0. */
export async function readFinanceInvoicePriceTolerancePct(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  return readTolerancePct(SETTING_KEYS.FINANCE_INVOICE_PRICE_TOLERANCE_PCT, tx);
}

// =============================================================================
// TİCARET/MUHASEBE REJİM OKUYUCULARI (2026-08-14, dalga 1 — HENÜZ ÇAĞIRAN YOK)
// =============================================================================
// Dokuzu da ENFORCEMENT READER kalıbındadır (`readFinanceBlockNegativeCashEnabled`
// emsali): bilerek CACHE'SİZ ve `tx` parametreli — guard tx içinde her seferinde
// taze okur, böylece panelden kapatılan bayrak bir SONRAKİ işlemde anında
// etkisizleşir (acil kapatma yolu). Kayıt yoksa hepsi FALSE döner (`asBoolean`),
// yani bugünkü davranış birebir korunur.
//
// ⚠️ Bu fonksiyonların bugün ÇAĞIRANI YOKTUR ve bu bilinçlidir; "ölü kod" diye
// silme — dört kapı sözleşmesinin servis ayağıdır (bekçi:
// `scripts/test_feature_flag_contract.ts`). Davranışı bağlayan dalga, ilgili
// SETTING_KEYS JSDoc'undaki MUAF listesini birebir uygular.

/** Risk limiti aşımında satış faturası onayını engelle? Default false. */
export async function readFinanceRiskLimitBlockEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** D4-I2: risk limiti aşımında yeni iş kabulü engellensin mi? Default false (cache'siz, guard tx içinde taze okur). */
export async function readFinanceRiskLimitBlockIntake(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** D4-I2: risk limiti aşımında sevk engellensin mi? Default false. */
export async function readFinanceRiskLimitBlockShipment(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_SHIPMENT }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Sevk onayında otomatik satış faturası TASLAĞI üretilsin mi? Default false. */
export async function readFinanceAutoDraftFromShipmentEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** H7: hizmet faturası ana anahtarı — HAM okuyucu; kayıt yok → KAPALI. Etkin değer `resolveServiceBillingEnabled`. */
export async function readFinanceServiceBillingEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Fason F3: adım işi (süreç türü → hizmet kartı) — kayıt yok → KAPALI (bugünkü davranış). */
export async function readFinanceServiceBillingStepWorks(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_STEP_WORKS }, select: { value: true } });
  return asBoolean(setting?.value);
}

export async function readServiceEnum<T extends string>(key: string, allowed: readonly T[], fallback: T, tx?: Pick<typeof prisma, "systemSetting">): Promise<T> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && allowed.includes(v as T) ? (v as T) : fallback;
}

/** H7: metre tabanı — tanınmayan değer varsayılana (`OUT`) düşer. */
export function readFinanceServiceBillingMeterBasis(tx?: Pick<typeof prisma, "systemSetting">): Promise<ServiceBillingMeterBasis> {
  return readServiceEnum(SETTING_KEYS.FINANCE_SERVICE_BILLING_METER_BASIS, SERVICE_BILLING_METER_BASES, DEFAULT_SERVICE_BILLING_METER_BASIS, tx);
}

/** H7: ölçüm yoksa — tanınmayan değer varsayılana (`DECLARED_WITH_WARNING`) düşer. */
export function readFinanceServiceBillingMissingMeter(tx?: Pick<typeof prisma, "systemSetting">): Promise<ServiceBillingMissingMeter> {
  return readServiceEnum(SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER, SERVICE_BILLING_MISSING_METER_MODES, DEFAULT_SERVICE_BILLING_MISSING_METER, tx);
}

/** Çıkışsız kapı yasağı: ADET/VURUŞ adedi yalnız kurşun sayaç çıkış okumasında girilir; sayaç kapalıyken seçilemez (iki yönde). */
export function assertBrodeUnitHasPieceInput(unit: ServiceBillingBrodeUnit, capture: unknown): void {
  if (unit === "METER" || capture !== "OFF") return;
  throw AppError.badRequest("Brode ADET/VURUŞ birimi kurşun metre ölçümü kapalıyken seçilemez: adet tablette sayaç çıkış okumasında girilir. Önce kurşun metre ölçümünü açın ya da Metre seçin.", {
    code: "BRODE_UNIT_NEEDS_METER_CAPTURE",
  });
}

/** Brode fiyat birimi — tanınmayan değer varsayılana (`METER`) düşer. */
export function readFinanceServiceBillingBrodeUnit(tx?: Pick<typeof prisma, "systemSetting">): Promise<ServiceBillingBrodeUnit> {
  return readServiceEnum(SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT, SERVICE_BILLING_BRODE_UNITS, DEFAULT_SERVICE_BILLING_BRODE_UNIT, tx);
}

/** H7: tetik — tanınmayan değer varsayılana (`PER_SHIPMENT`) düşer. */
export function readFinanceServiceBillingTrigger(tx?: Pick<typeof prisma, "systemSetting">): Promise<ServiceBillingTrigger> {
  return readServiceEnum(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, SERVICE_BILLING_TRIGGERS, DEFAULT_SERVICE_BILLING_TRIGGER, tx);
}

/** H7: fiyat tarihi — tanınmayan değer varsayılana (`SERVICE_DAY`) düşer. */
export function readFinanceServiceBillingPriceDate(tx?: Pick<typeof prisma, "systemSetting">): Promise<ServiceBillingPriceDate> {
  return readServiceEnum(SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE, SERVICE_BILLING_PRICE_DATES, DEFAULT_SERVICE_BILLING_PRICE_DATE, tx);
}

/** K14: gram fiyatı tabanı — tanınmayan değer varsayılana (`SERVICE_DATE`) düşer. */
export function readFinanceKursunGramPriceBasis(tx?: Pick<typeof prisma, "systemSetting">): Promise<KursunGramPriceBasis> {
  return readServiceEnum(SETTING_KEYS.FINANCE_KURSUN_GRAM_PRICE_BASIS, KURSUN_GRAM_PRICE_BASES, DEFAULT_KURSUN_GRAM_PRICE_BASIS, tx);
}

/** D4-H1: masraf kategorisi önerisi — tanınmayan değer varsayılana (`ON`) düşer. */
/** D4-H3: masraf bağı alanı — tanınmayan değer varsayılana (`OFF`) düşer. */
export function readFinanceExpenseAllocationField(tx?: Pick<typeof prisma, "systemSetting">): Promise<ExpenseAllocationField> {
  return readServiceEnum(SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_FIELD, EXPENSE_ALLOCATION_FIELD_MODES, DEFAULT_EXPENSE_ALLOCATION_FIELD, tx);
}

/** D4-H3: kapanmış iş emrine bağ — tanınmayan değer varsayılana (`ALLOW`) düşer. */
export function readFinanceExpenseAllocationClosedWorkOrder(tx?: Pick<typeof prisma, "systemSetting">): Promise<ExpenseAllocationClosedWorkOrder> {
  return readServiceEnum(SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_CLOSED_WORK_ORDER, EXPENSE_ALLOCATION_CLOSED_WORK_ORDER_MODES, DEFAULT_EXPENSE_ALLOCATION_CLOSED_WORK_ORDER, tx);
}

export function readFinanceExpenseCategorySuggestions(tx?: Pick<typeof prisma, "systemSetting">): Promise<ExpenseCategorySuggestions> {
  return readServiceEnum(SETTING_KEYS.FINANCE_EXPENSE_CATEGORY_SUGGESTIONS, EXPENSE_CATEGORY_SUGGESTION_MODES, DEFAULT_EXPENSE_CATEGORY_SUGGESTIONS, tx);
}

/** D4-I1a: cari kilidi kapsam ön seçimi — tanınmayan değer varsayılana (`INTAKE,SHIPMENT`) düşer. */
export function readFinanceCariHoldDefaultScope(tx?: Pick<typeof prisma, "systemSetting">): Promise<CariHoldDefaultScope> {
  return readServiceEnum(SETTING_KEYS.FINANCE_CARI_HOLD_DEFAULT_SCOPE, CARI_HOLD_DEFAULT_SCOPES, DEFAULT_CARI_HOLD_SCOPE, tx);
}
