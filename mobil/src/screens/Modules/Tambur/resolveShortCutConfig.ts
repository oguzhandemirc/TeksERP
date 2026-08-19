// =============================================================================
// Kısa kesim ayarı: FABRİKA değeri + CİHAZ override'ı → tek sonuç (2026-08-19)
// =============================================================================
// Kural dosyası (`shortCutQuality.ts`) kaynak-agnostiktir: `enabled` +
// `thresholdM` nereden gelirse gelsin çalışır. Bu fonksiyon o iki değeri
// çözer ve DEĞERİN KAYNAĞI sorusunun TEK cevabı burasıdır — ekranda dağıtılırsa
// "hangisi geçerli" sorusu iki farklı yerde iki farklı cevaba düşer.
//
// Öncelik: CİHAZ override'ı fabrika ayarını EZER ('on'/'off'), 'server' izler.
// Gerekçe: fabrika kuralı genel doğrudur ama "bu tamburda metre makinesi yok"
// gibi yerel gerçekleri yalnız cihaz bilir; override yetkisi bu yüzden
// süpervizördedir (WorkPreferencesScreen).
// =============================================================================
import type { ShortCutOverrideMode } from '../../../store/deviceSettingsStore';

export interface ShortCutConfig {
  enabled: boolean;
  thresholdM: number | null;
}

export function resolveShortCutConfig(
  serverEnabled: boolean,
  serverThresholdM: number | null,
  overrideMode: ShortCutOverrideMode,
  deviceThresholdM: number | null,
): ShortCutConfig {
  if (overrideMode === 'off') {
    // Cihaz açıkça "burada uygulanmasın" dedi — fabrika açık olsa da kapalı.
    return { enabled: false, thresholdM: null };
  }
  if (overrideMode === 'on') {
    // ⚠️ Eşik CİHAZINKİdir; fabrika eşiğine SIZMAZ. Cihaz eşiği girilmemişse
    // kural inert kalır (`shortCutOverride` null eşikte zaten ateşlemez) —
    // sunucu değerine düşmek, operatörün görmediği bir eşikle kesim yapardı.
    return { enabled: true, thresholdM: deviceThresholdM };
  }
  return { enabled: serverEnabled, thresholdM: serverThresholdM };
}
