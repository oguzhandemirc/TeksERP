// Tarayıcı sebebi → Türkçe metin eşlemesi (toast + ayar durum satırı tek kaynaktan).
import { scannerStatusLine, scannerUnavailableDetail } from './docScannerStatus';

describe('scannerUnavailableDetail', () => {
  it('⭐ bilinen sebepler kendi metnini verir', () => {
    expect(scannerUnavailableDetail('module_missing')).toBe('Bileşen indiriliyor; cihaz internete bağlı kalsın, birkaç dakika sonra yeniden deneyin');
    expect(scannerUnavailableDetail('play_services')).toBe('Google Play hizmetleri yok/eski');
    expect(scannerUnavailableDetail('timeout')).toBe('Yanıt gecikti');
  });
  it('diğer sebepler ham kodu parantezde taşır; boş sebep "bilinmiyor"', () => {
    expect(scannerUnavailableDetail('no_context')).toBe('Açılamadı (no_context)');
    expect(scannerUnavailableDetail('start_failed')).toBe('Açılamadı (start_failed)');
    expect(scannerUnavailableDetail('error')).toBe('Açılamadı (error)');
    expect(scannerUnavailableDetail('')).toBe('Açılamadı (bilinmiyor)');
  });
  it('negatif sonda: sebepler birbirinin metnine sızmaz', () => {
    expect(scannerUnavailableDetail('play_services')).not.toMatch(/indiriliyor/);
    expect(scannerUnavailableDetail('module_missing')).not.toMatch(/Play/);
    expect(scannerUnavailableDetail('timeout')).not.toMatch(/Açılamadı/);
    expect(scannerUnavailableDetail('Module_Missing')).toBe('Açılamadı (Module_Missing)');
  });
});

describe('scannerStatusLine', () => {
  it('⭐ yoklama / hazır / sebepler', () => {
    expect(scannerStatusLine(null)).toBe('Durum: denetleniyor…');
    expect(scannerStatusLine({ available: true, reason: 'ok' })).toBe('Durum: hazır');
    expect(scannerStatusLine({ available: false, reason: 'module_missing' })).toMatch(/^Durum: bileşen indiriliyor…/);
    expect(scannerStatusLine({ available: false, reason: 'play_services' })).toBe('Durum: Play hizmetleri yok/eski');
    expect(scannerStatusLine({ available: false, reason: 'no_module' })).toBe('Durum: bu sürümde yok');
    expect(scannerStatusLine({ available: false, reason: 'no_context' })).toBe('Durum: açılamadı (no_context)');
  });
  it('negatif sonda: kullanılamaz durum asla "hazır" demez', () => {
    for (const reason of ['module_missing', 'play_services', 'timeout', 'error', 'no_context', 'no_module', 'ok'])
      expect(scannerStatusLine({ available: false, reason })).not.toBe('Durum: hazır');
  });
});
