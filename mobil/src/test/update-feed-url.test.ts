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
// ⚠️ TEK DERLEME KİMLİĞİ (tek ortak paket O7/O15): kimlik `deploy/dagitim.json`dan
// (`scripts/lib/ortak-kimlik.cjs`). Eski kanal derlemesi (`TEKSERP_KANAL`) emekli — yalnız
// `eski-kanal-son` etiketinden; app.json'daki kimlik alanları o kanalın dinlenme değerleridir.
// =============================================================================

import fs from 'fs';
import path from 'path';

const KOK = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ortakLib = require(path.join(KOK, 'scripts/lib/ortak-kimlik.cjs'));
const appJson = JSON.parse(fs.readFileSync(path.join(KOK, 'app.json'), 'utf8')).expo;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require(path.join(KOK, 'app.config.js'));
const dagitim = JSON.parse(fs.readFileSync(path.join(KOK, '..', 'deploy', 'dagitim.json'), 'utf8'));

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
const cfg = (ek: Record<string, string | undefined> = {}) =>
  ortamla({ TEKSERP_KANAL: undefined, EXPO_PUBLIC_UPDATE_URL: undefined, ...ek }, () =>
    appConfig({ config: JSON.parse(JSON.stringify(appJson)) }),
  );

// =============================================================================
// TEK ORTAK PAKET — argümansız derleme
// =============================================================================
// Eski kanalın (adnansahin) kimliği — `eski-kanal-son` etiketindeki değerler; ortak paketle ÇAKIŞMAMASI ölçülür.
const ESKI_KANAL = {
  paket: 'com.teks.erp.mobil',
  runtimeVersion: '54.2',
  sertifika: './keystore/ota-certs/certificate.pem',
  kid: 'main',
};
const eskiYapilandirma = () => {
  const c = JSON.parse(JSON.stringify(appJson));
  c.android.package = ESKI_KANAL.paket;
  c.ios.bundleIdentifier = ESKI_KANAL.paket;
  c.runtimeVersion = ESKI_KANAL.runtimeVersion;
  c.updates.codeSigningCertificate = ESKI_KANAL.sertifika;
  c.updates.codeSigningMetadata.keyid = ESKI_KANAL.kid;
  c.updates.url = 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest';
  return c;
};

describe('ortak paket kimliği (argümansız derleme)', () => {
  const t = dagitim.urun.tablet;
  const ortak = cfg();

  it('kimlik deploy/dagitim.json\'dan gelir (paket adı · ad · runtimeVersion · sertifika)', () => {
    expect(ortak.name).toBe(t.gorunenAd);
    expect(ortak.android.package).toBe(t.androidPaket);
    expect(ortak.ios.bundleIdentifier).toBe(t.androidPaket);
    expect(ortak.runtimeVersion).toBe(t.runtimeVersion);
    expect(ortak.updates.codeSigningCertificate).toBe(`./${t.otaSertifika}`);
    expect(ortakLib.ortakYapilandirmaFarki(ortak)).toEqual([]);
  });

  it('app.json taban dosyası kayıtla AYNI kimliği taşır (eski kanal değerleri yalnız eski-kanal-son etiketinde)', () => {
    expect(appJson.android.package).toBe(t.androidPaket);
    expect(appJson.ios.bundleIdentifier).toBe(t.androidPaket);
    expect(appJson.runtimeVersion).toBe(t.runtimeVersion);
    expect(appJson.updates.codeSigningCertificate).toBe(`./${t.otaSertifika}`);
    expect(appJson.updates.codeSigningMetadata?.keyid).toBe(ortakLib.ortakKimlik().anahtarKimligi);
    expect(appJson.updates.url).toBe(ortak.updates.url);
  });

  it('gömülü adres grup-nötr Worker takma adıdır: <indirmeKoku>ota/<rv>/manifest', () => {
    expect(ortak.updates.url).toBe(`${dagitim.indirmeKoku}ota/${t.runtimeVersion}/manifest`);
    expect(ortak.updates.url).toMatch(/^https:\/\/[^/]+\/ota\/[0-9]+\.[0-9]+\/manifest$/);
  });

  it('güncelleme AÇIK, kod imzası ortak anahtarın kid\'ini gösterir (eski kanalınkini değil)', () => {
    expect(ortak.updates.enabled).toBe(true);
    expect(ortak.updates.codeSigningMetadata?.keyid).toBe(ortakLib.ortakKimlik().anahtarKimligi);
    expect(ortak.updates.codeSigningMetadata?.keyid).not.toBe(ESKI_KANAL.kid);
    expect(ortak.updates.codeSigningMetadata?.alg).toBe('rsa-v1_5-sha256');
  });

  it('eski kanalın kimliğiyle paket adı · OTA sertifikası · anahtar PAYLAŞMAZ (yan yana kurulur)', () => {
    expect(ortak.android.package).not.toBe(ESKI_KANAL.paket);
    expect(ortak.updates.codeSigningCertificate).not.toBe(ESKI_KANAL.sertifika);
    const eskiAnahtar = ESKI_KANAL.sertifika
      .replace(/^\.\//, '').replace('ota-certs', 'ota-keys').replace('certificate.pem', 'private-key.pem');
    expect(ortakLib.ortakKimlik().otaAnahtar).not.toBe(eskiAnahtar);
  });

  it('emekli TEKSERP_KANAL ortamda → gürültülü düşer (sessizce ortak kimlikle derlenmez)', () => {
    expect(() => cfg({ TEKSERP_KANAL: 'adnansahin' })).toThrow(/EMEKLİ ESKİ KANAL ORTAMI/);
    expect(() => cfg({ TEKSERP_KANAL: '  ' })).not.toThrow();
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
    expect(() => cfg({ EXPO_PUBLIC_UPDATE_URL: 'https://indir.etkiliyazilim.com/test/mobil/' })).toThrow(/EXPO_PUBLIC_UPDATE_URL/);
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
    const f = ortakLib.ortakYapilandirmaFarki(eskiYapilandirma());
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
// GENEL — app.json tabanı (ortak kimlik bunun üstüne uygulanır)
// =============================================================================
describe('güncelleme yapılandırması (app.json tabanı)', () => {
  it('gömülen adres runtimeVersion İÇERİR', () => {
    // Bu bir güvenlik özelliğidir: istemci indirme aşamasında runtimeVersion'ı
    // doğrulamaz; yanlış sürüm gelirse indirir, eler ve SESSİZCE eski sürümle
    // açılır. Sürüm adreste olunca her APK yalnız kendi paketini görebilir.
    expect(cfg().updates.url).toContain(`/ota/${dagitim.urun.tablet.runtimeVersion}/`);
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
