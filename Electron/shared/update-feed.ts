import musteri from "./musteri.json";

/**
 * Bu paketin ait olduğu MÜŞTERİ — güncelleme kanalını belirleyen tek değer.
 *
 * ⚠️ Bu dosyayı elle düzenleme. Müşteri, paketleme komutuyla seçilir:
 *
 *     ./deploy/electron-paketle.sh <müşteri-kodu>
 *
 * Script `shared/musteri.json`'ı ve `package.json > build.publish` adresini
 * BİRLİKTE yazar, sonra derlenen paketin İÇİNDEKİ gömülü adresi okuyup doğru
 * müşteriyi gösterdiğini doğrular.
 *
 * NEDEN BU KADAR DİKKAT: yayın adresi pakete derleme anında gömülür. Yanlış
 * müşteri kodu taşıyan bir paket, **başka bir fabrikanın güncellemelerini
 * indirip kurar** — ve bu hata sessizdir: dosyalar kendi aralarında tutarlıdır,
 * yalnızca yanlış müşteriyi gösterirler. Tek müşteriyle görünmez, ikincisinde
 * patlar.
 */
export const MUSTERI_KODU = musteri.kod;
export const MUSTERI_ADI = musteri.ad;

/**
 * BU FABRİKANIN DIŞ (İNTERNET) ADRESİ — uzaktan erişim tüneline bakan adres.
 *
 * ⚠️ GÜNCELLEME ADRESİNDEN TÜRETİLMEZ ve türetilmemeli. İkisi AYRI KANALDIR:
 * güncelleme paketi yayın sunucusundan gelir (`guncelleme.etkiliyazilim.com`),
 * ERP ise fabrikanın kendi tünelinden. Aynı `musteri.kod`u paylaşmaları bir
 * tesadüftür, bağımlılık değil — birini diğerinden üretmek, bir gün biri
 * değiştiğinde diğerini sessizce yanlışlar. (Aynı ders mobilde ölçüldü:
 * API kanalı ile güncelleme kanalı bilerek ayrı tutuluyor.)
 *
 * NEREDE KULLANILIR: iki adımlı doğrulama kurulum bağlantısı. Yönetici o
 * bağlantıyı FABRİKA İÇİNDEN üretiyor; adres buradan gelmezse bağlantı
 * `http://192.168.1.250:4000/...` olur ve kullanıcının telefonunda AÇILMAZ.
 *
 * Boş bırakılırsa (uzaktan erişim kullanmayan kurulum) bağlantı mevcut
 * adresten üretilir — LAN'da kurulum yapan kurulumlar için doğru davranış.
 */
export const ERP_DIS_ADRESI: string = (musteri as { erpAdresi?: string }).erpAdresi ?? "";

/** Tüm müşterilerin ortak yayın kökü. */
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
 * bu adrese EKLEYEREK ister (`<url>latest.yml`).
 *
 * ⚠️ Bu alan adı Cloudflare'de **proxy'si AÇIK** (turuncu bulut) olmak
 * zorundadır. Sunucudaki sertifika bir **Cloudflare Origin CA** sertifikasıdır
 * ve ona yalnız Cloudflare Edge güvenir; kayıt DNS-only'ye (gri bulut)
 * çevrilirse istemci doğrudan origin'e bağlanır, sertifikayı reddeder ve
 * güncelleme SESSİZCE durur (panelde "sertifika kabul edilmedi" yazar).
 */
export const DEFAULT_UPDATE_FEED_URL = `${UPDATE_BASE_URL}${MUSTERI_KODU}/electron/`;

/**
 * Makineye özel adres ezmesi (secure-store anahtarı). Normalde BOŞTUR.
 *
 * Neden var: yayın adresi pakete derleme anında gömülür. Adres yanlış gömülür
 * ya da sonradan değişirse, düzeltmenin tek yolu yeni bir setup dosyası dağıtmak
 * olurdu — yani tam da kaçınmaya çalıştığımız elle tur. Bu anahtar o çıkmazın
 * kaçış kapısı: Genel Ayarlar → Bu Bilgisayar → Güncelleme'den adres yazılır,
 * uygulama bir sonraki kontrolde oradan arar.
 */
export const UPDATE_FEED_OVERRIDE_KEY = "config.updateFeedUrl";
