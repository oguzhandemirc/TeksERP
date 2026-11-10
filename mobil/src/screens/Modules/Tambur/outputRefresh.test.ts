// Elle yenileme: dönüş en az bir tam tur; sonuç tostu başarı / kısa nedenli hata.
import { REFRESH_MIN_SPIN_MS, manualRefreshToast, remainingSpinMs, shortRefreshReason } from './outputRefresh';

describe('remainingSpinMs', () => {
  it('erken biten yenilemede turun kalanı kadar daha döner', () => {
    expect(remainingSpinMs(1000, 1100)).toBe(REFRESH_MIN_SPIN_MS - 100);
    expect(remainingSpinMs(1000, 1000)).toBe(REFRESH_MIN_SPIN_MS);
  });
  it('uzun süren yenilemede ek bekleme yok (bitince durur)', () => {
    expect(remainingSpinMs(1000, 1000 + REFRESH_MIN_SPIN_MS)).toBe(0);
    expect(remainingSpinMs(1000, 5000)).toBe(0);
  });
  it('saat geri giderse en fazla bir tur', () => {
    expect(remainingSpinMs(5000, 1000)).toBe(REFRESH_MIN_SPIN_MS);
  });
});

describe('manualRefreshToast', () => {
  it('başarı', () => {
    expect(manualRefreshToast(null)).toEqual({ type: 'success', text1: 'Çıkan etiketler yenilendi' });
  });
  it('hata kısa nedenle', () => {
    expect(manualRefreshToast(new Error('Sunucu hatası'))).toEqual({ type: 'error', text1: 'Yenilenemedi: Sunucu hatası' });
    expect(manualRefreshToast(new Error('Network Error')).text1).toBe('Yenilenemedi: bağlantı yok');
    expect(manualRefreshToast({}).text1).toBe('Yenilenemedi: bilinmeyen hata');
  });
  it('uzun neden kısaltılır', () => {
    const r = shortRefreshReason(new Error('x'.repeat(200)));
    expect(r.length).toBe(60);
    expect(r.endsWith('…')).toBe(true);
  });
});
