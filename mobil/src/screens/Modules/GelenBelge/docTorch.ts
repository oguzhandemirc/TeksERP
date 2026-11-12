// Belge kameralarının feneri — TEK kaynak: dört yüzey (sayfa / çok çekimli / masa / canlı) başlangıç değerini buradan alır.
// Başlangıç = cihaz ayarı "Flaşı otomatik aç" (varsayılan açık); operatör o çekimde düğmeyle değiştirir, her açılış ayara döner.
// Flaşı olmayan cihazda istek sessizce etkisizdir (expo-camera `enableTorch` / native `hasFlashUnit` yoklaması).
import { useCallback, useEffect, useState } from 'react';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';

/** Kamera açılışında fenerin ilk durumu: yalnız ayar belirler (saf; hook ve test aynı yüklemi kullanır). */
export function initialDocTorch(autoSetting: boolean): boolean {
  return autoSetting === true;
}

/** `active` her true'ya döndüğünde (modal yeniden açıldı) ayara sıfırlanır; kapalıyken fener istenmez. */
export function useDocTorch(active: boolean): { torch: boolean; toggle: () => void } {
  const auto = useDeviceSettingsStore((s) => s.docTorchAuto);
  const [on, setOn] = useState(() => initialDocTorch(auto));
  useEffect(() => {
    if (active) setOn(initialDocTorch(auto));
  }, [active, auto]);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return { torch: active && on, toggle };
}
