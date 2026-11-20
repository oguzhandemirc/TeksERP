import { cihazAdi, destekBaglami, ekranAdiBul, yalnizYol, type ContextInput } from './destekBaglam';

const girdi: ContextInput = {
  ekranAdi: 'Tambur',
  ekranAnahtari: 'Tambur',
  surum: '1.0.18',
  yapiKodu: 64,
  platform: { os: 'android', version: 33, constants: { Model: 'SM-X230', Manufacturer: 'samsung', Release: '13' } },
  cihazTuru: 'tablet',
  lastError: {
    at: '2026-11-15T10:00:00.000Z',
    method: 'POST',
    path: '/tambur/finalize',
    status: 409,
    message: 'Top zaten kesildi',
  },
};

// Sözleşme: bağlam katıdır; yalnız bu üst alanlar kabul edilir.
const IZINLI_UST = ['screen', 'path', 'relatedRecord', 'client', 'technical'];
const IZINLI_CLIENT = ['userAgent', 'browser', 'os', 'device', 'appVersion', 'locale'];

describe('otomatik bağlam', () => {
  const b = destekBaglami(girdi);

  it('ekran, sürüm + yapı kodu, cihaz, Android sürümü ve cihaz türü girer', () => {
    expect(b.screen).toBe('Tambur');
    expect(b.client?.appVersion).toBe('1.0.18 (64)');
    expect(b.client?.device).toBe('samsung SM-X230');
    expect(b.client?.os).toBe('Android 13 (API 33)');
    expect(b.technical?.cihazTuru).toBe('Tablet');
    expect(b.technical?.yapiKodu).toBe(64);
    expect(b.technical?.lastError).toEqual({
      at: '2026-11-15T10:00:00.000Z',
      istek: 'POST /tambur/finalize',
      durum: 409,
      mesaj: 'Top zaten kesildi',
    });
  });

  it('yalnız sözleşmedeki alanlar (bilinmeyen alan 400 olurdu)', () => {
    for (const k of Object.keys(b)) expect(IZINLI_UST).toContain(k);
    for (const k of Object.keys(b.client ?? {})) expect(IZINLI_CLIENT).toContain(k);
  });

  it('parola / PIN / token / cihaz kimliği / sunucu adresi GİRMEZ', () => {
    const metin = JSON.stringify(b).toLowerCase();
    for (const yasak of ['password', 'parola', 'pin', 'token', 'bearer', 'deviceid', 'http']) {
      expect(metin).not.toContain(yasak);
    }
  });

  it('16 KB sınırının çok altında kalır (uzun hata mesajı kırpılır)', () => {
    const uzun = destekBaglami({ ...girdi, lastError: { ...girdi.lastError!, message: 'x'.repeat(50_000) } });
    expect(JSON.stringify(uzun).length).toBeLessThan(4_000);
  });

  it('el terminali ve son hatasız durum', () => {
    const t = destekBaglami({ ...girdi, cihazTuru: 'phone', lastError: null, platform: { os: 'android', version: 30 } });
    expect(t.technical?.cihazTuru).toBe('El terminali / telefon');
    expect(t.technical).not.toHaveProperty('lastError');
    expect(t.client?.device).toBeUndefined();
  });
});

describe('yardımcılar', () => {
  it('model üretici adıyla başlıyorsa tekrar edilmez', () => {
    expect(cihazAdi({ Manufacturer: 'Zebra', Model: 'Zebra TC21' })).toBe('Zebra TC21');
  });

  it('sorgu dizesi atılır (kişisel veri sızmasın)', () => {
    expect(yalnizYol('/rolls?barcode=T1&customer=ABC')).toBe('/rolls');
  });

  it('ekran adı: modül kataloğu, sonra ek adlar, sonra ham anahtar', () => {
    const katalog = { Tambur: { label: 'Tambur Kontrol' } };
    expect(ekranAdiBul('Tambur', katalog)).toBe('Tambur Kontrol');
    expect(ekranAdiBul('ModuleSelect', katalog)).toBe('Bölüm Seçimi');
    expect(ekranAdiBul('Bilinmeyen', katalog)).toBe('Bilinmeyen');
    expect(ekranAdiBul(null, katalog)).toBeNull();
  });
});
