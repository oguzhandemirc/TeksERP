import { create } from "zustand";

/** Etkinleştirme kilidi sayfasının oturum-dışı router'daki yolu — `router.tsx` ve yönlendirme aynı sabitten. */
export const LICENSE_ACTIVATION_PATH = "/lisans-etkinlestir";

/**
 * YOK: kilit yok · ETKINLESMEDI: yalnız etkinleştirme · KOPYA: + "verilerimi al" · KURULUM_HATASI: lisans klasörü
 * kullanılamıyor, yalnız lisans ekranı + "verilerimi al" (backend `ActivationLockClass`).
 */
export type ActivationLockClass = "YOK" | "ETKINLESMEDI" | "KOPYA" | "KURULUM_HATASI";

/**
 * G2 etkinleştirme kilidi sinyali — kabuk seçimi buna bakar: kilitli kurulumda uygulama kabuğu HİÇ bağlanmaz,
 * oturum yalnız etkinleştirme sayfasını açar (`pages/LicenseActivation`). Kaynaklar backend'in UYGULADIĞI karardır:
 * giriş öncesi `login-methods.lisansEtkinlesmedi`, oturumda `GET /api/license/durum` `etkinlestirmeKilidi` ve
 * 403 `LICENSE_NOT_ACTIVATED` (`details.sinif`). Geliştirme derlemesinde hiçbiri doğmaz.
 */
interface ActivationLockState {
  sinif: ActivationLockClass;
  setSinif: (value: ActivationLockClass) => void;
}

export const useActivationLock = create<ActivationLockState>((set) => ({
  sinif: "YOK",
  setSinif: (value) => set((s) => (s.sinif === value ? s : { sinif: value })),
}));

/** Kapı/durum yanıtındaki sınıf (bilinmeyen değer → ETKINLESMEDI: kilit sinyali geldi, tür okunamadı). */
export function activationLockClassOf(value: unknown): ActivationLockClass {
  return value === "YOK" || value === "KOPYA" || value === "KURULUM_HATASI" ? value : "ETKINLESMEDI";
}
