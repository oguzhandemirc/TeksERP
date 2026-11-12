// Google belge tarayıcı "kullanılamaz" sebebi → Türkçe metin (TEK eşleme: "Sayfa çek" toast'ı + Belge Masası durum satırı).
// Native sebepler: play_services · module_missing · timeout · error · no_context; JS: no_module · start_failed.
// Saf: native import yok (jest'te doğrudan ölçülür).

export type ScannerAvailability = { available: boolean; reason: string };

/** Kamera yedeğine düşüldüğünde gösterilen toast başlığı. */
export const SCANNER_FALLBACK_TITLE = 'Google tarayıcı bu cihazda hazır değil — kamera açıldı';

/** Toast'ın ikinci satırı: sebebe göre ne yapılacağı. */
export function scannerUnavailableDetail(reason: string): string {
  switch (reason) {
    case 'module_missing':
      return 'Bileşen indiriliyor; cihaz internete bağlı kalsın, birkaç dakika sonra yeniden deneyin';
    case 'play_services':
      return 'Google Play hizmetleri yok/eski';
    case 'timeout':
      return 'Yanıt gecikti';
    case 'no_module':
      return 'Bu uygulama sürümünde Google tarayıcı yok';
    default:
      return `Açılamadı (${reason || 'bilinmiyor'})`;
  }
}

/** Belge Masası ayarındaki durum satırı; `null` = yoklama sürüyor. */
export function scannerStatusLine(a: ScannerAvailability | null): string {
  if (!a) return 'Durum: denetleniyor…';
  if (a.available) return 'Durum: hazır';
  switch (a.reason) {
    case 'module_missing':
      return 'Durum: bileşen indiriliyor… (cihaz internete bağlı kalsın)';
    case 'play_services':
      return 'Durum: Play hizmetleri yok/eski';
    case 'timeout':
      return 'Durum: yanıt gecikti';
    case 'no_module':
      return 'Durum: bu sürümde yok';
    default:
      return `Durum: açılamadı (${a.reason || 'bilinmiyor'})`;
  }
}
