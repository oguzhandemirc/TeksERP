// =============================================================================
// TeksERP - System Setting / cost-purchase
// =============================================================================
// Maliyet/kârlılık · cari kilit · risk limiti · satın alma/mal kabul okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { FINISHING_KG_BASES, type FinishingKgBasis } from "../helpers/fabric-cost-kg.helper";
import { Prisma } from "@prisma/client";
import { asBoolean } from "./core";
import { CARI_HOLD_EMANET_SHIPMENT_MODES, CARI_HOLD_RELEASE_BY_SAME_PERSON_MODES, COST_PRESENTATION_CURRENCIES, DEFAULT_CARI_HOLD_EMANET_SHIPMENT, DEFAULT_CARI_HOLD_RELEASE_BY_SAME_PERSON, DEFAULT_COST_FINISHING_KG_BASIS, DEFAULT_COST_PRESENTATION_CURRENCY, DEFAULT_ORDER_PRODUCTION_PROPOSAL, DEFAULT_PROFIT_CONSUMABLE_PRICE_SOURCE, DEFAULT_PROFIT_MACHINE_TIME_MODE, DEFAULT_PROFIT_OVERHEAD_KEY, DEFAULT_PROFIT_SUBCONTRACT_SOURCE, DEFAULT_RISK_LIMIT_CURRENCY_MODE, DEFAULT_WEAVING_STANDARD_METHOD, ORDER_PRODUCTION_PROPOSAL_MODES, PROFIT_CATEGORY_CLASSES, PROFIT_CATEGORY_CLASS_MAX_ENTRIES, PROFIT_CATEGORY_CLASS_MAX_KEY, PROFIT_CONSUMABLE_PRICE_SOURCES, PROFIT_MACHINE_TIME_MODES, PROFIT_OVERHEAD_KEYS, PROFIT_SUBCONTRACT_SOURCES, RISK_LIMIT_CURRENCY_MODES, WEAVING_STANDARD_METHODS, type CariHoldEmanetShipment, type CariHoldReleaseBySamePerson, type CostPresentationCurrency, type KursunGramPriceBasis, type OrderProductionProposalMode, type ProfitCategoryClass, type ProfitCategoryClassMap, type ProfitConsumablePriceSource, type ProfitMachineTimeMode, type ProfitOverheadKey, type ProfitSubcontractSource, type RiskLimitCurrencyMode, type ServiceBillingBrodeUnit, type ServiceBillingMeterBasis, type ServiceBillingMissingMeter, type ServiceBillingPriceDate, type ServiceBillingTrigger, type WeavingStandardMethod } from "./defaults";
import { readFinanceEnabled, readFinanceKursunGramPriceBasis, readFinanceRiskLimitBlockIntake, readFinanceRiskLimitBlockShipment, readFinanceServiceBillingBrodeUnit, readFinanceServiceBillingStepWorks, readFinanceServiceBillingEnabled, readFinanceServiceBillingMeterBasis, readFinanceServiceBillingMissingMeter, readFinanceServiceBillingPriceDate, readFinanceServiceBillingTrigger, readServiceEnum } from "./finance";
import { SETTING_KEYS } from "./keys";
import { readTicaretEnabled } from "./modules";


/** SY-J1: maliyet sunum dövizi — tanınmayan değer varsayılana (`TRY`) düşer. */
export function readCostPresentationCurrency(tx?: Pick<typeof prisma, "systemSetting">): Promise<CostPresentationCurrency> {
  return readServiceEnum(SETTING_KEYS.COST_PRESENTATION_CURRENCY, COST_PRESENTATION_CURRENCIES, DEFAULT_COST_PRESENTATION_CURRENCY, tx);
}

/** SY-E1: KG terbiye tabanı — tanınmayan değer varsayılana (`NET_HAM`) düşer. */
export function readCostFinishingKgBasis(tx?: Pick<typeof prisma, "systemSetting">): Promise<FinishingKgBasis> {
  return readServiceEnum(SETTING_KEYS.COST_FINISHING_KG_BASIS, FINISHING_KG_BASES, DEFAULT_COST_FINISHING_KG_BASIS, tx);
}

/** D4-G2a: kârlılık dış fason kaynağı — tanınmayan değer varsayılana (`FATURA_ONCE`) düşer. */
export function readCostProfitSubcontractSource(tx?: Pick<typeof prisma, "systemSetting">): Promise<ProfitSubcontractSource> {
  return readServiceEnum(SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE, PROFIT_SUBCONTRACT_SOURCES, DEFAULT_PROFIT_SUBCONTRACT_SOURCE, tx);
}

/** D4-G2a: kârlılık sarf fiyatı kaynağı — tanınmayan değer varsayılana (`ALIS_FIYATI`) düşer. */
export function readCostProfitConsumablePriceSource(tx?: Pick<typeof prisma, "systemSetting">): Promise<ProfitConsumablePriceSource> {
  return readServiceEnum(SETTING_KEYS.COST_PROFIT_CONSUMABLE_PRICE_SOURCE, PROFIT_CONSUMABLE_PRICE_SOURCES, DEFAULT_PROFIT_CONSUMABLE_PRICE_SOURCE, tx);
}

/** SY-D2: dokuma standart maliyet yöntemi — tanınmayan değer varsayılana (`TEZGAH_SAATI`, bugünkü motor) düşer. */
export function readCostWeavingStandardMethod(tx?: Pick<typeof prisma, "systemSetting">): Promise<WeavingStandardMethod> {
  return readServiceEnum(SETTING_KEYS.COST_WEAVING_STANDARD_METHOD, WEAVING_STANDARD_METHODS, DEFAULT_WEAVING_STANDARD_METHOD, tx);
}

/** SY-M1: siparişten üretim önerisi — tanınmayan değer varsayılana (`KAPALI`, bugünkü davranış) düşer. */
export function readOrderProductionProposal(tx?: Pick<typeof prisma, "systemSetting">): Promise<OrderProductionProposalMode> {
  return readServiceEnum(SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL, ORDER_PRODUCTION_PROPOSAL_MODES, DEFAULT_ORDER_PRODUCTION_PROPOSAL, tx);
}

/** D4-G2b: kârlılık makine süresi — tanınmayan değer varsayılana (`OTURUM`) düşer. */
export function readCostProfitMachineTime(tx?: Pick<typeof prisma, "systemSetting">): Promise<ProfitMachineTimeMode> {
  return readServiceEnum(SETTING_KEYS.COST_PROFIT_MACHINE_TIME, PROFIT_MACHINE_TIME_MODES, DEFAULT_PROFIT_MACHINE_TIME_MODE, tx);
}

/** D4-G2b: genel gider dağıtım anahtarı — tanınmayan değer varsayılana (`YOK`) düşer. */
export function readCostProfitOverheadKey(tx?: Pick<typeof prisma, "systemSetting">): Promise<ProfitOverheadKey> {
  return readServiceEnum(SETTING_KEYS.COST_PROFIT_OVERHEAD_KEY, PROFIT_OVERHEAD_KEYS, DEFAULT_PROFIT_OVERHEAD_KEY, tx);
}

/**
 * D4-G2b: kategori → sınıf haritasının TEK süzgeci (yazım ve okuma). Anahtar `trim`lenir (kategori anahtarı
 * `cashCategoryKey` gibi); boş anahtar, tanınmayan sınıf, tavan aşımı → null (yazımda 400, okumada `{}`).
 */
export function sanitizeProfitCategoryClasses(raw: unknown): ProfitCategoryClassMap | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > PROFIT_CATEGORY_CLASS_MAX_ENTRIES) return null;
  const out: ProfitCategoryClassMap = {};
  for (const [k, v] of entries) {
    const key = k.trim();
    if (!key || key.length > PROFIT_CATEGORY_CLASS_MAX_KEY) return null;
    if (typeof v !== "string" || !PROFIT_CATEGORY_CLASSES.includes(v as ProfitCategoryClass)) return null;
    out[key] = v as ProfitCategoryClass;
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]!]));
}

/** D4-G2b: kategori sınıfı haritası — bozuk kayıt `{}`e düşer (her kategori genel gider = bugünkü davranış). */
export async function readCostProfitCategoryClasses(tx?: Pick<typeof prisma, "systemSetting">): Promise<ProfitCategoryClassMap> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.COST_PROFIT_CATEGORY_CLASSES }, select: { value: true } });
  return sanitizeProfitCategoryClasses(setting?.value ?? {}) ?? {};
}

/** D4-I1a: koyan kişi kendi kilidini açabilir mi — tanınmayan değer varsayılana (`ALLOW`) düşer. */
export function readFinanceCariHoldReleaseBySamePerson(tx?: Pick<typeof prisma, "systemSetting">): Promise<CariHoldReleaseBySamePerson> {
  return readServiceEnum(SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON, CARI_HOLD_RELEASE_BY_SAME_PERSON_MODES, DEFAULT_CARI_HOLD_RELEASE_BY_SAME_PERSON, tx);
}

/** D4-I1c: kilitli caride emanet sevki — tanınmayan değer varsayılana (`EXEMPT`, bugünkü) düşer. Kapı okuması `emanet-shipment.helper`dedir. */
export function readFinanceCariHoldEmanetShipment(tx?: Pick<typeof prisma, "systemSetting">): Promise<CariHoldEmanetShipment> {
  return readServiceEnum(SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT, CARI_HOLD_EMANET_SHIPMENT_MODES, DEFAULT_CARI_HOLD_EMANET_SHIPMENT, tx);
}

/**
 * D4-I4: aynı ayarın liste sorgusuna gömülen SQL kolonu (ek sorgu açmamak için) — ham metin döner; tanınmayan/eksik
 * değer okuyucuda olduğu gibi `EXEMPT` sayılır (`cari-hold.helper` `listHoldView`).
 */
export function cariHoldEmanetShipmentColumnSql(): Prisma.Sql {
  return Prisma.sql`(SELECT ss.value #>> '{}' FROM system_settings ss WHERE ss.key = ${SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT})`;
}

/** D4-I2b: risk limiti para birimi kipi — tanınmayan değer varsayılana (`PER_CURRENCY`) düşer; guard tx içinde taze okur. */
export function readFinanceRiskLimitCurrencyMode(tx?: Pick<typeof prisma, "systemSetting">): Promise<RiskLimitCurrencyMode> {
  return readServiceEnum(SETTING_KEYS.FINANCE_RISK_LIMIT_CURRENCY_MODE, RISK_LIMIT_CURRENCY_MODES, DEFAULT_RISK_LIMIT_CURRENCY_MODE, tx);
}

/** H7 — hizmet faturası ana anahtarı, ETKİN değer: ön muhasebe kapalıyken daima KAPALI (bugünkü davranış). */
export async function resolveServiceBillingEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readFinanceEnabled(tx))) return false;
  return readFinanceServiceBillingEnabled(tx);
}

/** D4-I2 — risk limiti iş kabulü kapısı: ön muhasebe ∧ ayar (panel satırı modül kapalıyken gizli; gizli ayar kapı açmaz — reçete §15). */
export async function resolveRiskLimitBlockIntake(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readFinanceEnabled(tx))) return false;
  return readFinanceRiskLimitBlockIntake(tx);
}

/** D4-I2 — risk limiti sevk kapısı: ön muhasebe ∧ ayar. */
export async function resolveRiskLimitBlockShipment(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readFinanceEnabled(tx))) return false;
  return readFinanceRiskLimitBlockShipment(tx);
}

/** H7 — hizmet faturası ayarları TEK okuma noktası (etkin ana anahtar + alt ayarlar). */
export async function loadServiceBillingSettings(tx?: Pick<typeof prisma, "systemSetting">): Promise<{
  enabled: boolean;
  meterBasis: ServiceBillingMeterBasis;
  missingMeter: ServiceBillingMissingMeter;
  brodeUnit: ServiceBillingBrodeUnit;
  /** Fason F3: adım işi kaynağı (`STEP`) açık mı. */
  stepWorks: boolean;
  trigger: ServiceBillingTrigger;
  priceDate: ServiceBillingPriceDate;
  gramPriceBasis: KursunGramPriceBasis;
}> {
  return {
    enabled: await resolveServiceBillingEnabled(tx),
    meterBasis: await readFinanceServiceBillingMeterBasis(tx),
    missingMeter: await readFinanceServiceBillingMissingMeter(tx),
    brodeUnit: await readFinanceServiceBillingBrodeUnit(tx),
    stepWorks: await readFinanceServiceBillingStepWorks(tx),
    trigger: await readFinanceServiceBillingTrigger(tx),
    priceDate: await readFinanceServiceBillingPriceDate(tx),
    gramPriceBasis: await readFinanceKursunGramPriceBasis(tx),
  };
}

/** Tahsilat/ödemede en eski açık faturalara otomatik FIFO kapama? Default false. */
export async function readFinanceAutoAllocateOnPaymentEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_AUTO_ALLOCATE_ON_PAYMENT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** İplik çıkışında eksi bakiye engeli açık mı? Default false. */
export async function readYarnBlockNegativeBalanceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.YARN_BLOCK_NEGATIVE_BALANCE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Siparişe bağlı mal kabulde fazla kabul engeli açık mı? Default false. */
export async function readPurchaseBlockOverReceiptEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PURCHASE_BLOCK_OVER_RECEIPT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Mal kabul satırında birim fiyat zorunlu mu? Default false. */
/** İplik lotu kalite bekletme. Default FALSE (satır yoksa lot RELEASED doğar, kapı koşmaz — bugünkü davranış). HAM değer. */
export async function readGoodsReceiptYarnQualityHoldEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.GOODS_RECEIPT_YARN_QUALITY_HOLD_ENABLED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** İptalde sebep zorunlu. Default FALSE (satır yoksa sebep opsiyonel — bugünkü davranış, ölçüldü). HAM değer. */
export async function readProductionCancelReasonRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.PRODUCTION_CANCEL_REASON_REQUIRED }, select: { value: true } });
  return asBoolean(setting?.value);
}

export async function readConsumableStockEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.CONSUMABLE_STOCK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Sarf stoğu ETKİN mi (`ticaret && bayrak`) — mal kabul sarf satırı ve tüketim düşümü bunu okur. */
export async function resolveConsumableStockEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readTicaretEnabled(tx))) return false;
  return readConsumableStockEnabled(tx);
}

export async function readGoodsReceiptRequirePriceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GOODS_RECEIPT_REQUIRE_PRICE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Sıfır fiyatlı fatura satırıyla onaya izin var mı? Default false. */
export async function readFinanceAllowZeroPriceLineEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_ALLOW_ZERO_PRICE_LINE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** İleri tarihli mali belge engeli açık mı? Default false (çek tarihleri MUAF). */
export async function readFinanceFutureDatedDocumentBlockEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_FUTURE_DATED_DOCUMENT_BLOCK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Satış faturası onayında iplik stoktan düşülsün mü? Default false. */
export async function readFinanceYarnOutOnInvoiceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_YARN_OUT_ON_INVOICE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}
