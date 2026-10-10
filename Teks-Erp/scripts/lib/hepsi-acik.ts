// =============================================================================
// HEPSİ-AÇIK TABLOSU — `acik` test profilinin TEK kaynağı (TEK-ORTAK-PAKET §6.2)
// =============================================================================
// Her ayar anahtarı (`PATCH /api/feature-flags` şemasının alanı) burada ya bir AÇIK
// değer taşır ya da gerekçeli "varsayılanda kalır" der. Tabloda karşılığı olmayan
// anahtar `test_profil_tamligi`de KIRMIZIDIR: yeni bayrak reçetesi bu satırı ister.
//
// Seçim kuralı: boolean → true; enum → bayrağı en çok işleten değer, ama BİRBİRİNİ
// dışlayan çift varsa (`shippingOrderRequirement=block` ↔ `itemPhaseOutNewOrder=KAPALI`)
// çapraz kapıdan geçen değer; sayı → kuralı DEVREYE sokan, makul bir değer.
// Oturum süresi / kilit cezası gibi güvenlik-ayar sayıları "açılacak" bir şey değildir:
// varsayılanda kalır, böylece matrisin kendi oturumu bayrak yüzünden düşmez.
// =============================================================================

export type AyarDegeri = boolean | number | string | null;

export type AcikGirdisi = { acik: AyarDegeri } | { varsayilan: string };

/** Profil dosyasının taşıyamayacağı alanlar: nesne değerliler, kimlik, belge tasarımı. */
export const PROFIL_DISI_ANAHTARLAR: Readonly<Record<string, string>> = {
  companyName: "firma adı lisanstan gelir (K2), profil kimliği değil",
  loginMethods: "nesne değerli; giriş yöntemi seçimi test akışını değiştirir",
  defaultLabelMedia: "nesne değerli; baskı donanımına bağlı",
  travelerCardConfig: "nesne değerli; belge tasarımı (belge-etiket.md)",
  companyLetterhead: "nesne değerli; belge tasarımı (belge-etiket.md)",
  documentsConfig: "nesne değerli; belge tasarımı (belge-etiket.md)",
  reportsClosedKeys: "liste değerli; ticari kapsam kararı, O13b'de ayrıca ele alınır",
};

const V = (neden: string): AcikGirdisi => ({ varsayilan: neden });
const A = (acik: AyarDegeri): AcikGirdisi => ({ acik });

export const HEPSI_ACIK: Readonly<Record<string, AcikGirdisi>> = {
  // ── modül şalterleri ───────────────────────────────────────────────────────
  productionEnabled: A(true),
  financeEnabled: A(true),
  ticaretEnabled: A(true),
  iplikEnabled: A(true),
  depoMultiEnabled: A(true),
  kumasTeknikEnabled: A(true),
  tezgahEnabled: A(true),
  devereEnabled: A(true),
  dokumaEnabled: A(true),
  emanetEnabled: A(true),
  // ── ön muhasebe / ticaret ──────────────────────────────────────────────────
  pricingEnabled: A(true),
  financeBlockNegativeCashEnabled: A(true),
  financeDefaultVatRate: V("KDV ön-dolum oranı; açılacak bir şey değil"),
  financeInvoiceMatchTolerance: A(true),
  financeInvoiceQtyTolerancePct: A(5),
  financeInvoicePriceTolerancePct: A(5),
  financeChequeNoteMovementEnabled: A(true),
  financeRiskLimitBlockEnabled: A(true),
  financeAutoDraftFromShipmentEnabled: A(true),
  financeAutoAllocateOnPaymentEnabled: A(true),
  financeAllowZeroPriceLineEnabled: A(true),
  financeFutureDatedDocumentBlockEnabled: A(true),
  financeYarnOutOnInvoiceEnabled: A(true),
  yarnBlockNegativeBalanceEnabled: A(true),
  purchaseBlockOverReceiptEnabled: A(true),
  goodsReceiptRequirePriceEnabled: A(true),
  goodsReceiptYarnQualityHoldEnabled: A(true),
  // ── üretim ─────────────────────────────────────────────────────────────────
  productionCancelReasonRequired: A(true),
  targetQuantityEnabled: A(true),
  rawWidthEnabled: A(true),
  kursunBypassEnabled: A(true),
  tamburOverQuantityEnabled: A(true),
  tamburUndoFullSameDayOnly: A(true),
  tamburShortCutA1Enabled: A(true),
  tamburShortCutA1ThresholdM: A(5),
  qualityGradeRequiredEnabled: A(true),
  batchShortNumberEnabled: A(true),
  batchLastNumberHintEnabled: A(true),
  batchAutoCreateEnabled: A(true),
  partyCodeAuto: A(true),
  returnGradingEnabled: A(true),
  kartelaMeasurementEnabled: A(true),
  fasonNoteMobileEntry: A(true),
  fasonShrinkWarnEnabled: A(true),
  fasonShrinkTolerancePct: V("eşik yüzdesi; uyarı bayrağı açıkken varsayılan eşik geçerli"),
  // ── devere / dokuma ────────────────────────────────────────────────────────
  devereLotRequired: A(true),
  devereMountTracking: A(true),
  devereMountTrackingRequired: A(true),
  devereAutoConsume: A(true),
  devereBeamWeavingLinkRequired: A(true),
  dokumaRunWeavingOrderRequired: A(true),
  dokumaOrderLineLinkRequired: A(true),
  tezgahEscalationGraceMinutes: A(5),
  // ── KK1 ────────────────────────────────────────────────────────────────────
  kk1WeightEntryEnabled: A(true),
  kk1DuplicateGuardEnabled: A(true),
  kk1OnlineOnlyEnabled: A(true),
  kk1LabelScanVerifyEnabled: A(true),
  kk1HistoryAllEntriesEnabled: A(true),
  // ── sevkiyat ───────────────────────────────────────────────────────────────
  shippingSimulatedWeightEnabled: A(true),
  shipmentConfirmationEnabled: A(true),
  shipmentManualSackCountEnabled: A(true),
  shipmentUndoSameDayOnly: A(true),
  shippingOrderRequirement: A("block"),
  shippingOrderCoverage: A("block"),
  itemPhaseOutNewOrder: A("OKUTULAN_TOPLAR"), // KAPALI ↔ block çapraz kapıdan geçmez
  itemPhaseOutLineQty: A("KILITLI"),
  itemPhaseOutNewPlan: A(true),
  shippingWeighRequiredEnabled: A(true),
  shippingManualWeightRestrictedEnabled: A(true),
  shippingInvoiceMode: A("ikisi"),
  shippingDocItemNameMode: A("ikisi"),
  shippingDocCekiNameMode: A("ikisi"),
  shippingDocProductColorSplit: A(true),
  shippingDocPackingLot: A(true),
  shippingSackSeqOnDoc: A(true),
  shippingSackSeqPrefix: A("SQ"),
  shippingSackSeqPrefixLive: A(true),
  shippingSackSeqStart: A(1),
  shippingSackSeqShowTotal: A(true),
  shippingAllocWidthToleranceEnabled: A(true),
  shippingAllocWidthToleranceCm: A(2),
  shippingAllowOverAllocation: A(true),
  customerBranchesEnabled: A(true),
  packingGroupsEnabled: A(true),
  packingGroupNumbering: A("bosluk-doldur"),
  packingGroupMode: A("sevk-partisi"),
  packageNoStartsAtZero: A(true),
  packageNoMode: A("otomatik-ezilebilir"), // "elle" matrisin üretim akışını numara girişine bağlar
  packageNumbering: A("bosluk-doldur"),
  packingLotRequired: A(true),
  packingLotPartialDispatch: A(true),
  packingPoolPackageNo: A("acilista"),
  sackDumpNameMode: A("ikisi"),
  // ── mükerrer / demo ────────────────────────────────────────────────────────
  duplicatesFuzzyEnabled: A(true),
  duplicatesFuzzyThresholdPct: V("eşik yüzdesi; bayrak açıkken varsayılan eşik geçerli"),
  demoModeEnabled: V("demo kipi simüle veri üretir; 'hepsi açık' bir gerçek-fabrika düzenidir, demo değil"),
  // ── oturum / kilit / cihaz ─────────────────────────────────────────────────
  sessionDurationMinutes: V("güvenlik süresi; matrisin kendi oturumunu etkiler"),
  sessionDurationHours: V("güvenlik süresi; dakika alanı öncelikli"),
  idleTimeoutMinutes: V("güvenlik süresi"),
  workSessionIdleTimeoutMinutes: V("güvenlik süresi"),
  sameTypeSessionPolicy: A("notify"), // "kick" matrisin ikinci girişini düşürür
  autoLogoutOnExpiry: A(true),
  mobileIdleLockEnabled: A(true),
  mobileIdleLockMinutes: V("güvenlik süresi"),
  mobileLockOnBackground: A(true),
  absoluteSessionCapDays: V("güvenlik süresi"),
  pinLockoutEnabled: A(true),
  pinLockoutAttempts: V("güvenlik sayısı"),
  pinLockoutPenaltySec: V("güvenlik sayısı"),
  pinLockoutEscalateAfter: V("güvenlik sayısı"),
  pinLockoutLongPenaltyMin: V("güvenlik sayısı"),
  devicePairingRequired: A(true),
  shortCredentialApprovedDeviceOnly: A(true),
  backupHour: V("yedek saati; açılacak bir şey değil"),
  // ── etiket ─────────────────────────────────────────────────────────────────
  labelCopies: V("kopya adedi; açılacak bir şey değil"),
  nativeSendEnabled: A(true),
  mobileRasterEnabled: A(true),
  scrapGradeLabelEnabled: A(true),
};

/** `acik` profilinin `ayarlar`ı: tablodaki AÇIK değerler (varsayılanda kalanlar yazılmaz). */
export function hepsiAcikAyarlar(): Record<string, AyarDegeri> {
  const sonuc: Record<string, AyarDegeri> = {};
  for (const [anahtar, g] of Object.entries(HEPSI_ACIK)) {
    if ("acik" in g) sonuc[anahtar] = g.acik;
  }
  return sonuc;
}
