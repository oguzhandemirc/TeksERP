// =============================================================================
// TeksERP - System Setting / shipping
// =============================================================================
// Sevkiyat okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { DEFAULT_PHASE_OUT_LINE_QTY, DEFAULT_PHASE_OUT_NEW_ORDER, DEFAULT_PHASE_OUT_NEW_PLAN_ENABLED, PHASE_OUT_LINE_QTY_VALUES, PHASE_OUT_NEW_ORDER_VALUES, type PhaseOutLineQty, type PhaseOutNewOrder } from "../helpers/item-lifecycle-settings.helper";
import { notifyUnitNeedsIncomingDoc } from "../../constants/ready-work-units";
import { resetNotificationBaseline } from "../helpers/notification-baseline.helper";
import { READY_WORK_KIND } from "../../constants/notification-catalog-sevkiyat";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_SHIPMENT_ORDER_REQUIREMENT, DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_CM, DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED, DEFAULT_SHIPPING_ALLOW_OVER_ALLOCATION, DEFAULT_SHIPPING_DOC_CEKI_NAME_MODE, DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE, DEFAULT_SHIPPING_DOC_PRODUCT_COLOR_SPLIT, DEFAULT_SHIPPING_INVOICE_MODE, DEFAULT_SHIPPING_ORDER_COVERAGE, DEFAULT_SHIP_READY_RULE, DEFAULT_SHIP_READY_SCAN_MINUTES, DEFAULT_SHIP_READY_TOLERANCE_PCT, SHIPMENT_ORDER_REQUIREMENTS, SHIPPING_ALLOC_WIDTH_TOLERANCE_MAX_CM, SHIPPING_DOC_CEKI_NAME_MODES, SHIPPING_DOC_ITEM_NAME_MODES, SHIPPING_INVOICE_MODES, SHIPPING_ORDER_COVERAGES, SHIP_READY_NOTIFY_UNITS, SHIP_READY_RULES, SHIP_READY_SCAN_MINUTES_MAX, SHIP_READY_SCAN_MINUTES_MIN, SHIP_READY_TOLERANCE_MAX_PCT, type ShipReadyNotifyUnit, type ShipReadyRule, type ShipmentOrderRequirement, type ShippingDocCekiNameMode, type ShippingDocItemNameMode, type ShippingInvoiceMode, type ShippingOrderCoverage } from "./defaults";
import { effectiveIncomingDocsEnabled } from "./incoming-docs";
import { SETTING_KEYS } from "./keys";


/**
 * Sevk için ayrı onay adımı zorunlu mu? Default false (KAPALI). Kapalıyken çuvalları seç →
 * Sevk Et → createShipment DOĞRUDAN dispatch eder (DISPATCHED). Açıkken createShipment PLANNED
 * kurar; çıkış ayrıca "Sevk Kapısı"ndan dispatchShipment ile onaylanır. Kapı önü adımı YOK.
 */
/**
 * Sevkiyatta "araca yüklenen gerçek çuval adedi" elle girilebilsin mi?
 * Default false (KAPALI) — alan hiç sorulmaz, belgede çıkmaz.
 *
 * Neden bayrak: sahada 10 çuval gönderilip hepsi tek çuval kaydına yazılıyor;
 * bu her fabrikanın çalışma biçimi değil. Kapalıyken bugünkü davranış BİREBİR
 * korunur (belge çıktısı bayt-bayt aynı).
 */
export async function readShipmentManualSackCountEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPMENT_MANUAL_SACK_COUNT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** `shipping.looseLoadEnabled` — çuvalsız sevk (dökme/araba). Kayıt yok = false (bugünkü davranış). */
export async function readShipmentLooseLoadEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export async function readShipmentConfirmationEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Sevk geri alma (storno) yalnız AYNI GÜN mü yapılabilsin? Default FALSE (sınır yok).
 *
 * "Aynı gün" TAKVİM günüdür ve saat dilimine bağlıdır → `factoryDayStart()` ile
 * çözülür (fabrika günü tek kaynağı; gece vardiyasında 01:00'de yapılan sevk hâlâ
 * "dün akşam"ın işidir ve UTC gününe göre kesilseydi sessizce geri alınamaz olurdu).
 *
 * Bu ayar yalnız EK bir daraltmadır: faturasız + iadesiz koşulları ayardan bağımsız
 * her zaman koşar. UNCACHED (enforcement yolu).
 */
export async function readShipmentUndoSameDayOnly(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPMENT_UNDO_SAME_DAY_ONLY },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

// ---------------------------------------------------------------------------
// SEVKİYAT DAVRANIŞ BAYRAKLARI — OKUYUCULAR (Dilim 2, 2026-09-03)
// ---------------------------------------------------------------------------
// ⚠️ DÖRDÜ DE ENFORCEMENT OKUYUCUSUDUR ("yalnız UI rehberi" DEĞİL) — bu yüzden
// enforcement yolunda ARGÜMANSIZ (önbelleksiz) çağrılırlar. `getFeatureFlags`in
// 30 sn'lik önbelleği yalnız PANEL YANITINA aittir; bayrak aynı zamanda acil
// geri dönüş anahtarıdır ve kapatıldığı an geçerli olmalıdır.
//
// ⚠️ DÖRDÜ DE EBEVEYNSİZDİR — Sevkiyat & Depo tasarım §2'de ÇEKİRDEK bloktur,
// arkasında modül anahtarı YOKTUR. §3.6'nın "etkin değer = modülAçık && bayrak"
// tek-resolver kuralı buraya UYGULANMAZ; mekanik uygulayan biri ölü bir
// `modulAcik` sabiti icat eder ve sonraki okuyucu "hangi modül?" diye arar.
// Düz okuyucu BİLİNÇLİ.

/**
 * Sevkiyat siparişe bağlanmalı mı? Default `warn` = BUGÜNKÜ davranış.
 *
 * Satır YOKSA **veya değer kümede DEĞİLSE** varsayılana düşer — ikincisi kod
 * sigortasıdır: DB'ye elle yazılmış bir çöp değer ("blok", "BLOCK", true)
 * sahayı sessizce kilitleyemez.
 */
export async function readShippingOrderRequirement(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<ShipmentOrderRequirement> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && SHIPMENT_ORDER_REQUIREMENTS.includes(v as ShipmentOrderRequirement)) {
    return v as ShipmentOrderRequirement;
  }
  return DEFAULT_SHIPMENT_ORDER_REQUIREMENT;
}

/** "Tükenene kadar" karta yeni sipariş. Kayıt yok / kümede değil → OKUTULAN_TOPLAR (kod sigortası). */
export async function readItemPhaseOutNewOrder(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PhaseOutNewOrder> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && PHASE_OUT_NEW_ORDER_VALUES.includes(v as PhaseOutNewOrder)
    ? (v as PhaseOutNewOrder)
    : DEFAULT_PHASE_OUT_NEW_ORDER;
}

/** "Tükenene kadar" kartın açık satırında miktar. Kayıt yok / kümede değil → SERBEST_UYARILI. */
export async function readItemPhaseOutLineQty(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PhaseOutLineQty> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && PHASE_OUT_LINE_QTY_VALUES.includes(v as PhaseOutLineQty)
    ? (v as PhaseOutLineQty)
    : DEFAULT_PHASE_OUT_LINE_QTY;
}

/** "Tükenene kadar" karta yeni üretim planı. Kayıt yok → true (kullanıcının seçtiği varsayılan). */
export async function readItemPhaseOutNewPlan(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_PLAN },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PHASE_OUT_NEW_PLAN_ENABLED;
  return asBoolean(setting.value);
}

/**
 * Sevk öncesi TÜM çuvallar tartılmalı mı? Default FALSE = bugünkü davranış
 * (yalnız `destination = EXPORT` tartı ister).
 */
export async function readShippingWeighRequiredEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Elle tartı (MANUAL) yetkiye bağlansın mı? Default FALSE = bugünkü davranış
 * (mobil ekran izniyle gelen operatör de elle kg girebilir).
 */
export async function readShippingManualWeightRestrictedEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Fatura izi rejimi. Default `dis` = BUGÜNKÜ davranış (elle işaret serbest).
 * Çöp değer → varsayılan (yukarıdaki kod sigortası gerekçesi birebir).
 */
export async function readShippingInvoiceMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<ShippingInvoiceMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_INVOICE_MODE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && SHIPPING_INVOICE_MODES.includes(v as ShippingInvoiceMode)) {
    return v as ShippingInvoiceMode;
  }
  return DEFAULT_SHIPPING_INVOICE_MODE;
}

/**
 * Sevk belgesinde ürün adı hangi dilden basılır? Default `bizdeki` = BUGÜNKÜ çıktı.
 *
 * Satır YOKSA **veya değer kümede DEĞİLSE** varsayılana düşer — elle SQL / eski
 * dump / yarım migration bir gün "MUSTERIDEKI" yazarsa müşteri irsaliyesinin
 * kolon düzeni sessizce değişmesin (kod sigortası; §16 çöp-değer sondası ölçer).
 */
export async function readShippingDocItemNameMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<ShippingDocItemNameMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE },
    select: { value: true },
  });
  const v = setting?.value;
  if (
    typeof v === "string" &&
    SHIPPING_DOC_ITEM_NAME_MODES.includes(v as ShippingDocItemNameMode)
  ) {
    return v as ShippingDocItemNameMode;
  }
  return DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE;
}

/**
 * Çeki bölümünün ad rejimi. Satır YOKSA veya değer kümede DEĞİLSE `devral`e düşer —
 * yani genel rejim ne diyorsa o. Kod sigortası: elle SQL / eski dump bir gün çöp
 * yazarsa çeki bölümü sessizce değişmesin.
 */
export async function readShippingDocCekiNameMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<ShippingDocCekiNameMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE },
    select: { value: true },
  });
  const v = setting?.value;
  if (
    typeof v === "string" &&
    SHIPPING_DOC_CEKI_NAME_MODES.includes(v as ShippingDocCekiNameMode)
  ) {
    return v as ShippingDocCekiNameMode;
  }
  return DEFAULT_SHIPPING_DOC_CEKI_NAME_MODE;
}

/** Kapsama rejimi. Satır yoksa / değer kümede değilse `off` (bugünkü davranış). */
export async function readShippingOrderCoverage(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<ShippingOrderCoverage> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_ORDER_COVERAGE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && SHIPPING_ORDER_COVERAGES.includes(v as ShippingOrderCoverage)) {
    return v as ShippingOrderCoverage;
  }
  return DEFAULT_SHIPPING_ORDER_COVERAGE;
}

/** Ürün listesinde müşteri rengi ayrı sütun mu. Satır yoksa `false` (bugünkü çıktı). */
export async function readShippingDocProductColorSplit(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_DOC_PRODUCT_COLOR_SPLIT },
    select: { value: true },
  });
  return typeof setting?.value === "boolean"
    ? setting.value
    : DEFAULT_SHIPPING_DOC_PRODUCT_COLOR_SPLIT;
}

/** EN toleransı açık mı. Satır yoksa `false` (tam eşitlik = bugünkü davranış). */
export async function readShippingAllocWidthToleranceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED },
    select: { value: true },
  });
  return typeof setting?.value === "boolean"
    ? setting.value
    : DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED;
}

/**
 * Tolerans değeri (cm). Kapalıysa ya da değer geçersizse **0** döner — yani
 * çağıran ayrıca bayrağı sormak zorunda kalmaz ve unutulamaz.
 */
export async function readShippingAllocWidthToleranceCm(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  if (!(await readShippingAllocWidthToleranceEnabled(tx))) return 0;
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_ALLOC_WIDTH_TOLERANCE_CM },
    select: { value: true },
  });
  const parsed = asNumber(setting?.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_CM;
  }
  return Math.min(parsed, SHIPPING_ALLOC_WIDTH_TOLERANCE_MAX_CM);
}

/** Sevke hazırlık kuralı. Kayıt yok/çöp → ALL_DONE. Tüketici doğrudan çağırmaz: `effectiveShipReadyPolicy`. */
export async function readShippingReadyRule(tx?: Pick<typeof prisma, "systemSetting">): Promise<ShipReadyRule> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_READY_RULE }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && SHIP_READY_RULES.includes(v as ShipReadyRule) ? (v as ShipReadyRule) : DEFAULT_SHIP_READY_RULE;
}

/** METER_THRESHOLD toleransı (%). Kayıt yok/çöp/aralık dışı → 2; `0` geçerli. */
export async function readShippingReadyTolerancePct(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT }, select: { value: true } });
  if (!setting) return DEFAULT_SHIP_READY_TOLERANCE_PCT;
  const parsed = asNumber(setting.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > SHIP_READY_TOLERANCE_MAX_PCT) return DEFAULT_SHIP_READY_TOLERANCE_PCT;
  return parsed;
}

/** D4-KUC3a: gelen belge modülü kapalıdan açığa geçti ve GB/PARTI bildirimi açıksa sevke-hazır taban damgası düşer →
 *  sonraki tur SESSİZ taban (kapalıyken biriken hazır partiler toplu ACILDI üretmez; birim ekleme yazımıyla aynı kural). */
export async function resetReadyBaselineOnIncomingDocOpen(): Promise<boolean> {
  if (!(await effectiveIncomingDocsEnabled())) return false;
  if (!(await readShippingReadyNotifyUnits()).some(notifyUnitNeedsIncomingDoc)) return false;
  await resetNotificationBaseline(prisma, READY_WORK_KIND);
  return true;
}

/** Sevke hazır bildirim birimleri. Kayıt yok/çöp → [] (bildirim kapalı); tanınmayan eleman düşer. */
export async function readShippingReadyNotifyUnits(tx?: Pick<typeof prisma, "systemSetting">): Promise<ShipReadyNotifyUnit[]> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_READY_NOTIFY_UNITS }, select: { value: true } });
  const v = setting?.value;
  if (!Array.isArray(v)) return [];
  return SHIP_READY_NOTIFY_UNITS.filter((u) => v.includes(u));
}

/** Sevke hazır tarama periyodu (dk). Kayıt yok/çöp/aralık dışı → 5. */
export async function readShippingReadyScanMinutes(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_READY_SCAN_MINUTES }, select: { value: true } });
  const parsed = asNumber(setting?.value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < SHIP_READY_SCAN_MINUTES_MIN || parsed > SHIP_READY_SCAN_MINUTES_MAX) return DEFAULT_SHIP_READY_SCAN_MINUTES;
  return parsed;
}

/** Fazla sevk deftere yazılsın mı. Satır yoksa `false` (bugünkü davranış). */
export async function readShippingAllowOverAllocation(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_ALLOW_OVER_ALLOCATION },
    select: { value: true },
  });
  return typeof setting?.value === "boolean"
    ? setting.value
    : DEFAULT_SHIPPING_ALLOW_OVER_ALLOCATION;
}
