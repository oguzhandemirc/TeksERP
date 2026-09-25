// =============================================================================
// AYAR SATIRI → MODÜL AİDİYETİ (TEK KAYNAK)
// =============================================================================
// "Bu bayrak hangi modülün parçası?" sorusunun TEK cevabı bu tablodur.
//
// NEDEN VAR (2026-09-04, kullanıcı kararı): modüller PARAYLA SATILIYOR. Satın
// alınmamış bir modülün bayrakları Özellik Anahtarları ekranında çizildiğinde
// fabrika sahibi "bu modül zaten içinde varmış" diye okuyor — ürünün ticari
// sınırı ekranda görünmüyor. Somut vaka: `iplik.enabled` KAPALI bir kurulumda
// "İplik" sekmesi ve `yarnBlockNegativeBalanceEnabled` satırı duruyordu.
//
// ⚠️ BU BİR YETKİ DUVARI DEĞİLDİR, GÖRÜNÜRLÜK KURALIDIR. Gerçek sed BACKEND'de:
// `requireXEnabled` (module.middleware.ts) + `flagWriteGuard`. Buradaki tablo
// hiçbir isteği reddetmez; yalnız "kimin ekranında ne çizilir" sorusunu
// yanıtlar. Enforcement'ı buradan çıkarsayan kod YAZMA.
//
// ⚠️ EMSAL VE SÖZ DAĞARCIĞI `Teks-Erp/src/constants/screen-catalog.ts`
// (`ScreenEntry.modul`) — orada EKRANLARIN, burada AYAR SATIRLARININ aidiyeti
// beyan edilir. Üç ad uzayı BİREBİR aynı anlamda kullanılır:
//   • `ModuleFlagKey`   → kapatılabilir modül (satılan paket)
//   • `"cekirdek"`      → her kurulumda var; ASLA gizlenmez
//   • `"planlanan:*"`   → tasarımda modül, kodda anahtarı HENÜZ YOK
// `planlanan:*` bir yer tutucu değil BİLGİdir: anahtar doğduğu gün bu tablodaki
// satırlar tek hamlede o anahtara çevrilir. Çekirdeğe yazılsalardı taşınmadan
// unutulurlardı (screen-catalog'un `PlanlananModul` gerekçesinin birebir ikizi).
//
// ⚠️ TAMLIK DERLEMEDE ZORLANIR: `Record<FlagRowKey | SystemSettingKey, …>`.
// Yeni bir skaler `FeatureFlags` alanı eklenince bu dosya DERLENMEZ ve yazan
// kişi "bu bayrak kimin?" sorusunu cevaplamak zorunda kalır. Depoda "unutulmuş
// enum değeri" tekrar eden bir arıza sınıfıdır (2026-08-26/27'de beş vaka).
// =============================================================================

import type { ModuleFlagKey } from "@/lib/module-flags";
import type { FeatureFlags } from "@/services/featureFlagService";
import { SETTING_KEYS } from "@/services/systemSettingService";

/**
 * Ekranda SATIR olabilecek `FeatureFlags` alanları — skaler olan hepsi.
 *
 * ⚠️ NEDEN GENİŞ (yalnız "bugün çizilen satırlar" DEĞİL): kümeyi çizilenlere
 * daraltmanın tek yolu `SETTINGS_CATEGORIES`ten tip türetmekti ve o dizi
 * `as const` değil (olamaz — `icon`/`hint` bileşen taşır). Geniş küme derleme
 * kapısını korur: yeni bir bayrak PANELE eklenmeden ÖNCE de sahibini beyan eder.
 * Nesne değerli alanlar (`travelerCardConfig`, `documentsConfig`,
 * `companyLetterhead`, `loginMethods`) kendi panellerinde yaşar, satır değildir.
 */
type FlagRowKey = {
  [K in keyof FeatureFlags]: FeatureFlags[K] extends boolean | number | string | null ? K : never;
}[keyof FeatureFlags];

/** Ham `system_settings` satırları (`SettingFieldDef.key`) — onların da sahibi var. */
type SystemSettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Tasarımda modül, kodda anahtarı henüz yok (screen-catalog `PlanlananModul` aynası). */
export type PlanlananModulSahibi = "planlanan:fason" | "planlanan:kartela";

/**
 * Bir ayar satırının sahibi.
 *
 * ⚠️ `ModuleFlagKey`in TAMAMI kullanılmaz — `SettingsModuleState` beş anahtar
 * çözer (`kumasTeknikEnabled`/`tezgahEnabled` yer tutucu, arkalarında bugün tek
 * satır yok). Sahibi o iki anahtar olan bir bayrak doğarsa `SettingsModuleState`
 * genişletilmeden derleme geçmez — istenen budur.
 */
export type HideableModule = Exclude<
  ModuleFlagKey,
  "kumasTeknikEnabled" | "tezgahEnabled" | "emanetEnabled"
>;

export type FlagOwner = HideableModule | "cekirdek" | PlanlananModulSahibi;

/**
 * SATIR → SAHİP.
 *
 * ⚠️ MODÜL ANAHTARLARININ KENDİSİ DAİMA `"cekirdek"`: bir şalter kendi
 * modülüne ait sayılırsa kapatıldığı an kendi satırını gizler ve bir daha
 * AÇILAMAZ ("açtım, kapatamıyorum" çıkmazının tersi). Bekçi bunu ayrıca ölçer.
 * (Zaten satıcı ekranında yaşıyorlar — bu kural onların oraya taşınmasından
 * bağımsız olarak dursun diye yazılı.)
 *
 * ⚠️ AİDİYET, ENFORCEMENT'IN NEREDEN KOŞTUĞUYLA DEĞİL, SATIRIN HANGİ YÜZEYİ
 * YÖNETTİĞİYLE belirlenir. Somut örnek: `kk1DuplicateGuardEnabled` KK1 ham
 * girişini yönetir ve KK1 ekranı `screen-catalog`ta `productionEnabled`e
 * aittir — oysa `/api/rolls` BİLİNÇLİ olarak üretim kapısının arkasında
 * DEĞİLDİR. İkisini karıştırmak tabloyu route mount'larının kopyası yapardı.
 */
export const FLAG_MODULE: Readonly<Record<FlagRowKey | SystemSettingKey, FlagOwner>> = {
  // --- MODÜL ŞALTERLERİ (kendi kendini gizleyemez) ---------------------------
  productionEnabled: "cekirdek",
  financeEnabled: "cekirdek",
  ticaretEnabled: "cekirdek",
  iplikEnabled: "cekirdek",
  depoMultiEnabled: "cekirdek",
  kumasTeknikEnabled: "cekirdek",
  tezgahEnabled: "cekirdek",
  devereEnabled: "cekirdek",
  dokumaEnabled: "cekirdek",
  emanetEnabled: "cekirdek",
  // Devere Faz 2 (2026-09-14): lot zorunluluğu devere modülünün davranış bayrağı.
  devereLotRequired: "devereEnabled",
  // Devere Faz 3 (2026-09-15): tezgah bağı defteri ve bağlama zorunluluğu devere modülünün davranış bayrakları.
  devereMountTracking: "devereEnabled",
  devereMountTrackingRequired: "devereEnabled",
  // Devere Faz 4 (2026-09-15): otomatik tüketim devere modülünün davranış bayrağı.
  devereAutoConsume: "devereEnabled",
  // Z1 üretim belge zinciri (2026-09-18): levent→iş bağı devere'nin, koşum→iş ve iş→sipariş bağı dokumanın davranış bayrağı.
  devereBeamWeavingLinkRequired: "devereEnabled",
  dokumaRunWeavingOrderRequired: "dokumaEnabled",
  dokumaOrderLineLinkRequired: "dokumaEnabled",

  // --- ÜRETİM (`operations/work-orders` · KK1 · Tambur · Kurşun · Parti) -----
  targetQuantityEnabled: "productionEnabled",
  partyCodeAuto: "productionEnabled",
  batchShortNumberEnabled: "productionEnabled",
  batchLastNumberHintEnabled: "productionEnabled",
  batchAutoCreateEnabled: "productionEnabled",
  rawWidthEnabled: "productionEnabled",
  kk1WeightEntryEnabled: "productionEnabled",
  kk1DuplicateGuardEnabled: "productionEnabled",
  kk1OnlineOnlyEnabled: "productionEnabled",
  kk1LabelScanVerifyEnabled: "productionEnabled",
  kk1HistoryAllEntriesEnabled: "productionEnabled",
  qualityGradeRequiredEnabled: "productionEnabled",
  kursunBypassEnabled: "productionEnabled",
  tamburOverQuantityEnabled: "productionEnabled",
  tamburUndoFullSameDayOnly: "productionEnabled",
  tamburShortCutA1Enabled: "productionEnabled",
  tamburShortCutA1ThresholdM: "productionEnabled",
  [SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS]: "productionEnabled",

  // --- ÖN MUHASEBE (cari · fatura · kasa · çek) ------------------------------
  financeDefaultVatRate: "financeEnabled",
  // n irsaliye → 1 fatura (2026-09-18): fatura onayı tolerans kontrolü muhasebe modülünün davranış bayrağı + iki eşik.
  financeInvoiceMatchTolerance: "financeEnabled",
  financeInvoiceQtyTolerancePct: "financeEnabled",
  financeInvoicePriceTolerancePct: "financeEnabled",
  financeBlockNegativeCashEnabled: "financeEnabled",
  financeRiskLimitBlockEnabled: "financeEnabled",
  financeAllowZeroPriceLineEnabled: "financeEnabled",
  financeFutureDatedDocumentBlockEnabled: "financeEnabled",
  financeAutoDraftFromShipmentEnabled: "financeEnabled",
  financeAutoAllocateOnPaymentEnabled: "financeEnabled",
  // ⚠️ İPLİK bayrağı DEĞİL: kural FATURA ONAYINDA koşar (`finance/invoices`),
  // iplik defteri yalnız etkilenen taraftır. İplik modülü kapalı bir kurulumda
  // fatura ekranı hâlâ var; satırı iplikle gizlemek onu ulaşılamaz yapardı.
  financeYarnOutOnInvoiceEnabled: "financeEnabled",

  // --- TİCARET (alış siparişi · mal kabul · fiyat listesi · sayım) -----------
  purchaseBlockOverReceiptEnabled: "ticaretEnabled",
  goodsReceiptRequirePriceEnabled: "ticaretEnabled",

  // --- İPLİK (kg defteri) ---------------------------------------------------
  yarnBlockNegativeBalanceEnabled: "iplikEnabled",
  // İplik lotu kalite bekletme (2026-09-18): etkin değer sunucuda ticaret ∧ iplik — panelde iplik ETKİN değerdir, kilit bandı aynı kapıyı gösterir.
  goodsReceiptYarnQualityHoldEnabled: "iplikEnabled",
  // İptalde sebep zorunlu (2026-09-18): top iptali üretim modülünün davranış bayrağı.
  productionCancelReasonRequired: "productionEnabled",

  // --- FASON / KARTELA — anahtarları HENÜZ YOK ------------------------------
  // Üretime asmak YANLIŞ modülü kapatırdı: fason tasarımda ayrı bir modüldür
  // (`module.middleware.ts` başlığı ve `screen-catalog` aynı kararı taşır).
  // Anahtar doğana kadar bu satırlar HER kurulumda görünür.
  fasonShrinkWarnEnabled: "planlanan:fason",
  fasonShrinkTolerancePct: "planlanan:fason",
  fasonNoteMobileEntry: "planlanan:fason",
  kartelaMeasurementEnabled: "planlanan:kartela",

  // --- ÇEKİRDEK: sipariş & müşteri ------------------------------------------
  // ⚠️ `pricingEnabled` ön muhasebeye AİT DEĞİL: operasyon ekranlarındaki fiyat
  // alanlarını açar ve `financeEnabled`ten BAĞIMSIZ olduğu alan yorumunda
  // yazılı. Muhasebeye asmak, muhasebesiz kurulumda sipariş fiyatını
  // ulaşılamaz yapardı.
  pricingEnabled: "cekirdek",
  customerBranchesEnabled: "cekirdek",
  duplicatesFuzzyEnabled: "cekirdek",
  duplicatesFuzzyThresholdPct: "cekirdek",
  [SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS]: "cekirdek",

  // --- ÇEKİRDEK: sevkiyat & depo --------------------------------------------
  shipmentConfirmationEnabled: "cekirdek",
  shipmentManualSackCountEnabled: "cekirdek",
  shipmentUndoSameDayOnly: "cekirdek",
  shippingOrderRequirement: "cekirdek",
  itemPhaseOutNewOrder: "cekirdek",
  itemPhaseOutLineQty: "cekirdek",
  itemPhaseOutNewPlan: "cekirdek",
  shippingWeighRequiredEnabled: "cekirdek",
  shippingManualWeightRestrictedEnabled: "cekirdek",
  shippingInvoiceMode: "cekirdek",
  shippingDocItemNameMode: "cekirdek",
  shippingDocCekiNameMode: "cekirdek",
  shippingOrderCoverage: "cekirdek",
  shippingDocProductColorSplit: "cekirdek",
  packingGroupsEnabled: "cekirdek",
  packingGroupNumbering: "cekirdek",
  packingGroupMode: "cekirdek",
  packageNoStartsAtZero: "cekirdek",
  packageNoMode: "cekirdek",
  packageNumbering: "cekirdek",
  packingLotRequired: "cekirdek",
  packingLotPartialDispatch: "cekirdek",
  shippingDocPackingLot: "cekirdek",
  shippingSackSeqOnDoc: "cekirdek",
  shippingSackSeqPrefix: "cekirdek",
  shippingSackSeqPrefixLive: "cekirdek",
  shippingSackSeqStart: "cekirdek",
  shippingSackSeqShowTotal: "cekirdek",
  packingPoolPackageNo: "cekirdek",
  sackDumpNameMode: "cekirdek",
  shippingAllocWidthToleranceEnabled: "cekirdek",
  shippingAllocWidthToleranceCm: "cekirdek",
  shippingAllowOverAllocation: "cekirdek",
  shippingSimulatedWeightEnabled: "cekirdek",
  returnGradingEnabled: "cekirdek",
  [SETTING_KEYS.SHIPPING_TOLERANCE_METERS]: "cekirdek",

  // --- ÇEKİRDEK: kimlik · oturum · cihaz · baskı · sistem --------------------
  companyName: "cekirdek",
  demoModeEnabled: "cekirdek",
  devicePairingRequired: "cekirdek",
  sessionDurationMinutes: "cekirdek",
  sessionDurationHours: "cekirdek",
  idleTimeoutMinutes: "cekirdek",
  workSessionIdleTimeoutMinutes: "cekirdek",
  autoLogoutOnExpiry: "cekirdek",
  mobileIdleLockEnabled: "cekirdek",
  mobileIdleLockMinutes: "cekirdek",
  mobileLockOnBackground: "cekirdek",
  absoluteSessionCapDays: "cekirdek",
  pinLockoutEnabled: "cekirdek",
  pinLockoutAttempts: "cekirdek",
  pinLockoutPenaltySec: "cekirdek",
  pinLockoutEscalateAfter: "cekirdek",
  pinLockoutLongPenaltyMin: "cekirdek",
  sameTypeSessionPolicy: "cekirdek",
  labelCopies: "cekirdek",
  nativeSendEnabled: "cekirdek",
  mobileRasterEnabled: "cekirdek",
  scrapGradeLabelEnabled: "cekirdek",
  backupHour: "cekirdek",
};

/**
 * Bu satırın GİZLENEBİLİR sahibi (yoksa `null` = çekirdek/planlanan → hep görünür).
 *
 * ⚠️ TANINMAYAN ANAHTARDA FAIL-OPEN. Tablo derleme zamanında tamdır; buraya
 * bilinmeyen bir anahtar ancak elle kurulmuş bir string ile gelir. O durumda
 * satırı GİZLEMEK, çalışan bir davranışın ayarını hiçbir ekranda bırakmamak
 * demektir ("açtım, kapatamıyorum" çıkmazı) — göstermek en kötü ihtimalle
 * fazladan bir satırdır. Yön bilinçli.
 */
export function flagOwnerModule(rowKey: string): HideableModule | null {
  const owner = (FLAG_MODULE as Record<string, FlagOwner | undefined>)[rowKey];
  // ⚠️ TEK TEK KARŞILAŞTIRMA (`startsWith("planlanan:")` DEĞİL): ön ek testi
  // birliği DARALTMAZ, dönüş tipi `HideableModule`e inmez ve derleyici bu
  // fonksiyonu bir daha denetleyemez. Yeni bir `planlanan:*` değeri eklenirse
  // buradaki satır da eklenmek zorunda — istenen budur.
  if (!owner) return null;
  if (owner === "cekirdek" || owner === "planlanan:fason" || owner === "planlanan:kartela") {
    return null;
  }
  return owner;
}
