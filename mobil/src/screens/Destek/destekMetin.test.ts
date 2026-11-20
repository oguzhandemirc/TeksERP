import { boyutMetni, destekErrorText, durumEtiketi, silinmisEkMetni } from './destekMetin';

const hata = (status: number | undefined, code?: string, extra: Record<string, unknown> = {}, message = 'Sunucu metni') =>
  Object.assign(new Error(message), { status, details: code ? { code, ...extra } : undefined });

describe('hata metni — details.code ile karar', () => {
  it('ağ hatası (yanıt yok) bağlantı ister', () => {
    expect(destekErrorText(hata(undefined))).toMatch(/Sunucuya ulaşılamadı/);
  });

  it('502 / 504 merkez erişilemez', () => {
    expect(destekErrorText(hata(502, 'DESTEK_ULASILAMADI'))).toBe('Destek merkezine ulaşılamadı, tekrar deneyin.');
    expect(destekErrorText(hata(504, 'DESTEK_ZAMAN_ASIMI'))).toBe('Destek merkezine ulaşılamadı, tekrar deneyin.');
  });

  it('yapılandırma hatası yöneticiye yönlendirir (oturum kapatmaz)', () => {
    expect(destekErrorText(hata(502, 'DESTEK_YAPILANDIRMA'))).toMatch(/yöneticinize/);
  });

  it('429 bekleme süresini söyler', () => {
    expect(destekErrorText(hata(429, 'RATE_LIMITED', { retryAfterSec: 30 }))).toMatch(/30 saniye/);
    expect(destekErrorText(hata(429, 'RATE_LIMITED', { retryAfterSec: 120 }))).toMatch(/2 dakika/);
  });

  it('413 (kodsuz da) görüntü büyük der', () => {
    expect(destekErrorText(hata(413))).toMatch(/çok büyük/);
    expect(destekErrorText(hata(413, 'PAYLOAD_TOO_LARGE'))).toMatch(/çok büyük/);
  });

  it('14 günlük pencere dolmuşsa yeni talep önerir', () => {
    expect(destekErrorText(hata(409, 'REOPEN_WINDOW_EXPIRED'))).toMatch(/yeni talep/);
  });

  it('diğer 4xx: sunucunun Türkçe mesajı aynen gösterilir', () => {
    expect(destekErrorText(hata(400, 'SUBJECT_EMPTY', {}, 'Konu boş olamaz'))).toBe('Konu boş olamaz');
  });
});

describe('etiketler', () => {
  it('durumlar Türkçe; bilinmeyen durum çökmeden ham gösterilir', () => {
    expect(durumEtiketi('WAITING_CUSTOMER')).toBe('Sizden bilgi bekleniyor');
    expect(durumEtiketi('YENI_BIR_DURUM')).toBe('YENI_BIR_DURUM');
  });

  it('silinmiş ek metni ad ve boyut taşır', () => {
    expect(silinmisEkMetni({ name: 'ekran.webp', size: 48213 })).toBe(
      'Ek süresi dolduğu için silindi · ekran.webp · 47 KB',
    );
    expect(boyutMetni(3 * 1024 * 1024)).toBe('3,0 MB');
  });
});
