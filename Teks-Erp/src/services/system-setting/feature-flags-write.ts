// =============================================================================
// TeksERP - System Setting / feature-flags-write
// =============================================================================
// setFeatureFlags yazma dalları + yazma öncesi doğrulayıcılar.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import { AppError } from "../../utils/app-error";
import { alarmEnableBlocked } from "../helpers/loom-floor.helper";
import { isShiftDefined } from "../helpers/loom-alarm-shift.helper";
import prisma from "../../lib/prisma";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import { settingScreenPath } from "../../constants/panel-ayar-yolu";
import { MODULE_DEPENDENCIES, MODULE_LABELS } from "../../constants/module-flags";
import { licenseModuleError } from "../../lib/license/module-ceiling";
import { ApiResponse } from "../../types/api.types";
import { TERIM } from "../../constants/terim";
import { FINISHING_KG_BASES, type FinishingKgBasis } from "../helpers/fabric-cost-kg.helper";
import { REPORT_BY_KEY } from "../../constants/report-catalog";
import { updateSeriesNumberSource } from "../helpers/series-write.helper";
import { isHostedInstallation } from "../helpers/install-class.helper";
import { PHASE_OUT_LINE_QTY_VALUES, PHASE_OUT_NEW_ORDER_VALUES, phaseOutExitWarning, type PhaseOutLineQty, type PhaseOutNewOrder } from "../helpers/item-lifecycle-settings.helper";
import { uyari } from "../../lib/logger";
import { resetNotificationBaseline, resetNotificationBaselines } from "../helpers/notification-baseline.helper";
import { READY_WORK_KIND } from "../../constants/notification-catalog-sevkiyat";
import { DEFAULT_COMPANY_NAME } from "../../constants/company";
import { Prisma } from "@prisma/client";
import { sanitizeCompanyLegalIdentity, validateEIrsaliyeConfigInput } from "../e-irsaliye/e-irsaliye-settings";
import { TAMBUR_PLAN_WIDTH_TOLERANCE_CM } from "../../constants/tambur-plan-gate";
import { DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT, DUPLICATES_FUZZY_MIN_PCT } from "../../constants/duplicate-rules";
import { sanitizeProfitCategoryClasses } from "./cost-purchase";
import { CARI_HOLD_DEFAULT_SCOPES, CARI_HOLD_EMANET_SHIPMENT_MODES, CARI_HOLD_RELEASE_BY_SAME_PERSON_MODES, COST_PRESENTATION_CURRENCIES, DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_CM, DEFAULT_SHIPPING_SACK_SEQ_START, DEFAULT_SHIP_READY_TOLERANCE_PCT, DEFAULT_TEZGAH_ALARM_RENOTIFY_MINUTES, DEFAULT_TEZGAH_COLLECTOR_SILENCE_MINUTES, DEFAULT_TEZGAH_ESCALATION_GRACE_MINUTES, DEFAULT_TEZGAH_MAX_OPEN_STOP_HOURS, DOKUMA_ROLL_BIRTH_MODES, EXPENSE_ALLOCATION_CLOSED_WORK_ORDER_MODES, EXPENSE_ALLOCATION_FIELD_MODES, EXPENSE_CATEGORY_SUGGESTION_MODES, KURSUN_GRAM_PRICE_BASES, KURSUN_MACHINE_ASSIGN_MODES, KURSUN_METER_CAPTURE_MODES, KURSUN_METER_OFFICE_APPROVAL_SELECTABLE, KURSUN_METER_STOCK_MODES, KURSUN_METER_VARIANCE_APPROVALS, KURSUN_METER_VARIANCE_BASES, LABEL_COPIES_SOURCES, LABEL_CUSTOMER_CODE_AT_MODES, LABEL_CUSTOMER_CODE_MISSING_MODES, LOGIN_METHODS, MAX_ABSOLUTE_SESSION_CAP_DAYS, MAX_BACKUP_HOUR, MAX_FINANCE_VAT_RATE, MAX_IDLE_TIMEOUT_MINUTES, MAX_MOBILE_IDLE_LOCK_MINUTES, MAX_PIN_LOCKOUT_ATTEMPTS, MAX_PIN_LOCKOUT_ESCALATE_AFTER, MAX_PIN_LOCKOUT_LONG_PENALTY_MIN, MAX_PIN_LOCKOUT_PENALTY_SEC, MAX_SESSION_DURATION_HOURS, MAX_SESSION_DURATION_MINUTES, MAX_TRUSTED_DEVICE_DAYS, MAX_WORK_SESSION_IDLE_MINUTES, MIN_BACKUP_HOUR, MIN_FINANCE_VAT_RATE, MIN_MOBILE_IDLE_LOCK_MINUTES, MIN_PIN_LOCKOUT_ATTEMPTS, MIN_PIN_LOCKOUT_ESCALATE_AFTER, MIN_PIN_LOCKOUT_LONG_PENALTY_MIN, MIN_PIN_LOCKOUT_PENALTY_SEC, ORDER_PRODUCTION_PROPOSAL_MODES, PACKAGE_NO_MODES, PACKAGE_NUMBERINGS, PACKING_GROUP_MODES, PACKING_GROUP_NUMBERINGS, PACKING_POOL_PACKAGE_NO_MODES, PIN_LOCKOUT_REQUIRED_MESSAGE, PRODUCTION_ROUTE_MODES, PRODUCTION_SCAN_ROUTE_STATIONS_VALUES, PROFIT_CATEGORY_CLASSES, PROFIT_CATEGORY_CLASS_MAX_ENTRIES, PROFIT_CONSUMABLE_PRICE_SOURCES, PROFIT_MACHINE_TIME_MODES, PROFIT_OVERHEAD_KEYS, PROFIT_SUBCONTRACT_SOURCES, RISK_LIMIT_CURRENCY_MODES, SACK_DUMP_NAME_MODES, SAME_TYPE_SESSION_POLICIES, SERVICE_BILLING_BRODE_UNITS, SERVICE_BILLING_METER_BASES, SERVICE_BILLING_MISSING_METER_MODES, SERVICE_BILLING_PRICE_DATES, SERVICE_BILLING_TRIGGERS, SHIPMENT_ORDER_REQUIREMENTS, SHIPPING_ALLOC_WIDTH_TOLERANCE_MAX_CM, SHIPPING_DOC_CEKI_NAME_MODES, SHIPPING_DOC_ITEM_NAME_MODES, SHIPPING_INVOICE_MODES, SHIPPING_ORDER_COVERAGES, SHIPPING_RETURN_FOOTNOTE_MAX, SHIPPING_SACK_SEQ_PREFIX_MAX, SHIPPING_SACK_SEQ_PREFIX_WRITE_RE, SHIPPING_SACK_SEQ_START_MAX, SHIP_READY_NOTIFY_UNITS, SHIP_READY_RULES, SHIP_READY_SCAN_MINUTES_MAX, SHIP_READY_SCAN_MINUTES_MIN, SHIP_READY_TOLERANCE_MAX_PCT, TAMBUR_CALIBRATION_CHECK_MODES, TAMBUR_CHILD_WIDTH_SOURCES, TAMBUR_LABEL_PRINT_TIMINGS, TAMBUR_PLAN_WIDTH_CHECKS, TAMBUR_PLAN_WIDTH_TOLERANCE_MAX_CM, TEZGAH_ALARM_NO_SHIFT_MODES, TEZGAH_ALARM_RENOTIFY_MINUTES_MAX, TEZGAH_ALARM_UNCLASSIFIED_TARGET_MAX, TEZGAH_COLLECTOR_SILENCE_MINUTES_MAX, TEZGAH_ESCALATION_GRACE_MINUTES_MAX, TEZGAH_MAX_OPEN_STOP_HOURS_MAX, UNSET_ABSOLUTE_SESSION_CAP_DAYS, WEAVING_STANDARD_METHODS, WEB_TOTP_POLICIES, sanitizeReturnFootnote, sanitizeSackSeqPrefix, type CariHoldDefaultScope, type CariHoldEmanetShipment, type CariHoldReleaseBySamePerson, type CostPresentationCurrency, type DokumaRollBirth, type ExpenseAllocationClosedWorkOrder, type ExpenseAllocationField, type ExpenseCategorySuggestions, type KursunGramPriceBasis, type KursunMachineAssignMode, type KursunMeterCapture, type KursunMeterStockMode, type KursunMeterVarianceApproval, type KursunMeterVarianceBasis, type LabelCopiesSource, type LabelCustomerCodeAt, type LabelCustomerCodeMissing, type OrderProductionProposalMode, type PackageNoMode, type PackageNumbering, type PackingGroupMode, type PackingGroupNumbering, type PackingPoolPackageNo, type ProductionRouteMode, type ProductionScanRouteStations, type ProfitConsumablePriceSource, type ProfitMachineTimeMode, type ProfitOverheadKey, type ProfitSubcontractSource, type RiskLimitCurrencyMode, type SackDumpNameMode, type SameTypeSessionPolicy, type ServiceBillingBrodeUnit, type ServiceBillingMeterBasis, type ServiceBillingMissingMeter, type ServiceBillingPriceDate, type ServiceBillingTrigger, type ShipReadyNotifyUnit, type ShipReadyRule, type ShipmentOrderRequirement, type ShippingDocCekiNameMode, type ShippingDocItemNameMode, type ShippingInvoiceMode, type ShippingOrderCoverage, type TamburCalibrationCheck, type TamburChildWidthSource, type TamburLabelPrintTiming, type TamburPlanWidthCheck, type TezgahAlarmNoShiftMode, type WeavingStandardMethod, type WebTotpPolicy } from "./defaults";
import { readStoredShortCredentialApprovedDeviceOnly } from "./device-auth";
import { sanitizeDocumentsConfig, type CompanyLetterhead } from "./documents";
import { MODULE_SETTING_KEY_BY_FLAG, type FeatureFlags } from "./feature-flags-types";
import { DEFAULT_INVOICE_TOLERANCE_PCT, assertBrodeUnitHasPieceInput, readFinanceEnabledRaw, readFinanceServiceBillingBrodeUnit } from "./finance";
import { effectiveIncomingDocsEnabled } from "./incoming-docs";
import { SETTING_KEYS } from "./keys";
import { readKursunMeterCapture } from "./kursun-batch";
import { LABEL_COPIES_MAX, readNotificationInboxEnabled, type DefaultLabelMedia } from "./labels";
import { readDepoMultiEnabledRaw, readDevereEnabledRaw, readDokumaEnabledRaw, readEmanetEnabledRaw, readGelenBelgeEnabledRaw, readIplikEnabledRaw, readKaliteGuvenceEnabledRaw, readKumasTeknikEnabledRaw, readMaliyetEnabledRaw, readProductionEnabledRaw, readTezgahEnabledRaw, readTicaretEnabledRaw } from "./modules";
import { readTezgahAlarmEnabled, readTezgahAlarmNoShiftMode, readTezgahAlarmUnclassifiedTargetMinutes } from "./packing-loom";
import { readPartyCodeAuto } from "./production";
import { readItemPhaseOutNewOrder, readShippingOrderRequirement, readShippingReadyNotifyUnits, resetReadyBaselineOnIncomingDocOpen } from "./shipping";
import { DEFAULT_FASON_SHRINK_TOLERANCE_PCT } from "./tambur-fason";
import { normalizeTravelerCardConfig } from "./traveler-card";
import type { SystemSettingService } from "../system-setting.service";

/** Cephe sınıfının `this`i — taşınan metotlar `this.set`/özel doğrulayıcıları sınıf üzerinden çağırır (alay/izleme aynen kalır). */
export type SystemSettingServiceThis = Pick<SystemSettingService, "set" | "getFeatureFlags"> & {
  effectiveModuleValue: SystemSettingService["effectiveModuleValue"];
  assertModuleDependencies: SystemSettingService["assertModuleDependencies"];
  assertModuleWritesLicensed: SystemSettingService["assertModuleWritesLicensed"];
  assertTezgahAlarmShiftRequirement: SystemSettingService["assertTezgahAlarmShiftRequirement"];
  assertTezgahAlarmUnclassifiedRequirement: SystemSettingService["assertTezgahAlarmUnclassifiedRequirement"];
  resolveWithholdingWrite: SystemSettingService["resolveWithholdingWrite"];
};



  /**
   * Bir modül anahtarının bu PATCH'ten SONRAKİ etkin değeri.
   *
   * Gövde o anahtarı taşıyorsa gövdedeki değer, taşımıyorsa DB'deki değer
   * kazanır — "kısmi PATCH" sözleşmesinin birebir karşılığı.
   *
   * ⚠️ Gövdedeki değer boolean DEĞİLSE DB'ye düşülür: tip hatasını asıl yazma
   * dalı ("<alan> boolean olmalı") söylemeli. Burada `Boolean("hayır") === true`
   * yapmak, yanlış yazımı bağımlılık hatasıyla maskelerdi.
   * ⚠️ Okuma CACHE'SİZ okuyuculardan: `getFeatureFlags` 30 sn'lik önbelleğinden
   * beslenseydi, aynı saniyede ticareti kapatıp ipliği açan bir çift bayat
   * veriyle doğrulanırdı.
   */
export async function effectiveModuleValue(
    input: Record<string, unknown>,
    key: string,
  ): Promise<boolean> {
    const raw = input[key];
    if (Object.prototype.hasOwnProperty.call(input, key) && typeof raw === "boolean") {
      return raw;
    }
    switch (key) {
      case "ticaretEnabled":
        return readTicaretEnabledRaw();
      case "iplikEnabled":
        return readIplikEnabledRaw();
      case "productionEnabled":
        return readProductionEnabledRaw();
      case "tezgahEnabled":
        return readTezgahEnabledRaw();
      case "devereEnabled":
        return readDevereEnabledRaw();
      case "dokumaEnabled":
        return readDokumaEnabledRaw();
      case "emanetEnabled":
        return readEmanetEnabledRaw();
      case "kaliteGuvenceEnabled":
        return readKaliteGuvenceEnabledRaw();
      case "maliyetEnabled":
        return readMaliyetEnabledRaw();
      case "gelenBelgeEnabled":
        return readGelenBelgeEnabledRaw();
      case "depoMultiEnabled":
        return readDepoMultiEnabledRaw();
      case "kumasTeknikEnabled":
        return readKumasTeknikEnabledRaw();
      case "financeEnabled":
        return readFinanceEnabledRaw();
      default:
        // Bağımlılık haritasına modül olmayan bir anahtar girmiş demektir.
        throw AppError.badRequest(`Bilinmeyen modül anahtarı: ${key}`);
    }
  }


  /**
   * MODÜL BAĞIMLILIKLARI (`constants/module-flags.ts` → `MODULE_DEPENDENCIES`).
   *
   * Kural tek cümle: bağımlı modül AÇIK kalacaksa ön koşulu da AÇIK kalmalı.
   * Bu tek yüklem iki yönü birden kapsar — bağımlıyı açmak da ön koşulu
   * kapatmak da aynı yasak durumu (açık bağımlı + kapalı ön koşul) üretir;
   * mesaj kullanıcının HANGİ hamleyi yaptığına göre yazılır, çünkü "önce
   * ticareti açın" ile "önce ipliği kapatın" farklı ekranlara götürür.
   *
   * ⚠️ TÜM yazmalardan ÖNCE koşar (setFeatureFlags'in ilk ifadesi): dallar tek
   * tx değildir, araya girseydi yarım gövde yazılırdı.
   */
  /**
   * `REQUIRE_SHIFT` kapısı — HER YAZMADAN ÖNCE (yarım gövde yazılmasın). Yalnız GEÇİŞ durdurulur: alarm
   * kapalıdan açığa geçerken ya da açık alarmın kipi REQUIRE_SHIFT'e dönerken vardiya tanımı yoksa 400.
   * Değişmeden gelen değer ve kapatma engellenmez (tanımlar sonradan arşivlenirse yüzeyler uyarır).
   */
export async function assertTezgahAlarmShiftRequirement(input: Record<string, unknown>): Promise<void> {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
    if (!has("tezgahAlarmEnabled") && !has("tezgahAlarmNoShiftMode")) return;
    const curEnabled = await readTezgahAlarmEnabled();
    const curMode = await readTezgahAlarmNoShiftMode();
    const nextEnabled = has("tezgahAlarmEnabled") ? input.tezgahAlarmEnabled === true : curEnabled;
    const m = input.tezgahAlarmNoShiftMode;
    const nextMode = has("tezgahAlarmNoShiftMode") && TEZGAH_ALARM_NO_SHIFT_MODES.includes(m as TezgahAlarmNoShiftMode) ? (m as TezgahAlarmNoShiftMode) : curMode;
    const entering = nextEnabled && nextMode === "REQUIRE_SHIFT" && (!curEnabled || curMode !== "REQUIRE_SHIFT");
    if (!entering || !alarmEnableBlocked(nextMode, await isShiftDefined(prisma))) return;
    throw AppError.badRequest(
      `Vardiya tanımlı değil — "Vardiya olmadan açılamasın" kipinde tezgah alarmı açılamaz. Önce ${ekranYolu("vardiyaTanimlari")}'ndan vardiya tanımlayın ya da kipi değiştirin (${settingScreenPath("tezgah")}).`,
      { code: "TEZGAH_ALARM_SHIFT_REQUIRED" },
    );
  }


  /**
   * Sebepsiz anahtar açıkken süre zorunlu — HER YAZMADAN ÖNCE. Eski istemci yalnız süreyi yollar: anahtar
   * süreden türer (boş = kapalı), bu yüzden eski gövde bu kapıya hiç takılmaz.
   */
export async function assertTezgahAlarmUnclassifiedRequirement(input: Record<string, unknown>): Promise<void> {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
    if (!has("tezgahAlarmUnclassifiedEnabled")) return;
    const v = input.tezgahAlarmUnclassifiedTargetMinutes;
    const nextMinutes = has("tezgahAlarmUnclassifiedTargetMinutes") ? (typeof v === "number" ? v : null) : await readTezgahAlarmUnclassifiedTargetMinutes();
    if (input.tezgahAlarmUnclassifiedEnabled !== true || nextMinutes !== null) return;
    throw AppError.badRequest(
      `Sebepsiz duruşta alarm açıkken hedef süre (dk) boş bırakılamaz (${settingScreenPath("tezgah")}).`,
      { code: "TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED" },
    );
  }


export async function assertModuleDependencies(this: SystemSettingServiceThis, input: Record<string, unknown>): Promise<void> {
    for (const [dependent, prerequisite] of Object.entries(MODULE_DEPENDENCIES)) {
      // Gövde bu çiftin HİÇBİR ucuna dokunmuyorsa ölçmeye gerek yok (iki
      // gereksiz DB okuması) — ve zaten var olan tutarsız bir çifti burada
      // reddetmek, ilgisiz bir ayarı kaydetmeyi imkânsız kılardı.
      const dokunuyor =
        Object.prototype.hasOwnProperty.call(input, dependent) ||
        Object.prototype.hasOwnProperty.call(input, prerequisite);
      if (!dokunuyor) continue;

      const dependentAcik = await this.effectiveModuleValue(input, dependent);
      if (!dependentAcik) continue;
      const prerequisiteAcik = await this.effectiveModuleValue(input, prerequisite);
      if (prerequisiteAcik) continue;

      const bagimliAd = MODULE_LABELS[dependent] ?? dependent;
      const onKosulAd = MODULE_LABELS[prerequisite] ?? prerequisite;
      const bagimliAciliyor =
        Object.prototype.hasOwnProperty.call(input, dependent) && input[dependent] === true;
      throw AppError.badRequest(
        bagimliAciliyor
          ? `${bagimliAd} modülü ${onKosulAd} modülüne bağlıdır — önce ${onKosulAd} modülünü açın`
          : `${bagimliAd} modülü ${onKosulAd} modülüne bağlıdır — önce ${bagimliAd} modülünü kapatın`,
        { code: "MODULE_DEPENDENCY", modul: dependent, bagimliOldugu: prerequisite },
      );
    }
  }


  /**
   * LİSANS YAZMA TAVANI: uygulanan tavanın kapattığı modül AÇILAMAZ (403 `LICENSE_MODULE`);
   * kapatmak serbesttir. Gözlemde tavan yoktur. Doğrulama gibi TÜM yazmalardan önce koşar.
   */
export function assertModuleWritesLicensed(input: Record<string, unknown>): void {
    for (const [flag, settingKey] of Object.entries(MODULE_SETTING_KEY_BY_FLAG)) {
      if (input[flag] !== true) continue;
      const denial = licenseModuleError(settingKey, MODULE_LABELS[flag] ?? flag);
      if (denial) throw denial;
    }
  }


  /**
   * Bir feature flag'i toggle et. Kabul: { pricingEnabled: boolean }.
   * Verilmeyen alanlar dokunulmaz.
   */
export async function setFeatureFlags(
    this: SystemSettingServiceThis,
    // ⚠️ GİRDİ ÇIKTIDAN DAHA GENİŞ: bazı sayısal ayarlarda `null` "alanı temizle"
    // demektir ve panel bunu gönderir, ama okuma tarafı hiçbir zaman null
    // döndürmez (varsayılana çözülür). İkisini tek tiple anlatmak, ya paneli
    // 400'e düşürür ya da API sözleşmesine olmayan bir null sokar.
    input: Omit<
      Partial<FeatureFlags>,
      "fasonShrinkTolerancePct" | "duplicatesFuzzyThresholdPct" | "shippingAllocWidthToleranceCm" | "shippingReadyTolerancePct" | "tamburPlanGateWidthToleranceCm" | "financeInvoiceQtyTolerancePct" | "financeInvoicePriceTolerancePct" | "financeWithholdingNumerator" | "financeWithholdingDenominator" | "financePurchaseWithholdingNumerator" | "financePurchaseWithholdingDenominator" | "shippingSackSeqStart" | "tezgahEscalationGraceMinutes" | "tezgahAlarmRenotifyMinutes" | "tezgahMaxOpenStopHours" | "tezgahCollectorSilenceMinutes" | "license"
    > & {
      /** null = fabrika varsayılanına dön (1). */
      shippingSackSeqStart?: number | null;
      /** null = fabrika varsayılanına dön (0 dk). */
      tezgahEscalationGraceMinutes?: number | null;
      /** null = varsayılana dön (10 dk). */
      tezgahAlarmRenotifyMinutes?: number | null;
      /** null = varsayılana dön (12 sa). */
      tezgahMaxOpenStopHours?: number | null;
      /** null = varsayılana dön (10 dk). */
      tezgahCollectorSilenceMinutes?: number | null;
      financeInvoiceQtyTolerancePct?: number | null;
      financeInvoicePriceTolerancePct?: number | null;
      /** null = girilmemiş (pay 0) / varsayılan payda (10). */
      financeWithholdingNumerator?: number | null;
      financeWithholdingDenominator?: number | null;
      /** F7: null = girilmemiş (pay 0) / varsayılan payda (10). */
      financePurchaseWithholdingNumerator?: number | null;
      financePurchaseWithholdingDenominator?: number | null;
      /** null = fabrika varsayılanına dön (1 cm). */
      shippingAllocWidthToleranceCm?: number | null;
      /** null = fabrika varsayılanına dön (%2); `0` geçerli. */
      shippingReadyTolerancePct?: number | null;
      fasonShrinkTolerancePct?: number | null;
      duplicatesFuzzyThresholdPct?: number | null;
      /** null = fabrika varsayılanına dön (10 cm); `0` geçerli. */
      tamburPlanGateWidthToleranceCm?: number | null;
    },
    userId: string | undefined
  ): Promise<ApiResponse<FeatureFlags>> {
    if (!userId) throw AppError.unauthorized();

    // MODÜL BAĞIMLILIĞI — HER YAZMADAN ÖNCE, TOPLUCA (2026-09-02).
    // ⚠️ Sıra load-bearing: aşağıdaki `this.set` çağrıları TEK TX DEĞİLDİR.
    // Doğrulama dalların arasına serpiştirilseydi "ticaret kapandı, iplik açık
    // kaldı" gibi YARIM bir gövde yazılır ve geri alınamazdı.
    await this.assertModuleDependencies(input as Record<string, unknown>);
    this.assertModuleWritesLicensed(input as Record<string, unknown>);
    await this.assertTezgahAlarmShiftRequirement(input as Record<string, unknown>);
    await this.assertTezgahAlarmUnclassifiedRequirement(input as Record<string, unknown>);
    const writeWithholding = await this.resolveWithholdingWrite(input, userId);
    // D4-KUC3a: gelen belge zinciri (emanet ∧ gelenBelge) yazımdan ÖNCE ölçülür; kapalıdan açığa geçerse aşağıda taban düşer.
    const incomingDocWasOpen = Object.prototype.hasOwnProperty.call(input, "emanetEnabled") || Object.prototype.hasOwnProperty.call(input, "gelenBelgeEnabled")
      ? await effectiveIncomingDocsEnabled()
      : null;

    if (Object.prototype.hasOwnProperty.call(input, "pricingEnabled")) {
      if (typeof input.pricingEnabled !== "boolean") {
        throw AppError.badRequest("pricingEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_PRICING_ENABLED,
        input.pricingEnabled,
        "Sipariş/sevkiyat ekranlarında para birimi + fiyat alanlarını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeEnabled")) {
      if (typeof input.financeEnabled !== "boolean") {
        throw AppError.badRequest("financeEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_ENABLED,
        input.financeEnabled,
        "Ön muhasebe modülü (cari · fatura · tahsilat · kasa/banka)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeBlockNegativeCashEnabled")) {
      if (typeof input.financeBlockNegativeCashEnabled !== "boolean") {
        throw AppError.badRequest("financeBlockNegativeCashEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED,
        input.financeBlockNegativeCashEnabled,
        "Kasa eksi bakiyeye düşemesin (ödeme · masraf · virman · çek ödeme 409; banka ve iptal yolları muaf)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeDefaultVatRate")) {
      const v = input.financeDefaultVatRate;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < MIN_FINANCE_VAT_RATE ||
        v > MAX_FINANCE_VAT_RATE
      ) {
        throw AppError.badRequest(
          `Varsayılan KDV oranı ${MIN_FINANCE_VAT_RATE}–${MAX_FINANCE_VAT_RATE} arasında bir sayı olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.FINANCE_DEFAULT_VAT_RATE,
        v,
        "Fatura satırının varsayılan KDV oranı, % (yalnız ön-dolum; satırda değiştirilebilir)",
        userId
      );
    }
    if (writeWithholding) await writeWithholding();
    if (Object.prototype.hasOwnProperty.call(input, "financeInvoiceMatchTolerance")) {
      if (typeof input.financeInvoiceMatchTolerance !== "boolean") {
        throw AppError.badRequest("financeInvoiceMatchTolerance boolean olmalı");
      }
      await this.set(SETTING_KEYS.FINANCE_INVOICE_MATCH_TOLERANCE, input.financeInvoiceMatchTolerance, "Muhasebe: fatura onayında bağlı mal kabul fişleriyle miktar/tutar toleransı", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeChequeNoteMovementEnabled")) {
      if (typeof input.financeChequeNoteMovementEnabled !== "boolean") {
        throw AppError.badRequest("financeChequeNoteMovementEnabled boolean olmalı");
      }
      await this.set(SETTING_KEYS.FINANCE_CHEQUE_NOTE_MOVEMENT_ENABLED, input.financeChequeNoteMovementEnabled, "Muhasebe: çek teslim bordrosu çeki hareket ettirir (bankaya verme · ciro)", userId);
    }
    // `0` geçerli ("fark kabul edilmez"); `null` = alanı temizledim → fabrika varsayılanı (0).
    if (Object.prototype.hasOwnProperty.call(input, "financeInvoiceQtyTolerancePct")) {
      const v = input.financeInvoiceQtyTolerancePct;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)) {
        throw AppError.badRequest("Fatura ↔ mal kabul miktar toleransı 0 ile 100 arasında olmalı (yüzde)");
      }
      await this.set(SETTING_KEYS.FINANCE_INVOICE_QTY_TOLERANCE_PCT, v === null ? DEFAULT_INVOICE_TOLERANCE_PCT : v, "Fatura ↔ mal kabul miktar toleransı (yüzde)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeInvoicePriceTolerancePct")) {
      const v = input.financeInvoicePriceTolerancePct;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)) {
        throw AppError.badRequest("Fatura ↔ mal kabul tutar toleransı 0 ile 100 arasında olmalı (yüzde)");
      }
      await this.set(SETTING_KEYS.FINANCE_INVOICE_PRICE_TOLERANCE_PCT, v === null ? DEFAULT_INVOICE_TOLERANCE_PCT : v, "Fatura ↔ mal kabul tutar toleransı (yüzde)", userId);
    }

    // -------------------------------------------------------------------------
    // TİCARET/MUHASEBE REJİM ANAHTARLARI (2026-08-14, dalga 1)
    // -------------------------------------------------------------------------
    // Dokuz boolean; hepsi default FALSE ve bugün okuyan servis YOK. Yazma
    // dalları şimdi kurulur ki davranışı bağlayan dalga, ACİL KAPATMA yolu
    // hazır halde başlasın (2026-08-04 kk1 dersi).
    if (Object.prototype.hasOwnProperty.call(input, "financeRiskLimitBlockEnabled")) {
      if (typeof input.financeRiskLimitBlockEnabled !== "boolean") {
        throw AppError.badRequest("financeRiskLimitBlockEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED,
        input.financeRiskLimitBlockEnabled,
        "Risk limiti aşımında satış faturası onayını engelle (alış · taslak · iptal muaf)",
        userId
      );
    }
    // D4-I2: risk limiti iş kabulü / sevk kapıları (bool; tanınmayan değer 400).
    if (Object.prototype.hasOwnProperty.call(input, "financeRiskLimitBlockIntake")) {
      if (typeof input.financeRiskLimitBlockIntake !== "boolean") throw AppError.badRequest("financeRiskLimitBlockIntake boolean olmalı");
      await this.set(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE, input.financeRiskLimitBlockIntake, "Risk limiti aşımında yeni iş kabulünü engelle", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeRiskLimitBlockShipment")) {
      if (typeof input.financeRiskLimitBlockShipment !== "boolean") throw AppError.badRequest("financeRiskLimitBlockShipment boolean olmalı");
      await this.set(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_SHIPMENT, input.financeRiskLimitBlockShipment, "Risk limiti aşımında sevki engelle (tamamı emanet sevk muaf)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeAutoDraftFromShipmentEnabled")) {
      if (typeof input.financeAutoDraftFromShipmentEnabled !== "boolean") {
        throw AppError.badRequest("financeAutoDraftFromShipmentEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED,
        input.financeAutoDraftFromShipmentEnabled,
        "Sevk onayında otomatik satış faturası TASLAĞI oluştur (onay yine elle)",
        userId
      );
    }

    // H7 hizmet faturası — enum ayarlarında tanınmayan değer 400 (fail-closed).
    if (Object.prototype.hasOwnProperty.call(input, "financeServiceBillingEnabled")) {
      if (typeof input.financeServiceBillingEnabled !== "boolean") {
        throw AppError.badRequest("financeServiceBillingEnabled boolean olmalı");
      }
      await this.set(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, input.financeServiceBillingEnabled, "Sevk faturası taslağına hizmet (işçilik) satırları ekle", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeServiceBillingMeterBasis")) {
      const v = input.financeServiceBillingMeterBasis;
      if (typeof v !== "string" || !SERVICE_BILLING_METER_BASES.includes(v as ServiceBillingMeterBasis)) {
        throw AppError.badRequest(`financeServiceBillingMeterBasis şunlardan biri olmalı: ${SERVICE_BILLING_METER_BASES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_SERVICE_BILLING_METER_BASIS, v, "Hizmet faturası metre tabanı — çıkış · giriş · bildirilen", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeServiceBillingMissingMeter")) {
      const v = input.financeServiceBillingMissingMeter;
      if (typeof v !== "string" || !SERVICE_BILLING_MISSING_METER_MODES.includes(v as ServiceBillingMissingMeter)) {
        throw AppError.badRequest(`financeServiceBillingMissingMeter şunlardan biri olmalı: ${SERVICE_BILLING_MISSING_METER_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER, v, "Hizmet faturası ölçüm yoksa — bildirilenle uyar · satırı durdur", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeServiceBillingBrodeUnit")) {
      const v = input.financeServiceBillingBrodeUnit;
      if (typeof v !== "string" || !SERVICE_BILLING_BRODE_UNITS.includes(v as ServiceBillingBrodeUnit)) {
        throw AppError.badRequest(`financeServiceBillingBrodeUnit şunlardan biri olmalı: ${SERVICE_BILLING_BRODE_UNITS.join(", ")}`);
      }
      // ADET/VURUŞ: adet tabletteki brode okumasında girilir (adım özeti `pieceInput`); adetsiz iş uyarıyla fatura dışı.
      const capture = Object.prototype.hasOwnProperty.call(input, "kursunMeterCapture") ? input.kursunMeterCapture : await readKursunMeterCapture();
      assertBrodeUnitHasPieceInput(v as ServiceBillingBrodeUnit, capture);
      await this.set(SETTING_KEYS.FINANCE_SERVICE_BILLING_BRODE_UNIT, v, "Brode fiyat birimi — metre · adet · vuruş", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeServiceBillingStepWorks")) {
      if (typeof input.financeServiceBillingStepWorks !== "boolean") {
        throw AppError.badRequest("financeServiceBillingStepWorks boolean olmalı");
      }
      await this.set(SETTING_KEYS.FINANCE_SERVICE_BILLING_STEP_WORKS, input.financeServiceBillingStepWorks, "Süreç türü eşlemeli adım işlerini (boya, apre…) hizmet satırı olarak ekle", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeServiceBillingTrigger")) {
      const v = input.financeServiceBillingTrigger;
      if (typeof v !== "string" || !SERVICE_BILLING_TRIGGERS.includes(v as ServiceBillingTrigger)) {
        throw AppError.badRequest(`financeServiceBillingTrigger şunlardan biri olmalı: ${SERVICE_BILLING_TRIGGERS.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, v, "Hizmet faturası tetiği — her sevkte · dönem sonu", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeServiceBillingPriceDate")) {
      const v = input.financeServiceBillingPriceDate;
      if (typeof v !== "string" || !SERVICE_BILLING_PRICE_DATES.includes(v as ServiceBillingPriceDate)) {
        throw AppError.badRequest(`financeServiceBillingPriceDate şunlardan biri olmalı: ${SERVICE_BILLING_PRICE_DATES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE, v, "Hizmet faturası fiyat tarihi — hizmet günü · sevk günü", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeKursunGramPriceBasis")) {
      const v = input.financeKursunGramPriceBasis;
      if (typeof v !== "string" || !KURSUN_GRAM_PRICE_BASES.includes(v as KursunGramPriceBasis)) {
        throw AppError.badRequest(`financeKursunGramPriceBasis şunlardan biri olmalı: ${KURSUN_GRAM_PRICE_BASES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_KURSUN_GRAM_PRICE_BASIS, v, "Kurşun gram fiyatı — işin yapıldığı gündeki · faturanın kesildiği gündeki", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeExpenseCategorySuggestions")) {
      const v = input.financeExpenseCategorySuggestions;
      if (typeof v !== "string" || !EXPENSE_CATEGORY_SUGGESTION_MODES.includes(v as ExpenseCategorySuggestions)) {
        throw AppError.badRequest(`financeExpenseCategorySuggestions şunlardan biri olmalı: ${EXPENSE_CATEGORY_SUGGESTION_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_EXPENSE_CATEGORY_SUGGESTIONS, v, "Kasa masraf formunda kategori önerisi — açık · kapalı", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeExpenseAllocationField")) {
      const v = input.financeExpenseAllocationField;
      if (typeof v !== "string" || !EXPENSE_ALLOCATION_FIELD_MODES.includes(v as ExpenseAllocationField)) {
        throw AppError.badRequest(`financeExpenseAllocationField şunlardan biri olmalı: ${EXPENSE_ALLOCATION_FIELD_MODES.join(", ")}`);
      }
      // Çıkışsız kapı yasağı: "zorunlu" kipi her masraf giriş yüzeyinde bağ adımı olmadan masrafı kilitler; o yüzeyler inmeden seçilemez.
      if (v === "REQUIRED") {
        throw AppError.badRequest("Masraf bağı ZORUNLU kipi henüz seçilemez: her masraf giriş yüzeyinde bağ adımı yok. Kapalı ya da İsteğe bağlı seçin.", {
          code: "EXPENSE_ALLOCATION_REQUIRED_UNAVAILABLE",
        });
      }
      await this.set(SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_FIELD, v, `Kasa masraf formunda masraf bağı (makine / ${TERIM.terbiyeIsEmri.tekilKucuk} / hizmet kalemi) — kapalı · isteğe bağlı`, userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeExpenseAllocationClosedWorkOrder")) {
      const v = input.financeExpenseAllocationClosedWorkOrder;
      if (typeof v !== "string" || !EXPENSE_ALLOCATION_CLOSED_WORK_ORDER_MODES.includes(v as ExpenseAllocationClosedWorkOrder)) {
        throw AppError.badRequest(`financeExpenseAllocationClosedWorkOrder şunlardan biri olmalı: ${EXPENSE_ALLOCATION_CLOSED_WORK_ORDER_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_CLOSED_WORK_ORDER, v, `Kapanmış ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} masraf bağı — serbest · engelli`, userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeCariHoldDefaultScope")) {
      const v = input.financeCariHoldDefaultScope;
      if (typeof v !== "string" || !CARI_HOLD_DEFAULT_SCOPES.includes(v as CariHoldDefaultScope)) {
        throw AppError.badRequest(`financeCariHoldDefaultScope şunlardan biri olmalı: ${CARI_HOLD_DEFAULT_SCOPES.join(" · ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_CARI_HOLD_DEFAULT_SCOPE, v, "Cari kilidi formunda ön seçili kapsam", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeCariHoldReleaseBySamePerson")) {
      const v = input.financeCariHoldReleaseBySamePerson;
      if (typeof v !== "string" || !CARI_HOLD_RELEASE_BY_SAME_PERSON_MODES.includes(v as CariHoldReleaseBySamePerson)) {
        throw AppError.badRequest(`financeCariHoldReleaseBySamePerson şunlardan biri olmalı: ${CARI_HOLD_RELEASE_BY_SAME_PERSON_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON, v, "Cari kilidini koyan kişi kendi kilidini açabilir mi — serbest · başka yetkili", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeCariHoldEmanetShipment")) {
      const v = input.financeCariHoldEmanetShipment;
      if (typeof v !== "string" || !CARI_HOLD_EMANET_SHIPMENT_MODES.includes(v as CariHoldEmanetShipment)) {
        throw AppError.badRequest(`financeCariHoldEmanetShipment şunlardan biri olmalı: ${CARI_HOLD_EMANET_SHIPMENT_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT, v, "Kilitli caride müşterinin emanet malının sevki — serbest · işlenmiş tutulur · hepsi tutulur", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costPresentationCurrency")) {
      const v = input.costPresentationCurrency;
      if (typeof v !== "string" || !COST_PRESENTATION_CURRENCIES.includes(v as CostPresentationCurrency)) {
        throw AppError.badRequest(`costPresentationCurrency şunlardan biri olmalı: ${COST_PRESENTATION_CURRENCIES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.COST_PRESENTATION_CURRENCY, v, "Maliyet ekranlarında tutarların gösterildiği döviz (hesap TL'de kalır)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costFinishingKgBasis")) {
      const v = input.costFinishingKgBasis;
      if (typeof v !== "string" || !FINISHING_KG_BASES.includes(v as FinishingKgBasis)) {
        throw AppError.badRequest(`costFinishingKgBasis şunlardan biri olmalı: ${FINISHING_KG_BASES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.COST_FINISHING_KG_BASIS, v, "Kg bazlı terbiye tarifesinde kilonun kaynağı — firesiz ham kumaş · fireli iplik tüketimi", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "financeRiskLimitCurrencyMode")) {
      const v = input.financeRiskLimitCurrencyMode;
      if (typeof v !== "string" || !RISK_LIMIT_CURRENCY_MODES.includes(v as RiskLimitCurrencyMode)) {
        throw AppError.badRequest(`financeRiskLimitCurrencyMode şunlardan biri olmalı: ${RISK_LIMIT_CURRENCY_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.FINANCE_RISK_LIMIT_CURRENCY_MODE, v, "Risk limiti para birimi — her para birimi ayrı · TL'ye çevrilmiş toplam", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costProfitSubcontractSource")) {
      const v = input.costProfitSubcontractSource;
      if (typeof v !== "string" || !PROFIT_SUBCONTRACT_SOURCES.includes(v as ProfitSubcontractSource)) {
        throw AppError.badRequest(`costProfitSubcontractSource şunlardan biri olmalı: ${PROFIT_SUBCONTRACT_SOURCES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE, v, "Kârlılıkta dış fason maliyeti — önce fatura (yoksa tarife tahmini) · yalnız fatura", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costProfitConsumablePriceSource")) {
      const v = input.costProfitConsumablePriceSource;
      if (typeof v !== "string" || !PROFIT_CONSUMABLE_PRICE_SOURCES.includes(v as ProfitConsumablePriceSource)) {
        throw AppError.badRequest(`costProfitConsumablePriceSource şunlardan biri olmalı: ${PROFIT_CONSUMABLE_PRICE_SOURCES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.COST_PROFIT_CONSUMABLE_PRICE_SOURCE, v, "Kârlılıkta sarf birim fiyatı — kart alış fiyatı · son alış faturası", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costWeavingStandardMethod")) {
      const v = input.costWeavingStandardMethod;
      if (typeof v !== "string" || !WEAVING_STANDARD_METHODS.includes(v as WeavingStandardMethod)) {
        throw AppError.badRequest(`costWeavingStandardMethod şunlardan biri olmalı: ${WEAVING_STANDARD_METHODS.join(", ")}`);
      }
      await this.set(SETTING_KEYS.COST_WEAVING_STANDARD_METHOD, v, "Dokuma standart maliyet yöntemi — tezgah saati · atkı ücreti", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "orderProductionProposal")) {
      const v = input.orderProductionProposal;
      if (typeof v !== "string" || !ORDER_PRODUCTION_PROPOSAL_MODES.includes(v as OrderProductionProposalMode)) {
        throw AppError.badRequest(`orderProductionProposal şunlardan biri olmalı: ${ORDER_PRODUCTION_PROPOSAL_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL, v, "Siparişten üretim önerisi — kapalı · önizleme · onayda taslak", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costProfitMachineTime")) {
      const v = input.costProfitMachineTime;
      if (typeof v !== "string" || !PROFIT_MACHINE_TIME_MODES.includes(v as ProfitMachineTimeMode)) {
        throw AppError.badRequest(`costProfitMachineTime şunlardan biri olmalı: ${PROFIT_MACHINE_TIME_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.COST_PROFIT_MACHINE_TIME, v, "Kârlılıkta makine süresi — iş oturumu · vardiya · metre normu", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costProfitOverheadKey")) {
      const v = input.costProfitOverheadKey;
      if (typeof v !== "string" || !PROFIT_OVERHEAD_KEYS.includes(v as ProfitOverheadKey)) {
        throw AppError.badRequest(`costProfitOverheadKey şunlardan biri olmalı: ${PROFIT_OVERHEAD_KEYS.join(", ")}`);
      }
      await this.set(SETTING_KEYS.COST_PROFIT_OVERHEAD_KEY, v, "Kârlılıkta genel gider dağıtımı — yok · metre · gelir · makine saati", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "costProfitCategoryClasses")) {
      const map = sanitizeProfitCategoryClasses(input.costProfitCategoryClasses);
      if (!map) {
        throw AppError.badRequest(`costProfitCategoryClasses kategori → sınıf eşlemesi olmalı (sınıf: ${PROFIT_CATEGORY_CLASSES.join(", ")}; en çok ${PROFIT_CATEGORY_CLASS_MAX_ENTRIES} kategori)`);
      }
      await this.set(SETTING_KEYS.COST_PROFIT_CATEGORY_CLASSES, map, "Kârlılıkta masraf kategorisi sınıfları — işçilik · genel gider · hariç", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeAutoAllocateOnPaymentEnabled")) {
      if (typeof input.financeAutoAllocateOnPaymentEnabled !== "boolean") {
        throw AppError.badRequest("financeAutoAllocateOnPaymentEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_AUTO_ALLOCATE_ON_PAYMENT_ENABLED,
        input.financeAutoAllocateOnPaymentEnabled,
        "Tahsilat/ödemede en eski açık faturalara otomatik kapama (FIFO; artan tutar avansta kalır)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "yarnBlockNegativeBalanceEnabled")) {
      if (typeof input.yarnBlockNegativeBalanceEnabled !== "boolean") {
        throw AppError.badRequest("yarnBlockNegativeBalanceEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.YARN_BLOCK_NEGATIVE_BALANCE_ENABLED,
        input.yarnBlockNegativeBalanceEnabled,
        "İplik çıkışında eksi bakiyeye düşecek hareketi engelle (storno/iptal muaf)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "purchaseBlockOverReceiptEnabled")) {
      if (typeof input.purchaseBlockOverReceiptEnabled !== "boolean") {
        throw AppError.badRequest("purchaseBlockOverReceiptEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.PURCHASE_BLOCK_OVER_RECEIPT_ENABLED,
        input.purchaseBlockOverReceiptEnabled,
        "Alış siparişine bağlı mal kabulde sipariş miktarını aşan satırı engelle",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "consumableStockEnabled")) {
      if (typeof input.consumableStockEnabled !== "boolean") {
        throw AppError.badRequest("consumableStockEnabled boolean olmalı");
      }
      await this.set(SETTING_KEYS.CONSUMABLE_STOCK_ENABLED, input.consumableStockEnabled, "Sarf stok takibi (kuşak / kurşun şeridi)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "goodsReceiptRequirePriceEnabled")) {
      if (typeof input.goodsReceiptRequirePriceEnabled !== "boolean") {
        throw AppError.badRequest("goodsReceiptRequirePriceEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.GOODS_RECEIPT_REQUIRE_PRICE_ENABLED,
        input.goodsReceiptRequirePriceEnabled,
        "Mal kabul satırında birim fiyat zorunlu (çözülemezse 400; ters/iptal satırları muaf)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "goodsReceiptYarnQualityHoldEnabled")) {
      if (typeof input.goodsReceiptYarnQualityHoldEnabled !== "boolean") {
        throw AppError.badRequest("goodsReceiptYarnQualityHoldEnabled boolean olmalı");
      }
      await this.set(SETTING_KEYS.GOODS_RECEIPT_YARN_QUALITY_HOLD_ENABLED, input.goodsReceiptYarnQualityHoldEnabled, "Mal kabulde doğan iplik lotu kalite bekletmede doğar; bekletmedeki/bloke lota çıkış yazılamaz", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "productionCancelReasonRequired")) {
      if (typeof input.productionCancelReasonRequired !== "boolean") {
        throw AppError.badRequest("productionCancelReasonRequired boolean olmalı");
      }
      await this.set(SETTING_KEYS.PRODUCTION_CANCEL_REASON_REQUIRED, input.productionCancelReasonRequired, "Top iptalinde sebep (metin ya da katalog kodu) zorunlu", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeAllowZeroPriceLineEnabled")) {
      if (typeof input.financeAllowZeroPriceLineEnabled !== "boolean") {
        throw AppError.badRequest("financeAllowZeroPriceLineEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_ALLOW_ZERO_PRICE_LINE_ENABLED,
        input.financeAllowZeroPriceLineEnabled,
        "Sıfır fiyatlı fatura satırıyla onaya izin ver (promosyon/numune; negatif fiyat yine red)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeFutureDatedDocumentBlockEnabled")) {
      if (typeof input.financeFutureDatedDocumentBlockEnabled !== "boolean") {
        throw AppError.badRequest("financeFutureDatedDocumentBlockEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_FUTURE_DATED_DOCUMENT_BLOCK_ENABLED,
        input.financeFutureDatedDocumentBlockEnabled,
        "İleri tarihli mali belge tarihini engelle (çek keşide/vade tarihi MUAF)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "financeYarnOutOnInvoiceEnabled")) {
      if (typeof input.financeYarnOutOnInvoiceEnabled !== "boolean") {
        throw AppError.badRequest("financeYarnOutOnInvoiceEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FINANCE_YARN_OUT_ON_INVOICE_ENABLED,
        input.financeYarnOutOnInvoiceEnabled,
        "Satış faturası onayında iplik satırlarını varsayılan depodan stoktan düş",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "productionEnabled")) {
      if (typeof input.productionEnabled !== "boolean") {
        throw AppError.badRequest("productionEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.PRODUCTION_ENABLED,
        input.productionEnabled,
        // Metin migration damgasıyla BİREBİR kalır (test_module_flags §6d) — görünen ad değişikliğinin dışında.
        "Üretim modülü (envanter üretim sekmeleri · iş emri yüzeyleri)",
        userId
      );
    }

    // -------------------------------------------------------------------------
    // MODÜL ANAHTARLARI (2026-09-02)
    // ⚠️ `description` metinleri grandfathering migration'ındakiyle BİREBİR
    // AYNI olmak zorunda (bekçi karşılaştırır): ayrışırsa aynı satır, damgayı
    // atan kuruluma bir açıklamayla, panelden ilk düzenlemeden sonra başka bir
    // açıklamayla görünür.
    // ⚠️ Yazım kalıbı (`hasOwnProperty` + ALAN ADI düz metin) LOAD-BEARING:
    // bekçi C kümesini tam bu çağrının regex'iyle çıkarıyor; döngü ya da
    // destructuring yazımı dalları görünmez yapar ve sözleşme kontrolü sahte
    // yeşile düşer. Bu YORUMDA da örnek çağrı YAZILMAZ — regex yorumu da
    // okur ve kümeye hayalet bir anahtar ekler (ölçüldü: `...` diye bir
    // anahtar "ulaşılamaz yazma dalı" kırmızısı üretti).
    // -------------------------------------------------------------------------
    if (Object.prototype.hasOwnProperty.call(input, "ticaretEnabled")) {
      if (typeof input.ticaretEnabled !== "boolean") {
        throw AppError.badRequest("ticaretEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TICARET_ENABLED,
        input.ticaretEnabled,
        "Ticaret modülü (alış siparişi · mal kabul · fiyat listeleri · stok sayımı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "iplikEnabled")) {
      if (typeof input.iplikEnabled !== "boolean") {
        throw AppError.badRequest("iplikEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.IPLIK_ENABLED,
        input.iplikEnabled,
        "İplik modülü (kg defteri — iplik stok ve hareketleri)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "depoMultiEnabled")) {
      if (typeof input.depoMultiEnabled !== "boolean") {
        throw AppError.badRequest("depoMultiEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DEPO_MULTI_ENABLED,
        input.depoMultiEnabled,
        "Çoklu depo modülü (depo seçici · depo kolonu · depolar arası transfer)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kumasTeknikEnabled")) {
      if (typeof input.kumasTeknikEnabled !== "boolean") {
        throw AppError.badRequest("kumasTeknikEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KUMAS_TEKNIK_ENABLED,
        input.kumasTeknikEnabled,
        "Kumaş teknik kartı modülü (en · gramaj · kompozisyon · atkı/çözgü)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tezgahEnabled")) {
      if (typeof input.tezgahEnabled !== "boolean") {
        throw AppError.badRequest("tezgahEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TEZGAH_ENABLED,
        input.tezgahEnabled,
        "Dokuma tezgah izleme modülü",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "devereEnabled")) {
      if (typeof input.devereEnabled !== "boolean") {
        throw AppError.badRequest("devereEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DEVERE_ENABLED,
        input.devereEnabled,
        "Devere / levent modülü (çözgü kartı · levent stoğu · levent defteri)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "emanetEnabled")) {
      if (typeof input.emanetEnabled !== "boolean") {
        throw AppError.badRequest("emanetEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.EMANET_ENABLED,
        input.emanetEnabled,
        "Emanet / konsinye mülkiyet modülü (müşterinin malı: top · levent · iplik lotu; sevk sahiplik kapısı)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "kaliteGuvenceEnabled")) {
      if (typeof input.kaliteGuvenceEnabled !== "boolean") {
        throw AppError.badRequest("kaliteGuvenceEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KALITE_GUVENCE_ENABLED,
        input.kaliteGuvenceEnabled,
        "Kalite Güvence modülü (4 puan muayene · lab testleri · sertifika takibi)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "devereLotRequired")) {
      if (typeof input.devereLotRequired !== "boolean") {
        throw AppError.badRequest("devereLotRequired boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DEVERE_LOT_REQUIRED,
        input.devereLotRequired,
        "Devere: içeride sarımda ve mal kabul iplik satırında lot zorunlu",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "devereMountTracking")) {
      if (typeof input.devereMountTracking !== "boolean") {
        throw AppError.badRequest("devereMountTracking boolean olmalı");
      }
      await this.set(SETTING_KEYS.DEVERE_MOUNT_TRACKING, input.devereMountTracking, "Devere: levent tezgah bağı defteri (tak · sök · tüket · bitir)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "devereMountTrackingRequired")) {
      if (typeof input.devereMountTrackingRequired !== "boolean") {
        throw AppError.badRequest("devereMountTrackingRequired boolean olmalı");
      }
      await this.set(SETTING_KEYS.DEVERE_MOUNT_TRACKING_REQUIRED, input.devereMountTrackingRequired, "Devere: bağlamada yöntem ve başlangıç saati zorunlu", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "devereAutoConsume")) {
      if (typeof input.devereAutoConsume !== "boolean") {
        throw AppError.badRequest("devereAutoConsume boolean olmalı");
      }
      await this.set(SETTING_KEYS.DEVERE_AUTO_CONSUME, input.devereAutoConsume, "Devere: tezgahtan doğan top leventten otomatik tüketim düşer", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "devereBeamWeavingLinkRequired")) {
      if (typeof input.devereBeamWeavingLinkRequired !== "boolean") {
        throw AppError.badRequest("devereBeamWeavingLinkRequired boolean olmalı");
      }
      await this.set(SETTING_KEYS.DEVERE_BEAM_WEAVING_LINK_REQUIRED, input.devereBeamWeavingLinkRequired, "Devere: levent sarımında dokuma iş emri bağı zorunlu", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "dokumaRunWeavingOrderRequired")) {
      if (typeof input.dokumaRunWeavingOrderRequired !== "boolean") {
        throw AppError.badRequest("dokumaRunWeavingOrderRequired boolean olmalı");
      }
      await this.set(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, input.dokumaRunWeavingOrderRequired, "Dokuma: tezgah koşumu dokuma iş emrine bağlı açılır", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "dokumaOrderLineLinkRequired")) {
      if (typeof input.dokumaOrderLineLinkRequired !== "boolean") {
        throw AppError.badRequest("dokumaOrderLineLinkRequired boolean olmalı");
      }
      await this.set(SETTING_KEYS.DOKUMA_ORDER_LINE_LINK_REQUIRED, input.dokumaOrderLineLinkRequired, "Dokuma: dokuma iş emri en az bir sipariş satırına bağlı", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "dokumaRollBirth")) {
      const v = input.dokumaRollBirth;
      if (typeof v !== "string" || !DOKUMA_ROLL_BIRTH_MODES.includes(v as DokumaRollBirth)) {
        throw AppError.badRequest("Top doğuş yolu 'TABLET_DOFF', 'KK1_LABEL_OR_ORDER' veya 'KK1_LABEL_ONLY' olmalı");
      }
      await this.set(SETTING_KEYS.DOKUMA_ROLL_BIRTH, v, "Dokuma: top doğuş yolu — tablet İNDİR · KK1 etiket/dokuma iş emri · KK1 yalnız etiket", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "dokumaEnabled")) {
      if (typeof input.dokumaEnabled !== "boolean") {
        throw AppError.badRequest("dokumaEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DOKUMA_ENABLED,
        input.dokumaEnabled,
        // Metin migration damgasıyla BİREBİR kalır (test_module_flags §6d) — görünen ad değişikliğinin dışında.
        "Dokuma işi modülü (dokuma işi planlama · tezgah koşumu · top indirme)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "maliyetEnabled")) {
      if (typeof input.maliyetEnabled !== "boolean") {
        throw AppError.badRequest("maliyetEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.MALIYET_ENABLED,
        input.maliyetEnabled,
        "Maliyet & Teklif: ürün maliyeti, standart maliyet, satış teklifi, fiyat listesi, iplik ihtiyaç planı",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "gelenBelgeEnabled")) {
      if (typeof input.gelenBelgeEnabled !== "boolean") {
        throw AppError.badRequest("gelenBelgeEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.GELEN_BELGE_ENABLED,
        input.gelenBelgeEnabled,
        "Gelen belge taslağı modülü (müşteri irsaliyesi fotoğrafından OCR taslak · gözden geçirme · onayla emanet top girişi)",
        userId
      );
    }
    if (incomingDocWasOpen === false) await resetReadyBaselineOnIncomingDocOpen();

    if (Object.prototype.hasOwnProperty.call(input, "targetQuantityEnabled")) {
      if (typeof input.targetQuantityEnabled !== "boolean") {
        throw AppError.badRequest("targetQuantityEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED,
        input.targetQuantityEnabled,
        `${TERIM.terbiyeIsEmri.cumleBasi.yalin} formunda hedef metraj alanını göster`,
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "rawWidthEnabled")) {
      if (typeof input.rawWidthEnabled !== "boolean") {
        throw AppError.badRequest("rawWidthEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KK1_RAW_WIDTH_ENABLED,
        input.rawWidthEnabled,
        "KK1 ham kumaş girişinde en (cm) alanını göster",
        userId
      );
    }

    // ── RAPOR GÖRÜNÜRLÜĞÜ ────────────────────────────────────────────────────
    // ⚠️ BİLİNMEYEN ANAHTAR YAZMADA 400 (`REPORT_KEY_UNKNOWN`), OKUMADA YOK SAYILIR
    // (1e hükmü). Asimetri bilinçli: yazan kişi bir TIPO'yu anında görmelidir, ama
    // silinmiş bir rapor yüzünden listede kalan bayat bir anahtar tüm rapor kapısını
    // 500'e düşürmemelidir. Bayat anahtar boot'ta TEK SEFER uyarı basar.
    // ⚠️ `null` YAZILAMAZ: `null` okuma tarafında "liste ÖLÇÜLEMEDİ" demektir, bir değer
    // değil. Yazma yüzeyinden kabul edilseydi bozuk satır meşru bir yazma hâline gelirdi.
    if (Object.prototype.hasOwnProperty.call(input, "reportsClosedKeys")) {
      const incoming = input.reportsClosedKeys;
      if (!Array.isArray(incoming) || !incoming.every((k): k is string => typeof k === "string")) {
        throw AppError.badRequest("reportsClosedKeys string dizisi olmalı");
      }
      const bilinmeyen = incoming.filter((k) => !REPORT_BY_KEY.has(k));
      if (bilinmeyen.length > 0) {
        throw AppError.badRequest(
          `Tanınmayan rapor anahtarı: ${bilinmeyen.join(", ")}`,
          { code: "REPORT_KEY_UNKNOWN", keys: bilinmeyen },
        );
      }
      // KÜME olarak saklanır (tekil + sıralı): sıra anlam taşımaz ve iki yazma arasında
      // yalnız sıralaması değişen bir gövde sahte bir "değişti" audit satırı üretirdi.
      await this.set(
        SETTING_KEYS.REPORTS_CLOSED_KEYS,
        [...new Set(incoming)].sort(),
        "Kapalı raporların anahtar listesi (boş/satır yok = hepsi açık)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "reportsV2Enabled")) {
      if (typeof input.reportsV2Enabled !== "boolean") {
        throw AppError.badRequest("reportsV2Enabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.REPORTS_V2_ENABLED,
        input.reportsV2Enabled,
        "Yeni rapor merkezi (Raporlar v2)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kk1WeightEntryEnabled")) {
      if (typeof input.kk1WeightEntryEnabled !== "boolean") {
        throw AppError.badRequest("kk1WeightEntryEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KK1_WEIGHT_ENTRY_ENABLED,
        input.kk1WeightEntryEnabled,
        "KK1 ham kumaş girişinde ağırlık (kg) alanını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kk1DuplicateGuardEnabled")) {
      if (typeof input.kk1DuplicateGuardEnabled !== "boolean") {
        throw AppError.badRequest("kk1DuplicateGuardEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED,
        input.kk1DuplicateGuardEnabled,
        "Ham girişte mükerrer top uyarısı",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "workOrderQuickOwnOnlyEnabled")) {
      if (typeof input.workOrderQuickOwnOnlyEnabled !== "boolean") {
        throw AppError.badRequest("workOrderQuickOwnOnlyEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.WORKORDER_QUICK_OWN_ONLY_ENABLED,
        input.workOrderQuickOwnOnlyEnabled,
        `Hızlı ${TERIM.terbiyeIsEmri.tekilKucuk}: yalnız kendi başlattıklarını düzenler`,
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "supportOwnTicketsOnlyEnabled")) {
      if (typeof input.supportOwnTicketsOnlyEnabled !== "boolean") {
        throw AppError.badRequest("supportOwnTicketsOnlyEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SUPPORT_OWN_TICKETS_ONLY_ENABLED,
        input.supportOwnTicketsOnlyEnabled,
        "Destek talepleri: herkes yalnız kendininkini görür",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kk1OnlineOnlyEnabled")) {
      if (typeof input.kk1OnlineOnlyEnabled !== "boolean") {
        throw AppError.badRequest("kk1OnlineOnlyEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KK1_ONLINE_ONLY_ENABLED,
        input.kk1OnlineOnlyEnabled,
        "Ham giriş çevrimdışı kuyruksuz (online-only) rejim",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kk1LabelScanVerifyEnabled")) {
      if (typeof input.kk1LabelScanVerifyEnabled !== "boolean") {
        throw AppError.badRequest("kk1LabelScanVerifyEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KK1_LABEL_SCAN_VERIFY_ENABLED,
        input.kk1LabelScanVerifyEnabled,
        "Ham girişte etiket geri-okutma doğrulaması (scan-back)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kk1HistoryAllEntriesEnabled")) {
      if (typeof input.kk1HistoryAllEntriesEnabled !== "boolean") {
        throw AppError.badRequest("kk1HistoryAllEntriesEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KK1_HISTORY_ALL_ENTRIES_ENABLED,
        input.kk1HistoryAllEntriesEnabled,
        "KK1 Tüm Girişler: tüm operatörlerin kayıtları görünür",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingSimulatedWeightEnabled")) {
      if (typeof input.shippingSimulatedWeightEnabled !== "boolean") {
        throw AppError.badRequest("shippingSimulatedWeightEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPPING_SIMULATED_WEIGHT_ENABLED,
        input.shippingSimulatedWeightEnabled,
        "Simüle kantardan gelen çuval tartısını kaydetmeye izin ver (demo/eğitim)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "returnGradingEnabled")) {
      if (typeof input.returnGradingEnabled !== "boolean") {
        throw AppError.badRequest("returnGradingEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.RETURN_GRADING_ENABLED,
        input.returnGradingEnabled,
        "İade kabulünde personel topun kalitesini değiştirebilsin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kartelaMeasurementEnabled")) {
      if (typeof input.kartelaMeasurementEnabled !== "boolean") {
        throw AppError.badRequest("kartelaMeasurementEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KARTELA_MEASUREMENT_ENABLED,
        input.kartelaMeasurementEnabled,
        "Kartela kabulünde uzunluk(cm)/ağırlık(kg) alanlarını göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "partyCodeAuto")) {
      if (typeof input.partyCodeAuto !== "boolean") {
        throw AppError.badRequest("partyCodeAuto boolean olmalı");
      }
      // ⚠️ TEK YAZAR: bu anahtar artık kendi satırına değil `numberSource`a yazar.
      // İki yazar kalsaydı eski panel ile Numaralandırma ekranı birbirini ezerdi.
      //
      // ⚠️ DEĞİŞMEDİYSE HİÇ YAZILMAZ ve bu load-bearing: `SYSTEM` modu boolean'a
      // `true` diye görünür; eski panel formu olduğu gibi kaydederse `true`
      // gelir ve körlemesine `FREE` yazmak SYSTEM'i SESSİZCE düşürürdü.
      const current = await readPartyCodeAuto();
      if (current !== input.partyCodeAuto) {
        await updateSeriesNumberSource("workOrder", input.partyCodeAuto ? "FREE" : "MANUAL", userId);
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, "fasonNoteMobileEntry")) {
      if (typeof input.fasonNoteMobileEntry !== "boolean") {
        throw AppError.badRequest("fasonNoteMobileEntry boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FASON_NOTE_MOBILE_ENTRY,
        input.fasonNoteMobileEntry,
        "Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shortCredentialApprovedDeviceOnly")) {
      if (typeof input.shortCredentialApprovedDeviceOnly !== "boolean") {
        throw AppError.badRequest("shortCredentialApprovedDeviceOnly boolean olmalı");
      }
      if (!input.shortCredentialApprovedDeviceOnly && isHostedInstallation()) {
        throw AppError.conflict(
          "Barındırılan (bulut) kurulumda hızlı PIN ve kart yalnız onaylı cihazdan kabul edilir — bu kural kapatılamaz.",
          { code: "HOSTED_CLASS_FORCED" },
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY,
        input.shortCredentialApprovedDeviceOnly,
        "Hızlı PIN ve QR kartla giriş yalnız onaylı cihazdan (eşleştirmeyi de zorunlu kılar)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shortCredentialTotpRequired")) {
      if (typeof input.shortCredentialTotpRequired !== "boolean") {
        throw AppError.badRequest("shortCredentialTotpRequired boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.AUTH_SHORT_CREDENTIAL_TOTP_REQUIRED,
        input.shortCredentialTotpRequired,
        "İki adımlı doğrulaması açık hesabın hızlı PIN ve QR kart girişinde de kod sorulsun",
        userId
      );
    }

    // Yazma kapısı route'ta (`flagWriteGuard` süperadmin dalı); burada yalnız tip.
    if (Object.prototype.hasOwnProperty.call(input, "webTotpPolicy")) {
      const v = input.webTotpPolicy;
      if (typeof v !== "string" || !WEB_TOTP_POLICIES.includes(v as WebTotpPolicy)) {
        throw AppError.badRequest("Web girişi doğrulama politikası 'REQUIRED' veya 'USER_CHOICE' olmalı");
      }
      await this.set(
        SETTING_KEYS.AUTH_WEB_TOTP_POLICY,
        v,
        "Web paneli girişinde iki adımlı doğrulama: REQUIRED (herkese zorunlu) / USER_CHOICE (kullanıcı kendi hesabında kapatabilir)",
        userId
      );
    }

    // Yazma kapısı route'ta (`flagWriteGuard` süperadmin dalı); burada yalnız tip/aralık.
    if (Object.prototype.hasOwnProperty.call(input, "trustedDeviceDays")) {
      const v = input.trustedDeviceDays;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_TRUSTED_DEVICE_DAYS) {
        throw AppError.badRequest(`Cihazı hatırlama süresi 0–${MAX_TRUSTED_DEVICE_DAYS} gün olmalı (0 = kapalı)`);
      }
      await this.set(
        SETTING_KEYS.AUTH_TRUSTED_DEVICE_DAYS,
        v,
        "Web girişinde 'Bu cihazı hatırla' süresi, gün (0 = kapalı; her girişte doğrulama kodu)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "devicePairingRequired")) {
      if (typeof input.devicePairingRequired !== "boolean") {
        throw AppError.badRequest("devicePairingRequired boolean olmalı");
      }
      // Kısa kimlik kuralı eşleştirmesiz anlamsızdır (otomatik onaylı cihaz "onaylı" sayılırdı):
      // kural açıkken eşleştirmeyi kapatmak yazılır ama etkisiz kalırdı — sessiz değil, 409.
      if (!input.devicePairingRequired && (isHostedInstallation() || (await readStoredShortCredentialApprovedDeviceOnly()))) {
        throw AppError.conflict(
          "Hızlı PIN/kart yalnız onaylı cihazdan kuralı açıkken cihaz eşleştirmesi kapatılamaz — önce o kuralı kapatın.",
          { code: "PAIRING_FORCED" },
        );
      }
      await this.set(
        SETTING_KEYS.DEVICE_PAIRING_REQUIRED,
        input.devicePairingRequired,
        "Mobil cihaz eşleştirmesi zorunlu olsun (kapalıyken eşleşmemiş cihazlar da girer)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "deviceProofRequired")) {
      if (typeof input.deviceProofRequired !== "boolean") {
        throw AppError.badRequest("deviceProofRequired boolean olmalı");
      }
      if (!input.deviceProofRequired && isHostedInstallation()) {
        throw AppError.conflict(
          "Barındırılan (bulut) kurulumda cihaz kanıtı zorunludur — bu kural kapatılamaz.",
          { code: "HOSTED_CLASS_FORCED" },
        );
      }
      await this.set(
        SETTING_KEYS.DEVICE_PROOF_REQUIRED,
        input.deviceProofRequired,
        "Cihaz kanıtı zorunlu: kanıtsız ya da yanlış kanıtlı tablet onaylı cihaz sayılmaz",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "deviceUnpairedPasswordLogin")) {
      if (typeof input.deviceUnpairedPasswordLogin !== "boolean") {
        throw AppError.badRequest("deviceUnpairedPasswordLogin boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN,
        input.deviceUnpairedPasswordLogin,
        "Onaysız tablet onay beklemeden yalnız kullanıcı adı + parolayla girebilsin (PIN/kart/personel listesi kapalı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shipmentManualSackCountEnabled")) {
      if (typeof input.shipmentManualSackCountEnabled !== "boolean") {
        throw AppError.badRequest("shipmentManualSackCountEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPMENT_MANUAL_SACK_COUNT_ENABLED,
        input.shipmentManualSackCountEnabled,
        "Sevkiyatta 'araca yüklenen gerçek çuval adedi' elle girilebilsin (kapalıyken alan hiç sorulmaz)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shipmentLooseLoadEnabled")) {
      if (typeof input.shipmentLooseLoadEnabled !== "boolean") {
        throw AppError.badRequest("shipmentLooseLoadEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED,
        input.shipmentLooseLoadEnabled,
        "Çuvalsız sevk: toplar çuvala konmadan dökme ya da araba ile sevk edilebilsin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shipmentConfirmationEnabled")) {
      if (typeof input.shipmentConfirmationEnabled !== "boolean") {
        throw AppError.badRequest("shipmentConfirmationEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED,
        input.shipmentConfirmationEnabled,
        "Sevk için ayrı 'ambar aldı / çıkış' onay adımı zorunlu olsun (kapalıyken paketleyen direkt sevk eder)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shipmentUndoSameDayOnly")) {
      if (typeof input.shipmentUndoSameDayOnly !== "boolean") {
        throw AppError.badRequest("shipmentUndoSameDayOnly boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPMENT_UNDO_SAME_DAY_ONLY,
        input.shipmentUndoSameDayOnly,
        "Sevk geri alma (storno) yalnız aynı gün yapılabilsin (kapalıyken tarih sınırı yok)",
        userId
      );
    }

    // ── SEVKİYAT DAVRANIŞ BAYRAKLARI (Dilim 2) ────────────────────────────────
    if (Object.prototype.hasOwnProperty.call(input, "shippingOrderRequirement")) {
      const v = input.shippingOrderRequirement;
      if (typeof v !== "string" || !SHIPMENT_ORDER_REQUIREMENTS.includes(v as ShipmentOrderRequirement)) {
        throw AppError.badRequest("Sipariş bağı kuralı 'off', 'warn' veya 'block' olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT,
        v,
        "Sevkiyat siparişe bağlansın mı: off (sorma) / warn (uyar) / block (zorunlu)",
        userId
      );
    }

    // ── ÜRÜN YAŞAM DÖNGÜSÜ — "Tükenene kadar" davranışı (URUN-YASAM-DONGUSU.md §4.1) ──
    if (Object.prototype.hasOwnProperty.call(input, "itemPhaseOutNewOrder")) {
      const v = input.itemPhaseOutNewOrder;
      if (typeof v !== "string" || !PHASE_OUT_NEW_ORDER_VALUES.includes(v as PhaseOutNewOrder)) {
        throw AppError.badRequest("Yeni sipariş seçeneği 'OKUTULAN_TOPLAR', 'KAPALI' veya 'SERBEST' olmalı");
      }
      await this.set(
        SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER,
        v,
        "Tükenene kadar karta yeni sipariş: OKUTULAN_TOPLAR / KAPALI / SERBEST",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "itemPhaseOutLineQty")) {
      const v = input.itemPhaseOutLineQty;
      if (typeof v !== "string" || !PHASE_OUT_LINE_QTY_VALUES.includes(v as PhaseOutLineQty)) {
        throw AppError.badRequest("Açık satırda miktar seçeneği 'SERBEST_UYARILI', 'AZALTMA_SERBEST' veya 'KILITLI' olmalı");
      }
      await this.set(
        SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY,
        v,
        "Tükenene kadar kartın açık sipariş satırında miktar: SERBEST_UYARILI / AZALTMA_SERBEST / KILITLI",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "itemPhaseOutNewPlan")) {
      if (typeof input.itemPhaseOutNewPlan !== "boolean") {
        throw AppError.badRequest("itemPhaseOutNewPlan boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_PLAN,
        input.itemPhaseOutNewPlan,
        `Tükenene kadar karta yeni üretim planı (topsuz+siparişsiz ${TERIM.terbiyeIsEmri.tekilKucuk}, dokuma iş emri) açılabilsin`,
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingWeighRequiredEnabled")) {
      if (typeof input.shippingWeighRequiredEnabled !== "boolean") {
        throw AppError.badRequest("shippingWeighRequiredEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED,
        input.shippingWeighRequiredEnabled,
        "Sevk öncesi tüm çuvallar tartılmış olsun (kapalıyken yalnız yurtdışı sevk tartı ister)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingManualWeightRestrictedEnabled")) {
      if (typeof input.shippingManualWeightRestrictedEnabled !== "boolean") {
        throw AppError.badRequest("shippingManualWeightRestrictedEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED,
        input.shippingManualWeightRestrictedEnabled,
        "Elle çuval tartısı yalnız sevkiyat sorumlusunda (tablet operatörü kantardan tartar)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingInvoiceMode")) {
      const v = input.shippingInvoiceMode;
      if (typeof v !== "string" || !SHIPPING_INVOICE_MODES.includes(v as ShippingInvoiceMode)) {
        throw AppError.badRequest("Fatura izi rejimi 'dis', 'ic' veya 'ikisi' olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPPING_INVOICE_MODE,
        v,
        "Sevkin fatura izi: dis (dış programdan elle) / ic (yalnız ERP faturası) / ikisi (serbest, uyarır)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingDocItemNameMode")) {
      const v = input.shippingDocItemNameMode;
      if (
        typeof v !== "string" ||
        !SHIPPING_DOC_ITEM_NAME_MODES.includes(v as ShippingDocItemNameMode)
      ) {
        throw AppError.badRequest(
          "Sevk belgesi ürün adı rejimi 'bizdeki', 'musterideki' veya 'ikisi' olmalı"
        );
      }
      await this.set(
        SETTING_KEYS.SHIPPING_DOC_ITEM_NAME_MODE,
        v,
        "Sevk belgesinde ürün adı: bizdeki (kendi adımız) / musterideki (müşterinin adı) / ikisi (iki kolon)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingAllowOverAllocation")) {
      const v = input.shippingAllowOverAllocation;
      if (typeof v !== "boolean") throw AppError.badRequest("Fazla sevk ayarı true/false olmalı");
      await this.set(
        SETTING_KEYS.SHIPPING_ALLOW_OVER_ALLOCATION,
        v,
        "Fazla sevk deftere yazılsın mı (kapalıysa sipariş miktarı aşılamaz)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingAllocWidthToleranceEnabled")) {
      const v = input.shippingAllocWidthToleranceEnabled;
      if (typeof v !== "boolean") throw AppError.badRequest("En toleransı true/false olmalı");
      await this.set(
        SETTING_KEYS.SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED,
        v,
        "Tahsiste EN toleransı (kapalıysa tam eşitlik). Kumaş ve renk HER ZAMAN kesin eşleşir.",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingAllocWidthToleranceCm")) {
      const v = input.shippingAllocWidthToleranceCm;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > SHIPPING_ALLOC_WIDTH_TOLERANCE_MAX_CM)) {
        throw AppError.badRequest(`En toleransı 0 ile ${SHIPPING_ALLOC_WIDTH_TOLERANCE_MAX_CM} cm arasında olmalı`);
      }
      // `null` = "alanı temizledim" → fabrika varsayılanına döner (mükerrer eşiğiyle
      // aynı kalıp); JSON kolonuna null yazmak "ayar yok" ile karışırdı.
      await this.set(
        SETTING_KEYS.SHIPPING_ALLOC_WIDTH_TOLERANCE_CM,
        v === null ? DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_CM : v,
        "Tahsiste kabul edilen en farkı (cm)",
        userId
      );
    }
    // Politika değişimi bulutta `is-emri.sevkeHazir`ı bayatlatmasın (D4-MIG6): önceki politika okunur, yazımdan sonra kıyaslanır.
    const shipReadyTouched = ["shippingReadyRule", "shippingReadyTolerancePct"].some((k) => Object.prototype.hasOwnProperty.call(input, k));
    const shipReadyDirty = shipReadyTouched ? await import("../../cloud-sync/ship-ready-dirty") : null;
    const shipReadyBefore = shipReadyDirty ? await shipReadyDirty.readReadyPolicySnapshot() : null;
    if (Object.prototype.hasOwnProperty.call(input, "shippingReadyRule")) {
      const v = input.shippingReadyRule;
      if (typeof v !== "string" || !SHIP_READY_RULES.includes(v as ShipReadyRule)) {
        throw AppError.badRequest("Sevke hazırlık kuralı ALL_DONE ya da METER_THRESHOLD olmalı");
      }
      await this.set(SETTING_KEYS.SHIPPING_READY_RULE, v, "Sevke hazır işler — hazırlık kuralı (ALL_DONE | METER_THRESHOLD)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingReadyTolerancePct")) {
      const v = input.shippingReadyTolerancePct;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > SHIP_READY_TOLERANCE_MAX_PCT)) {
        throw AppError.badRequest(`Sevke hazırlık toleransı 0 ile ${SHIP_READY_TOLERANCE_MAX_PCT} arasında olmalı (%)`);
      }
      await this.set(
        SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT,
        v === null ? DEFAULT_SHIP_READY_TOLERANCE_PCT : v,
        "Sevke hazır işler — metre eşiği toleransı (%)",
        userId
      );
    }
    // Best-effort: ayar zaten yazıldı; bulut işareti düşerse 5 dk emniyet turu yakalar, istek kesilmez (kalan ayarlar yazılır).
    if (shipReadyDirty && shipReadyBefore) {
      await shipReadyDirty.markReadyWorkOrdersDirty(shipReadyBefore).catch((e: unknown) => {
        uyari("bulut-kirletme", `sevke hazırlık politikası değişimi bulut kirletme işaretine yazılamadı: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingReadyNotifyUnits")) {
      const v = input.shippingReadyNotifyUnits;
      if (!Array.isArray(v) || v.some((u) => !SHIP_READY_NOTIFY_UNITS.includes(u as ShipReadyNotifyUnit))) {
        throw AppError.badRequest("Sevke hazır bildirim birimleri yalnız IE, GB, PARTI olabilir");
      }
      // Tekil + kanonik sıra: aynı küme iki farklı JSON olarak yazılmasın.
      const units = SHIP_READY_NOTIFY_UNITS.filter((u) => v.includes(u));
      const before = await readShippingReadyNotifyUnits();
      await this.set(SETTING_KEYS.SHIPPING_READY_NOTIFY_UNITS, units, "Sevke hazır işler — bildirim birimleri (boş = kapalı)", userId);
      // Birim eklenince tür damgası düşer → sonraki tur SESSİZ taban (o an hazır birikim toplu bildirim üretmez; §12.2).
      if (units.some((u) => !before.includes(u))) await resetNotificationBaseline(prisma, READY_WORK_KIND);
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingReadyScanMinutes")) {
      const v = input.shippingReadyScanMinutes;
      if (typeof v !== "number" || !Number.isInteger(v) || v < SHIP_READY_SCAN_MINUTES_MIN || v > SHIP_READY_SCAN_MINUTES_MAX) {
        throw AppError.badRequest(`Sevke hazır tarama periyodu ${SHIP_READY_SCAN_MINUTES_MIN} ile ${SHIP_READY_SCAN_MINUTES_MAX} dakika arasında tam sayı olmalı`);
      }
      await this.set(SETTING_KEYS.SHIPPING_READY_SCAN_MINUTES, v, "Sevke hazır işler — tarama periyodu (dk)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingDocProductColorSplit")) {
      const v = input.shippingDocProductColorSplit;
      if (typeof v !== "boolean") throw AppError.badRequest("Ürün listesi renk sütunu true/false olmalı");
      await this.set(
        SETTING_KEYS.SHIPPING_DOC_PRODUCT_COLOR_SPLIT,
        v,
        "Ürün listesinde müşteri rengi AYRI sütun (kapalıysa bugünkü birleşik dize)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingOrderCoverage")) {
      const v = input.shippingOrderCoverage;
      if (typeof v !== "string" || !SHIPPING_ORDER_COVERAGES.includes(v as ShippingOrderCoverage)) {
        throw AppError.badRequest("Kapsama rejimi 'off', 'warn' veya 'block' olmalı");
      }
      await this.set(
        SETTING_KEYS.SHIPPING_ORDER_COVERAGE,
        v,
        "Kapsama: off (sessiz) / warn (uyar) / block (siparişe yazılamayan mal varsa kurulumu durdur)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingDocCekiNameMode")) {
      const v = input.shippingDocCekiNameMode;
      if (
        typeof v !== "string" ||
        !SHIPPING_DOC_CEKI_NAME_MODES.includes(v as ShippingDocCekiNameMode)
      ) {
        throw AppError.badRequest(
          "Çeki listesi ad rejimi 'devral', 'bizdeki', 'musterideki' veya 'ikisi' olmalı"
        );
      }
      await this.set(
        SETTING_KEYS.SHIPPING_DOC_CEKI_NAME_MODE,
        v,
        "Çeki listesinde ad: devral (genel rejim) / bizdeki / musterideki / ikisi (iki kolon)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "packingGroupsEnabled")) {
      if (typeof input.packingGroupsEnabled !== "boolean") {
        throw AppError.badRequest("packingGroupsEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.PACKING_GROUPS_ENABLE,
        String(input.packingGroupsEnabled),
        "Paketleme grubu (çalışma yaftası) açık mı — kapalıyken çuval listesi düz",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "sackDumpNameMode")) {
      const v = input.sackDumpNameMode;
      if (typeof v !== "string" || !SACK_DUMP_NAME_MODES.includes(v as SackDumpNameMode)) {
        throw AppError.badRequest(
          "Döküm ad rejimi 'ikisi', 'bizdeki' veya 'musterideki' olmalı"
        );
      }
      await this.set(
        SETTING_KEYS.SACK_DUMP_NAME_MODE,
        v,
        "Çuval/grup içerik dökümünde kumaş+renk adı: ikisi / bizdeki / musterideki",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "packingGroupNumbering")) {
      const v = input.packingGroupNumbering;
      if (
        typeof v !== "string" ||
        !PACKING_GROUP_NUMBERINGS.includes(v as PackingGroupNumbering)
      ) {
        throw AppError.badRequest(
          "Paketleme grubu numara rejimi 'artan' veya 'bosluk-doldur' olmalı"
        );
      }
      await this.set(
        SETTING_KEYS.PACKING_GROUP_NUMBERING,
        v,
        "Grup numarası: artan (boşalan numaraya dönme) / bosluk-doldur (en küçük boş)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "packingGroupMode")) {
      const v = input.packingGroupMode;
      if (typeof v !== "string" || !PACKING_GROUP_MODES.includes(v as PackingGroupMode)) {
        throw AppError.badRequest("Paketleme grubu modu 'grup' veya 'sevk-partisi' olmalı");
      }
      await this.set(SETTING_KEYS.PACKING_GROUP_MODE, v, "Paketleme grubu davranışı: grup (yafta) / sevk-partisi (durumlu, ambalaj numaralı)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "packageNoStartsAtZero")) {
      if (typeof input.packageNoStartsAtZero !== "boolean") {
        throw AppError.badRequest("packageNoStartsAtZero boolean olmalı");
      }
      await this.set(SETTING_KEYS.PACKAGE_NO_STARTS_AT_ZERO, String(input.packageNoStartsAtZero), "Ambalaj numarası 0'dan başlar (kapalı = 1'den)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "packageNoMode")) {
      const v = input.packageNoMode;
      if (typeof v !== "string" || !PACKAGE_NO_MODES.includes(v as PackageNoMode)) {
        throw AppError.badRequest("Ambalaj no modu 'otomatik', 'otomatik-ezilebilir' veya 'elle' olmalı");
      }
      await this.set(SETTING_KEYS.PACKAGE_NO_MODE, v, "Ambalaj no atama: otomatik / otomatik-ezilebilir / elle", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "packageNumbering")) {
      const v = input.packageNumbering;
      if (typeof v !== "string" || !PACKAGE_NUMBERINGS.includes(v as PackageNumbering)) {
        throw AppError.badRequest("Ambalaj no rejimi 'artan' veya 'bosluk-doldur' olmalı");
      }
      await this.set(SETTING_KEYS.PACKAGE_NUMBERING, v, "Ambalaj no sayacı: artan (geri verilmez) / bosluk-doldur (en küçük boş)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "packingLotRequired")) {
      if (typeof input.packingLotRequired !== "boolean") {
        throw AppError.badRequest("packingLotRequired boolean olmalı");
      }
      await this.set(SETTING_KEYS.PACKING_LOT_REQUIRED, String(input.packingLotRequired), "Partisiz çuval açma yasak (tablet çuval açamaz)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "packingLotPartialDispatch")) {
      if (typeof input.packingLotPartialDispatch !== "boolean") {
        throw AppError.badRequest("packingLotPartialDispatch boolean olmalı");
      }
      await this.set(SETTING_KEYS.PACKING_LOT_PARTIAL_DISPATCH, String(input.packingLotPartialDispatch), "Sevk partisinin alt kümesi sevk edilebilir (kapalı = parti bütün gider)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingDocPackingLot")) {
      if (typeof input.shippingDocPackingLot !== "boolean") {
        throw AppError.badRequest("shippingDocPackingLot boolean olmalı");
      }
      await this.set(SETTING_KEYS.SHIPPING_DOC_PACKING_LOT, String(input.shippingDocPackingLot), "İrsaliye/çeki listesine parti adı + ambalaj no kolonu", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "shippingSackSeqOnDoc")) {
      if (typeof input.shippingSackSeqOnDoc !== "boolean") throw AppError.badRequest("shippingSackSeqOnDoc boolean olmalı");
      await this.set(SETTING_KEYS.SHIPPING_SACK_SEQ_ON_DOC, String(input.shippingSackSeqOnDoc), "İrsaliye/çeki listesine sevkiyat içi çuval sırası kolonu", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingSackSeqPrefix")) {
      const v = input.shippingSackSeqPrefix;
      // YAZMA yüklemi DAR (okuma yüklemi geniş kalır — eski değer bozulmaz).
      if (typeof v !== "string" || !SHIPPING_SACK_SEQ_PREFIX_WRITE_RE.test(v)) {
        throw AppError.badRequest(
          `Çuval sırası ön eki en çok ${SHIPPING_SACK_SEQ_PREFIX_MAX} karakter: harf, rakam, - _ . ve boşluk ` +
            "(eğik çizgi dosya adını kırar).",
        );
      }
      await this.set(SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX, sanitizeSackSeqPrefix(v), "Sevkiyat içi çuval sırası ön eki (serbest metin, ≤8)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingReturnFootnote")) {
      const v = input.shippingReturnFootnote;
      if (typeof v !== "string" || v.length > SHIPPING_RETURN_FOOTNOTE_MAX) {
        throw AppError.badRequest(`İade irsaliyesi dipnotu en çok ${SHIPPING_RETURN_FOOTNOTE_MAX} karakter olabilir.`);
      }
      await this.set(SETTING_KEYS.SHIPPING_RETURN_FOOTNOTE, sanitizeReturnFootnote(v), "İade irsaliyesi dipnotu (serbest metin, boş = basılmaz)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingSackSeqPrefixLive")) {
      if (typeof input.shippingSackSeqPrefixLive !== "boolean") throw AppError.badRequest("shippingSackSeqPrefixLive boolean olmalı");
      await this.set(SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX_LIVE, String(input.shippingSackSeqPrefixLive), "Ön ek değişince eski belgeler de değişsin (kapalı = sevk anındaki ön ek donar)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingSackSeqStart")) {
      const v = input.shippingSackSeqStart;
      // `null` = alan temizlendi → varsayılan (1). 0 meşru (bazı müşteriler 0'dan sayar).
      if (v !== null) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > SHIPPING_SACK_SEQ_START_MAX) {
          throw AppError.badRequest(`Çuval sırası başlangıcı 0 ile ${SHIPPING_SACK_SEQ_START_MAX} arasında tam sayı olmalı`);
        }
      }
      await this.set(SETTING_KEYS.SHIPPING_SACK_SEQ_START, v === null ? DEFAULT_SHIPPING_SACK_SEQ_START : v, "Sevkiyat içi çuval sırası başlangıç numarası", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahEscalationGraceMinutes")) {
      const v = input.tezgahEscalationGraceMinutes;
      // `null` = alan temizlendi → varsayılan (0 = hedef dolunca patrona). 0 meşru.
      if (v !== null) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > TEZGAH_ESCALATION_GRACE_MINUTES_MAX) {
          throw AppError.badRequest(`İletim payı 0 ile ${TEZGAH_ESCALATION_GRACE_MINUTES_MAX} dakika arasında tam sayı olmalı`);
        }
      }
      await this.set(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, v === null ? DEFAULT_TEZGAH_ESCALATION_GRACE_MINUTES : v, "Tezgah duruşu iletim payı (dk) — hedef süre bu kadar aşılınca patrona iletilir", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahAlarmEnabled")) {
      if (typeof input.tezgahAlarmEnabled !== "boolean") throw AppError.badRequest("tezgahAlarmEnabled boolean olmalı");
      await this.set(SETTING_KEYS.TEZGAH_ALARM_ENABLED, input.tezgahAlarmEnabled, "Dokuma alarm motoru — hedefi aşan duruş alarmı (Tezgah Salonu)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahAlarmUnclassifiedTargetMinutes")) {
      const v = input.tezgahAlarmUnclassifiedTargetMinutes;
      // `null` = boş: sebepsiz duruş izlenmez (0 yazılır, okuyucu null çözer).
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > TEZGAH_ALARM_UNCLASSIFIED_TARGET_MAX)) {
        throw AppError.badRequest(`Sebepsiz duruş hedefi 1 ile ${TEZGAH_ALARM_UNCLASSIFIED_TARGET_MAX} dakika arasında tam sayı olmalı (boş = izlenmez)`);
      }
      await this.set(SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES, v ?? 0, "Sebepsiz bildirilen tezgah duruşunun ortak hedef süresi (dk; 0 = izlenmez)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahAlarmUnclassifiedEnabled")) {
      if (typeof input.tezgahAlarmUnclassifiedEnabled !== "boolean") throw AppError.badRequest("tezgahAlarmUnclassifiedEnabled boolean olmalı");
      await this.set(SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED, input.tezgahAlarmUnclassifiedEnabled, "Sebepsiz bildirilen tezgah duruşunda alarm", userId);
    } else if (Object.prototype.hasOwnProperty.call(input, "tezgahAlarmUnclassifiedTargetMinutes")) {
      // Eski istemci yalnız süreyi yollar: süre = anahtar (boş = kapalı), bugünkü anlamı korunur.
      await this.set(SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED, input.tezgahAlarmUnclassifiedTargetMinutes !== null, "Sebepsiz bildirilen tezgah duruşunda alarm", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahAlarmRenotifyMinutes")) {
      const v = input.tezgahAlarmRenotifyMinutes;
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > TEZGAH_ALARM_RENOTIFY_MINUTES_MAX)) {
        throw AppError.badRequest(`Alarm tekrar aralığı 1 ile ${TEZGAH_ALARM_RENOTIFY_MINUTES_MAX} dakika arasında tam sayı olmalı`);
      }
      await this.set(SETTING_KEYS.TEZGAH_ALARM_RENOTIFY_MINUTES, v ?? DEFAULT_TEZGAH_ALARM_RENOTIFY_MINUTES, "Üstlenilmemiş tezgah alarmının yeniden bildirim aralığı (dk)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahMaxOpenStopHours")) {
      const v = input.tezgahMaxOpenStopHours;
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > TEZGAH_MAX_OPEN_STOP_HOURS_MAX)) {
        throw AppError.badRequest(`Açık kart duruşu sınırı 1 ile ${TEZGAH_MAX_OPEN_STOP_HOURS_MAX} saat arasında tam sayı olmalı`);
      }
      await this.set(SETTING_KEYS.TEZGAH_MAX_OPEN_STOP_HOURS, v ?? DEFAULT_TEZGAH_MAX_OPEN_STOP_HOURS, "Kart duruşu bu kadar saat açık kalırsa geçici kapatılır (sa)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahCollectorSilenceMinutes")) {
      const v = input.tezgahCollectorSilenceMinutes;
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > TEZGAH_COLLECTOR_SILENCE_MINUTES_MAX)) {
        throw AppError.badRequest(`Kart sessizlik eşiği 1 ile ${TEZGAH_COLLECTOR_SILENCE_MINUTES_MAX} dakika arasında tam sayı olmalı`);
      }
      await this.set(SETTING_KEYS.TEZGAH_COLLECTOR_SILENCE_MINUTES, v ?? DEFAULT_TEZGAH_COLLECTOR_SILENCE_MINUTES, "Kart bu kadar dakika istek göndermezse sessiz sayılır (dk)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahAlarmNoShiftMode")) {
      const v = input.tezgahAlarmNoShiftMode;
      if (typeof v !== "string" || !TEZGAH_ALARM_NO_SHIFT_MODES.includes(v as TezgahAlarmNoShiftMode)) {
        throw AppError.badRequest("Vardiyasız alarm kipi 'WARN', 'ALWAYS' veya 'REQUIRE_SHIFT' olmalı");
      }
      await this.set(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, v, "Vardiyasız zamanda tezgah alarmı: WARN (uyar) / ALWAYS (7/24 çal) / REQUIRE_SHIFT (vardiyasız açılmasın)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tezgahAlarmEscalateWhenAcked")) {
      if (typeof input.tezgahAlarmEscalateWhenAcked !== "boolean") throw AppError.badRequest("tezgahAlarmEscalateWhenAcked boolean olmalı");
      await this.set(SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED, input.tezgahAlarmEscalateWhenAcked, "Üstlenilmiş tezgah alarmı da üst kademeye iletilsin", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "shippingSackSeqShowTotal")) {
      if (typeof input.shippingSackSeqShowTotal !== "boolean") throw AppError.badRequest("shippingSackSeqShowTotal boolean olmalı");
      await this.set(SETTING_KEYS.SHIPPING_SACK_SEQ_SHOW_TOTAL, String(input.shippingSackSeqShowTotal), "Çuval sırası etiketinde toplam da yazılsın (3/100)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "packingPoolPackageNo")) {
      const v = input.packingPoolPackageNo;
      if (typeof v !== "string" || !PACKING_POOL_PACKAGE_NO_MODES.includes(v as PackingPoolPackageNo)) {
        throw AppError.badRequest("Partisiz çuval ambalaj no rejimi 'sevkte' veya 'acilista' olmalı");
      }
      await this.set(SETTING_KEYS.PACKING_POOL_PACKAGE_NO, v, "Partisiz çuvalın ambalaj no'su: sevkte (sevk sırası) / acilista (cari havuz sayacı)", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "kursunBypassEnabled")) {
      if (typeof input.kursunBypassEnabled !== "boolean") {
        throw AppError.badRequest("kursunBypassEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KURSUN_BYPASS_ENABLED,
        input.kursunBypassEnabled,
        "Kurşun bypass — kurşun istasyonuna tablet konulmayan düzen (yalnız YENİ dağıtım oluşturmayı kapılar; dağıtılmış işler bypass ile biter)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "kursunMeterCapture")) {
      const v = input.kursunMeterCapture;
      if (typeof v !== "string" || !KURSUN_METER_CAPTURE_MODES.includes(v as KursunMeterCapture)) {
        throw AppError.badRequest(`kursunMeterCapture şunlardan biri olmalı: ${KURSUN_METER_CAPTURE_MODES.join(", ")}`);
      }
      const brodeUnit = Object.prototype.hasOwnProperty.call(input, "financeServiceBillingBrodeUnit") ? input.financeServiceBillingBrodeUnit : await readFinanceServiceBillingBrodeUnit();
      assertBrodeUnitHasPieceInput(brodeUnit as ServiceBillingBrodeUnit, v);
      await this.set(SETTING_KEYS.KURSUN_METER_CAPTURE, v, "Kurşun metre ölçümü — kapalı · yalnız çıkış · giriş + çıkış", userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "kursunSimulatedMeterEnabled")) {
      if (typeof input.kursunSimulatedMeterEnabled !== "boolean") {
        throw AppError.badRequest("kursunSimulatedMeterEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED,
        input.kursunSimulatedMeterEnabled,
        "Kurşun: simüle sayaç okuması kabul edilsin mi (kapalıyken SIMULATED okuma 400)",
        userId
      );
    }

    // H2 sapma politikası — 0 = eşik yok (okuyucu ≤0 → null; tambur kısa kesim emsali).
    if (Object.prototype.hasOwnProperty.call(input, "kursunMeterVarianceThresholdM")) {
      const v = input.kursunMeterVarianceThresholdM;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10_000) {
        throw AppError.badRequest("Kurşun metre sapma eşiği (metre) 0 ile 10.000 arasında olmalı (0 = eşik yok)");
      }
      await this.set(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, v, "Kurşun metre sapma eşiği (metre) — 0 = eşik yok", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "kursunMeterVarianceThresholdPct")) {
      const v = input.kursunMeterVarianceThresholdPct;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
        throw AppError.badRequest("Kurşun metre sapma eşiği (yüzde) 0 ile 100 arasında olmalı (0 = eşik yok)");
      }
      await this.set(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT, v, "Kurşun metre sapma eşiği (yüzde) — 0 = eşik yok", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "kursunMeterVarianceBasis")) {
      const v = input.kursunMeterVarianceBasis;
      if (typeof v !== "string" || !KURSUN_METER_VARIANCE_BASES.includes(v as KursunMeterVarianceBasis)) {
        throw AppError.badRequest(`kursunMeterVarianceBasis şunlardan biri olmalı: ${KURSUN_METER_VARIANCE_BASES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS, v, "Kurşun metre sapma tabanı — bildirilen · ölçülen giriş", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "kursunMeterVarianceApproval")) {
      const v = input.kursunMeterVarianceApproval;
      if (typeof v !== "string" || !KURSUN_METER_VARIANCE_APPROVALS.includes(v as KursunMeterVarianceApproval)) {
        throw AppError.badRequest(`kursunMeterVarianceApproval şunlardan biri olmalı: ${KURSUN_METER_VARIANCE_APPROVALS.join(", ")}`);
      }
      if (v === "OFFICE" && !KURSUN_METER_OFFICE_APPROVAL_SELECTABLE) {
        throw AppError.badRequest("Ofis onayı henüz seçilemez — panelde sapma onay ekranı geldiğinde açılır", {
          code: "METER_APPROVAL_OFFICE_UNAVAILABLE",
        });
      }
      await this.set(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, v, "Kurşun metre sapma onayı — yok · operatör sebebi · süpervizör PIN · ofis", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "kursunMeterStockMode")) {
      const v = input.kursunMeterStockMode;
      if (typeof v !== "string" || !KURSUN_METER_STOCK_MODES.includes(v as KursunMeterStockMode)) {
        throw AppError.badRequest(`kursunMeterStockMode şunlardan biri olmalı: ${KURSUN_METER_STOCK_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.KURSUN_METER_STOCK_MODE, v, "Kurşun çıkış metresi stoğu — yalnız kaydet · stoğa uygula", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "kursunMachineAssignMode")) {
      const v = input.kursunMachineAssignMode;
      if (typeof v !== "string" || !KURSUN_MACHINE_ASSIGN_MODES.includes(v as KursunMachineAssignMode)) {
        throw AppError.badRequest(`kursunMachineAssignMode şunlardan biri olmalı: ${KURSUN_MACHINE_ASSIGN_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.KURSUN_MACHINE_ASSIGN_MODE, v, "Kurşun makinesi ataması — öneri · yalnız atanan makinede (uyarıyla alınır)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "productionRouteMode")) {
      const v = input.productionRouteMode;
      if (typeof v !== "string" || !PRODUCTION_ROUTE_MODES.includes(v as ProductionRouteMode)) {
        throw AppError.badRequest(`productionRouteMode şunlardan biri olmalı: ${PRODUCTION_ROUTE_MODES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.PRODUCTION_ROUTE_MODE, v, "Rota uygulaması — sıralı (plandaki sırayla) · okutmaya göre (esnek)", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "productionScanRouteStations")) {
      const v = input.productionScanRouteStations;
      if (typeof v !== "string" || !PRODUCTION_SCAN_ROUTE_STATIONS_VALUES.includes(v as ProductionScanRouteStations)) {
        throw AppError.badRequest(`productionScanRouteStations şunlardan biri olmalı: ${PRODUCTION_SCAN_ROUTE_STATIONS_VALUES.join(", ")}`);
      }
      await this.set(SETTING_KEYS.PRODUCTION_SCAN_ROUTE_STATIONS, v, "Okutmayla rota istasyonları — seçili istasyonlar · tüm istasyonlar", userId);
    }
    if (Object.prototype.hasOwnProperty.call(input, "scanCustomerCodeLookupEnabled")) {
      if (typeof input.scanCustomerCodeLookupEnabled !== "boolean") {
        throw AppError.badRequest("scanCustomerCodeLookupEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP,
        input.scanCustomerCodeLookupEnabled,
        "Okutmada müşteri barkodu — iç barkod bulunamazsa topun aktif müşteri koduna bakılır",
        userId,
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "batchShortNumberEnabled")) {
      if (typeof input.batchShortNumberEnabled !== "boolean") {
        throw AppError.badRequest("batchShortNumberEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.BATCH_SHORT_NUMBER_ENABLED,
        input.batchShortNumberEnabled,
        "Parti no kısa ve dönen (P01…P99, sonra başa sarar) — kapalıyken P + GGAAYY + günlük sıra",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "qualityGradeRequiredEnabled")) {
      if (typeof input.qualityGradeRequiredEnabled !== "boolean") {
        throw AppError.badRequest("qualityGradeRequiredEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.QUALITY_GRADE_REQUIRED_ENABLED,
        input.qualityGradeRequiredEnabled,
        `Top kalitesi zorunlu — KK1 girişi, Tambur kalan-kuyruk topu, depo kesimi ve ${TERIM.terbiyeIsEmri.tekilKucuk} kapanışının depo/2. kalite satırları kalitesiz geçemez`,
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "batchAutoCreateEnabled")) {
      if (typeof input.batchAutoCreateEnabled !== "boolean") {
        throw AppError.badRequest("batchAutoCreateEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.BATCH_AUTO_CREATE_ENABLED,
        input.batchAutoCreateEnabled,
        "Açık parti yokken sunucu partiyi kendisi açar (elle top eklemede) — 'parti zorunlu' DEĞİL, otomatik parti",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "batchLastNumberHintEnabled")) {
      if (typeof input.batchLastNumberHintEnabled !== "boolean") {
        throw AppError.badRequest("batchLastNumberHintEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.BATCH_LAST_NUMBER_HINT_ENABLED,
        input.batchLastNumberHintEnabled,
        `${TERIM.terbiyeIsEmri.cumleBasi.yalin} formunda 'Son Kullanılan Parti No' rozeti — yalnız gösterim, numara üretimini etkilemez`,
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "customerBranchesEnabled")) {
      if (typeof input.customerBranchesEnabled !== "boolean") {
        throw AppError.badRequest("customerBranchesEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.CUSTOMER_BRANCHES_ENABLED,
        input.customerBranchesEnabled,
        "Müşteri şubeleri (sevk noktaları) özelliğini UI'da göster",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "companyName")) {
      if (typeof input.companyName !== "string") {
        throw AppError.badRequest("companyName metin olmalı");
      }
      const trimmed = input.companyName.trim().slice(0, 120);
      await this.set(
        SETTING_KEYS.COMPANY_NAME,
        trimmed || DEFAULT_COMPANY_NAME,
        "ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "travelerCardConfig")) {
      const c = input.travelerCardConfig;
      if (!c || typeof c !== "object") {
        throw AppError.badRequest("travelerCardConfig nesne olmalı");
      }
      const merged = normalizeTravelerCardConfig(c as unknown as Record<string, unknown>);
      await this.set(
        SETTING_KEYS.TRAVELER_CARD_CONFIG,
        merged as unknown as Prisma.InputJsonValue,
        "Refakat kartı marka/içerik ayarı (firma adı + boyut/pay + bölüm/alan görünürlükleri)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "companyLetterhead")) {
      const c = input.companyLetterhead;
      if (!c || typeof c !== "object") {
        throw AppError.badRequest("companyLetterhead nesne olmalı");
      }
      const merged: CompanyLetterhead = {
        addressLine:
          typeof c.addressLine === "string" ? c.addressLine.trim().slice(0, 200) : "",
        phone: typeof c.phone === "string" ? c.phone.trim().slice(0, 60) : "",
        taxInfo: typeof c.taxInfo === "string" ? c.taxInfo.trim().slice(0, 120) : "",
        extraLines: Array.isArray((c as unknown as Record<string, unknown>).extraLines)
          ? ((c as unknown as Record<string, unknown>).extraLines as unknown[])
              .filter((x): x is string => typeof x === "string")
              .map((x) => x.trim().slice(0, 120))
              .filter(Boolean)
              .slice(0, 5)
          : [],
      };
      await this.set(
        SETTING_KEYS.COMPANY_LETTERHEAD,
        merged as unknown as Prisma.InputJsonValue,
        "Belge künyesi (irsaliye/çeki üst bloğunda basılan adres/telefon/vergi)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "companyLegalIdentity")) {
      const c = input.companyLegalIdentity;
      if (!c || typeof c !== "object" || Array.isArray(c)) {
        throw AppError.badRequest("Resmi künye nesne olmalı");
      }
      await this.set(
        SETTING_KEYS.COMPANY_LEGAL_IDENTITY,
        sanitizeCompanyLegalIdentity(c) as unknown as Prisma.InputJsonValue,
        "Gönderici resmi künyesi (VKN/TCKN, unvan, vergi dairesi, adres — e-belge kimliği)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "eIrsaliyeConfig")) {
      // Fail-closed: tanınmayan bağdaştırıcı `yok`a düşürülmez, 400 (Zod'u atlayan çağıran için de).
      const r = validateEIrsaliyeConfigInput(input.eIrsaliyeConfig);
      if (!r.ok) throw AppError.badRequest(r.message, { code: "EIRSALIYE_CONFIG_INVALID" });
      await this.set(
        SETTING_KEYS.EIRSALIYE_CONFIG,
        r.value as unknown as Prisma.InputJsonValue,
        "e-İrsaliye yapılandırması (bağdaştırıcı + yürürlük tarihi)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "documentsConfig")) {
      const c = input.documentsConfig;
      if (!c || typeof c !== "object" || Array.isArray(c)) {
        throw AppError.badRequest("documentsConfig nesne olmalı");
      }
      await this.set(
        SETTING_KEYS.DOCUMENTS_CONFIG,
        sanitizeDocumentsConfig(c) as unknown as Prisma.InputJsonValue,
        "Yazdırılan belge içerik ayarı (bölüm görünürlükleri + başlık/imza/footer)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tamburListByStationEnabled")) {
      if (typeof input.tamburListByStationEnabled !== "boolean") {
        throw AppError.badRequest("tamburListByStationEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_LIST_BY_STATION_ENABLED,
        input.tamburListByStationEnabled,
        "Tambur: tablet açık kart listesi yalnız oturum istasyonunun işlerini göstersin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "machineStopTrackingEnabled")) {
      if (typeof input.machineStopTrackingEnabled !== "boolean") {
        throw AppError.badRequest("machineStopTrackingEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED,
        input.machineStopTrackingEnabled,
        "Üretim: dokuma kapalıyken de kurşun/tambur/brode makinesi duruşu kaydedilsin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "machineStopOpenWarningEnabled")) {
      if (typeof input.machineStopOpenWarningEnabled !== "boolean") {
        throw AppError.badRequest("machineStopOpenWarningEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.MACHINE_STOP_OPEN_WARNING_ENABLED,
        input.machineStopOpenWarningEnabled,
        "Üretim: makine duruştayken tablette gramaj/metre dokunuşu uyarısı gösterilsin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tamburShortCutA1Enabled")) {
      if (typeof input.tamburShortCutA1Enabled !== "boolean") {
        throw AppError.badRequest("tamburShortCutA1Enabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_SHORT_CUT_A1_ENABLED,
        input.tamburShortCutA1Enabled,
        "Tambur: kesim uzunluğu eşiğin altındaysa kalite otomatik A1 yazılsın (fabrika varsayılanı)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "tamburShortCutA1ThresholdM")) {
      const v = input.tamburShortCutA1ThresholdM;
      // NULL = "eşiği temizle" (kural inert kalır) — bilinçli olarak geçerli bir
      // değer; bayrağı kapatmadan kuralı etkisizleştirmenin yolu budur.
      if (v !== null) {
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 10_000) {
          throw AppError.badRequest("Kısa kesim eşiği 0 ile 10.000 metre arasında olmalı");
        }
      }
      await this.set(
        SETTING_KEYS.TAMBUR_SHORT_CUT_A1_THRESHOLD_M,
        // ⚠️ `set()` `InputJsonValue` alır — TS'te ne `null` ne `Prisma.JsonNull`
        // geçer. Eşiği TEMİZLEMENİN kaydı `0`dır: okuma tarafı (`parsed <= 0 →
        // null`) bunu "eşik girilmemiş"e çözer, yani depoda tek bir "boş" değeri
        // olur ve `asNumber`ın null dalıyla aynı sonucu verir.
        v === null ? 0 : v,
        "Tambur kısa kesim eşiği (metre) — altındaki kesimler A1 yazılır",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "fasonShrinkWarnEnabled")) {
      if (typeof input.fasonShrinkWarnEnabled !== "boolean") {
        throw AppError.badRequest("fasonShrinkWarnEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FASON_SHRINK_WARN_ENABLED,
        input.fasonShrinkWarnEnabled,
        "Fason kabulünde çekme (giden↔dönen metraj farkı) uyarısı göster",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "fasonReceiptApplyTargetVariant")) {
      if (typeof input.fasonReceiptApplyTargetVariant !== "boolean") {
        throw AppError.badRequest("fasonReceiptApplyTargetVariant boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.FASON_RECEIPT_APPLY_TARGET_VARIANT,
        input.fasonReceiptApplyTargetVariant,
        "Fason kabulünde hedef desen/çeşit değeri doğan topa yazılsın",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "tamburPlanGateWidthToleranceCm")) {
      const v = input.tamburPlanGateWidthToleranceCm;
      // null = varsayılana dön (fasonShrinkTolerancePct emsali); 0 GEÇERLİ ("her farkta sor").
      if (v !== null) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > TAMBUR_PLAN_WIDTH_TOLERANCE_MAX_CM) {
          throw AppError.badRequest(
            `Tambur en eşiği 0 ile ${TAMBUR_PLAN_WIDTH_TOLERANCE_MAX_CM} cm arasında olmalı`,
          );
        }
      }
      await this.set(
        SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM,
        v === null ? TAMBUR_PLAN_WIDTH_TOLERANCE_CM : v,
        "Tambur plan kapısı en eşiği (cm) — top eni ile plan eni farkı bunu AŞARSA onay sorulur",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "tamburPlanGateWidthCheck")) {
      const v = input.tamburPlanGateWidthCheck;
      if (typeof v !== "string" || !TAMBUR_PLAN_WIDTH_CHECKS.includes(v as TamburPlanWidthCheck)) {
        throw AppError.badRequest("Tambur en kontrolü ENFORCE ya da OFF olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK,
        v,
        "Tambur plan kapısı en kontrolü: ENFORCE (sor) | OFF (en kolunu atla; renk kapısı aynı kalır)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "tamburChildWidthSource")) {
      const v = input.tamburChildWidthSource;
      if (typeof v !== "string" || !TAMBUR_CHILD_WIDTH_SOURCES.includes(v as TamburChildWidthSource)) {
        throw AppError.badRequest("Tambur çocuk top en kaynağı WO_TARGET_FIRST ya da MEASURED_FIRST olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE,
        v,
        "Tambur finalize çocuk top eni: WO_TARGET_FIRST (hedef en, yoksa ana top) | MEASURED_FIRST (ölçülmüş ana top eni önce)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "tamburLabelPrintTiming")) {
      const v = input.tamburLabelPrintTiming;
      if (typeof v !== "string" || !TAMBUR_LABEL_PRINT_TIMINGS.includes(v as TamburLabelPrintTiming)) {
        throw AppError.badRequest("Tambur etiket basım zamanı EACH ya da END olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_LABEL_PRINT_TIMING,
        v,
        "Tambur etiket basım zamanı: EACH (her top kesilince) | END (iş bitince toplu)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "fasonShrinkTolerancePct")) {
      const v = input.fasonShrinkTolerancePct;
      // ⚠️ `null` = "alanı temizledim" → FABRİKA VARSAYILANINA döner (0 DEĞİL).
      // Kısa-kesim eşiğinin `null → 0 → kural inert` kalıbı burada YANLIŞ olurdu:
      // orada boş bırakmak kuralı susturur, burada susturan şey BAYRAKtır ve boş
      // bırakılan bir eşiği "sıfır tolerans"a çevirmek, sessizlik bekleyen
      // kullanıcıya HER kabulde uyarı bastırırdı — tam tersi.
      // `0` API'den GEÇERLİDİR ("tolerans yok"); panel 1-100 aralığı sunar.
      if (v !== null) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
          throw AppError.badRequest("Çekme toleransı 0 ile 100 arasında olmalı (yüzde)");
        }
      }
      await this.set(
        SETTING_KEYS.FASON_SHRINK_TOLERANCE_PCT,
        v === null ? DEFAULT_FASON_SHRINK_TOLERANCE_PCT : v,
        "Fason kabulünde çekme toleransı (yüzde) — altındaki fark uyarı üretmez",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "demoModeEnabled")) {
      if (typeof input.demoModeEnabled !== "boolean") {
        throw AppError.badRequest("demoModeEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DEMO_MODE_ENABLED,
        input.demoModeEnabled,
        "Demo kurulumu — senaryo üreticileri ve DEMO rozeti",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "duplicatesFuzzyEnabled")) {
      if (typeof input.duplicatesFuzzyEnabled !== "boolean") {
        throw AppError.badRequest("duplicatesFuzzyEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DUPLICATES_FUZZY_ENABLED,
        input.duplicatesFuzzyEnabled,
        "Mükerrer paneli — bulanık ad eşleştirme açık mı",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "duplicatesFuzzyThresholdPct")) {
      const v = input.duplicatesFuzzyThresholdPct;
      // `null` = "alanı temizledim" → fabrika varsayılanına (90) döner; çekme
      // toleransıyla aynı kalıp. Alt sınır 50: canlı ölçümde 70 bile kumaşta 26
      // yanlış pozitif üretti — daha düşüğü gürültüdür.
      if (v !== null) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < DUPLICATES_FUZZY_MIN_PCT || v > 100) {
          throw AppError.badRequest(
            `Bulanık benzerlik eşiği ${DUPLICATES_FUZZY_MIN_PCT} ile 100 arasında olmalı (yüzde)`,
          );
        }
      }
      await this.set(
        SETTING_KEYS.DUPLICATES_FUZZY_THRESHOLD_PCT,
        v === null ? DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT : v,
        "Mükerrer paneli — bulanık ad benzerlik eşiği (yüzde)",
        userId
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "tamburOverQuantityEnabled")) {
      if (typeof input.tamburOverQuantityEnabled !== "boolean") {
        throw AppError.badRequest("tamburOverQuantityEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED,
        input.tamburOverQuantityEnabled,
        "Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin (aşımda parent top tamamen tüketilir)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tamburUndoFullSameDayOnly")) {
      if (typeof input.tamburUndoFullSameDayOnly !== "boolean") {
        throw AppError.badRequest("tamburUndoFullSameDayOnly boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_UNDO_FULL_SAME_DAY_ONLY,
        input.tamburUndoFullSameDayOnly,
        "Tambur 'tümden geri al' yalnız aynı fabrika günü içinde yapılabilsin (tek parça iptali etkilenmez)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tamburSimulatedMeterEnabled")) {
      if (typeof input.tamburSimulatedMeterEnabled !== "boolean") {
        throw AppError.badRequest("tamburSimulatedMeterEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_SIMULATED_METER_ENABLED,
        input.tamburSimulatedMeterEnabled,
        "Tambur: simüle sayaç metresi kabul edilsin mi (kapalıyken SIMULATED kesim 400)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tamburMeasureSourceRequired")) {
      if (typeof input.tamburMeasureSourceRequired !== "boolean") {
        throw AppError.badRequest("tamburMeasureSourceRequired boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_MEASURE_SOURCE_REQUIRED,
        input.tamburMeasureSourceRequired,
        "Tambur: kesim metresinin ölçüm kaynağı zorunlu (önce tüm tabletler yeni sürümde olmalı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "tamburCalibrationCheck")) {
      const v = input.tamburCalibrationCheck;
      if (typeof v !== "string" || !TAMBUR_CALIBRATION_CHECK_MODES.includes(v as TamburCalibrationCheck)) {
        throw AppError.badRequest("Sayaç kalibrasyon kontrolü KAPALI ya da UYAR olmalı");
      }
      await this.set(
        SETTING_KEYS.TAMBUR_CALIBRATION_CHECK,
        v,
        "Sayaç kalibrasyonu: KAPALI | UYAR (süresi geçmiş sayaçla ölçümde uyarı; ölçüm engellenmez)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "sessionDurationHours")) {
      const v = input.sessionDurationHours;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 1 ||
        v > MAX_SESSION_DURATION_HOURS
      ) {
        throw AppError.badRequest(
          `Oturum süresi 1–${MAX_SESSION_DURATION_HOURS} saat aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_SESSION_DURATION_HOURS,
        Math.floor(v),
        "Oturum (JWT token) ömrü, saat — giriş sonrası token kaç saat geçerli kalır",
        userId
      );
      // F232: enforcement/UI dakika anahtarını okur (readSessionDurationMinutes
      // önce dakikayı, yoksa saati baz alır). Saat güncellenince dakika kaynağı
      // bayat kalmasın diye türetilmiş dakikayı da yaz.
      await this.set(
        SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES,
        Math.min(Math.floor(v) * 60, MAX_SESSION_DURATION_MINUTES),
        "Oturum ömrü, dakika — saat ayarından türetildi",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "sessionDurationMinutes")) {
      const v = input.sessionDurationMinutes;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < 1 ||
        v > MAX_SESSION_DURATION_MINUTES
      ) {
        throw AppError.badRequest(
          `Oturum süresi 1–${MAX_SESSION_DURATION_MINUTES} dakika aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES,
        Math.floor(v),
        "Oturum (JWT token) ömrü, dakika — giriş sonrası token kaç dakika geçerli kalır",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "idleTimeoutMinutes")) {
      const v = input.idleTimeoutMinutes;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > MAX_IDLE_TIMEOUT_MINUTES
      ) {
        throw AppError.badRequest(
          `Hareketsizlik zaman aşımı 0–${MAX_IDLE_TIMEOUT_MINUTES} dakika aralığında olmalı (0 = kapalı)`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_IDLE_TIMEOUT_MINUTES,
        Math.floor(v),
        "Hareketsizlik zaman aşımı, dakika — panel bu kadar süre işlem görmezse otomatik çıkış (0 = kapalı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "workSessionIdleTimeoutMinutes")) {
      const v = input.workSessionIdleTimeoutMinutes;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > MAX_WORK_SESSION_IDLE_MINUTES
      ) {
        throw AppError.badRequest(
          `Çalışma oturumu zaman aşımı 0–${MAX_WORK_SESSION_IDLE_MINUTES} dakika aralığında olmalı (0 = kapalı)`
        );
      }
      await this.set(
        SETTING_KEYS.WORK_SESSION_IDLE_TIMEOUT_MINUTES,
        Math.floor(v),
        "Çalışma oturumu (kim hangi makinede) hareketsizlik zaman aşımı, dakika — tembel IDLE kapatma (0 = kapalı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "sameTypeSessionPolicy")) {
      const v = input.sameTypeSessionPolicy;
      if (typeof v !== "string" || !SAME_TYPE_SESSION_POLICIES.includes(v as SameTypeSessionPolicy)) {
        throw AppError.badRequest(
          "Aynı-tip oturum politikası 'kick', 'notify' veya 'off' olmalı"
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY,
        v,
        "Aynı cihaz-tipinden 2. girişte davranış: kick (eskiyi düşür) / notify (sor) / off (serbest)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "autoLogoutOnExpiry")) {
      if (typeof input.autoLogoutOnExpiry !== "boolean") {
        throw AppError.badRequest("autoLogoutOnExpiry boolean olmalı");
      }
      if (!input.autoLogoutOnExpiry && isHostedInstallation()) {
        throw AppError.conflict(
          "Barındırılan (bulut) kurulumda süresi dolan oturum otomatik kapanır — bu kural kapatılamaz.",
          { code: "HOSTED_CLASS_FORCED" },
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY,
        input.autoLogoutOnExpiry,
        "Token süresi dolunca istemci otomatik çıkış yapsın (mobil + Electron)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "mobileIdleLockEnabled")) {
      if (typeof input.mobileIdleLockEnabled !== "boolean") {
        throw AppError.badRequest("mobileIdleLockEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.AUTH_MOBILE_IDLE_LOCK_ENABLED,
        input.mobileIdleLockEnabled,
        "Mobil hareketsizlik ekran kilidi açık olsun (tablet belirli süre dokunulmazsa kilitlenir)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "mobileLockOnBackground")) {
      if (typeof input.mobileLockOnBackground !== "boolean") {
        throw AppError.badRequest("mobileLockOnBackground boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.AUTH_MOBILE_LOCK_ON_BACKGROUND,
        input.mobileLockOnBackground,
        "Mobil uygulama arka plana geçince (operatör uygulamadan çıkınca) anında kilitlensin",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "mobileOfflineLockDefer")) {
      if (typeof input.mobileOfflineLockDefer !== "boolean") {
        throw AppError.badRequest("mobileOfflineLockDefer boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.AUTH_MOBILE_OFFLINE_LOCK_DEFER,
        input.mobileOfflineLockDefer,
        "İnternet/sunucu bağlantısı yokken tablet kilitlenmesin (bağlantı dönünce kilit süresi yeniden başlar)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "rememberLastUser")) {
      if (typeof input.rememberLastUser !== "boolean") {
        throw AppError.badRequest("rememberLastUser boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.AUTH_REMEMBER_LAST_USER,
        input.rememberLastUser,
        "Girişte son kullanıcıyı hatırla (yalnız parola sorulur)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "mobileIdleLockMinutes")) {
      const v = input.mobileIdleLockMinutes;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < MIN_MOBILE_IDLE_LOCK_MINUTES ||
        v > MAX_MOBILE_IDLE_LOCK_MINUTES
      ) {
        throw AppError.badRequest(
          `Mobil idle kilit süresi ${MIN_MOBILE_IDLE_LOCK_MINUTES}–${MAX_MOBILE_IDLE_LOCK_MINUTES} dakika aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_MOBILE_IDLE_LOCK_MINUTES,
        Math.floor(v),
        "Mobil idle ekran kilidi süresi, dakika — tablet bu kadar süre dokunulmazsa kilitlenir",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "absoluteSessionCapDays")) {
      const v = input.absoluteSessionCapDays;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < 0 ||
        v > MAX_ABSOLUTE_SESSION_CAP_DAYS
      ) {
        throw AppError.badRequest(
          `Mutlak oturum tavanı 0–${MAX_ABSOLUTE_SESSION_CAP_DAYS} gün aralığında olmalı (0 = ${UNSET_ABSOLUTE_SESSION_CAP_DAYS} gün sert tavan)`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS,
        Math.floor(v),
        `Mutlak oturum tavanı, gün — zaman aşımı kapalı olsa bile token en fazla bu kadar gün yaşar (0 = ${UNSET_ABSOLUTE_SESSION_CAP_DAYS} gün sert tavan)`,
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "pinLockoutEnabled")) {
      if (typeof input.pinLockoutEnabled !== "boolean") {
        throw AppError.badRequest("pinLockoutEnabled boolean olmalı");
      }
      if (!input.pinLockoutEnabled) {
        throw AppError.badRequest(PIN_LOCKOUT_REQUIRED_MESSAGE, { code: "PIN_LOCKOUT_REQUIRED" });
      }
      await this.set(
        SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED,
        input.pinLockoutEnabled,
        "Giriş deneme kilidi (kapatılamaz; yalnız true yazılır)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "backupHour")) {
      const v = input.backupHour;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < MIN_BACKUP_HOUR ||
        v > MAX_BACKUP_HOUR
      ) {
        throw AppError.badRequest(
          `Otomatik yedek saati ${MIN_BACKUP_HOUR}–${MAX_BACKUP_HOUR} aralığında bir tam sayı olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.BACKUP_HOUR,
        v,
        "Otomatik gece yedeğinin saati (0-23, sunucu yerel saati)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "pinLockoutAttempts")) {
      const v = input.pinLockoutAttempts;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < MIN_PIN_LOCKOUT_ATTEMPTS ||
        v > MAX_PIN_LOCKOUT_ATTEMPTS
      ) {
        throw AppError.badRequest(
          `İzin verilen yanlış deneme sayısı ${MIN_PIN_LOCKOUT_ATTEMPTS}–${MAX_PIN_LOCKOUT_ATTEMPTS} aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS,
        Math.floor(v),
        "Hızlı PIN/kart girişinde kilit tetiklenene kadar izin verilen ardışık yanlış deneme sayısı",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "pinLockoutPenaltySec")) {
      const v = input.pinLockoutPenaltySec;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < MIN_PIN_LOCKOUT_PENALTY_SEC ||
        v > MAX_PIN_LOCKOUT_PENALTY_SEC
      ) {
        throw AppError.badRequest(
          `Ceza süresi ${MIN_PIN_LOCKOUT_PENALTY_SEC}–${MAX_PIN_LOCKOUT_PENALTY_SEC} saniye aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC,
        Math.floor(v),
        "Hızlı PIN/kart deneme kilidi kısa ceza süresi, saniye",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "pinLockoutEscalateAfter")) {
      const v = input.pinLockoutEscalateAfter;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < MIN_PIN_LOCKOUT_ESCALATE_AFTER ||
        v > MAX_PIN_LOCKOUT_ESCALATE_AFTER
      ) {
        throw AppError.badRequest(
          `Uzun ceza eşiği ${MIN_PIN_LOCKOUT_ESCALATE_AFTER}–${MAX_PIN_LOCKOUT_ESCALATE_AFTER} tur aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER,
        Math.floor(v),
        "Hızlı PIN/kart deneme kilidi: kaç ceza turundan sonra uzun cezaya geçilir",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "pinLockoutLongPenaltyMin")) {
      const v = input.pinLockoutLongPenaltyMin;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < MIN_PIN_LOCKOUT_LONG_PENALTY_MIN ||
        v > MAX_PIN_LOCKOUT_LONG_PENALTY_MIN
      ) {
        throw AppError.badRequest(
          `Uzun ceza süresi ${MIN_PIN_LOCKOUT_LONG_PENALTY_MIN}–${MAX_PIN_LOCKOUT_LONG_PENALTY_MIN} dakika aralığında olmalı`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN,
        Math.floor(v),
        "Hızlı PIN/kart deneme kilidi uzun ceza süresi, dakika",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "loginMethods")) {
      const v = input.loginMethods;
      const valid =
        v &&
        typeof v === "object" &&
        Array.isArray(v.enabled) &&
        v.enabled.length > 0 &&
        v.enabled.every((m) => LOGIN_METHODS.includes(m)) &&
        new Set(v.enabled).size === v.enabled.length &&
        LOGIN_METHODS.includes(v.primary) &&
        v.enabled.includes(v.primary);
      if (!valid) {
        throw AppError.badRequest(
          "Giriş yöntemleri geçersiz — en az bir yöntem (list/pin/card) etkin olmalı ve öncelikli yöntem etkinlerden biri olmalı",
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_LOGIN_METHODS,
        { enabled: v.enabled, primary: v.primary },
        "Mobil giriş yöntemleri: list (kullanıcı+şifre), pin (salt hızlı-PIN), card (QR kart) + öncelikli yöntem",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "labelCopies")) {
      const v = input.labelCopies;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > LABEL_COPIES_MAX) {
        throw AppError.badRequest(`Etiket kopya adedi 1–${LABEL_COPIES_MAX} aralığında olmalı`);
      }
      await this.set(
        SETTING_KEYS.LABEL_COPIES,
        Math.floor(v),
        "Top etiketi kopya adedi — bir baskıda kaç etiket çıkar (üst+alt için 2)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "labelCustomerCodeMissing")) {
      const v = input.labelCustomerCodeMissing;
      if (typeof v !== "string" || !LABEL_CUSTOMER_CODE_MISSING_MODES.includes(v as LabelCustomerCodeMissing)) {
        throw AppError.badRequest("Müşteri barkodu yoksa davranışı BLOCK ya da ROLL_BARCODE olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_CUSTOMER_CODE_MISSING,
        v,
        "Müşteri barkodu basan şablonda top kodsuzsa: BLOCK (basma, 400) | ROLL_BARCODE (iç barkod + uyarı)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "labelCustomerCodeAt")) {
      const v = input.labelCustomerCodeAt;
      if (typeof v !== "string" || !LABEL_CUSTOMER_CODE_AT_MODES.includes(v as LabelCustomerCodeAt)) {
        throw AppError.badRequest("Müşteri barkodunun doğduğu yer NONE ya da TAMBUR_OUTPUT olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_CUSTOMER_CODE_AT,
        v,
        "Müşteri barkodu nerede doğar: NONE (doğmaz) | TAMBUR_OUTPUT (Tambur çıkışında müşterinin serisinden)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "labelCopiesSource")) {
      const v = input.labelCopiesSource;
      if (typeof v !== "string" || !LABEL_COPIES_SOURCES.includes(v as LabelCopiesSource)) {
        throw AppError.badRequest("Etiket adedi kaynağı GLOBAL ya da STATION olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_COPIES_SOURCE,
        v,
        "Etiket adedini kim belirler: GLOBAL (sistem geneli) | STATION (istasyon; varsayılanı istasyon kartında)",
        userId
      );
    }


    if (Object.prototype.hasOwnProperty.call(input, "nativeSendEnabled")) {
      if (typeof input.nativeSendEnabled !== "boolean") {
        throw AppError.badRequest("nativeSendEnabled boolean olmalı");
      }
      if (input.nativeSendEnabled && isHostedInstallation()) {
        throw AppError.conflict(
          "Barındırılan (bulut) kurulumda sunucudan yazıcıya doğrudan gönderim kapalıdır — bu kural açılamaz.",
          { code: "HOSTED_CLASS_FORCED" },
        );
      }
      await this.set(
        SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED,
        input.nativeSendEnabled,
        "Faz-2: native etiket komutlarını yazıcıya doğrudan (RAW TCP 9100) gönder (kapalıyken simülasyon)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "mobileRasterEnabled")) {
      if (typeof input.mobileRasterEnabled !== "boolean") {
        throw AppError.badRequest("mobileRasterEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_MOBILE_RASTER_ENABLED,
        input.mobileRasterEnabled,
        "Mobil (HC-06/BT) baskıda raster GW bitmap gönder (kapalıyken komut yolu — hızlı/güvenli)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "scrapGradeLabelEnabled")) {
      if (typeof input.scrapGradeLabelEnabled !== "boolean") {
        throw AppError.badRequest("scrapGradeLabelEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_SCRAP_GRADE_ENABLED,
        input.scrapGradeLabelEnabled,
        "Fire (etiketsiz işaretli) kalitede de otomatik etiket bas (kapalıyken fire topa kâğıt çıkmaz)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "patronBulutOlayGudumluEnabled")) {
      if (typeof input.patronBulutOlayGudumluEnabled !== "boolean") {
        throw AppError.badRequest("patronBulutOlayGudumluEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.PATRON_BULUT_OLAY_GUDUMLU,
        input.patronBulutOlayGudumluEnabled,
        "Patron bulutu: değişiklik olunca anında gönder (3 sn birleştirme); kapalıysa yalnız kira aralığı",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "bildirimGelenKutusuEnabled")) {
      if (typeof input.bildirimGelenKutusuEnabled !== "boolean") {
        throw AppError.badRequest("bildirimGelenKutusuEnabled boolean olmalı");
      }
      // Su damgası: kapanışta ya da kapalıdan açılışta düşer → koşul türleri yeniden bildirimsiz taban alır.
      const wasEnabled = await readNotificationInboxEnabled();
      await this.set(
        SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED,
        input.bildirimGelenKutusuEnabled,
        "Yeni bildirim gelen kutusu: açıkken zil kişisel gelen kutusunu gösterir; kapalıyken bugünkü davranış",
        userId
      );
      if (!(wasEnabled && input.bildirimGelenKutusuEnabled)) await resetNotificationBaselines(prisma);
    }

    if (Object.prototype.hasOwnProperty.call(input, "documentDesignerEnabled")) {
      if (typeof input.documentDesignerEnabled !== "boolean") {
        throw AppError.badRequest("documentDesignerEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED,
        input.documentDesignerEnabled,
        "Belge tasarımcısı: açıkken yeni basılan belgeler atanan şablonla basılır; kapalıyken Sistem tasarımı",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "documentPublishSodEnabled")) {
      if (typeof input.documentPublishSodEnabled !== "boolean") {
        throw AppError.badRequest("documentPublishSodEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED,
        input.documentPublishSodEnabled,
        "Belge şablonu yayını: açıkken sürümü tasarlayan kişi onu yayınlayamaz",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "defaultLabelMedia")) {
      const c = input.defaultLabelMedia;
      if (!c || typeof c !== "object") throw AppError.badRequest("defaultLabelMedia nesne olmalı");
      const range = (v: unknown, lo: number, hi: number, label: string) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < lo || n > hi) throw AppError.badRequest(`${label} ${lo}–${hi} aralığında olmalı`);
        return n;
      };
      const media: DefaultLabelMedia = {
        widthMm: range(c.widthMm, 10, 500, "Etiket eni (mm)"),
        heightMm: range(c.heightMm, 10, 500, "Etiket boyu (mm)"),
        dpi: Math.floor(range(c.dpi, 50, 1200, "DPI")),
        gapMm: range(c.gapMm, 0, 50, "Etiket arası boşluk (mm)"),
        marginMm: range(c.marginMm, 0, 50, "Pay (mm)"),
      };
      await this.set(
        SETTING_KEYS.LABEL_DEFAULT_MEDIA,
        media as unknown as Prisma.InputJsonValue,
        "Sistem varsayılan etiket medyası — cihazsız baskı/önizleme (yazıcı cihazı seçiliyse onun medyası öncelikli)",
        userId
      );
    }

    const flags = await this.getFeatureFlags();
    // Çıkış uyarısı — iki ayardan biri bu kayıtta yazıldıysa ETKİN birleşim ölçülür (iki yön).
    if (
      Object.prototype.hasOwnProperty.call(input, "itemPhaseOutNewOrder") ||
      Object.prototype.hasOwnProperty.call(input, "shippingOrderRequirement")
    ) {
      const w = phaseOutExitWarning(await readItemPhaseOutNewOrder(), await readShippingOrderRequirement());
      if (w) return { ...flags, warnings: [...(flags.warnings ?? []), w] };
    }
    return flags;
  }
