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

/** ÜST bağlamın register fonksiyonunu döndürür — iç içe sekmelerin (WorkstationTabs)
 *  hem kendi guard'ını kurup hem de üst sekmeye kirliliği iletmesi için. */
export function useSettingsDirtyRegister(): (dirty: boolean) => void {
  return useContext(SettingsDirtyContext);
}
