// =============================================================================
// TeksERP Mobil — GÜNCELLEME KANALI adresleri (TEK KAYNAK)
// =============================================================================
// ⚠️ CommonJS olması BİLİNÇLİ: `app.config.js` Expo tarafından CommonJS olarak
// yüklenir ve `.mjs` dosyasını `require` edemez; script'ler ise ESM. `.cjs`
// ikisinden de okunabilen tek biçimdir. `scripts/lib/adres.mjs` buradan
// yeniden dışa açar — sabitin ikinci bir yazımı YOKTUR.
// =============================================================================

/**
 * Güncelleme sunucusunun KÖKÜ — müşteriden bağımsız.
 *
 * ⚠️ Yol düzeni `/<musteri>/<urun>/` (Electron ile AYNI standart). Müşteri
 * segmenti alt alan adı DEĞİL, çünkü Cloudflare Origin CA wildcard'ı
 * (`*.etkiliyazilim.com`) iki seviyeli adları kapsamaz.
 * ⚠️ Cloudflare proxy'si (turuncu bulut) AÇIK kalmalı — sertifikaya yalnız CF
 * Edge güvenir; DNS-only'ye çevrilirse Android reddeder ve güncelleme SESSİZCE
 * durur.
 */
const YAYIN_KOKU = 'https://guncelleme.etkiliyazilim.com/';

/**
 * Bu ağacın hangi müşteri için yapılandırıldığı — TEK KAYNAK.
 *
 * ⚠️ NEDEN DOSYA: adres pakete DERLEME ANINDA gömülür ve `expo prebuild`
 * bizim script'lerimizden bağımsız da koşulabilir. Müşteri yalnız bir komut
 * argümanında yaşasaydı, prebuild onu göremez ve ağaç "hangi müşteri için
 * yapılandırıldığını" hiçbir yerde kaydetmezdi.
 *
 * ⚠️ İKİNCİ FABRİKANIN SESSİZ ARIZASI TAM BURADA: kod yanlış kalırsa yeni
 * fabrikanın tabletleri ESKİ müşterinin güncellemesini çeker. Dosyalar kendi
 * aralarında tutarlı olduğu için hiçbir kapı bunu göremez — bkz. build-apk.mjs
 * `guncellemeKapisi`, beklenen değeri bu dosyadan DEĞİL komut argümanından alır.
 */
function musteriOku() {
  const yol = require('node:path').join(__dirname, '..', '..', 'musteri.json');
  const m = JSON.parse(require('node:fs').readFileSync(yol, 'utf8'));
  const kod = String(m.kod ?? '').trim();
  if (!/^[a-z0-9-]{2,32}$/.test(kod)) {
    throw new Error(
      `musteri.json → kod geçersiz ("${kod}"). URL yolu olacağı için yalnız ` +
        'küçük harf, rakam ve tire kabul edilir.',
    );
  }
  return { kod, ad: String(m.ad ?? kod) };
}

/** Bir müşterinin mobil yayın kökü: `<kök><musteri>/mobil/` */
function feedUrl(musteriKodu) {
  return `${YAYIN_KOKU}${musteriKodu}/mobil/`;
}

/**
 * Bu ağacın yapılandırıldığı müşterinin feed adresi.
 * (Eski adı `MOBIL_FEED_URL` — artık türetiliyor, elle yazılmıyor.)
 */
const MOBIL_FEED_URL = feedUrl(musteriOku().kod);

/** Sondaki `/` garantilenir — yol birleştirmenin tek kuralı. */
function normalizeFeed(url) {
  const v = String(url || '').trim();
  return v.endsWith('/') ? v : `${v}/`;
}

/**
 * Feed adresini çözer: `--update-url` → `EXPO_PUBLIC_UPDATE_URL` →
 * `musteri.json`dan türetilen.
 */
function guncellemeAdresiCoz(cliDeger) {
  if (cliDeger && cliDeger.trim()) {
    return { deger: normalizeFeed(cliDeger), kaynak: '--update-url argümanı' };
  }
  const env = process.env.EXPO_PUBLIC_UPDATE_URL;
  if (env && env.trim()) {
    return { deger: normalizeFeed(env), kaynak: 'EXPO_PUBLIC_UPDATE_URL ortam değişkeni' };
  }
  return { deger: MOBIL_FEED_URL, kaynak: 'yerleşik sabit (scripts/lib/adres.mjs)' };
}

/**
 * Bir runtimeVersion için manifest adresi.
 *
 * ⚠️ ADRESİN runtimeVersion İÇERMESİ BİR GÜVENLİK ÖZELLİĞİDİR, süs değil:
 * `expo-updates` istemcisi indirme aşamasında runtimeVersion'ı DOĞRULAMAZ
 * (ölçüldü — `LoaderSelectionPolicyFilterAware.kt:16-58`). Yanlış sürüm
 * gelirse paketi indirir, sonra launcher onu eler ve uygulama SESSİZCE eski
 * sürümle açılır; kullanıcı hiçbir hata görmez. Sürüm adreste olunca her APK
 * yalnız kendi paketini görebilir ve bu arıza yapısal olarak imkânsızlaşır.
 */
function manifestUrl(feed, runtimeVersion) {
  return `${normalizeFeed(feed)}ota/${runtimeVersion}/manifest`;
}

/** APK künyesinin adresi (Electron'daki `latest.yml`in karşılığı). */
function apkKunyeUrl(feed) {
  return `${normalizeFeed(feed)}apk/surum.json`;
}

/**
 * Multipart gövdenin SABİT sınırlayıcısı.
 *
 * ⚠️ SABİT olmak ZORUNDA: manifest statik dosya olarak servis ediliyor ve
 * `Content-Type: multipart/mixed; boundary=…` başlığını nginx yapılandırması
 * basıyor. Sınırlayıcı yayın başına değişseydi her yayında nginx'e dokunmak
 * gerekirdi. Yayın script'i sınırlayıcının gövdede geçmediğini doğrular.
 */
const MULTIPART_BOUNDARY = 'tekserpota';

module.exports = {
  YAYIN_KOKU,
  musteriOku,
  feedUrl,
  MOBIL_FEED_URL,
  MULTIPART_BOUNDARY,
  normalizeFeed,
  guncellemeAdresiCoz,
  manifestUrl,
  apkKunyeUrl,
};
