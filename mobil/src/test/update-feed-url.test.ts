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
//
// ⚠️ İKİ DERLEME KİMLİĞİ (tek ortak paket O7): argümansız derleme = TEK ORTAK PAKET (kimlik
// `deploy/dagitim.json`dan, `scripts/lib/ortak-kimlik.cjs`); `TEKSERP_KANAL=<kod>` = eski kanal
// (adnansahin) — çıktısı DONDURULMUŞ özete karşı bayt-donuk ölçülür.
// =============================================================================

import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';

const KOK = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const feed = require(path.join(KOK, 'scripts/lib/feed.cjs'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ortakLib = require(path.join(KOK, 'scripts/lib/ortak-kimlik.cjs'));
const appJson = JSON.parse(fs.readFileSync(path.join(KOK, 'app.json'), 'utf8')).expo;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require(path.join(KOK, 'app.config.js'));
const musteri = JSON.parse(fs.readFileSync(path.join(KOK, 'musteri.json'), 'utf8'));
const dagitim = JSON.parse(fs.readFileSync(path.join(KOK, '..', 'deploy', 'dagitim.json'), 'utf8'));
const kanalKaydi = JSON.parse(fs.readFileSync(path.join(KOK, '..', 'deploy', 'kanallar.json'), 'utf8'));

function ortamla<T>(degiskenler: Record<string, string | undefined>, fn: () => T): T {
  const eski: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(degiskenler)) {
    eski[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(eski)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const cfg = (kod?: string, ek: Record<string, string | undefined> = {}) =>
  ortamla({ TEKSERP_KANAL: kod, EXPO_PUBLIC_UPDATE_URL: undefined, ...ek }, () =>
    appConfig({ config: JSON.parse(JSON.stringify(appJson)) }),
  );

// =============================================================================
// TEK ORTAK PAKET — argümansız derleme
// =============================================================================
describe('ortak paket kimliği (argümansız derleme)', () => {
  const t = dagitim.urun.tablet;
  const ortak = cfg(undefined);

  it('kimlik deploy/dagitim.json\'dan gelir (paket adı · ad · runtimeVersion · sertifika)', () => {
    expect(ortak.name).toBe(t.gorunenAd);
    expect(ortak.android.package).toBe(t.androidPaket);
    expect(ortak.ios.bundleIdentifier).toBe(t.androidPaket);
    expect(ortak.runtimeVersion).toBe(t.runtimeVersion);
    expect(ortak.updates.codeSigningCertificate).toBe(`./${t.otaSertifika}`);
    expect(ortakLib.ortakYapilandirmaFarki(ortak)).toEqual([]);
  });

  it('gömülü adres grup-nötr Worker takma adıdır: <indirmeKoku>ota/<rv>/manifest', () => {
    expect(ortak.updates.url).toBe(`${dagitim.indirmeKoku}ota/${t.runtimeVersion}/manifest`);
    expect(ortak.updates.url).toMatch(/^https:\/\/[^/]+\/ota\/[0-9]+\.[0-9]+\/manifest$/);
  });

  it('güncelleme AÇIK, kod imzası ortak anahtarın kid\'ini gösterir (eski kanalınkini değil)', () => {
    expect(ortak.updates.enabled).toBe(true);
    expect(ortak.updates.codeSigningMetadata?.keyid).toBe(ortakLib.ortakKimlik().anahtarKimligi);
    expect(ortak.updates.codeSigningMetadata?.keyid).not.toBe(appJson.updates.codeSigningMetadata?.keyid);
    expect(ortak.updates.codeSigningMetadata?.alg).toBe('rsa-v1_5-sha256');
  });

  it('eski kanallarla paket adı · güncelleme adresi · OTA sertifikası · anahtar PAYLAŞMAZ (yan yana kurulur)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kanalLib = require(path.join(KOK, 'scripts/lib/kanal.cjs'));
    const anahtar = ortakLib.ortakKimlik().otaAnahtar;
    for (const kod of Object.keys(kanalKaydi.kanallar)) {
      const e = cfg(kod);
      expect([kod, e.android.package === ortak.android.package]).toEqual([kod, false]);
      expect([kod, e.updates.url === ortak.updates.url]).toEqual([kod, false]);
      expect([kod, e.updates.codeSigningCertificate === ortak.updates.codeSigningCertificate]).toEqual([kod, false]);
      expect([kod, kanalLib.otaImzaYollari(kanalKaydi.kanallar[kod]).anahtar === anahtar]).toEqual([kod, false]);
    }
  });

  it('OTA özel anahtar yolu sertifikanın aynası (ota-certs-<ad> → ota-keys-<ad>)', () => {
    const k = ortakLib.ortakKimlik();
    expect(k.otaAnahtar).toBe(k.otaSertifika.replace('ota-certs-', 'ota-keys-').replace('certificate.pem', 'private-key.pem'));
  });

  it('görünür etiket derlemeden DOĞMAZ (TEST/DEMO lisans sınıfından gelir)', () => {
    expect(ortak.extra?.gorunurEtiket).toBeUndefined();
    const etiketli = ortamla({ EXPO_PUBLIC_UPDATE_URL: undefined, TEKSERP_KANAL: undefined }, () =>
      appConfig({ config: { ...JSON.parse(JSON.stringify(appJson)), extra: { gorunurEtiket: 'TEST', baska: 1 } } }),
    );
    expect(etiketli.extra).toEqual({ baska: 1 });
  });

  it('EXPO_PUBLIC_UPDATE_URL ile adres EZİLEMEZ (gürültülü düşer)', () => {
    expect(() => cfg(undefined, { EXPO_PUBLIC_UPDATE_URL: 'https://indir.etkiliyazilim.com/test/mobil/' })).toThrow(/EXPO_PUBLIC_UPDATE_URL/);
  });

  it('SONDA: eksik/biçimsiz kayıt yerleşik değere sapmaz, düşer', () => {
    const bozuk = (m: (o: typeof dagitim) => void) => {
      const o = JSON.parse(JSON.stringify(dagitim));
      m(o);
      return () => ortakLib.ortakKimlik(o);
    };
    expect(bozuk((o) => delete o.urun.tablet.androidPaket)).toThrow(/androidPaket/);
    expect(bozuk((o) => (o.urun.tablet.otaSertifika = 'keystore/ota-certs/certificate.pem'))).toThrow(/otaSertifika/);
    expect(bozuk((o) => (o.urun.tablet.runtimeVersion = '55'))).toThrow(/runtimeVersion/);
    expect(bozuk((o) => (o.indirmeKoku = 'https://indir.etkiliyazilim.com/test/'))).toThrow(/indirmeKoku/);
  });

  it('SONDA: eski kanalın yapılandırması ortak paket SAYILMAZ (fark yüklemi kör değil)', () => {
    const f = ortakLib.ortakYapilandirmaFarki(cfg(kanalKaydi.varsayilan));
    expect(f.some((x: string) => x.startsWith('android.package'))).toBe(true);
    expect(f.some((x: string) => x.startsWith('updates.url'))).toBe(true);
    expect(f.some((x: string) => x.startsWith('runtimeVersion'))).toBe(true);
    expect(ortakLib.ortakYapilandirmaFarki({ ...ortak, extra: { gorunurEtiket: 'TEST' } }, { herkese: true }))
      .toEqual([expect.stringMatching(/^extra\.gorunurEtiket/)]);
  });

  // Ortak anahtar çifti anahtar töreninde (kullanıcıyla) üretilir; o güne dek dosya yoktur. Gerçek
  // kapı derlemedir (build-apk ortak yolu sertifikasız DURUR); burada yalnız TEKSERP_STRICT=1 ölçer.
  const ortakSertifikaTesti = process.env.TEKSERP_STRICT === '1' ? it : it.skip;
  ortakSertifikaTesti('ortak OTA sertifikası ve özel anahtarı GERÇEKTEN var (TEKSERP_STRICT=1)', () => {
    const k = ortakLib.ortakKimlik();
    expect(fs.existsSync(path.join(KOK, k.otaSertifika))).toBe(true);
    expect(fs.existsSync(path.join(KOK, k.otaAnahtar))).toBe(true);
  });
});

// =============================================================================
// ESKİ KANAL — feed.cjs (deploy/mobil-yayinla.mjs ve kanal derlemesi okur)
// =============================================================================
describe('güncelleme kanalı adresi (eski kanal)', () => {
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
    const uretilen = cfg(musteri.kod).updates.url;
    expect(uretilen).toBe(feed.manifestUrl(feed.MOBIL_FEED_URL, appJson.runtimeVersion));
  });

  it('gömülen adres runtimeVersion İÇERİR', () => {
    // Bu bir güvenlik özelliğidir: istemci indirme aşamasında runtimeVersion'ı
    // doğrulamaz; yanlış sürüm gelirse indirir, eler ve SESSİZCE eski sürümle
    // açılır. Sürüm adreste olunca her APK yalnız kendi paketini görebilir.
    expect(cfg(musteri.kod).updates.url).toContain(`/ota/${appJson.runtimeVersion}/`);
    expect(cfg(undefined).updates.url).toContain(`/ota/${dagitim.urun.tablet.runtimeVersion}/`);
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
    // Ortak paket ERP adresini hiç bilmez (tablet sunucuyu çalışma anında bulur).
    expect(fs.readFileSync(path.join(KOK, 'scripts/lib/ortak-kimlik.cjs'), 'utf8')).not.toMatch(/EXPO_PUBLIC_API_URL|erpAdresi/);
  });

  it('APK dosya adı kalıbı ASCII ve boşluksuz', () => {
    // Electron'da `Ş` + boşluk taşıyan dosya adı aktarımda bozulup 404 üretmişti.
    const ad = `TeksERP-${appJson.version}-vc${appJson.android.versionCode}.apk`;
    expect(ad).toMatch(/^[\x20-\x7E]+$/);
    expect(ad).not.toMatch(/\s/);
  });
});

// =============================================================================
// KANAL DERLEMESİ — `TEKSERP_KANAL=<kod>` ile kimlik `deploy/kanallar.json`dan
// =============================================================================
// Derleme betikleri (build-apk · yayinla-ota) kanalı ARGÜMANDAN alır ve çocuk süreçlere
// bu ortamla geçirir; app.json kanal için YAZILMAZ (native parmak izinin girdisi).
// Kilitlenen: varsayılan kanalın çıktısı dinlenmedekiyle BİREBİR (anahtar sırası dahil),
// her kanal kaydın kimliğini üretir, iki kanal kimlik paylaşamaz, bilinmeyen kod düşer.
describe('kanal derlemesi (TEKSERP_KANAL)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const kanalLib = require(path.join(KOK, 'scripts/lib/kanal.cjs'));
  const kayit = JSON.parse(fs.readFileSync(path.join(KOK, '..', 'deploy', 'kanallar.json'), 'utf8'));
  const kodlar = Object.keys(kayit.kanallar);

  // Eski kanal derlemesi BAYT-DONUK (adnansahin'e zarar verme): değerlendirilmiş yapılandırma, sürüm alanları
  // (`version` · `android.versionCode` — her yayın turunda artar) hariç, O7 öncesi ölçülen özete eşit.
  // Değişti ⇒ adnansahin APK'sı/OTA'sı bu commit'ten FARKLI çıkar; bilinçliyse özet kullanıcı kararıyla güncellenir.
  const ESKI_KANAL_OZETI = '2070d29fbd0dc6943827c3b3c272b271e83ca4bf2ea1c1d1d7bc1cdd26e12234';
  const eskiOzet = (c: { version?: string; android?: { versionCode?: number } }) => {
    const k = JSON.parse(JSON.stringify(c));
    delete k.version;
    delete k.android.versionCode;
    return crypto.createHash('sha256').update(JSON.stringify(k)).digest('hex');
  };

  it('varsayılan (eski) kanalın çıktısı DONDURULMUŞ özetle BİREBİR (anahtar sırası dahil)', () => {
    expect(eskiOzet(cfg(kayit.varsayilan))).toBe(ESKI_KANAL_OZETI);
  });

  it('SONDA: özet kör değil — tek alan değişince tutmaz, sürüm alanları değişince tutar', () => {
    const c = cfg(kayit.varsayilan);
    expect(eskiOzet({ ...c, runtimeVersion: '54.3' })).not.toBe(ESKI_KANAL_OZETI);
    expect(eskiOzet({ ...c, version: '9.9.9', android: { ...c.android, versionCode: 999 } })).toBe(ESKI_KANAL_OZETI);
  });

  it.each(kodlar)('%s kanalı kayıt defterindeki kimliği üretir', (kod) => {
    expect(kanalLib.tabletYapilandirmaFarki(kayit.kanallar[kod], cfg(kod), appJson.runtimeVersion)).toEqual([]);
  });

  it('iki kanal paket adı, görünen ad, güncelleme adresi ya da sertifika PAYLAŞAMAZ', () => {
    const ciktilar = kodlar.map((k) => cfg(k));
    for (const alan of [
      (c: { android: { package: string } }) => c.android.package,
      (c: { name: string }) => c.name,
      (c: { updates: { url: string } }) => c.updates.url,
      (c: { updates: { codeSigningCertificate: string } }) => c.updates.codeSigningCertificate,
    ]) {
      const degerler = ciktilar.map((c) => alan(c as never));
      expect(new Set(degerler).size).toBe(kodlar.length);
    }
  });

  it('üretim kanalı görünür etiket TAŞIMAZ (extra hiç doğmaz); hazırlık kanalı taşır', () => {
    for (const kod of kodlar) {
      const k = kayit.kanallar[kod];
      if (k.gorunurEtiket === null) expect(cfg(kod).extra).toBeUndefined();
      else expect(cfg(kod).extra?.gorunurEtiket).toBe(k.gorunurEtiket);
    }
  });

  it('app.json kanal için YAZILMAZ — dinlenme (varsayilan) kimliğini taşır', () => {
    const v = kayit.kanallar[kayit.varsayilan].tablet;
    expect(appJson.android.package).toBe(v.androidPaket);
    expect(appJson.name).toBe(v.gorunenAd);
    expect(appJson.updates.codeSigningCertificate.replace(/^\.\//, '')).toBe(v.otaSertifika);
  });

  it('bilinmeyen kanal kodu gürültülü düşer (sessizce varsayılana dönmez)', () => {
    expect(() => cfg('testfabirka')).toThrow(/BİLİNMEYEN KANAL/);
  });

  it('kanal derlemesinde başka köke işaret eden EXPO_PUBLIC_UPDATE_URL düşer', () => {
    const baskasi = kodlar.find((k) => k !== kayit.varsayilan) ?? kayit.varsayilan;
    expect(() =>
      ortamla({ TEKSERP_KANAL: baskasi, EXPO_PUBLIC_UPDATE_URL: kayit.kanallar[kayit.varsayilan].yayin.mobilFeed }, () =>
        appConfig({ config: JSON.parse(JSON.stringify(appJson)) }),
      ),
    ).toThrow(/EXPO_PUBLIC_UPDATE_URL/);
  });

  it('OTA imza anahtarı yolu sertifika yolunun aynası; iki kanal aynı anahtarı göstermez', () => {
    const anahtarlar = kodlar.map((k) => kanalLib.otaImzaYollari(kayit.kanallar[k]).anahtar);
    expect(new Set(anahtarlar).size).toBe(kodlar.length);
    expect(kanalLib.otaImzaYollari(kayit.kanallar[kayit.varsayilan]).anahtar).toBe('keystore/ota-keys/private-key.pem');
  });

  // Dosya varlığı yalnız keystore/ olan makinede ölçülebilir (yukarıdaki sertifika testinin gerekçesi).
  const kanalSertifikaTesti = fs.existsSync(path.join(KOK, 'keystore')) || process.env.TEKSERP_STRICT === '1' ? it : it.skip;
  kanalSertifikaTesti('her kanalın OTA sertifikası ve özel anahtarı GERÇEKTEN var', () => {
    for (const kod of kodlar) {
      const y = kanalLib.otaImzaYollari(kayit.kanallar[kod]);
      expect([kod, fs.existsSync(path.join(KOK, y.sertifika))]).toEqual([kod, true]);
      expect([kod, fs.existsSync(path.join(KOK, y.anahtar))]).toEqual([kod, true]);
    }
  });
});
