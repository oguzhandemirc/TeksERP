import { createContext, useContext, useEffect } from "react";

/**
 * Aktif ayar sekmesinin "kaydedilmemiş değişiklik var mı" bilgisini sayfaya taşır.
 * Genel Ayarlar sayfası sekme değiştirilirken bunu okuyup uyarı gösterir (taslak
 * kaybını önler). Radix aynı anda tek sekmeyi mount ettiği için yalnız aktif bölüm
 * kaydını yazar; bölüm unmount olurken temizler.
 */
const SettingsDirtyContext = createContext<(dirty: boolean) => void>(() => {});

export const SettingsDirtyProvider = SettingsDirtyContext.Provider;

/** Bir ayar bölümü, taslak kirlilik durumunu buradan bildirir. */
export function useRegisterSettingsDirty(dirty: boolean): void {
  const register = useContext(SettingsDirtyContext);
  useEffect(() => {
    register(dirty);
    return () => register(false);
  }, [dirty, register]);
}

// ⚠️ `useSettingsDirtyRegister` (üst bağlamın register'ını döndüren kaçış kapısı)
// 2026-09-04'te KALDIRILDI: tek okuyucusu `WorkstationTabs`ın iç içe sekmeleriydi
// ve o sekmeler Genel Ayarlar'ın soluna taşındı. İki katmanlı kirlilik = iki
// ayrı "kaydedilmemiş değişiklik" onayı demekti; artık tek guard var (sayfa).
// Yeniden ihtiyaç duyulursa çözüm bu hook'u geri getirmek değil, iç içe sekme
// AÇMAMAKtır.
