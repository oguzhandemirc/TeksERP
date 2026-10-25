// =============================================================================
// Bekçi: tablet kimliğinin kalıcılık kapıları (cihaz eşleme v2 §5.5 md. 2–3)
// =============================================================================
// versionCode düşüşü ve açık yedek, kaldır-kur/geri yüklemeyle yerel kimliği siler → panelde
// aynı tablet için yeni kayıt. NEGATİF SONDA (ölçüldü 2026-10-25): app.json allowBackup kaldırılınca
// 1 kırmızı (§1); düşüş karşılaştırması `<=` yapılınca 1 kırmızı (§2); paket denetiminden
// `yedekSorunlari` çıkarılınca 1 kırmızı (§4).
// =============================================================================
import fs from 'fs';
import path from 'path';

const KOK = path.join(__dirname, '../..');
/* eslint-disable @typescript-eslint/no-require-imports */
const kalicilik = require(path.join(KOK, 'scripts/lib/kalicilik.cjs'));
const playManifest = require(path.join(KOK, 'scripts/lib/play-manifest.cjs'));
/* eslint-enable @typescript-eslint/no-require-imports */

describe('kalıcılık kapıları', () => {
  it('§1 app.json android.allowBackup === false (K-C3)', () => {
    const app = JSON.parse(fs.readFileSync(path.join(KOK, 'app.json'), 'utf8'));
    expect(app.expo.android.allowBackup).toBe(false);
  });

  it('§2 versionCode düşüşü kırmızı, eşit/büyük yeşil, okunamayan ÖLÇÜLEMEDİ', () => {
    expect(kalicilik.versionCodeDususu('57', 58).sonuc).toBe('kirmizi');
    expect(kalicilik.versionCodeDususu('58', 58).sonuc).toBe('yesil');
    expect(kalicilik.versionCodeDususu('65', 64).sonuc).toBe('yesil');
    expect(kalicilik.versionCodeDususu(null, 64).sonuc).toBe('olculemedi');
    expect(kalicilik.versionCodeDususu('64', null).sonuc).toBe('olculemedi');
  });

  it('§3 önceki yayın = git geçmişindeki EN BÜYÜK versionCode (09-04 vc58→57 vakası yakalanır)', () => {
    const log = ['-      "versionCode": 57,', '+      "versionCode": 58,', '-      "versionCode": 58,', '+      "versionCode": 57,'].join('\n');
    expect(kalicilik.enBuyukGecmisVersionCode(log)).toBe(58);
    expect(kalicilik.versionCodeDususu('57', kalicilik.enBuyukGecmisVersionCode(log)).sonuc).toBe('kirmizi');
    expect(kalicilik.enBuyukGecmisVersionCode('')).toBeNull();
  });

  it('§4 paket manifesti: allowBackup false değilse Play sorunu', () => {
    const temel = [{ ad: 'application', oznitelik: { usesCleartextTraffic: 'false', allowBackup: 'false' } }];
    expect(playManifest.playManifestSorunlari(temel)).toEqual([]);
    const acik = [{ ad: 'application', oznitelik: { usesCleartextTraffic: 'false', allowBackup: 'true' } }];
    expect(playManifest.playManifestSorunlari(acik).join('\n')).toMatch(/allowBackup=true/);
    const yok = [{ ad: 'application', oznitelik: { usesCleartextTraffic: 'false' } }];
    expect(playManifest.playManifestSorunlari(yok).join('\n')).toMatch(/allowBackup=\(yok\)/);
  });

  it('§5 kaynak AndroidManifest metni: yalnız <application> üstündeki false geçer', () => {
    expect(kalicilik.kaynakManifestYedekKapali('<manifest><application android:name=".A"\n android:allowBackup="false" android:x="y">')).toBe(true);
    expect(kalicilik.kaynakManifestYedekKapali('<application android:allowBackup="true">')).toBe(false);
    expect(kalicilik.kaynakManifestYedekKapali('<application android:name=".A"><activity android:allowBackup="false"/>')).toBe(false);
  });
});
