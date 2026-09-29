import { create } from "zustand";

/** K5 sayfasının oturum-dışı router'daki yolu — `router.tsx` ve yönlendirme aynı sabitten. */
export const LICENSE_SUSPENDED_PATH = "/lisans-durduruldu";

/**
 * K5 (lisans DURDURULDU) sinyali — kabuk seçimi buna bakar: durdurulmuş kurulumda
 * uygulama kabuğu (yüzlerce uç çağıran `AppShell`) HİÇ bağlanmaz, oturum yalnız
 * "verilerimi al" sayfasını açar (`pages/LicenseSuspended`).
 *
 * Kaynakların üçü de backend'in UYGULADIĞI karardır: giriş öncesi
 * `login-methods.lisansDurduruldu`, oturumda `GET /api/license/durum` kademesi ve
 * 403 `LICENSE_SUSPENDED`. Gözlem kipinde hiçbiri doğmaz (sıfır fark).
 */
interface LicenseSuspensionState {
  suspended: boolean;
  setSuspended: (value: boolean) => void;
}

export const useLicenseSuspension = create<LicenseSuspensionState>((set) => ({
  suspended: false,
  setSuspended: (value) => set((s) => (s.suspended === value ? s : { suspended: value })),
}));
