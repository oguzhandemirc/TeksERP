// =============================================================================
// BEKÇİ: istemci sürüm politikası — İKİ EKSEN + KOŞULLU KİLİT
// =============================================================================
// ⚠️ Buradaki hataların ikisi de sahada geri dönüşü pahalı:
//  · Fazla gevşek → eski tablet yeni backend'e yazmaya devam eder, alan
//    SESSİZCE düşer (bu kapının var olma sebebi).
//  · Fazla sıkı → tablet kilitlenir ama güncellemeyi indiremez; ÇIKIŞI OLMAYAN
//    bir üretim durması olur. Mobilde bu risk masaüstünden yüksek, çünkü cihaz
//    çevrimdışı çalışabiliyor.
// =============================================================================

import {
  kilitlenmeliMi,
  politikaDegerlendir,
  surumKarsilastir,
  type IstemciPolitikasi,
} from './clientPolicy.service';

jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));

const POL: IstemciPolitikasi = { minVersion: '2.9.8', currentVersion: '2.9.8' };

describe('surumKarsilastir', () => {
  it('SAYISAL karşılaştırır — sözlüksel olsaydı 2.9.10 < 2.9.9 çıkardı', () => {
    expect(surumKarsilastir('2.9.10', '2.9.9')).toBe(1);
    expect('2.9.10' > '2.9.9').toBe(false); // yanlış cevabın kanıtı
  });
  it('eşitlik ve eksik hane', () => {
    expect(surumKarsilastir('2.9.8', '2.9.8')).toBe(0);
    expect(surumKarsilastir('3', '2.9.9')).toBe(1);
  });
});

describe('politikaDegerlendir — APK ekseni', () => {
  it('eski APK eskidir', () => {
    expect(politikaDegerlendir({ politika: POL, apkSurumu: '2.9.7', paketTarihi: null }))
      .toEqual({ eski: true, sebep: 'apk' });
  });
  it('eşit/yeni APK eski değildir', () => {
    expect(politikaDegerlendir({ politika: POL, apkSurumu: '2.9.8', paketTarihi: null }).eski)
      .toBe(false);
    expect(politikaDegerlendir({ politika: POL, apkSurumu: '3.0.0', paketTarihi: null }).eski)
      .toBe(false);
  });
});

describe('politikaDegerlendir — PAKET ekseni (mobile özel)', () => {
  const polPaket: IstemciPolitikasi = { ...POL, minPaketTarihi: '2026-08-27T00:00:00.000Z' };

  it('APK güncel ama JS paketi eskiyse YAKALAR', () => {
    // Masaüstü modelinin göremediği durum: versionName doğru, JS eski.
    const d = politikaDegerlendir({
      politika: polPaket,
      apkSurumu: '2.9.8',
      paketTarihi: new Date('2026-08-20T00:00:00.000Z'),
    });
    expect(d).toEqual({ eski: true, sebep: 'paket' });
  });

  it('yeni paket geçer', () => {
    expect(politikaDegerlendir({
      politika: polPaket,
      apkSurumu: '2.9.8',
      paketTarihi: new Date('2026-08-28T00:00:00.000Z'),
    }).eski).toBe(false);
  });

  it('⚠️ hiç OTA almamış tablet (paketTarihi null) ESKİ SAYILMAZ', () => {
    // Gömülü paket APK ile aynı yaşta; `null`ı "çok eski" saymak YENİ kurulmuş
    // her tableti kilitlerdi — kapının en kolay yapacağı zarar.
    expect(politikaDegerlendir({ politika: polPaket, apkSurumu: '2.9.8', paketTarihi: null }).eski)
      .toBe(false);
  });

  it('APK de paket de eskiyse sebep APK (çözüm kurulum dosyası)', () => {
    const d = politikaDegerlendir({
      politika: polPaket,
      apkSurumu: '2.9.7',
      paketTarihi: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(d.sebep).toBe('apk');
  });

  it('bozuk tarih yok sayılır (fail-open)', () => {
    expect(politikaDegerlendir({
      politika: { ...POL, minPaketTarihi: 'çöp' },
      apkSurumu: '2.9.8',
      paketTarihi: new Date('2020-01-01T00:00:00.000Z'),
    }).eski).toBe(false);
  });
});

describe('FAIL-OPEN', () => {
  it('politika yoksa tablet ESKİ sayılmaz', () => {
    expect(politikaDegerlendir({ politika: null, apkSurumu: '1.0.0', paketTarihi: null }).eski)
      .toBe(false);
  });
});

describe('kilitlenmeliMi — KOŞULLU kilit', () => {
  const eski = { eski: true, sebep: 'apk' as const };

  it('düzeltme hazırsa ve kuyruk boşsa kilitler', () => {
    expect(kilitlenmeliMi({ durum: eski, duzeltmeHazir: true, bekleyenYazim: 0 })).toBe(true);
  });

  it('⚠️ düzeltme İNDİRİLEMİYORSA KİLİTLEMEZ', () => {
    // İnternetsiz tablet: kilitlense çıkışı olmayan bir üretim durması olurdu.
    expect(kilitlenmeliMi({ durum: eski, duzeltmeHazir: false, bekleyenYazim: 0 })).toBe(false);
  });

  it('⚠️ gönderilmemiş kayıt varken KİLİTLEMEZ', () => {
    expect(kilitlenmeliMi({ durum: eski, duzeltmeHazir: true, bekleyenYazim: 3 })).toBe(false);
  });

  it('eski değilse hiçbir koşulda kilitlemez', () => {
    expect(kilitlenmeliMi({
      durum: { eski: false, sebep: null }, duzeltmeHazir: true, bekleyenYazim: 0,
    })).toBe(false);
  });
});
