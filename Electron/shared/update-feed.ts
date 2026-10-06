import { UPDATE_FEED_URL, UPDATE_GROUP_FEEDS } from "./channel";

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
 * Yol **grup bazlıdır** (`/<grup>/electron/`, dağıtım kaydının güncelleme grupları); bütün gruplar
 * aynı indirme kökündedir ve fabrika grubunu kirasından alır.
 *
 * Adres sonunda `/` ile biter: electron-updater `latest.yml` ve setup dosyasını
 * bu adrese EKLEYEREK ister (`<url>latest.yml`). Değer dağıtım kaydından gelir
 * (`scripts/check-dagitim.mjs` ölçer).
 *
 * ⚠️ Bu alan adı Cloudflare'de **proxy'si AÇIK** (turuncu bulut) olmak
 * zorundadır. Sunucudaki sertifika bir **Cloudflare Origin CA** sertifikasıdır
 * ve ona yalnız Cloudflare Edge güvenir; kayıt DNS-only'ye (gri bulut)
 * çevrilirse istemci doğrudan origin'e bağlanır, sertifikayı reddeder ve
 * güncelleme SESSİZCE durur (panelde "sertifika kabul edilmedi" yazar).
 */
// Dinlenme grubunun gömülü adresi (electron-builder tabanı, izinli ana makinenin kaynağı);
// çalışan panel feed'i kiradaki gruptan seçer (`groupFeedUrl`).
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
 * Güncelleme adresine izin verilen TEK ana makine — gömülü adresten türer (dağıtım kaydının
 * `indirmeKoku`, bütün gruplar aynı kökte).
 * Liste koda yazılmaz; indirme belirteci başlığı yalnız bu ana makineye gider.
 */
export const ALLOWED_UPDATE_HOST: string = new URL(DEFAULT_UPDATE_FEED_URL).host;

const FEED_PATH_PATTERN = /^\/([a-z0-9][a-z0-9-]{0,39})\/electron\/$/;

/**
 * Grup kodu → o grubun panel feed'i (dağıtım kaydından); tanınmayan/biçimsiz → null. Feed ve künyenin beklenen
 * kanalı fabrikanın doğrulanmış kirasındaki GÜNCELLEME GRUBUndan gelir (TEK-ORTAK-PAKET §3.4); grup bilinmiyorsa
 * güncelleme denetlenmez.
 */
export function groupFeedUrl(grup: unknown): string | null {
  if (typeof grup !== "string") return null;
  return Object.prototype.hasOwnProperty.call(UPDATE_GROUP_FEEDS, grup) ? (UPDATE_GROUP_FEEDS[grup] ?? null) : null;
}

/** Grup bilinmediği için denetim yapılmadığında operatöre görünen cümle (Ayarlar + elle denetim baloncuğu). */
export const GROUP_UNKNOWN_TEXT =
  "Güncelleme grubu bilinmiyor: sunucuya bağlanıp oturum açıldığında ve lisans etkinken denetlenir.";

export type FeedOverrideCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Ezme adresinin kuralı: yalnız `https:` · ana makine dağıtım kaydından türeyen
 * güncelleme sunucusu · yol `/<grup>/electron/` (`<grup>` dağıtım kaydının güncelleme gruplarından biri) · kullanıcı adı/parola, port, sorgu ve parça YOK. Döndürdüğü `url` normalize edilmiş biçimdir (sonda `/`).
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
  if (!seg) return { ok: false, reason: "Yol /<grup>/electron/ biçiminde olmalı." };
  if (!groupFeedUrl(seg)) return { ok: false, reason: `Tanınmayan güncelleme grubu: ${seg}.` };
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
