// =============================================================================
// TeksERP - System Setting / feature-flags-read
// =============================================================================
// Özellik bayrakları önbelleği (TEK kopya) + getFeatureFlags okuması + cihaz kanıtı önbelleği.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import { REPORT_BY_KEY, isRetiredReportKey } from "../../constants/report-catalog";
import { isHostedInstallation } from "../helpers/install-class.helper";
import { ApiResponse } from "../../types/api.types";
import prisma from "../../lib/prisma";
import { readConsumableStockEnabled, readCostFinishingKgBasis, readCostPresentationCurrency, readCostProfitCategoryClasses, readCostProfitConsumablePriceSource, readCostProfitMachineTime, readCostProfitOverheadKey, readCostProfitSubcontractSource, readCostWeavingStandardMethod, readFinanceAllowZeroPriceLineEnabled, readFinanceAutoAllocateOnPaymentEnabled, readFinanceCariHoldEmanetShipment, readFinanceCariHoldReleaseBySamePerson, readFinanceFutureDatedDocumentBlockEnabled, readFinanceRiskLimitCurrencyMode, readFinanceYarnOutOnInvoiceEnabled, readGoodsReceiptRequirePriceEnabled, readGoodsReceiptYarnQualityHoldEnabled, readOrderProductionProposal, readProductionCancelReasonRequired, readPurchaseBlockOverReceiptEnabled, readYarnBlockNegativeBalanceEnabled } from "./cost-purchase";
import { readDeviceAutoReattach, readDevicePairingRequired, readDeviceProofRequired, readDeviceUnpairedPasswordLogin, readShortCredentialApprovedDeviceOnly, readShortCredentialTotpRequired, readTrustedDeviceDays, readWebTotpPolicy } from "./device-auth";
import { readCompanyLegalIdentity, readCompanyLetterhead, readDocumentsConfig, readEIrsaliyeConfig } from "./documents";
import { applyTermRegime, settingMapClient } from "./feature-flags-read-helpers";
import { withLicenseBlock, type CachedFeatureFlags, type FeatureFlags } from "./feature-flags-types";
import { readFinanceAutoDraftFromShipmentEnabled, readFinanceBlockNegativeCashEnabled, readFinanceCariHoldDefaultScope, readFinanceChequeNoteMovementEnabled, readFinanceDefaultVatRate, readFinanceEnabledRaw, readFinanceExpenseAllocationClosedWorkOrder, readFinanceExpenseAllocationField, readFinanceExpenseCategorySuggestions, readFinanceInvoiceMatchTolerance, readFinanceInvoicePriceTolerancePct, readFinanceInvoiceQtyTolerancePct, readFinanceKursunGramPriceBasis, readFinanceRiskLimitBlockEnabled, readFinanceRiskLimitBlockIntake, readFinanceRiskLimitBlockShipment, readFinanceServiceBillingBrodeUnit, readFinanceServiceBillingStepWorks, readFinanceServiceBillingWeavingWorks, readFinanceServiceBillingEnabled, readFinanceServiceBillingMeterBasis, readFinanceServiceBillingMissingMeter, readFinanceServiceBillingPriceDate, readFinanceServiceBillingTrigger, readFinanceWithholdingDenominator, readFinanceWithholdingEnabled, readFinanceWithholdingNumerator, readFinancePurchaseWithholdingDenominator, readFinancePurchaseWithholdingEnabled, readFinancePurchaseWithholdingNumerator, readPricingEnabled } from "./finance";
import { publicTimezoneWarning, readCompanyName, readFactoryTimezonePeriods } from "./general";
import { readBatchAutoCreateEnabled, readBatchLastNumberHintEnabled, readBatchShortNumberEnabled, readKursunBypassEnabled, readKursunMachineAssignMode, readKursunMeterCapture, readKursunMeterStockMode, readKursunMeterVarianceApproval, readKursunMeterVarianceBasis, readKursunMeterVarianceThresholdM, readKursunMeterVarianceThresholdPct, readKursunSimulatedMeterEnabled, readProductionRouteMode, readProductionScanRouteStations, readQualityGradeRequiredEnabled, readScanCustomerCodeLookupEnabled } from "./kursun-batch";
import { readDefaultLabelMedia, readDocumentDesignerEnabled, readDocumentPublishSodEnabled, readLabelCopies, readLabelCopiesSource, readLabelCustomerCodeAt, readLabelCustomerCodeMissing, readLabelNativeSendEnabled, readMobileRasterEnabled, readNotificationInboxEnabled, readPatronBulutOlayGudumluEnabled, readPatronPushEnabled, readScrapGradeLabelEnabled } from "./labels";
import { readDepoMultiEnabledRaw, readDevereAutoConsume, readDevereBeamWeavingLinkRequired, readDevereEnabledRaw, readDevereLotRequired, readDevereMountTracking, readDevereMountTrackingRequired, readDokumaEnabledRaw, readDokumaOrderLineLinkRequired, readDokumaRollBirth, readDokumaRunWeavingOrderRequired, readDokumaWeavingWastePct, readDokumaYarnReservationEnabled, readEmanetEnabledRaw, readGelenBelgeEnabledRaw, readIplikEnabledRaw, readKaliteGuvenceEnabledRaw, readKumasTeknikEnabledRaw, readMaliyetEnabledRaw, readProductionEnabledRaw, readReportsClosedKeys, readTezgahEnabledRaw, readTicaretEnabledRaw } from "./modules";
import { readPackageNoMode, readPackageNoStartsAtZero, readPackageNumbering, readPackingGroupMode, readPackingGroupNumbering, readPackingGroupsEnabled, readPackingLotPartialDispatch, readPackingLotRequired, readPackingPoolPackageNo, readSackDumpNameMode, readShippingDocPackingLot, readShippingReturnFootnote, readShippingSackSeqOnDoc, readShippingSackSeqPrefix, readShippingSackSeqPrefixLive, readShippingSackSeqShowTotal, readShippingSackSeqStart, readTezgahAlarmEnabled, readTezgahAlarmEscalateWhenAcked, readTezgahAlarmNoShiftMode, readTezgahAlarmRenotifyMinutes, readTezgahAlarmUnclassifiedEnabled, readTezgahAlarmUnclassifiedTargetMinutes, readTezgahCollectorSilenceMinutes, readTezgahEscalationGraceMinutes, readTezgahMaxOpenStopHours } from "./packing-loom";
import { readBackupHour, readLoginMethods, readPinLockoutAttempts, readPinLockoutEnabled, readPinLockoutEscalateAfter, readPinLockoutLongPenaltyMin, readPinLockoutPenaltySec } from "./pin-backup";
import { readFasonNoteMobileEntry, readKartelaMeasurementEnabled, readKk1DuplicateGuardEnabled, readKk1HistoryAllEntriesEnabled, readKk1LabelScanVerifyEnabled, readKk1OnlineOnlyEnabled, readKk1WeightEntryEnabled, readPartyCodeAuto, readRawWidthEnabled, readReturnGradingEnabled, readSimulatedWeightEnabled, readSupportOwnTicketsOnlyEnabled, readTargetQuantityEnabled, readTargetWidthEnabled, readWorkOrderQuickOwnOnlyEnabled } from "./production";
import { readAbsoluteSessionCapDays, readAutoLogoutOnExpiry, readIdleTimeoutMinutes, readMobileIdleLockEnabled, readMobileIdleLockMinutes, readMobileLockOnBackground, readMobileOfflineLockDefer, readRememberLastUser, readSameTypeSessionPolicy, readSessionDurationMinutes, readWorkSessionIdleTimeoutMinutes } from "./session";
import { readItemPhaseOutLineQty, readItemPhaseOutNewOrder, readItemPhaseOutNewPlan, readShipmentConfirmationEnabled, readShipmentHandheldCreateEnabled, readShipmentLooseLoadEnabled, readShipmentManualSackCountEnabled, readShipmentUndoSameDayOnly, readShippingAllocWidthToleranceCm, readShippingAllocWidthToleranceEnabled, readShippingAllowOverAllocation, readShippingDocCekiNameMode, readShippingDocItemNameMode, readShippingDocProductColorSplit, readShippingInvoiceMode, readShippingManualWeightRestrictedEnabled, readShippingOrderCoverage, readShippingOrderRequirement, readShippingReadyNotifyUnits, readShippingReadyRule, readShippingReadyScanMinutes, readShippingReadyTolerancePct, readShippingWeighRequiredEnabled } from "./shipping";
import { readCustomerBranchesEnabled, readDemoModeEnabled, readDuplicatesFuzzyEnabled, readDuplicatesFuzzyThresholdPct, readFasonReceiptApplyTargetVariant, readFasonExpectedReturnDays, readFasonShrinkTolerancePct, readFasonShrinkWarnEnabled, readMachineStopOpenWarningEnabled, readMachineStopTrackingEnabled, readTamburCalibrationCheck, readTamburChildWidthSource, readTamburLabelPrintTiming, readTamburListByStationEnabled, readTamburMeasureSourceRequired, readTamburOverQuantityEnabled, readTamburPlanGateWidthCheck, readTamburPlanGateWidthToleranceCm, readTamburShortCutA1Enabled, readTamburShortCutA1ThresholdM, readTamburSimulatedMeterEnabled, readTamburUndoFullSameDayOnly } from "./tambur-fason";
import { readTravelerCardConfig } from "./traveler-card";


// =============================================================================
// Feature-flag agregat cache
// =============================================================================
// getFeatureFlags() her çağrıda 15 ayrı systemSetting.findUnique çalıştırıyor;
// GET /api/feature-flags app açılışında + her gezinmede sık çağrılır. Toplam
// sonucu kısa TTL ile bellekte tutuyoruz. set() HER ayar yazımında invalidate
// eder (tek write chokepoint) → toggle anında taze görünür.
// ÖNEMLİ: per-flag enforcement reader'ları (readReturnGradingEnabled(tx),
// readDevicePairingRequired, readTamburOverQuantityEnabled ...) KASITEN cache'siz
// kalır — transaction içi + middleware tazeliği aynen korunur. Tek-sunucu yerel
// kurulum → bellek cache yeterli (TTL ayrıca olası out-of-band değişimi bounded tutar).
let featureFlagsCache: { value: CachedFeatureFlags; expiresAt: number } | null = null;
const FEATURE_FLAGS_TTL_MS = 30_000;
// Lost-invalidation guard: getFeatureFlags okumaya BAŞLAMADAN önce bu sayacı yakalar.
// findMany sürerken araya bir set()+invalidate girerse sayaç artar ve okuma bayat
// veriyi cache'e YAZMAZ (taze döner) — yoksa pencerede başlamış okuma, invalidate'i
// "atlayıp" eski değeri TTL boyunca (30sn) pinleyebiliyordu (enforced flag'ler için
// geçici yanlış davranış). NOT: tek-process varsayımı (process-local sayaç).
let cacheGeneration = 0;

export function invalidateFeatureFlagsCache(): void {
  featureFlagsCache = null;
  cacheGeneration++;
}

// Her tablet isteğinde okunur: kısa TTL'li önbellek; bayrak yazımı (invalidateFeatureFlagsCache)
// kuşağı artırınca anında tazelenir. Okunamazsa bayat değer; hiç dolmadıysa fail-closed (true).
let deviceProofCache: { value: boolean; at: number; gen: number } | null = null;
const DEVICE_PROOF_TTL_MS = 10_000;

export async function readDeviceProofRequiredCached(): Promise<boolean> {
  if (isHostedInstallation()) return true;
  const now = Date.now();
  if (deviceProofCache && deviceProofCache.gen === cacheGeneration && now - deviceProofCache.at < DEVICE_PROOF_TTL_MS) {
    return deviceProofCache.value;
  }
  try {
    const value = await readDeviceProofRequired();
    deviceProofCache = { value, at: now, gen: cacheGeneration };
    return value;
  } catch {
    return deviceProofCache ? deviceProofCache.value : true;
  }
}


export async function getFeatureFlags(): Promise<ApiResponse<FeatureFlags>> {
    const now = Date.now();
    if (featureFlagsCache && featureFlagsCache.expiresAt > now) {
      return { success: true, data: applyTermRegime(withLicenseBlock(featureFlagsCache.value)) };
    }
    const gen = cacheGeneration; // okumanın başladığı sürüm (lost-invalidation guard)
    // Tek sorguda tüm ayarları çek → reader'lara in-memory client enjekte et.
    // Eski kod 15 ardışık findUnique = 15 round-trip yapıyordu. Reader'lar her
    // flag'in key/parse/default mantığının TEK kaynağı kalır; yalnız veri kaynağı
    // DB yerine map olur (system_settings tablosu küçük → tüm satırları çekmek ucuz).
    const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
    const valueByKey = new Map(rows.map((r) => [r.key, r.value] as const));
    const cacheClient = settingMapClient(valueByKey);

    // Oturum ömrü tek kaynaktan (dakika); saat alanı geriye-uyum için aynı değerden türetilir.
    const sessionMinutes = await readSessionDurationMinutes(cacheClient);
    const reportsClosedRead = await readReportsClosedKeys(cacheClient);
    const flags: CachedFeatureFlags = {
      companyName: await readCompanyName(cacheClient),
      factoryTimezone: await readFactoryTimezonePeriods(valueByKey),
      // Sıra önemli: dönemler önce uygulanır, uyarı onun ölçtüğü duruma göre.
      ...publicTimezoneWarning(),
      pricingEnabled: await readPricingEnabled(cacheClient),
      financeEnabled: await readFinanceEnabledRaw(cacheClient),
      financeBlockNegativeCashEnabled: await readFinanceBlockNegativeCashEnabled(cacheClient),
      financeDefaultVatRate: await readFinanceDefaultVatRate(cacheClient),
      financeWithholdingEnabled: await readFinanceWithholdingEnabled(cacheClient),
      financeWithholdingNumerator: await readFinanceWithholdingNumerator(cacheClient),
      financeWithholdingDenominator: await readFinanceWithholdingDenominator(cacheClient),
      financePurchaseWithholdingEnabled: await readFinancePurchaseWithholdingEnabled(cacheClient),
      financePurchaseWithholdingNumerator: await readFinancePurchaseWithholdingNumerator(cacheClient),
      financePurchaseWithholdingDenominator: await readFinancePurchaseWithholdingDenominator(cacheClient),
      financeInvoiceMatchTolerance: await readFinanceInvoiceMatchTolerance(cacheClient),
      financeInvoiceQtyTolerancePct: await readFinanceInvoiceQtyTolerancePct(cacheClient),
      financeInvoicePriceTolerancePct: await readFinanceInvoicePriceTolerancePct(cacheClient),
      financeChequeNoteMovementEnabled: await readFinanceChequeNoteMovementEnabled(cacheClient),
      financeRiskLimitBlockEnabled: await readFinanceRiskLimitBlockEnabled(cacheClient),
      financeRiskLimitBlockIntake: await readFinanceRiskLimitBlockIntake(cacheClient),
      financeRiskLimitBlockShipment: await readFinanceRiskLimitBlockShipment(cacheClient),
      financeAutoDraftFromShipmentEnabled:
        await readFinanceAutoDraftFromShipmentEnabled(cacheClient),
      financeServiceBillingEnabled: await readFinanceServiceBillingEnabled(cacheClient),
      financeServiceBillingMeterBasis: await readFinanceServiceBillingMeterBasis(cacheClient),
      financeServiceBillingMissingMeter: await readFinanceServiceBillingMissingMeter(cacheClient),
      financeServiceBillingBrodeUnit: await readFinanceServiceBillingBrodeUnit(cacheClient),
      financeServiceBillingStepWorks: await readFinanceServiceBillingStepWorks(cacheClient),
      financeServiceBillingWeavingWorks: await readFinanceServiceBillingWeavingWorks(cacheClient),
      financeServiceBillingTrigger: await readFinanceServiceBillingTrigger(cacheClient),
      financeServiceBillingPriceDate: await readFinanceServiceBillingPriceDate(cacheClient),
      financeKursunGramPriceBasis: await readFinanceKursunGramPriceBasis(cacheClient),
      financeExpenseCategorySuggestions: await readFinanceExpenseCategorySuggestions(cacheClient),
      financeExpenseAllocationField: await readFinanceExpenseAllocationField(cacheClient),
      financeExpenseAllocationClosedWorkOrder: await readFinanceExpenseAllocationClosedWorkOrder(cacheClient),
      financeCariHoldDefaultScope: await readFinanceCariHoldDefaultScope(cacheClient),
      financeCariHoldReleaseBySamePerson: await readFinanceCariHoldReleaseBySamePerson(cacheClient),
      financeCariHoldEmanetShipment: await readFinanceCariHoldEmanetShipment(cacheClient),
      costPresentationCurrency: await readCostPresentationCurrency(cacheClient),
      costFinishingKgBasis: await readCostFinishingKgBasis(cacheClient),
      financeRiskLimitCurrencyMode: await readFinanceRiskLimitCurrencyMode(cacheClient),
      costProfitSubcontractSource: await readCostProfitSubcontractSource(cacheClient),
      costProfitConsumablePriceSource: await readCostProfitConsumablePriceSource(cacheClient),
      costWeavingStandardMethod: await readCostWeavingStandardMethod(cacheClient),
      orderProductionProposal: await readOrderProductionProposal(cacheClient),
      costProfitMachineTime: await readCostProfitMachineTime(cacheClient),
      costProfitOverheadKey: await readCostProfitOverheadKey(cacheClient),
      costProfitCategoryClasses: await readCostProfitCategoryClasses(cacheClient),
      financeAutoAllocateOnPaymentEnabled:
        await readFinanceAutoAllocateOnPaymentEnabled(cacheClient),
      yarnBlockNegativeBalanceEnabled: await readYarnBlockNegativeBalanceEnabled(cacheClient),
      purchaseBlockOverReceiptEnabled: await readPurchaseBlockOverReceiptEnabled(cacheClient),
      goodsReceiptRequirePriceEnabled: await readGoodsReceiptRequirePriceEnabled(cacheClient),
      consumableStockEnabled: await readConsumableStockEnabled(cacheClient),
      goodsReceiptYarnQualityHoldEnabled: await readGoodsReceiptYarnQualityHoldEnabled(cacheClient),
      productionCancelReasonRequired: await readProductionCancelReasonRequired(cacheClient),
      financeAllowZeroPriceLineEnabled: await readFinanceAllowZeroPriceLineEnabled(cacheClient),
      financeFutureDatedDocumentBlockEnabled:
        await readFinanceFutureDatedDocumentBlockEnabled(cacheClient),
      financeYarnOutOnInvoiceEnabled: await readFinanceYarnOutOnInvoiceEnabled(cacheClient),
      productionEnabled: await readProductionEnabledRaw(cacheClient),
      // MODÜL ANAHTARLARI — ⚠️ `cacheClient` argümanı ATLANAMAZ: bu yol tek
      // atışlık toplu okumadır, argümansız çağrı beş DB round-trip'i ekler.
      // ⚠️ HAM değer döner (etkin `iplik = ticaret && iplik` DEĞİL): panel
      // toggle'ı kendi yazdığını geri okumak zorunda, yoksa kullanıcı ticaret
      // kapalıyken ipliği açar ve anahtar kapalı görünmeye devam eder.
      ticaretEnabled: await readTicaretEnabledRaw(cacheClient),
      iplikEnabled: await readIplikEnabledRaw(cacheClient),
      depoMultiEnabled: await readDepoMultiEnabledRaw(cacheClient),
      kumasTeknikEnabled: await readKumasTeknikEnabledRaw(cacheClient),
      tezgahEnabled: await readTezgahEnabledRaw(cacheClient),
      devereEnabled: await readDevereEnabledRaw(cacheClient),
      emanetEnabled: await readEmanetEnabledRaw(cacheClient),
      kaliteGuvenceEnabled: await readKaliteGuvenceEnabledRaw(cacheClient),
      devereLotRequired: await readDevereLotRequired(cacheClient),
      devereMountTracking: await readDevereMountTracking(cacheClient),
      devereMountTrackingRequired: await readDevereMountTrackingRequired(cacheClient),
      devereAutoConsume: await readDevereAutoConsume(cacheClient),
      devereBeamWeavingLinkRequired: await readDevereBeamWeavingLinkRequired(cacheClient),
      dokumaRunWeavingOrderRequired: await readDokumaRunWeavingOrderRequired(cacheClient),
      dokumaOrderLineLinkRequired: await readDokumaOrderLineLinkRequired(cacheClient),
      dokumaRollBirth: await readDokumaRollBirth(cacheClient),
      dokumaWeavingWastePct: await readDokumaWeavingWastePct(cacheClient),
      dokumaYarnReservationEnabled: await readDokumaYarnReservationEnabled(cacheClient),
      dokumaEnabled: await readDokumaEnabledRaw(cacheClient),
      maliyetEnabled: await readMaliyetEnabledRaw(cacheClient),
      gelenBelgeEnabled: await readGelenBelgeEnabledRaw(cacheClient),
      // ⚠️ ÜÇ SONUÇLU okumanın panele TAŞINAN hâli: ölçülemedi ⇒ `null`. Boş diziye
      // düşürmek, bozuk bir satırda paneli "hepsi açık" diye çizdirirdi.
      reportsClosedKeys: ((): string[] | null => {
        const o = reportsClosedRead;
        // Panel listeyi olduğu gibi geri yazar: katalog dışı ve emekli anahtar burada ayıklanır, yoksa yazma 400 verir.
        return o.durum === "okundu" ? o.kapali.filter((k) => REPORT_BY_KEY.has(k) && !isRetiredReportKey(k)) : null;
      })(),
      // Bayrak emekli (2026-11-12): yeni rapor merkezi tek yol. Alanı okuyan eski panel yokluğu `false` sayıp eski
      // karo sayfasını açardı — yanıtta sabit `true` kalır; yazma yolu yok.
      reportsV2Enabled: true,
      targetQuantityEnabled: await readTargetQuantityEnabled(cacheClient),
      targetWidthEnabled: await readTargetWidthEnabled(cacheClient),
      rawWidthEnabled: await readRawWidthEnabled(cacheClient),
      kk1WeightEntryEnabled: await readKk1WeightEntryEnabled(cacheClient),
      kk1DuplicateGuardEnabled: await readKk1DuplicateGuardEnabled(cacheClient),
      workOrderQuickOwnOnlyEnabled: await readWorkOrderQuickOwnOnlyEnabled(cacheClient),
      supportOwnTicketsOnlyEnabled: await readSupportOwnTicketsOnlyEnabled(cacheClient),
      kk1OnlineOnlyEnabled: await readKk1OnlineOnlyEnabled(cacheClient),
      kk1LabelScanVerifyEnabled: await readKk1LabelScanVerifyEnabled(cacheClient),
      kk1HistoryAllEntriesEnabled: await readKk1HistoryAllEntriesEnabled(cacheClient),
      shippingSimulatedWeightEnabled: await readSimulatedWeightEnabled(cacheClient),
      returnGradingEnabled: await readReturnGradingEnabled(cacheClient),
      kartelaMeasurementEnabled: await readKartelaMeasurementEnabled(cacheClient),
      partyCodeAuto: await readPartyCodeAuto(cacheClient),
      fasonNoteMobileEntry: await readFasonNoteMobileEntry(cacheClient),
      devicePairingRequired: await readDevicePairingRequired(cacheClient),
      deviceProofRequired: await readDeviceProofRequired(cacheClient),
      deviceUnpairedPasswordLogin: await readDeviceUnpairedPasswordLogin(cacheClient),
      deviceAutoReattach: await readDeviceAutoReattach(cacheClient),
      shortCredentialApprovedDeviceOnly: await readShortCredentialApprovedDeviceOnly(cacheClient),
      shortCredentialTotpRequired: await readShortCredentialTotpRequired(cacheClient),
      webTotpPolicy: await readWebTotpPolicy(cacheClient),
      trustedDeviceDays: await readTrustedDeviceDays(cacheClient),
      shipmentConfirmationEnabled: await readShipmentConfirmationEnabled(cacheClient),
      shipmentManualSackCountEnabled: await readShipmentManualSackCountEnabled(cacheClient),
      shipmentLooseLoadEnabled: await readShipmentLooseLoadEnabled(cacheClient),
      shipmentHandheldCreateEnabled: await readShipmentHandheldCreateEnabled(cacheClient),
      shipmentUndoSameDayOnly: await readShipmentUndoSameDayOnly(cacheClient),
      shippingOrderRequirement: await readShippingOrderRequirement(cacheClient),
      itemPhaseOutNewOrder: await readItemPhaseOutNewOrder(cacheClient),
      itemPhaseOutLineQty: await readItemPhaseOutLineQty(cacheClient),
      itemPhaseOutNewPlan: await readItemPhaseOutNewPlan(cacheClient),
      shippingWeighRequiredEnabled: await readShippingWeighRequiredEnabled(cacheClient),
      shippingManualWeightRestrictedEnabled:
        await readShippingManualWeightRestrictedEnabled(cacheClient),
      shippingInvoiceMode: await readShippingInvoiceMode(cacheClient),
      shippingDocItemNameMode: await readShippingDocItemNameMode(cacheClient),
      shippingDocCekiNameMode: await readShippingDocCekiNameMode(cacheClient),
      shippingOrderCoverage: await readShippingOrderCoverage(cacheClient),
      shippingDocProductColorSplit: await readShippingDocProductColorSplit(cacheClient),
      packingGroupsEnabled: await readPackingGroupsEnabled(cacheClient),
      packingGroupNumbering: await readPackingGroupNumbering(cacheClient),
      packingGroupMode: await readPackingGroupMode(cacheClient),
      packageNoStartsAtZero: await readPackageNoStartsAtZero(cacheClient),
      packageNoMode: await readPackageNoMode(cacheClient),
      packageNumbering: await readPackageNumbering(cacheClient),
      packingLotRequired: await readPackingLotRequired(cacheClient),
      packingLotPartialDispatch: await readPackingLotPartialDispatch(cacheClient),
      shippingDocPackingLot: await readShippingDocPackingLot(cacheClient),
      shippingSackSeqOnDoc: await readShippingSackSeqOnDoc(cacheClient),
      shippingSackSeqPrefix: await readShippingSackSeqPrefix(cacheClient),
      shippingSackSeqPrefixLive: await readShippingSackSeqPrefixLive(cacheClient),
      shippingSackSeqStart: await readShippingSackSeqStart(cacheClient),
      shippingReturnFootnote: await readShippingReturnFootnote(cacheClient),
      tezgahEscalationGraceMinutes: await readTezgahEscalationGraceMinutes(cacheClient),
      tezgahAlarmEnabled: await readTezgahAlarmEnabled(cacheClient),
      tezgahAlarmUnclassifiedTargetMinutes: await readTezgahAlarmUnclassifiedTargetMinutes(cacheClient),
      tezgahAlarmUnclassifiedEnabled: await readTezgahAlarmUnclassifiedEnabled(cacheClient),
      tezgahAlarmRenotifyMinutes: await readTezgahAlarmRenotifyMinutes(cacheClient),
      tezgahMaxOpenStopHours: await readTezgahMaxOpenStopHours(cacheClient),
      tezgahCollectorSilenceMinutes: await readTezgahCollectorSilenceMinutes(cacheClient),
      tezgahAlarmEscalateWhenAcked: await readTezgahAlarmEscalateWhenAcked(cacheClient),
      tezgahAlarmNoShiftMode: await readTezgahAlarmNoShiftMode(cacheClient),
      shippingSackSeqShowTotal: await readShippingSackSeqShowTotal(cacheClient),
      packingPoolPackageNo: await readPackingPoolPackageNo(cacheClient),
      sackDumpNameMode: await readSackDumpNameMode(cacheClient),
      shippingAllocWidthToleranceEnabled: await readShippingAllocWidthToleranceEnabled(cacheClient),
      shippingAllocWidthToleranceCm: await readShippingAllocWidthToleranceCm(cacheClient),
      shippingAllowOverAllocation: await readShippingAllowOverAllocation(cacheClient),
      shippingReadyRule: await readShippingReadyRule(cacheClient),
      shippingReadyTolerancePct: await readShippingReadyTolerancePct(cacheClient),
      shippingReadyNotifyUnits: await readShippingReadyNotifyUnits(cacheClient),
      shippingReadyScanMinutes: await readShippingReadyScanMinutes(cacheClient),
      customerBranchesEnabled: await readCustomerBranchesEnabled(cacheClient),
      travelerCardConfig: await readTravelerCardConfig(cacheClient),
      companyLetterhead: await readCompanyLetterhead(cacheClient),
      companyLegalIdentity: await readCompanyLegalIdentity(cacheClient),
      eIrsaliyeConfig: await readEIrsaliyeConfig(cacheClient),
      documentsConfig: await readDocumentsConfig(cacheClient),
      tamburOverQuantityEnabled: await readTamburOverQuantityEnabled(cacheClient),
      tamburUndoFullSameDayOnly: await readTamburUndoFullSameDayOnly(cacheClient),
      tamburSimulatedMeterEnabled: await readTamburSimulatedMeterEnabled(cacheClient),
      tamburMeasureSourceRequired: await readTamburMeasureSourceRequired(cacheClient),
      tamburCalibrationCheck: await readTamburCalibrationCheck(cacheClient),
      tamburShortCutA1Enabled: await readTamburShortCutA1Enabled(cacheClient),
      tamburShortCutA1ThresholdM: await readTamburShortCutA1ThresholdM(cacheClient),
      tamburPlanGateWidthToleranceCm: await readTamburPlanGateWidthToleranceCm(cacheClient),
      tamburPlanGateWidthCheck: await readTamburPlanGateWidthCheck(cacheClient),
      tamburChildWidthSource: await readTamburChildWidthSource(cacheClient),
      tamburLabelPrintTiming: await readTamburLabelPrintTiming(cacheClient),
      tamburListByStationEnabled: await readTamburListByStationEnabled(cacheClient),
      machineStopTrackingEnabled: await readMachineStopTrackingEnabled(cacheClient),
      machineStopOpenWarningEnabled: await readMachineStopOpenWarningEnabled(cacheClient),
      fasonShrinkWarnEnabled: await readFasonShrinkWarnEnabled(cacheClient),
      fasonReceiptApplyTargetVariant: await readFasonReceiptApplyTargetVariant(cacheClient),
      fasonShrinkTolerancePct: await readFasonShrinkTolerancePct(cacheClient),
      fasonExpectedReturnDays: await readFasonExpectedReturnDays(cacheClient),
      demoModeEnabled: await readDemoModeEnabled(cacheClient),
      duplicatesFuzzyEnabled: await readDuplicatesFuzzyEnabled(cacheClient),
      duplicatesFuzzyThresholdPct: await readDuplicatesFuzzyThresholdPct(cacheClient),
      kursunBypassEnabled: await readKursunBypassEnabled(cacheClient),
      kursunMeterCapture: await readKursunMeterCapture(cacheClient),
      kursunSimulatedMeterEnabled: await readKursunSimulatedMeterEnabled(cacheClient),
      kursunMeterVarianceThresholdM: (await readKursunMeterVarianceThresholdM(cacheClient)) ?? 0,
      kursunMeterVarianceThresholdPct: (await readKursunMeterVarianceThresholdPct(cacheClient)) ?? 0,
      kursunMeterVarianceBasis: await readKursunMeterVarianceBasis(cacheClient),
      kursunMeterVarianceApproval: await readKursunMeterVarianceApproval(cacheClient),
      kursunMeterStockMode: await readKursunMeterStockMode(cacheClient),
      kursunMachineAssignMode: await readKursunMachineAssignMode(cacheClient),
      productionRouteMode: await readProductionRouteMode(cacheClient),
      productionScanRouteStations: await readProductionScanRouteStations(cacheClient),
      scanCustomerCodeLookupEnabled: await readScanCustomerCodeLookupEnabled(cacheClient),
      batchShortNumberEnabled: await readBatchShortNumberEnabled(cacheClient),
      batchLastNumberHintEnabled: await readBatchLastNumberHintEnabled(cacheClient),
      qualityGradeRequiredEnabled: await readQualityGradeRequiredEnabled(cacheClient),
      batchAutoCreateEnabled: await readBatchAutoCreateEnabled(cacheClient),
      sessionDurationMinutes: sessionMinutes,
      sessionDurationHours: Math.max(1, Math.round(sessionMinutes / 60)),
      idleTimeoutMinutes: await readIdleTimeoutMinutes(cacheClient),
      workSessionIdleTimeoutMinutes: await readWorkSessionIdleTimeoutMinutes(cacheClient),
      sameTypeSessionPolicy: await readSameTypeSessionPolicy(cacheClient),
      autoLogoutOnExpiry: await readAutoLogoutOnExpiry(cacheClient),
      mobileIdleLockEnabled: await readMobileIdleLockEnabled(cacheClient),
      mobileIdleLockMinutes: await readMobileIdleLockMinutes(cacheClient),
      mobileLockOnBackground: await readMobileLockOnBackground(cacheClient),
      mobileOfflineLockDefer: await readMobileOfflineLockDefer(cacheClient),
      rememberLastUser: await readRememberLastUser(cacheClient),
      absoluteSessionCapDays: await readAbsoluteSessionCapDays(cacheClient),
      pinLockoutEnabled: await readPinLockoutEnabled(cacheClient),
      pinLockoutAttempts: await readPinLockoutAttempts(cacheClient),
      backupHour: await readBackupHour(cacheClient),
      pinLockoutPenaltySec: await readPinLockoutPenaltySec(cacheClient),
      pinLockoutEscalateAfter: await readPinLockoutEscalateAfter(cacheClient),
      pinLockoutLongPenaltyMin: await readPinLockoutLongPenaltyMin(cacheClient),
      loginMethods: await readLoginMethods(cacheClient),
      labelCopies: await readLabelCopies(cacheClient),
      labelCopiesSource: await readLabelCopiesSource(cacheClient),
      labelCustomerCodeMissing: await readLabelCustomerCodeMissing(cacheClient),
      labelCustomerCodeAt: await readLabelCustomerCodeAt(cacheClient),
      nativeSendEnabled: await readLabelNativeSendEnabled(cacheClient),
      mobileRasterEnabled: await readMobileRasterEnabled(cacheClient),
      scrapGradeLabelEnabled: await readScrapGradeLabelEnabled(cacheClient),
      defaultLabelMedia: await readDefaultLabelMedia(cacheClient),
      patronBulutOlayGudumluEnabled: await readPatronBulutOlayGudumluEnabled(cacheClient),
      bildirimGelenKutusuEnabled: await readNotificationInboxEnabled(cacheClient),
      bildirimPatronPushEnabled: await readPatronPushEnabled(cacheClient),
      documentDesignerEnabled: await readDocumentDesignerEnabled(cacheClient),
      documentPublishSodEnabled: await readDocumentPublishSodEnabled(cacheClient),
    };
    // Yalnız okuma sürerken invalidate OLMADIYSA cache'le; olduysa bayat veriyi
    // pinleme (taze değeri döndür, cache'i bir sonraki okuma tazeler).
    if (cacheGeneration === gen) {
      featureFlagsCache = { value: flags, expiresAt: now + FEATURE_FLAGS_TTL_MS };
    }
    return { success: true, data: applyTermRegime(withLicenseBlock(flags)) };
  }
