// =============================================================================
// BEKÇİ: ortak tablet yalnız Google Play'den kurulur ve güncellenir (K-14)
// =============================================================================
// Play politikası uygulamanın kendi APK'sını indirip kurmasını yasaklar; siteden kurulan tablet de Play'den
// güncellenemez. Bu yüzden: kurulum izni manifestte YOK (kütüphane eklese de blockedPermissions siler),
// uygulama kodunda APK indir/kur yolu YOK, native eskilikte tek eylem Play sayfasını açmaktır, ve Play'e giden
// AAB yalnız yükleme anahtarıyla imzalanır (test anahtarına ya da eski kanal mührüne düşmez).
// =============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';

import { playStoreAc, playStoreAdresleri } from '../services/playStore';

const KOK = path.join(__dirname, '..', '..');
const YASAK_IZIN = 'android.permission.REQUEST_INSTALL_PACKAGES';
const appJson = JSON.parse(fs.readFileSync(path.join(KOK, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
/* eslint-disable @typescript-eslint/no-require-imports */
const appConfig = require(path.join(KOK, 'app.config.js'));
const { ortakKimlik } = require(path.join(KOK, 'scripts/lib/ortak-kimlik.cjs'));
const { IMZA_ANAHTARLARI, gorevAnahtarTuru } = require(path.join(KOK, 'scripts/lib/imza-anahtari.cjs'));
const { gradleImzala } = require(path.join(KOK, 'plugins/withReleaseKeystore.js'));
const { YON_OZELLIGI, yonOzelligiYaz } = require(path.join(KOK, 'plugins/withBuyukEkranYonu.js'));
const buyukEkran = require(path.join(KOK, 'scripts/lib/buyuk-ekran.cjs'));
const playManifest = require(path.join(KOK, 'scripts/lib/play-manifest.cjs'));
const { hizmetKaldirmaYaz } = require(path.join(KOK, 'plugins/withPlayManifestTemizligi.js'));
const agGuvenligi = require(path.join(KOK, 'plugins/withAgGuvenligi.js'));
/* eslint-enable @typescript-eslint/no-require-imports */

function degerlendir() {
  const eski = process.env.TEKSERP_KANAL;
  delete process.env.TEKSERP_KANAL;
  try {
    return appConfig({ config: JSON.parse(JSON.stringify(appJson)) });
  } finally {
    if (eski !== undefined) process.env.TEKSERP_KANAL = eski;
  }
}

/** src/ altındaki uygulama dosyaları (test ve test yardımcıları hariç). */
function uygulamaDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of fs.readdirSync(dizin)) {
    const y = path.join(dizin, ad);
    if (fs.statSync(y).isDirectory()) {
      if (ad === 'test' || ad === '__tests__' || ad === '__mocks__') continue;
      out.push(...uygulamaDosyalari(y));
    } else if (/\.(ts|tsx|js)$/.test(ad) && !/\.test\.(ts|tsx|js)$/.test(ad)) {
      out.push(y);
    }
  }
  return out;
}

describe('K-14 — kurulum izni yok', () => {
  it('app.json izin istemez ve izni blockedPermissions ile birleşik manifestten siler', () => {
    expect(appJson.android.permissions ?? []).not.toContain(YASAK_IZIN);
    expect(appJson.android.permissions ?? []).not.toContain('REQUEST_INSTALL_PACKAGES');
    expect(appJson.android.blockedPermissions ?? []).toContain(YASAK_IZIN);
  });

  it('değerlendirilmiş yapılandırma (ortak paket) aynı hükmü taşır', () => {
    const c = degerlendir();
    expect(c.android.permissions ?? []).not.toContain(YASAK_IZIN);
    expect(c.android.blockedPermissions ?? []).toContain(YASAK_IZIN);
  });

  it('APK kurma aracı (expo-intent-launcher) bağımlılıklarda yok', () => {
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('expo-intent-launcher');
  });

  it('APK künyesi kriptosu (src/lib/kripto, @noble/*) ve gömülü künye çapası yok', () => {
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@noble/'))).toEqual([]);
    expect(fs.existsSync(path.join(KOK, 'src', 'lib', 'kripto'))).toBe(false);
    expect(fs.existsSync(path.join(KOK, 'src', 'lib', 'apk-imza-capasi.json'))).toBe(false);
  });
});

describe('K-14 — uygulama kodunda APK indir/kur yolu yok', () => {
  const dosyalar = uygulamaDosyalari(path.join(KOK, 'src'));
  const YASAK: [string, RegExp][] = [
    ['kurulum niyeti', /INSTALL_PACKAGE/],
    ['APK MIME tipi', /vnd\.android\.package-archive/],
    ['kurulum izni', /REQUEST_INSTALL_PACKAGES/],
    ['APK künyesi adresi', /apk\/surum\.json/],
    ['APK künyesi modülü', /apkKunye/],
    ['APK künyesi çapası / kriptosu', /apk-imza-capasi|ed25519Verify|@noble\//],
    ['intent başlatıcı', /expo-intent-launcher|startActivityAsync/],
  ];

  it('tarama boş değil (körlük zemini)', () => {
    expect(dosyalar.length).toBeGreaterThan(50);
  });

  it.each(YASAK)('%s hiçbir uygulama dosyasında geçmez', (_ad, desen) => {
    const bulunan = dosyalar.filter((f) => desen.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(KOK, f));
    expect(bulunan).toEqual([]);
  });
});

describe('K-14 — Play Store açma', () => {
  const PAKET = 'com.ornek.uygulama';

  it('önce market:// dener', async () => {
    const ac = jest.fn().mockResolvedValue(undefined);
    await expect(playStoreAc(ac, PAKET)).resolves.toBe('market');
    expect(ac).toHaveBeenCalledWith(`market://details?id=${PAKET}`);
  });

  it('Play uygulaması yoksa play.google.com adresine düşer', async () => {
    const ac = jest.fn().mockRejectedValueOnce(new Error('işleyici yok')).mockResolvedValueOnce(undefined);
    await expect(playStoreAc(ac, PAKET)).resolves.toBe('web');
    expect(ac).toHaveBeenLastCalledWith(playStoreAdresleri(PAKET).web);
    expect(playStoreAdresleri(PAKET).web).toBe(`https://play.google.com/store/apps/details?id=${PAKET}`);
  });

  it('ikisi de açılamazsa acilamadi, paket yoksa hiçbir şey açmaz', async () => {
    const ac = jest.fn().mockRejectedValue(new Error('x'));
    await expect(playStoreAc(ac, PAKET)).resolves.toBe('acilamadi');
    const ac2 = jest.fn();
    await expect(playStoreAc(ac2, null)).resolves.toBe('paket-yok');
    expect(ac2).not.toHaveBeenCalled();
  });

  it('paket adı koda gömülmez: expoConfig.android.package okunur ve ortak kimliğe eşittir', () => {
    const beklenen = ortakKimlik().androidPaket;
    expect(degerlendir().android.package).toBe(beklenen);
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { android: { package: beklenen } } } }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { uygulamaPaketi } = require('../services/playStore');
      expect(uygulamaPaketi()).toBe(beklenen);
    });
    const kaynak = fs.readFileSync(path.join(KOK, 'src/services/playStore.ts'), 'utf8');
    expect(kaynak).not.toContain(beklenen);
  });
});

describe('K-14 — native eskilik yalnız UYARIR (kullanıcı kararı 2026-10-07)', () => {
  const kaynak = fs.readFileSync(path.join(KOK, 'src/components/UpdateGate.tsx'), 'utf8');

  it("native dalı kilit kararından ÖNCE döner ve dokunmayı geçirir (şerit + Play Store'u aç)", () => {
    const dal = kaynak.indexOf("politikaDurum.sebep === 'native'");
    const kilit = kaynak.indexOf('kilitlenmeliMi({');
    expect(dal).toBeGreaterThan(0);
    expect(kilit).toBeGreaterThan(dal);
    const govde = kaynak.slice(dal, kilit);
    expect(govde).toContain('pointerEvents="box-none"');
    expect(govde).toContain('playStoreAc(');
    expect(govde).not.toMatch(/styles\.ortu|pointerEvents="auto"/);
  });

  it('Play In-App Updates kitaplığı eklenmez', () => {
    const tum = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(tum).filter((ad) => /in-app-update/i.test(ad))).toEqual([]);
  });
});

describe('K-14 — imza anahtarı seçimi (AAB → Play yükleme, APK → test; eski mühür hiçbirinde)', () => {
  const SABLON = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;
  const cikti = gradleImzala(SABLON);

  it('anahtar dizinleri ayrı ve keystore/ kökünde değil', () => {
    expect(IMZA_ANAHTARLARI['play-yukleme'].dizin).toBe('keystore/play-yukleme');
    expect(IMZA_ANAHTARLARI.deneme.dizin).toBe('keystore/deneme');
    expect(gorevAnahtarTuru('bundleRelease')).toBe('play-yukleme');
    expect(gorevAnahtarTuru('assembleRelease')).toBe('deneme');
  });

  it('bundle görevi Play yükleme dizinini, diğerleri deneme dizinini seçer', () => {
    expect(cikti).toContain("tekserpRelease.any { it.startsWith('bundle') }");
    expect(cikti).toContain("def tekserpDizin = tekserpPlay ? 'play-yukleme' : 'deneme'");
    expect(cikti).toContain("rootProject.file('../keystore/' + tekserpDizin + '/keystore.properties')");
    expect(cikti).toContain("storeFile file('../../keystore/' + tekserpDizin + '/' + tekserpStore)");
  });

  it('eski kanal mührü (keystore/keystore.properties) hiçbir görevde okunmaz', () => {
    expect(cikti).not.toContain('keystore/keystore.properties');
    expect(cikti).not.toMatch(/'\.\.\/\.\.\/keystore\/' \+ tekserpProps/);
  });

  it('AAB ile APK aynı komutta istenirse ve anahtar yoksa durur; storeFile dizin dışına çıkamaz', () => {
    expect(cikti).toMatch(/AAB \(Play\) ve yerel APK ayni komutta derlenmez/);
    expect(cikti).toMatch(/else if \(!tekserpRelease\.isEmpty\(\)\) \{\s*throw new GradleException/);
    expect(cikti).toMatch(/tekserpStore\.contains\('\/'\)/);
    expect(cikti).toContain('signingConfig signingConfigs.release');
    expect(gradleImzala(cikti)).toBe(cikti);
  });

  it('eklenti app.json plugins listesinde (yoksa release deneme mührüyle imzalanırdı)', () => {
    expect(appJson.plugins).toContain('./plugins/withReleaseKeystore');
  });
});

describe('API 36 — Play hedef SDK ve büyük ekran yön kilidi (Play reddi 2026-10-08)', () => {
  const buildProps = (appJson.plugins as unknown[]).find(
    (p): p is [string, { android: Record<string, unknown> }] => Array.isArray(p) && p[0] === 'expo-build-properties',
  );
  const android = buildProps?.[1].android ?? {};

  it('hedef SDK ≥ 36 ve derleme SDK hedefin altında değil', () => {
    expect(Number(android.targetSdkVersion)).toBeGreaterThanOrEqual(36);
    expect(Number(android.compileSdkVersion)).toBeGreaterThanOrEqual(Number(android.targetSdkVersion));
  });

  it('yön kilidi eklentisi app.json plugins listesinde (yoksa tablette yatay kilit Android 16+ da yok sayılır)', () => {
    expect(appJson.plugins).toContain('./plugins/withBuyukEkranYonu');
    expect(YON_OZELLIGI).toBe('android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY');
  });

  it('eklenti <application> öğesine özelliği true yazar, ikinci koşumda kopya eklemez', () => {
    const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    yonOzelligiYaz(manifest);
    yonOzelligiYaz(manifest);
    const ozellikler = (manifest.manifest.application[0] as { property?: { $: Record<string, string> }[] }).property ?? [];
    expect(ozellikler.filter((o) => o.$['android:name'] === YON_OZELLIGI)).toEqual([
      { $: { 'android:name': YON_OZELLIGI, 'android:value': 'true' } },
    ]);
  });

  it('AAB doğrulaması hedef SDK ve yön özelliğini paketin kendisinden ölçer', () => {
    const betik = fs.readFileSync(path.join(KOK, 'scripts/build-apk.mjs'), 'utf8');
    expect(betik).toMatch(/if \(ogeler\) sorunlar\.push\(\.\.\.buyukEkranSorunlari\(ogeler\)/);
    expect(betik).toMatch(/import \{ PLAY_EN_DUSUK_HEDEF_SDK, YON_OZELLIGI \} from '\.\/lib\/buyuk-ekran\.cjs'/);
    expect(buyukEkran.PLAY_EN_DUSUK_HEDEF_SDK).toBe(36);
  });
});

describe('K1 · K3 — Play manifest temizliği (yalnız şifreli bağlantı; kullanılmayan izin ve hizmet yok)', () => {
  const buildProps = (appJson.plugins as unknown[]).find(
    (p): p is [string, { android: Record<string, unknown> }] => Array.isArray(p) && p[0] === 'expo-build-properties',
  );
  const cfg = degerlendir();

  it('usesCleartextTraffic iki yerde de false (app.json android + expo-build-properties) ve değerlendirilmiş config\'de false', () => {
    expect(appJson.android.usesCleartextTraffic).toBe(false);
    expect(buildProps?.[1].android.usesCleartextTraffic).toBe(false);
    expect(cfg.android?.usesCleartextTraffic).toBe(false);
  });

  it('engellenen izinler tek kaynaktan: app.json blockedPermissions ⊇ ENGELLI_IZINLER, permissions ile kesişmez', () => {
    const engelli: string[] = appJson.android.blockedPermissions;
    for (const iz of playManifest.ENGELLI_IZINLER) expect(engelli).toContain(iz);
    for (const iz of playManifest.ENGELLI_IZINLER) expect(appJson.android.permissions).not.toContain(iz);
  });

  it('hizmet temizleme eklentisi plugins listesinde; iki expo-audio hizmetini tools:node=remove yazar (idempotent)', () => {
    expect(appJson.plugins).toContain('./plugins/withPlayManifestTemizligi');
    const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] } };
    hizmetKaldirmaYaz(manifest);
    hizmetKaldirmaYaz(manifest);
    const hizmetler = (manifest.manifest.application[0] as { service?: { $: Record<string, string> }[] }).service ?? [];
    expect(hizmetler.map((h) => h.$)).toEqual(
      playManifest.KALDIRILAN_HIZMETLER.map((ad: string) => ({ 'android:name': ad, 'tools:node': 'remove' })),
    );
    expect((manifest.manifest.$ as Record<string, string>)['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  it('AAB doğrulaması düz HTTP, engelli izin ve hizmeti paketin kendisinden ölçer', () => {
    const betik = fs.readFileSync(path.join(KOK, 'scripts/build-apk.mjs'), 'utf8');
    expect(betik).toMatch(/\.\.\.playManifestSorunlari\(ogeler\)/);
    const ogeler = (ozel: Record<string, unknown>) => [
      { ad: 'manifest', oznitelik: {} },
      { ad: 'application', oznitelik: { usesCleartextTraffic: 'false', ...ozel } },
    ];
    expect(playManifest.playManifestSorunlari(ogeler({}))).toEqual([]);
    expect(playManifest.playManifestSorunlari(ogeler({ usesCleartextTraffic: 'true' })).join()).toMatch(/usesCleartextTraffic=true/);
    expect(
      playManifest.playManifestSorunlari([...ogeler({}), { ad: 'uses-permission', oznitelik: { name: 'android.permission.USE_BIOMETRIC' } }]).join(),
    ).toMatch(/USE_BIOMETRIC izni var/);
    expect(
      playManifest.playManifestSorunlari([...ogeler({}), { ad: 'service', oznitelik: { name: playManifest.KALDIRILAN_HIZMETLER[1] } }]).join(),
    ).toMatch(/AudioRecordingService hizmeti var/);
  });
});

describe('G2 — ağ güvenlik yapılandırması (yalnız sistem CA, şifresiz kapalı; TABLET-GENEL-CA-BAGLANTI §3)', () => {
  const xmlOge = (xml: string) => {
    const capalar = [...xml.matchAll(/<certificates src="([^"]+)"/g)].map((m) => m[1]);
    const cleartext = /<base-config cleartextTrafficPermitted="(\w+)"/.exec(xml)?.[1];
    return [
      { ad: 'network-security-config', oznitelik: {} },
      { ad: 'base-config', oznitelik: { cleartextTrafficPermitted: cleartext } },
      { ad: 'trust-anchors', oznitelik: {} },
      ...capalar.map((src) => ({ ad: 'certificates', oznitelik: { src } })),
      ...(/<domain-config/.test(xml) ? [{ ad: 'domain-config', oznitelik: {} }] : []),
    ];
  };
  const uyg = [{ ad: 'manifest', oznitelik: {} }, { ad: 'application', oznitelik: { networkSecurityConfig: '@xml/network_security_config' } }];

  it('eklenti plugins listesinde; manifest @xml yapılandırmasını gösterir; sürüm ve geliştirme kopyası ayrı yazılır', () => {
    expect(appJson.plugins).toContain('./plugins/withAgGuvenligi');
    const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] } };
    agGuvenligi.manifesteYaz(manifest);
    expect(manifest.manifest.application[0].$).toMatchObject({ 'android:networkSecurityConfig': `@xml/${playManifest.NSC_ADI}` });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nsc-'));
    try {
      agGuvenligi.dosyalariYaz(tmp);
      const oku = (k: string) => fs.readFileSync(path.join(tmp, 'app/src', k, 'res/xml', `${playManifest.NSC_ADI}.xml`), 'utf8');
      expect(oku('main')).toBe(playManifest.NSC_SURUM);
      expect(oku('debug')).toBe(playManifest.NSC_GELISTIRME);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('sürüm yapılandırması: yalnız system çapası, şifresiz kapalı, istisna yok; geliştirme yalnız şifresizi açar', () => {
    expect(playManifest.agGuvenligiSorunlari(uyg, xmlOge(playManifest.NSC_SURUM))).toEqual([]);
    expect(playManifest.NSC_SURUM).not.toMatch(/src="user"|domain-config|overridePins|debug-overrides/);
    expect(playManifest.NSC_GELISTIRME).toMatch(/cleartextTrafficPermitted="true"/);
    expect(playManifest.NSC_GELISTIRME.replace('"true"', '"false"')).toBe(playManifest.NSC_SURUM);
  });

  it('negatif: kullanıcı CA\'sı, şifresiz açık, alan istisnası, eksik yapılandırma → sorun', () => {
    const user = playManifest.NSC_SURUM.replace('<certificates src="system" />', '<certificates src="system" /><certificates src="user" />');
    expect(playManifest.agGuvenligiSorunlari(uyg, xmlOge(user)).join()).toMatch(/system, user/);
    expect(playManifest.agGuvenligiSorunlari(uyg, xmlOge(playManifest.NSC_GELISTIRME)).join()).toMatch(/cleartextTrafficPermitted=true/);
    expect(playManifest.agGuvenligiSorunlari(uyg, [...xmlOge(playManifest.NSC_SURUM), { ad: 'domain-config', oznitelik: {} }]).join()).toMatch(/domain-config/);
    expect(playManifest.agGuvenligiSorunlari([{ ad: 'application', oznitelik: {} }], null).join()).toMatch(/networkSecurityConfig yok.*ÖLÇÜLEMEDİ/);
  });

  it('AAB doğrulaması yapılandırmayı paketin kendisinden ölçer', () => {
    const betik = fs.readFileSync(path.join(KOK, 'scripts/build-apk.mjs'), 'utf8');
    expect(betik).toMatch(/\.\.\.agGuvenligiSorunlari\(ogeler, nsc\)/);
  });
});
