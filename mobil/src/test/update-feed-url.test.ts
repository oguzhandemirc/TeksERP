// =============================================================================
// BEKÇİ: güncelleme kanalı adresi — TEK KAYNAK
// =============================================================================
// `Electron/src/test/update-feed-url.test.ts`in mobil ikizidir.
//
// ⚠️ NEDEN: adres derleme anında AndroidManifest'e GÖMÜLÜR ve tabletten
// değiştirilemez. İki yerde okunur — `app.config.js` (APK'ya gömen) ve yayın
// script'leri (paketi oraya yükleyen). Ayrışırlarsa arıza SESSİZDİR: paket bir
// adrese yüklenir, tabletler başka bir adresi yoklar, kimse hata görmez ve
// güncelleme günlerce gelmez.
//
// ⚠️ İKİNCİ SESSİZ ARIZA — `updates.enabled`: `expo-updates` CLI'ları
// (`codesigning:configure`) app.json'a DEĞERLENDİRİLMİŞ yapılandırmayı geri
// yazabiliyor ve bu 2026-08-26'da `enabled`ı sessizce `false` yaptı. O hâliyle
// derlenen APK hiç güncelleme almazdı; hiçbir yerde de görünmezdi.
// =============================================================================

import fs from 'fs';
import path from 'path';

const KOK = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const feed = require(path.join(KOK, 'scripts/lib/feed.cjs'));
const appJson = JSON.parse(fs.readFileSync(path.join(KOK, 'app.json'), 'utf8')).expo;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require(path.join(KOK, 'app.config.js'));
const musteri = JSON.parse(fs.readFileSync(path.join(KOK, 'musteri.json'), 'utf8'));

describe('güncelleme kanalı adresi', () => {
  it('müşteri kodu URL yolu olarak güvenli', () => {
    // Kod doğrudan adrese giriyor: büyük harf/Türkçe karakter/boşluk sessizce
    // 404 üretirdi (Electron'da `Ş`+boşluk taşıyan dosya adı tam bunu yaptı).
    expect(musteri.kod).toMatch(/^[a-z0-9-]{2,32}$/);
  });

  it('feed adresi müşteri kodundan TÜRETİLİR (elle yazılmaz)', () => {
    // ⚠️ İkinci fabrikanın sessiz arızası burada önlenir: kod tek kaynakta
    // yaşar ve adres ondan türer. Elle yazılan ikinci bir kopya olsaydı,
    // müşteri değiştiğinde biri güncellenip diğeri unutulabilirdi.
    expect(feed.MOBIL_FEED_URL).toBe(feed.feedUrl(musteri.kod));
    expect(feed.MOBIL_FEED_URL).toContain(`/${musteri.kod}/`);
  });

  it('başka bir müşteri kodu BAŞKA bir adres üretir', () => {
    // Türetmenin gerçekten müşteriye duyarlı olduğunun kanıtı — sabit bir
    // dizge döndüren bir uygulama yukarıdaki kontrolden de geçerdi.
    expect(feed.feedUrl('yenifabrika')).not.toBe(feed.MOBIL_FEED_URL);
    expect(feed.feedUrl('yenifabrika')).toContain('/yenifabrika/');
  });

  it('sabit https ve sonda `/` taşır', () => {
    // Sondaki `/` olmadan `manifestUrl` `…mobilota/…` üretir ve 404 verir.
    expect(feed.MOBIL_FEED_URL).toMatch(/^https:\/\//);
    expect(feed.MOBIL_FEED_URL.endsWith('/')).toBe(true);
  });

  it('APK\'ya gömülen adres SABİTTEN türetilir', () => {
    const uretilen = appConfig({ config: appJson }).updates.url;
    expect(uretilen).toBe(feed.manifestUrl(feed.MOBIL_FEED_URL, appJson.runtimeVersion));
  });

  it('gömülen adres runtimeVersion İÇERİR', () => {
    // Bu bir güvenlik özelliğidir: istemci indirme aşamasında runtimeVersion'ı
    // doğrulamaz; yanlış sürüm gelirse indirir, eler ve SESSİZCE eski sürümle
    // açılır. Sürüm adreste olunca her APK yalnız kendi paketini görebilir.
    const uretilen = appConfig({ config: appJson }).updates.url;
    expect(uretilen).toContain(`/ota/${appJson.runtimeVersion}/`);
  });

  it('güncelleme AÇIK ve kod imzalama yapılandırılmış', () => {
    expect(appJson.updates.enabled).toBe(true);
    expect(appJson.updates.codeSigningCertificate).toBeTruthy();
    expect(appJson.updates.codeSigningMetadata?.keyid).toBeTruthy();
  });

  // ⚠️ DOSYA VARLIĞI AYRI BİR YÜKLEM — ve TEMİZ KLONDA SAĞLANAMAZ.
  // İmzalama materyali `mobil/.gitignore`da (`keystore/`) ve orada KALMALI:
  // repo public. Yani bu yüklem yalnız sertifikası olan makinede sağlanabilir
  // ⇒ yeşili bir kapsam beyanı DEĞİLDİR (ölçüldü 2026-09-13: yerelde yeşil,
  // temiz klonda ve CI'da kırmızı — bir aydır CI ölü olduğu için görünmemişti).
  //
  // ⚠️ ATLAMA KAPSAMI DAR: yalnız DOSYA VARLIĞI atlanır. Yukarıdaki üç alan
  // kontrolü (`enabled` · sertifika yolu · `keyid`) her ortamda koşar — bir
  // atlama, ölçülebilen komşusunu da götürürse kapsam sessizce kaybolur.
  //
  // ⛔ VE BU ATLAMA BİR RİSKİ KAPATMAZ, YALNIZ ÖLÇÜMÜ DÜRÜSTLEŞTİRİR:
  // imzalama sertifikası bugün YALNIZ bir makinede duruyor — repoda yok (doğru),
  // ama başka bir kopyası da yok. Kaybolursa yayınlanmış APK'lar güncelleme
  // ALAMAZ (imza doğrulaması tutmaz) ve yeni sertifikayla üretilen paketi eski
  // istemci reddeder. ⇒ CI kırmızısı kapandı, **risk açık**; kullanıcı kararı.
  // Bu satır okunduğunda "sorun çözüldü" sanılmasın diye buradadır.
  //
  // ⚠️ ASIL YERİ BURASI DEĞİL: testin kendi gerekçesi *"bunu ancak DERLEME
  // ANINDA öğrenirsin"* diyor ⇒ kontrolün evi paketleme/yayın kapısıdır
  // (sertifikanın gerçekten olması gereken an). Buradaki hâli geçicidir.
  //
  // ⚠️ `TEKSERP_STRICT=1` altında ATLAMA YOK: paketleme öncesi "hepsi koşsun"
  // diyen biri, atlananın arkasına saklanmış bir eksikliği görebilmeli. O modda
  // test koşar ve keystore yoksa KIRMIZI verir — beyanlı atlama bir muafiyet
  // değil, bir GÖRÜNÜRLÜK kararıdır.
  const strict = process.env.TEKSERP_STRICT === '1';
  const keystoreVar = fs.existsSync(path.join(KOK, 'keystore'));
  const sertifikaTesti = keystoreVar || strict ? it : it.skip;
  sertifikaTesti('imzalama sertifikası dosyası GERÇEKTEN var (yalnız keystore/ olan makinede)', () => {
    expect(fs.existsSync(path.join(KOK, appJson.updates.codeSigningCertificate))).toBe(true);
  });

  it('runtimeVersion tanımlı (adres onu içerdiği için zorunlu)', () => {
    expect(String(appJson.runtimeVersion ?? '')).not.toBe('');
  });

  it('ERP adresi güncelleme adresinden BAĞIMSIZ', () => {
    // Kanallar bilerek ayrı. `app.config.js` ERP adresini okuyup güncelleme
    // adresini ondan türetirse, fabrika sunucusu değiştiğinde güncelleme de
    // sessizce başka yere bakar.
    const src = fs.readFileSync(path.join(KOK, 'app.config.js'), 'utf8');
    expect(src).not.toMatch(/updates\s*:[\s\S]*EXPO_PUBLIC_API_URL/);
  });

  it('APK dosya adı kalıbı ASCII ve boşluksuz', () => {
    // Electron'da `Ş` + boşluk taşıyan dosya adı aktarımda bozulup 404 üretmişti.
    const ad = `TeksERP-${appJson.version}-vc${appJson.android.versionCode}.apk`;
    expect(ad).toMatch(/^[\x20-\x7E]+$/);
    expect(ad).not.toMatch(/\s/);
  });
});
