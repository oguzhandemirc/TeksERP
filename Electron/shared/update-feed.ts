import { CHANNEL_CODE, CHANNEL_NAME, UPDATE_FEED_URL, UPDATE_GROUP_FEEDS } from "./channel";

/**
 * Bu paketin ait olduğu MÜŞTERİ (dağıtım kanalı) — güncelleme kanalını belirleyen tek değer.
 *
 * ⚠️ Kanal paketleme komutuyla seçilir ve derleme ANINDA gömülür (`shared/channel.ts`,
 * kaynak `deploy/kanallar.json`); ağaçta yazılı bir değer yoktur:
 *
 *     ./deploy/electron-paketle.sh <müşteri-kodu>
 *
 * Script aynı kanalın kimliğini electron-builder'a da (`app-update.yml`, appId, ürün adı)
 * verir, sonra derlenen paketin İÇİNİ okuyup doğru kanalı gösterdiğini doğrular.
 *
 * NEDEN BU KADAR DİKKAT: yayın adresi pakete derleme anında gömülür. Yanlış
 * müşteri kodu taşıyan bir paket, **başka bir fabrikanın güncellemelerini
 * indirip kurar** — ve bu hata sessizdir: dosyalar kendi aralarında tutarlıdır,
 * yalnızca yanlış müşteriyi gösterirler. Tek müşteriyle görünmez, ikincisinde
 * patlar.
 */
export const MUSTERI_KODU = CHANNEL_CODE;
export const MUSTERI_ADI = CHANNEL_NAME;

/** ESKİ KANAL YOLUNUN yayın kökü (`deploy/kanallar.json`, check-kanallar §3); ortak paket bunu kullanmaz. */
export const UPDATE_BASE_URL = "https://guncelleme.etkiliyazilim.com/";

/**
 * Otomatik güncelleme yayın adresi — TEK KAYNAK.
 *
 * Bu değer İKİ yerde okunur ve ikisi de birbirine bağımlıdır:
 *  ① `package.json > build.publish[0].url` → electron-builder derleme sırasında
 *    paketin içine `app-update.yml` olarak GÖMER (kurulu uygulamanın gerçekten
 *    baktığı adres budur);
 *  ② `electron/ipc/updater.ipc.ts` → kullanıcıya "hangi adresten güncelleniyorum"
 *    diye gösterir ve elle kontrolde kullanır.
 *
 * ⚠️ İkisi ayrışırsa arıza SESSİZDİR: uygulama A adresinden güncelleme arar,
 * Ayarlar ekranı B adresini yazar ve "sunucuda dosya var ama gelmiyor" denir.
 * Bu yüzden eşitlik `src/test/update-feed-url.test.ts` bekçisiyle kilitli.
 *
 * Yol **müşteri bazlıdır** (`/<müşteri>/electron/`). Alan adı Etkili Yazılım'ın
 * genel güncelleme sunucusudur; her müşteri kendi klasöründe yaşar ve
 * diğerinin yayınını HİÇ görmez. Yeni müşteri eklemek sunucuda bir klasör
 * açmaktır — DNS kaydı, sertifika ya da yeni servis gerekmez. (Müşteri başına
 * ALT ALAN ADI seçilseydi wildcard sertifika `*.etkiliyazilim.com` iki seviyeli
 * adları kapsamadığı için her müşteriye ayrı sertifika gerekirdi.)
 *
 * Adres sonunda `/` ile biter: electron-updater `latest.yml` ve setup dosyasını
 * bu adrese EKLEYEREK ister (`<url>latest.yml`). Değer kayıt defterinden gelir; kaydın
 * `<UPDATE_BASE_URL><kod>/electron/` biçimini `scripts/check-kanallar.mjs` §3 ölçer.
 *
 * ⚠️ Bu alan adı Cloudflare'de **proxy'si AÇIK** (turuncu bulut) olmak
 * zorundadır. Sunucudaki sertifika bir **Cloudflare Origin CA** sertifikasıdır
 * ve ona yalnız Cloudflare Edge güvenir; kayıt DNS-only'ye (gri bulut)
 * çevrilirse istemci doğrudan origin'e bağlanır, sertifikayı reddeder ve
 * güncelleme SESSİZCE durur (panelde "sertifika kabul edilmedi" yazar).
 */
// Ortak pakette bu, dinlenme grubunun gömülü adresidir (electron-builder tabanı, izinli ana makinenin kaynağı);
// çalışan panel feed'i kiradaki gruptan seçer (`GROUP_FLOW`, `groupFeedUrl`).
export const DEFAULT_UPDATE_FEED_URL: string = UPDATE_FEED_URL;

/**
 * Makineye özel adres ezmesi (secure-store anahtarı). Normalde BOŞTUR.
 *
 * Neden var: yayın adresi pakete derleme anında gömülür. Adres yanlış gömülür
 * ya da sonradan değişirse, düzeltmenin tek yolu yeni bir setup dosyası dağıtmak
 * olurdu — yani tam da kaçınmaya çalıştığımız elle tur. Bu anahtar o çıkmazın
 * kaçış kapısı: Genel Ayarlar → Bu Bilgisayar → Güncelleme'den adres yazılır,
 * uygulama bir sonraki kontrolde oradan arar.
 *
 * ⚠️ Ezme YALNIZ `validateFeedOverride`tan geçen değeri taşır — ana süreç hem
 * YAZARKEN hem OKURKEN denetler (renderer kapısı bir arayüz kapısıdır, sınır değil).
 */
export const UPDATE_FEED_OVERRIDE_KEY = "config.updateFeedUrl";

/**
 * Güncelleme adresine izin verilen TEK ana makine — gömülü adresten türer (ortak: dağıtım kaydının
 * `indirmeKoku`, bütün gruplar aynı kökte; eski kanal: `deploy/kanallar.json`, check-kanallar §3).
 * Liste koda yazılmaz; indirme belirteci başlığı yalnız bu ana makineye gider.
 */
export const ALLOWED_UPDATE_HOST: string = new URL(DEFAULT_UPDATE_FEED_URL).host;

const FEED_PATH_PATTERN = /^\/([a-z0-9][a-z0-9-]{0,39})\/electron\/$/;

/**
 * GRUP AKIŞI (tek ortak paket, TEK-ORTAK-PAKET §3.4): ortak pakette feed ve künyenin beklenen kanalı
 * fabrikanın doğrulanmış kirasındaki GÜNCELLEME GRUBUndan gelir (indirme belirteci yanıtı `grup`); grup
 * bilinmiyorsa güncelleme denetlenmez. Eski kanal yolunda `false`: feed ve künye kanalı gömülü değerdir.
 */
export const GROUP_FLOW: boolean = UPDATE_GROUP_FEEDS !== null;

/** Grup kodu → o grubun panel feed'i (dağıtım kaydından); tanınmayan/biçimsiz → null. Eski kanalda daima null. */
export function groupFeedUrl(grup: unknown): string | null {
  if (!UPDATE_GROUP_FEEDS || typeof grup !== "string") return null;
  return Object.prototype.hasOwnProperty.call(UPDATE_GROUP_FEEDS, grup) ? (UPDATE_GROUP_FEEDS[grup] ?? null) : null;
}

/** Grup bilinmediği için denetim yapılmadığında operatöre görünen cümle (Ayarlar + elle denetim baloncuğu). */
export const GROUP_UNKNOWN_TEXT =
  "Güncelleme grubu bilinmiyor: sunucuya bağlanıp oturum açıldığında ve lisans etkinken denetlenir.";

export type FeedOverrideCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Ezme adresinin kuralı: yalnız `https:` · ana makine kanal kaydından türeyen
 * güncelleme sunucusu · yol `/<kanal>/electron/` (ortak pakette `<kanal>` dağıtım kaydının
 * güncelleme gruplarından biri) · kullanıcı adı/parola, port, sorgu ve parça YOK. Döndürdüğü `url` normalize edilmiş biçimdir (sonda `/`).
 *
 * Neden bu kadar dar: adres electron-updater'ın paketi indirdiği yerdir ve
 * fabrikanın indirme belirteci de oraya gider. Düz http ağdaki aracıya, başka ana
 * makine ise belirteci de alan bir sunucuya kapı açardı. Kanal bağını ayrıca
 * imzalı künye ölçer: başka kanalın yolundan gelen sürüm KURULMAZ.
 */
export function validateFeedOverride(raw: string): FeedOverrideCheck {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Adres çözümlenemedi." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Güncelleme adresi https:// ile başlamalı (düz http kabul edilmez)." };
  if (u.username || u.password) return { ok: false, reason: "Adres kullanıcı adı/parola taşıyamaz." };
  if (u.host !== ALLOWED_UPDATE_HOST) return { ok: false, reason: `Yalnız ${ALLOWED_UPDATE_HOST} adresine izin verilir.` };
  if (u.search || u.hash) return { ok: false, reason: "Adres sorgu (?) ya da parça (#) taşıyamaz." };
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  const seg = FEED_PATH_PATTERN.exec(path)?.[1];
  if (!seg) return { ok: false, reason: `Yol /<${GROUP_FLOW ? "grup" : "kanal"}>/electron/ biçiminde olmalı.` };
  if (GROUP_FLOW && !groupFeedUrl(seg)) return { ok: false, reason: `Tanınmayan güncelleme grubu: ${seg}.` };
  return { ok: true, url: `https://${u.host}${path}` };
}

/** Geçerli feed adresinin grubu/kanalı (`/<x>/electron/` yolundaki `x`); geçersiz adres → null. */
export function feedGroupOf(url: string): string | null {
  const v = validateFeedOverride(url);
  return v.ok ? (FEED_PATH_PATTERN.exec(new URL(v.url).pathname)?.[1] ?? null) : null;
}

/** Bu adrese güncelleme isteği (ve indirme belirteci) gidebilir mi? */
export function isAllowedUpdateUrl(url: string): boolean {
  return validateFeedOverride(url).ok;
}
