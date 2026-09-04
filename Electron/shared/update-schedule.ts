/**
 * GÜNCELLEME KONTROL RİTMİ — TEK KAYNAK.
 *
 * Zamanlayıcının kendisi YALNIZ main process'tedir (`electron/ipc/updater.ipc.ts`).
 * Buradaki değerler o tek zamanlayıcıyı besler; arayüz bunları **yalnız metin
 * yazmak için** okur (tooltip "15 dakikada bir kendiliğinden denetlenir" der).
 *
 * ⚠️ ARAYÜZDE İKİNCİ BİR ZAMANLAYICI KURMA. Renderer'da bir `setInterval` daha
 * açmak, panel birden çok pencereyle çalıştığında (ya da sekme yeniden mount
 * olduğunda) aynı ritmi çoğaltır ve yayın sunucusuna pencere sayısı kadar istek
 * gider. Arayüzün güncelleme ile ilişkisi tek yönlüdür: durumu DİNLER, elle
 * denetleme için `check()` ÇAĞIRIR — kendi takvimini kurmaz.
 */

/**
 * Açılıştan sonraki İLK kontrolün gecikmesi. Splash 16 sn'ye kadar sürebiliyor
 * (`main.ts` finishSplash); kontrolü onun üstüne bindirmek açılışı ağırlaştırır.
 */
export const UPDATE_FIRST_CHECK_DELAY_MS = 30_000;

/**
 * Periyodik kontrol aralığı: **15 dakika** (2026-09-04 kullanıcı kararı; eskiden
 * 4 saatti).
 *
 * Gerekçe: fabrika makineleri günlerce açık kalıyor ve sürüm çıkıldığında
 * "panelin kendiliğinden görmesi" 4 saate kadar sürüyordu — o pencerede sahaya
 * "kapatıp aç" deniyordu, yani otomatik güncellemenin çözdüğü iş elle yapılıyordu.
 * Maliyet ölçülebilir biçimde küçük: kontrol yalnız `latest.yml`i (birkaç yüz
 * bayt) okur ve Cloudflare onu önbelleklemez; makine başına saatte 4 istek.
 */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Aralığın operatör diline çevirisi — tooltip metni buradan beslenir. */
export const UPDATE_CHECK_INTERVAL_LABEL = "15 dakikada bir";
