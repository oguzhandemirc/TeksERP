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
  sanitizeBlankGrid,
  sanitizeDocFields,
  sanitizeDocStyleConfig,
  type BlankGridConfig,
  type DocFieldStyle,
  type DocStyleConfig,
} from "./document-render/doc-style";
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
  /** İade kabulünde personel topun kalitesini değiştirebilsin mi. Default false
   *  (kapalıyken kalite butonu gizlenir + backend gönderilen override'ı yok sayar). */
  RETURN_GRADING_ENABLED: "return.gradingEnabled",
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
  /** Sevk geri alma (storno) YALNIZ aynı fabrika gününde mi yapılabilsin. Default false
   *  (KAPALI = zaman sınırı YOK). Açıkken `dispatchedAt` bugünün fabrika günü başlangıcından
   *  (Europe/Istanbul) önceyse 409. Fatura ve iade koşulları bu ayardan BAĞIMSIZ ve her
   *  zaman geçerlidir — bu yalnız EK bir daraltmadır. ENFORCE edilir (backend). */
  SHIPMENT_UNDO_SAME_DAY_ONLY: "shipping.undoDispatchSameDayOnly",
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
  /** Tablo kolonu aç/kapa + sıralama: { [tabloKey]: { hidden, order, shown } } —
   *  renderer document-render/doc-table.ts ile uygular. `hidden` blocklist (normal
   *  kolonlar), `shown` allowlist (yalnız `defaultHidden` opt-in kolonlar — çuval
   *  yorumu gibi iç veri; onlarda `hidden` yok sayılır). */
  columns?: Record<string, { hidden?: string[]; order?: string[]; shown?: string[] }>;
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
  targetQuantityEnabled: boolean;
  rawWidthEnabled: boolean;
  /** KK1 ham kumaş girişinde ağırlık (kg) alanı gösterilsin mi. Default false;
   *  backend ENFORCE eder (kapalıyken gelen weightKg reddedilir). */
  kk1WeightEntryEnabled: boolean;
  /** Ham girişte mükerrer top tuzağı açık mı (default false). Backend ENFORCE
   *  eder: 90 sn içinde birebir aynı giriş 409 POSSIBLE_DUPLICATE alır ve ancak
   *  açık onayla (`confirmDuplicate`) geçer. */
  kk1DuplicateGuardEnabled: boolean;
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
  /** Sevk geri alma (storno) yalnız aynı fabrika gününde mi (default false = sınırsız).
   *  Faturasız + iadesiz koşulları bundan bağımsız her zaman geçerlidir. */
  shipmentUndoSameDayOnly: boolean;
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
  /** Kurşun bypass düzeni açık mı (default FALSE/kapalı). ENFORCE edilir ama YALNIZ
   *  yeni atama oluşturmayı kapılar; dağıtılmış iş emirleri bayrak kapansa da bypass
   *  rejiminde biter (rejim atama satırında kalıcıdır). */
  kursunBypassEnabled: boolean;
  /** Parti no kısa ve dönen mi (P01…P99)? Default TRUE/açık. Backend ENFORCE eder.
   *  Kapalıyken eski `P + GGAAYY + sıra` kalıbı. Açıkken parti no benzersiz DEĞİLDİR. */
  batchShortNumberEnabled: boolean;
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
      targetQuantityEnabled: await readTargetQuantityEnabled(cacheClient),
      rawWidthEnabled: await readRawWidthEnabled(cacheClient),
      kk1WeightEntryEnabled: await readKk1WeightEntryEnabled(cacheClient),
      kk1DuplicateGuardEnabled: await readKk1DuplicateGuardEnabled(cacheClient),
      shippingSimulatedWeightEnabled: await readSimulatedWeightEnabled(cacheClient),
      returnGradingEnabled: await readReturnGradingEnabled(cacheClient),
      kartelaMeasurementEnabled: await readKartelaMeasurementEnabled(cacheClient),
      partyCodeAuto: await readPartyCodeAuto(cacheClient),
      fasonNoteMobileEntry: await readFasonNoteMobileEntry(cacheClient),
      devicePairingRequired: await readDevicePairingRequired(cacheClient),
      shipmentConfirmationEnabled: await readShipmentConfirmationEnabled(cacheClient),
      shipmentUndoSameDayOnly: await readShipmentUndoSameDayOnly(cacheClient),
      customerBranchesEnabled: await readCustomerBranchesEnabled(cacheClient),
      travelerCardConfig: await readTravelerCardConfig(cacheClient),
      companyLetterhead: await readCompanyLetterhead(cacheClient),
      documentsConfig: await readDocumentsConfig(cacheClient),
      tamburOverQuantityEnabled: await readTamburOverQuantityEnabled(cacheClient),
      tamburUndoFullSameDayOnly: await readTamburUndoFullSameDayOnly(cacheClient),
      kursunBypassEnabled: await readKursunBypassEnabled(cacheClient),
      batchShortNumberEnabled: await readBatchShortNumberEnabled(cacheClient),
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
   * Bir feature flag'i toggle et. Kabul: { pricingEnabled: boolean }.
   * Verilmeyen alanlar dokunulmaz.
   */
  async setFeatureFlags(
    input: Partial<FeatureFlags>,
    userId: string | undefined
  ): Promise<ApiResponse<FeatureFlags>> {
    if (!userId) throw AppError.unauthorized();

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
 * kullanır (recomputeOrderStatus için kritik). tx yoksa dış prisma client.
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
        const entry: { hidden?: string[]; order?: string[]; shown?: string[] } = {};
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
        // ⚠️ `shown` bu kapıya EKLENMELİ — yoksa yalnız opt-in kolon açılmış bir satır
        // (hidden/order boş) sessizce atılır: kullanıcı kolonu açar, ayar kaydolmaz,
        // sebebi hiçbir yerde görünmez.
        if (entry.hidden?.length || entry.order?.length || entry.shown?.length) {
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

