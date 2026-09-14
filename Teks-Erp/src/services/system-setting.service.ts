// =============================================================================
// TeksERP - System Setting Service
// =============================================================================
// Runtime'da güncellenebilir konfigürasyon (key-value).
// =============================================================================

import { createHash } from "crypto";
import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT,
  DUPLICATES_FUZZY_MIN_PCT,
} from "../constants/duplicate-rules";
// ⚠️ TEK YÖNLÜ BAĞIMLILIK: `constants/module-flags.ts` bu servisi IMPORT ETMEZ
// (DB anahtarları orada düz string). Ters yön dairesel bağımlılık kurar ve
// modül init sırasına göre `undefined` bir Set üretirdi — kapı sessizce açılır.
import {
  MODULE_DEPENDENCIES,
  MODULE_LABELS,
} from "../constants/module-flags";
import {
  sanitizeBlankGrid,
  sanitizeDocFields,
  sanitizeDocStyleConfig,
  type BlankGridConfig,
  type DocFieldStyle,
  type DocStyleConfig,
} from "./document-render/doc-style";
import { SECURITY_SETTING_PREFIX } from "../constants/reserved-settings";
import { resolveConfigPageSize } from "./document-render/traveler-card.density";
import {
  sanitizeTravelerFields,
  TRAVELER_FIELD_SIZE_MAX,
  TRAVELER_FIELD_SIZE_MIN,
  type TravelerFieldStyle,
} from "./document-render/traveler-card.fields";
import { resolveSectionOrder, type TravelerSection } from "./document-render/traveler-card.sections";

/**
 * SystemSetting.value bir JsonValue. Reader yardımcıları: gelen değer
 * hangi tipte olursa olsun beklenen tipe çevirmeye çalışır (backward
 * compatible — eski string-encoded değerleri de okur).
 */
function asNumber(value: Prisma.JsonValue | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: Prisma.JsonValue | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}

const TABLE = "SYSTEM_SETTING";

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
  /** Sevk onayında otomatik satış faturası TASLAĞI üret (default FALSE).
   *  ⚠️ Üretilen şey TASLAKTIR (`InvoiceStatus.DRAFT`) — onay HER ZAMAN elle
   *  kalır; bayrak "fatura kes" değil "veri girişini bir kez daha yazdırma"
   *  demektir. `financeEnabled` KAPALIYKEN bu bayrak açık olsa bile kanca
   *  no-op'tur (modül şalteri üstte). Taslak üretimi başarısız olursa sevk
   *  DÜŞMEZ — sevk operasyonu muhasebe kancasına rehin edilmez. */
  FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED: "finance.autoDraftFromShipmentEnabled",
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
  /** Dokuma tezgah izleme modülü. YER TUTUCU — arkasında henüz yüzey YOK.
   *  ÜRETİME BAĞIMLI (`MODULE_DEPENDENCIES`): üretim kapalıyken izlenecek iş
   *  emri yoktur. */
  TEZGAH_ENABLED: "tezgah.enabled",
  /** Devere / levent modülü: çözgü kartı · levent stoğu · levent olay defteri.
   *  ⚠️ İPLİĞE BAĞIMLI (`MODULE_DEPENDENCIES`), o da ticarete: levent doğarken
   *  iplik kg defterine çıkış yazılır (`WARP_ISSUE`). Zincir OKUMA kapısında
   *  ELLE ölçülür (`requireDevereEnabled`), tablo geçişli kapanış üretmez. */
  DEVERE_ENABLED: "devere.enabled",
  /** [PROFİL] Devere Faz 2: içeride sarımda iplik çıkış satırı ve mal kabul iplik satırı LOT
   *  ZORUNLU mu. DEFAULT false = bugünkü davranış (lot kaydı bayraksız her kurulumda mümkün,
   *  lotsuz satır yalnız UYARI). Davranış bayrağı — profile/modül tablosuna GİRMEZ. */
  DEVERE_LOT_REQUIRED: "devere.lotRequired",
  /** Dokuma işi modülü: dokuma işi planlama · tezgah koşumu · top indirme.
   *  ÜRETİME BAĞIMLI (`MODULE_DEPENDENCIES`), tezgah izlemenin KARDEŞİ — fasona
   *  dokutan firmada dokuma işi var tezgah yok (DOKUMA-IS-EMRI §2.5). */
  DOKUMA_ENABLED: "dokuma.enabled",
  /** İş emrinde "hedef metraj" alanı gösterilsin mi. Default false (proses-only fabrika). */
  WORKORDER_TARGET_QUANTITY_ENABLED: "workorder.targetQuantityEnabled",
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
  /** Sevk için ayrı onay adımı zorunlu mu. Default false (KAPALI): çuvalları seç → Sevk Et
   *  → DOĞRUDAN sevk edilir (DISPATCHED). AÇIKKEN: Sevk Et yalnız PLANNED sevkiyat kurar;
   *  çıkış ayrıca "Sevk Kapısı" ekranından dispatch edilir. */
  SHIPMENT_CONFIRMATION_ENABLED: "shipping.confirmationEnabled",
  SHIPMENT_MANUAL_SACK_COUNT_ENABLED: "shipping.manualSackCountEnabled",
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
  /** Tahsiste EN toleransı açık mı (default false = tam eşitlik, bugünkü davranış). */
  SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED: "shipping.allocWidthToleranceEnabled",
  /** Tolerans değeri (cm). Yalnız yukarıdaki bayrak açıkken uygulanır. */
  SHIPPING_ALLOC_WIDTH_TOLERANCE_CM: "shipping.allocWidthToleranceCm",
  /** Tahsis sipariş miktarını AŞABİLİR mi (fazla sevk deftere yazılsın mı). Default false. */
  SHIPPING_ALLOW_OVER_ALLOCATION: "shipping.allowOverAllocation",
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
  /** Belge künyesi: irsaliye/çeki başına basılan firma adresi/telefon/vergi bilgisi.
   *  Firma adı ayrı (COMPANY_NAME); burada sadece ek künye satırları. */
  COMPANY_LETTERHEAD: "company.letterhead",
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
  /**
   * Tolerans — YÜZDE (giden metrajın yüzdesi). Kayıt yoksa varsayılan %10.
   * `0` GEÇERLİ bir değerdir ve "tolerans yok, her fark uyarır" demektir
   * (eski davranış); bu yüzden okuma tarafı `<= 0 → null` kalıbını KULLANMAZ —
   * o kalıp burada "temizlendi" ile "sıfır tolerans"ı aynı yere düşürürdü.
   */
  FASON_SHRINK_TOLERANCE_PCT: "fason.shrinkTolerancePct",
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
  /** Kurşun bypass (kurşun istasyonuna tablet KOYULMAYAN fabrika düzeni) açık mı.
   *  Default FALSE (kapalı). Diğer flag'lerin çoğunun aksine backend ENFORCE eder,
   *  ama ENFORCE kapsamı DAR: yalnız YENİ ATAMA OLUŞTURMAYI kapılar (bayrak kapalıyken
   *  "kurşun dağıt" 400 döner). Zaten dağıtılmış iş emirleri bayrak sonradan kapansa da
   *  bypass rejiminde KALIR — iptal / son-adım tamamlama / Tambur kart okutma onayı
   *  çalışmaya devam eder. Gerekçe: rejim ATAMA SATIRINDA kalıcıdır (KursunBypassAssignment),
   *  ayarda değil; bayrağı kapatmak sahada yarım kalmış işi kilitleyemez (topların kurşun
   *  adımı fiziksel olarak yapılmış ama dijital karşılığı açık kalırdı). */
  KURSUN_BYPASS_ENABLED: "production.kursunBypassEnabled",
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
  /** Mutlak oturum tavanı, GÜN. Default 30 (0..365). Zaman aşımı KAPALI iken bile
   *  token en fazla bu kadar gün geçerli olur (sızan token sonsuza kadar yaşamasın).
   *  0 = gerçekten süresiz (exp claim'i yok). Backend ENFORCE eder (issueToken). */
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
} as const;

const DEFAULT_DEADLINE_DAYS = 7;

/** Oturum (JWT) ömrü varsayılanı — saat. Eski sabit "8h" davranışıyla aynı. */
export const DEFAULT_SESSION_DURATION_HOURS = 8;
/** Mutlak oturum ömrü tavanı — saat (30 gün). Üstü bu değere kırpılır. */
const MAX_SESSION_DURATION_HOURS = 720;
/** Oturum (JWT) ömrü varsayılanı — DAKİKA (8 saat). Dakika-granüler yeni ayarın default'u. */
export const DEFAULT_SESSION_DURATION_MINUTES = 480;
/** Mutlak oturum ömrü tavanı — DAKİKA (30 gün = 43200). Üstü bu değere kırpılır. */
const MAX_SESSION_DURATION_MINUTES = 43200;
/** Hareketsizlik zaman aşımı varsayılanı — dakika. 0 = kapalı (otomatik çıkış yok). */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 0;
/** Hareketsizlik zaman aşımı tavanı — dakika (24 saat). */
const MAX_IDLE_TIMEOUT_MINUTES = 1440;
/** Çalışma oturumu (WorkSession) idle varsayılanı — dakika. 0 = kapalı. Eski 600
 *  (10 saat) idi; saha kararı (2026-07-04): bir tablet bu kadar dakika hiç
 *  kullanılmazsa oturum kapanır ve makine boşa düşer → 20 dk daha uygun. */
export const DEFAULT_WORK_SESSION_IDLE_MINUTES = 20;
/** Çalışma oturumu idle tavanı — dakika (24 saat). */
const MAX_WORK_SESSION_IDLE_MINUTES = 1440;
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
const MIN_MOBILE_IDLE_LOCK_MINUTES = 1;
const MAX_MOBILE_IDLE_LOCK_MINUTES = 120;
/** Mobil arka-plan kilidi varsayılanı — açık (eski davranış: idle kilit açıkken
 *  arka plana geçince de kilitlenirdi; artık bağımsız bayrak, default korunur). */
export const DEFAULT_MOBILE_LOCK_ON_BACKGROUND = true;
/** Mutlak oturum tavanı (gün) varsayılanı + aralık. 0 = gerçekten süresiz (exp yok). */
export const DEFAULT_ABSOLUTE_SESSION_CAP_DAYS = 30;
const MAX_ABSOLUTE_SESSION_CAP_DAYS = 365;
/** Hızlı-PIN/kart deneme kilidi varsayılanları + aralıkları. */
export const DEFAULT_PIN_LOCKOUT_ENABLED = true;
/** Fatura satırı varsayılan KDV oranı (%). 20 = bugünkü hardcode'un birebir
 *  karşılığı — ayar satırı yoksa davranış bayt-bayt aynı kalır. Tam sayı
 *  DAYATILMAZ (kolon Decimal(5,2); küsuratlı oran temsil edilebilir). */
export const DEFAULT_FINANCE_VAT_RATE = 20;
const MIN_FINANCE_VAT_RATE = 0;
const MAX_FINANCE_VAT_RATE = 100;
/** Otomatik gece yedeği saati varsayılanı (yerel saat). Eski Görev Zamanlayıcı da 03:00'tü. */
export const DEFAULT_BACKUP_HOUR = 3;
const MIN_BACKUP_HOUR = 0;
const MAX_BACKUP_HOUR = 23;

export const DEFAULT_PIN_LOCKOUT_ATTEMPTS = 5;
const MIN_PIN_LOCKOUT_ATTEMPTS = 1;
const MAX_PIN_LOCKOUT_ATTEMPTS = 20;
export const DEFAULT_PIN_LOCKOUT_PENALTY_SEC = 60;
const MIN_PIN_LOCKOUT_PENALTY_SEC = 5;
const MAX_PIN_LOCKOUT_PENALTY_SEC = 3600;
export const DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER = 3;
const MIN_PIN_LOCKOUT_ESCALATE_AFTER = 1;
const MAX_PIN_LOCKOUT_ESCALATE_AFTER = 20;
export const DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN = 15;
const MIN_PIN_LOCKOUT_LONG_PENALTY_MIN = 1;
const MAX_PIN_LOCKOUT_LONG_PENALTY_MIN = 1440;
/** Mobil giriş yöntemleri. list=liste+şifre, pin=salt hızlı-PIN, card=QR kart. */
export type LoginMethod = "list" | "pin" | "card";
export interface LoginMethodsConfig {
  enabled: LoginMethod[];
  primary: LoginMethod;
}
export const LOGIN_METHODS: LoginMethod[] = ["list", "pin", "card"];
export const DEFAULT_LOGIN_METHODS: LoginMethodsConfig = { enabled: ["list"], primary: "list" };

/** Firma adı verilmediğinde gösterilen varsayılan. */
export const DEFAULT_COMPANY_NAME = "Adnan Şahin Tekstil";

/** Refakat kartı sayfa boyutu. */
export type TravelerCardPageSize = "A4" | "A5";

/** Refakat kartı kenar boşlukları (mm) — pay bırakmak için (ciltleme/delik zımbası). */
export interface TravelerCardMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Yazı kalınlığı — tüm font-weight'leri kaydırır (ince −100, kalın +100). */
export type TravelerCardFontWeight = "light" | "normal" | "bold";

/** Alan boyutu — sm/md/lg. ESKİ kademe; yeni kayıtlar `px` taşır (bkz. aşağı). */
export type TravelerCardFieldSize = "sm" | "md" | "lg";

/** Hücre kalınlığı — 2026-08-05'te `medium`/`black` eklendi (panel beş kademe). */
export type TravelerCardCellWeight = TravelerCardFontWeight | "medium" | "black";

/**
 * Tek tablo hücresi ayarı — göster + boyut + kalınlık (hücre-başına bağımsız).
 *
 * ⚠️ İKİ BOYUT ALANI VAR ve bu geçicidir DEĞİL, KALICIDIR:
 *   • `px` — 2026-08-05'te panel tek birime (sayısal punto) geçti; yeni kayıtlar
 *     bunu yazar ve renderer'da kademenin ÜSTÜNDE gelir.
 *   • `size` — eski kademe (sm/md/lg). SİLİNEMEZ: yıllar önce basılmış kartların
 *     donmuş snapshot'ları bu alanı taşıyor ve o belgeler aynen basılabilmeli.
 * Panel yalnız `px` gösterir; `size` okunur ama yazılmaz.
 */
export interface TravelerCardSpecField {
  show: boolean;
  size: TravelerCardFieldSize;
  weight: TravelerCardCellWeight;
  /** Sayısal punto (5–48). Verilmezse `size` kademesi, o da yoksa profil tabanı. */
  px?: number;
}

/** Spec grid alanları — her biri tek tek (göster/boyut/kalınlık). */
export interface TravelerCardSpecFields {
  color: TravelerCardSpecField;
  width: TravelerCardSpecField;
  targetQuantity: TravelerCardSpecField;
  targetWeight: TravelerCardSpecField;
  foldType: TravelerCardSpecField;
  startDate: TravelerCardSpecField;
  endDate: TravelerCardSpecField;
}

/** Bağlı siparişler tablosu sütunları — her biri tek tek (göster/boyut/kalınlık). */
export interface TravelerCardOrderFields {
  orderNumber: TravelerCardSpecField;
  customer: TravelerCardSpecField;
  item: TravelerCardSpecField;
  color: TravelerCardSpecField;
  quantity: TravelerCardSpecField;
}

/**
 * Partiler tablosu sütunları — her biri tek tek (göster/boyut/kalınlık).
 * İçerik baskı anında CANLI çözülür (parti kart donduktan SONRA doğar); burada
 * yalnız GÖRÜNÜM kararı yaşar. Bkz. `document-render/traveler-card.html`.
 */
export interface TravelerCardBatchFields {
  batchNumber: TravelerCardSpecField;
  rollCount: TravelerCardSpecField;
  quantity: TravelerCardSpecField;
  /** Partinin açık fason sevki (firma · irsaliye no) — mal dışarıdayken kartta görünür. */
  dispatch: TravelerCardSpecField;
}

const CELL_WEIGHTS = new Set<TravelerCardCellWeight>(["light", "medium", "bold", "black"]);

/** Ham değeri (boolean eski şekil | nesne | undefined) tam spec alanına çözer. */
export function coerceSpecField(v: unknown): TravelerCardSpecField {
  if (v === false) return { show: false, size: "md", weight: "normal" };
  if (v == null || v === true) return { show: true, size: "md", weight: "normal" };
  const f = v as Record<string, unknown>;
  // `px` sınırları alan kataloğuyla AYNI (5–48) — panel tek bir sınır gösteriyor,
  // iki farklı sınır tutmak kullanıcıya iki farklı kırpma davranışı yaşatırdı.
  const rawPx = typeof f.px === "number" ? f.px : Number(f.px);
  const px = Number.isFinite(rawPx)
    ? Number(Math.min(TRAVELER_FIELD_SIZE_MAX, Math.max(TRAVELER_FIELD_SIZE_MIN, rawPx)).toFixed(2))
    : undefined;
  return {
    show: f.show !== false,
    size: f.size === "sm" || f.size === "lg" ? f.size : "md",
    weight:
      typeof f.weight === "string" && CELL_WEIGHTS.has(f.weight as TravelerCardCellWeight)
        ? (f.weight as TravelerCardCellWeight)
        : "normal",
    ...(px != null ? { px } : {}),
  };
}

/** Refakat kartı marka/içerik ayarı. Snapshot'a dondurulur. */
export interface TravelerCardConfig {
  /** Kart başlığındaki firma adı. */
  companyName: string;
  /** Firma adının altında basılan adres satırı (boş → basılmaz). */
  addressLine: string;
  /** Firma adının altında basılan telefon (boş → basılmaz). */
  phone: string;
  /** Sayfa boyutu — A4 (standart) veya A5. */
  pageSize: TravelerCardPageSize;
  /** Kenar boşlukları (mm) — hangi kenardan ne kadar pay. */
  margins: TravelerCardMargins;
  /** Yazı boyutu ölçeği — tüm yazılar bununla çarpılır (0.7–1.4, default 1). */
  fontScale: number;
  /** Yazı kalınlığı — ince/normal/kalın. */
  fontWeight: TravelerCardFontWeight;
  /** Operasyon imza grid'i basılsın mı. */
  showOperationGrid: boolean;
  /** Talimatlar/Boyahane notu kutusu basılsın mı. */
  showNotes: boolean;
  /** Bağlı siparişler tablosu basılsın mı. */
  showOrders: boolean;
  /** Özellikler (ÖZELLİKLER) satırı basılsın mı. */
  showProperties: boolean;
  /** Spec grid alanları (Renk/En/Hedef Metraj/... tek tek). */
  specFields: TravelerCardSpecFields;
  /** Spec grid'de satır başına sütun sayısı (1–4, default 3). */
  specColumns: number;
  /** Bağlı siparişler tablosu sütunları (Sipariş No/Müşteri/Ürün/Renk/Miktar tek tek). */
  orderFields: TravelerCardOrderFields;
  /** Miktar toplamı satırı — göster/boyut/kalınlık (show=false → basılmaz). */
  orderTotal: TravelerCardSpecField;
  /** Partiler tablosu basılsın mı (parti yoksa zaten basılmaz). */
  showBatches: boolean;
  /** Partiler tablosu sütunları (Parti No/Top/Metraj/Sevk tek tek). */
  batchFields: TravelerCardBatchFields;
  /** Parti toplamı satırı — göster/boyut/kalınlık (show=false → basılmaz). */
  batchTotal: TravelerCardSpecField;
  /**
   * Bölüm SIRASI + açık/kapalı (Şablon Stüdyosu). Yoksa varsayılan sıra —
   * yerleşik kart. Tanınmayan anahtar atılır, eksik bölüm sona eklenir
   * (`document-render/traveler-card.sections.resolveSectionOrder`).
   */
  sections?: TravelerSection[];
  /**
   * ALAN BAZLI yazı ayarı — `key → { size?: px, weight? }`. Katalog + CSS üretimi
   * `document-render/traveler-card.fields.ts`'te; burada yalnız SAKLANIR.
   *
   * `specFields`/`orderFields`/`batchFields` ile ÇAKIŞMAZ, KATMANLIDIR: onlar
   * hücre-başına sm/lg kademesidir ve inline basıldıkları için CSS'i ezerler;
   * buradaki `specValue`/`orderCell`/`batchCell` o kademelerin TABANINI belirler
   * (renderer sm/lg'yi tabana oranlar). Diğer ~20 anahtar kartın hiçbir yerden
   * ayarlanamayan yazı yüzeylerine (firma adı, İŞ EMRİ NO, özet tablo etiketleri,
   * bölüm başlıkları, filigran…) karşılık gelir.
   *
   * ⚠️ Verilmemişse (`undefined`) renderer TEK BAYT ek CSS basmaz — ayara hiç
   * dokunulmamış kartın çıktısı bugünküyle birebir aynı kalır. Bu yüzden boş
   * nesne YAZILMAZ (`sanitizeTravelerFields` boşta `undefined` döner).
   */
  fields?: Record<string, TravelerFieldStyle>;
  /**
   * BOŞ GRID (2026-08-13 saha isteği) — kartın alt boşluğuna elle doldurulacak
   * tablo (kurşuncular kendi kayıtlarını buraya yazıyor).
   *
   * ⚠️ TİP BELGELERLE ORTAK (`doc-style.BlankGridConfig`) ve bu bilinçli: aynı
   * kavram için ikinci bir şekil, ikinci bir kayıt kapısı ve ikinci bir renderer
   * demekti — panelde "satır/sütun/genişlik" iki farklı biçimde sorulurdu.
   * Sanitize (`sanitizeBlankGrid`) ve çizim (`docBlankGridHtml/Css`) da AYNI.
   * Tek fark konum: belgede `position` çıpası var, kartta bölüm SIRASI belirler.
   *
   * ⚠️ VERİ TAŞIMAZ, kasten: hücreler boş basılır. Sisteme girmesi gereken bir
   * bilgiyi buraya yazdırmak onu aranamaz/raporlanamaz kılar.
   */
  blankGrid?: BlankGridConfig;
  /** Kart altına basılan serbest not (boş → basılmaz). */
  footerNote: string;
}

export const DEFAULT_TRAVELER_CARD_CONFIG: TravelerCardConfig = {
  companyName: "Adnan Şahin Tekstil",
  addressLine: "",
  phone: "",
  // Varsayılan A5: kart tek yaprak, malla birlikte gezen operasyon kâğıdıdır —
  // A4'e ihtiyaç duyan (çok adımlı rota + uzun sipariş listesi) kurulumlar
  // panelden/baskı diyaloğundan A4'e çeker. Sayfa boyutuna bağlı ölçüler:
  // `document-render/traveler-card.density.ts`.
  pageSize: "A5",
  margins: { top: 8, right: 8, bottom: 8, left: 8 },
  fontScale: 1,
  fontWeight: "normal",
  showOperationGrid: true,
  showNotes: true,
  showOrders: true,
  showProperties: true,
  specFields: {
    color: { show: true, size: "md", weight: "normal" },
    width: { show: true, size: "md", weight: "normal" },
    targetQuantity: { show: true, size: "md", weight: "normal" },
    targetWeight: { show: true, size: "md", weight: "normal" },
    foldType: { show: true, size: "md", weight: "normal" },
    startDate: { show: true, size: "md", weight: "normal" },
    endDate: { show: true, size: "md", weight: "normal" },
  },
  specColumns: 3,
  orderFields: {
    orderNumber: { show: true, size: "md", weight: "normal" },
    customer: { show: true, size: "md", weight: "normal" },
    item: { show: true, size: "md", weight: "normal" },
    color: { show: true, size: "md", weight: "normal" },
    quantity: { show: true, size: "md", weight: "normal" },
  },
  orderTotal: { show: true, size: "md", weight: "bold" },
  showBatches: true,
  batchFields: {
    batchNumber: { show: true, size: "md", weight: "normal" },
    rollCount: { show: true, size: "md", weight: "normal" },
    quantity: { show: true, size: "md", weight: "normal" },
    dispatch: { show: true, size: "md", weight: "normal" },
  },
  batchTotal: { show: true, size: "md", weight: "bold" },
  // Boş grid varsayılanda YOK (anahtar hiç yazılmaz) — belgelerdeki kuralın
  // aynısı: kartın bugünkü çıktısı bayt-bayt korunur, açan kurulum sütunlarını
  // kendi kurar.
  footerNote: "",
};

/** Ham objeyi (kaydet girişi / saklanan değer) tam + güvenli TravelerCardConfig'e çözer.
 *  Kaydet ve oku yolları paylaşır → drift yok. Eksik alan → default açık/değer. */
export function normalizeTravelerCardConfig(o: Record<string, unknown>): TravelerCardConfig {
  const D = DEFAULT_TRAVELER_CARD_CONFIG;
  const mm = (v: unknown, def: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(40, Math.max(0, Math.round(n))) : def;
  };
  const m = (o.margins && typeof o.margins === "object" ? o.margins : {}) as Record<string, unknown>;
  const sf = (o.specFields && typeof o.specFields === "object" ? o.specFields : {}) as Record<string, unknown>;
  const of = (o.orderFields && typeof o.orderFields === "object" ? o.orderFields : {}) as Record<string, unknown>;
  const bf = (o.batchFields && typeof o.batchFields === "object" ? o.batchFields : {}) as Record<string, unknown>;
  return {
    companyName:
      typeof o.companyName === "string" && o.companyName.trim()
        ? o.companyName.trim().slice(0, 120)
        : D.companyName,
    addressLine: typeof o.addressLine === "string" ? o.addressLine.trim().slice(0, 200) : "",
    phone: typeof o.phone === "string" ? o.phone.trim().slice(0, 60) : "",
    // AYAR katmanı → varsayılan A5. RENDER katmanı (donmuş snapshot) bilerek A4'e
    // düşer; ikisinin neden farklı olduğu: `document-render/traveler-card.density.ts`.
    pageSize: resolveConfigPageSize(o.pageSize),
    margins: {
      top: mm(m.top, D.margins.top),
      right: mm(m.right, D.margins.right),
      bottom: mm(m.bottom, D.margins.bottom),
      left: mm(m.left, D.margins.left),
    },
    fontScale: (() => {
      const n = typeof o.fontScale === "number" ? o.fontScale : Number(o.fontScale);
      return Number.isFinite(n) ? Math.min(1.4, Math.max(0.7, n)) : 1;
    })(),
    fontWeight: o.fontWeight === "light" || o.fontWeight === "bold" ? o.fontWeight : "normal",
    showOperationGrid: o.showOperationGrid !== false,
    showNotes: o.showNotes !== false,
    showOrders: o.showOrders !== false,
    showProperties: o.showProperties !== false,
    specFields: {
      color: coerceSpecField(sf.color),
      width: coerceSpecField(sf.width),
      targetQuantity: coerceSpecField(sf.targetQuantity),
      targetWeight: coerceSpecField(sf.targetWeight),
      foldType: coerceSpecField(sf.foldType),
      startDate: coerceSpecField(sf.startDate),
      endDate: coerceSpecField(sf.endDate),
    },
    specColumns: (() => {
      const n = typeof o.specColumns === "number" ? o.specColumns : Number(o.specColumns);
      return Number.isFinite(n) ? Math.min(4, Math.max(1, Math.round(n))) : 3;
    })(),
    orderFields: {
      orderNumber: coerceSpecField(of.orderNumber),
      customer: coerceSpecField(of.customer),
      item: coerceSpecField(of.item),
      color: coerceSpecField(of.color),
      quantity: coerceSpecField(of.quantity),
    },
    // Toplam: yeni orderTotal nesnesi > eski showOrderTotal boolean; varsayılan KALIN.
    orderTotal: coerceSpecField(o.orderTotal ?? { show: o.showOrderTotal !== false, size: "md", weight: "bold" }),
    // Parti bloğu: bu alanları taşımayan ESKİ kayıtlı ayarlar `!== false` /
    // coerceSpecField sayesinde AÇIK doğar — blok iç veri değil sahanın kendi
    // partisidir (müşteriye giden belge değil), opt-in gerekmez.
    showBatches: o.showBatches !== false,
    batchFields: {
      batchNumber: coerceSpecField(bf.batchNumber),
      rollCount: coerceSpecField(bf.rollCount),
      quantity: coerceSpecField(bf.quantity),
      dispatch: coerceSpecField(bf.dispatch),
    },
    batchTotal: coerceSpecField(o.batchTotal ?? { show: true, size: "md", weight: "bold" }),
    // `sections` YALNIZ açıkça verilmişse yazılır — `undefined` bırakmak
    // "yerleşik sıra" demektir ve donmuş eski snapshot'larla aynı anlamı taşır.
    // Her config'e varsayılan sırayı YAZMAK cazip ama yanlış olurdu: o zaman
    // yarın eklenecek bir bölüm, bugün kaydedilmiş her kartta eksik kalırdı.
    ...(o.sections === undefined ? {} : { sections: resolveSectionOrder(o.sections) }),
    // Alan bazlı yazı ayarı — `sections` ile AYNI disiplin: boş/anlamsız girdi
    // `undefined`'a çözülür ve anahtar config'e HİÇ yazılmaz. Boş bir `{}`
    // yazmak zararsız görünür ama renderer'daki "override yoksa tek bayt CSS
    // basılmaz" kuralını okuması zorlaşan bir şarta çevirir; ayrıca her kayıtlı
    // ayara ölü bir anahtar eklerdi.
    ...(() => {
      const f = sanitizeTravelerFields(o.fields);
      return f ? { fields: f } : {};
    })(),
    // Belgelerdeki kayıt kapısının AYNISI: kapalı grid `undefined` döner ve
    // anahtar config'e HİÇ yazılmaz (`sections`/`fields` ile aynı disiplin).
    ...(() => {
      const g = sanitizeBlankGrid(o.blankGrid);
      return g ? { blankGrid: g } : {};
    })(),
    footerNote: typeof o.footerNote === "string" ? o.footerNote.trim().slice(0, 500) : "",
  };
}

/** Belge künyesi — irsaliye/çeki başına basılan ek firma bilgisi (firma adı ayrı). */
export interface CompanyLetterhead {
  /** Firma adresi (boş → basılmaz). */
  addressLine: string;
  /** Telefon (boş → basılmaz). */
  phone: string;
  /** Vergi dairesi / no (boş → basılmaz). */
  taxInfo: string;
  /** Serbest ek künye satırları (IBAN, Mersis, e-posta, web...) — max 5, boşlar basılmaz. */
  extraLines?: string[];
}

export const DEFAULT_COMPANY_LETTERHEAD: CompanyLetterhead = {
  addressLine: "",
  phone: "",
  taxInfo: "",
};

/**
 * Yazdırılan belge içerik ayarı (sevk irsaliyesi / fason sevk / kartela çeki).
 * Tüm alanlar opsiyonel — verilmeyen alan client tarafında belge kayıt defterindeki
 * (DOC_DEFS) varsayılana çözülür (resolveDocConfig). Backend SADECE saklar; çözüm
 * client'ta (Electron/mobil) yapılır.
 */
export interface DocumentConfig {
  /** Belge başlığı override ("" / verilmedi → varsayılan başlık). */
  titleOverride?: string;
  /** Üst künye bloğu (firma adı + adres/tel/vergi) basılsın mı (default false). */
  showLetterhead?: boolean;
  /** Bölüm görünürlükleri: { [bölümKey]: boolean }. Verilmeyen bölüm → açık. */
  sections?: Record<string, boolean>;
  /** İmza kutusu etiketleri (boş dizi → varsayılan etiketler). */
  signatureLabels?: string[];
  /** İmza kutuları basılsın mı (default true). */
  showSignatures?: boolean;
  /** Belge altına basılan serbest not. */
  footerNote?: string;
  /** Görünüm ayarı (sayfa/font/tablo) — renderer document-render/doc-style ile çözer. */
  style?: DocStyleConfig;
  /** Firma logosu basılsın mı (default true — logo yüklüyse basılır). */
  showLogo?: boolean;
  /** Logo konumu: başlık sol bloğu (default) veya sağ blok. */
  logoPosition?: "left" | "right";
  /** Tablo kolonu aç/kapa + sıralama + BAŞLIK: { [tabloKey]: { hidden, order,
   *  shown, labels } } — renderer document-render/doc-table.ts ile uygular.
   *  `hidden` blocklist (normal kolonlar), `shown` allowlist (yalnız
   *  `defaultHidden` opt-in kolonlar — çuval yorumu gibi iç veri; onlarda
   *  `hidden` yok sayılır), `labels` kolon başlığı override'ı (boş dize =
   *  varsayılana dön; değer kullanıcı girdisidir → renderer HTML kaçırır). */
  columns?: Record<
    string,
    { hidden?: string[]; order?: string[]; shown?: string[]; labels?: Record<string, string> }
  >;
  /** Belge doğrulama karekodu (belge no + versiyon) basılsın mı (default false). */
  qr?: boolean;
  /** Sayfa altı damgaları: basım zamanı / basan kullanıcı / nüsha etiketi (ASIL, KOPYA...). */
  stamps?: { printedAt?: boolean; printedBy?: boolean; copyLabel?: string };
  /** Konumlu serbest metin blokları (yasal ibare vb.) — max 4, her biri ≤500 karakter. */
  blocks?: { position: "afterHeader" | "beforeSignatures"; text: string }[];
  /** Belge dili: tr (default) | en | auto (ihracat sevkiyatında EN) — yalnız
   *  müşteriye giden belgelerde (sevk irsaliyesi, fasondan sevk) uygulanır. */
  language?: "tr" | "en" | "auto";
  /** En (genişlik) kolonları basılsın ama değerleri BOŞ gelsin (elle doldurulacak /
   *  "iş emrinden çek" kapalı). Default false → enler top verisinden çekilir. */
  blankWidths?: boolean;
  /** Alt notun (footerNote) konumu: "bottom" (default, tablolardan sonra) veya
   *  "top" (başlık/araç satırından sonra, tablolardan ÖNCE). Yalnız destekleyen
   *  renderer'da uygulanır (sevk irsaliyesi). */
  footerNotePlacement?: "top" | "bottom";
  /** ALAN BAZLI yazı ayarı: { [alanKey]: { size, weight } }. Belge geneli
   *  `style.fontScale/fontWeight` TÜM belgeye uygulanır; bu ise tek bir alanı
   *  (ör. grid'deki METRE değeri) ayrı ayarlar ve genel ayar onun üstüne biner.
   *  Alan kataloğu belgeye özeldir — bugün yalnız fason çeki
   *  (`document-render/fason-ceki.fields.ts`). Bilinmeyen anahtar basımda
   *  sessizce atlanır (yazım hatası vardiyayı durdurmasın). */
  fields?: Record<string, DocFieldStyle>;
  /** Konumlandırılabilir bölümler: { [bölümKey]: "left" | "right" }. Bugün yalnız
   *  `batchInfo` (parti no — başlığın sol veya sağ bloğu; default "right" =
   *  bugünkü çıktı). Genel harita, çünkü ikinci bir alan için ikinci bir tekil
   *  anahtar açmak aynı kavramı iki yere böler. */
  placements?: Record<string, "left" | "right">;
  /** Fason çeki grid'inde satır başına grup sayısı (3 | 4 | 5; default 5 =
   *  fiziksel KUMAŞ İRSALİYESİ formu). Daha az grup = daha geniş hücre → A5'te
   *  punto büyütülebilir. Grup başına satır (20) ayarlanmaz. */
  gridGroups?: number;
  /**
   * AYARLANABİLİR BOŞ GRID (2026-08-09) — elle doldurulan kutular.
   *
   * ⚠️ OPT-IN, varsayılan KAPALI: verilmezse belgeye **tek bayt** eklenmez
   * (ne HTML ne CSS). Ayarına dokunulmamış ve donmuş belgelerin çıktısı
   * bayt-bayt korunur. Renderer: `document-render/doc-style.docBlankGridHtml`.
   */
  blankGrid?: BlankGridConfig;
  /** Fason çeki grid'inde GRUP BAŞINA SATIR (1–40; default 10).
   *  SAYFA BAŞINA TOP = gridGroups × gridRows (varsayılan 5 × 10 = 50).
   *  Hücreler elle doldurulan BOŞ kutulardır; eski 100'lük formda kutuların
   *  çoğu boş basılıyordu ve A5'te iyice sıkışıktı. */
  gridRows?: number;
}

/** Belge ayarları haritası: { [belgeKey]: DocumentConfig }. Ham saklanır, client çözer. */
export type DocumentsConfig = Record<string, DocumentConfig>;

/**
 * Tüm public feature flag'lerin tek atışta okunmuş hali. Frontend app
 * açılışında 1 kez çekip context'e koyar; UI bu flag'lere göre alanları
 * gösterir/gizler. Backend tarafı feature flag'i ENFORCE ETMEZ — sadece
 * UI rehberi (admin/test araçları field'ları gönderebilir).
 */
export interface FeatureFlags {
  /** ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli). */
  companyName: string;
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
  // --- TİCARET/MUHASEBE REJİM ANAHTARLARI (2026-08-14, dalga 1) --------------
  // ⚠️ Dokuzu da default FALSE ve bugün HİÇBİR servis okumuyor (bilinçli ara
  // durum — bkz. SETTING_KEYS bloğundaki gerekçe). Davranışı bağlayan dalga
  // buradaki MUAF listelerini birebir uygular.
  /** Cari risk limiti aşımında SATIŞ faturası onayını engelle (default false).
   *  Bugün limit yalnız uyarıdır; açıkken onay 409 döner. MUAF: alış faturası,
   *  taslak yolları ve iptal/storno. */
  financeRiskLimitBlockEnabled: boolean;
  /** Sevk onayında otomatik satış faturası TASLAĞI üret (default false). Onay
   *  her zaman elle kalır; `financeEnabled` kapalıyken kanca no-op'tur ve
   *  taslak hatası sevki DÜŞÜRMEZ. */
  financeAutoDraftFromShipmentEnabled: boolean;
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
  /** Dokuma tezgah izleme modülü. YER TUTUCU — arkasında henüz yüzey yok.
   *  ÜRETİME BAĞIMLI (üretim kapalıyken açılamaz). */
  tezgahEnabled: boolean;
  /** Devere / levent modülü (çözgü kartı · levent stoğu · levent defteri).
   *  Varsayılan KAPALI. ⚠️ İPLİĞE BAĞIMLI, iplik de ticarete: bu alan HAM
   *  değerdir (panel toggle'ı kendi yazdığını geri okusun diye); etkin değer
   *  `ticaret && iplik && devere` ve kapının içinde çözülür. */
  devereEnabled: boolean;
  /** Devere Faz 2: lot zorunluluğu (içeride sarım iplik çıkışı + mal kabul iplik satırı). Varsayılan KAPALI =
   *  bugünkü davranış: lotsuz satır yazılır, yalnız uyarı üretir. */
  devereLotRequired: boolean;
  /** Dokuma işi modülü (dokuma işi planlama · tezgah koşumu · top indirme).
   *  Varsayılan KAPALI. ⚠️ ÜRETİME BAĞIMLI: bu alan HAM değerdir; etkin değer
   *  `production && dokuma` ve kapının içinde çözülür. */
  dokumaEnabled: boolean;
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  /** KK1 ham kumaş girişinde ağırlık (kg) alanı gösterilsin mi. Default false;
   *  backend ENFORCE eder (kapalıyken gelen weightKg reddedilir). */
  kk1WeightEntryEnabled: boolean;
  /** Ham girişte mükerrer top tuzağı açık mı (default false). Backend ENFORCE
   *  eder: 90 sn içinde birebir aynı giriş 409 POSSIBLE_DUPLICATE alır ve ancak
   *  açık onayla (`confirmDuplicate`) geçer. */
  kk1DuplicateGuardEnabled: boolean;
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
  /** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu (default false). */
  shipmentConfirmationEnabled: boolean;
  shipmentManualSackCountEnabled: boolean;
  /** Sevk geri alma (storno) yalnız aynı fabrika gününde mi (default false = sınırsız).
   *  Faturasız + iadesiz koşulları bundan bağımsız her zaman geçerlidir. */
  shipmentUndoSameDayOnly: boolean;
  /** Sevkiyat siparişe bağlanmalı mı: 'off' | 'warn' (default) | 'block'.
   *  Backend ENFORCE eder — kapı YALNIZ kurulumda (dispatch'e konmaz). */
  shippingOrderRequirement: ShipmentOrderRequirement;
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
  /** Çuval/grup içerik dökümünde ad: 'ikisi' (default) | 'bizdeki' | 'musterideki'. */
  sackDumpNameMode: SackDumpNameMode;
  /** Tahsiste EN toleransı açık mı (default false = tam eşitlik). */
  shippingAllocWidthToleranceEnabled: boolean;
  /** Tolerans (cm) — yalnız bayrak açıkken uygulanır. */
  shippingAllocWidthToleranceCm: number;
  /** Tahsis sipariş miktarını aşabilir mi (fazla sevk deftere yazılır). Default false. */
  shippingAllowOverAllocation: boolean;
  /** Müşteri şubeleri (sevk noktaları) UI'da açık mı (default TRUE). Kapalıyken
   *  müşteri formundaki Şubeler sekmesi/taslağı ve sipariş formundaki şube seçimi
   *  gizlenir. Salt UI rehberi — backend ENFORCE ETMEZ, mevcut branchId verisi korunur. */
  customerBranchesEnabled: boolean;
  /** Refakat kartı marka/içerik ayarı (firma adı + bölüm görünürlükleri). */
  travelerCardConfig: TravelerCardConfig;
  /** Belge künyesi (adres/tel/vergi) — irsaliye/çeki üst bloğunda basılır. */
  companyLetterhead: CompanyLetterhead;
  /** Yazdırılan belgelerin içerik ayarı (canlı). Ham map; client resolveDocConfig ile çözer. */
  documentsConfig: DocumentsConfig;
  /** Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi (default TRUE/açık).
   *  Diğer flag'lerin aksine ENFORCE edilir — tambur kesim guard'ı bu flag'e bağlı. */
  tamburOverQuantityEnabled: boolean;
  /** Tambur "TÜMDEN geri al" yalnız aynı fabrika günü içinde mi (default FALSE). */
  tamburUndoFullSameDayOnly: boolean;
  /** Kısa kesimde otomatik A1 — FABRİKA VARSAYILANI (default FALSE/kapalı).
   *  Kural istemcide koşar; tablet yetkilisi cihaz bazında ezebilir. */
  tamburShortCutA1Enabled: boolean;
  /** Kısa kesim eşiği (metre); NULL = girilmemiş → kural ateşlemez. */
  tamburShortCutA1ThresholdM: number | null;
  /** Fason kabulünde çekme (giden↔dönen farkı) uyarısı çıksın mı (default TRUE). */
  fasonShrinkWarnEnabled: boolean;
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
  /** Mutlak oturum tavanı — gün (default 30, 0..365; 0 = süresiz). Zaman aşımı kapalı
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
}

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
let featureFlagsCache: { value: FeatureFlags; expiresAt: number } | null = null;
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

export class SystemSettingService {
  async list(): Promise<ApiResponse<unknown[]>> {
    const items = await prisma.systemSetting.findMany({
      // ⚠️ SIR SATIRLARI LİSTEDE DÖNMEZ (2026-09-03 / P3). `system_settings` artık
      // ayar olmayan bir satır da taşıyor: ayar şifresinin bcrypt hash'i. Bu uç
      // TÜM satırları döndürdüğü için hash burada görünseydi kapı FİİLEN ÖLÜRDÜ —
      // çevrimdışı kırma için bcrypt gövdesi yeterli ve yükü okuyan herkes
      // şifrenin tanımlı olduğunu da öğrenirdi. Süzgeç TEK ANAHTAR değil ÖN EK
      // bazlı: yarın eklenecek ikinci bir sır satırı da doğduğu an korunur
      // ("unutulmuş altıncı enum" sınıfı). Yazma tarafının ikizi:
      // `isReservedSettingKey` (admin.routes PUT /settings/:key).
      where: { NOT: { key: { startsWith: SECURITY_SETTING_PREFIX } } },
      orderBy: { key: "asc" },
      include: {
        updatedBy: { select: { id: true, fullName: true } },
      },
    });
    return { success: true, data: items };
  }

  async get(key: string): Promise<ApiResponse<unknown | null>> {
    const item = await prisma.systemSetting.findUnique({ where: { key } });
    return { success: true, data: item };
  }

  /**
   * Upsert: yoksa oluştur, varsa güncelle.
   * description sadece ilk oluşturmada set edilir; sonraki update'lerde değişmez
   * (admin niyetlerinin bozulmaması için).
   */
  async set(
    key: string,
    value: Prisma.InputJsonValue,
    description: string | undefined,
    userId: string | undefined
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.systemSetting.findUnique({ where: { key } });

    const updated = await prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value,
        description: description ?? null,
        updatedById: userId,
      },
      update: {
        value,
        updatedById: userId,
      },
    });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: TABLE,
      recordId: key,
      oldData: existing ? { value: existing.value as Prisma.InputJsonValue } : null,
      newData: { value: updated.value as Prisma.InputJsonValue },
    });

    // Herhangi bir ayar yazımı feature-flag agregat cache'ini bayatlatabilir →
    // tek write chokepoint burada invalidate eder (toggle anında taze görünür).
    invalidateFeatureFlagsCache();

    return { success: true, data: updated, message: "Ayar güncellendi" };
  }

  /** Güncel belge logosu (yalnız aktif dataUrl — kütüphanenin tamamı değil). */
  async getDocumentsLogo(): Promise<ApiResponse<{ dataUrl: string | null }>> {
    const logo = await readDocumentsLogo();
    return {
      success: true,
      data: { dataUrl: logo.current ? (logo.items[logo.current] ?? null) : null },
    };
  }

  /**
   * Belge logosunu günceller. dataUrl=null → logo kaldırılır (current=null);
   * kütüphane (items) APPEND-ONLY kalır — eski donmuş belgeler hash'leriyle kendi
   * logolarını basmaya devam eder. Aynı görsel tekrar yüklenirse hash çakışır,
   * kopya çıkmaz. Logolar nadiren değişir → items pratikte birkaç kayıt.
   */
  async setDocumentsLogo(
    dataUrl: string | null,
    userId?: string,
  ): Promise<ApiResponse<{ dataUrl: string | null }>> {
    // A8 (2026-07-31 denetimi): read-merge-write süreç-içi kuyrukla serileşir —
    // eşzamanlı iki farklı yükleme birbirinin items eklemesini kaybettiremez.
    // Tek Express process invariant'ı (server.ts) altında DB kilidi gerekmez.
    const task = documentsLogoWriteQueue.then(() => this.applyDocumentsLogo(dataUrl, userId));
    documentsLogoWriteQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async applyDocumentsLogo(
    dataUrl: string | null,
    userId?: string,
  ): Promise<ApiResponse<{ dataUrl: string | null }>> {
    const logo = await readDocumentsLogo();
    let next: DocumentsLogo;
    if (dataUrl == null || dataUrl === "") {
      next = { current: null, items: logo.items };
    } else {
      if (dataUrl.length > LOGO_MAX_CHARS) {
        throw AppError.badRequest("Logo çok büyük — en fazla ~100KB görsel yükleyin");
      }
      if (!LOGO_DATAURL_RE.test(dataUrl)) {
        throw AppError.badRequest("Logo PNG, JPEG veya SVG data-url formatında olmalı");
      }
      const hash = createHash("sha256").update(dataUrl).digest("hex").slice(0, 16);
      next = { current: hash, items: { ...logo.items, [hash]: dataUrl } };
    }
    await this.set(
      SETTING_KEYS.DOCUMENTS_LOGO,
      next as unknown as Prisma.InputJsonValue,
      "Belge logosu (hash-anahtarlı kütüphane; snapshot yalnız hash taşır)",
      userId,
    );
    return {
      success: true,
      data: { dataUrl: next.current ? next.items[next.current] : null },
      message: next.current ? "Logo güncellendi" : "Logo kaldırıldı",
    };
  }

  /**
   * Tolerance değerini DB'den okur. Kayıt yoksa default 5m döner.
   * NOT: Bu fonksiyon çok sık çağrılmaz (sevk onayı sırasında); cache'siz kabul.
   */
  async getShippingToleranceMeters(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
      select: { value: true },
    });
    if (!setting) return 5;
    const parsed = asNumber(setting.value);
    if (parsed === null || parsed < 0) return 5;
    return parsed;
  }

  /**
   * Tüm feature flag'leri tek atışta. Default: tüm flag'ler false (en
   * konservatif — fabrika fiyat görmek istemiyor şu an).
   */
  async getFeatureFlags(): Promise<ApiResponse<FeatureFlags>> {
    const now = Date.now();
    if (featureFlagsCache && featureFlagsCache.expiresAt > now) {
      return { success: true, data: featureFlagsCache.value };
    }
    const gen = cacheGeneration; // okumanın başladığı sürüm (lost-invalidation guard)
    // Tek sorguda tüm ayarları çek → reader'lara in-memory client enjekte et.
    // Eski kod 15 ardışık findUnique = 15 round-trip yapıyordu. Reader'lar her
    // flag'in key/parse/default mantığının TEK kaynağı kalır; yalnız veri kaynağı
    // DB yerine map olur (system_settings tablosu küçük → tüm satırları çekmek ucuz).
    const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
    const valueByKey = new Map(rows.map((r) => [r.key, r.value] as const));
    const cacheClient = {
      systemSetting: {
        findUnique: (args: { where: { key: string } }) =>
          Promise.resolve(
            valueByKey.has(args.where.key)
              ? { value: valueByKey.get(args.where.key) }
              : null,
          ),
      },
    } as unknown as Pick<typeof prisma, "systemSetting">;

    // Oturum ömrü tek kaynaktan (dakika); saat alanı geriye-uyum için aynı değerden türetilir.
    const sessionMinutes = await readSessionDurationMinutes(cacheClient);
    const flags: FeatureFlags = {
      companyName: await readCompanyName(cacheClient),
      pricingEnabled: await readPricingEnabled(cacheClient),
      financeEnabled: await readFinanceEnabled(cacheClient),
      financeBlockNegativeCashEnabled: await readFinanceBlockNegativeCashEnabled(cacheClient),
      financeDefaultVatRate: await readFinanceDefaultVatRate(cacheClient),
      financeRiskLimitBlockEnabled: await readFinanceRiskLimitBlockEnabled(cacheClient),
      financeAutoDraftFromShipmentEnabled:
        await readFinanceAutoDraftFromShipmentEnabled(cacheClient),
      financeAutoAllocateOnPaymentEnabled:
        await readFinanceAutoAllocateOnPaymentEnabled(cacheClient),
      yarnBlockNegativeBalanceEnabled: await readYarnBlockNegativeBalanceEnabled(cacheClient),
      purchaseBlockOverReceiptEnabled: await readPurchaseBlockOverReceiptEnabled(cacheClient),
      goodsReceiptRequirePriceEnabled: await readGoodsReceiptRequirePriceEnabled(cacheClient),
      financeAllowZeroPriceLineEnabled: await readFinanceAllowZeroPriceLineEnabled(cacheClient),
      financeFutureDatedDocumentBlockEnabled:
        await readFinanceFutureDatedDocumentBlockEnabled(cacheClient),
      financeYarnOutOnInvoiceEnabled: await readFinanceYarnOutOnInvoiceEnabled(cacheClient),
      productionEnabled: await readProductionEnabled(cacheClient),
      // MODÜL ANAHTARLARI — ⚠️ `cacheClient` argümanı ATLANAMAZ: bu yol tek
      // atışlık toplu okumadır, argümansız çağrı beş DB round-trip'i ekler.
      // ⚠️ HAM değer döner (etkin `iplik = ticaret && iplik` DEĞİL): panel
      // toggle'ı kendi yazdığını geri okumak zorunda, yoksa kullanıcı ticaret
      // kapalıyken ipliği açar ve anahtar kapalı görünmeye devam eder.
      ticaretEnabled: await readTicaretEnabled(cacheClient),
      iplikEnabled: await readIplikEnabled(cacheClient),
      depoMultiEnabled: await readDepoMultiEnabled(cacheClient),
      kumasTeknikEnabled: await readKumasTeknikEnabled(cacheClient),
      tezgahEnabled: await readTezgahEnabled(cacheClient),
      devereEnabled: await readDevereEnabled(cacheClient),
      devereLotRequired: await readDevereLotRequired(cacheClient),
      dokumaEnabled: await readDokumaEnabled(cacheClient),
      targetQuantityEnabled: await readTargetQuantityEnabled(cacheClient),
      rawWidthEnabled: await readRawWidthEnabled(cacheClient),
      kk1WeightEntryEnabled: await readKk1WeightEntryEnabled(cacheClient),
      kk1DuplicateGuardEnabled: await readKk1DuplicateGuardEnabled(cacheClient),
      kk1OnlineOnlyEnabled: await readKk1OnlineOnlyEnabled(cacheClient),
      kk1LabelScanVerifyEnabled: await readKk1LabelScanVerifyEnabled(cacheClient),
      kk1HistoryAllEntriesEnabled: await readKk1HistoryAllEntriesEnabled(cacheClient),
      shippingSimulatedWeightEnabled: await readSimulatedWeightEnabled(cacheClient),
      returnGradingEnabled: await readReturnGradingEnabled(cacheClient),
      kartelaMeasurementEnabled: await readKartelaMeasurementEnabled(cacheClient),
      partyCodeAuto: await readPartyCodeAuto(cacheClient),
      fasonNoteMobileEntry: await readFasonNoteMobileEntry(cacheClient),
      devicePairingRequired: await readDevicePairingRequired(cacheClient),
      shipmentConfirmationEnabled: await readShipmentConfirmationEnabled(cacheClient),
      shipmentManualSackCountEnabled: await readShipmentManualSackCountEnabled(cacheClient),
      shipmentUndoSameDayOnly: await readShipmentUndoSameDayOnly(cacheClient),
      shippingOrderRequirement: await readShippingOrderRequirement(cacheClient),
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
      sackDumpNameMode: await readSackDumpNameMode(cacheClient),
      shippingAllocWidthToleranceEnabled: await readShippingAllocWidthToleranceEnabled(cacheClient),
      shippingAllocWidthToleranceCm: await readShippingAllocWidthToleranceCm(cacheClient),
      shippingAllowOverAllocation: await readShippingAllowOverAllocation(cacheClient),
      customerBranchesEnabled: await readCustomerBranchesEnabled(cacheClient),
      travelerCardConfig: await readTravelerCardConfig(cacheClient),
      companyLetterhead: await readCompanyLetterhead(cacheClient),
      documentsConfig: await readDocumentsConfig(cacheClient),
      tamburOverQuantityEnabled: await readTamburOverQuantityEnabled(cacheClient),
      tamburUndoFullSameDayOnly: await readTamburUndoFullSameDayOnly(cacheClient),
      tamburShortCutA1Enabled: await readTamburShortCutA1Enabled(cacheClient),
      tamburShortCutA1ThresholdM: await readTamburShortCutA1ThresholdM(cacheClient),
      fasonShrinkWarnEnabled: await readFasonShrinkWarnEnabled(cacheClient),
      fasonShrinkTolerancePct: await readFasonShrinkTolerancePct(cacheClient),
      demoModeEnabled: await readDemoModeEnabled(cacheClient),
      duplicatesFuzzyEnabled: await readDuplicatesFuzzyEnabled(cacheClient),
      duplicatesFuzzyThresholdPct: await readDuplicatesFuzzyThresholdPct(cacheClient),
      kursunBypassEnabled: await readKursunBypassEnabled(cacheClient),
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
      absoluteSessionCapDays: await readAbsoluteSessionCapDays(cacheClient),
      pinLockoutEnabled: await readPinLockoutEnabled(cacheClient),
      pinLockoutAttempts: await readPinLockoutAttempts(cacheClient),
      backupHour: await readBackupHour(cacheClient),
      pinLockoutPenaltySec: await readPinLockoutPenaltySec(cacheClient),
      pinLockoutEscalateAfter: await readPinLockoutEscalateAfter(cacheClient),
      pinLockoutLongPenaltyMin: await readPinLockoutLongPenaltyMin(cacheClient),
      loginMethods: await readLoginMethods(cacheClient),
      labelCopies: await readLabelCopies(cacheClient),
      nativeSendEnabled: await readLabelNativeSendEnabled(cacheClient),
      mobileRasterEnabled: await readMobileRasterEnabled(cacheClient),
      scrapGradeLabelEnabled: await readScrapGradeLabelEnabled(cacheClient),
      defaultLabelMedia: await readDefaultLabelMedia(cacheClient),
    };
    // Yalnız okuma sürerken invalidate OLMADIYSA cache'le; olduysa bayat veriyi
    // pinleme (taze değeri döndür, cache'i bir sonraki okuma tazeler).
    if (cacheGeneration === gen) {
      featureFlagsCache = { value: flags, expiresAt: now + FEATURE_FLAGS_TTL_MS };
    }
    return { success: true, data: flags };
  }

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
  private async effectiveModuleValue(
    input: Record<string, unknown>,
    key: string,
  ): Promise<boolean> {
    const raw = input[key];
    if (Object.prototype.hasOwnProperty.call(input, key) && typeof raw === "boolean") {
      return raw;
    }
    switch (key) {
      case "ticaretEnabled":
        return readTicaretEnabled();
      case "iplikEnabled":
        return readIplikEnabled();
      case "productionEnabled":
        return readProductionEnabled();
      case "tezgahEnabled":
        return readTezgahEnabled();
      case "devereEnabled":
        return readDevereEnabled();
      case "dokumaEnabled":
        return readDokumaEnabled();
      case "depoMultiEnabled":
        return readDepoMultiEnabled();
      case "kumasTeknikEnabled":
        return readKumasTeknikEnabled();
      case "financeEnabled":
        return readFinanceEnabled();
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
  private async assertModuleDependencies(input: Record<string, unknown>): Promise<void> {
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
   * Bir feature flag'i toggle et. Kabul: { pricingEnabled: boolean }.
   * Verilmeyen alanlar dokunulmaz.
   */
  async setFeatureFlags(
    // ⚠️ GİRDİ ÇIKTIDAN DAHA GENİŞ: bazı sayısal ayarlarda `null` "alanı temizle"
    // demektir ve panel bunu gönderir, ama okuma tarafı hiçbir zaman null
    // döndürmez (varsayılana çözülür). İkisini tek tiple anlatmak, ya paneli
    // 400'e düşürür ya da API sözleşmesine olmayan bir null sokar.
    input: Omit<
      Partial<FeatureFlags>,
      "fasonShrinkTolerancePct" | "duplicatesFuzzyThresholdPct" | "shippingAllocWidthToleranceCm"
    > & {
      /** null = fabrika varsayılanına dön (1 cm). */
      shippingAllocWidthToleranceCm?: number | null;
      fasonShrinkTolerancePct?: number | null;
      duplicatesFuzzyThresholdPct?: number | null;
    },
    userId: string | undefined
  ): Promise<ApiResponse<FeatureFlags>> {
    if (!userId) throw AppError.unauthorized();

    // MODÜL BAĞIMLILIĞI — HER YAZMADAN ÖNCE, TOPLUCA (2026-09-02).
    // ⚠️ Sıra load-bearing: aşağıdaki `this.set` çağrıları TEK TX DEĞİLDİR.
    // Doğrulama dalların arasına serpiştirilseydi "ticaret kapandı, iplik açık
    // kaldı" gibi YARIM bir gövde yazılır ve geri alınamazdı.
    await this.assertModuleDependencies(input as Record<string, unknown>);

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

    if (Object.prototype.hasOwnProperty.call(input, "dokumaEnabled")) {
      if (typeof input.dokumaEnabled !== "boolean") {
        throw AppError.badRequest("dokumaEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DOKUMA_ENABLED,
        input.dokumaEnabled,
        "Dokuma işi modülü (dokuma işi planlama · tezgah koşumu · top indirme)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "targetQuantityEnabled")) {
      if (typeof input.targetQuantityEnabled !== "boolean") {
        throw AppError.badRequest("targetQuantityEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED,
        input.targetQuantityEnabled,
        "İş emri formunda hedef metraj alanını göster",
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
      await this.set(
        SETTING_KEYS.WORKORDER_PARTY_CODE_AUTO,
        input.partyCodeAuto,
        "İş emri parti kodunu otomatik üret (manuel giriş yerine)",
        userId
      );
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

    if (Object.prototype.hasOwnProperty.call(input, "devicePairingRequired")) {
      if (typeof input.devicePairingRequired !== "boolean") {
        throw AppError.badRequest("devicePairingRequired boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.DEVICE_PAIRING_REQUIRED,
        input.devicePairingRequired,
        "Mobil cihaz eşleştirmesi zorunlu olsun (kapalıyken eşleşmemiş cihazlar da girer)",
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
        "Top kalitesi zorunlu — KK1 girişi, Tambur kalan-kuyruk topu, depo kesimi ve iş emri kapanışının depo/2. kalite satırları kalitesiz geçemez",
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
        "İş emri formunda 'Son Kullanılan Parti No' rozeti — yalnız gösterim, numara üretimini etkilemez",
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
          `Mutlak oturum tavanı 0–${MAX_ABSOLUTE_SESSION_CAP_DAYS} gün aralığında olmalı (0 = süresiz)`
        );
      }
      await this.set(
        SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS,
        Math.floor(v),
        "Mutlak oturum tavanı, gün — zaman aşımı kapalı olsa bile token en fazla bu kadar gün yaşar (0 = süresiz)",
        userId
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "pinLockoutEnabled")) {
      if (typeof input.pinLockoutEnabled !== "boolean") {
        throw AppError.badRequest("pinLockoutEnabled boolean olmalı");
      }
      await this.set(
        SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED,
        input.pinLockoutEnabled,
        "Hızlı PIN + kart giriş deneme kilidi açık olsun (brute-force koruması)",
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
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 5) {
        throw AppError.badRequest("Etiket kopya adedi 1–5 aralığında olmalı");
      }
      await this.set(
        SETTING_KEYS.LABEL_COPIES,
        Math.floor(v),
        "Top etiketi kopya adedi — bir baskıda kaç etiket çıkar (üst+alt için 2)",
        userId
      );
    }


    if (Object.prototype.hasOwnProperty.call(input, "nativeSendEnabled")) {
      if (typeof input.nativeSendEnabled !== "boolean") {
        throw AppError.badRequest("nativeSendEnabled boolean olmalı");
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

    return this.getFeatureFlags();
  }
}

// Module-level singleton — helper'lar import edip kullanır.
export const systemSettingService = new SystemSettingService();

/**
 * Transaction içinden çağrılabilen tolerance okuma. tx verilirse aynı tx'i
 * kullanır (recomputeOrderStatusTx için kritik). tx yoksa dış prisma client.
 */
export async function readShippingToleranceMeters(
  tx?: Pick<typeof prisma, "systemSetting">
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_TOLERANCE_METERS },
    select: { value: true },
  });
  if (!setting) return 5;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return 5;
  return parsed;
}

/**
 * Pricing/currency UI gösterilsin mi? Default false (kayıt yoksa). Frontend
 * bu flag'e göre order create/list/detail ekranlarındaki currency dropdown +
 * unitPrice + totalAmount alanlarını render eder.
 */
export async function readPricingEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_PRICING_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Ön muhasebe modülü açık mı? Default false.
 *
 * ⚠️ Bu bayrak GÖRÜNÜRLÜK değil REJİM anahtarıdır: kapalıyken menü satırı
 * çizilmez, route 403 verir ve otomatik taslak kancaları no-op olur. Üçü de
 * ayrı ayrı test edilir (`test_finance_flag_off`) — yalnız menüyü gizlemek,
 * adresi bilen birine modülü açık bırakırdı.
 */
export async function readFinanceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Kasa eksi bakiye engeli açık mı? Default false.
 *
 * ENFORCEMENT READER — bilerek cache'siz (`readTamburOverQuantityEnabled`
 * emsali): guard tx içinde her seferinde taze okur; panelden kapatılan bayrak
 * bir sonraki işlemde anında etkisizleşir (acil kapatma yolu). Tek tüketici:
 * `helpers/cash-balance-guard.helper.assertCashBalanceCoversTx`.
 */
export async function readFinanceBlockNegativeCashEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Fatura satırının varsayılan KDV oranı (%). Kayıt yoksa / aralık dışıysa 20
 * (= 2026-08-14 öncesi hardcode; ayar dokunulmamış kurulumda sıfır fark).
 * İki tüketici: `invoice.service.createDraftFromGoodsReceipt` (alış taslağı)
 * ve Electron fatura formunun yeni satırı — ikisi de tek kaynaktan okur.
 */
export async function readFinanceDefaultVatRate(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_DEFAULT_VAT_RATE },
    select: { value: true },
  });
  const parsed = asNumber(setting?.value);
  if (parsed === null || parsed < MIN_FINANCE_VAT_RATE || parsed > MAX_FINANCE_VAT_RATE) {
    return DEFAULT_FINANCE_VAT_RATE;
  }
  return parsed;
}

// =============================================================================
// TİCARET/MUHASEBE REJİM OKUYUCULARI (2026-08-14, dalga 1 — HENÜZ ÇAĞIRAN YOK)
// =============================================================================
// Dokuzu da ENFORCEMENT READER kalıbındadır (`readFinanceBlockNegativeCashEnabled`
// emsali): bilerek CACHE'SİZ ve `tx` parametreli — guard tx içinde her seferinde
// taze okur, böylece panelden kapatılan bayrak bir SONRAKİ işlemde anında
// etkisizleşir (acil kapatma yolu). Kayıt yoksa hepsi FALSE döner (`asBoolean`),
// yani bugünkü davranış birebir korunur.
//
// ⚠️ Bu fonksiyonların bugün ÇAĞIRANI YOKTUR ve bu bilinçlidir; "ölü kod" diye
// silme — dört kapı sözleşmesinin servis ayağıdır (bekçi:
// `scripts/test_feature_flag_contract.ts`). Davranışı bağlayan dalga, ilgili
// SETTING_KEYS JSDoc'undaki MUAF listesini birebir uygular.

/** Risk limiti aşımında satış faturası onayını engelle? Default false. */
export async function readFinanceRiskLimitBlockEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Sevk onayında otomatik satış faturası TASLAĞI üretilsin mi? Default false. */
export async function readFinanceAutoDraftFromShipmentEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
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

/**
 * Üretim modülü açık mı. ⚠️ VARSAYILAN **TRUE** — ayar satırı yoksa fabrika
 * bugünkü davranışını aynen sürdürür. Diğer bayraklar varsayılan KAPALI
 * olduğu için bu tersliği bilerek yazıyoruz: burada "kapalı" demek, kurulmuş
 * bir fabrikanın üretim ekranlarını yok etmek olurdu.
 */
export async function readProductionEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PRODUCTION_ENABLED },
    select: { value: true },
  });
  // ⚠️ SATIR-YOK SİGORTASI — SADELEŞTİRME (`asBoolean`a çevirme) YASAK.
  // 2026-09-02 grandfathering damgasından sonra canlıda satır HEP var, yani bu
  // dal orada bir daha ÖLÇÜLMEZ; ama damgası olmayan her kopyada (eski dump,
  // geliştirici DB'si, damganın "geçmişi olan kurulum" koşulunun elediği taze
  // kurulum) tek ayakta duran şey budur. `requireProductionEnabled` artık
  // gerçek bir route kapısı olduğu için burayı `false`a çevirmek, üretim
  // modülünün TAMAMINI (tabletler dahil) sessizce kapatır.
  if (!setting) return true;
  return setting.value === true || setting.value === "true";
}

/**
 * Ticaret modülü açık mı? Default FALSE.
 *
 * ⚠️ GÖRÜNÜRLÜK değil REJİM anahtarı: kapalıyken menü satırı çizilmez, route
 * 403 verir (`requireTicaretEnabled`) ve ticari kancalar no-op olur.
 * ⚠️ Okuma CACHE'SİZ (`module.middleware.ts` argümansız çağırır) — acil
 * kapatma yolu. Mevcut kurulumdaki değeri migration DAMGALAR (20260902230000);
 * aşağıdaki varsayılan yalnız satır-yok sigortasıdır.
 */
export async function readTicaretEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TICARET_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İplik modülü açık mı? Default FALSE. HAM değer döner.
 *
 * ⚠️ ETKİN DEĞER BURADA ÇÖZÜLMEZ: iplik ticarete bağımlıdır ve "ticaret &&
 * iplik" birleşimi TEK yerde — `requireIplikEnabled` kapısında — yapılır.
 * Burada da çözülseydi panel toggle'ı kendi yazdığını geri okuyamaz, kullanıcı
 * ipliği açar ve anahtar kapalı görünmeye devam ederdi.
 */
export async function readIplikEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.IPLIK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Çoklu depo modülü açık mı? Default FALSE.
 *
 * ⚠️ Bu anahtar 2026-09-02'de bir VERİ TÜREVİNİN (panelde aktif depo sayısı >
 * 1) yerine geçti; mevcut kurulumun değeri o türev ÖLÇÜLEREK damgalandı.
 * Bundan sonra ikinci depoyu açmak yüzeyleri kendiliğinden AÇMAZ — bilinçli
 * bir davranış değişikliği (bkz. migration 20260902230000 başlığı).
 */
export async function readDepoMultiEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEPO_MULTI_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Kumaş teknik kartı modülü açık mı? Default FALSE. YER TUTUCU — arkasında
 *  henüz yüzey yok, bu yüzden middleware'i de YAZILMADI (ölü kapı yazmıyoruz). */
export async function readKumasTeknikEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KUMAS_TEKNIK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Dokuma tezgah izleme modülü açık mı? Default FALSE. YER TUTUCU (üretime bağımlı). */
export async function readTezgahEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TEZGAH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Devere / levent modülü açık mı? Default FALSE (satır yoksa kapalı — dünkü
 *  davranış: devere yoktu). HAM değer döner; zinciri (ticaret → iplik → devere)
 *  `requireDevereEnabled` ölçer. */
export async function readDevereEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVERE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Devere Faz 2: lot zorunlu mu? Default FALSE (satır yoksa lotsuz satır yazılır, yalnız
 *  uyarı — bugünkü davranış). Enforcement reader: cache'siz, aksiyon anında okunur. */
export async function readDevereLotRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Dokuma işi modülü açık mı? Default FALSE (satır yoksa kapalı — dünkü davranış:
 *  fabrika dokumuyor, kumaş hazır geliyor). HAM değer döner; ön koşulu (production)
 *  `requireDokumaEnabled` ölçer. */
export async function readDokumaEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOKUMA_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KÖPRÜ BAYRAĞI — "satış faturası onayında iplik stoktan düşülsün mü" sorusunun
 * TEK karar noktası: `finance && ticaret && iplik && altBayrak`.
 *
 * NEDEN TEK RESOLVER: alt bayrak İKİ modülün kesişiminde yaşıyor (fatura
 * finansta, kg defteri iplikte). Tüketici alt bayrağı doğrudan okusaydı, iplik
 * modülü KAPALI bir kurulumda satış faturası `YarnMovement` yazmaya devam
 * ederdi — "modül kapalıyken alt bayrak OKUNMAZ" kuralının bilinen tek somut
 * ihlali buydu. Bekçi `readFinanceYarnOutOnInvoiceEnabled` çağrısının YALNIZ
 * burada geçtiğini kilitler; ikinci bir çağrı yerine bu fonksiyonu çağır.
 *
 * ⚠️ Sıra ucuzdan pahalıya değil, ANLAMLIDIR: en dıştaki modül şalterinden
 * içeri doğru — kapalı bir modülde alt bayrağın değeri hiç sorulmaz.
 */
export async function resolveYarnOutOnInvoiceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readFinanceEnabled(tx))) return false;
  if (!(await readTicaretEnabled(tx))) return false;
  if (!(await readIplikEnabled(tx))) return false;
  return readFinanceYarnOutOnInvoiceEnabled(tx);
}

/**
 * İş emri "hedef metraj" alanı gösterilsin mi? Default false (proses-only
 * fabrika; üretim miktarını giren kumaş belirler). İleride örgü/üretim eklenirse açılır.
 */
export async function readTargetQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 ham kumaş girişinde "en (cm)" alanı gösterilsin mi? Default false
 * (müşteri: ham kumaşın eni önemsiz). Kapalıyken mobil KK1 en alanını gizler,
 * operatör isterse manuel override ile yine girebilir. Bitmiş topun eni KK1'den
 * değil WorkOrder.width'ten damgalanır (bkz. tambur.service finalize).
 */
export async function readRawWidthEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_RAW_WIDTH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 ham kumaş girişinde ağırlık (kg) alanı açık mı? Default false.
 * rawWidthEnabled'dan farkı: bu flag backend'de ENFORCE edilir — kapalıyken
 * gelen weightKg createInitialEntry'de 400 ile reddedilir (yalnız UI rehberi değil).
 */
export async function readKk1WeightEntryEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_WEIGHT_ENTRY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Ham girişte mükerrer top tuzağı açık mı? Default false.
 *
 * SAHA VAKASI (2026-08-03): sunucu restart edildi, operatör etiket çıkmayınca
 * "Kaydet ve Etiket Bas"a defalarca bastı; her basış yeni bir `clientToken`
 * ürettiği için sunucu N ayrı top yazdı. Asıl düzeltme istemcidedir (token artık
 * mantıksal denemeye bağlı) — bu bayrak İSTEMCİYE GÜVENMEYEN ikinci hattır:
 * farklı cihaz, yeniden kurulum, doğrudan API çağrısı da yakalanır.
 */
export async function readKk1DuplicateGuardEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 ham giriş çevrimdışı kuyruksuz (online-only) rejimde mi? Default false.
 *
 * SAHA KARARI (2026-08-11): kesinti anında kuyruğa alınan kayıtların etiketi
 * sonradan basılamayınca operatör aynı topu YENİDEN giriyordu (07.08 vakası:
 * 4 top 34-52 dk sonra ikizlendi). Bayrak açıkken mobil KK1 çevrimdışı kayıt
 * hiç ALMAZ — kayıt + etiket tek nefeste yürür, "Sırada/Başarısız" listeleri
 * doğmaz. ENFORCE istemcidedir (kuyruk istemci kavramı); bu okuma yalnız
 * feature-flags yanıtını besler.
 */
export async function readKk1OnlineOnlyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_ONLINE_ONLY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 etiket geri-okutma doğrulaması (scan-back) açık mı? Default false.
 *
 * Print & verify: "etiket çıktı" sinyali yazılımdan alınamaz (BT yazıcı baskı
 * onayı döndürmez) — tek güvenilir kanıt basılan barkodun GERİ OKUTULMASIDIR.
 * Açıkken mobil KK1, basılan her etiket için okutma ister ve okutulmadan yeni
 * top girişine izin vermez. ENFORCE istemcidedir; bu okuma yalnız
 * feature-flags yanıtını besler.
 */
export async function readKk1LabelScanVerifyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_LABEL_SCAN_VERIFY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 "Tüm Girişler" listesi tüm operatörleri kapsasın mı? Default false.
 *
 * Kapalıyken (varsayılan) mobil KK1'in "Tüm Girişler" modalı yalnız oturumdaki
 * operatörün KENDİ girdiği topları listeler; sağdaki "Son Kayıtlar" listesi
 * bayraktan bağımsız HER ZAMAN kişiye özeldir. ENFORCE istemcidedir (istemci
 * kendi createdById filtresini gönderir) — bu bir yetki duvarı DEĞİL, saha
 * ekranı sadeleştirmesidir; paneldeki roll:read aynı veriyi zaten görür.
 */
export async function readKk1HistoryAllEntriesEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_HISTORY_ALL_ENTRIES_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Simüle kantardan gelen çuval tartısı kaydedilebilir mi? Default false = ENFORCE.
 * Backend `weighSack`'te zorlanır (yalnız UI rehberi DEĞİL) — çuval kg'si sevk
 * irsaliyesine/çeki listesine basıldığı için uydurulmuş sayı oraya girmemeli.
 * Demo/eğitim kurulumu açar; sahada gerçek MAC eşleştirilince `peripheral.service`
 * cihazın `simulate`'ini zaten `false` yapar.
 */
export async function readSimulatedWeightEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_SIMULATED_WEIGHT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İş emri "Parti Kodu" (batchNumber) otomatik mi üretilsin? Default false (manuel).
 * Sadece UI rehberi — backend ENFORCE ETMEZ: batchNumber boş gelirse her iki modda
 * da otomatik üretir. Flag yalnızca formun manuel/otomatik davranışını belirler.
 */
export async function readPartyCodeAuto(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_PARTY_CODE_AUTO },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İade kabulünde personel topun kalitesini değiştirebilsin mi? Default false.
 * Kapalıyken mobil İade ekranı kalite (derecelendirme) kontrolünü gizler; ayrıca
 * backend `createReturn`'de gönderilen qualityGradeId override'ı YOK SAYILIR
 * (top çıktığı kaliteyle döner) — flag fiziksel etiketi belirlediği için sadece
 * UI rehberi değil, enforce edilir.
 */
export async function readReturnGradingEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.RETURN_GRADING_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Kartela kabulünde cm/kg ölçü alanlarının + kartela listelerinde ölçü
 * gösteriminin açık olup olmadığı. Default false (yalnız ADET). Diğer UI
 * flag'leri gibi backend ENFORCE etmez; frontend gizler.
 */
export async function readKartelaMeasurementEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KARTELA_MEASUREMENT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin mi?
 * Default false (kapalı). Kapalıyken mobil Fason Sevk ekranında fason talimatı
 * alanı gizli; talimat yalnızca sevk edilen adımın notundan gelir. Sadece
 * UI rehberi — backend ENFORCE ETMEZ.
 */
export async function readFasonNoteMobileEntry(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_NOTE_MOBILE_ENTRY },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Mobil cihaz eşleştirmesi ZORUNLU mu? Default false (pasif). Kapalıyken (default)
 * eşleşmemiş/kayıtsız tabletler de sisteme girebilir ve çalışır — ancak işledikleri
 * topta makine atfı (RollMovement/RollOperation.machineId) NULL kalır. Açıkken bugünkü
 * davranış: eşleşmemiş/pasif cihaz device.middleware'de 401 DEVICE_INACTIVE ile kesilir.
 * Diğer flag'lerin aksine ENFORCE edilir (middleware + mobileUsers + mobil pairing gate).
 */
export async function readDevicePairingRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

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

/**
 * Kurşun bypass düzeni açık mı? Default FALSE (KAPALI). Fabrika kurşun istasyonlarına
 * tablet koymuyorsa açılır: kurşun fiziksel olarak yapılır, dijital izlenmez (hatalar
 * kâğıtta) ve yetkili personel kurşun adımındaki iş emrini fiziksel bir kurşun
 * istasyonuna ATAR; adım Tambur'da kart okutmasıyla (ya da kurşun son adımsa dağıtım
 * ekranından) COMPLETED olur.
 *
 * ENFORCE edilir ama kapsamı DAR — yalnız YENİ ATAMA OLUŞTURMAYI kapılar. Zaten
 * dağıtılmış iş emirleri bayrak sonradan kapansa da bypass rejiminde biter (iptal /
 * son-adım tamamlama / Tambur onayı çalışır): rejim ATAMA SATIRINDA kalıcıdır
 * (`KursunBypassAssignment`), ayarda değil. Aksi halde bayrağı kapatmak, kurşunu
 * fiziksel olarak görmüş ama dijital karşılığı açık kalmış işleri sahada kilitlerdi.
 *
 * UNCACHED (enforcement yolu — `getFeatureFlags` cache'i üzerinden okunmaz); kayıt
 * yoksa false. `getFeatureFlags` bu fonksiyonu in-memory client ile çağırır.
 */
/**
 * Paketleme grubu açık mı. Satır YOKSA `false` — yani bugünkü davranış: Paketleme
 * ekranı düz liste, "Hemen Sevk Et" içi dolu her çuvalı gönderir.
 */
export async function readPackingGroupsEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKING_GROUPS_ENABLE },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Grup numara rejimi. Satır yoksa / değer kümede değilse `artan` (saha kararı).
 * `includes` sigortası: elle SQL ya da eski dump çöp yazarsa sayaç sessizce
 * rejim değiştirmesin.
 */
/**
 * Döküm ad rejimi. Satır yoksa / değer kümede değilse `ikisi` (bugünkü çıktı).
 */
export async function readSackDumpNameMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<SackDumpNameMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SACK_DUMP_NAME_MODE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && SACK_DUMP_NAME_MODES.includes(v as SackDumpNameMode)) {
    return v as SackDumpNameMode;
  }
  return DEFAULT_SACK_DUMP_NAME_MODE;
}

export async function readPackingGroupNumbering(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PackingGroupNumbering> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKING_GROUP_NUMBERING },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && PACKING_GROUP_NUMBERINGS.includes(v as PackingGroupNumbering)) {
    return v as PackingGroupNumbering;
  }
  return DEFAULT_PACKING_GROUP_NUMBERING;
}

export async function readKursunBypassEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Parti no KISA ve DÖNEN mi (P01…P99, 99'dan sonra P01)? Default TRUE/AÇIK.
 *
 * UNCACHED (enforcement yolu) — `generateBatchNumberTx` her parti doğuşunda tx
 * İÇİNDE okur. Maliyeti önemsiz: parti doğuşu günde onlarca kez olur, binlerce değil.
 *
 * ⚠️ Kayıt YOKSA `true` döner. Diğer çoğu bayraktan farklı olarak varsayılan AÇIK
 * (2026-08-05 kullanıcı kararı: "bayrak varsayılan olarak açık gelsin") — yani
 * deploy edildiği an panele hiç dokunulmadan yeni biçime geçilir. Bu satır aynı
 * zamanda ACİL KAPATMA anahtarıdır: kısa numara sahada sorun çıkarırsa tek geri
 * dönüş yolu bayrağı kapatmaktır (eski `P + GGAAYY + sıra` kalıbına düşülür).
 */
export async function readBatchLastNumberHintEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BATCH_LAST_NUMBER_HINT_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: talebi eden fabrika, kayıt yoksa görsün.
  if (!setting) return true;
  return asBoolean(setting.value);
}

export async function readBatchShortNumberEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BATCH_SHORT_NUMBER_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: kayıt yoksa true.
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * TOP KALİTESİ ZORUNLU MU (D6)? Default FALSE = bugünkü davranış.
 *
 * ⚠️ DÜZ OKUYUCU, `resolve*` DEĞİL — ve bu bilinçli bir karardır. Bayrağın KK1
 * dalı `createInitialEntry` motorunda yaşar; o motor ÇEKİRDEKTİR (tasarım
 * karar #2: "motor çekirdek, sunum modülde") ve üretim modülü kapalı bir
 * toptancı kurulumunda da aynı Roll'ları doğuracaktır. Üretim şalterine
 * bağlansaydı, üretim kapalıyken kalite kuralı SESSİZCE yok olurdu.
 *
 * Kapsam listesi ve kapsam DIŞI bırakılanların gerekçesi `SETTING_KEYS`
 * yorumunda; bekçi `scripts/test_quality_batch_flags.ts`.
 */
export async function readQualityGradeRequiredEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.QUALITY_GRADE_REQUIRED_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * AÇIK PARTİ YOKKEN SUNUCU PARTİYİ KENDİSİ AÇSIN MI (D7)? Default FALSE.
 *
 * ⚠️ Düz okuyucu (`resolve*` YOK): parti nesnesi üretim modülüne ait olsa da
 * bu bayrağın tek tüketicisi `tambur-manual.service` ve o servis üretim kapılı
 * router'ların (`tambur.routes`, `mobile` Tambur uçları) arkasında yaşıyor —
 * ikinci bir şalter, aynı kapıyı iki kez kilitlemek olurdu. Bayrağın adı
 * "zorunlu" DEĞİL "otomatik": gerekçe `SETTING_KEYS` yorumunda.
 *
 * ⚠️ Bu cümle VARSAYIM DEĞİL, ÖLÇÜM (2026-09-03): kapısız 70 route'tan başlayan
 * ulaşım grafiği 329 dosyaya varıyor ve `tambur-manual.service.ts` o kümede
 * YOK. Aynı cümlenin `workorder.defaultPlanDurationDays` için kurulan hâli
 * YANLIŞTI (bkz. §3.6 başlığı) — "router kapılı" demek "servise kapısız yoldan
 * ulaşılamaz" demek DEĞİLDİR ve her seferinde ölçülmesi gerekir. Yeni bir
 * çağıran eklenirse (örn. panelden elle top ekleme) bu ölçüm YENİLENİR.
 */
export async function readBatchAutoCreateEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BATCH_AUTO_CREATE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

// =============================================================================
// §3.6 — MODÜL ALTI BAYRAKLARIN TEK RESOLVER'LARI (D8, 2026-09-03)
// =============================================================================
// SORUN: alt bayrak okuyucuları HAM değer döndürüyor ve enforcement noktaları
// onları doğrudan çağırıyordu → modül KAPALIYKEN de alt bayrağın kuralı
// koşmaya devam ediyordu. Ölçüldü (Dilim 2 keşfi): `requireProductionEnabled`
// kapısı olmayan route'lardan 443 kaynak dosyanın 350'sine hâlâ ulaşılıyor,
// yani "route kapısı zaten var" cümlesi bu bayraklar için YETERLİ DEĞİL.
//
// KALIP (emsal `resolveYarnOutOnInvoiceEnabled`): resolver okuyucu katmanında
// yaşar, gövde sırası ANLAMLIDIR — en dıştaki modül şalterinden içeri; kapalı
// modülde alt bayrağın DEĞERİ HİÇ SORULMAZ.
//
// ⚠️ `getFeatureFlags` HAM okuyucuyu çağırmaya DEVAM EDER (P1/K4 dersi): panel
// kendi yazdığı değeri geri okumak zorunda. Etkin değeri döndürseydik, modülü
// kapalı bir kurulumda kullanıcı bayrağı açar ve toggle kapalı görünmeye devam
// ederdi.
//
// ⚠️ KAPSAM: yalnız EBEVEYNİ OLAN ve modül kapalıyken çalışması ANLAMSIZ olan
// bayraklar. ÇEKİRDEK kalanlar (resolver YOK, gerekçeli): `kk1.*` (stok-giriş
// motoru) · sevkiyat/depo · ana veri · sipariş · sistem/kimlik/belge ·
// `quality.gradeRequiredEnabled` + `batch.autoCreateEnabled` (yukarıdaki iki
// okuyucunun notları) · `fason.*` ve `kartela.*` (ait oldukları `modul.fason` /
// `modul.kartela` ANAHTARLARI P1'de YAZILMADI — ebeveyni olmayan bayrağa
// resolver kurulamaz; anahtarlar doğduğunda buraya taşınırlar).
//
// ⚠️ `workorder.defaultPlanDurationDays` BİLİNÇLİ MUAF ve gerekçe TEK CÜMLE:
// bu bir SAYISAL VARSAYILAN (plan bitiş tarihi boş bırakılırsa +N gün), enforce
// edilen bir KURAL değil — resolver'ın işi "modül kapalıysa kuralı koşturma"dır
// ve burada koşacak kural yok ("modül kapalıyken hangi sayı" sorusunun anlamlı
// bir cevabı da yok: 0 gün planı bozar, null kolonun tipini bozar).
//
// ⚠️ "Router zaten kapılı" GEREKÇE DEĞİLDİR — ölçüldü ve YANLIŞ olurdu:
// `workorder.routes` `requireProductionEnabled` taşıyor ama tek tüketici
// `workorder.service`e kapısız yoldan da ulaşılıyor
// (`routes/order.routes.ts → services/order.service.ts → services/workorder.service.ts`;
// 80 route'un 70'i üretim kapısı taşımıyor, ulaşılan dosya 329). Bu bayrağın
// muafiyeti bu yüzden ULAŞILABİLİRLİĞE değil, bayrağın CİNSİNE dayanır.
// =============================================================================

/** Alış siparişi aşımı bloklansın mı — ETKİN değer (`ticaret && bayrak`). */
export async function resolvePurchaseBlockOverReceiptEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readTicaretEnabled(tx))) return false;
  return readPurchaseBlockOverReceiptEnabled(tx);
}

/** Mal kabulde fiyat zorunlu mu — ETKİN değer (`ticaret && bayrak`). */
export async function resolveGoodsReceiptRequirePriceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readTicaretEnabled(tx))) return false;
  return readGoodsReceiptRequirePriceEnabled(tx);
}

/** Kurşun bypass düzeni — ETKİN değer (`üretim && bayrak`). */
export async function resolveKursunBypassEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readKursunBypassEnabled(tx);
}

/**
 * Tambur metraj aşımı serbest mi — ETKİN değer (`üretim && bayrak`).
 *
 * ⚠️ HAM VARSAYILAN AÇIK, ETKİN DEĞER ÜRETİM KAPALIYKEN KAPALI. Yön bilinçli:
 * aşımı kabul etmek bir ÜRETİM gerçeğidir (tambur asıl ölçüm noktası); üretim
 * modülü kullanılmayan bir kurulumda o gerçeğin karşılığı yoktur ve "kayıtlıdan
 * fazla metraj" sessizce kabul edilmemelidir.
 */
export async function resolveTamburOverQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readTamburOverQuantityEnabled(tx);
}

/** Tambur "tümden geri al" aynı-gün sınırı — ETKİN değer (`üretim && bayrak`). */
export async function resolveTamburUndoFullSameDayOnly(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readTamburUndoFullSameDayOnly(tx);
}

/** Parti no kısa/dönen biçimi — ETKİN değer (`üretim && bayrak`). */
export async function resolveBatchShortNumberEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readBatchShortNumberEnabled(tx);
}

/**
 * Müşteri şubeleri (sevk noktaları) UI'da açık mı? Default TRUE (açık — mevcut
 * davranış). "Her şube = ayrı müşteri" düzenine geçen firma kapatır: Electron
 * müşteri formundaki Şubeler sekmesi/taslağı ve sipariş formundaki şube seçimi
 * gizlenir. Salt UI rehberi — backend ENFORCE ETMEZ (branchId taşıyan istekler
 * işlenmeye devam eder, mevcut veri korunur).
 */
export async function readCustomerBranchesEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.CUSTOMER_BRANCHES_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: kayıt yoksa true döner (flag eklenmeden önceki davranış).
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi? Default TRUE (açık).
 * Açıkken operatör (tambur asıl ölçüm noktası olduğu için) kayıtlıdan fazla ölçtüğünde
 * kabul edilir — aşımda parent top tamamen tüketilir (currentQty=0), negatif kalan oluşmaz.
 * Admin kapatırsa tambur kesim/finalize'de çıkış > giriş ise 400 ile reddedilir. Diğer
 * flag'lerin aksine backend ENFORCE eder: tambur guard'ları (finalize / cutOpenFabric /
 * cutWarehouseRoll) yalnız aşım anında okur.
 */
/**
 * Kısa kesim → otomatik A1 FABRİKA VARSAYILANI. Kayıt yoksa **false**.
 *
 * Yön gerekçesi (`readTamburUndoFullSameDayOnly` emsali): bu bayrak bir ÜRETİM
 * GERÇEĞİNİ kabul etmez, operatörün kalite seçimini DEĞİŞTİRİR — davranış
 * değiştiren kurallar sessizce açık doğmaz, fabrika bilerek açar.
 */
export async function readTamburShortCutA1Enabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_SHORT_CUT_A1_ENABLED },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/**
 * Kısa kesim eşiği (metre). Kayıt yok / geçersiz / pozitif değilse **null** —
 * yani kural inert. `readLabelCopies` kırpma kalıbının null-varyantı: bozuk
 * ayar yüzünden istek DÜŞÜRÜLMEZ, kural sessizce devre dışı kalır (kalite
 * kararı zaten operatörde; fail-safe yön "otomatik yazma").
 */
export async function readTamburShortCutA1ThresholdM(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number | null> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_SHORT_CUT_A1_THRESHOLD_M },
    select: { value: true },
  });
  if (!setting) return null;
  const parsed = asNumber(setting.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Fason kabulünde çekme uyarısı — default **TRUE (açık)**.
 *
 * Yön gerekçesi `readTamburShortCutA1Enabled`'ın TERSİ ve bilinçli: bu bayrak
 * operatörün kararını DEĞİŞTİRMEZ, yalnız görünür bir gerçeği (giden ↔ dönen
 * farkı) gösterir. Görünürlük varsayılan olarak açık doğar; sessizlik bilerek
 * seçilir. Kapatmak "farkı hiç gösterme" demektir — defter yine yazılır.
 */
export async function readFasonShrinkWarnEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_SHRINK_WARN_ENABLED },
    select: { value: true },
  });
  if (!setting) return true;
  return asBoolean(setting.value);
}

/** Fabrika varsayılanı — boyahane çekmesi tipik olarak %8-12 bandındadır. */
export const DEFAULT_FASON_SHRINK_TOLERANCE_PCT = 10;

/**
 * Çekme toleransı (yüzde). Kayıt YOKSA varsayılan (%10); kayıt VARSA `0` dahil
 * ne yazıldıysa o.
 *
 * ⚠️ `readTamburShortCutA1ThresholdM`'in `<= 0 → null` kalıbı BURADA YANLIŞ
 * OLURDU: orada 0 "eşik girilmemiş" demek, burada 0 "hiç tolerans yok" demek
 * ve ikisi zıt davranışlar üretir (kural inert ↔ kural her farkta ateşler).
 * Bozuk/negatif değer varsayılana düşer (fail-safe: uyarı susmasın diye değil,
 * bilinmeyen bir sayıyla operatörü şaşırtmamak için).
 */
export async function readFasonShrinkTolerancePct(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_SHRINK_TOLERANCE_PCT },
    select: { value: true },
  });
  if (!setting) return DEFAULT_FASON_SHRINK_TOLERANCE_PCT;
  const parsed = asNumber(setting.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return DEFAULT_FASON_SHRINK_TOLERANCE_PCT;
  }
  return parsed;
}

/** Mükerrer paneli — bulanık ad eşleştirme (default TRUE; kayıt yoksa açık). */
/**
 * Demo modu açık mı. KAYIT YOKSA **FALSE** — panel `defaultOn: false` ile
 * birebir (bekçi `test_feature_flag_contract` §12 bu eşitliği ölçer).
 *
 * ⚠️ Varsayılanın FALSE olması bu bayrağın en önemli özelliğidir: sürüme sızan
 * bir demo yardımcısı, fabrikada hiçbir şey yapılmadığı sürece ETKİSİZDİR.
 */
export async function readDemoModeEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEMO_MODE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export async function readDuplicatesFuzzyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DUPLICATES_FUZZY_ENABLED },
    select: { value: true },
  });
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * Mükerrer paneli — bulanık benzerlik eşiği (yüzde). Kayıt yoksa ya da aralık
 * dışıysa varsayılan (90). Alt sınır `DUPLICATES_FUZZY_MIN_PCT` (50).
 */
export async function readDuplicatesFuzzyThresholdPct(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DUPLICATES_FUZZY_THRESHOLD_PCT },
    select: { value: true },
  });
  if (!setting) return DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT;
  const parsed = asNumber(setting.value);
  if (
    parsed === null ||
    !Number.isFinite(parsed) ||
    parsed < DUPLICATES_FUZZY_MIN_PCT ||
    parsed > 100
  ) {
    return DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT;
  }
  return parsed;
}

export async function readTamburOverQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: kayıt yoksa true döner. Admin açıkça kapatırsa (value=false)
  // asBoolean false verir → guard'lar tekrar aşımı reddeder.
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * Tambur "TÜMDEN geri al" için aynı-gün sınırı açık mı.
 *
 * Default KAPALI (kayıt yoksa `false`) — `readTamburOverQuantityEnabled`'ın
 * TERSİ yönde varsayılan taşır ve bu bilinçlidir: aşım bayrağı bir ÜRETİM
 * gerçeğini kabul eder (tambur asıl ölçüm noktası), bu ise bir KISITTIR ve
 * kısıtlar sessizce açık doğmaz.
 */
export async function readTamburUndoFullSameDayOnly(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_UNDO_FULL_SAME_DAY_ONLY },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/**
 * Refakat kartı marka/içerik ayarını okur (yoksa/eksikse default'lara düşer).
 * buildSnapshot bunu çağırıp config'i karta dondurur.
 */
export async function readTravelerCardConfig(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<TravelerCardConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TRAVELER_CARD_CONFIG },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return DEFAULT_TRAVELER_CARD_CONFIG;
  }
  return normalizeTravelerCardConfig(v as Record<string, unknown>);
}

/**
 * Belge künyesini okur (yoksa boş künye). irsaliye/çeki üst bloğunda firma adının
 * altına basılır.
 */
export async function readCompanyLetterhead(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<CompanyLetterhead> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.COMPANY_LETTERHEAD },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return DEFAULT_COMPANY_LETTERHEAD;
  }
  const o = v as Record<string, unknown>;
  return {
    addressLine: typeof o.addressLine === "string" ? o.addressLine : "",
    phone: typeof o.phone === "string" ? o.phone : "",
    taxInfo: typeof o.taxInfo === "string" ? o.taxInfo : "",
    extraLines: Array.isArray(o.extraLines)
      ? o.extraLines.filter((x): x is string => typeof x === "string").slice(0, 5)
      : [],
  };
}

/** Belge logosu kütüphanesi — bkz. SETTING_KEYS.DOCUMENTS_LOGO. */
export interface DocumentsLogo {
  current: string | null;
  items: Record<string, string>;
}

const EMPTY_DOCUMENTS_LOGO: DocumentsLogo = { current: null, items: {} };

/** data URL formatı + boyut guard'ı (100KB binary ≈ 137KB base64; üst sınır 160K karakter). */
const LOGO_DATAURL_RE = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const LOGO_MAX_CHARS = 160_000;
// A8: setDocumentsLogo read-merge-write kuyruğu — süreç-içi seri (yalnız method
// gövdesinde okunur; modül değerlendirmesi bittiğinde tanımlı).
let documentsLogoWriteQueue: Promise<unknown> = Promise.resolve();

/** Belge logosu kütüphanesini okur (yoksa boş). */
export async function readDocumentsLogo(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<DocumentsLogo> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOCUMENTS_LOGO },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY_DOCUMENTS_LOGO;
  const o = v as Record<string, unknown>;
  const items: Record<string, string> = {};
  if (o.items && typeof o.items === "object" && !Array.isArray(o.items)) {
    for (const [k, val] of Object.entries(o.items as Record<string, unknown>)) {
      if (typeof val === "string") items[k] = val;
    }
  }
  const current = typeof o.current === "string" && items[o.current] ? o.current : null;
  return { current, items };
}

/**
 * Yazdırılan belge içerik ayarını HAM okur (yoksa boş map). Çözüm (varsayılanlarla
 * birleştirme) client tarafında resolveDocConfig ile yapılır — backend yalnız saklar.
 */
export async function readDocumentsConfig(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<DocumentsConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOCUMENTS_CONFIG },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return sanitizeDocumentsConfig(v as Record<string, unknown>);
}

/**
 * Belge ayar map'ini güvenli tipe indirger: bilinmeyen alanları atar, tip uymayan
 * değerleri yok sayar. Saklamadan önce ve okuduktan sonra uygulanır.
 */
export function sanitizeDocumentsConfig(raw: Record<string, unknown>): DocumentsConfig {
  const out: DocumentsConfig = {};
  for (const [docKey, val] of Object.entries(raw)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    const cfg: DocumentConfig = {};
    if (typeof o.titleOverride === "string") {
      cfg.titleOverride = o.titleOverride.trim().slice(0, 80);
    }
    if (typeof o.showLetterhead === "boolean") cfg.showLetterhead = o.showLetterhead;
    if (typeof o.showSignatures === "boolean") cfg.showSignatures = o.showSignatures;
    if (typeof o.footerNote === "string") {
      cfg.footerNote = o.footerNote.trim().slice(0, 500);
    }
    if (o.sections && typeof o.sections === "object" && !Array.isArray(o.sections)) {
      const sections: Record<string, boolean> = {};
      for (const [sk, sv] of Object.entries(o.sections as Record<string, unknown>)) {
        if (typeof sv === "boolean") sections[sk] = sv;
      }
      cfg.sections = sections;
    }
    if (Array.isArray(o.signatureLabels)) {
      cfg.signatureLabels = o.signatureLabels
        .filter((x): x is string => typeof x === "string")
        .slice(0, 6)
        .map((x) => x.trim().slice(0, 40));
    }
    const style = sanitizeDocStyleConfig(o.style);
    if (style) cfg.style = style;
    if (typeof o.showLogo === "boolean") cfg.showLogo = o.showLogo;
    if (o.logoPosition === "left" || o.logoPosition === "right") {
      cfg.logoPosition = o.logoPosition;
    }
    if (o.columns && typeof o.columns === "object" && !Array.isArray(o.columns)) {
      const columns: NonNullable<DocumentConfig["columns"]> = {};
      for (const [tk, tv] of Object.entries(o.columns as Record<string, unknown>)) {
        if (!tv || typeof tv !== "object" || Array.isArray(tv)) continue;
        const tvo = tv as Record<string, unknown>;
        const entry: {
          hidden?: string[];
          order?: string[];
          shown?: string[];
          labels?: Record<string, string>;
        } = {};
        if (Array.isArray(tvo.hidden)) {
          entry.hidden = tvo.hidden
            .filter((x): x is string => typeof x === "string")
            .slice(0, 20);
        }
        if (Array.isArray(tvo.order)) {
          entry.order = tvo.order
            .filter((x): x is string => typeof x === "string")
            .slice(0, 20);
        }
        if (Array.isArray(tvo.shown)) {
          entry.shown = tvo.shown
            .filter((x): x is string => typeof x === "string")
            .slice(0, 20);
        }
        // KOLON BAŞLIĞI ÖZELLEŞTİRME (2026-09-04). Boş dize SAKLANMAZ =
        // "varsayılana dön" (renderer da aynı yorumu yapar; ikisi ayrışırsa
        // kullanıcı kutuyu boşaltır, ayar kaydolur, başlık geri gelmez).
        if (tvo.labels && typeof tvo.labels === "object" && !Array.isArray(tvo.labels)) {
          const labels: Record<string, string> = {};
          for (const [ck, cv] of Object.entries(tvo.labels as Record<string, unknown>)) {
            if (typeof cv !== "string") continue;
            const t = cv.trim().slice(0, 40);
            if (t) labels[ck.slice(0, 40)] = t;
          }
          // Tablo başına kolon sayısı sınırı `hidden`/`order` ile aynı (20).
          const keys = Object.keys(labels).slice(0, 20);
          if (keys.length) {
            entry.labels = Object.fromEntries(keys.map((k) => [k, labels[k] as string]));
          }
        }
        // ⚠️ `shown` bu kapıya EKLENMELİ — yoksa yalnız opt-in kolon açılmış bir satır
        // (hidden/order boş) sessizce atılır: kullanıcı kolonu açar, ayar kaydolmaz,
        // sebebi hiçbir yerde görünmez. (`labels` aynı sebeple burada.)
        if (
          entry.hidden?.length ||
          entry.order?.length ||
          entry.shown?.length ||
          entry.labels
        ) {
          columns[tk.slice(0, 40)] = entry;
        }
      }
      if (Object.keys(columns).length) cfg.columns = columns;
    }
    if (typeof o.qr === "boolean") cfg.qr = o.qr;
    if (o.stamps && typeof o.stamps === "object" && !Array.isArray(o.stamps)) {
      const so = o.stamps as Record<string, unknown>;
      const stamps: NonNullable<DocumentConfig["stamps"]> = {};
      if (typeof so.printedAt === "boolean") stamps.printedAt = so.printedAt;
      if (typeof so.printedBy === "boolean") stamps.printedBy = so.printedBy;
      if (typeof so.copyLabel === "string") stamps.copyLabel = so.copyLabel.trim().slice(0, 20);
      if (Object.keys(stamps).length) cfg.stamps = stamps;
    }
    if (Array.isArray(o.blocks)) {
      const blocks = (o.blocks as unknown[])
        .filter(
          (b): b is { position: string; text: string } =>
            !!b &&
            typeof b === "object" &&
            typeof (b as Record<string, unknown>).text === "string" &&
            ((b as Record<string, unknown>).position === "afterHeader" ||
              (b as Record<string, unknown>).position === "beforeSignatures"),
        )
        .slice(0, 4)
        .map((b) => ({
          position: b.position as "afterHeader" | "beforeSignatures",
          text: b.text.trim().slice(0, 500),
        }))
        .filter((b) => b.text);
      if (blocks.length) cfg.blocks = blocks;
    }
    if (o.language === "tr" || o.language === "en" || o.language === "auto") {
      cfg.language = o.language;
    }
    if (typeof o.blankWidths === "boolean") cfg.blankWidths = o.blankWidths;
    if (o.footerNotePlacement === "top" || o.footerNotePlacement === "bottom") {
      cfg.footerNotePlacement = o.footerNotePlacement;
    }
    // ⚠️ AŞAĞIDAKİ ÜÇ ALAN BU KAPIDAN GEÇMEZSE AYAR SESSİZCE KAYBOLUR: kullanıcı
    // panelde ayarlar, Kaydet'e basar, istek 200 döner ve hiçbir şey olmaz —
    // sebebi de hiçbir yerde yazmaz. (`columns.shown` bu tuzağa bir kez düştü.)
    const fields = sanitizeDocFields(o.fields);
    if (fields) cfg.fields = fields;
    if (o.placements && typeof o.placements === "object" && !Array.isArray(o.placements)) {
      const placements: Record<string, "left" | "right"> = {};
      for (const [pk, pv] of Object.entries(o.placements as Record<string, unknown>)) {
        if (pv === "left" || pv === "right") placements[pk.slice(0, 40)] = pv;
      }
      if (Object.keys(placements).length) cfg.placements = placements;
    }
    if (o.gridGroups === 3 || o.gridGroups === 4 || o.gridGroups === 5) {
      cfg.gridGroups = o.gridGroups;
    }
    if (typeof o.gridRows === "number" && Number.isFinite(o.gridRows)) {
      cfg.gridRows = Math.min(40, Math.max(1, Math.round(o.gridRows)));
    }
    // BOŞ GRID — kayıt kapısının DÖRDÜNCÜ ayağı. ⚠️ Bu satır olmadan panelden
    // kaydedilen grid SESSİZCE ATILIR (kullanıcı ayarlar, kaydolmaz, sebebi
    // hiçbir yerde yazmaz). `gridRows`/`fields`/`placements` de aynı boşluktan
    // geçmişti — bekçi: `test_fason_ceki_html` §18 round-trip.
    const bg = sanitizeBlankGrid(o.blankGrid);
    if (bg) cfg.blankGrid = bg;
    out[docKey] = cfg;
  }
  return out;
}

/**
 * ERP'nin kurulduğu firmanın adını okur (yoksa/boşsa default'a düşer). Panel
 * marka başlığı + uygulama geneli kullanır. Refakat kartının kendi firma adından
 * bağımsızdır (kart snapshot'ı ayrı saklanır, geçmiş kartlar değişmez).
 */
export async function readCompanyName(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.COMPANY_NAME },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && v.trim() ? v : DEFAULT_COMPANY_NAME;
}

/**
 * Pozitif tamsayı setting okuyucu — yoksa veya geçersizse default döner.
 * 0/negatif/NaN/Infinity → default. Float verilirse Math.floor uygulanır.
 */
async function readPositiveIntSetting(
  key: string,
  fallback: number,
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  if (!setting) return fallback;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return fallback;
  return Math.floor(parsed);
}

/**
 * Sipariş termini default gün sayısı. Order.create'de deadline verilmediyse
 * orderDate + N gün hesaplanır. Yoksa/geçersizse 7.
 */
export async function readOrderDefaultDeadlineDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}

/**
 * İş emri planlama default süresi (gün). WorkOrder.create/update'de
 * plannedEndDate verilmediyse plannedStartDate + N gün hesaplanır.
 * Yoksa/geçersizse 7.
 */
export async function readWorkOrderDefaultPlanDurationDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}

/**
 * Oturum (JWT) ömrünü SAAT olarak okur. Yoksa/geçersizse 8 (eski sabit davranış).
 * 1 saatin altı → default; tavanı MAX_SESSION_DURATION_HOURS'a (30 gün) kırpılır.
 * AuthService.login bunu okuyup jwt.sign expiresIn'e (saniye) çevirir.
 */
export async function readSessionDurationHours(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SESSION_DURATION_HOURS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_SESSION_DURATION_HOURS;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_SESSION_DURATION_HOURS;
  return Math.min(Math.floor(parsed), MAX_SESSION_DURATION_HOURS);
}

/**
 * Oturum (JWT) ömrünü DAKİKA olarak okur — dakika-granüler yeni ayar (tek kaynak).
 * Öncelik: auth.sessionDurationMinutes. Bu satır YOKSA geriye-uyum: eski
 * auth.sessionDurationHours ×60 (o da yoksa/geçersizse 480 = 8 saat). Değer
 * 1..MAX_SESSION_DURATION_MINUTES (43200 = 30 gün) aralığına kırpılır.
 * AuthService.issueToken bunu okuyup jwt.sign expiresIn'e (×60 saniye) çevirir.
 */
export async function readSessionDurationMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES },
    select: { value: true },
  });
  const clamp = (n: number) =>
    Math.min(Math.max(1, Math.floor(n)), MAX_SESSION_DURATION_MINUTES);
  if (!setting) {
    // Dakika satırı yok → eski saat ayarına düş (×60), o da yoksa default 480.
    const hoursSetting = await client.systemSetting.findUnique({
      where: { key: SETTING_KEYS.AUTH_SESSION_DURATION_HOURS },
      select: { value: true },
    });
    if (!hoursSetting) return DEFAULT_SESSION_DURATION_MINUTES;
    const hours = asNumber(hoursSetting.value);
    if (hours === null || hours < 1) return DEFAULT_SESSION_DURATION_MINUTES;
    return clamp(Math.floor(hours) * 60);
  }
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_SESSION_DURATION_MINUTES;
  return clamp(parsed);
}

/**
 * Hareketsizlik zaman aşımını DAKİKA olarak okur. Yoksa/geçersizse 0 (kapalı).
 * 0 = kapalı (otomatik çıkış yok); tavanı MAX_IDLE_TIMEOUT_MINUTES'a (24 saat) kırpılır.
 * Frontend (Electron AppShell) bunu okuyup idle logout sayacını kurar — backend
 * token'ı yine kendi mutlak ömrüne kadar geçerli kalır (idle salt UI tarafı).
 */
export async function readIdleTimeoutMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_IDLE_TIMEOUT_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_IDLE_TIMEOUT_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_IDLE_TIMEOUT_MINUTES;
  return Math.min(Math.floor(parsed), MAX_IDLE_TIMEOUT_MINUTES);
}
/**
 * Çalışma oturumu (WorkSession) hareketsizlik zaman aşımını DAKİKA olarak okur.
 * Yoksa/geçersizse 600 (10 saat); 0 = kapalı; tavan 1440. Backend TEMBEL enforce
 * eder — timer/cron yok: resolveActiveSession / sweepIdleSessions okuma anında
 * süresi dolan oturumu IDLE ile kapatır (work-session.helper.ts).
 */
export async function readWorkSessionIdleTimeoutMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORK_SESSION_IDLE_TIMEOUT_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_WORK_SESSION_IDLE_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_WORK_SESSION_IDLE_MINUTES;
  return Math.min(Math.floor(parsed), MAX_WORK_SESSION_IDLE_MINUTES);
}

/**
 * Aynı-tip oturum politikasını okur: 'kick' (default) | 'notify' | 'off'. Yoksa/
 * geçersizse 'kick' (eskiyi düşür, yeni kazanır). AuthService.issueToken bunu okuyup
 * SessionRegistryService.openLoginSession'a geçirir (backend ENFORCE).
 */
export async function readSameTypeSessionPolicy(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<SameTypeSessionPolicy> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && SAME_TYPE_SESSION_POLICIES.includes(v as SameTypeSessionPolicy)) {
    return v as SameTypeSessionPolicy;
  }
  return DEFAULT_SAME_TYPE_SESSION_POLICY;
}

/**
 * Token süresi dolunca istemci otomatik çıkış yapsın mı? Default TRUE (kayıt yoksa).
 * Client (mobil + Electron) ENFORCE eder — JWT exp decode → süre dolunca logout.
 */
export async function readAutoLogoutOnExpiry(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY },
    select: { value: true },
  });
  if (!setting) return DEFAULT_AUTO_LOGOUT_ON_EXPIRY;
  return asBoolean(setting.value);
}

/**
 * Mobil hareketsizlik ekran kilidi açık mı? Default TRUE (kayıt yoksa). Client (mobil)
 * ENFORCE eder — tablet mobileIdleLockMinutes kadar dokunulmazsa kilit ekranı gelir.
 */
export async function readMobileIdleLockEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_MOBILE_IDLE_LOCK_ENABLED },
    select: { value: true },
  });
  if (!setting) return DEFAULT_MOBILE_IDLE_LOCK_ENABLED;
  return asBoolean(setting.value);
}

/**
 * Mobil "uygulama arka plana geçince anında kilitle" açık mı? Default TRUE (kayıt
 * yoksa). Idle kilitten bağımsız. Client (mobil) ENFORCE eder — AppState 'active'
 * dışına çıkınca kilit ekranı gelir (work session açık kalır; kart/PIN ile açılır).
 */
export async function readMobileLockOnBackground(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_MOBILE_LOCK_ON_BACKGROUND },
    select: { value: true },
  });
  if (!setting) return DEFAULT_MOBILE_LOCK_ON_BACKGROUND;
  return asBoolean(setting.value);
}

/**
 * Mobil idle kilit süresini DAKİKA olarak okur. Yoksa/geçersizse 10; 1..120 aralığına
 * kırpılır. Client (mobil) ENFORCE eder.
 */
export async function readMobileIdleLockMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_MOBILE_IDLE_LOCK_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_MOBILE_IDLE_LOCK_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_MOBILE_IDLE_LOCK_MINUTES) return DEFAULT_MOBILE_IDLE_LOCK_MINUTES;
  return Math.min(Math.floor(parsed), MAX_MOBILE_IDLE_LOCK_MINUTES);
}

/**
 * Mutlak oturum tavanını GÜN olarak okur. Yoksa/geçersizse 30. 0 = süresiz (KABUL
 * edilir — reader 0 döner); negatif → default. Tavan 365'e kırpılır. AuthService
 * .issueToken bunu okur: zaman aşımı kapalıyken bile token en fazla bu kadar gün
 * yaşar (capDays>0 → now+capDays gün exp; capDays=0 → gerçekten süresiz).
 */
export async function readAbsoluteSessionCapDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_ABSOLUTE_SESSION_CAP_DAYS;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_ABSOLUTE_SESSION_CAP_DAYS;
  return Math.min(Math.floor(parsed), MAX_ABSOLUTE_SESSION_CAP_DAYS);
}

/**
 * Hızlı-PIN/kart deneme kilidi açık mı? Default TRUE (kayıt yoksa). Kapalıyken
 * login-lockout middleware hiç bloklamaz. Backend ENFORCE eder.
 */
export async function readPinLockoutEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_ENABLED;
  return asBoolean(setting.value);
}

/** Kilit tetiklenene kadar izin verilen yanlış deneme (default 5, 1..20). */
export async function readPinLockoutAttempts(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_ATTEMPTS;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_ATTEMPTS) return DEFAULT_PIN_LOCKOUT_ATTEMPTS;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_ATTEMPTS);
}

/**
 * Otomatik gece yedeğinin saati (0-23, yerel saat).
 *
 * Öncelik: SystemSetting (`backup.hour`) → `BACKUP_HOUR` env → 3.
 * Env fallback'i geriye-uyum içindir: ayar UI'dan hiç kaydedilmemiş kurulumlarda
 * ecosystem.config.js'deki değer geçerli kalır. Scheduler bunu HER turda okur,
 * dolayısıyla admin saati değiştirdiğinde süreç yeniden başlatılmaz.
 */
export async function readBackupHour(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BACKUP_HOUR },
    select: { value: true },
  });
  const fromDb = asNumber(setting?.value);
  if (fromDb !== null && Number.isInteger(fromDb) && fromDb >= MIN_BACKUP_HOUR && fromDb <= MAX_BACKUP_HOUR) {
    return fromDb;
  }
  const fromEnv = Number(process.env.BACKUP_HOUR);
  if (Number.isInteger(fromEnv) && fromEnv >= MIN_BACKUP_HOUR && fromEnv <= MAX_BACKUP_HOUR) {
    return fromEnv;
  }
  return DEFAULT_BACKUP_HOUR;
}

/**
 * Offsite metin ayarlarının ORTAK okuyucusu: SystemSetting → env → "".
 *
 * ⚠️ ÖNCELİK YAZILI OLMAK ZORUNDA (`backup.hour` emsali). İki kaynaklı bir ayarda
 * öncelik belirsizse "panelde değiştirdim, değişmedi" sınıfı sessiz hata doğar —
 * kullanıcı ayarı yaptığını sanır, sistem env'i okumaya devam eder ve hiçbir
 * yerde uyarı çıkmaz.
 *
 * Boş string ile kaydedilen değer "KAPAT" demektir ve env'e DÜŞMEZ: aksi halde
 * panelden hedefi silmek imkânsız olurdu (silince env geri gelirdi).
 */
async function readOffsiteText(
  key: string,
  envName: string,
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  // Kayıt VARSA (boş olsa bile) o kazanır — bilinçli bir "kapat" kararıdır.
  if (setting && typeof setting.value === "string") return setting.value.trim();
  return (process.env[envName] ?? "").trim();
}

/** Offsite uzak hedef (rclone). Boş = kapalı. */
export async function readOffsiteRemote(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  return readOffsiteText(SETTING_KEYS.BACKUP_OFFSITE_REMOTE, "BACKUP_RCLONE_REMOTE", tx);
}

/** Offsite YEREL ikinci hedef (ağ paylaşımı / ikinci disk). Boş = kapalı. */
export async function readOffsiteDir(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  return readOffsiteText(SETTING_KEYS.BACKUP_OFFSITE_DIR, "BACKUP_OFFSITE_DIR", tx);
}

/** Kısa ceza süresi, SANİYE (default 60, 5..3600). */
export async function readPinLockoutPenaltySec(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_PENALTY_SEC;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_PENALTY_SEC) return DEFAULT_PIN_LOCKOUT_PENALTY_SEC;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_PENALTY_SEC);
}

/** Kaç ceza turundan sonra uzun cezaya geçilir (default 3, 1..20). */
export async function readPinLockoutEscalateAfter(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_ESCALATE_AFTER) return DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_ESCALATE_AFTER);
}

/** Uzun ceza süresi, DAKİKA (default 15, 1..1440). */
export async function readPinLockoutLongPenaltyMin(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_LONG_PENALTY_MIN) return DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_LONG_PENALTY_MIN);
}

/**
 * Giriş kilidi yapılandırmasının TAMAMI — TEK sorguda.
 *
 * NEDEN: `login-lockout.ts` her PIN/kart giriş denemesinde bu beş ayarı beş ayrı
 * `findUnique` ile okuyordu. Beşi tek `findMany`'ye iner.
 *
 * ⚠️ BU BİR ÖNBELLEK DEĞİL. Yukarıdaki (bkz. featureFlagsCache notu) "per-flag
 * enforcement reader'ları KASITEN cache'siz kalır — middleware tazeliği aynen
 * korunur" kuralı burada da geçerli: bu fonksiyon HER çağrıda canlı DB'yi okur,
 * TTL yok, invalidation yok. Yönetici kilidi sıkılaştırdığında bir sonraki
 * denemede geçerlidir. Sadece round-trip sayısı 5→1 düşer.
 *
 * Desen `getFeatureFlags`'tan alındı (findMany + Map + sentetik findUnique
 * client'ı) — parse/clamp/default mantığı KOPYALANMAZ, tek kaynak yine
 * okuyucuların kendisidir. Fark: burada `key: { in: [...] }` filtresi var, çünkü
 * ayar tablosu büyüdükçe gereksiz satır çekmenin anlamı yok.
 *
 * 🔒 `valueByKey.has(...)` KONTROLÜ LOAD-BEARING — `.get(...) ?? null` YAZMA.
 * `value` sütunu jsonb ve JSON `null` saklanabilir; eksik anahtar için `null`
 * yerine `{ value: null }` döndüren bir shim `readPinLockoutEnabled`'ı bozar:
 * satır YOKKEN doğru cevap DEFAULT (=true, kilit AÇIK) ama `asBoolean(null)`
 * `false` (kilit KAPALI) verir. Canlı DB'de o satır seed'lenmiyor → giriş kilidi
 * her temiz kurulumda SESSİZCE devre dışı kalırdı. Diğer dört okuyucuda ikisi de
 * DEFAULT'a düşer (zararsız); ayrışma yalnız `enabled`'da.
 */
export async function readPinLockoutConfig(tx?: Pick<typeof prisma, "systemSetting">): Promise<{
  enabled: boolean;
  attempts: number;
  penaltySec: number;
  escalateAfter: number;
  longPenaltyMin: number;
}> {
  const client = tx ?? prisma;
  const keys = [
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN,
  ];
  const rows = await client.systemSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const valueByKey = new Map(rows.map((r) => [r.key, r.value] as const));
  const oneShot = {
    systemSetting: {
      findUnique: (args: { where: { key: string } }) =>
        Promise.resolve(
          valueByKey.has(args.where.key) ? { value: valueByKey.get(args.where.key) } : null,
        ),
    },
  } as unknown as Pick<typeof prisma, "systemSetting">;

  return {
    enabled: await readPinLockoutEnabled(oneShot),
    attempts: await readPinLockoutAttempts(oneShot),
    penaltySec: await readPinLockoutPenaltySec(oneShot),
    escalateAfter: await readPinLockoutEscalateAfter(oneShot),
    longPenaltyMin: await readPinLockoutLongPenaltyMin(oneShot),
  };
}

/**
 * Mobil giriş yöntemlerini okur: { enabled, primary }. Backend ENFORCE eder —
 * login-card yalnız "card", login-quick-pin yalnız "pin" etkinken çalışır
 * (kapalıyken ilgili altyapı saldırı yüzeyi açmaz); klasik /auth/login HEP açık.
 * GERİYE-UYUM: yeni key yoksa eski auth.loginMode'dan türetilir
 * ("card" → kart öncelikli + liste yedek; "pin"/yok → yalnız liste).
 */
export async function readLoginMethods(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<LoginMethodsConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_METHODS },
    select: { value: true },
  });
  const v = setting?.value as { enabled?: unknown; primary?: unknown } | null | undefined;
  if (v && typeof v === "object" && Array.isArray(v.enabled)) {
    const enabled = v.enabled.filter((m): m is LoginMethod =>
      LOGIN_METHODS.includes(m as LoginMethod),
    );
    if (enabled.length > 0) {
      const primary =
        typeof v.primary === "string" && enabled.includes(v.primary as LoginMethod)
          ? (v.primary as LoginMethod)
          : enabled[0];
      return { enabled: Array.from(new Set(enabled)), primary };
    }
  }
  // Geriye-uyum: eski tekil mod (Faz 5 ilk hali).
  const legacy = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_MODE },
    select: { value: true },
  });
  if (legacy?.value === "card") return { enabled: ["card", "list"], primary: "card" };
  return DEFAULT_LOGIN_METHODS;
}

/**
 * Saha #6: top etiketi kopya adedi (default 2 — topun üstüne + altına).
 * 1-5 aralığına kırpılır; geçersiz/yok → 2.
 */
export const DEFAULT_LABEL_COPIES = 2;
export async function readLabelCopies(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_COPIES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_LABEL_COPIES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_LABEL_COPIES;
  return Math.min(Math.floor(parsed), 5);
}

/** Sistem varsayılan etiket medyası (cihazsız baskı/önizleme/kartela). Kayıt yoksa
 *  100×148 / 203dpi / gap 2 / pay 3 (kod fallback). */
export interface DefaultLabelMedia {
  widthMm: number;
  heightMm: number;
  dpi: number;
  gapMm: number;
  marginMm: number;
}
export const CODE_DEFAULT_MEDIA: DefaultLabelMedia = {
  widthMm: 100, heightMm: 148, dpi: 203, gapMm: 2, marginMm: 3,
};
export async function readDefaultLabelMedia(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<DefaultLabelMedia> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_DEFAULT_MEDIA },
    select: { value: true },
  });
  const v = setting?.value as Record<string, unknown> | null | undefined;
  if (!v || typeof v !== "object") return CODE_DEFAULT_MEDIA;
  // width/height/dpi > 0 zorunlu; gap/margin 0 GEÇERLİ (sıfır boşluk/pay).
  const pos = (x: unknown, fb: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : fb);
  const nonNeg = (x: unknown, fb: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fb);
  return {
    widthMm: pos(v.widthMm, CODE_DEFAULT_MEDIA.widthMm),
    heightMm: pos(v.heightMm, CODE_DEFAULT_MEDIA.heightMm),
    dpi: pos(v.dpi, CODE_DEFAULT_MEDIA.dpi),
    gapMm: nonNeg(v.gapMm, CODE_DEFAULT_MEDIA.gapMm),
    marginMm: nonNeg(v.marginMm, CODE_DEFAULT_MEDIA.marginMm),
  };
}


/**
 * Faz-2 opt-in: native etiket komutları yazıcıya doğrudan (RAW TCP 9100) gönderilsin mi.
 * Default false (Faz-1 simülasyon — hiç socket açılmaz). Açıkken printer-transport
 * gerçek gönderim yapar; ENFORCE edilir.
 */
export async function readLabelNativeSendEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Mobil (HC-06/BT) baskıda raster GW bitmap gönderilsin mi? Default FALSE (kayıt yoksa →
 * komut yolu). Electron raster'ından (PeripheralDevice.rasterMode) BAĞIMSIZ. Client (mobil)
 * ENFORCE eder: açıkken mobil `encoding=b64` ile raster ister, kapalıyken komut yolu.
 */
export async function readMobileRasterEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_MOBILE_RASTER_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * "Etiketsiz" işaretli kalitelerde (`QualityGrade.skipLabel` — sahada FİRE) de
 * OTOMATİK etiket basılsın mı? Default FALSE (kayıt yoksa → fire topa kâğıt ÇIKMAZ).
 *
 * ⚠️ Bu ayar TEK BAŞINA bir şey söylemez — hangi kalitenin "etiketsiz" olduğunu
 * kalite kataloğu (`skipLabel`) söyler. İkisi birlikte okunur; kural KALİTEDE
 * yaşıyor: etiket politikası dispozisyondan AYRI bir karardır (yarın A1_STOCK'a
 * inen ama etiketsiz bir kademe eklenebilir). Tasarım anında ayrıca ZORUNLUYDU —
 * FİRE o gün WAREHOUSE'a iniyordu; FIRE→SCRAP aynı gün ayrıca düzeltildi.
 */
export async function readScrapGradeLabelEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_SCRAP_GRADE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

