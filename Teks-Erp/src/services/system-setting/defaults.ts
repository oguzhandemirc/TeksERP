// =============================================================================
// TeksERP - System Setting / defaults
// =============================================================================
// Ayar varsayılanları, sınırları ve kapalı küme tipleri.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import { type FinishingKgBasis } from "../helpers/fabric-cost-kg.helper";


export const DEFAULT_DEADLINE_DAYS = 7;

/** Oturum (JWT) ömrü varsayılanı — saat. Eski sabit "8h" davranışıyla aynı. */
export const DEFAULT_SESSION_DURATION_HOURS = 8;
/** Mutlak oturum ömrü tavanı — saat (30 gün). Üstü bu değere kırpılır. */
export const MAX_SESSION_DURATION_HOURS = 720;
/** Oturum (JWT) ömrü varsayılanı — DAKİKA (8 saat). Dakika-granüler yeni ayarın default'u. */
export const DEFAULT_SESSION_DURATION_MINUTES = 480;
/** Mutlak oturum ömrü tavanı — DAKİKA (30 gün = 43200). Üstü bu değere kırpılır. */
export const MAX_SESSION_DURATION_MINUTES = 43200;
/** Hareketsizlik zaman aşımı varsayılanı — dakika. 0 = kapalı (otomatik çıkış yok). */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 0;
/** Hareketsizlik zaman aşımı tavanı — dakika (24 saat). */
export const MAX_IDLE_TIMEOUT_MINUTES = 1440;
/** Çalışma oturumu (WorkSession) idle varsayılanı — dakika. 0 = kapalı. Eski 600
 *  (10 saat) idi; saha kararı (2026-07-04): bir tablet bu kadar dakika hiç
 *  kullanılmazsa oturum kapanır ve makine boşa düşer → 20 dk daha uygun. */
export const DEFAULT_WORK_SESSION_IDLE_MINUTES = 20;
/** Çalışma oturumu idle tavanı — dakika (24 saat). */
export const MAX_WORK_SESSION_IDLE_MINUTES = 1440;
/** Aynı-tip oturum politikası — 2. aynı-tip girişte davranış. */
export type SameTypeSessionPolicy = "kick" | "notify" | "off";
export const SAME_TYPE_SESSION_POLICIES: SameTypeSessionPolicy[] = ["kick", "notify", "off"];
/** Aynı-tip oturum politikası varsayılanı — eskiyi düşür, yeni kazanır. */
export const DEFAULT_SAME_TYPE_SESSION_POLICY: SameTypeSessionPolicy = "kick";

// ---------------------------------------------------------------------------
// SEVKİYAT ENUM BAYRAKLARI (2026-09-03, Dilim 2)
// ---------------------------------------------------------------------------
// KALIP `SameTypeSessionPolicy` emsalinin BİREBİR ikizidir: tip + değer dizisi +
// DEFAULT sabiti. Dizinin tek işi "panelden gelen metin geçerli mi" değildir —
// OKUYUCU da onu kullanır (`includes` başarısızsa DEFAULT döner), yani DB'ye
// elle yazılmış çöp bir değer davranışı değiştiremez. Bu KOD SİGORTASI, "yeni
// bayrağın varsayılanı BUGÜNKÜ davranıştır" vaadinin tek mekanik garantisidir.
//
// ⚠️ Yeni enum bayrağı eklerken `scripts/test_feature_flag_contract.ts` §16
// (aEnum ayağı) kendiliğinden kapsar: dört kapı + panel + varsayılan + çöp-değer
// sondası. Muaf yazmak GEREKMEZ, panele satır eklemek GEREKİR.

/** Sevkiyat ↔ sipariş bağı zorunluluğu. `warn` = bugünkü davranış. */
export type ShipmentOrderRequirement = "off" | "warn" | "block";
export const SHIPMENT_ORDER_REQUIREMENTS: ShipmentOrderRequirement[] = ["off", "warn", "block"];
/** Varsayılan `warn` — BUGÜNKÜ davranış (siparişsiz sevk kurulur, uyarı döner). */
export const DEFAULT_SHIPMENT_ORDER_REQUIREMENT: ShipmentOrderRequirement = "warn";

/** Vardiyasız zamanda tezgah alarmı. `WARN` = bugünkü davranış (motor vardiya dışında doğurmaz, yüzey uyarır). */
export type TezgahAlarmNoShiftMode = "WARN" | "ALWAYS" | "REQUIRE_SHIFT";
export const TEZGAH_ALARM_NO_SHIFT_MODES: TezgahAlarmNoShiftMode[] = ["WARN", "ALWAYS", "REQUIRE_SHIFT"];
/** Varsayılan `WARN` — BUGÜNKÜ davranış (alarm açılabilir, vardiya dışında açılan duruş alarm üretmez). */
export const DEFAULT_TEZGAH_ALARM_NO_SHIFT_MODE: TezgahAlarmNoShiftMode = "WARN";

/**
 * Dokuma: top nerede doğar (S1, D1/D18). `TABLET_DOFF` = bugünkü yol (tablet İNDİR → KK1 "hangi indirmeden?");
 * `KK1_LABEL_OR_ORDER` = KK1 tezgah etiketi okutur YA DA iş emri seçer, indirmeyi sunucu üretir;
 * `KK1_LABEL_ONLY` = yalnız etiket (iş emri yolu kapalı). KK1_* iken eski tabletin `doffEventId` yolu da kabul (geçiş).
 */
export type DokumaRollBirth = "TABLET_DOFF" | "KK1_LABEL_OR_ORDER" | "KK1_LABEL_ONLY";
export const DOKUMA_ROLL_BIRTH_MODES: DokumaRollBirth[] = ["TABLET_DOFF", "KK1_LABEL_OR_ORDER", "KK1_LABEL_ONLY"];
/** Varsayılan `TABLET_DOFF` — BUGÜNKÜ davranış (KK1 gövdesinde yeni alan reddedilir, tablet İNDİR yolu aynen). */
export const DEFAULT_DOKUMA_ROLL_BIRTH: DokumaRollBirth = "TABLET_DOFF";

/** H1: kurşun metre ölçümü — `OFF` bugünkü davranış (okuma yazılmaz, `meterOut` yok sayılır); `OUT` çıkış; `IN_OUT` giriş + çıkış. */
export type KursunMeterCapture = "OFF" | "OUT" | "IN_OUT";
export const KURSUN_METER_CAPTURE_MODES: KursunMeterCapture[] = ["OFF", "OUT", "IN_OUT"];
export const DEFAULT_KURSUN_METER_CAPTURE: KursunMeterCapture = "OFF";

/** H2: sapma tabanı ve onay kipi — Prisma `MeterVarianceBasis` / `MeterApprovalMode` ile birebir. */
export type KursunMeterVarianceBasis = "DECLARED_IN" | "MEASURED_IN";
export const KURSUN_METER_VARIANCE_BASES: KursunMeterVarianceBasis[] = ["DECLARED_IN", "MEASURED_IN"];
export const DEFAULT_KURSUN_METER_VARIANCE_BASIS: KursunMeterVarianceBasis = "DECLARED_IN";
export type KursunMeterVarianceApproval = "NONE" | "OPERATOR_REASON" | "SUPERVISOR_PIN" | "OFFICE";
export const KURSUN_METER_VARIANCE_APPROVALS: KursunMeterVarianceApproval[] = ["NONE", "OPERATOR_REASON", "SUPERVISOR_PIN", "OFFICE"];
export const DEFAULT_KURSUN_METER_VARIANCE_APPROVAL: KursunMeterVarianceApproval = "NONE";
/** H1b: çıkış metresi stok kipi — Prisma `MeterStockMode` ile birebir; `RECORD` = bugünkü davranış. */
export type KursunMeterStockMode = "RECORD" | "APPLY";
export const KURSUN_METER_STOCK_MODES: KursunMeterStockMode[] = ["RECORD", "APPLY"];
export const DEFAULT_KURSUN_METER_STOCK_MODE: KursunMeterStockMode = "RECORD";
/** K16: atanan kurşun makinesi bağlayıcılığı; `SUGGEST` = bugünkü davranış (planlı makine yalnız öneri, K5). */
export type KursunMachineAssignMode = "SUGGEST" | "ASSIGNED_ONLY_WARN";
export const KURSUN_MACHINE_ASSIGN_MODES: KursunMachineAssignMode[] = ["SUGGEST", "ASSIGNED_ONLY_WARN"];
export const DEFAULT_KURSUN_MACHINE_ASSIGN_MODE: KursunMachineAssignMode = "SUGGEST";
/** K29: rota uygulaması; `SEQUENTIAL` = bugünkü davranış (rota zorunlu sıra). */
export type ProductionRouteMode = "SEQUENTIAL" | "SCAN";
export const PRODUCTION_ROUTE_MODES: ProductionRouteMode[] = ["SEQUENTIAL", "SCAN"];
export const DEFAULT_PRODUCTION_ROUTE_MODE: ProductionRouteMode = "SEQUENTIAL";
/** K29: okutmayla rota kapsamı; `SELECTED` = yalnız `Station.scanAddAllowed` istasyonlar (hiçbiri işaretli değilse hiçbiri). */
export type ProductionScanRouteStations = "SELECTED" | "ALL";
export const PRODUCTION_SCAN_ROUTE_STATIONS_VALUES: ProductionScanRouteStations[] = ["SELECTED", "ALL"];
export const DEFAULT_PRODUCTION_SCAN_ROUTE_STATIONS: ProductionScanRouteStations = "SELECTED";
/** OFFICE'in çıkış yüzeyi panel "Metre Sapmaları" ekranıdır (H4, 2026-10-29) — artık seçilebilir. */
export const KURSUN_METER_OFFICE_APPROVAL_SELECTABLE: boolean = true;

/** H7: hizmet faturası alt ayarları — enum üçlüsü (type + dizi + varsayılan); varsayılan = bugünkü davranış. */
/** MAX_DECLARED (GK metre, 2026-11-10): parti başına beyan ile en büyük ölçümün büyüğü (%0,5 tolerans) — `meter-compare.helper`. */
export type ServiceBillingMeterBasis = "OUT" | "IN" | "DECLARED" | "MAX_DECLARED";
export const SERVICE_BILLING_METER_BASES: ServiceBillingMeterBasis[] = ["OUT", "IN", "DECLARED", "MAX_DECLARED"];
export const DEFAULT_SERVICE_BILLING_METER_BASIS: ServiceBillingMeterBasis = "OUT";
export type ServiceBillingMissingMeter = "DECLARED_WITH_WARNING" | "BLOCK_LINE";
export const SERVICE_BILLING_MISSING_METER_MODES: ServiceBillingMissingMeter[] = ["DECLARED_WITH_WARNING", "BLOCK_LINE"];
export const DEFAULT_SERVICE_BILLING_MISSING_METER: ServiceBillingMissingMeter = "DECLARED_WITH_WARNING";
export type ServiceBillingBrodeUnit = "METER" | "PIECE" | "STITCH";
export const SERVICE_BILLING_BRODE_UNITS: ServiceBillingBrodeUnit[] = ["METER", "PIECE", "STITCH"];
export const DEFAULT_SERVICE_BILLING_BRODE_UNIT: ServiceBillingBrodeUnit = "METER";
export type ServiceBillingTrigger = "PER_SHIPMENT" | "PERIOD_END";
export const SERVICE_BILLING_TRIGGERS: ServiceBillingTrigger[] = ["PER_SHIPMENT", "PERIOD_END"];
export const DEFAULT_SERVICE_BILLING_TRIGGER: ServiceBillingTrigger = "PER_SHIPMENT";
export type ServiceBillingPriceDate = "SERVICE_DAY" | "DISPATCH_DAY";
export const SERVICE_BILLING_PRICE_DATES: ServiceBillingPriceDate[] = ["SERVICE_DAY", "DISPATCH_DAY"];
export const DEFAULT_SERVICE_BILLING_PRICE_DATE: ServiceBillingPriceDate = "SERVICE_DAY";
/** K14: gram fiyatı hangi andan — varsayılan SERVICE_DATE KULLANICI KARARIDIR (gram fiyatı yayınlanmış sürümde yok, sahada davranış değişmez). */
export type KursunGramPriceBasis = "SERVICE_DATE" | "INVOICE_DATE";
export const KURSUN_GRAM_PRICE_BASES: KursunGramPriceBasis[] = ["SERVICE_DATE", "INVOICE_DATE"];
export const DEFAULT_KURSUN_GRAM_PRICE_BASIS: KursunGramPriceBasis = "SERVICE_DATE";
/** D4-H1: masraf kategorisi önerisi (yalnız öneri listesi; kategori serbest metin kalır). */
export type ExpenseCategorySuggestions = "ON" | "OFF";
export const EXPENSE_CATEGORY_SUGGESTION_MODES: ExpenseCategorySuggestions[] = ["ON", "OFF"];
export const DEFAULT_EXPENSE_CATEGORY_SUGGESTIONS: ExpenseCategorySuggestions = "ON";
/** D4-H3: kasa masraf formunda "Bağla" alanı — kapalı (bugünkü form) · isteğe bağlı · zorunlu. */
export type ExpenseAllocationField = "OFF" | "OPTIONAL" | "REQUIRED";
export const EXPENSE_ALLOCATION_FIELD_MODES: ExpenseAllocationField[] = ["OFF", "OPTIONAL", "REQUIRED"];
export const DEFAULT_EXPENSE_ALLOCATION_FIELD: ExpenseAllocationField = "OFF";
/** D4-H3: kapanmış iş emrine masraf bağı — serbest (bugün kural yok) · engelli. */
export type ExpenseAllocationClosedWorkOrder = "ALLOW" | "DENY";
export const EXPENSE_ALLOCATION_CLOSED_WORK_ORDER_MODES: ExpenseAllocationClosedWorkOrder[] = ["ALLOW", "DENY"];
export const DEFAULT_EXPENSE_ALLOCATION_CLOSED_WORK_ORDER: ExpenseAllocationClosedWorkOrder = "ALLOW";
/** D4-I1a: kilit kapsamı ön seçimi — {INTAKE, SHIPMENT, INVOICE}in boş olmayan alt kümesi, sabit sırayla virgüllü. */
export const CARI_HOLD_DEFAULT_SCOPES = [
  "INTAKE,SHIPMENT",
  "INTAKE",
  "SHIPMENT",
  "INVOICE",
  "INTAKE,INVOICE",
  "SHIPMENT,INVOICE",
  "INTAKE,SHIPMENT,INVOICE",
] as const;
export type CariHoldDefaultScope = (typeof CARI_HOLD_DEFAULT_SCOPES)[number];
export const DEFAULT_CARI_HOLD_SCOPE: CariHoldDefaultScope = "INTAKE,SHIPMENT";
export type CariHoldReleaseBySamePerson = "ALLOW" | "DENY";
export const CARI_HOLD_RELEASE_BY_SAME_PERSON_MODES: CariHoldReleaseBySamePerson[] = ["ALLOW", "DENY"];
export const DEFAULT_CARI_HOLD_RELEASE_BY_SAME_PERSON: CariHoldReleaseBySamePerson = "ALLOW";
/** D4-I1c (S11): kilitli caride emanet sevki — hapis hakkı seçimi fabrikanındır (hukuki teyit önerilir). */
export const CARI_HOLD_EMANET_SHIPMENT_MODES = ["EXEMPT", "PROCESSED_HELD", "ALL_HELD"] as const;
export type CariHoldEmanetShipment = (typeof CARI_HOLD_EMANET_SHIPMENT_MODES)[number];
export const DEFAULT_CARI_HOLD_EMANET_SHIPMENT: CariHoldEmanetShipment = "EXEMPT";
export type CostPresentationCurrency = "TRY" | "USD" | "EUR";
export const COST_PRESENTATION_CURRENCIES: CostPresentationCurrency[] = ["TRY", "USD", "EUR"];
export const DEFAULT_COST_PRESENTATION_CURRENCY: CostPresentationCurrency = "TRY";
/** SY-E1: yalnız KG tabanlı tarifede okunur; metre tabanlı tarifeler (bugünkü) etkilenmez. */
export const DEFAULT_COST_FINISHING_KG_BASIS: FinishingKgBasis = "NET_HAM";
/** D4-I2b (S12): risk limiti para birimi kipi — her para birimi ayrı (bugünkü) · o güne kadarki en son kurla TL'ye çevrilmiş toplam. */
export type RiskLimitCurrencyMode = "PER_CURRENCY" | "TRY_CONVERTED";
export const RISK_LIMIT_CURRENCY_MODES: RiskLimitCurrencyMode[] = ["PER_CURRENCY", "TRY_CONVERTED"];
export const DEFAULT_RISK_LIMIT_CURRENCY_MODE: RiskLimitCurrencyMode = "PER_CURRENCY";
/** D4-G2a: kârlılık dış fason kaynağı (rapor okuma anında uygular; sonuç saklanmaz). */
export const PROFIT_SUBCONTRACT_SOURCES = ["FATURA_ONCE", "YALNIZ_FATURA"] as const;
export type ProfitSubcontractSource = (typeof PROFIT_SUBCONTRACT_SOURCES)[number];
export const DEFAULT_PROFIT_SUBCONTRACT_SOURCE: ProfitSubcontractSource = "FATURA_ONCE";
/** D4-G2a: kârlılık sarf birim fiyatı kaynağı. */
export const PROFIT_CONSUMABLE_PRICE_SOURCES = ["ALIS_FIYATI", "SON_ALIS_FATURASI"] as const;
export type ProfitConsumablePriceSource = (typeof PROFIT_CONSUMABLE_PRICE_SOURCES)[number];
export const DEFAULT_PROFIT_CONSUMABLE_PRICE_SOURCE: ProfitConsumablePriceSource = "ALIS_FIYATI";
/** SY-D2: dokuma standart maliyet yöntemi (motor girdisi derlenirken okunur; sürüm girdisinde donar). */
export const WEAVING_STANDARD_METHODS = ["TEZGAH_SAATI", "ATKI_UCRETI"] as const;
export type WeavingStandardMethod = (typeof WEAVING_STANDARD_METHODS)[number];
export const DEFAULT_WEAVING_STANDARD_METHOD: WeavingStandardMethod = "TEZGAH_SAATI";
/** SY-M1: siparişten üretim önerisi kipi. */
export const ORDER_PRODUCTION_PROPOSAL_MODES = ["KAPALI", "ONIZLEME", "ONAYDA_TASLAK"] as const;
export type OrderProductionProposalMode = (typeof ORDER_PRODUCTION_PROPOSAL_MODES)[number];
export const DEFAULT_ORDER_PRODUCTION_PROPOSAL: OrderProductionProposalMode = "KAPALI";
/** D4-G2b: kârlılıkta makine süresinin kaynağı. */
export const PROFIT_MACHINE_TIME_MODES = ["OTURUM", "VARDIYA", "NORM"] as const;
export type ProfitMachineTimeMode = (typeof PROFIT_MACHINE_TIME_MODES)[number];
export const DEFAULT_PROFIT_MACHINE_TIME_MODE: ProfitMachineTimeMode = "OTURUM";
/** D4-G2b: genel gider havuzunun dağıtım anahtarı (`YOK` = dağıtılmaz; net = katkı). */
export const PROFIT_OVERHEAD_KEYS = ["YOK", "METRE", "GELIR", "MAKINE_SAATI"] as const;
export type ProfitOverheadKey = (typeof PROFIT_OVERHEAD_KEYS)[number];
export const DEFAULT_PROFIT_OVERHEAD_KEY: ProfitOverheadKey = "YOK";
/** D4-G2b: masraf kategorisi sınıfı; sınıflanmamış kategori `GENEL_GIDER` sayılır (tasarım §8.3 "bağlanmamış EXPENSE havuzu"). */
export const PROFIT_CATEGORY_CLASSES = ["ISCILIK", "GENEL_GIDER", "HARIC"] as const;
export type ProfitCategoryClass = (typeof PROFIT_CATEGORY_CLASSES)[number];
export type ProfitCategoryClassMap = Record<string, ProfitCategoryClass>;
/** Kategori sınıfı haritası sınırları — panel ve Zod aynı tavanı okur. */
export const PROFIT_CATEGORY_CLASS_MAX_ENTRIES = 200;
export const PROFIT_CATEGORY_CLASS_MAX_KEY = 100;

/** Tambur plan kapısı EN kolu (bkz. `SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK`). */
export type TamburPlanWidthCheck = "ENFORCE" | "OFF";
export const TAMBUR_PLAN_WIDTH_CHECKS: TamburPlanWidthCheck[] = ["ENFORCE", "OFF"];
/** Varsayılan `ENFORCE` — BUGÜNKÜ davranış (en kolu 2026-08-19'dan beri koşulsuz). */
export const DEFAULT_TAMBUR_PLAN_WIDTH_CHECK: TamburPlanWidthCheck = "ENFORCE";
/** Eşik üst sınırı (cm) — panel/Zod/okuyucu aynı sınırı kullanır. */
export const TAMBUR_PLAN_WIDTH_TOLERANCE_MAX_CM = 100;
/** Tambur finalize çocuk en kaynağı (bkz. `SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE`). */
export type TamburChildWidthSource = "WO_TARGET_FIRST" | "MEASURED_FIRST";
export const TAMBUR_CHILD_WIDTH_SOURCES: TamburChildWidthSource[] = ["WO_TARGET_FIRST", "MEASURED_FIRST"];
/** Varsayılan `WO_TARGET_FIRST` — BUGÜNKÜ davranış (`wo.width ?? roll.width`, ölçüldü 2026-10-31). */
export const DEFAULT_TAMBUR_CHILD_WIDTH_SOURCE: TamburChildWidthSource = "WO_TARGET_FIRST";
/** Tambur etiket basım zamanı (bkz. `SETTING_KEYS.TAMBUR_LABEL_PRINT_TIMING`). */
export type TamburLabelPrintTiming = "EACH" | "END";
export const TAMBUR_LABEL_PRINT_TIMINGS: TamburLabelPrintTiming[] = ["EACH", "END"];
/** Varsayılan `EACH` — BUGÜNKÜ davranış (tablet her kesimden sonra etiketi basar). */
export const DEFAULT_TAMBUR_LABEL_PRINT_TIMING: TamburLabelPrintTiming = "EACH";

/** Etiket adedi kaynağı (bkz. `SETTING_KEYS.LABEL_COPIES_SOURCE`). */
export type LabelCopiesSource = "GLOBAL" | "STATION";
export const LABEL_COPIES_SOURCES: LabelCopiesSource[] = ["GLOBAL", "STATION"];
/** Varsayılan `GLOBAL` — BUGÜNKÜ davranış (hiçbir istemci akış etiketine `copies` göndermiyor; ölçüldü 2026-10-24). */
export const DEFAULT_LABEL_COPIES_SOURCE: LabelCopiesSource = "GLOBAL";

/** D4-F3: müşteri barkodu basan şablonda kod yoksa. */
export type LabelCustomerCodeMissing = "BLOCK" | "ROLL_BARCODE";
export const LABEL_CUSTOMER_CODE_MISSING_MODES: LabelCustomerCodeMissing[] = ["BLOCK", "ROLL_BARCODE"];
/** Varsayılan `BLOCK` — bugün CUSTOMER_CODE kaynaklı şablon olmadığından etkisiz (bugünkü davranış değişmez). */
export const DEFAULT_LABEL_CUSTOMER_CODE_MISSING: LabelCustomerCodeMissing = "BLOCK";
/** D4-F2: müşteri kodu nerede doğar. */
export type LabelCustomerCodeAt = "NONE" | "TAMBUR_OUTPUT";
export const LABEL_CUSTOMER_CODE_AT_MODES: LabelCustomerCodeAt[] = ["NONE", "TAMBUR_OUTPUT"];
/** Varsayılan `NONE` — BUGÜNKÜ davranış (hiçbir yolda seriden kod doğmuyor; ölçüldü 2026-11-01). */
export const DEFAULT_LABEL_CUSTOMER_CODE_AT: LabelCustomerCodeAt = "NONE";
/** D4-B5k: sayaç kalibrasyon kontrolü — UYAR yalnız uyarır (ölçüm engellenmez, kaynak MACHINE kalır). */
export type TamburCalibrationCheck = "KAPALI" | "UYAR";
export const TAMBUR_CALIBRATION_CHECK_MODES: TamburCalibrationCheck[] = ["KAPALI", "UYAR"];
/** Varsayılan `KAPALI` — kalibrasyon tarihi hiçbir yanıtı değiştirmez (bugünkü davranış). */
export const DEFAULT_TAMBUR_CALIBRATION_CHECK: TamburCalibrationCheck = "KAPALI";

/** Web paneli girişi TOTP politikası. USER_CHOICE: kullanıcı kendi hesabında kapatabilir (süperadmin hariç). */
export type WebTotpPolicy = "REQUIRED" | "USER_CHOICE";
export const WEB_TOTP_POLICIES: WebTotpPolicy[] = ["REQUIRED", "USER_CHOICE"];
/** Varsayılan `REQUIRED` — BUGÜNKÜ davranış (K4: web girişinde TOTP herkese zorunlu). */
export const DEFAULT_WEB_TOTP_POLICY: WebTotpPolicy = "REQUIRED";
/** Güvenilir cihaz süresi (gün) — 0 = kapalı (BUGÜNKÜ davranış), tavan 90. */
export const DEFAULT_TRUSTED_DEVICE_DAYS = 0;
export const MAX_TRUSTED_DEVICE_DAYS = 90;

/** Sevkin fatura izi nereden yazılır. `dis` = bugünkü davranış. */
export type ShippingInvoiceMode = "dis" | "ic" | "ikisi";
export const SHIPPING_INVOICE_MODES: ShippingInvoiceMode[] = ["dis", "ic", "ikisi"];
/** Varsayılan `dis` — BUGÜNKÜ davranış (elle fatura işareti serbest). */
export const DEFAULT_SHIPPING_INVOICE_MODE: ShippingInvoiceMode = "dis";

/**
 * Sevk belgesinde ürün adı hangi dilden basılır (2026-09-04).
 *
 * `bizdeki`     = yalnız `Item.name` (+ renk + en) — BUGÜNKÜ davranış.
 * `musterideki` = yalnız müşterinin verdiği ad; karşılığı yoksa bizimki basılır
 *                 (fail-open: boş ürün adı taşıyan bir irsaliye hukuken sakat).
 * `ikisi`       = iki ayrı kolon (bizimki + müşterideki).
 *
 * ⚠️ SUNUM kararıdır, içerik değil: ad zaten donmuş snapshot'ta durur (sevk
 * anındaki hâliyle), bayrak yalnız HANGİSİNİN basılacağını söyler. Bu yüzden
 * bayrağı değiştirmek eski belgelerin İÇERİĞİNİ değiştirmez, yeni versiyon
 * doğurmaz — refakat kartının "içerik donuk, sunum canlı" kuralıyla aynı.
 */
export type ShippingDocItemNameMode = "bizdeki" | "musterideki" | "ikisi";
export const SHIPPING_DOC_ITEM_NAME_MODES: ShippingDocItemNameMode[] = [
  "bizdeki",
  "musterideki",
  "ikisi",
];
/** Varsayılan `bizdeki` — BUGÜNKÜ çıktı bayt-bayt korunur. */
export const DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE: ShippingDocItemNameMode = "bizdeki";

/**
 * Çeki listesi bölümünün ad rejimi. `devral` genel rejime (`shipping.docItemNameMode`)
 * uyar; diğer üç değer YALNIZ çeki bölümünü çevirir, ürün listesine dokunmaz.
 *
 * ⚠️ Bu bir İÇ belge kararıdır: çeki listesi ambar elemanının kontrol listesi olarak
 * da basılıyor (`DispatchPrintOptions` tek başına seçebiliyor), o yüzden "hem bizdeki
 * hem müşterideki" orada anlamlı, müşteriye giden ürün listesinde değil.
 */
export type ShippingDocCekiNameMode = "devral" | "bizdeki" | "musterideki" | "ikisi";
export const SHIPPING_DOC_CEKI_NAME_MODES: ShippingDocCekiNameMode[] = [
  "devral",
  "bizdeki",
  "musterideki",
  "ikisi",
];
/** Varsayılan `devral` — bayrak yazılana kadar TEK BAYT değişmez. */
export const DEFAULT_SHIPPING_DOC_CEKI_NAME_MODE: ShippingDocCekiNameMode = "devral";

/**
 * Sevkiyat içi çuval sırası ÖN EKİ (2026-09-22): SERBEST METİN, en çok 8 karakter
 * (harf · rakam · `- _ . /` · boşluk) — "SP" → "SP1", "P-" → "P-1", "Çuval " → "Çuval 1".
 * Boş = yalnız sayı (varsayılan). Belgede HTML kaçışından geçer. Eski belgelerin
 * etkilenip etkilenmediğini `shipping.sackSeqPrefixLive` belirler.
 */
export type ShippingSackSeqPrefix = string;
export const SHIPPING_SACK_SEQ_PREFIX_MAX = 8;
/**
 * OKUMA/TEMİZLİK yüklemi — GENİŞ ve öyle KALMALI.
 *
 * ⚠️ DARALTMAYIN: bu yüklem `sanitizeSackSeqPrefix` üzerinden OKUMA yolunda da
 * koşuyor ve sevk anında DONMUŞ ön eki de süzüyor (`sack-seq.helper`). Burayı
 * daraltmak, kayıtlı `SP/` gibi bir ön eki taşıyan ESKİ SEVKİYATLARIN belgesini
 * bugün boş gösterirdi — yani geçmişi geriye dönük değiştirirdi, ki bütün bu
 * işin yasakladığı şey tam olarak budur.
 */
export const SHIPPING_SACK_SEQ_PREFIX_RE = /^[\p{L}\p{N}\-_./ ]{0,8}$/u;

/**
 * YAZMA yüklemi — DAR. Dosya/sayfa adını kıran karakterleri dışarıda bırakır.
 *
 * ⚠️ ÖLÇÜLDÜ 2026-09-22: yasaklanması gereken küme `/ \ : * ? [ ]` idi, ama
 * bunlardan YALNIZ `/` zaten kabul ediliyordu — kalan altısı geniş yüklemde de
 * yoktu. Yani gerçek maruziyet TEK karakter.
 * Mekanizma: `pdf.ipc.safeFileName` `[^\p{L}\p{N}\-_. ]` dışındaki her şeyi
 * `_` yapar ve `dumpSheets.sheetBase` `: \ / ? * [ ]`i boşluğa çevirir ⇒ `A/B`
 * ile `A B` AYNI dosya/sayfa adına düşer ve iki sevkiyat üst üste yazılabilir.
 *
 * ⚠️ Türkçe harf KALIR: ön ek etiket metnidir, OKUTULMAZ — barkod uzayının
 * ASCII kuralı buraya uzanmaz.
 */
export const SHIPPING_SACK_SEQ_PREFIX_WRITE_RE = /^[\p{L}\p{N}\-_. ]{0,8}$/u;
export const DEFAULT_SHIPPING_SACK_SEQ_PREFIX: ShippingSackSeqPrefix = "";
/** Ön ek temizliği — geçersiz/boşluk-only değer boş sayılır (fail-safe: sayı yine basılır). */
export function sanitizeSackSeqPrefix(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.replace(/[\u0000-\u001f]/g, "");
  if (!t.trim() || !SHIPPING_SACK_SEQ_PREFIX_RE.test(t)) return "";
  return t;
}
/** Başlangıç numarası: 1 (varsayılan, sektör) — 0 da seçilebilir; üst sınır 999. */
export const DEFAULT_SHIPPING_SACK_SEQ_START = 1;
/** İade irsaliyesi dipnotu üst sınırı (karakter) — belge altına tek paragraf. */
export const SHIPPING_RETURN_FOOTNOTE_MAX = 300;
/** Dipnot temizliği: kontrol karakteri (satır sonu hariç) atılır, kenar boşluğu kırpılır; boş = basılmaz. */
export function sanitizeReturnFootnote(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, SHIPPING_RETURN_FOOTNOTE_MAX);
}
/** İletim payı (dk): 0 = hedef dolunca patrona (varsayılan); üst sınır bir gün. */
export const DEFAULT_TEZGAH_ESCALATION_GRACE_MINUTES = 0;
export const TEZGAH_ESCALATION_GRACE_MINUTES_MAX = 1440;
/** Sebepsiz duruş ortak hedefi: boş (null) = izlenmez; doluysa 1..1440 dk. */
export const TEZGAH_ALARM_UNCLASSIFIED_TARGET_MAX = 1440;
/** Alarm tekrar aralığı (dk): varsayılan 10, 1..120. */
export const DEFAULT_TEZGAH_ALARM_RENOTIFY_MINUTES = 10;
export const TEZGAH_ALARM_RENOTIFY_MINUTES_MAX = 120;
/** Kart duruşu watchdog eşiği (sa): varsayılan 12, 1..168. Yalnız kart duruşuna dokunur (insan duruşu hiç). */
export const DEFAULT_TEZGAH_MAX_OPEN_STOP_HOURS = 12;
export const TEZGAH_MAX_OPEN_STOP_HOURS_MAX = 168;
/** Kart sessizlik eşiği (dk): varsayılan 10, 1..1440. Yalnız onaylı karta bakar. */
export const DEFAULT_TEZGAH_COLLECTOR_SILENCE_MINUTES = 10;
export const TEZGAH_COLLECTOR_SILENCE_MINUTES_MAX = 1440;
export const SHIPPING_SACK_SEQ_START_MAX = 999;

/**
 * Partisiz (havuz) çuvalın AMBALAJ NUMARASI ne zaman doğar (2026-09-22):
 *  `sevkte`   (varsayılan = bugünkü): havuz çuvalı numarasız yaşar, sevkte sevkiyat sırasını alır.
 *  `acilista`: çuval açılırken CARİNİN havuz sayacından numara alır (`packageNo`, parti dışı;
 *              advisory 8035 hashtext(customerId)); sevkte de kalır. Müşterisiz çuval numara almaz.
 */
export type PackingPoolPackageNo = "sevkte" | "acilista";
export const PACKING_POOL_PACKAGE_NO_MODES: PackingPoolPackageNo[] = ["sevkte", "acilista"];
export const DEFAULT_PACKING_POOL_PACKAGE_NO: PackingPoolPackageNo = "sevkte";

/**
 * Paketleme grubu numara sayacının rejimi.
 *
 *  • `artan` (VARSAYILAN, 2026-09-10 kullanıcı kararı) — yeni grup CANLI grupların
 *    en büyük numarasının bir fazlasını alır. "P3 sevk edildi, P5 duruyor" ise yeni
 *    grup P6'dır; boşalan numaraya GERİ DÖNÜLMEZ. Böylece aynı cari için aynı gün
 *    iki farklı "P3" dolaşmaz.
 *  • `bosluk-doldur` — yeni grup EN KÜÇÜK boş numarayı alır (P1 ve P3 doluysa P2).
 *    Numaralar sıkı kalır, ama sevk edilen bir numara aynı gün yeniden doğabilir.
 *
 * ⚠️ İKİ REJİM DE canlı gruplara bakar: carinin havuzu tamamen boşaldığında canlı
 * grup kalmadığı için sayaç KENDİLİĞİNDEN 1'e döner. Yani `artan` rejiminde bile
 * numara sonsuza büyümez — yalnız havuz hiç boşalmadığı sürece ilerler.
 */
export type PackingGroupNumbering = "artan" | "bosluk-doldur";
export const PACKING_GROUP_NUMBERINGS: PackingGroupNumbering[] = [
  "artan",
  "bosluk-doldur",
];
/** Varsayılan `artan` — sahanın istediği rejim (boşalan numaraya geri dönme). */
export const DEFAULT_PACKING_GROUP_NUMBERING: PackingGroupNumbering = "artan";

/**
 * Paketleme grubunun DAVRANIŞ MODU (2026-09-21 saha isteği, `docs/design/SEVK-PARTISI-TASARIM.md`).
 *
 *  • `grup` (VARSAYILAN = bugünkü): grup bir çalışma yaftasıdır — canlılık çocuk
 *    satırdan türetilir, boşalan grup görünmez olur, numarası yeniden kullanılır,
 *    çuvala parti-içi numara verilmez.
 *  • `sevk-partisi`: grup açık/kapalı DURUM taşır, boş parti yaşar, parti sırası
 *    geri verilmez, her çuval parti içinde bir AMBALAJ NO alır; belgeye basılabilir.
 *
 * `packing.groupsEnabled` KAPALIYKEN bu ayarın anlamı yoktur — tek çözücü
 * `effectivePackingGroupMode` (§3.6), enforcement noktaları ham okuyucuyu çağırmaz.
 */
export type PackingGroupMode = "grup" | "sevk-partisi";
export const PACKING_GROUP_MODES: PackingGroupMode[] = ["grup", "sevk-partisi"];
export const DEFAULT_PACKING_GROUP_MODE: PackingGroupMode = "grup";

/**
 * Parti içi AMBALAJ NUMARASININ atanma modu (yalnız `sevk-partisi` modunda okunur).
 *  • `otomatik` — sayaç verir, kullanıcı değiştiremez.
 *  • `otomatik-ezilebilir` (VARSAYILAN) — sayaç verir, kullanıcı ezebilir (parti içinde tekil).
 *  • `elle` — numara kullanıcıdan gelir, boş bırakılamaz.
 */
export type PackageNoMode = "otomatik" | "otomatik-ezilebilir" | "elle";
export const PACKAGE_NO_MODES: PackageNoMode[] = ["otomatik", "otomatik-ezilebilir", "elle"];
export const DEFAULT_PACKAGE_NO_MODE: PackageNoMode = "otomatik-ezilebilir";

/**
 * Ambalaj no sayaç rejimi (yalnız `sevk-partisi` modunda okunur).
 *  • `artan` (VARSAYILAN) — sevk edilen/çıkarılan çuvalın numarası ASLA geri verilmez;
 *    sayaç `PackingGroup.nextPackageNo` tek satır UPDATE … RETURNING ile ilerler.
 *  • `bosluk-doldur` — açık çuvalların tutmadığı en küçük numara verilir; sevk edilmiş
 *    çuvalın numarası yeniden doğabilir (sahanın bilinçli tercihi).
 */
export type PackageNumbering = "artan" | "bosluk-doldur";
export const PACKAGE_NUMBERINGS: PackageNumbering[] = ["artan", "bosluk-doldur"];
export const DEFAULT_PACKAGE_NUMBERING: PackageNumbering = "artan";

/**
 * Çuval/grup İÇERİK DÖKÜMÜNDE (Excel + PDF) kumaş ve renk adı hangi dilden basılır.
 *
 *  • `ikisi` (VARSAYILAN = BUGÜNKÜ ÇIKTI) — PDF'te "bizdeki ↳ müşterideki" tek
 *    hücrede, Excel'de "Müşteri kumaş"/"Müşteri renk" ayrı sütunlarda.
 *  • `bizdeki` — yalnız bizim adımız.
 *  • `musterideki` — yalnız müşterinin adı. ⚠️ FAIL-OPEN DEĞİL: karşılık yoksa
 *    hücre BOŞ kalır, bizim adımız müşterinin adıymış gibi BASILMAZ. Bu, sevk
 *    irsaliyesindeki `docItemNameMode` ile BİLEREK ters yöndedir — orası
 *    müşteriye giden resmi belgedir ve boş hücre kabul edilemez; burası İÇ
 *    çalışma kâğıdıdır ve ambarcının "bunun müşteri karşılığı yok"u görmesi
 *    gerekir (kullanıcı kararı 2026-09-10).
 *
 * ⚠️ Bu ayar VARSAYILANI belirler; döküm penceresi TEK SEFERLİK başka bir mod
 * seçebilir ve o seçim ayarı EZMEZ (kâğıt boyu seçicisiyle aynı kalıp).
 */
export type SackDumpNameMode = "ikisi" | "bizdeki" | "musterideki";
export const SACK_DUMP_NAME_MODES: SackDumpNameMode[] = ["ikisi", "bizdeki", "musterideki"];
/** Varsayılan `ikisi` — bayrak yazılana kadar döküm BAYT BAYT bugünküyle aynı. */
export const DEFAULT_SACK_DUMP_NAME_MODE: SackDumpNameMode = "ikisi";

/**
 * Sevkiyat KAPSAMA rejimi: çuvaldaki mal seçili sipariş satırlarına yazılabildi mi.
 * `shipping.orderRequirement` ile DİK bir eksendir — gerekçe ve ölçüm
 * `helpers/shipment-coverage.helper.ts` başlığında.
 */
export type ShippingOrderCoverage = "off" | "warn" | "block";
export const SHIPPING_ORDER_COVERAGES: ShippingOrderCoverage[] = ["off", "warn", "block"];
/** Varsayılan `off` — BUGÜNKÜ davranış; bayrak açılmadıkça hiçbir yeni kapı doğmaz. */
export const DEFAULT_SHIPPING_ORDER_COVERAGE: ShippingOrderCoverage = "off";

/**
 * Ürün listesinde müşteri RENGİ ayrı sütuna çıksın mı. Varsayılan FALSE = bugünkü
 * birleşik dize (`müşteri kumaş adı + renk + en` tek hücrede).
 *
 * ⚠️ NEDEN BAYRAK: bugünkü birleşik dizede, müşterinin renk karşılığı YOKSA bizim
 * renk adımız müşteri kumaş adının yanına yapışıyor — ölçüldü: sevk edilen 1.778
 * topun 690'ında (%39) tam bu hâl. `docs/kurallar/belge-etiket.md` "yarı çevrilmiş
 * ad basılmasın" diyor, yani bugünkü çıktı kendi kuralımızın ihlali. Ama düzeltme
 * MÜŞTERİYE GİDEN belgenin düzenini değiştirir; kullanıcı kararı (2026-09-06):
 * "bayrakla yap, varsayılan bugünkü olsun."
 */
export const DEFAULT_SHIPPING_DOC_PRODUCT_COLOR_SPLIT = false;

/**
 * TAHSİSTE EN TOLERANSI. Varsayılan KAPALI = tam eşitlik, yani bugünkü davranış.
 *
 * ⚠️ YALNIZ ENE uygulanır — kumaş ve renk KESİN eşleşir ve bu pazarlık dışıdır
 * (kullanıcı beyanı 2026-09-06: "desen-renk kesin eşleşmeli, en değeri bazen
 * değişiklik gösterebilir"). Yanlış rengi bir siparişe yazmak defteri sessizce
 * bozar; yanlış eni yazmak sahada zaten kabul edilen bir sapmadır.
 *
 * ÖLÇÜM (fabrika yedeği 2026-09-05, `scripts/tahsis_teshis.ts`): en yüzünden
 * yazılamayan 950 m / 25 top; gözlenen iki fark 0,1 cm ve 5 cm.
 */
export const DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED = false;
export const DEFAULT_SHIPPING_ALLOC_WIDTH_TOLERANCE_CM = 1;
export const SHIPPING_ALLOC_WIDTH_TOLERANCE_MAX_CM = 10;

/** Sevke hazırlık kuralı (bkz. `SETTING_KEYS.SHIPPING_READY_RULE`). */
export type ShipReadyRule = "ALL_DONE" | "METER_THRESHOLD";
export const SHIP_READY_RULES: ShipReadyRule[] = ["ALL_DONE", "METER_THRESHOLD"];
/** Varsayılan ALL_DONE — en temkinli kural (K26); ayar yazılmamış kurulum ekranı ilk kez bununla görür. */
export const DEFAULT_SHIP_READY_RULE: ShipReadyRule = "ALL_DONE";
/** METER_THRESHOLD toleransı (%): hedef × (1 − tol/100). Yalnız METER_THRESHOLD'da okunur. */
export const DEFAULT_SHIP_READY_TOLERANCE_PCT = 2;
export const SHIP_READY_TOLERANCE_MAX_PCT = 20;
/** Bildirim birimleri (D4-J2): iş emri · gelen belge · müşteri partisi. Boş = bildirim kapalı. */
export type ShipReadyNotifyUnit = "IE" | "GB" | "PARTI";
export const SHIP_READY_NOTIFY_UNITS: ShipReadyNotifyUnit[] = ["IE", "GB", "PARTI"];
export const DEFAULT_SHIP_READY_SCAN_MINUTES = 5;
export const SHIP_READY_SCAN_MINUTES_MIN = 1;
export const SHIP_READY_SCAN_MINUTES_MAX = 60;

/**
 * FAZLA SEVKİN DEFTERE YAZILMASI. Varsayılan KAPALI = bugünkü davranış: tahsis
 * sipariş kalemini AŞAMAZ, aşan metraj hiçbir satıra yazılmaz.
 *
 * ⚠️ NEDEN AYAR: ölçüm (fabrika yedeği 2026-09-05) 15.723 m / 398 topun "eşleşen
 * kalem var ama kapasite dolu" sınıfında olduğunu gösterdi — yani mal çıkmış ama
 * sipariş zaten dolduğu için deftere girmemiş. Kullanıcı kararı (2026-09-06):
 * "deftere yazılabilmeli, fazla olarak görünsün."
 *
 * ⚠️ AÇIKKEN `OrderLine.shippedQty` ısmarlanan miktarı GEÇEBİLİR. Bu bilinçlidir:
 * "Açık = ısmarlanan − sevk" hesabı negatife düşer ve arayüzler onu 0'a kelepçeler
 * (bugün de öyle). Fazlalığın kendisi `shippedQty > quantity` karşılaştırmasıyla
 * her yerden ölçülebilir — sessiz kalan bir sayı DEĞİL.
 */
export const DEFAULT_SHIPPING_ALLOW_OVER_ALLOCATION = false;
/** Token süresi dolunca otomatik çıkış varsayılanı — açık. */
export const DEFAULT_AUTO_LOGOUT_ON_EXPIRY = true;
/** Mobil idle ekran kilidi varsayılanı — açık. */
export const DEFAULT_MOBILE_IDLE_LOCK_ENABLED = true;
/** Mobil idle kilit süresi varsayılanı + aralık — dakika. */
export const DEFAULT_MOBILE_IDLE_LOCK_MINUTES = 10;
export const MIN_MOBILE_IDLE_LOCK_MINUTES = 1;
export const MAX_MOBILE_IDLE_LOCK_MINUTES = 120;
/** Mobil arka-plan kilidi varsayılanı — açık (eski davranış: idle kilit açıkken
 *  arka plana geçince de kilitlenirdi; artık bağımsız bayrak, default korunur). */
export const DEFAULT_MOBILE_LOCK_ON_BACKGROUND = true;
/** Çevrimdışıyken tablet kilidi ertelensin mi — varsayılan KAPALI (bugünkü davranış: kesintide de kilitlenir). */
export const DEFAULT_MOBILE_OFFLINE_LOCK_DEFER = false;
/** Giriş ekranı son kullanıcıyı hatırlasın mı — varsayılan KAPALI (bugünkü davranış: boş form). */
export const DEFAULT_REMEMBER_LAST_USER = false;
/** Mutlak oturum tavanı (gün) varsayılanı + aralık. 0 = sert tavan (UNSET_…) — exp'siz token yok. */
export const DEFAULT_ABSOLUTE_SESSION_CAP_DAYS = 30;
export const MAX_ABSOLUTE_SESSION_CAP_DAYS = 365;
/** Tavan 0 ("sınır koyma") kapatılamaz sert tavana düşer (Y1): 365 günlük token fiilen süresizdi.
 *  30 = varsayılan tavan = dakika ayarının üst sınırı (43200) — sahada kanıtlı en uzun ömür. */
export const UNSET_ABSOLUTE_SESSION_CAP_DAYS = 30;
/** Okunan tavanı gün olarak ETKİN tavana çevirir — issueToken'ın TEK kaynağı. */
export function effectiveAbsoluteSessionCapDays(capDays: number): number {
  return capDays > 0 ? capDays : UNSET_ABSOLUTE_SESSION_CAP_DAYS;
}
/** Hızlı-PIN/kart deneme kilidi varsayılanları + aralıkları. */
export const DEFAULT_PIN_LOCKOUT_ENABLED = true;
/** Kilidi kapatma isteğinin reddi (O-04) — eski panelin anahtarı da bu iletiyi görür. */
export const PIN_LOCKOUT_REQUIRED_MESSAGE =
  "Giriş deneme kilidi kapatılamaz; yalnız deneme eşiği ve ceza süreleri ayarlanabilir.";
/** Fatura satırı varsayılan KDV oranı (%). 20 = bugünkü hardcode'un birebir
 *  karşılığı — ayar satırı yoksa davranış bayt-bayt aynı kalır. Tam sayı
 *  DAYATILMAZ (kolon Decimal(5,2); küsuratlı oran temsil edilebilir). */
export const DEFAULT_FINANCE_VAT_RATE = 20;
export const MIN_FINANCE_VAT_RATE = 0;
export const MAX_FINANCE_VAT_RATE = 100;
/** Otomatik gece yedeği saati varsayılanı (yerel saat). Eski Görev Zamanlayıcı da 03:00'tü. */
export const DEFAULT_BACKUP_HOUR = 3;
export const MIN_BACKUP_HOUR = 0;
export const MAX_BACKUP_HOUR = 23;

export const DEFAULT_PIN_LOCKOUT_ATTEMPTS = 5;
export const MIN_PIN_LOCKOUT_ATTEMPTS = 1;
export const MAX_PIN_LOCKOUT_ATTEMPTS = 20;
export const DEFAULT_PIN_LOCKOUT_PENALTY_SEC = 60;
export const MIN_PIN_LOCKOUT_PENALTY_SEC = 5;
export const MAX_PIN_LOCKOUT_PENALTY_SEC = 3600;
export const DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER = 3;
export const MIN_PIN_LOCKOUT_ESCALATE_AFTER = 1;
export const MAX_PIN_LOCKOUT_ESCALATE_AFTER = 20;
export const DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN = 15;
export const MIN_PIN_LOCKOUT_LONG_PENALTY_MIN = 1;
export const MAX_PIN_LOCKOUT_LONG_PENALTY_MIN = 1440;
/** Mobil giriş yöntemleri. list=liste+şifre, pin=salt hızlı-PIN, card=QR kart. */
export type LoginMethod = "list" | "pin" | "card";
export interface LoginMethodsConfig {
  enabled: LoginMethod[];
  primary: LoginMethod;
}
export const LOGIN_METHODS: LoginMethod[] = ["list", "pin", "card"];
export const DEFAULT_LOGIN_METHODS: LoginMethodsConfig = { enabled: ["list"], primary: "list" };
