// =============================================================================
// TeksERP — İSTEMCİ KÜNYESİ BAŞLIKLARI (bilgilendirme, kapı DEĞİL)
// =============================================================================
// Sahadaki her istemci (masaüstü panel, tablet, tarayıcı) her isteğe kendi
// künyesini ekler: NE olduğu, HANGİ sürümü koştuğu, HANGİ kurulum olduğu.
// Backend bunları yalnız "Bağlı İstemciler" ekranı için toplar.
//
// ⚠️⚠️ BU BAŞLIKLAR HİÇBİR YETKİ/KAPI KARARINA GİRMEZ — istemci bunları
// istediği gibi uydurabilir (curl'le tek satır). Bir gün biri
// `X-Client-Kind: electron` gördüğü için bir kontrolü atlarsa, kapı UYDURULMUŞ
// BİR BAŞLIKLA geçilir hale gelir.
//
// Bu depoda tam olarak bu sınıf bir hata bir kez ısırdı: `CLIENT_IP_HEADER`
// app-wide okunduğunda LAN'daki biri `CF-Connecting-IP` uydurup giriş kilidini
// ve hız sınırını etkisizleştirebiliyordu (2026-09-01, patron modülü) —
// düzeltme başlığın kapsamını daraltmaktı. Buradaki kural daha da katı:
// KAPSAM YOK, yalnız gösterim.
//
// Bekçi: `scripts/test_client_registry.ts` §1 — bu başlık adlarının
// `src/middlewares/client-info.middleware.ts` ve `src/lib/client-registry.ts`
// DIŞINDA hiçbir kaynak dosyada geçmediğini MEKANİK olarak ölçer. Yani bir
// kapıya bağlanması derleme değil BEKÇİ hatasıdır.
//
// ⚠️ `x-device-id` DEĞİL, AYRI BAŞLIK. Masaüstü panel `x-device-id`
// GÖNDERMEZ ve bu bilinçlidir (`Electron/src/services/apiClient.ts`):
// gönderseydi `devicePairingRequired` açıkken cihaz middleware'i onaysız cihaz
// sayıp panelin TÜM isteklerini 401 `DEVICE_INACTIVE` ile keserdi → ayarı açan
// admin kendi paneline giremezdi (deadlock). Künye başlığı o kapıdan tamamen
// bağımsızdır; hiçbir middleware ona bakmaz.
// =============================================================================

/** Başlık adları — TEK KAYNAK. Express başlıkları küçük harfe indirger. */
export const CLIENT_INFO_HEADERS = {
  /** İstemci türü: electron | mobil | web */
  kind: "x-client-kind",
  /** İstemcinin kendi sürümü ("1.2.6"). Web'de yok (backend ile birlikte gider). */
  version: "x-client-version",
  /**
   * Kurulum kimliği — makine/cihaz başına KALICI, sır DEĞİL.
   *
   * ⚠️ Değeri istemciler zaten var olan kalıcı kimliklerinden verir; bu iş için
   * İKİNCİ bir kimlik üretilmez:
   *   · masaüstü panel → `Electron/src/lib/deviceId.ts` (`getOrCreateDeviceId`,
   *     secure-store'da; panel bunu `POST /api/devices/announce` ile ZATEN
   *     bildiriyor, yani `Device` satırı var — ekrandaki makine ADI oradan
   *     çözülür, başlıktan DEĞİL)
   *   · tablet → mobil `getOrCreateDeviceId` (aynı değer `x-device-id`de de gider)
   *   · web    → tarayıcı profiline yazılan aynı anahtar (Device satırı yok)
   */
  instance: "x-client-instance",
} as const;

/** Tanınan istemci türleri — `CLIENT_VERSION_POLICIES` anahtarlarıyla aynı küme. */
export const CLIENT_KINDS = ["electron", "mobil", "web"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export function isClientKind(v: string): v is ClientKind {
  return (CLIENT_KINDS as readonly string[]).includes(v);
}

/**
 * Kurulum kimliği için kabul kalıbı — UUID'yi kapsayacak kadar geniş, çöp
 * anahtarın belleğe girmesini engelleyecek kadar dar. Uzunluk sınırı BELLEK
 * savunmasıdır (anahtar kümesi `MAX_CLIENTS` ile ayrıca sınırlı).
 */
const INSTANCE_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;
export function isPlausibleInstanceId(v: string): boolean {
  return INSTANCE_ID_RE.test(v);
}

/** Sürüm etiketi — semver + ön/son ekler. Uymayan değer NULL sayılır (uydurulmaz). */
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
export function isPlausibleVersion(v: string): boolean {
  return VERSION_RE.test(v);
}

/**
 * Oturum kaydına (`Session.clientVersion`) yazılacak istemci sürümünü çöz.
 *
 * ⚠️ NEDEN BURADA, ÇAĞIRANIN İÇİNDE DEĞİL: başlık ADI bu dosyanın dışına
 * çıkmaz (`test_client_registry` §1). Çağıran tarafa `readHeader(req,
 * "x-client-version")` yazmak, adı bir KARAR dosyasına taşımak olurdu — ve
 * bekçi ilk gün kırmızı verirdi. Fonksiyon dışarı çıkar, ad çıkmaz.
 *
 * ⚠️ BU DEĞER HÂLÂ KAPI DEĞİLDİR. Yazıldığı yer bir GÖZLEMDİR: "son 30 günde
 * sahada hangi sürümler görüldü". Tek okuyucusu kaldırma fazı kapısıdır
 * (`test_rol_modeli_kalinti` ④) ve oradaki hüküm bir İNSAN kararını besler,
 * bir isteği kabul/red etmez. Uydurulmuş bir sürüm kimseye yetki kazandırmaz;
 * ⇒ *eksiklik güvenli yöndedir*: başlığı hiç göndermeyen eski istemci NULL
 * bırakır ve kol "ÖLÇÜLEMEDİ" der — "temiz" DEMEZ.
 *
 * Kabul kalıbına uymayan değer NULL sayılır (uydurulmaz, kırpılmaz).
 */
export function readClientVersionHeader(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const raw = headers[CLIENT_INFO_HEADERS.version];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed && isPlausibleVersion(trimmed) ? trimmed : null;
}
