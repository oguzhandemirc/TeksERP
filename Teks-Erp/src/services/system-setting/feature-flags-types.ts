// =============================================================================
// TeksERP - System Setting / feature-flags-types
// =============================================================================
// FeatureFlags sözleşmesi + modül anahtarı eşlemesi.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import { type FinishingKgBasis } from "../helpers/fabric-cost-kg.helper";
import { type PhaseOutLineQty, type PhaseOutNewOrder } from "../helpers/item-lifecycle-settings.helper";
import { type CompanyLegalIdentity, type EIrsaliyeConfig } from "../e-irsaliye/e-irsaliye-settings";
import { licenseModuleBlock, type LicenseModuleBlock } from "../../lib/license/module-ceiling";
import { MODULE_SETTING_KEYS } from "../../constants/module-flags";
import { type CariHoldDefaultScope, type CariHoldEmanetShipment, type CariHoldReleaseBySamePerson, type CostPresentationCurrency, type DokumaRollBirth, type ExpenseAllocationClosedWorkOrder, type ExpenseAllocationField, type ExpenseCategorySuggestions, type KursunGramPriceBasis, type KursunMachineAssignMode, type KursunMeterCapture, type KursunMeterStockMode, type KursunMeterVarianceApproval, type KursunMeterVarianceBasis, type LabelCopiesSource, type LabelCustomerCodeAt, type LabelCustomerCodeMissing, type LoginMethodsConfig, type OrderProductionProposalMode, type PackageNoMode, type PackageNumbering, type PackingGroupMode, type PackingGroupNumbering, type PackingPoolPackageNo, type ProductionRouteMode, type ProductionScanRouteStations, type ProfitCategoryClassMap, type ProfitConsumablePriceSource, type ProfitMachineTimeMode, type ProfitOverheadKey, type ProfitSubcontractSource, type RiskLimitCurrencyMode, type SackDumpNameMode, type SameTypeSessionPolicy, type ServiceBillingBrodeUnit, type ServiceBillingMeterBasis, type ServiceBillingMissingMeter, type ServiceBillingPriceDate, type ServiceBillingTrigger, type ShipReadyNotifyUnit, type ShipReadyRule, type ShipmentOrderRequirement, type ShippingDocCekiNameMode, type ShippingDocItemNameMode, type ShippingInvoiceMode, type ShippingOrderCoverage, type ShippingSackSeqPrefix, type TamburCalibrationCheck, type TamburChildWidthSource, type TamburLabelPrintTiming, type TamburPlanWidthCheck, type TezgahAlarmNoShiftMode, type WeavingStandardMethod, type WebTotpPolicy } from "./defaults";
import { type CompanyLetterhead, type DocumentsConfig } from "./documents";
import { SETTING_KEYS } from "./keys";
import { type DefaultLabelMedia } from "./labels";
import { type TravelerCardConfig } from "./traveler-card";


/**
 * Tüm public feature flag'lerin tek atışta okunmuş hali. Frontend app
 * açılışında 1 kez çekip context'e koyar; UI bu flag'lere göre alanları
 * gösterir/gizler. Backend tarafı feature flag'i ENFORCE ETMEZ — sadece
 * UI rehberi (admin/test araçları field'ları gönderebilir).
 */
export interface FeatureFlags {
  /** ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli). */
  companyName: string;
  /** Fabrikanın ŞU ANKİ saat dilimi (IANA). Bir kaydın saati/günü KAYDIN ANINDAKİ dilimle basılır: dönem
   *  DURUMU (`factoryTimezoneBase` · `factoryTimezonePeriods` · `factoryTimezonePending`) bayrak değildir, route
   *  yanıta süreç değerinden ekler; istemci kendi bilgisayar dilimini KULLANMAZ. Salt-okunur: yalnız
   *  `PUT /api/feature-flags/factory-timezone` (+ iptal ucu) dönem ekler. */
  factoryTimezone: string;
  /** YALNIZ kayıtlı dilim geçersizken VAR (`FACTORY_TIMEZONE_INVALID_STORED`; sunucu `factoryTimezone` ile koşuyor).
   *  Sorun yokken anahtar hiç gönderilmez — null göndermek sayısal ayar sözleşmesine karışırdı. */
  factoryTimezoneWarning?: { code: string; message: string };
  pricingEnabled: boolean;
  /** Ön muhasebe modülü (cari · fatura · tahsilat · kasa/banka) açık mı.
   *  Varsayılan KAPALI — üretici fabrika bu modülü kullanmıyor ve kapalıyken
   *  menüde tek satır bile görünmez. `pricingEnabled` ile bağımsız. */
  financeEnabled: boolean;
  /** Kasa eksi bakiyeye düşemesin (default false). Backend ENFORCE — 4 ileri
   *  yol 409 (ödeme OUT · masraf · virman çıkan kasa bacağı · çek ödeme);
   *  banka ve iptal/storno yolları MUAF. */
  financeBlockNegativeCashEnabled: boolean;
  /** Fatura satırının varsayılan KDV oranı, % (0-100; default 20). Yalnız
   *  ön-dolum — kullanıcı satırda değiştirebilir. */
  financeDefaultVatRate: number;
  /** D4-V1k: satış taslağında genel tevkifat (varsayılan KAPALI). Pay 0 = girilmemiş; payda varsayılan 10. */
  financeWithholdingEnabled: boolean;
  financeWithholdingNumerator: number;
  financeWithholdingDenominator: number;
  /** Fatura onayında bağlı mal kabul fişleriyle miktar/tutar toleransı ölçülsün mü (varsayılan KAPALI = kontrol yok). HAM; etkin `finance && bayrak`. */
  financeInvoiceMatchTolerance: boolean;
  /** Miktar / tutar sapma üst sınırı (%; 0 = fark kabul edilmez). Yalnız bayrak açıkken anlamlı. */
  financeInvoiceQtyTolerancePct: number;
  financeInvoicePriceTolerancePct: number;
  /** Çek teslim bordrosu çeki hareket ettirir mi (varsayılan KAPALI = belge-only). HAM; etkin `finance && bayrak`. */
  financeChequeNoteMovementEnabled: boolean;
  // --- TİCARET/MUHASEBE REJİM ANAHTARLARI (2026-08-14, dalga 1) --------------
  // ⚠️ Dokuzu da default FALSE ve bugün HİÇBİR servis okumuyor (bilinçli ara
  // durum — bkz. SETTING_KEYS bloğundaki gerekçe). Davranışı bağlayan dalga
  // buradaki MUAF listelerini birebir uygular.
  /** Cari risk limiti aşımında SATIŞ faturası onayını engelle (default false).
   *  Bugün limit yalnız uyarıdır; açıkken onay 409 döner. MUAF: alış faturası,
   *  taslak yolları ve iptal/storno. */
  financeRiskLimitBlockEnabled: boolean;
  /** D4-I2: risk limiti aşımında yeni iş kabulünü engelle (default false). */
  financeRiskLimitBlockIntake: boolean;
  /** D4-I2: risk limiti aşımında sevki engelle (default false; tamamı emanet sevk muaf). */
  financeRiskLimitBlockShipment: boolean;
  /** Sevk onayında otomatik satış faturası TASLAĞI üret (default false). Onay
   *  her zaman elle kalır; `financeEnabled` kapalıyken kanca no-op'tur ve
   *  taslak hatası sevki DÜŞÜRMEZ. */
  financeAutoDraftFromShipmentEnabled: boolean;
  /** H7: sevk taslağına hizmet satırları + fatura bağı (default false = kanca bayt-aynı). HAM. */
  financeServiceBillingEnabled: boolean;
  /** H7: faturalanan metre tabanı (default `OUT`). */
  financeServiceBillingMeterBasis: ServiceBillingMeterBasis;
  /** H7: ölçüm yoksa (default `DECLARED_WITH_WARNING`). */
  financeServiceBillingMissingMeter: ServiceBillingMissingMeter;
  /** Brode fiyat birimi (default `METER`). */
  financeServiceBillingBrodeUnit: ServiceBillingBrodeUnit;
  /** H7/H8: tetik (default `PER_SHIPMENT`; `PERIOD_END` → dönem sonu taslağı). */
  financeServiceBillingTrigger: ServiceBillingTrigger;
  /** H7: fiyat tarihi (default `SERVICE_DAY`). */
  financeServiceBillingPriceDate: ServiceBillingPriceDate;
  financeKursunGramPriceBasis: KursunGramPriceBasis;
  /** D4-H1: kasa masraf formunda kategori önerisi (varsayılan `ON`). */
  financeExpenseCategorySuggestions: ExpenseCategorySuggestions;
  financeExpenseAllocationField: ExpenseAllocationField;
  financeExpenseAllocationClosedWorkOrder: ExpenseAllocationClosedWorkOrder;
  /** D4-I1a: cari kilidi kapsam ön seçimi (varsayılan `INTAKE,SHIPMENT`). */
  financeCariHoldDefaultScope: CariHoldDefaultScope;
  /** D4-I1a: koyan kişi kendi kilidini açabilir mi (varsayılan `ALLOW`). */
  financeCariHoldReleaseBySamePerson: CariHoldReleaseBySamePerson;
  /** D4-I1c: kilitli caride emanet sevki (varsayılan `EXEMPT`). */
  financeCariHoldEmanetShipment: CariHoldEmanetShipment;
  /** SY-J1: maliyet sunum dövizi (varsayılan `TRY` = bugünkü TL-yalnız yanıt). */
  costPresentationCurrency: CostPresentationCurrency;
  /** SY-E1: KG tabanlı terbiye tarifesinin kg kaynağı (varsayılan `NET_HAM`). */
  costFinishingKgBasis: FinishingKgBasis;
  /** D4-I2b: risk limiti para birimi kipi (varsayılan `PER_CURRENCY`). */
  financeRiskLimitCurrencyMode: RiskLimitCurrencyMode;
  /** D4-G2a: kârlılık dış fason kaynağı (varsayılan `FATURA_ONCE`). */
  costProfitSubcontractSource: ProfitSubcontractSource;
  /** D4-G2a: kârlılık sarf birim fiyatı kaynağı (varsayılan `ALIS_FIYATI`). */
  costProfitConsumablePriceSource: ProfitConsumablePriceSource;
  /** SY-D2: dokuma standart maliyet yöntemi (varsayılan `TEZGAH_SAATI`). */
  costWeavingStandardMethod: WeavingStandardMethod;
  /** SY-M1: siparişten üretim önerisi (varsayılan `KAPALI`). */
  orderProductionProposal: OrderProductionProposalMode;
  /** D4-G2b: kârlılık makine süresi kaynağı (varsayılan `OTURUM`). */
  costProfitMachineTime: ProfitMachineTimeMode;
  /** D4-G2b: genel gider dağıtım anahtarı (varsayılan `YOK`). */
  costProfitOverheadKey: ProfitOverheadKey;
  /** D4-G2b: masraf kategorisi → sınıf haritası (varsayılan `{}`). */
  costProfitCategoryClasses: ProfitCategoryClassMap;
  /** Tahsilat/ödemede en eski açık faturalara otomatik FIFO kapama (default
   *  false). Artan tutar avans olarak açıkta kalır; otomatik tahsis elle
   *  silinebilir; farklı para birimli fatura atlanır. */
  financeAutoAllocateOnPaymentEnabled: boolean;
  /** İplik çıkışında eksi bakiyeye düşecek hareketi engelle (default false).
   *  Kasa emsali. MUAF: ters/düzeltme (`ADJUST_OUT`) ve belge iptali. */
  yarnBlockNegativeBalanceEnabled: boolean;
  /** Alış siparişine bağlı mal kabulde sipariş miktarını aşan satırı engelle
   *  (default false = fazla mal kaydedilir, servis uyarır). MUAF: siparişsiz
   *  kabul, kabul iptali/düzeltmesi. */
  purchaseBlockOverReceiptEnabled: boolean;
  /** Mal kabul satırında birim fiyat zorunlu (default false). Çözülemezse 400.
   *  MUAF: ters/iptal satırları. Bedelsiz kalem kaçışı
   *  `financeAllowZeroPriceLineEnabled`tir. */
  goodsReceiptRequirePriceEnabled: boolean;
  consumableStockEnabled: boolean;
  /** İplik lotu kalite bekletme: mal kabulde doğan lot ON_HOLD doğar; ON_HOLD/BLOCKED lota çıkış 400 (varsayılan KAPALI = bugünkü). HAM; etkin `ticaret && iplik && bayrak`. */
  goodsReceiptYarnQualityHoldEnabled: boolean;
  /** İptalde sebep zorunlu (kullanıcı kararı 2026-09-18): top iptalinde sebep metni ya da katalog kodu şart; varsayılan false. */
  productionCancelReasonRequired: boolean;
  /** Sıfır fiyatlı fatura satırıyla onaya izin ver (default false). İzin
   *  verilen SIFIRDIR, boş/çözülemeyen fiyat değil; negatif her hâlükârda red. */
  financeAllowZeroPriceLineEnabled: boolean;
  /** İleri tarihli mali belge tarihini engelle (default false). Sınır FABRİKA
   *  günüdür. MUAF (Sınıf 1): çekin keşide ve vade tarihi. */
  financeFutureDatedDocumentBlockEnabled: boolean;
  /** Satış faturası onayında iplik satırlarını varsayılan depodan stoktan düş
   *  (default false = stok yalnız sevkte düşer). ⚠️ Sevkten de düşen kurulumda
   *  açmak ÇİFTE DÜŞÜM olur — bu bir rejim sorusudur. İptal geri yazar. */
  financeYarnOutOnInvoiceEnabled: boolean;
  /** Üretim modülü (envanter üretim sekmeleri + iş emri yüzeyleri). Varsayılan AÇIK.
   *  Route kapısı `requireProductionEnabled` (2026-09-02'den beri gerçek bir kapı). */
  productionEnabled: boolean;
  /** Ticaret modülü (alış siparişi · mal kabul · fiyat listeleri · stok sayımı).
   *  Varsayılan KAPALI. `financeEnabled` ile bağımsız: biri MAL hareketinin
   *  ticari yüzünü, diğeri cari/fatura defterini açar. */
  ticaretEnabled: boolean;
  /** İplik modülü (kg defteri: `YarnStock`/`YarnMovement`). Varsayılan KAPALI.
   *  ⚠️ TİCARETE BAĞIMLI — ticaret kapalıyken açılamaz (400) ve kapı 403 verir.
   *  Bu alan HAM değerdir; etkin değeri (ticaret && iplik) kapı çözer. */
  iplikEnabled: boolean;
  /** Çoklu depo modülü (depo seçici · depo kolonu · depolar arası transfer).
   *  Varsayılan KAPALI; mevcut kurulumda değer aktif depo sayısından ÖLÇÜLEREK
   *  damgalandı (migration 20260902230000). */
  depoMultiEnabled: boolean;
  /** Kumaş teknik kartı modülü. YER TUTUCU — arkasında henüz yüzey yok. */
  kumasTeknikEnabled: boolean;
  /** Dokuma tezgah izleme modülü (Tezgah Salonu canlı ekranı). Varsayılan KAPALI.
   *  ÜRETİME BAĞIMLI (üretim kapalıyken açılamaz). */
  tezgahEnabled: boolean;
  /** İletim payı (dk, default 0; 0–1440) — fabrika genelinde tek değer. */
  tezgahEscalationGraceMinutes: number;
  /** Dokuma alarm motoru (HAM değer; etkin = `tezgahEnabled ∧ tezgahAlarmEnabled`). Varsayılan KAPALI. */
  tezgahAlarmEnabled: boolean;
  /** Sebepsiz duruşun ortak hedef süresi (dk, HAM); etkin hedef `resolveTezgahAlarmUnclassifiedTarget`. */
  tezgahAlarmUnclassifiedTargetMinutes: number | null;
  /** Sebepsiz duruşta alarm (satır yoksa süreden türer: boş = kapalı). */
  tezgahAlarmUnclassifiedEnabled: boolean;
  /** Alarm tekrar aralığı (dk, varsayılan 10; 1–120). */
  tezgahAlarmRenotifyMinutes: number;
  /** Kart duruşu geçici kapanış eşiği (sa, varsayılan 12; 1–168). */
  tezgahMaxOpenStopHours: number;
  /** Kart sessizlik eşiği (dk, varsayılan 10; 1–1440). */
  tezgahCollectorSilenceMinutes: number;
  /** Üstlenilmiş alarm da üst kademeye çıkar (varsayılan AÇIK). */
  tezgahAlarmEscalateWhenAcked: boolean;
  /** Vardiyasız zamanda alarm: WARN (varsayılan) · ALWAYS · REQUIRE_SHIFT. */
  tezgahAlarmNoShiftMode: TezgahAlarmNoShiftMode;
  /** Devere / levent modülü (çözgü kartı · levent stoğu · levent defteri).
   *  Varsayılan KAPALI. ⚠️ İPLİĞE BAĞIMLI, iplik de ticarete: bu alan HAM
   *  değerdir (panel toggle'ı kendi yazdığını geri okusun diye); etkin değer
   *  `ticaret && iplik && devere` ve kapının içinde çözülür. */
  devereEnabled: boolean;
  /** G3 emanet / konsinye mülkiyet modülü. Varsayılan KAPALI. */
  emanetEnabled: boolean;
  /** K4P Kalite Güvence modülü (muayene · lab testi · sertifika). Varsayılan KAPALI. */
  kaliteGuvenceEnabled: boolean;
  /** Devere Faz 2: lot zorunluluğu (içeride sarım iplik çıkışı + mal kabul iplik satırı). Varsayılan KAPALI =
   *  bugünkü davranış: lotsuz satır yazılır, yalnız uyarı üretir. */
  devereLotRequired: boolean;
  /** Devere Faz 3: tezgah bağı defteri açık mı (varsayılan KAPALI = levent READY'de kalır). */
  devereMountTracking: boolean;
  /** Devere Faz 3: bağlamada yöntem + başlangıç zorunlu mu (varsayılan KAPALI). */
  devereMountTrackingRequired: boolean;
  devereAutoConsume: boolean;
  /** Z1: levent sarımında dokuma işi bağı zorunlu (varsayılan KAPALI = serbest levent meşru). HAM; etkin `devere && bayrak`. */
  devereBeamWeavingLinkRequired: boolean;
  /** Z1: tezgah koşumu dokuma işine bağlı açılmalı (varsayılan KAPALI = stoka dokuma meşru). HAM; etkin `dokuma && bayrak`. */
  dokumaRunWeavingOrderRequired: boolean;
  /** Z1: dokuma işi en az bir sipariş satırına bağlı olmalı (varsayılan KAPALI). HAM; etkin `dokuma && bayrak`. */
  dokumaOrderLineLinkRequired: boolean;
  /** S1: topun doğuş yolu (varsayılan `TABLET_DOFF` = bugün). HAM; etkin `resolveDokumaRollBirth` (dokuma kapalı → TABLET_DOFF). */
  dokumaRollBirth: DokumaRollBirth;
  /** Dokuma işi modülü (dokuma işi planlama · tezgah koşumu · top indirme).
   *  Varsayılan KAPALI. ⚠️ ÜRETİME BAĞIMLI: bu alan HAM değerdir; etkin değer
   *  `production && dokuma` ve kapının içinde çözülür. */
  dokumaEnabled: boolean;
  /** Maliyet & Teklif modülü. Varsayılan KAPALI. ⚠️ ÜRETİME BAĞIMLI: bu alan HAM değerdir;
   *  etkin değer `production && maliyet` ve kapının içinde çözülür. */
  maliyetEnabled: boolean;
  /** Gelen belge taslağı modülü (OCR). Varsayılan KAPALI. ⚠️ EMANETE BAĞIMLI: bu alan HAM değerdir;
   *  etkin değer `emanet && gelenBelge` ve kapının içinde çözülür. */
  gelenBelgeEnabled: boolean;
  /**
   * KAPALI rapor anahtarları. `null` = LİSTE OKUNAMADI (bozuk satır) — "hiçbiri kapalı
   * değil" ile aynı şey DEĞİL; panel bunu fail-closed okur (R2/K5) ve rapor çizmez.
   */
  reportsClosedKeys: string[] | null;
  /** Yeni rapor merkezi (Raporlar v2) açık mı (default false). Client (panel) okur. */
  reportsV2Enabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  /** KK1 ham kumaş girişinde ağırlık (kg) alanı gösterilsin mi. Default false;
   *  backend ENFORCE eder (kapalıyken gelen weightKg reddedilir). */
  kk1WeightEntryEnabled: boolean;
  /** Ham girişte mükerrer top tuzağı açık mı (default false). Backend ENFORCE
   *  eder: 90 sn içinde birebir aynı giriş 409 POSSIBLE_DUPLICATE alır ve ancak
   *  açık onayla (`confirmDuplicate`) geçer. */
  kk1DuplicateGuardEnabled: boolean;
  /** Hızlı iş emri izni yalnız kendi başlattığı iş emrini düzenler (default false). Backend ENFORCE. */
  workOrderQuickOwnOnlyEnabled: boolean;
  /** Destek talepleri yalnız sahibine görünür, yönetici hepsini (default false). Backend ENFORCE. */
  supportOwnTicketsOnlyEnabled: boolean;
  /** KK1 ham giriş çevrimdışı kuyruksuz (online-only) rejimde mi (default false).
   *  Client (mobil) ENFORCE — açıkken KK1 çevrimdışı kayıt almaz, kayıt+etiket
   *  tek nefeste yürür. */
  kk1OnlineOnlyEnabled: boolean;
  /** KK1 etiket geri-okutma doğrulaması (default false). Client (mobil) ENFORCE —
   *  açıkken basılan etiket okutulmadan yeni top girilemez. */
  kk1LabelScanVerifyEnabled: boolean;
  /** KK1 "Tüm Girişler" tüm operatörleri göstersin mi (default false). Client
   *  (mobil) ENFORCE — kapalıyken liste yalnız operatörün kendi kayıtları. */
  kk1HistoryAllEntriesEnabled: boolean;
  /** Simüle kantardan gelen çuval tartısı kaydedilebilsin mi. Default false;
   *  backend ENFORCE eder (kapalıyken simüle okuma `weighSack`'te 400).
   *  Demo/eğitim kurulumu açar — çuval kg'si irsaliyeye/çeki listesine basılır. */
  shippingSimulatedWeightEnabled: boolean;
  returnGradingEnabled: boolean;
  /** Kartela kabulünde cm/kg ölçü alanları + kartela listelerinde ölçü gösterimi
   *  açık mı (default false — yalnız ADET). */
  kartelaMeasurementEnabled: boolean;
  partyCodeAuto: boolean;
  fasonNoteMobileEntry: boolean;
  /** Cihaz eşleştirme zorunlu mu (true=aktif) yoksa pasif mi (false=default).
   *  Diğerlerinden farklı olarak ENFORCE edilir (device.middleware). */
  devicePairingRequired: boolean;
  deviceProofRequired: boolean;
  /** Onaysız tablet yalnız parolayla girebilsin mi (default false; eşleştirme zorunluyken etkili). */
  deviceUnpairedPasswordLogin: boolean;
  /** Hızlı PIN / kart girişi yalnız onaylı cihazdan mı (ETKİN değer: barındırılan kurulumda hep true). */
  shortCredentialApprovedDeviceOnly: boolean;
  /** 2FA'sı açık hesabın PIN/kart girişinde kod sorulur mu (default false; süperadminde hep sorulur). */
  shortCredentialTotpRequired: boolean;
  /** Web paneli (tarayıcı) girişi TOTP politikası (default REQUIRED; süperadminde ayardan bağımsız hep). */
  webTotpPolicy: WebTotpPolicy;
  /** Web girişinde güvenilir cihaz süresi, gün (0 = kapalı, default; 1–90). Yalnız süperadmin yazar. */
  trustedDeviceDays: number;
  /** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu (default false). */
  shipmentConfirmationEnabled: boolean;
  shipmentManualSackCountEnabled: boolean;
  /** Çuvalsız sevk — toplar dökme ya da araba ile çıkar (default false). */
  shipmentLooseLoadEnabled: boolean;
  /** Sevk geri alma (storno) yalnız aynı fabrika gününde mi (default false = sınırsız).
   *  Faturasız + iadesiz koşulları bundan bağımsız her zaman geçerlidir. */
  shipmentUndoSameDayOnly: boolean;
  /** Sevkiyat siparişe bağlanmalı mı: 'off' | 'warn' (default) | 'block'.
   *  Backend ENFORCE eder — kapı YALNIZ kurulumda (dispatch'e konmaz). */
  shippingOrderRequirement: ShipmentOrderRequirement;
  /** "Tükenene kadar" karta yeni sipariş (default OKUTULAN_TOPLAR). */
  itemPhaseOutNewOrder: PhaseOutNewOrder;
  /** "Tükenene kadar" kartın açık satırında miktar (default SERBEST_UYARILI). */
  itemPhaseOutLineQty: PhaseOutLineQty;
  /** "Tükenene kadar" karta yeni üretim planı açık mı (default true). */
  itemPhaseOutNewPlan: boolean;
  /** Sevk öncesi TÜM çuvallar tartılmalı mı (default false → yalnız ihracat).
   *  Backend ENFORCE eder; ihracat kuralı bayraktan bağımsız her zaman geçerli. */
  shippingWeighRequiredEnabled: boolean;
  /** Elle tartı (MANUAL) yalnız `shipping:write` taşıyan kimlikte mi serbest
   *  (default false = herkes girebilir). Backend ENFORCE eder. YENİ İZİN YOK. */
  shippingManualWeightRestrictedEnabled: boolean;
  /** Fatura izi rejimi: 'dis' (default) | 'ic' | 'ikisi'. Backend ENFORCE eder. */
  shippingInvoiceMode: ShippingInvoiceMode;
  /** Sevk belgesinde ürün adı: 'bizdeki' (default) | 'musterideki' | 'ikisi'.
   *  Backend UYGULAR (renderer okur) — istemci rehberi DEĞİL. */
  shippingDocItemNameMode: ShippingDocItemNameMode;
  /** Çeki listesi bölümünde ad: 'devral' (default, genel rejimi izler) | 'bizdeki'
   *  | 'musterideki' | 'ikisi'. Yalnız çeki bölümünü çevirir. */
  shippingDocCekiNameMode: ShippingDocCekiNameMode;
  /** Kapsama rejimi: 'off' (default — bugünkü davranış) | 'warn' | 'block'.
   *  Çuvaldaki malın seçili siparişlere YAZILABİLDİĞİNİ ölçer. */
  shippingOrderCoverage: ShippingOrderCoverage;
  /** Ürün listesinde müşteri rengi AYRI sütun mu (default false = bugünkü birleşik dize). */
  shippingDocProductColorSplit: boolean;
  /** Paketleme grubu açık mı (default false = bugünkü düz liste + "hepsini sevk et"). */
  packingGroupsEnabled: boolean;
  /** Grup numara rejimi: 'artan' (default) | 'bosluk-doldur'. */
  packingGroupNumbering: PackingGroupNumbering;
  /** Grup davranış modu: 'grup' (default = bugünkü) | 'sevk-partisi'. */
  packingGroupMode: PackingGroupMode;
  /** Ambalaj no 0'dan mı başlar (default false = 1'den). */
  packageNoStartsAtZero: boolean;
  /** Ambalaj no atama modu: 'otomatik' | 'otomatik-ezilebilir' (default) | 'elle'. */
  packageNoMode: PackageNoMode;
  /** Ambalaj no sayaç rejimi: 'artan' (default) | 'bosluk-doldur'. */
  packageNumbering: PackageNumbering;
  /** Partisiz çuval açma 400 (default false). */
  packingLotRequired: boolean;
  /** Partinin alt kümesi sevk edilebilir (default TRUE). */
  packingLotPartialDispatch: boolean;
  /** İrsaliye/çeki listesinde parti adı + ambalaj no kolonu (default false). */
  shippingDocPackingLot: boolean;
  /** Sevkiyat içi çuval sırası etiketi irsaliye/çeki listesine basılsın (default FALSE = bugünkü çıktı). */
  shippingSackSeqOnDoc: boolean;
  /** Sıra etiketi ön eki — serbest metin, en çok 8 karakter (default ""). */
  shippingSackSeqPrefix: ShippingSackSeqPrefix;
  /** Ön ek eski belgelere de uygulansın (default FALSE = sevk anındaki ön ek belgede donar). */
  shippingSackSeqPrefixLive: boolean;
  /** Sıra başlangıcı (default 1; 0–999). */
  shippingSackSeqStart: number;
  /** İade irsaliyesi dipnotu — serbest metin, en çok 300 karakter (default "" = basılmaz). */
  shippingReturnFootnote: string;
  /** Etikette toplam da yazılsın: "3/100" (default FALSE). */
  shippingSackSeqShowTotal: boolean;
  /** Partisiz çuvalın ambalaj no'su: `sevkte` (default) · `acilista`. */
  packingPoolPackageNo: PackingPoolPackageNo;
  /** Çuval/grup içerik dökümünde ad: 'ikisi' (default) | 'bizdeki' | 'musterideki'. */
  sackDumpNameMode: SackDumpNameMode;
  /** Tahsiste EN toleransı açık mı (default false = tam eşitlik). */
  shippingAllocWidthToleranceEnabled: boolean;
  /** Tolerans (cm) — yalnız bayrak açıkken uygulanır. */
  shippingAllocWidthToleranceCm: number;
  /** Tahsis sipariş miktarını aşabilir mi (fazla sevk deftere yazılır). Default false. */
  shippingAllowOverAllocation: boolean;
  /** Sevke hazırlık kuralı (default ALL_DONE; D4-J1). */
  shippingReadyRule: ShipReadyRule;
  /** METER_THRESHOLD toleransı (%), 0–20, default 2. */
  shippingReadyTolerancePct: number;
  /** Sevke hazır bildirimi birimleri (default boş = kapalı; bildirim D4-J2). */
  shippingReadyNotifyUnits: ShipReadyNotifyUnit[];
  /** Sevke hazır tarama periyodu (dk), 1–60, default 5 (bildirim D4-J2). */
  shippingReadyScanMinutes: number;
  /** Müşteri şubeleri (sevk noktaları) UI'da açık mı (default TRUE). Kapalıyken
   *  müşteri formundaki Şubeler sekmesi/taslağı ve sipariş formundaki şube seçimi
   *  gizlenir. Salt UI rehberi — backend ENFORCE ETMEZ, mevcut branchId verisi korunur. */
  customerBranchesEnabled: boolean;
  /** Refakat kartı marka/içerik ayarı (firma adı + bölüm görünürlükleri). */
  travelerCardConfig: TravelerCardConfig;
  /** Belge künyesi (adres/tel/vergi) — irsaliye/çeki üst bloğunda basılır. */
  companyLetterhead: CompanyLetterhead;
  /** Gönderici resmi künyesi (e-İrsaliye/e-belge kimliği). */
  companyLegalIdentity: CompanyLegalIdentity;
  /** e-İrsaliye yapılandırması; hazırlık sorusu yalnız `resolveEIrsaliyeReadiness`ten. */
  eIrsaliyeConfig: EIrsaliyeConfig;
  /** Yazdırılan belgelerin içerik ayarı (canlı). Ham map; client resolveDocConfig ile çözer. */
  documentsConfig: DocumentsConfig;
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi (default TRUE/açık).
   *  Diğer flag'lerin aksine ENFORCE edilir — tambur kesim guard'ı bu flag'e bağlı. */
  tamburOverQuantityEnabled: boolean;
  /** Tambur "TÜMDEN geri al" yalnız aynı fabrika günü içinde mi (default FALSE). */
  tamburUndoFullSameDayOnly: boolean;
  /** D4-B1: Tambur kesiminde simüle metre kabul (varsayılan AÇIK = bugün). */
  tamburSimulatedMeterEnabled: boolean;
  /** D4-B1: Tambur kesiminde ölçüm kaynağı zorunlu (varsayılan KAPALI; önce tüm tabletler yeni sürümde olmalı). */
  tamburMeasureSourceRequired: boolean;
  /** D4-B5k: süresi geçmiş sayaç kalibrasyonunda ölçüm uyarısı (varsayılan KAPALI). */
  tamburCalibrationCheck: TamburCalibrationCheck;
  /** Kısa kesimde otomatik A1 — FABRİKA VARSAYILANI (default FALSE/kapalı).
   *  Kural istemcide koşar; tablet yetkilisi cihaz bazında ezebilir. */
  tamburShortCutA1Enabled: boolean;
  /** Kısa kesim eşiği (metre); NULL = girilmemiş → kural ateşlemez. */
  tamburShortCutA1ThresholdM: number | null;
  /** Tambur plan kapısı en eşiği (cm), default 10; `0` = her farkta sorar. */
  tamburPlanGateWidthToleranceCm: number;
  /** Tambur plan kapısı en kontrolü (default ENFORCE); OFF yalnız en kolunu atlar. */
  tamburPlanGateWidthCheck: TamburPlanWidthCheck;
  /** Tambur finalize çocuk en kaynağı (default WO_TARGET_FIRST = bugünkü). */
  tamburChildWidthSource: TamburChildWidthSource;
  /** Tambur etiket basım zamanı (default EACH = bugünkü; istemcide uygulanır). */
  tamburLabelPrintTiming: TamburLabelPrintTiming;
  /** Tablet Tambur listesi oturum istasyonuyla süzülsün mü (default FALSE; istemcide uygulanır). */
  tamburListByStationEnabled: boolean;
  /** Dokuma kapalıyken de makine duruşu kaydedilsin mi (D4-A1; default FALSE = bugünkü). HAM değer;
   *  rejim `dokuma ∨ (üretim ∧ bu)` yalnız `machineStopRegime`de çözülür. */
  machineStopTrackingEnabled: boolean;
  /** Açık duruşta tablet dokunuş uyarısı (D4-A2b; default FALSE). Yalnız istemci ipucu — kapı değil. */
  machineStopOpenWarningEnabled: boolean;
  /** Fason kabulünde çekme (giden↔dönen farkı) uyarısı çıksın mı (default TRUE). */
  fasonShrinkWarnEnabled: boolean;
  /** Fason kabulünde hedef çeşit değeri (desen) doğan topa (D4-D3; default FALSE). */
  fasonReceiptApplyTargetVariant: boolean;
  /** Çekme toleransı — YÜZDE. Default 10. `0` = tolerans yok (her fark uyarır). */
  fasonShrinkTolerancePct: number;
  /** Demo kurulumu mu (default FALSE) — `/api/demo/*` senaryo üreticilerini açar. */
  demoModeEnabled: boolean;
  /** Mükerrer paneli: bulanık ad eşleştirme (default TRUE). Kapalıyken yalnız kesin ad + kimlik. */
  duplicatesFuzzyEnabled: boolean;
  /** Mükerrer paneli: bulanık benzerlik eşiği — YÜZDE (default 90, 50-100). */
  duplicatesFuzzyThresholdPct: number;
  /** Kurşun bypass düzeni açık mı (default FALSE/kapalı). ENFORCE edilir ama YALNIZ
   *  yeni atama oluşturmayı kapılar; dağıtılmış iş emirleri bayrak kapansa da bypass
   *  rejiminde biter (rejim atama satırında kalıcıdır). */
  kursunBypassEnabled: boolean;
  /** H1: kurşun metre ölçümü (varsayılan `OFF` = bugün). HAM; etkin `resolveKursunMeterCapture` (üretim kapalı → OFF). */
  kursunMeterCapture: KursunMeterCapture;
  /** H1: SIMULATED metre okuması kabul edilsin mi (varsayılan KAPALI → 400). */
  kursunSimulatedMeterEnabled: boolean;
  /** H2: sapma eşiği metre (0 = eşik yok). */
  kursunMeterVarianceThresholdM: number;
  /** H2: sapma eşiği yüzde (0 = eşik yok). */
  kursunMeterVarianceThresholdPct: number;
  /** H2: sapma tabanı (varsayılan `DECLARED_IN`). */
  kursunMeterVarianceBasis: KursunMeterVarianceBasis;
  /** H2: sapma onay kipi (varsayılan `NONE` = bugün). */
  kursunMeterVarianceApproval: KursunMeterVarianceApproval;
  /** H1b: çıkış metresi stok kipi (varsayılan `RECORD` = bugün). */
  kursunMeterStockMode: KursunMeterStockMode;
  /** K16: atanan kurşun makinesi (varsayılan `SUGGEST` = bugün). */
  kursunMachineAssignMode: KursunMachineAssignMode;
  /** K29: rota uygulaması (varsayılan `SEQUENTIAL` = bugün). */
  productionRouteMode: ProductionRouteMode;
  /** K29: okutmayla rota kapsamı (varsayılan `SELECTED`). */
  productionScanRouteStations: ProductionScanRouteStations;
  /** D4-F1: okutma müşteri koduna düşsün mü (varsayılan `false` = bugün; iç barkod her zaman önce). */
  scanCustomerCodeLookupEnabled: boolean;
  /** Parti no kısa ve dönen mi (P01…P99)? Default TRUE/açık. Backend ENFORCE eder.
   *  Kapalıyken eski `P + GGAAYY + sıra` kalıbı. Açıkken parti no benzersiz DEĞİLDİR. */
  batchShortNumberEnabled: boolean;
  batchLastNumberHintEnabled: boolean;
  /** Top kalitesi zorunlu mu (D6)? Default FALSE. Backend ENFORCE eder ama DAR
   *  kapsamda (KK1 girişi · Tambur kalan-kuyruk · depo kesimi · WO kapanışının
   *  depo/2.kalite satırları). ÇEKİRDEK — üretim modülüne bağlı DEĞİL. */
  qualityGradeRequiredEnabled: boolean;
  /** Açık parti yokken sunucu partiyi kendisi açsın mı (D7)? Default FALSE.
   *  Backend ENFORCE eder (`tambur-manual` elle top ekleme yolu). */
  batchAutoCreateEnabled: boolean;
  /** Oturum (JWT) ömrü — DAKİKA (default 480 = 8 saat). Dakika-granüler ayar; UI bunu
   *  yönetir. Backend ENFORCE eder (login'de jwt.sign expiresIn = ×60 sn). */
  sessionDurationMinutes: number;
  /** Oturum (JWT) ömrü — saat (default 8). GERİYE-UYUM alanı: sessionDurationMinutes'ten
   *  türetilir (Math.max(1, round(minutes/60))). Backend artık dakika ayarını ENFORCE eder. */
  sessionDurationHours: number;
  /** Hareketsizlik zaman aşımı — dakika (default 0 = kapalı). Panel bu kadar dakika
   *  işlem görmezse otomatik çıkış. Frontend ENFORCE eder. */
  idleTimeoutMinutes: number;
  /** Çalışma oturumu (kim hangi makinede) idle zaman aşımı — dakika (default 20;
   *  0 = kapalı). Backend TEMBEL enforce eder (okuma anında IDLE kapatma). */
  workSessionIdleTimeoutMinutes: number;
  /** Aynı cihaz-tipinden 2. girişte politika: 'kick' (default) | 'notify' | 'off'.
   *  Backend ENFORCE eder (login → openLoginSession). */
  sameTypeSessionPolicy: SameTypeSessionPolicy;
  /** Token süresi dolunca istemci otomatik çıkış yapsın mı (default true). Client ENFORCE. */
  autoLogoutOnExpiry: boolean;
  /** Mobil hareketsizlik ekran kilidi açık mı (default true). Client (mobil) ENFORCE. */
  mobileIdleLockEnabled: boolean;
  /** Mobil idle kilit süresi — dakika (default 10, 1..120). Client (mobil) ENFORCE. */
  mobileIdleLockMinutes: number;
  /** Mobil "uygulama arka plana geçince anında kilitle" açık mı (default true).
   *  Idle kilitten bağımsız. Client (mobil) ENFORCE. */
  mobileLockOnBackground: boolean;
  /** İnternet/sunucu yokken tablette hareketsizlik ve arka plan kilidi ertelensin mi (default false).
   *  Kilit açma sunucu ister; kesintide kilitlenen tablet açılamaz (denetim Y5). Client (mobil) ENFORCE. */
  mobileOfflineLockDefer: boolean;
  /** Masaüstü/web giriş ekranı son çıkan kullanıcının adını hatırlasın, yalnız parola sorsun (default false).
   *  Cihazda yalnız kullanıcı adı + görünen ad tutulur; sistem hesabı hatırlanmaz. Client (panel) ENFORCE. */
  rememberLastUser: boolean;
  /** Mutlak oturum tavanı — gün (default 30, 0..365; 0 = 30 gün sert tavan). Zaman aşımı kapalı
   *  olsa bile token en fazla bu kadar gün yaşar. Backend ENFORCE (issueToken). */
  absoluteSessionCapDays: number;
  /** Hızlı-PIN + kart giriş deneme kilidi açık mı (default true). Backend ENFORCE. */
  pinLockoutEnabled: boolean;
  /** Kilit tetiklenene kadar izin verilen yanlış deneme (default 5, 1..20). */
  pinLockoutAttempts: number;
  /** Kısa ceza süresi — saniye (default 60, 5..3600). */
  pinLockoutPenaltySec: number;
  /** Kaç ceza turundan sonra uzun cezaya geçilir (default 3, 1..20). */
  pinLockoutEscalateAfter: number;
  /** Uzun ceza süresi — dakika (default 15, 1..1440). */
  pinLockoutLongPenaltyMin: number;
  /** Mobil giriş yöntemleri: { enabled: ("list"|"pin"|"card")[], primary }. Login
   *  ekranı primary ile açılır; diğer etkinler "Diğer giriş yöntemleri"nde. Backend
   *  ENFORCE — card/pin uçları yalnız etkinken çalışır (klasik login hep açık). */
  loginMethods: LoginMethodsConfig;
  /** Saha #6: top etiketi kopya adedi (default 2 — üst+alt yapıştırma). 1-5. */
  labelCopies: number;
  /** Akış etiketi adedinin kaynağı — `GLOBAL` (varsayılan) | `STATION`. */
  labelCopiesSource: LabelCopiesSource;
  /** D4-F3 (`label.customerCodeMissing`). */
  labelCustomerCodeMissing: LabelCustomerCodeMissing;
  /** D4-F2 (`label.customerCodeAt`). */
  labelCustomerCodeAt: LabelCustomerCodeAt;
  /** Faz-2 opt-in: native komutları yazıcıya doğrudan (RAW TCP 9100) gönder (default false). */
  nativeSendEnabled: boolean;
  /** Mobil (HC-06/BT) baskıda raster GW bitmap gönderilsin mi (default false → komut yolu).
   *  Electron raster'ından bağımsız; sahada yavaşsa kapatılır. Client (mobil) ENFORCE. */
  mobileRasterEnabled: boolean;
  /** "Etiketsiz" işaretli kalitelerde (QualityGrade.skipLabel — sahada FİRE) de
   *  OTOMATİK etiket basılsın mı. Default FALSE = fire topa kâğıt çıkmaz. Elle
   *  baskı ayrıdır (onayla basılır). Client (mobil) ENFORCE. */
  scrapGradeLabelEnabled: boolean;
  /** Cihazsız baskı/önizleme (Etiket Stüdyosu, kartela) için sistem varsayılan etiket
   *  medyası. Yazıcı cihazı seçiliyse onun medyası önceliklidir; bu yalnız fallback. */
  defaultLabelMedia: DefaultLabelMedia;
  /** Otomatik gece yedeğinin saati (0-23, yerel saat; default 3). Backend ENFORCE eder
   *  (jobs/backup-scheduler.ts her turda okur → değişiklik restart GEREKTİRMEZ).
   *  Kayıt yoksa `BACKUP_HOUR` env'ine, o da yoksa 3'e düşer. */
  backupHour: number;
  /** Patron bulutu: değişiklik olunca kısa tur (3 sn birleştirme, ≥15 sn aralık; default false).
   *  Backend ENFORCE eder (`jobs/cloud-sync.job.ts` `requestEventRound`). */
  patronBulutOlayGudumluEnabled: boolean;
  /** bildirim: kişisel gelen kutusu + yeni zil (default false = bugünkü zil davranışı).
   *  Okuyucular N1-MOTOR/N1-ZIL'de; bu alan yalnız taşır. */
  bildirimGelenKutusuEnabled: boolean;
  /** Belge tasarımcısı (default false = bugünkü Sistem tasarımı; tasarım uçları 403, basım şablon çözmez). */
  documentDesignerEnabled: boolean;
  /** Şablon yayınında tasarlayan ≠ yayınlayan (default false = bugünkü davranış). */
  documentPublishSodEnabled: boolean;
  /** Lisans modül tavanı — SALT OKUNUR (PATCH şemasında yok), önbelleğe girmez. Modül
   *  şalterleri HAM değerdir; lisansın kapattığı modül yalnız burada görünür (gözlemde boş). */
  license: LicenseModuleBlock;
}

/** Önbelleğe giren kısım: lisans bloğu her okumada taze hesaplanır. */
export type CachedFeatureFlags = Omit<FeatureFlags, "license">;

export function withLicenseBlock(flags: CachedFeatureFlags): FeatureFlags {
  return { ...flags, license: licenseModuleBlock(MODULE_SETTING_KEYS) };
}

/** Modül şalteri (PATCH alanı) → DB anahtarı; lisans yazma tavanı bu eşlemeyle sorar. */
export const MODULE_SETTING_KEY_BY_FLAG: Readonly<Record<string, string>> = {
  productionEnabled: SETTING_KEYS.PRODUCTION_ENABLED,
  financeEnabled: SETTING_KEYS.FINANCE_ENABLED,
  ticaretEnabled: SETTING_KEYS.TICARET_ENABLED,
  iplikEnabled: SETTING_KEYS.IPLIK_ENABLED,
  depoMultiEnabled: SETTING_KEYS.DEPO_MULTI_ENABLED,
  kumasTeknikEnabled: SETTING_KEYS.KUMAS_TEKNIK_ENABLED,
  tezgahEnabled: SETTING_KEYS.TEZGAH_ENABLED,
  devereEnabled: SETTING_KEYS.DEVERE_ENABLED,
  dokumaEnabled: SETTING_KEYS.DOKUMA_ENABLED,
  emanetEnabled: SETTING_KEYS.EMANET_ENABLED,
  kaliteGuvenceEnabled: SETTING_KEYS.KALITE_GUVENCE_ENABLED,
  maliyetEnabled: SETTING_KEYS.MALIYET_ENABLED,
  gelenBelgeEnabled: SETTING_KEYS.GELEN_BELGE_ENABLED,
};
