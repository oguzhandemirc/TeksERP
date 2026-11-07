import { SCAN_NOT_FOUND_REASON, scanLookupReason } from './scanLookupReason';

const err = (o: Record<string, unknown>) => Object.assign(new Error(String(o.message ?? '')), o);

describe('scanLookupReason — okutulan barkodun sunucu hatası → kısa Türkçe sebep', () => {
  it('404 → Top bulunamadı (ham "Okunamadı" değil)', () => {
    expect(scanLookupReason(err({ status: 404, message: 'Barkod bulunamadı' }))).toBe('Top bulunamadı');
    expect(SCAN_NOT_FOUND_REASON).toBe('Top bulunamadı');
  });
  it('yanıtsız (ağ / zaman aşımı) ve vekil kapısı → Sunucuya ulaşılamadı', () => {
    expect(scanLookupReason(err({ message: 'Sunucuya ulaşılamıyor — Wi-Fi/ağ bağlantısını kontrol edin' }))).toBe(
      'Sunucuya ulaşılamadı',
    );
    expect(scanLookupReason(err({ status: 502, transient: 'gateway', message: 'x' }))).toBe('Sunucuya ulaşılamadı');
    expect(scanLookupReason(null)).toBe('Sunucuya ulaşılamadı');
  });
  it('diğer durumlarda backend mesajı; boş/uzunsa jenerik', () => {
    expect(scanLookupReason(err({ status: 403, message: 'Bu işlem için yetkiniz yok' }))).toBe('Bu işlem için yetkiniz yok');
    expect(scanLookupReason(err({ status: 500, message: '' }))).toBe('Sunucu hatası');
    expect(scanLookupReason(err({ status: 500, message: 'x'.repeat(61) }))).toBe('Sunucu hatası');
  });
  it('hiçbir yolda "Okunamadı" üretmez', () => {
    for (const s of [undefined, 400, 404, 409, 500]) {
      expect(scanLookupReason(err({ status: s, message: '' }))).not.toBe('Okunamadı');
    }
  });
});
