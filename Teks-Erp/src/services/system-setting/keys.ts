// =============================================================================
// TeksERP - System Setting / keys
// =============================================================================
// Ayar anahtarları (SETTING_KEYS) — DB anahtarlarının tek kaynağı.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================




export const SETTING_KEYS = {
  SHIPPING_TOLERANCE_METERS: "shipping.toleranceMeters",
  /** Pricing/currency UI'da gösterilsin mi (sipariş ve ileride sevkiyat). */
  FINANCE_PRICING_ENABLED: "finance.pricingEnabled",
  // Ön muhasebe modülünün ANA şalteri (2026-08-13). ⚠️ `pricingEnabled` ile
  // KARIŞTIRMA: o, OPERASYON ekranlarındaki fiyat alanlarını açar; bu, ayrı bir
  // MUHASEBE modülünü (cari/fatura/tahsilat) açar. İki kapı bağımsızdır —
  // fiyatı sipariş ekranında gösteren fabrikanın cari defteri tutması gerekmez.
  FINANCE_ENABLED: "finance.enabled",
  /** Kasa (fiziksel nakit) eksi bakiyeye DÜŞEMESİN (default FALSE). Backend
   *  ENFORCE eder — 4 İLERİ yolda 409 (ödeme OUT · masraf fişi · virmanın çıkan
   *  kasa bacağı · çek ödeme); BANKA MUAF (kredili mevduat meşru), İPTAL/STORNO
   *  yolları MUAF (yanlış tahsilat "kasa yetmez" diye iptal edilemez kalmasın).
   *  Tek yüklem: `helpers/cash-balance-guard.helper.assertCashBalanceCoversTx`. */
  FINANCE_BLOCK_NEGATIVE_CASH_ENABLED: "finance.blockNegativeCashEnabled",
  /** Fatura satırının VARSAYILAN KDV oranı, % (0-100; default 20). Logo/Mikro
   *  "firma parametresi" karşılığı. İKİ tüketici: Electron fatura formunun yeni
   *  satırı ve mal kabulden üretilen alış taslağı (`invoice.service`) — ikisi
   *  de buradan okur, oran iki yerde ayrı sürüklenmez. Yalnız ÖN-DOLUM:
   *  kullanıcı satırda her zaman değiştirebilir, backend satır bazında geleni
   *  kabul etmeye devam eder. */
  FINANCE_DEFAULT_VAT_RATE: "finance.defaultVatRate",
  /** D4-V1k (B-1): SATIŞ faturası taslağının genel tevkifatı — açık/kapalı + pay/payda (ör. 5/10). Varsayılan
   *  KAPALI = bugünkü davranış (tevkifat 0). Müşteri cari hesabında geçersiz kılınır; çözüm TEK yerde:
   *  `helpers/invoice-tax-defaults.helper.resolveInvoiceTaxDefaults`. Oran SABİT KODLANMAZ (mali müşavir teyidi). */
  FINANCE_WITHHOLDING_ENABLED: "finance.withholding.enabled",
  FINANCE_WITHHOLDING_NUMERATOR: "finance.withholding.numerator",
  FINANCE_WITHHOLDING_DENOMINATOR: "finance.withholding.denominator",
  /** F7 (fason planı FK4, 2026-11-08): ALIŞ faturası taslağının genel tevkifatı — yalnız FASON rolündeki
   *  tedarikçiye (biz fasona verdik, fasoncu bize keser). Varsayılan KAPALI = bugünkü (alışta tevkifat 0).
   *  Fason firma cari hesabında `purchaseWithholding*` ile geçersiz kılınır; çözüm aynı tek yerde
   *  (`resolveInvoiceTaxDefaults`). Oran SABİT KODLANMAZ (mali müşavir girer). */
  FINANCE_PURCHASE_WITHHOLDING_ENABLED: "finance.withholding.purchase.enabled",
  FINANCE_PURCHASE_WITHHOLDING_NUMERATOR: "finance.withholding.purchase.numerator",
  FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR: "finance.withholding.purchase.denominator",
  /** n irsaliye → 1 fatura (2026-09-18): fatura ↔ bağlı fişler tolerans kontrolü (ONAY anı). Varsayılan KAPALI = kontrol yok. */
  FINANCE_INVOICE_MATCH_TOLERANCE: "finance.invoiceMatchTolerance",
  FINANCE_INVOICE_QTY_TOLERANCE_PCT: "finance.invoiceQtyTolerancePct",
  FINANCE_INVOICE_PRICE_TOLERANCE_PCT: "finance.invoicePriceTolerancePct",
  /** Çek teslim bordrosu HAREKET FİŞİ (K3, 2026-09-26; default FALSE = belge-only). Açıkken bankaya
   *  kesilen bordro çeki bankaya verir, cariye kesilen ciro eder; tek-çek bankaya verme/ciro tek satırlı
   *  bordro keser. Ters yolu bayrak değil kaydın bağı seçer (`ChequeEvent.deliveryNoteId`). */
  FINANCE_CHEQUE_NOTE_MOVEMENT_ENABLED: "finance.chequeNoteMovementEnabled",
  // ===========================================================================
  // TİCARET/MUHASEBE REJİM ANAHTARLARI (2026-08-14, dalga 1 — YALNIZ KAYIT)
  // ===========================================================================
  // ⚠️ Dokuzu da varsayılan FALSE ve BUGÜN HİÇBİR SERVİS OKUMUYOR. Bu bilinçli
  // bir ARA DURUMDUR: dört kapı (servis · route şeması · Electron arayüzü ·
  // panel satırı) önce kurulur, guard/otomasyon SONRAKİ dalgada bağlanır.
  // Sebep sıra disiplinidir — 2026-08-04 `kk1DuplicateGuardEnabled` vakasında
  // davranış önce yazılmış, route şeması unutulmuştu: bayrak sahada AÇILAMADI
  // ve daha kötüsü KAPATILAMADI. Kapılar önce kurulursa davranışı bağlayan
  // dalga, kapatma yolu hazır halde başlar.
  // ⚠️ Bayrağı okuyan kodu yazarken JSDoc'taki MUAF listesini birebir uygula;
  // muaflar sonradan hatırlanan ayrıntı değil, kuralın parçasıdır.
  /** Cari RİSK LİMİTİ aşımında satış faturası ONAYINI engelle (default FALSE).
   *  Bugün limit yalnız bir UYARIDIR (`CariAccount.riskLimit` şema notu: "satışı
   *  durdurma kararı TİCARİ bir karardır"); bayrak açıkken o karar sistemleşir
   *  ve onay 409 döner. ⚠️ Kapsam YALNIZ SATIŞ faturası onayıdır: alış faturası,
   *  taslak oluşturma/düzenleme ve İPTAL/storno yolları MUAF (limiti aşan bir
   *  faturayı iptal edememek çıkmaz olurdu). */
  FINANCE_RISK_LIMIT_BLOCK_ENABLED: "finance.riskLimitBlockEnabled",
  /** D4-I2: risk limiti aşılmış caride YENİ İŞ KABULÜ (gelen belge onayı + sipariş yaratma/müşteri değişimi) 409
   *  `RISK_LIMIT_EXCEEDED` (default FALSE = bugünkü davranış). Bakiye her para biriminde ayrı ölçülür (fatura ilkesi). */
  FINANCE_RISK_LIMIT_BLOCK_INTAKE: "finance.riskLimitBlock.intake",
  /** D4-I2: risk limiti aşılmış caride SEVK (kurulum + dispatch) 409 `RISK_LIMIT_EXCEEDED` (default FALSE). K22: tamamı
   *  emanet sevki cari kilidiyle aynı kararı alır (`finance.cariHold.emanetShipment`, `emanetShipmentReleaseTx`). */
  FINANCE_RISK_LIMIT_BLOCK_SHIPMENT: "finance.riskLimitBlock.shipment",
  /** Sevk onayında otomatik satış faturası TASLAĞI üret (default FALSE).
   *  ⚠️ Üretilen şey TASLAKTIR (`InvoiceStatus.DRAFT`) — onay HER ZAMAN elle
   *  kalır; bayrak "fatura kes" değil "veri girişini bir kez daha yazdırma"
   *  demektir. `financeEnabled` KAPALIYKEN bu bayrak açık olsa bile kanca
   *  no-op'tur (modül şalteri üstte). Taslak üretimi başarısız olursa sevk
   *  DÜŞMEZ — sevk operasyonu muhasebe kancasına rehin edilmez. */
  FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED: "finance.autoDraftFromShipmentEnabled",
  /** H7 (Hizmet veren, 2026-10-29): sevk taslağına hizmet (işçilik) satırları + fatura bağı — varsayılan KAPALI
   *  (kanca bayt-aynı). Alt ayarlar `finance.serviceBilling.*`; tek çözücü `resolveServiceBillingEnabled` (+ `loadServiceBillingSettings`). */
  FINANCE_SERVICE_BILLING_ENABLED: "finance.serviceBilling.enabled",
  /** H7: faturalanan metre tabanı — `OUT` (bugün/karar) · `IN` · `DECLARED`. */
  FINANCE_SERVICE_BILLING_METER_BASIS: "finance.serviceBilling.meterBasis",
  /** H7: ölçüm yoksa — `DECLARED_WITH_WARNING` (bugün) · `BLOCK_LINE`. */
  FINANCE_SERVICE_BILLING_MISSING_METER: "finance.serviceBilling.missingMeter",
  /** Brode fiyat birimi — `METER` (bugün, DALGA4 S7) · `PIECE` (adet) · `STITCH` (vuruş = adet × desen vuruşu). */
  FINANCE_SERVICE_BILLING_BRODE_UNIT: "finance.serviceBilling.brodeUnit",
  /** Fason F3: süreç türü eşlemeli adım işi (boya/apre/çözgü) hizmet satırı — varsayılan KAPALI (bugünkü çıktı bayt-aynı). */
  FINANCE_SERVICE_BILLING_STEP_WORKS: "finance.serviceBilling.stepWorks",
  FINANCE_SERVICE_BILLING_WEAVING_WORKS: "finance.serviceBilling.weavingWorks",
  /** H7/H8: tetik — `PER_SHIPMENT` (bugün); `PERIOD_END` sevk taslağı hizmet satırı üretmez, iş dönem sonu taslağına kalır. */
  FINANCE_SERVICE_BILLING_TRIGGER: "finance.serviceBilling.trigger",
  /** H7: fiyat tarihi — `SERVICE_DAY` (hizmet anı; bugün) · `DISPATCH_DAY` (sevk anı). */
  FINANCE_SERVICE_BILLING_PRICE_DATE: "finance.serviceBilling.priceDate",
  /** K14: kurşun gram fiyatı — `SERVICE_DATE` (işin anındaki sürüm; VARSAYILAN, kullanıcı kararı) · `INVOICE_DATE` (faturadaki güncel değer). */
  FINANCE_KURSUN_GRAM_PRICE_BASIS: "finance.serviceBilling.kursunGramPriceBasis",
  /** D4-H1: kasa masraf formunda "son kullanılan kategoriler" önerisi — `ON` (varsayılan) · `OFF`; katalog DEĞİL. */
  FINANCE_EXPENSE_CATEGORY_SUGGESTIONS: "finance.masraf.kategoriOnerisi",
  FINANCE_EXPENSE_ALLOCATION_FIELD: "finance.masraf.bagAlani",
  FINANCE_EXPENSE_ALLOCATION_CLOSED_WORK_ORDER: "finance.masraf.kapaliIsEmrineBag",
  /** D4-I1a: cari kilidi formunun kapsam ÖN SEÇİMİ (K20) — kapsamı kilit koyan seçer; varsayılan iş kabulü + sevk. */
  FINANCE_CARI_HOLD_DEFAULT_SCOPE: "finance.cariHold.defaultScope",
  /** D4-I1a: kilidi koyan kişi kendi kilidini açabilir mi — `ALLOW` (varsayılan, serbest) · `DENY` (başka yetkili açar). */
  FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON: "finance.cariHold.releaseBySamePerson",
  /** D4-I1c (S11): kilitli caride emanetin sahibine sevki — `EXEMPT` (varsayılan, bugünkü) · `PROCESSED_HELD` · `ALL_HELD`. */
  FINANCE_CARI_HOLD_EMANET_SHIPMENT: "finance.cariHold.emanetShipment",
  /** SY-J1: maliyet sunum dövizi — `TRY` (varsayılan; yanıt bayt-aynı) · `USD` · `EUR`. Motor TL'de kalır. */
  COST_PRESENTATION_CURRENCY: "maliyet.sunumDovizi",
  /** SY-E1: KG tabanlı terbiye tarifesinin kg'ı — `NET_HAM` (varsayılan; firesiz ham kumaş) · `IPLIK_TUKETIMI` (Excel uyumu). */
  COST_FINISHING_KG_BASIS: "maliyet.terbiyeKgTabani",
  /** D4-I2b (S12): risk limiti karşılaştırması — `PER_CURRENCY` (varsayılan, her para birimi ayrı) · `TRY_CONVERTED`
   *  (tüm bakiyeler o güne kadarki en son kurla TL'ye çevrilip toplanır; kur yoksa 409 `RISK_LIMIT_FX_MISSING`). */
  FINANCE_RISK_LIMIT_CURRENCY_MODE: "finance.riskLimit.currencyMode",
  /** D4-G2a: kârlılıkta dış fason maliyeti — `FATURA_ONCE` (varsayılan; onaylı fason faturası, yoksa tarife tahmini) · `YALNIZ_FATURA`. */
  COST_PROFIT_SUBCONTRACT_SOURCE: "maliyet.karlilik.disFasonKaynagi",
  /** D4-G2a: kârlılıkta sarf birim fiyatı — `ALIS_FIYATI` (varsayılan; kartın alış fiyatı) · `SON_ALIS_FATURASI`. */
  COST_PROFIT_CONSUMABLE_PRICE_SOURCE: "maliyet.karlilik.sarfFiyatKaynagi",
  /** SY-D2: dokuma standart maliyet yöntemi — `TEZGAH_SAATI` (varsayılan; devir × randıman × saat ücreti) · `ATKI_UCRETI` (atkı/cm × ücret). */
  COST_WEAVING_STANDARD_METHOD: "maliyet.dokumaStandartYontemi",
  /** SY-M1: siparişten üretim önerisi — `KAPALI` (varsayılan; düğme/uç yok) · `ONIZLEME` · `ONAYDA_TASLAK` (onayda önizleme açılır; sessiz yaratma yok). */
  ORDER_PRODUCTION_PROPOSAL: "siparis.uretimOnerisi",
  /** D4-G2b: kârlılıkta makine süresi — `OTURUM` (varsayılan; iş oturumu, IDLE `lastActivityAt`ta kesilir) · `VARDIYA` · `NORM`. */
  COST_PROFIT_MACHINE_TIME: "maliyet.karlilik.makineSuresi",
  /** D4-G2b: genel gider havuzunun işlere dağıtım anahtarı — `YOK` (varsayılan; dağıtılmaz) · `METRE` · `GELIR` · `MAKINE_SAATI`. */
  COST_PROFIT_OVERHEAD_KEY: "maliyet.karlilik.genelGiderAnahtari",
  /** D4-G2b: masraf kategorisi → sınıf (`ISCILIK` / `GENEL_GIDER` / `HARIC`); varsayılan `{}` (her kategori genel gider). */
  COST_PROFIT_CATEGORY_CLASSES: "maliyet.karlilik.kategoriSiniflari",
  /** Tahsilat/ödeme kaydında en eski açık faturalara OTOMATİK kapama — FIFO
   *  (default FALSE). Bugün kapama (`PaymentAllocation`) elle seçilir; açıkken
   *  tutar vade/tarih sırasıyla açık bakiyelere dağıtılır ve artan tutar
   *  AÇIKTA (avans) kalır. ⚠️ Otomatik kapama SİLİNEBİLİR olmalıdır — elle
   *  kurulan tahsis ile aynı tablodadır, "sistem yaptı" diye kilitlenmez.
   *  Farklı para birimli fatura ATLANIR (kur kararı otomatikleştirilmez). */
  FINANCE_AUTO_ALLOCATE_ON_PAYMENT_ENABLED: "finance.autoAllocateOnPaymentEnabled",
  /** İplik ÇIKIŞINDA bakiyeyi eksiye düşürecek hareketi engelle (default FALSE).
   *  Emsal `FINANCE_BLOCK_NEGATIVE_CASH_ENABLED` — orada kasa, burada
   *  `YarnStock.balanceKg`. ⚠️ MUAF: ters/düzeltme kayıtları (`ADJUST_OUT` ile
   *  yazılan storno) ve belge İPTAL yolları — yanlış girilmiş bir hareket
   *  "bakiye yetmiyor" diye geri alınamaz kalmamalı. Yani kural İLERİ yolda
   *  (`OUT`) uygulanır. Açmadan önce açılış/devir bakiyelerinin girildiğinden
   *  emin ol: sistemde 0 görünen dolu bir depodan tek çıkış bile yapılamaz. */
  YARN_BLOCK_NEGATIVE_BALANCE_ENABLED: "yarn.blockNegativeBalanceEnabled",
  /** Alış siparişine bağlı mal kabulde SİPARİŞ MİKTARINI AŞAN satırı engelle
   *  (default FALSE). Bugünkü davranış bilinçlidir ve varsayılan olarak KALIR:
   *  fiziksel olarak fazla mal GELEBİLİR, servis uyarır ve kayıt gerçeği yazar
   *  (`PurchaseOrderLine.receivedQty` şema notu). Bayrak, toleransı sıfırlayan
   *  firmalar içindir. ⚠️ Kapsam YALNIZ siparişe BAĞLI kabuldür — serbest
   *  (siparişsiz) mal kabulünde aşılacak bir miktar yoktur, MUAF. Kabul iptali
   *  ve düzeltme de MUAF. */
  PURCHASE_BLOCK_OVER_RECEIPT_ENABLED: "purchase.blockOverReceiptEnabled",
  /** Mal kabul satırında BİRİM FİYAT zorunlu (default FALSE). Açıkken fiyat
   *  satırdan ya da siparişten çözülemezse kabul 400 alır. Gerekçe: fiyat kabul
   *  ANINDA donar (`YarnMovement.unitPrice` / `Roll.purchasePrice`) ve alış
   *  faturası taslağı oradan doğar — sonradan girilen fiyat maliyeti geçmişe
   *  dönük değiştirir. ⚠️ MUAF: ters/iptal satırları fiyat TAŞIMAZ (geri sarım
   *  ticari bir olay değildir) ve bedelsiz kalemler için kaçış yolu
   *  `financeAllowZeroPriceLineEnabled`tir — ikisi birlikte düşünülür. */
  GOODS_RECEIPT_REQUIRE_PRICE_ENABLED: "goodsReceipt.requirePriceEnabled",
  /** Sarf stok defteri (kuşak/kurşun şeridi): mal kabulde sarf satırı + üretimde tüketim düşümü. Kapalı = bugünkü davranış. */
  CONSUMABLE_STOCK_ENABLED: "consumable.stockEnabled",
  /** İplik lotu kalite bekletme (2026-09-18): açıkken mal kabulde doğan lot ON_HOLD doğar, ON_HOLD/BLOKE lota çıkış 400. Varsayılan KAPALI. */
  GOODS_RECEIPT_YARN_QUALITY_HOLD_ENABLED: "goodsReceipt.yarnQualityHoldEnabled",
  /** İptalde sebep zorunlu (top iptali; sebep alanı OPSİYONEL olan tek üretim iptal ucu) — varsayılan false = bugünkü. */
  PRODUCTION_CANCEL_REASON_REQUIRED: "production.cancelReasonRequired",
  /** SIFIR fiyatlı fatura satırıyla ONAYA izin ver (default FALSE = sıfır fiyat
   *  reddedilir). Promosyon/numune/bedelsiz sevk içindir. ⚠️ İzin verilen şey
   *  SIFIRDIR, boş/çözülemeyen fiyat DEĞİL: "0 yazdım" bir karardır, "fiyat
   *  bulunamadı" bir eksiktir ve ikisi aynı kapıdan geçirilemez. NEGATİF fiyat
   *  her hâlükârda reddedilir (iade/indirim ayrı belgedir). */
  FINANCE_ALLOW_ZERO_PRICE_LINE_ENABLED: "finance.allowZeroPriceLineEnabled",
  /** İLERİ TARİHLİ mali belge tarihini engelle (default FALSE). Açıkken fatura /
   *  tahsilat-ödeme / masraf / virman belgesinin TARİHİ fabrika gününün
   *  (Europe/Istanbul) ilerisindeyse 400. ⚠️ MUAF (Sınıf 1): çekin KEŞİDE ve
   *  VADE tarihi — ileri tarihli çek işin normalidir, onu engellemek özelliği
   *  kullanılamaz kılardı. Sınır FABRİKA GÜNÜ sonudur (`factoryDayStart`
   *  ailesi), UTC gün sonu DEĞİL. */
  FINANCE_FUTURE_DATED_DOCUMENT_BLOCK_ENABLED: "finance.futureDatedDocumentBlockEnabled",
  /** Satış faturası ONAYINDA iplik satırlarını STOKTAN DÜŞ (default FALSE).
   *  Kapalıyken stok yalnız sevk/depo hareketiyle düşer. Açıkken onay, kalemin
   *  VARSAYILAN deposundan bir `YarnMovement(OUT)` doğurur. ⚠️ ÇİFTE DÜŞÜM
   *  RİSKİ: sevkten de düşen bir kurulumda bu bayrağı açmak aynı kg'yi iki kez
   *  düşürür — bayrak "stoğu fatura mı sevk mi düşürüyor" REJİM sorusudur, ek
   *  bir güvence değil. İPTAL/storno düşülen miktarı geri yazar. */
  FINANCE_YARN_OUT_ON_INVOICE_ENABLED: "finance.yarnOutOnInvoiceEnabled",
  /**
   * ÜRETİM modülü açık mı — envanterdeki üretim sekmeleri (Üretimde · Üretim
   * Akışı · Fasonda · Kurşun/Tambur Bekleyen) ve Siparişler'deki iş emri
   * yüzeyleri buna bakar.
   *
   * ⚠️ VARSAYILAN AÇIK ve `finance.enabled`'dan BAĞIMSIZ. Önceden bu yüzeyler
   * "finance açıksa gizle" diye çözülüyordu; o kısayol, ön muhasebeyi açan bir
   * FABRİKANIN üretim sekmelerini sessizce kaybetmesi demekti (2026-08-14 saha
   * bildirimi). İki soru ayrıdır: "muhasebe tutuyor muyum" ile "üretim yapıyor
   * muyum" aynı anda EVET olabilir.
   */
  PRODUCTION_ENABLED: "production.enabled",
  // ---------------------------------------------------------------------------
  // MODÜL ANAHTARLARI (2026-09-02) — `finance.enabled`/`production.enabled` ile
  // AYNI SINIF: görünürlük değil REJİM. Kapalıyken menü çizilmez, route 403
  // verir (`middlewares/module.middleware.ts`), kancalar no-op olur.
  // ⚠️ Beşi de VARSAYILAN KAPALI (`asBoolean(undefined) → false`) — mevcut
  // fabrikanın değerini migration DAMGALAR (20260902230000); koddaki varsayılan
  // yalnız SATIR-YOK sigortasıdır. Tek kaynak: `constants/module-flags.ts`.
  // ---------------------------------------------------------------------------
  /** Ticaret modülü: alış siparişi · mal kabul · fiyat listeleri · stok sayımı.
   *  ⚠️ `finance.enabled` ile KARIŞTIRMA: o cari/fatura/tahsilat DEFTERİNİ
   *  açar, bu MAL hareketinin ticari yüzünü (alım-satım kurulumu). Üretici
   *  fabrika ikisini de kullanmaz; bir toptancı ikisini de kullanır. */
  TICARET_ENABLED: "ticaret.enabled",
  /** İplik modülü: `YarnStock`/`YarnMovement` kg defteri.
   *  ⚠️ TİCARETE BAĞIMLI (`MODULE_DEPENDENCIES`): iplik alış/satış yüzeyleri
   *  olmadan tek başına anlamsızdır. Alt bayrağı `yarn.blockNegativeBalanceEnabled`
   *  ile KARIŞTIRMA — o davranış ayarı, bu modülün şalteri. */
  IPLIK_ENABLED: "iplik.enabled",
  /** Çoklu depo modülü: depo seçici · depo kolonu · depolar arası transfer.
   *  ⚠️ 2026-09-02'ye kadar bu bir ANAHTAR DEĞİL VERİ TÜREVİYDİ (panelde
   *  `warehouses.length > 1`). Damga o türevi ÖLÇEREK yazar; bundan sonra
   *  ikinci depo açmak yüzeyleri kendiliğinden AÇMAZ — anahtar açılmalıdır. */
  DEPO_MULTI_ENABLED: "depo.multiEnabled",
  /** Kumaş teknik kartı modülü (en · gramaj · kompozisyon · atkı/çözgü).
   *  YER TUTUCU — arkasında henüz yüzey YOK; panele de girmez (bekçi muafı). */
  KUMAS_TEKNIK_ENABLED: "kumasTeknik.enabled",
  /** Dokuma tezgah izleme modülü — Tezgah Salonu canlı ekranı ve `/api/loom-floor`.
   *  ÜRETİME BAĞIMLI (`MODULE_DEPENDENCIES`): üretim kapalıyken izlenecek iş
   *  emri yoktur. */
  TEZGAH_ENABLED: "tezgah.enabled",
  /** [PROFİL] İletim payı (dk): duruş hedef süreyi bu kadar aşınca patrona iletilir.
   *  Fabrika genelinde TEK değer (sebep başına değil); duruş açıldığı an satıra donar. */
  TEZGAH_ESCALATION_GRACE_MINUTES: "tezgah.escalationGraceMinutes",
  /** [PROFİL] Dokuma ALARM motoru (davranış bayrağı, `tezgah.enabled` arkasında). Varsayılan
   *  KAPALI = bugünkü davranış: hiçbir alarm satırı doğmaz, kademe yalnız okumada hesaplanır. */
  TEZGAH_ALARM_ENABLED: "tezgah.alarmEnabled",
  /** [PROFİL] Sebepsiz bildirilen duruşun ortak hedef süresi (dk). Varsayılan BOŞ (0 yazılır) =
   *  bugünkü davranış: sebepsiz duruş süre izlemez. Sebep seçilince sebebinkine geçer. */
  TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES: "tezgah.alarm.unclassifiedTargetMinutes",
  /** [PROFİL] Sebepsiz duruşta alarm anahtarı. Satır YOKSA süreden türer (boş = kapalı, sayı = açık) —
   *  bugünkü davranış; açıkken süre zorunlu, kapatmak süreyi silmez. */
  TEZGAH_ALARM_UNCLASSIFIED_ENABLED: "tezgah.alarm.unclassifiedEnabled",
  /** [PROFİL] Üstlenilmemiş alarmın yeniden ses/bildirim aralığı (dk) — yalnız görüntü/push, satır yazmaz. */
  TEZGAH_ALARM_RENOTIFY_MINUTES: "tezgah.alarm.renotifyMinutes",
  /** [PROFİL] Kart duruşu bu kadar saat açık kalırsa watchdog GEÇİCİ kapatır (`endSource = WATCHDOG`). */
  TEZGAH_MAX_OPEN_STOP_HOURS: "tezgah.maxOpenStopHours",
  /** [PROFİL] Kart bu kadar dakika imzalı istek göndermezse "sessiz" sayılır (uyarı; duruş açmaz). */
  TEZGAH_COLLECTOR_SILENCE_MINUTES: "tezgah.collectorSilenceMinutes",
  /** [PROFİL] Üstlenilmiş alarm da üst kademeye (K2) çıksın mı. Varsayılan AÇIK: üstlenmek
   *  K2'yi durdurmaz (motor bu bayrakla doğar; kapalıyken üstlenilmiş alarm K2'de bekler). */
  TEZGAH_ALARM_ESCALATE_WHEN_ACKED: "tezgah.alarm.escalateWhenAcked",
  /** [PROFİL] Vardiyasız zamanda alarm (`TezgahAlarmNoShiftMode`). Varsayılan `WARN` = bugünkü davranış:
   *  vardiya dışında açılan duruş alarm üretmez, yüzeyler uyarır. `ALWAYS` vardiyaya bakmaz; `REQUIRE_SHIFT`
   *  vardiya tanımı yokken alarmın açılmasını engeller (motor WARN gibi). */
  TEZGAH_ALARM_NO_SHIFT_MODE: "tezgah.alarm.noShiftMode",
  /** Devere / levent modülü: çözgü kartı · levent stoğu · levent olay defteri.
   *  ⚠️ İPLİĞE BAĞIMLI (`MODULE_DEPENDENCIES`), o da ticarete: levent doğarken
   *  iplik kg defterine çıkış yazılır (`WARP_ISSUE`). Zincir OKUMA kapısında
   *  ELLE ölçülür (`requireDevereEnabled`), tablo geçişli kapanış üretmez. */
  DEVERE_ENABLED: "devere.enabled",
  /** G3 EMANET (konsinye mülkiyet): `ownerCustomerId` yazılabilir mi (top · levent · iplik lotu). Bağımlılık YOK
   *  (Customer çekirdek). Ekransız modül: kapı owner YAZAN uçların gövdesinde (403); sevk sahiplik kapısı veri varsa
   *  bayraktan bağımsız çalışır. Varsayılan KAPALI = dünkü davranış (sahiplik alanı yoktu). */
  EMANET_ENABLED: "emanet.enabled",
  /** F1b emanet varsayılan deposu (Warehouse.id): sahipli (emanet) top depo söylenmeden doğunca buraya girer. Boş = bugünkü
   *  davranış (varsayılan depo); emanet kapalıyken etkisiz. Feature-flag yükünde DÖNMEZ; tek yazar
   *  `PUT /api/feature-flags/emanet-default-warehouse` (pasif/olmayan depo 400), ham ayar ucu reddeder. */
  EMANET_DEFAULT_WAREHOUSE_ID: "emanet.defaultWarehouseId",
  /** K4P Kalite Güvence (4 puan muayene · lab testi · sertifika). Bağımlılık YOK: muayene KK1'de doğar ve KK1
   *  üretim kapalıyken de açıktır. Varsayılan KAPALI = dünkü davranış (yüzey yoktu). */
  KALITE_GUVENCE_ENABLED: "kaliteGuvence.enabled",
  /** [PROFİL] Devere Faz 2: içeride sarımda iplik çıkış satırı ve mal kabul iplik satırı LOT
   *  ZORUNLU mu. DEFAULT false = bugünkü davranış (lot kaydı bayraksız her kurulumda mümkün,
   *  lotsuz satır yalnız UYARI). Davranış bayrağı — profile/modül tablosuna GİRMEZ. */
  DEVERE_LOT_REQUIRED: "devere.lotRequired",
  /** [PROFİL] Devere Faz 3: levent TEZGAH BAĞI defteri (tak · sök · tüket · düzelt · bitir · hurda).
   *  DEFAULT false = bugünkü davranış: levent READY'de kalır, tezgah bağı yok; uçlar 409
   *  `WARP_MOUNT_TRACKING_OFF` (durum, yetki değil). Davranış bayrağı — profile/modül tablosuna GİRMEZ. */
  DEVERE_MOUNT_TRACKING: "devere.mountTracking",
  /** [PROFİL] Devere Faz 3 (#16): bağlamada yöntem + başlangıç saati ZORUNLU mu. DEFAULT false. */
  DEVERE_MOUNT_TRACKING_REQUIRED: "devere.mountTrackingRequired",
  /** [PROFİL] Devere Faz 4: tezgahtan doğan top (KK1 WEAVING + doff bağı) bağlı leventlerden OTOMATİK
   *  tüketim düşer mi (`CONSUMED.rollId`). DEFAULT false = bugünkü davranış: tüketim elle yazılır, KK1
   *  yanıtı bayt bayt aynı. Davranış bayrağı — profile/modül tablosuna GİRMEZ. */
  DEVERE_AUTO_CONSUME: "devere.autoConsume",
  /** Dokuma işi modülü: dokuma işi planlama · tezgah koşumu · top indirme.
   *  ÜRETİME BAĞIMLI (`MODULE_DEPENDENCIES`), tezgah izlemenin KARDEŞİ — fasona
   *  dokutan firmada dokuma işi var tezgah yok (DOKUMA-IS-EMRI §2.5). */
  DOKUMA_ENABLED: "dokuma.enabled",
  /** Maliyet & Teklif modülü (MAL): ürün maliyeti · standart maliyet · satış teklifi · fiyat listesi ·
   *  iplik ihtiyaç planı. ÜRETİME BAĞIMLI (`MODULE_DEPENDENCIES`); kapı `requireMaliyetEnabled`.
   *  Varsayılan KAPALI = bugünkü davranış (modül yoktu). */
  MALIYET_ENABLED: "maliyet.enabled",
  /** Gelen belge taslağı modülü (Gülkesim OCR, D1): müşteri irsaliyesi fotoğrafı → OCR taslak → onayla emanet
   *  top girişi. EMANETE BAĞIMLI (`MODULE_DEPENDENCIES`); kapı `requireGelenBelgeEnabled`.
   *  Varsayılan KAPALI = bugünkü davranış (modül yoktu). */
  GELEN_BELGE_ENABLED: "gelenBelge.enabled",
  /** Gelen belge onayında ürünü seçilmemiş satırın doğacağı ürün (Item.id; hizmet ekseni, E3). Boş = bugünkü davranış
   *  (ürünsüz satır 400 DELIVERY_NOTE_LINE_UNRESOLVED). Feature-flag yükünde DÖNMEZ; tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_DEFAULT_ITEM_ID: "gelenBelge.defaultItemId",
  /** Gözden geçirilmemiş (needsReview) satır varken onay: WARN (varsayılan = bugünkü, geçer) | BLOCK (409). Tek yazar aynı uç. */
  GELEN_BELGE_UNREVIEWED_APPROVAL: "gelenBelge.unreviewedApproval",
  /** Onaydan SONRA net desen grupları için iş emrini kendiliğinden aç (MEVCUT quickStart; best-effort). Varsayılan
   *  KAPALI = bugünkü davranış (iş emri panelden elle). Feature-flag yükünde DÖNMEZ; tek yazar aynı uç. */
  GELEN_BELGE_AUTO_WORK_ORDER: "gelenBelge.autoWorkOrder",
  /** Rota önerisinin fabrika varsayılanı (Route.id). Boş = bugünkü davranış (öneri yalnız müşteri kaynaklarından).
   *  Feature-flag yükünde DÖNMEZ; tek yazar `PUT /api/gelen-belge/ayarlar` (pasif/adımsız rota 400). */
  GELEN_BELGE_DEFAULT_ROUTE_ID: "gelenBelge.defaultRouteTemplateId",
  /** Rota önerisi önceliği: CUSTOMER_FIRST (varsayılan = bugünkü zincir) | FACTORY_FIRST (fabrika varsayılanı önce). */
  GELEN_BELGE_ROUTE_PRIORITY: "gelenBelge.routeSuggestionPriority",
  /** El yazısı ızgarasında şüpheli metre oranı K (blok medyanının 1/K altı ya da K katı üstü → uyarı + satır etiketi).
   *  Boş = 4 (bugünkü alt sınır %25; üst sınır yeni, yalnız uyarı). Aralık 2–20; tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_OUTLIER_FACTOR: "gelenBelge.handwritingOutlierFactor",
  /** Tablosuz belgede (ürün sevk fişi `headerLine`) satır metresi/kg'si: OUTPUT çıkış toplamı (varsayılan = bugünkü) | INPUT giriş toplamı.
   *  Tek yazar `PUT /api/gelen-belge/ayarlar`; yeni okumaya uygulanır. */
  GELEN_BELGE_HEADER_LINE_SOURCE: "gelenBelge.headerLineMeterSource",
  /** Belge geneli beyan (Müşteri MT) satır toplamını tutmazsa: INFO bilgi + uyarı, onay geçer (varsayılan = bugünkü) |
   *  REQUIRE_REASON gerekçesiz onay 409 TOTAL_MISMATCH. Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_DOCUMENT_TOTAL_CHECK: "gelenBelge.documentTotalCheck",
  /** Okunan şablonun bağlı gönderen carisi boş gönderen alanına yazılsın mı. Varsayılan KAPALI = bugünkü (OCR gönderen doldurmaz).
   *  Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_AUTO_SENDER: "gelenBelge.autoSenderFromTemplate",
  /** Gelen belgeden doğan partinin numarası: SERIES seriden (varsayılan = bugünkü P01…/günlük) | DOCUMENT taslağın
   *  `ourBatchNo`su (boşsa seri). Tek yazar `PUT /api/gelen-belge/ayarlar`; flag yüküne konmaz. */
  GELEN_BELGE_BATCH_NUMBER_SOURCE: "gelenBelge.batchNumberSource",
  /** Onay kipi: PER_LINE her satır bir top (varsayılan = bugünkü) | PER_DOCUMENT belge başına tek top (kurşun metresi).
   *  PER_DOCUMENT fabrika varsayılan ürünü ister (boşsa yazım 400). Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_ENTRY_MODE: "gelenBelge.entryMode",
  /** İşlem değeri (gramaj/desen) çözülemeyen grupta oto iş emri: SKIP atla (varsayılan = bugünkü) | OPEN hedef
   *  değersiz aç. Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_AUTO_WORK_ORDER_PATTERNLESS: "gelenBelge.autoWorkOrderPatternless",
  /** İş emri formundan okutulan belgenin kaydı: SEPARATE ayrı onay (varsayılan = bugünkü, `gelen-belge:approve`) |
   *  WITH_WORK_ORDER iş emri açan kaydeder (belge + top + iş emri tek istekte). Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_FORM_APPROVAL: "gelenBelge.formApproval",
  GELEN_BELGE_MULTI_PARTY_WORK_ORDER: "gelenBelge.multiPartyWorkOrder",
  /** Aynı (sahip, gönderen belge no) tekrar gelirse (K27): BLOCK iptal dışı tek belge (varsayılan = bugünkü) | WARN işi süren
   *  eş varken onay 409 + operatör onayıyla geçer | ALLOW serbest. Tek yazar `PUT /api/gelen-belge/ayarlar`; flag yüküne konmaz. */
  GELEN_BELGE_DUPLICATE_DOC_NO: "gelenBelge.duplicateDocNo",
  /** Aynı (sahip, müşteri parti no) işi süren başka belgede varsa: ALLOW serbest (varsayılan = bugünkü) | WARN onay 409 +
   *  operatör onayıyla geçer | BLOCK 409. Tek yazar `PUT /api/gelen-belge/ayarlar`; flag yüküne konmaz. */
  GELEN_BELGE_DUPLICATE_BATCH_NO: "gelenBelge.duplicateBatchNo",
  /** İş emri açılınca refakat kartı istemcide kendiliğinden yazdırılır mı (varsayılan false = bugünkü: elle).
   *  Tek yazar `PUT /api/gelen-belge/ayarlar`; flag yüküne konmaz. */
  PRODUCTION_REFAKAT_AUTO_PRINT: "production.refakatAutoPrint",
  /** İstasyon tabletinde (kurşun · KK · tambur) "Belge okut": boyahane belgesinin fotoğrafından iş emri bulunur (K17).
   *  Varsayılan false = bugünkü (düğme yok). Tek yazar `PUT /api/gelen-belge/ayarlar`; flag yüküne konmaz. */
  GELEN_BELGE_STATION_DOC_LOOKUP: "gelenBelge.stationDocLookup",
  /** İstasyon belge okutmada doğrulama eşiği (0–100; 0 = kapalı, bugünkü doğrulamasız davranış). Varsayılan 80: ayar
   *  yalnız `stationDocLookup` açık kurulumda etkilidir (o da varsayılan kapalı). Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_STATION_VERIFY_THRESHOLD: "gelenBelge.stationVerifyThreshold",
  /** Belge fotoğrafı saklama (K28): FULL tam sakla (varsayılan = bugünkü) | SHRINK_ON_APPROVAL | DELETE_ON_APPROVAL |
   *  DELETE_ON_DISPATCH. Geçmiş onaylı belgelere de uygulanır (iş ayarı okur). Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_PHOTO_RETENTION: "gelenBelge.photoRetention",
  /** K30 S16a okunan desen/renk yazısı: KAPALI (varsayılan = bugünkü) | ONER ad/kod tam eşleşen kayıt önerilir |
   *  NOT yazı iş emri notuna eklenir. Tek yazar `PUT /api/gelen-belge/ayarlar`; flag yüküne konmaz. */
  GELEN_BELGE_DESEN_RENK_ESLESME: "gelenBelge.desenRenkEslesme",
  /** K30 S16a tablet iş emri girişi: IKISI (varsayılan = bugünkü) | BELGE yalnız belge okutma | TOP yalnız top okutma.
   *  Tek yazar `PUT /api/gelen-belge/ayarlar`; flag yüküne konmaz. */
  GELEN_BELGE_TABLET_IE_GIRISI: "gelenBelge.tabletIeGirisi",
  /** K30-B tanıtılan belgeye güven: SOR (varsayılan = bugünkü, okunanlar onaylatılır) | SORMA kullanıcı şablonuyla
   *  tanınan belge sorusuz dolar, tanınmayanın sözlük tahmini forma dolmaz. Tek yazar `PUT /api/gelen-belge/ayarlar`. */
  GELEN_BELGE_TANITIM_GUVENI: "gelenBelge.tanitimGuveni",
  /** Bilgisayarda ikinci okuma (sunucu OCR, okuma servisi): true (varsayılan = bugünkü) | false okuma servisine OCR/dönüştürme
   *  isteği gitmez, belgeyi yalnız cihaz okur. Tek yazar `PUT /api/gelen-belge/ayarlar`; kapı `gelen-belge-sunucu-okuyucu.service`. */
  GELEN_BELGE_SERVER_OCR_ENABLED: "gelenBelge.serverOcrEnabled",
  /** Z1 ÜRETİM BELGE ZİNCİRİ (2026-09-18) — üç davranış bayrağı, varsayılan KAPALI = bugünkü davranış (bağ opsiyonel). */
  DEVERE_BEAM_WEAVING_LINK_REQUIRED: "devere.beamWeavingLinkRequired",
  DOKUMA_RUN_WEAVING_ORDER_REQUIRED: "dokuma.runWeavingOrderRequired",
  DOKUMA_ORDER_LINE_LINK_REQUIRED: "dokuma.orderLineLinkRequired",
  /** S1 (2026-10-21, D1): topun doğuş yolu — `TABLET_DOFF` (bugün) · `KK1_LABEL_OR_ORDER` · `KK1_LABEL_ONLY`. Enum; kalıp `DOKUMA_ROLL_BIRTH_MODES`. */
  DOKUMA_ROLL_BIRTH: "dokuma.rollBirth",
  /** Seyitoğlu temel (2026-11-11): üretim önerisi + iplik ihtiyacında dokuma firesi % (ham = … ÷ (1 − fire)); varsayılan 0 = bugünkü davranış. */
  DOKUMA_WEAVING_WASTE_PCT: "dokuma.weavingWastePct",
  /** SY-3 I1 (2026-11-12): iplik ayırma görünürlüğü — açık dokuma işlerinin kalan iplik kg'ı "ayrılmış" sayılır; ENGELLEMEZ. Varsayılan FALSE. */
  DOKUMA_YARN_RESERVATION_ENABLED: "dokuma.yarnReservationEnabled",
  /**
   * KAPALI raporların anahtar listesi (JSON `string[]`, `REPORT_CATALOG` anahtarları).
   *
   * ⚠️ MODÜL ANAHTARI DEĞİL, GÖRÜNÜRLÜK listesi — ve yönü TERS kurulmuştur: liste
   * KAPALI olanları sayar. SATIR YOK ⇒ boş liste ⇒ HEPSİ AÇIK = bugünkü davranış
   * (ölçüldü: rapor başına kapı yok). "Açık olanlar" listesi yazılsaydı satırı olmayan
   * her kurulumda 29 rapor birden kaybolurdu ve yeni doğan rapor da kapalı doğardı.
   */
  REPORTS_CLOSED_KEYS: "reports.closedKeys",
  /** İş emrinde "hedef metraj" alanı gösterilsin mi. Default false (proses-only fabrika). */
  WORKORDER_TARGET_QUANTITY_ENABLED: "workorder.targetQuantityEnabled",
  /** İş emri formunda "hedef en" kutusu gösterilsin mi. Default TRUE (bugünkü davranış). */
  WORKORDER_TARGET_WIDTH_ENABLED: "workorder.targetWidthEnabled",
  /** KK1 ham kumaş girişinde "en" alanı gösterilsin mi. Default false (ham en önemsiz). */
  KK1_RAW_WIDTH_ENABLED: "kk1.rawWidthEnabled",
  /** KK1 ham kumaş girişinde "ağırlık (kg)" alanı gösterilsin mi. Default false.
   *  Backend ENFORCE eder — kapalıyken weightKg gelirse 400 (yanlış/kötü niyetli giriş reddi). */
  KK1_WEIGHT_ENTRY_ENABLED: "kk1.weightEntryEnabled",
  /** Ham girişte "az önce birebir aynısı girildi" tuzağı açık mı. Default FALSE.
   *  Açıkken 90 sn içinde aynı ürün+metraj+en aynı operatör/makineden yeniden
   *  gelirse 409 POSSIBLE_DUPLICATE döner; geçmek için `confirmDuplicate: true`
   *  gerekir (ENGELLEME DEĞİL ONAYLATMA — tekstilde birebir aynı top gerçekten
   *  arka arkaya gelir). ⚠️ Bunu açmadan ÖNCE sahadaki tabletler 409'u tanıyan
   *  APK'ya güncellenmeli; eski APK hatayı çıkışsız gösterir. */
  KK1_DUPLICATE_GUARD_ENABLED: "kk1.duplicateGuardEnabled",
  /** Tablet hızlı iş emri izni (`mobile:hizli-is-emri`) yalnız KENDİ başlattığı iş
   *  emrini düzenler/iptal eder mi. Default FALSE (bugünkü davranış: hepsini). */
  WORKORDER_QUICK_OWN_ONLY_ENABLED: "workorder.quickOwnOnlyEnabled",
  /** Destek talepleri yalnız sahibine görünür mü (`admin:settings` hepsini görür).
   *  Default FALSE (bugünkü davranış: `support:create` taşıyan herkes hepsini). */
  SUPPORT_OWN_TICKETS_ONLY_ENABLED: "support.ownTicketsOnlyEnabled",
  /** KK1 ham giriş ÇEVRİMDIŞI KUYRUKSUZ (online-only) rejimde mi. Default FALSE.
   *  Açıkken mobil KK1 çevrimdışıyken kayıt ALMAZ (form kilitli, sebep yazılır)
   *  ve kayıt+etiket tek nefeste yürür — "Sırada/Başarısız/Gitmedi" liste
   *  karışıklığının kökten kapatılması (2026-08-11 saha kararı). Client (mobil)
   *  ENFORCE — backend'in kuyruğu yoktur, sunucu tarafında zorlanacak bir şey yok.
   *  ⚠️ Bayrağı açmadan önce sahadaki tabletler bu rejimi tanıyan APK'da olmalı;
   *  eski APK bayrağı görmez ve kuyruklu davranışa devam eder (zarar yok, ama
   *  karışıklık da kapanmaz). */
  KK1_ONLINE_ONLY_ENABLED: "kk1.onlineOnlyEnabled",
  /** KK1'de ETİKET GERİ-OKUTMA doğrulaması (scan-back / print&verify). Default
   *  FALSE — kapalıyken ekranda hiçbir iz yok. Açıkken basılan her etiket için
   *  "okut" doğrulaması istenir ve okutulmadan yeni top girilemez: "etiket
   *  çıktı mı" sorusunu yazılım değil tarayıcı cevaplar (BT yazıcı baskı onayı
   *  DÖNDÜRMEZ — yazılımın "bastım"ı kâğıdın çıktığını kanıtlamaz). Client
   *  (mobil) ENFORCE. Sahada takarsa geri dönüş bu anahtardır. */
  KK1_LABEL_SCAN_VERIFY_ENABLED: "kk1.labelScanVerifyEnabled",
  /** KK1 "Tüm Girişler" listesi TÜM operatörlerin kayıtlarını göstersin mi.
   *  Default FALSE — kapalıyken operatör yalnız KENDİ girdiği topları görür
   *  (2026-08-12 saha kararı: sağdaki "Son Kayıtlar" listesi HER ZAMAN kişiye
   *  özeldir, bayrak yalnız "Tüm Girişler" modalının kapsamını açar). Client
   *  (mobil) ENFORCE — sunucu filtreyi istemciden gelen createdById ile uygular;
   *  bu bir GİZLİLİK duvarı değil, ekran sadeleştirmesidir (aynı veriyi panel
   *  roll:read ile zaten görür). */
  KK1_HISTORY_ALL_ENTRIES_ENABLED: "kk1.historyAllEntriesEnabled",
  /** İade kabulünde personel topun kalitesini değiştirebilsin mi. Default false
   *  (kapalıyken kalite butonu gizlenir + backend gönderilen override'ı yok sayar). */
  RETURN_GRADING_ENABLED: "return.gradingEnabled",
  /** TOP KALİTESİ ZORUNLU MU (D6, 2026-09-03). Default FALSE = bugünkü davranış
   *  (kalite opsiyoneldir, `qualityGrade` NULL doğabilir).
   *
   *  ⚠️ KAPSAM DAR ve BİLİNÇLİ — yalnız "final ürün kararı" veren DÖRT yüzey:
   *  KK1/manuel giriş (`createInitialEntry`, F221 opt-in) · Tambur kalan-kuyruk
   *  topu · depo kesimi (`cutWarehouseRoll`) · WO kapanış dispozisyonunun
   *  `WAREHOUSE`/`A1_STOCK` satırları. KAPSAM DIŞI (gerekçeli, bekçide NEGATİF
   *  sonda): `cutOpenFabric` (kalite zaten hep dolu) · fason kabul doğumu
   *  (bilinçli null — "kaliteye bakılmadı") · `finalizeRollsAtLastStep`
   *  (WO kapanışını komple kilitlerdi) · iade kabulü (`return.gradingEnabled`
   *  kapalıyken kalite girecek yüzey YOK — anlam çatışması).
   *
   *  ⚠️ ÇEKİRDEKTİR, üretim modülünün ALTINDA DEĞİL: KK1 dalı Roll doğuran
   *  motorda yaşar (tasarım karar #2 — "motor çekirdek, sunum modülde") ve
   *  toptancının "Mal Girişi" ekranı da aynı motoru kullanacak. Bu yüzden
   *  `resolve*` yok, DÜZ okuyucu.
   *
   *  ⚠️ ÖNKOŞUL: Tambur kalan-kuyruk dalı bayrak açıkken 400 verir; tablette
   *  "kalan parça için kalite" alanı olan APK ŞART (bkz. panel açıklaması). */
  QUALITY_GRADE_REQUIRED_ENABLED: "quality.gradeRequiredEnabled",
  /** AÇIK PARTİ YOKKEN SUNUCU PARTİYİ KENDİSİ AÇSIN MI (D7, 2026-09-03).
   *  Default FALSE = bugünkü davranış (0 açık parti → top PARTİSİZ doğar).
   *
   *  ⚠️ ADI "otomatik", "zorunlu" DEĞİL ve bu bilinçli: "parti zorunlu" bir
   *  ÇIKIŞSIZ KAPI olurdu — sistemde sıfırdan parti YARATAN uç yok
   *  (`batch.routes` yalnız move/merge/split taşır), yani operatörün kapıyı
   *  açacak hiçbir yolu olmazdı. Tek enforcement noktası `tambur-manual`
   *  "0 açık parti → null" dalıdır; `attachRolls`/`quickStart` DOKUNULMAZ
   *  (parti orada zaten koşulsuz doğuyor). Elle parti açma yüzeyi ayrı paket. */
  BATCH_AUTO_CREATE_ENABLED: "batch.autoCreateEnabled",
  /** Kartela kabulünde uzunluk(cm)/ağırlık(kg) alanları gösterilsin mi. Default false
   *  (bu firma kartelayı yalnız ADET sayar; kapalıyken kabul ekranında ve kartela
   *  listelerinde cm/kg gizlenir). Başka firmalara açık satılabilir. Backend ENFORCE
   *  etmez — salt UI rehberi; gizlenince zaten null gelir. */
  KARTELA_MEASUREMENT_ENABLED: "kartela.measurementEnabled",
  /** İş emri "Parti Kodu" (batchNumber) otomatik mi üretilsin manuel mi girilsin.
   *  Default false (manuel). Açıkken form otomatik P+GGAAYY+NNNN önerir, override edilebilir. */
  WORKORDER_PARTY_CODE_AUTO: "workorder.partyCodeAuto",
  /** Sipariş oluştururken termin (deadline) verilmediyse orderDate + N gün. Default 7. */
  ORDER_DEFAULT_DEADLINE_DAYS: "order.defaultDeadlineDays",
  /** İş emri oluştururken plannedEndDate verilmediyse plannedStartDate + N gün. Default 7. */
  WORKORDER_DEFAULT_PLAN_DURATION_DAYS: "workorder.defaultPlanDurationDays",
  /** İş emri VARSAYILAN STOK KARTI (Item.id): hedef kumaşı boş bırakılan stoğa üretim İE'si bu kartla açılır. Boş = bugünkü
   *  davranış (400). Öncelik: elle > müşteri varsayılanı > bu ayar > gelen belge fabrika varsayılanı. Feature-flag yükünde
   *  DÖNMEZ; tek yazar `PUT /api/feature-flags/work-order-default-item`. */
  WORKORDER_DEFAULT_TARGET_ITEM_ID: "workorder.defaultTargetItemId",
  /** Sahadaki operatör Fason Sevk'te fason talimatını telefondan girebilsin mi.
   *  Default false (kapalı) → talimat yalnızca adım notundan gelir; mobil alan gizli. */
  FASON_NOTE_MOBILE_ENTRY: "fason.noteMobileEntry",
  /** SİMÜLE kantardan gelen çuval tartısı KAYDEDİLEBİLSİN mi. Default false = ENFORCE:
   *  simüle okuma `weighSack`'te 400 ile reddedilir. Yalnız demo/eğitim kurulumu açar.
   *  Diğer bayrakların çoğunun aksine backend ENFORCE eder, çünkü çuval kg'si sevk
   *  irsaliyesine ve çeki listesine BASILIR (müşteri/gümrük belgesi) — uydurulmuş bir
   *  sayının oraya girmesi geri alınamaz. Elle giriş (`source: MANUAL`) MUAF: operatör
   *  kg'yi kendi yazmıştır, kantarın simüle olması onu ilgilendirmez (kantarsız/arızalı
   *  kaçış yolu). Emsal: KK1_WEIGHT_ENTRY_ENABLED. */
  SHIPPING_SIMULATED_WEIGHT_ENABLED: "shipping.simulatedWeightEnabled",
  /** Mobil cihaz eşleştirmesi ZORUNLU mu. Default false (pasif) → eşleşmemiş
   *  tabletler de giriş yapıp çalışabilir (makine atfı NULL kalır). True iken
   *  eşleşmemiş/pasif cihaz device.middleware'de 401 ile kesilir. ENFORCE edilir. */
  DEVICE_PAIRING_REQUIRED: "device.pairingRequired",
  DEVICE_PROOF_REQUIRED: "device.proofRequired",
  /** Onaysız (PENDING + aktif) tablet onay beklemeden YALNIZ kullanıcı adı + parolayla girebilsin mi.
   *  Default false (bugünkü davranış). Eşleştirme etkin zorunluyken anlamlıdır; PIN/kart, personel
   *  listesi ve indirme belirteci onaysız cihaza kapalı kalır. Barındırılanda ZORLANMAZ. ENFORCE edilir. */
  DEVICE_UNPAIRED_PASSWORD_LOGIN: "device.unpairedPasswordLogin",
  /** Hızlı PIN / QR kartla giriş YALNIZ onaylı cihazdan mı. Default false (bugünkü davranış).
   *  Açıkken eşleştirme de etkin zorunlu olur (otomatik onay kapanır); barındırılan
   *  kurulumda (BARINDIRILAN) her iki kural ZORUNLUDUR ve kapatılamaz. ENFORCE edilir. */
  AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY: "auth.shortCredentialApprovedDeviceOnly",
  /** 2FA'sı açık (süperadmin OLMAYAN) hesabın hızlı PIN / kart girişinde de kod sorulsun mu.
   *  Default false (bugünkü davranış). Süperadminde ayardan bağımsız HER ZAMAN sorulur (Y-02). */
  AUTH_SHORT_CREDENTIAL_TOTP_REQUIRED: "auth.shortCredentialTotpRequired",
  /** Bulut web paneli (tarayıcı, çerez kipi) TOTP politikası: REQUIRED (default, K4 bugünkü davranış)
   *  | USER_CHOICE (kullanıcı kendi hesabında `webTotpOptOut` ile kapatabilir). Yalnız süperadmin
   *  yazar (`SUPERADMIN_ONLY_FLAG_KEYS`); süperadminde ayardan bağımsız hep sorulur. */
  AUTH_WEB_TOTP_POLICY: "auth.webTotpPolicy",
  /** Web girişinde "Bu cihazı N gün hatırla" süresi (gün). 0 = kapalı (default, bugünkü davranış:
   *  her girişte kod), 1–90. Yalnız süperadmin yazar; süperadmin hesabına hiç uygulanmaz. */
  AUTH_TRUSTED_DEVICE_DAYS: "auth.trustedDeviceDays",
  /** Sevk için ayrı onay adımı zorunlu mu. Default false (KAPALI): çuvalları seç → Sevk Et
   *  → DOĞRUDAN sevk edilir (DISPATCHED). AÇIKKEN: Sevk Et yalnız PLANNED sevkiyat kurar;
   *  çıkış ayrıca "Sevk Kapısı" ekranından dispatch edilir. */
  SHIPMENT_CONFIRMATION_ENABLED: "shipping.confirmationEnabled",
  SHIPMENT_MANUAL_SACK_COUNT_ENABLED: "shipping.manualSackCountEnabled",
  /** Çuvalsız sevk (dökme / araba yükü). Default false: tablet kipi görünmez, yük birimi alanı 400. */
  SHIPMENT_LOOSE_LOAD_ENABLED: "shipping.looseLoadEnabled",
  /** El terminalinden (Sevk Çıkışı) sevk kurma — v2 uçları (`/shipments/handheld`, `/scan`, `/sacks`, `/handheld-dispatch`).
   *  Default false: uçlar 403 HANDHELD_DISABLED (sunucu kapısı), eski yollar etkilenmez. Ön koşul looseLoadEnabled. */
  SHIPMENT_HANDHELD_CREATE_ENABLED: "shipping.handheldCreateEnabled",
  /** Sevk geri alma (storno) YALNIZ aynı fabrika gününde mi yapılabilsin. Default false
   *  (KAPALI = zaman sınırı YOK). Açıkken `dispatchedAt` bugünün fabrika günü başlangıcından
   *  (Europe/Istanbul) önceyse 409. Fatura ve iade koşulları bu ayardan BAĞIMSIZ ve her
   *  zaman geçerlidir — bu yalnız EK bir daraltmadır. ENFORCE edilir (backend). */
  SHIPMENT_UNDO_SAME_DAY_ONLY: "shipping.undoDispatchSameDayOnly",
  /** Sevkiyat SİPARİŞE bağlanmalı mı — `off` | `warn` (default) | `block`.
   *
   *  `warn` = BUGÜNKÜ davranış: siparişsiz sevk kurulur, yanıt `warnings` taşır
   *  (`orderless: true` beyanı uyarıyı susturur — niyet beyan edilmiştir).
   *  `off`  = YALNIZ siparişsizlik uyarısını susturur; önizlemenin diğer İKİ
   *           uyarısı (tahsis fazlası · başka açık sevkiyatta bekleyen mükerrer
   *           tahsis) AYAKTA kalır — onlar farklı soruların cevabıdır.
   *  `block`= sipariş bağı ZORUNLU; `orderless: true` beyanı yine MUAF (numune /
   *           fazla mal meşru bir iştir, kural "niyet beyan edilsin"dir).
   *
   *  ⚠️ KAPI YALNIZ KURULUMDA (`createShipment` · `createShipmentFromRolls` ·
   *  `setShipmentOrders`ın boş-dizi dalı). `dispatchShipment`e KONMAZ: bayrak
   *  açılmadan kurulmuş PLANNED sevkiyatlar siparişsizdir ve çıkışları
   *  kilitlenirse mal bina içinde kalır (tasarım §11 "geçmişe etki eden bayrak
   *  yok"). ENFORCE edilir (backend). */
  SHIPPING_ORDER_REQUIREMENT: "shipping.orderRequirement",
  /** "Tükenene kadar" karta yeni sipariş: OKUTULAN_TOPLAR (default) / KAPALI / SERBEST
   *  (URUN-YASAM-DONGUSU.md §4.1). KAPALI ↔ `shipping.orderRequirement=block` çapraz
   *  kapıyla birlikte kurulamaz (mal çıkamaz). ENFORCE edilir (backend). */
  ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER: "itemLifecycle.phaseOutNewOrder",
  /** "Tükenene kadar" kartın açık sipariş satırında miktar: SERBEST_UYARILI (default) /
   *  AZALTMA_SERBEST / KILITLI. ENFORCE edilir (backend). */
  ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY: "itemLifecycle.phaseOutLineQty",
  /** "Tükenene kadar" karta yeni üretim planı (topsuz+siparişsiz iş emri, hedef ürün
   *  değişimi, dokuma işi). Default true. ENFORCE edilir (backend). */
  ITEM_LIFECYCLE_PHASE_OUT_NEW_PLAN: "itemLifecycle.phaseOutNewPlan",
  /** Sevk öncesi TÜM çuvallar tartılmalı mı. Default false = BUGÜNKÜ davranış
   *  (yalnız `destination = EXPORT` tartı ister). Açıkken yurtiçi sevk de tartı
   *  ister ve hızlı sevk (`from-rolls`) KOMPLE kapanır — orada çuval operatöre
   *  görünmeden doğar, tartılamaz.
   *
   *  ⚠️ İHRACAT KURALI BAYRAKTAN BAĞIMSIZ: bayrak yalnız GENİŞLETİR, asla
   *  gevşetmez (gümrük/mevzuat kuralı bayraklanamaz — tasarım §11).
   *  ⚠️ `markSackContentChangedTx` çuval içeriği değişince kg'yi SIFIRLAR →
   *  tartılı çuvala tek top eklemek sevki 400'e düşürür. Panel/tablet metni
   *  bunu açıkça söyler ("içerik değişti, yeniden tartın").
   *  ENFORCE edilir (backend). */
  SHIPPING_WEIGH_REQUIRED_ENABLED: "shipping.weighRequiredEnabled",
  /** ELLE tartı (`weightSource = MANUAL`) yalnız `shipping:write` taşıyan
   *  kimlikte serbest olsun mu. Default false = BUGÜNKÜ davranış (herkes elle
   *  girebilir). Açıkken tablet izniyle (`mobile:tarti-paket` / `mobile:sevkiyat`)
   *  gelen istek kantar okuması (`SCALE`) göndermek zorundadır.
   *
   *  YENİ İZİN KODU YOK (2026-08-01 kurşun-bypass dersi: izin doğar, kimseye
   *  atanmaz, sebep hiçbir yerde yazmaz) — ayrım mevcut `shipping:write` ↔ mobil
   *  ekran izinleri arasındadır.
   *  ⚠️ `source` OPSİYONELLİĞİ KAPATILMAZ (eski istemci toplu 403 olurdu) →
   *  bayrak açıkken `source` göndermeyen istek MANUAL sayılır ve aynı kuraldan
   *  geçer. Bu yüzden bayrak "tüm tabletler+paneller güncellenmeden AÇILMAZ".
   *  ⚠️ İKİNCİ YOL da kapalı: `openSack` gövdesindeki `weightKg` aynı yüklemden
   *  geçer (yoksa fail-open + "elle girildi" izlenebilirlik yalanı).
   *  ENFORCE edilir (backend). */
  SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED: "shipping.manualWeightRestrictedEnabled",
  /** Sevkin FATURA İZİ nereden yazılsın — `dis` (default) | `ic` | `ikisi`.
   *
   *  `dis`   = BUGÜNKÜ davranış: fatura dış muhasebe programında kesilir, ERP'ye
   *            yalnız numarası elle işaretlenir (`POST .../:id/invoice`).
   *  `ic`    = elle iz ucu 400 `INVOICE_TRACE_DISABLED`; numara yalnız iç fatura
   *            onayından (`invoice.service.confirm`) damgalanır. ⚠️ İZ KALDIRMA
   *            (`invoiceNo: null`) `ic` modunda da AÇIK kalır — yoksa mod
   *            açılmadan önce basılmış yanlış izler kalıcı olurdu.
   *  `ikisi` = elle iz serbest; iç faturası OLAN sevke yazılırsa yanıt `warnings`
   *            taşır (amber), ENGEL YOK.
   *
   *  ⚠️ İÇ ONAYIN DAMGASI HER MODDA KALIR: storno kapısı (`resolveUndoBlockReason`)
   *  yalnız `invoiceNo`ya bakar; damga da kaldırılsaydı "faturalanmış sevk geri
   *  alınamaz" koruması sessizce düşerdi.
   *  ⚠️ `maybeAutoDraftInvoiceAfterDispatch` bu bayraktan ETKİLENMEZ (finans
   *  kancası, kendi çift kapısı var). ENFORCE edilir (backend). */
  SHIPPING_INVOICE_MODE: "shipping.invoiceMode",
  /** Sevk belgelerinde ürün adı hangi dilden basılsın — `bizdeki` (default) |
   *  `musterideki` | `ikisi`.
   *
   *  Fabrika talebi (2026-09-04): müşteri kendi kumaş adını görsün; sipariş
   *  satırında bir seferliğine değiştirilmişse O ad basılsın. Ad zaten donmuş
   *  belgede duruyor (`products[].customerName`, `cekiRows[].customerDesen`);
   *  bu ayar SUNUM kararıdır — hangi kolonun basılacağını söyler, snapshot'ı
   *  değiştirmez, yeni belge versiyonu doğurmaz.
   *
   *  ⚠️ `musterideki` FAIL-OPEN: müşteride karşılığı olmayan üründe BİZİM adımız
   *  basılır. Boş ürün adı taşıyan irsaliye hukuken sakattır; "ayar açık, ad yok"
   *  diye hücreyi boş bırakmak sahayı kâğıtsız bırakmaktan beterdi.
   *  ⚠️ Kapsam YALNIZ sevk irsaliyesi ailesidir (`SHIPMENT_DISPATCH` + aynı
   *  snapshot'tan beslenen muhasebe fişi). Fasondan DOĞRUDAN sevk irsaliyesi
   *  (`SUBCONTRACTOR_DIRECT_SHIP`) AYRI payload/renderer taşır ve bu ayarın
   *  DIŞINDADIR — kardeş yüzey, ayrı karar. */
  SHIPPING_DOC_ITEM_NAME_MODE: "shipping.docItemNameMode",
  /** Çeki listesi bölümünde ürün/renk adı rejimi. `devral` (default) =
   *  `SHIPPING_DOC_ITEM_NAME_MODE` ne diyorsa o — yani bugünkü davranış, bayt-bayt.
   *  ⚠️ NEDEN AYRI BAYRAK: çeki listesi sevk irsaliyesinin bir BÖLÜMÜ ve bugün tek
   *  global rejime bağlı. Fabrika "çekide hem bizdeki hem müşterideki ad görsün"
   *  isteyince tek bayrağı `ikisi` yapmak, AYNI ANDA müşteriye giden ürün listesine
   *  de "Stok adı" kolonunu geri koyardı — fabrika onu bilerek kapatmıştı.
   *  İki yüzeyin iki farklı okuyucusu var, tek bayrak ikisini birden çeviriyordu. */
  SHIPPING_DOC_CEKI_NAME_MODE: "shipping.docCekiNameMode",
  /** Kapsama rejimi — İKİNCİ EKSEN. `orderRequirement` "sipariş seçildi mi" (niyet),
   *  bu "mal deftere yazıldı mı" (sonuç) sorusunu ölçer. `off` = bugünkü davranış. */
  SHIPPING_ORDER_COVERAGE: "shipping.orderCoverage",
  /** Ürün listesinde müşteri RENGİ ayrı sütun mu (default false = bugünkü birleşik dize). */
  SHIPPING_DOC_PRODUCT_COLOR_SPLIT: "shipping.docProductColorSplit",
  /** Paketleme grubu (çalışma yaftası) açık mı — default false = BUGÜNKÜ davranış:
   *  düz çuval listesi ve "Hemen Sevk Et" içi dolu HER çuvalı gönderir. */
  /** Çuval/grup İÇERİK DÖKÜMÜNDE ad rejimi (default `ikisi` = bugünkü çıktı). */
  SACK_DUMP_NAME_MODE: "shipping.sackDumpNameMode",
  PACKING_GROUPS_ENABLE: "packing.groupsEnabled",
  /** Grup numarası sayacının rejimi: `artan` (default) | `bosluk-doldur`. */
  PACKING_GROUP_NUMBERING: "packing.groupNumbering",
  /** Grup davranışı ↔ SEVK PARTİSİ davranışı: `grup` (default = bugünkü) | `sevk-partisi`. */
  PACKING_GROUP_MODE: "packing.groupMode",
  /** Parti içi ambalaj numarası 0'dan mı başlar (default false = 1'den). */
  PACKAGE_NO_STARTS_AT_ZERO: "packing.packageNoStartsAtZero",
  /** Ambalaj no atama modu: `otomatik` | `otomatik-ezilebilir` (default) | `elle`. */
  PACKAGE_NO_MODE: "packing.packageNoMode",
  /** Ambalaj no sayaç rejimi: `artan` (default; geri verilmez) | `bosluk-doldur`. */
  PACKAGE_NUMBERING: "packing.packageNumbering",
  /** Partisiz çuval açma yasak mı (default false). Açıkken tablet çuval açamaz. */
  PACKING_LOT_REQUIRED: "packing.lotRequired",
  /** Partinin bir alt kümesi sevk edilebilir mi (default TRUE = kısmi sevk serbest). */
  PACKING_LOT_PARTIAL_DISPATCH: "packing.lotPartialDispatch",
  /** İrsaliye/çeki listesine parti adı + ambalaj no kolonu (default false = bugünkü belge). */
  SHIPPING_DOC_PACKING_LOT: "shipping.docPackingLot",
  // Sevkiyat içi çuval sırası etiketi (2026-09-22): belgeye basılsın mı · ön ek · başlangıç · "n/N".
  SHIPPING_SACK_SEQ_ON_DOC: "shipping.sackSeqOnDoc",
  SHIPPING_SACK_SEQ_PREFIX: "shipping.sackSeqPrefix",
  SHIPPING_SACK_SEQ_START: "shipping.sackSeqStart",
  SHIPPING_SACK_SEQ_SHOW_TOTAL: "shipping.sackSeqShowTotal",
  // Ön ek değişince ESKİ belgeler de değişsin mi (kapalı = sevk anındaki ön ek donar).
  SHIPPING_SACK_SEQ_PREFIX_LIVE: "shipping.sackSeqPrefixLive",
  // İade irsaliyesi dipnotu (serbest metin; boş = basılmaz) — belge ilk basımda donar.
  SHIPPING_RETURN_FOOTNOTE: "shipping.returnFootnote",
  // Partisiz (havuz) çuvalın ambalaj numarası ne zaman doğar: sevkte (sevk sırası) · açılışta (cari havuz sayacı).
  PACKING_POOL_PACKAGE_NO: "packing.poolPackageNo",
  /** Tahsiste EN toleransı açık mı (default false = tam eşitlik, bugünkü davranış). */
  SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED: "shipping.allocWidthToleranceEnabled",
  /** Tolerans değeri (cm). Yalnız yukarıdaki bayrak açıkken uygulanır. */
  SHIPPING_ALLOC_WIDTH_TOLERANCE_CM: "shipping.allocWidthToleranceCm",
  /** Tahsis sipariş miktarını AŞABİLİR mi (fazla sevk deftere yazılsın mı). Default false. */
  SHIPPING_ALLOW_OVER_ALLOCATION: "shipping.allowOverAllocation",
  /**
   * SEVKE HAZIR İŞLER (D4-J1, 1e kararları K25–K26): hazırlık TÜRETİLİR, saklanmaz. Kural
   * (ALL_DONE | METER_THRESHOLD) + tolerans yalnız `effectiveShipReadyPolicy` (ship-readiness.helper)
   * üzerinden okunur. `notifyUnits` + `scanMinutes` KOSUL bildiriminin (D4-J2) ayarlarıdır; okuyucusu
   * `notification-sources/is.ts` `readyWorkSubjects` (boş küme = bildirim kapalı).
   */
  SHIPPING_READY_RULE: "shipping.ready.rule",
  SHIPPING_READY_TOLERANCE_PCT: "shipping.ready.tolerancePct",
  SHIPPING_READY_NOTIFY_UNITS: "shipping.ready.notifyUnits",
  SHIPPING_READY_SCAN_MINUTES: "shipping.ready.scanMinutes",
  /** Müşteri şubeleri (sevk noktaları) UI'da gösterilsin mi. Default TRUE (açık —
   *  mevcut davranış). "Her şube = ayrı müşteri" düzenine geçen firma kapatır:
   *  müşteri formundaki Şubeler sekmesi/taslağı + sipariş formundaki şube seçimi
   *  gizlenir. Salt UI rehberi — backend ENFORCE ETMEZ; mevcut branchId verisi korunur. */
  CUSTOMER_BRANCHES_ENABLED: "customers.branchesEnabled",
  /** Refakat kartı marka/içerik ayarı (JSON): firma adı + hangi bölümler basılsın.
   *  Kart oluşturulurken snapshot'a DONDURULUR → reprint düzeni de sabit kalır. */
  TRAVELER_CARD_CONFIG: "traveler.cardConfig",
  /** ERP'nin kurulduğu firmanın adı — panel başlığı + uygulama genelinde gösterilir.
   *  Refakat kartının kendi firma adından bağımsızdır (kart snapshot'ı ayrı tutulur). */
  COMPANY_NAME: "company.name",
  /** ESKİ tek değerli fabrika saat dilimi (TZ-B, hiçbir sürüme çıkmadı). Yerini `factory_timezone_periods` dönem
   *  defteri aldı; satır varsa ilk dönemden önceki dilim olarak YORUMLANIR. Ham ayar ucundan ve PATCH'ten YAZILAMAZ. */
  COMPANY_TIMEZONE: "company.timezone",
  /** Belge künyesi: irsaliye/çeki başına basılan firma adresi/telefon/vergi bilgisi.
   *  Firma adı ayrı (COMPANY_NAME); burada sadece ek künye satırları. */
  COMPANY_LETTERHEAD: "company.letterhead",
  /** Gönderici RESMİ künyesi (VKN/TCKN, unvan, vergi dairesi, adres) — e-belgenin kimliği.
   *  Serbest metin `company.letterhead`ten ayrı soru: o basılan süs, bu yapısal kimlik (E3-AYAR). */
  COMPANY_LEGAL_IDENTITY: "company.legalIdentity",
  /** e-İrsaliye yapılandırması: bağdaştırıcı + yürürlük tarihi. Varsayılan `yok` = özellik kapalı
   *  (modül anahtarı DEĞİL, yapılandırma kapısı — plan §0.3 P1). */
  EIRSALIYE_CONFIG: "eIrsaliye.config",
  /** Yazdırılan belgelerin (sevk irsaliyesi, fason sevk, kartela çeki) içerik ayarı:
   *  hangi bölümler basılsın + başlık/imza/footer override. CANLI okunur (snapshot DEĞİL)
   *  — irsaliye her açıldığında güncel ayarı yansıtır. Map: { [belgeKey]: DocumentConfig }. */
  DOCUMENTS_CONFIG: "documents.config",
  /** Belge logosu — hash-anahtarlı kütüphane: { current: hash|null, items: {hash: dataUrl} }.
   *  Snapshot yalnız hash taşır (satır başına base64 kopyası YOK); eski belge kendi
   *  logosuyla basılır (append-only items), güncel logo `current` ile değişir. */
  DOCUMENTS_LOGO: "documents.logo",
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi AŞABİLSİN mi. Default TRUE (açık).
   *  Açıkken operatör tambur asıl ölçüm noktası olduğu için kayıtlıdan fazla ölçtüğünde (örn.
   *  100m açık kumaşı 150m top yapma) kabul edilir; aşımda parent top tamamen tüketilir. Admin
   *  kapatırsa çıkış ≤ giriş zorunlu olur (aşan giriş 400 ile reddedilir). Diğer flag'lerin
   *  aksine backend ENFORCE eder (guard bu flag'e bağlı). */
  TAMBUR_OVER_QUANTITY_ENABLED: "tambur.overQuantityEnabled",
  /**
   * KISA KESİM → OTOMATİK A1 (2026-08-19, saha isteği).
   * Kesim uzunluğu eşiğin ALTINDAysa ve operatör 1. Kaliteyi değiştirmemişse
   * kalite A1'e çevrilir. Kural İSTEMCİDE yaşar (mobil `shortCutQuality.ts`) —
   * bu iki anahtar yalnız FABRİKA VARSAYILANIdır. Backend ENFORCE ETMEZ: kalite
   * zaten operatörün kararıdır ve kesim uçları A1'i her hâlükârda kabul eder;
   * sunucuda ikinci bir kural kurmak, tabletin gösterdiği ile yazılanın
   * ayrışabileceği bir çift kaynak üretirdi.
   * Yetkili operatör tablette CİHAZ BAZINDA ezebilir (override) — o tercih
   * sunucuya gitmez (`deviceSettingsStore`).
   */
  TAMBUR_SHORT_CUT_A1_ENABLED: "tambur.shortCutA1Enabled",
  /** Eşik (metre). NULL/0 = eşik girilmemiş → bayrak açık olsa da kural ateşlemez. */
  TAMBUR_SHORT_CUT_A1_THRESHOLD_M: "tambur.shortCutA1ThresholdM",
  /** Tablet Tambur açık kart listesi yalnız oturum istasyonunun işlerini göstersin mi
   *  (ister 2.8; iki tamburlu fabrika). Default FALSE = bugünkü tüm-tambur listesi. */
  TAMBUR_LIST_BY_STATION_ENABLED: "tambur.listByStationEnabled",
  /** Dokumasız (hizmet) fabrikada kurşun/tambur/brode makinesi duruş takibi (D4-A1, ister 5.5).
   *  Default FALSE = bugünkü (duruş yalnız dokumada). Okuma YALNIZ `machineStopRegime` (AST bekçisi). */
  MACHINE_STOP_TRACKING_ENABLED: "uretim.makineDurusTakibi",
  /** Açık duruşta tablet gramaj/metre dokunuşu uyarısı (D4-A2b, K2: uyarır, reddetmez; sunucu kapısı YOK).
   *  Default FALSE = sahadaki davranış (uyarı yok). */
  MACHINE_STOP_OPEN_WARNING_ENABLED: "uretim.makineDurusAcikUyarisi",
  /**
   * Tambur plan-sapma kapısının EN kolu (D4-E1, 1e kararı K9 2026-10-29): eşik (cm)
   * ve kontrol (ENFORCE | OFF). Eskiden `TAMBUR_PLAN_WIDTH_TOLERANCE_CM` kod sabitiydi;
   * okuma YALNIZ `effectiveTamburPlanWidthGate` üzerinden (AST bekçisi). `0` GEÇERLİ —
   * "her farkta sor"; null yazımı varsayılana (10) döner. OFF yalnız en kolunu atlar.
   */
  TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM: "tambur.planGate.widthToleranceCm",
  TAMBUR_PLAN_GATE_WIDTH_CHECK: "tambur.planGate.widthCheck",
  /**
   * Tambur finalize çocuk topun en kaynağı (D4-E3): WO_TARGET_FIRST (bugünkü: iş emri eni,
   * yoksa ana top) | MEASURED_FIRST (ana topun ÖLÇÜLMÜŞ eni — D4-E2a izi — varsa o).
   * Okuma YALNIZ `readTamburChildWidthSource` üzerinden.
   */
  TAMBUR_CHILD_WIDTH_SOURCE: "tambur.childWidthSource",
  /**
   * Tambur etiket basım zamanı (Gülkesim S5, cevap 10): EACH (bugünkü: her top kesilince
   * basılır) | END (iş bitince "Basılmayanları bas" ile toplu). İstemcide uygulanır.
   * Okuma YALNIZ `readTamburLabelPrintTiming` üzerinden.
   */
  TAMBUR_LABEL_PRINT_TIMING: "tambur.labelPrintTiming",
  /**
   * FASON KABULÜ — ÇEKME UYARISI (2026-08-21).
   * Boyahanede kumaş çeker: 250 m giden mal 220 m döner. Eski ekran bu farkı
   * "EKSİK DÖNEN / giden-gelen uyuşmuyor" diye KIRMIZI bir onay modalıyla
   * karşılıyordu ve operatör normal bir üretim gerçeğini hata sanıp metrajı
   * top top kurcalayarak kısmi kabule düşüyordu (saha vakası). Bayrak AÇIKKEN
   * uyarı yalnız EŞİĞİN ÜSTÜNDEKİ farkta çıkar; kapalıyken hiç çıkmaz.
   * Backend ENFORCE ETMEZ — kural sunum katmanındadır (eşiğin altındaki fark da
   * deftere aynen yazılır); ikinci bir kural kurmak çift kaynak olurdu.
   */
  FASON_SHRINK_WARN_ENABLED: "fason.shrinkWarnEnabled",
  /** Dış brode kabulünde iş emrinin hedef çeşit değeri (desen) doğan topa yazılsın mı (D4-D3, K8).
   *  Default FALSE = bugünkü davranış (kabul yalnız bayrağı kopyalar). */
  FASON_RECEIPT_APPLY_TARGET_VARIANT: "fason.receiptApplyTargetVariant",
  /**
   * Tolerans — YÜZDE (giden metrajın yüzdesi). Kayıt yoksa varsayılan %10.
   * `0` GEÇERLİ bir değerdir ve "tolerans yok, her fark uyarır" demektir
   * (eski davranış); bu yüzden okuma tarafı `<= 0 → null` kalıbını KULLANMAZ —
   * o kalıp burada "temizlendi" ile "sıfır tolerans"ı aynı yere düşürürdü.
   */
  FASON_SHRINK_TOLERANCE_PCT: "fason.shrinkTolerancePct",
  /** F6: fason sevkin beklenen dönüşü için genel gün sayısı (firma > süreç türü > bu ayar). Kayıt yok / 0 = termin
   *  YOK (bugünkü davranış). Okuma YALNIZ `readFasonExpectedReturnDays` üzerinden. */
  FASON_EXPECTED_RETURN_DAYS: "fason.expectedReturnDays",
  /**
   * DEMO KURULUMU MU? (default FALSE)
   *
   * Bir TERCİH değil, bir REJİM anahtarıdır (`finance.enabled` emsali): açıkken
   * `/api/demo/*` altındaki senaryo üreticileri açılır ve panelde "DEMO" rozeti
   * çizilir. Kapalıyken o uçlar 403 döner — yani sürüm paketine sızan bir demo
   * yardımcısı sahada KENDİLİĞİNDEN etkisizdir.
   *
   * ⚠️ NEDEN ENV DEĞİL: env ile açılan bir modu KAPATMAK sunucuya erişim ister.
   * Bu depo "unutulabilir elle adım" sınıfını üç kez mekanikleştirdi; karar
   * operatörün BEYANINA bağlanır, ortam tahminine değil.
   * ⚠️ OKUMA CACHE'SİZ: acil kapatma anahtarı — etkisi bir SONRAKİ istekte görünmeli.
   */
  DEMO_MODE_ENABLED: "demo.modeEnabled",
  /** Mükerrer paneli — bulanık ad eşleştirme açık mı (default TRUE). */
  DUPLICATES_FUZZY_ENABLED: "duplicates.fuzzyEnabled",
  /** Mükerrer paneli — bulanık ad benzerlik eşiği, YÜZDE (default 90, aralık 50-100). */
  DUPLICATES_FUZZY_THRESHOLD_PCT: "duplicates.fuzzyThresholdPct",
  /** Tambur "TÜMDEN geri al" yalnız AYNI FABRİKA GÜNÜ içinde yapılabilsin mi.
   *  Default FALSE (sınır yok) — bilinçli. Asıl koruma parçaların kendisindedir
   *  (çuvala okutulmuş / sevke girmiş / yeniden kesilmiş parça zaten reddedilir);
   *  sert bir süre sınırı, dün akşam yapılmış bir hatayı sabah düzeltmeyi imkânsız
   *  kılarak tam da düzeltilmek istenen türden yeni bir çıkmaz üretebilir.
   *  Emsal: `shipping.undoDispatchSameDayOnly`. TEK PARÇA iptali etkilenmez. */
  TAMBUR_UNDO_FULL_SAME_DAY_ONLY: "tambur.undoFullSameDayOnly",
  /** D4-B1: Tambur kesiminde SIMULATED metre kabul edilsin mi — satır yok = AÇIK (bugünkü davranış; artık SIMULATED damgalı). */
  TAMBUR_SIMULATED_METER_ENABLED: "tambur.simulatedMeterEnabled",
  /** D4-B1: Tambur kesim gövdesinde ölçüm kaynağı (`measure`) zorunlu mu — satır yok = KAPALI (eski APK göndermez). */
  TAMBUR_MEASURE_SOURCE_REQUIRED: "tambur.olcumKaynagiZorunlu",
  /** D4-B5k (B-3): süresi geçmiş kalibrasyonlu sayaçla ölçümde uyarı — satır yok = KAPALI (bugünkü davranış). */
  TAMBUR_CALIBRATION_CHECK: "tambur.kalibrasyonKontrolu",
  /** Kurşun bypass (kurşun istasyonuna tablet KOYULMAYAN fabrika düzeni) açık mı.
   *  Default FALSE (kapalı). Diğer flag'lerin çoğunun aksine backend ENFORCE eder,
   *  ama ENFORCE kapsamı DAR: yalnız YENİ ATAMA OLUŞTURMAYI kapılar (bayrak kapalıyken
   *  "kurşun dağıt" 400 döner). Zaten dağıtılmış iş emirleri bayrak sonradan kapansa da
   *  bypass rejiminde KALIR — iptal / son-adım tamamlama / Tambur kart okutma onayı
   *  çalışmaya devam eder. Gerekçe: rejim ATAMA SATIRINDA kalıcıdır (KursunBypassAssignment),
   *  ayarda değil; bayrağı kapatmak sahada yarım kalmış işi kilitleyemez (topların kurşun
   *  adımı fiziksel olarak yapılmış ama dijital karşılığı açık kalırdı). */
  KURSUN_BYPASS_ENABLED: "production.kursunBypassEnabled",
  /** H1 (Hizmet veren, 2026-10-29): kurşun metre ölçümü — `OFF` (bugün) · `OUT` · `IN_OUT`. Enum; kalıp `KURSUN_METER_CAPTURE_MODES`. */
  KURSUN_METER_CAPTURE: "kursun.meterCapture",
  /** H1: SIMULATED kaynaklı metre okuması kabul edilsin mi — varsayılan KAPALI (400). */
  KURSUN_SIMULATED_METER_ENABLED: "kursun.simulatedMeterEnabled",
  /** H2: sapma eşiği (metre) — boş/0 = eşik yok. Eşik = max(M, %P × taban); ikisi de boşsa sapma YOK (bugün). */
  KURSUN_METER_VARIANCE_THRESHOLD_M: "kursun.meterVarianceThresholdM",
  /** H2: sapma eşiği (yüzde) — boş/0 = eşik yok. */
  KURSUN_METER_VARIANCE_THRESHOLD_PCT: "kursun.meterVarianceThresholdPct",
  /** H2: sapma tabanı — `DECLARED_IN` (bugün) · `MEASURED_IN`. */
  KURSUN_METER_VARIANCE_BASIS: "kursun.meterVarianceBasis",
  /** H2: sapma onayı — `NONE` (bugün; işaret kalır) · `OPERATOR_REASON` · `SUPERVISOR_PIN` · `OFFICE`. */
  KURSUN_METER_VARIANCE_APPROVAL: "kursun.meterVarianceApproval",
  /** H1b: çıkış metresi stoğa uygulansın mı — `RECORD` (bugün; okuma stoğu değiştirmez) · `APPLY`. */
  KURSUN_METER_STOCK_MODE: "kursun.meterStockMode",
  /** K16 (Gülkesim 2026-11-03): atanan makine — `SUGGEST` (bugün; yalnız öneri) · `ASSIGNED_ONLY_WARN` (liste süzülür, başka makine uyarıyla alır). */
  KURSUN_MACHINE_ASSIGN_MODE: "kursun.machineAssignMode",
  /** K29 (Gülkesim 2026-11-03): rota uygulaması — `SEQUENTIAL` (bugün; plandaki sırayla) · `SCAN` (okutmaya göre, esnek). */
  PRODUCTION_ROUTE_MODE: "production.routeMode",
  /** K29: okutmayla rota hangi istasyonlarda — `SELECTED` (istasyon kartındaki "Okutunca adım eklenebilir") · `ALL`. */
  PRODUCTION_SCAN_ROUTE_STATIONS: "production.scanRouteStations",
  /** D4-F1: okutmada iç barkod bulunamazsa topun aktif MÜŞTERİ KODUNA da bakılsın mı (varsayılan KAPALI = bugün). */
  SCAN_CUSTOMER_CODE_LOOKUP: "scan.customerCodeLookup",
  /** Parti no KISA ve DÖNEN mi olsun (P01…P99, 99'dan sonra P01)? Default TRUE/AÇIK.
   *  Backend ENFORCE eder (`batch.service.generateBatchNumberTx`). Kapalıyken eski
   *  `P + GGAAYY + sıra` günlük kalıbına düşülür — birebir eski davranış.
   *  ⚠️ Açıkken parti no BENZERSİZ DEĞİLDİR: numara birkaç günde bir yeniden
   *  kullanılır (2026-08-05 kullanıcı kararı — numaralı fiziksel parti plakası).
   *  Bu yüzden `batches.batchNumber` üzerindeki `@unique` kaldırıldı; kimlik `Batch.id`. */
  BATCH_SHORT_NUMBER_ENABLED: "batch.shortNumberEnabled",
  /** İş emri formunda "Son Kullanılan Parti No" rozeti görünsün mü? Default TRUE.
   *  Yalnız GÖSTERİM — hiçbir numara üretimini etkilemez. Kapatma gerekçesi:
   *  rozet SON KULLANILANI yazar, sıradakini VAAT ETMEZ; fabrika bunu yanlış
   *  okuyup "sıradaki numara bu" sanarsa tek kapatma yolu budur. */
  BATCH_LAST_NUMBER_HINT_ENABLED: "batch.lastNumberHintEnabled",
  /** Oturum (JWT token) ömrü, SAAT. Default 8. Giriş yaptıktan sonra token kaç saat
   *  geçerli kalır — süre dolunca (aktif kullanırken bile) yeniden giriş gerekir.
   *  Backend ENFORCE eder: login'de jwt.sign expiresIn buradan okunur. Değişiklik
   *  yalnız sonraki girişlere uygulanır; mevcut açık token'lar kendi süreleriyle biter. */
  AUTH_SESSION_DURATION_HOURS: "auth.sessionDurationHours",
  /** Oturum (JWT token) ömrü, DAKİKA. Default 480 (8 saat). Yeni dakika-granüler ayar —
   *  Genel Ayarlar → Oturum ekranı artık her süreyi DAKİKA olarak yönetir. Backend ENFORCE
   *  eder: login'de jwt.sign expiresIn buradan (×60 sn) okunur. Kayıt yoksa eski
   *  auth.sessionDurationHours ×60'a düşer (geriye-uyum), o da yoksa 480 (8 saat). 1..43200
   *  (30 gün). Değişiklik yalnız sonraki girişlere uygulanır; açık token'lar kendi süreleriyle biter. */
  AUTH_SESSION_DURATION_MINUTES: "auth.sessionDurationMinutes",
  /** Hareketsizlik (idle) zaman aşımı, DAKİKA. Default 0 (kapalı). >0 iken Electron
   *  paneli bu kadar dakika hiç işlem (fare/klavye) görmezse otomatik çıkış yapar.
   *  Frontend ENFORCE eder (backend token'ı yine kendi mutlak ömrüne kadar geçerli). */
  AUTH_IDLE_TIMEOUT_MINUTES: "auth.idleTimeoutMinutes",
  /** Çalışma oturumu (WorkSession — kim hangi makinede) hareketsizlik zaman aşımı,
   *  DAKİKA. Default 600 (10 saat: vardiya boyu molalarda düşmez, gece açık unutulan
   *  tablet sabaha temiz oturumla başlar). 0 = kapalı. Backend TEMBEL enforce eder:
   *  timer YOK — aktif oturum okunurken lastActivityAt bu süreden eskiyse IDLE ile
   *  kapatılır (work-session.helper). auth.idleTimeoutMinutes'ten (ekran kilidi) AYRI. */
  WORK_SESSION_IDLE_TIMEOUT_MINUTES: "workSession.idleTimeoutMinutes",
  /** ESKİ mobil giriş yöntemi ("pin"|"card") — AUTH_LOGIN_METHODS'a evrildi; yalnız
   *  geriye-uyum okuma için tutulur (yeni key yoksa buradan türetilir). Yazılmaz. */
  AUTH_LOGIN_MODE: "auth.loginMode",
  /** Mobil giriş yöntemleri (JSON): { enabled: ("list"|"pin"|"card")[], primary }.
   *  list = kullanıcı listesi + şifre/PIN (klasik); pin = SALT hızlı-PIN (kullanıcı
   *  seçme yok — users.quickPin benzersiz); card = QR personel kartı. En az bir
   *  yöntem etkin, primary etkinlerden biri. Login ekranı primary ile açılır;
   *  diğer etkin yöntemler "Diğer giriş yöntemleri"nde sunulur. Backend ENFORCE:
   *  login-card yalnız card, login-quick-pin yalnız pin etkinken çalışır
   *  (klasik /auth/login HEP açık — Electron paneli + acil kapı). */
  AUTH_LOGIN_METHODS: "auth.loginMethods",
  /** Saha #6: top etiketi kaç kopya basılır (default 2 — topun bir üstüne bir
   *  altına yapıştırılıyor). /labels/rolls/:id/html bu kadar sayfa döner;
   *  çağıran ?copies= ile tek baskı için override edebilir. 1-5 arası. */
  LABEL_COPIES: "label.copies",
  /** Akış etiketinin (top/kartela/çuval) adedini kim belirler: `GLOBAL` = `label.copies`
   *  (istemcinin sayısı yok sayılır — bugünkü fiili davranış); `STATION` = baskı anında
   *  istek, yoksa istasyonun `defaultLabelCopies`i, o da yoksa `label.copies`.
   *  Çözücü TEK: `services/helpers/label-copies.helper.ts`. */
  LABEL_COPIES_SOURCE: "label.copiesSource",
  /** D4-F3: müşteri barkodu basan şablonda top kodsuzsa — BLOCK (400) | ROLL_BARCODE (iç barkod + uyarı). */
  LABEL_CUSTOMER_CODE_MISSING: "label.customerCodeMissing",
  /** D4-F2: müşteri kodunun doğduğu yer — NONE (doğmaz) | TAMBUR_OUTPUT (Tambur çıkışında seriden). */
  LABEL_CUSTOMER_CODE_AT: "label.customerCodeAt",
  /** Sistem VARSAYILAN etiket medyası (Etiket Stüdyosu v2 — "Boyutlar" kataloğu
   *  emekli). Cihazsız baskı/önizleme/kartela bu boyutu kullanır. JSON:
   *  { widthMm, heightMm, dpi, gapMm, marginMm }. */
  LABEL_DEFAULT_MEDIA: "label.defaultMedia",
  /** Varsayılan etiket yazıcı dili — top etiketi native render'ı bu dilde üretilir
   *  (default PPLA). Bir yazıcı modeli kendi dilini belirtirse (Argox=PPLA, Zebra=ZPL)
   *  o istasyonda model dili ÖNCELİKLİDİR; bu global ayar model bağlamı çözülemeyen
   *  baskılar için (Electron/varsayılan) ve genel varsayılan olarak kullanılır. */
  /** Faz-2 opt-in: native etiket komutları (PPLA/ZPL) backend RAW TCP (9100) ile
   *  yazıcıya DOĞRUDAN gönderilsin mi (default false = Faz-1 simülasyon). Açıkken
   *  ENFORCE — printer-transport gerçek socket açar; kapalıyken hiç socket yok. */
  LABEL_NATIVE_SEND_ENABLED: "label.nativeSendEnabled",
  /** Mobil (HC-06/BT-SPP) baskıda raster (1bpp GW bitmap) gönderilsin mi. Default false =
   *  mobil komut yolunda kalır (hızlı, güvenli). Açıkken mobil `encoding=b64` ile raster
   *  ister → WYSIWYG ama ~40KB binary HC-06'dan gider (yavaş olabilir). Client (mobil) ENFORCE.
   *  Electron raster'ından (PeripheralDevice.rasterMode) BAĞIMSIZ — sahada yavaşsa kapatılır. */
  LABEL_MOBILE_RASTER_ENABLED: "label.mobileRasterEnabled",
  /** "Etiketsiz" işaretli kalitelerde (`QualityGrade.skipLabel` — sahada FİRE) top
   *  üretilirken OTOMATİK etiket basılsın mı. Default FALSE = fire topa kâğıt ÇIKMAZ.
   *
   *  ⚠️ İki kapı birlikte okunur: kalite işareti (hangi kalite) + bu ayar (kural açık
   *  mı). Kural KALİTEDE tanımlı: etiket politikası dispozisyondan AYRI bir karardır.
   *  (Tasarım anında ayrıca ZORUNLUYDU — FİRE o gün WAREHOUSE'a iniyordu ve statüye
   *  bağlı bir kural sahada hiç tetiklenmezdi; FIRE→SCRAP aynı gün düzeltildi.)
   *
   *  Client (mobil) ENFORCE eder: otomatik baskı hiç tetiklenmez ve operatöre
   *  "Fire top — etiket basılmadı" bilgisi verilir (sessiz atlama, "yazıcı bozuk"
   *  diye okunur). ELLE "Etiket" baskısı kapatılmaz — onay sorulup basılır: fire
   *  topun fiziksel tanımlanması gerekebilir ve baskı yolunu tamamen kapatmak
   *  sahayı çıkışsız bırakır. */
  LABEL_SCRAP_GRADE_ENABLED: "label.scrapGradeLabelEnabled",
  /** Aynı cihaz-tipinden (electron/mobil) ikinci giriş olunca ne yapılsın:
   *  'kick' (default — eskiyi düşür, yeni kazanır) | 'notify' (kullanıcıya sor,
   *  confirmKick ile ikisi de açık kalır) | 'off' (serbest, çoklu oturum). 1 Electron +
   *  1 mobil HER ZAMAN serbest (politika yalnız AYNI tip 2. girişe uygulanır). Backend
   *  ENFORCE eder (login → SessionRegistryService.openLoginSession). */
  AUTH_SAME_TYPE_SESSION_POLICY: "auth.sameTypeSessionPolicy",
  /** Token süresi dolunca istemci otomatik çıkış yapsın mı. Default true (açık).
   *  Client ENFORCE eder (mobil + Electron JWT exp decode → timer). Kapalıyken süre
   *  dolsa da istemci kendiliğinden çıkmaz (bir sonraki istek 401 alana kadar açık kalır). */
  AUTH_AUTO_LOGOUT_ON_EXPIRY: "auth.autoLogoutOnExpiry",
  /** Mobil hareketsizlik (idle) ekran kilidi açık mı. Default true. Açıkken tablet bu
   *  kadar dakika (mobileIdleLockMinutes) dokunulmazsa kilit ekranı gelir (work session
   *  AÇIK kalır; kart/PIN ile açılır). Client (mobil) ENFORCE eder. */
  AUTH_MOBILE_IDLE_LOCK_ENABLED: "auth.mobileIdleLockEnabled",
  /** Mobil idle kilit süresi, DAKİKA (1..120). Default 10. Client (mobil) ENFORCE eder. */
  AUTH_MOBILE_IDLE_LOCK_MINUTES: "auth.mobileIdleLockMinutes",
  /** Mobil "uygulama arka plana geçince ANINDA kilitle" açık mı. Default true. Idle
   *  kilitten BAĞIMSIZ — operatör uygulamadan çıkınca (home/başka app) hemen kilit
   *  ekranı gelir (work session AÇIK kalır; kart/PIN ile açılır). Client (mobil) ENFORCE. */
  AUTH_MOBILE_LOCK_ON_BACKGROUND: "auth.mobileLockOnBackground",
  AUTH_MOBILE_OFFLINE_LOCK_DEFER: "auth.mobileOfflineLockDefer",
  /** Masaüstü/web giriş ekranı son kullanıcıyı hatırlasın mı. Default false. Client (panel) ENFORCE; sistem hesabı hiç hatırlanmaz. */
  AUTH_REMEMBER_LAST_USER: "auth.rememberLastUser",
  /** Mutlak oturum tavanı, GÜN. Default 30 (0..365). Zaman aşımı KAPALI iken bile
   *  token en fazla bu kadar gün geçerli olur (sızan token sonsuza kadar yaşamasın).
   *  0 = sert tavan (30 gün, kapatılamaz) — exp'siz token üretilmez. Backend ENFORCE eder (issueToken). */
  AUTH_ABSOLUTE_SESSION_CAP_DAYS: "auth.absoluteSessionCapDays",
  /** Hızlı-PIN + kart giriş deneme kilidi açık mı. Default true. Kapalıyken deneme
   *  kilidi hiç uygulanmaz. Backend ENFORCE eder (login-lockout middleware). */
  AUTH_PIN_LOCKOUT_ENABLED: "auth.pinLockoutEnabled",
  /** Kilit tetiklenene kadar izin verilen ardışık yanlış deneme sayısı. Default 5 (1..20). */
  AUTH_PIN_LOCKOUT_ATTEMPTS: "auth.pinLockoutAttempts",
  /** Kısa ceza süresi, SANİYE. Default 60 (5..3600). Eşik aşılınca bu kadar saniye bloklanır. */
  AUTH_PIN_LOCKOUT_PENALTY_SEC: "auth.pinLockoutPenaltySec",
  /** Kaç ceza turundan sonra UZUN cezaya geçilir. Default 3 (1..20). */
  AUTH_PIN_LOCKOUT_ESCALATE_AFTER: "auth.pinLockoutEscalateAfter",
  /** Uzun ceza süresi, DAKİKA. Default 15 (1..1440). Escalate eşiğine varınca uygulanır. */
  AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN: "auth.pinLockoutLongPenaltyMin",
  /** Otomatik gece yedeğinin saati (0-23, yerel). Default 3. Backend ENFORCE eder —
   *  backup-scheduler her kontrol turunda (15dk) okur, yani admin saati değiştirince
   *  pm2 restart GEREKMEZ. Kayıt yoksa BACKUP_HOUR env'i, o da yoksa 3 kullanılır.
   *  Yedek klasörü/offsite yolu bilinçli olarak burada DEĞİL (ops config → env). */
  BACKUP_HOUR: "backup.hour",
  /** Offsite uzak hedef, rclone sözdiziminde (`gdrive:tekserp-yedek`). Panelden
   *  ayarlanır, pm2 restart GEREKMEZ. Kayıt yoksa `BACKUP_RCLONE_REMOTE` env'i. */
  BACKUP_OFFSITE_REMOTE: "backup.offsiteRemote",
  /** Offsite YEREL ikinci hedef (ağ paylaşımı / ikinci disk). Kayıt yoksa
   *  `BACKUP_OFFSITE_DIR` env'i. Uzak hedeften BAĞIMSIZ — ikisi birlikte
   *  kullanılabilir (3-2-1 kuralı: iki ortam + bir offsite). */
  BACKUP_OFFSITE_DIR: "backup.offsiteDir",
  /** Audit ARŞİVİNİN saklama süresi, YIL (0..50; 0 = budama yok). Default 3. Gece
   *  bakım işi okur; bu yaştan eski `system_log_archives` satırları budanır. */
  AUDIT_ARCHIVE_RETENTION_YEARS: "audit.archiveRetentionYears",
  /** Yazdırma geçmişinin (`print_jobs`) saklama süresi, GÜN (0..3650; 0 = budama yok). Default 180.
   *  Gece bakım işi okur; bu yaştan eski satırlar budanır (telemetri, K-A1). */
  PRINT_LOG_RETENTION_DAYS: "printLog.retentionDays",
  /** Semantik rapor bloğunun sorgu tavanı, SANİYE (5..45; DB seviyesi 50 sn'nin altında). Default 15.
   *  Davranış bayrağı değil, işletme ayarı: tek okuyucusu `reports/semantik/calistirici.ts`. */
  REPORTS_STATEMENT_TIMEOUT_SEC: "reports.statementTimeoutSec",
  /** İstek başlığının (`request_traces`) saklama süresi, GÜN (0..3650; 0 = budama yok). Default 90.
   *  Gece bakım işi okur; bu yaştan eski satırlar budanır (telemetri, K-B1). */
  REQUEST_TRACE_RETENTION_DAYS: "requestTrace.retentionDays",
  /** Bu KURULUMUN kalıcı kimliği (uuid v4). İlk açılışta bir kez üretilir
   *  (`jobs/installation-identity.job.ts`) ve bir daha ASLA değişmez.
   *
   *  ⚠️ Bu bir FEATURE FLAG DEĞİLDİR — `FeatureFlags` arayüzüne, `updateSchema`'ya
   *  ve Electron ayar paneline BİLEREK girmez. Ayarlanabilir bir tercih değil,
   *  makinenin kimliği; panelden değiştirilebilir olsaydı istemcilerin "bu, bağlandığım
   *  sunucu mu" kontrolü tek tıkla geçersizleşirdi. Bu yüzden dört kapı ceremonisi
   *  buraya uygulanmaz ve `test_feature_flag_contract` bunu görmez (görmemeli).
   *
   *  ⚠️ SIR DEĞİLDİR: aynı LAN'daki herkes `/api/discovery/identity` ile okuyabilir.
   *  İşi kimlik DOĞRULAMAK değil, FARKLI BİR KURULUMU TESPİT etmek. Gerçek yetki
   *  kontrolü JWT'dir. */
  SYSTEM_INSTALLATION_ID: "system.installationId",
  /** Patron bulutu olay güdümlü tur (default false = yalnız kira aralığında tur). */
  PATRON_BULUT_OLAY_GUDUMLU: "patronBulut.olayGudumluEnabled",
  // bildirim: gelen kutusu davranış bayrağı (modül anahtarı DEĞİL — plan Karar Y1); default false.
  BILDIRIM_GELEN_KUTUSU_ENABLED: "bildirim.gelenKutusuEnabled",
  // belge-sablon T1C: davranış bayrakları (modül DEĞİL, profile girmez); ikisi de default false.
  DOCUMENTS_DESIGNER_ENABLED: "documents.designerEnabled",
  DOCUMENTS_PUBLISH_SOD_ENABLED: "documents.publishSodEnabled",
  /** Menü düzeni (K19): menüden gizlenen ekran anahtarları (JSON dizi). Tek yazar `PUT /api/menu-layout`; flag yükünde DÖNMEZ. */
  UI_MENU_HIDDEN_SCREENS: "ui.menuHiddenScreens",
  /** Menü düzeni (K19): teknik ekranlar kenar menüde "Gelişmiş" grubunda (varsayılan false = bugünkü yerleri). */
  UI_MENU_ADVANCED_GROUP: "ui.menuAdvancedGroup",
} as const;
