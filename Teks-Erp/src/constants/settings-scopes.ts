// =============================================================================
// AYAR KAPSAMLARI — hangi ayar anahtarını HANGİ ekran izni yazabilir
// =============================================================================
// `admin:settings` tüm ayarların şemsiyesidir ve her anahtarı yazmaya devam
// eder (bugünkü yöneticiler hiçbir şey kaybetmez). Bu tablo yalnız DAR izni
// tanımlar: `settings:shipping` taşıyan personel yalnız Sevkiyat sekmesinin
// anahtarlarını yazar.
//
// ⚠️ FAIL-CLOSED: tabloda OLMAYAN anahtar yalnız `admin:settings` ile yazılır.
// Yeni bir ayar eklenip buraya konmazsa daralır, SIZMAZ.
// ⚠️ Panel kategorileri (`Electron/src/pages/GeneralSettings/settings-config.ts`
// `permissionAny`) bu tablonun aynasıdır — `test_settings_scopes` iki yönü ölçer.
// ⚠️ Süperadmin anahtarları (`SUPERADMIN_ONLY_FLAG_KEYS`) ve belge tasarım
// anahtarları burada YOKTUR; onların kendi dalları `flagWriteGuard`da önce koşar.
// =============================================================================

export const SETTINGS_ADMIN_PERMISSION = "admin:settings";

export interface SettingsScope {
  /** Dar izin kodu — `permission-catalog.ts`te tanımlı olmak zorunda. */
  permission: string;
  /** `PATCH /api/feature-flags` gövdesindeki anahtarlar. */
  flagKeys: readonly string[];
  /** `PUT /api/admin/settings/:key` ham anahtarları (feature-flag yükünde olmayanlar). */
  settingKeys?: readonly string[];
}

export const SETTINGS_SCOPES: readonly SettingsScope[] = [
  {
    permission: "settings:customers",
    flagKeys: ["customerBranchesEnabled", "duplicatesFuzzyEnabled", "duplicatesFuzzyThresholdPct"],
  },
  {
    permission: "settings:orders",
    flagKeys: ["pricingEnabled"],
    settingKeys: ["order.defaultDeadlineDays", "shipping.toleranceMeters"],
  },
  {
    permission: "settings:shipping",
    flagKeys: [
      "shipmentConfirmationEnabled",
      "shipmentManualSackCountEnabled",
      "shipmentUndoSameDayOnly",
      "returnGradingEnabled",
      "shippingSimulatedWeightEnabled",
      "shippingAllowOverAllocation",
      "shippingAllocWidthToleranceEnabled",
      "shippingAllocWidthToleranceCm",
      "shippingDocProductColorSplit",
      "packingGroupsEnabled",
      "packageNoStartsAtZero",
      "packingLotRequired",
      "packingLotPartialDispatch",
      "shippingDocPackingLot",
      "shippingSackSeqOnDoc",
      "shippingSackSeqShowTotal",
      "shippingSackSeqPrefixLive",
      "shippingSackSeqStart",
      "shippingSackSeqPrefix",
      "shippingWeighRequiredEnabled",
      "shippingManualWeightRestrictedEnabled",
      "sackDumpNameMode",
      "packingGroupNumbering",
      "packingGroupMode",
      "packageNoMode",
      "packingPoolPackageNo",
      "packageNumbering",
      "shippingOrderRequirement",
      "shippingInvoiceMode",
      "shippingDocItemNameMode",
      "shippingOrderCoverage",
      "shippingDocCekiNameMode",
    ],
  },
  {
    permission: "settings:work-orders",
    flagKeys: [
      "targetQuantityEnabled",
      "partyCodeAuto",
      "batchShortNumberEnabled",
      "batchLastNumberHintEnabled",
      "batchAutoCreateEnabled",
    ],
    settingKeys: ["workorder.defaultPlanDurationDays"],
  },
  {
    permission: "settings:production",
    flagKeys: [
      "rawWidthEnabled",
      "kk1WeightEntryEnabled",
      "kk1DuplicateGuardEnabled",
      "qualityGradeRequiredEnabled",
      "kk1OnlineOnlyEnabled",
      "kk1HistoryAllEntriesEnabled",
      "kk1LabelScanVerifyEnabled",
      "fasonShrinkWarnEnabled",
      "fasonShrinkTolerancePct",
      "fasonNoteMobileEntry",
      "kursunBypassEnabled",
      "tamburOverQuantityEnabled",
      "tamburShortCutA1Enabled",
      "tamburShortCutA1ThresholdM",
      "tamburUndoFullSameDayOnly",
      "productionCancelReasonRequired",
    ],
  },
  { permission: "settings:kartela", flagKeys: ["kartelaMeasurementEnabled"] },
  {
    permission: "settings:devere",
    flagKeys: [
      "devereLotRequired",
      "devereMountTracking",
      "devereMountTrackingRequired",
      "devereAutoConsume",
      "devereBeamWeavingLinkRequired",
    ],
  },
  { permission: "settings:dokuma", flagKeys: ["dokumaRunWeavingOrderRequired", "dokumaOrderLineLinkRequired"] },
  {
    permission: "settings:warehouse",
    flagKeys: ["purchaseBlockOverReceiptEnabled", "goodsReceiptRequirePriceEnabled"],
  },
  { permission: "settings:yarn", flagKeys: ["yarnBlockNegativeBalanceEnabled", "goodsReceiptYarnQualityHoldEnabled"] },
  {
    permission: "settings:finance",
    flagKeys: [
      "financeInvoiceMatchTolerance",
      "financeInvoiceQtyTolerancePct",
      "financeBlockNegativeCashEnabled",
      "financeRiskLimitBlockEnabled",
      "financeAllowZeroPriceLineEnabled",
      "financeFutureDatedDocumentBlockEnabled",
      "financeAutoDraftFromShipmentEnabled",
      "financeAutoAllocateOnPaymentEnabled",
      "financeYarnOutOnInvoiceEnabled",
      "financeDefaultVatRate",
      "financeInvoicePriceTolerancePct",
    ],
  },
  {
    permission: "settings:label",
    flagKeys: ["labelCopies", "nativeSendEnabled", "mobileRasterEnabled", "scrapGradeLabelEnabled", "defaultLabelMedia"],
  },
  { permission: "settings:devices", flagKeys: ["devicePairingRequired"] },
  // Logo ayrı uçtan yazılır (`PUT /api/feature-flags/documents-logo`) — o uç da bu izni kabul eder.
  { permission: "settings:company", flagKeys: ["companyName", "companyLetterhead"] },
  {
    permission: "settings:session",
    flagKeys: [
      "sessionDurationMinutes",
      "idleTimeoutMinutes",
      "workSessionIdleTimeoutMinutes",
      "mobileIdleLockMinutes",
      "autoLogoutOnExpiry",
      "mobileIdleLockEnabled",
      "mobileLockOnBackground",
      "sameTypeSessionPolicy",
      "loginMethods",
      "absoluteSessionCapDays",
      "pinLockoutEnabled",
      "pinLockoutAttempts",
      "pinLockoutPenaltySec",
      "pinLockoutEscalateAfter",
      "pinLockoutLongPenaltyMin",
    ],
  },
  // Yedekler ekranındaki "otomatik yedek saati".
  { permission: "system:backups", flagKeys: ["backupHour"] },
];

function buildKeyMap(pick: (s: SettingsScope) => readonly string[]): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  for (const s of SETTINGS_SCOPES) for (const k of pick(s)) m.set(k, s.permission);
  return m;
}

/** Feature-flag anahtarı → dar izin. */
export const FLAG_KEY_SCOPE: ReadonlyMap<string, string> = buildKeyMap((s) => s.flagKeys);

/** Ham `system_settings` anahtarı → dar izin. */
export const SETTING_KEY_SCOPE: ReadonlyMap<string, string> = buildKeyMap((s) => s.settingKeys ?? []);

/**
 * Bir anahtarı yazabilen izinler (herhangi biri yeter). Tabloda yoksa yalnız
 * `admin:settings` — fail-closed.
 */
/** Ham anahtarı olan ekranların izinleri — `GET /api/admin/settings` okuyucuları. */
export const RAW_SETTING_SCOPE_PERMISSIONS: readonly string[] = SETTINGS_SCOPES.filter(
  (s) => (s.settingKeys ?? []).length > 0,
).map((s) => s.permission);

export function flagKeyWriters(key: string): string[] {
  const scope = FLAG_KEY_SCOPE.get(key);
  return scope ? [SETTINGS_ADMIN_PERMISSION, scope] : [SETTINGS_ADMIN_PERMISSION];
}

export function settingKeyWriters(key: string): string[] {
  const scope = SETTING_KEY_SCOPE.get(key);
  return scope ? [SETTINGS_ADMIN_PERMISSION, scope] : [SETTINGS_ADMIN_PERMISSION];
}
