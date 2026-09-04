import { create } from "zustand";
import type { JwtPayload } from "@/types/auth";
import { tokenStore } from "@/lib/secure-token";

interface AuthState {
  user: JwtPayload | null;
  isHydrated: boolean;
  /**
   * Bu oturum satıcı (süperadmin) hesabı mı — `/api/auth/me`den, JWT'den DEĞİL.
   * `refreshSystemAccount()` doldurur; token çözümünden türetilemez.
   */
  isSystemAccount: boolean;
  /**
   * Kurulumda bir sistem hesabı DOĞMUŞ mu — backend guard'ının emniyet supabıyla
   * AYNI kaynak (`systemAccountExistsKnown`).
   *
   * ⚠️ VARSAYILAN `true` ve bu FAIL-CLOSED yöndür: cevap gelmeden önce panel
   * "sistem hesabı var, modül anahtarları bana kapalı" varsayar. Ters varsayım
   * (`false`) ekranı yazılabilir çizip 403 yedirirdi — kullanıcıya "kaydet"
   * dedirtip sunucuda reddedilmek, kısa süre salt-okunur görmekten kötüdür.
   */
  systemAccountExists: boolean;
  setUser: (user: JwtPayload | null) => void;
  setHydrated: (hydrated: boolean) => void;
  /** `/api/auth/me`den sistem-hesabı bayraklarını tazeler. ASLA reject etmez
   *  (best-effort): düşerse fail-closed varsayılanlar yerinde kalır. */
  refreshSystemAccount: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isHydrated: false,
  isSystemAccount: false,
  systemAccountExists: true,
  // ⚠️ `user = null` sistem-hesabı bayraklarını da SIFIRLAR. Tek yer değil iki
  // yol buraya düşüyor (manuel çıkış + apiClient'ın 401 dalı) ve ikisinde de
  // eski kimliğin bayrağı kalsaydı, aynı makinede nöbetleşen bir sonraki
  // kullanıcı `refreshSystemAccount()` cevap verene kadar YANLIŞ ekranı görürdü.
  setUser: (user) =>
    set(user === null ? { user: null, isSystemAccount: false, systemAccountExists: true } : { user }),
  setHydrated: (isHydrated) => set({ isHydrated }),
  refreshSystemAccount: async () => {
    try {
      // Dinamik import: apiClient ↔ auth store döngüsünü kır (logout ile aynı desen).
      const { authService } = await import("@/services/authService");
      const me = await authService.getMe();
      set({
        isSystemAccount: me.data.isSystemAccount === true,
        // Alan taşımayan ESKİ backend → `true` (fail-closed; bkz. tip yorumu).
        systemAccountExists: me.data.systemAccountExists !== false,
      });
    } catch {
      /* sunucuya ulaşılamadı / oturum düştü — varsayılanlar korunur */
    }
  },
  logout: async () => {
    // LOCAL-FIRST çıkış (Faz 2): UI sunucuyu BEKLEMEZ. Eski hali revoke POST'unu
    // await ediyordu — sunucu asılıysa login sayfası 15sn'e kadar gecikiyordu.
    // Sıra: (1) token'ı YAKALA (yerel silme sonrası istek 401 alırdı),
    // (2) yerel temizlik hemen (Root kapısı anında login'e düşer),
    // (3) sunucu revoke'u ARKA PLANDA best-effort (3sn timeout; başarısızsa
    // oturum expiry/kick ile düşer — eski best-effort semantiği korunur).
    // Bu fonksiyon ASLA reject etmez: çağıranlar `.then(→ #/login)` zincirine
    // güvenir (Topbar/CommandPalette).
    let token: string | null = null;
    try {
      token = await tokenStore.get();
    } catch {
      /* token okunamadı — revoke atlanır, yerel temizlik yeter */
    }
    try {
      await tokenStore.clear();
    } catch {
      /* disk silinemedi — user null yine de set edilir; token exp ile ölür */
    }
    // Sistem-hesabı bayrakları da SIFIRLANIR: aynı makinede nöbetleşen bir
    // sonraki kullanıcı, öncekinin kimliğiyle çizilmiş bir ekran görmemeli.
    set({ user: null, isSystemAccount: false, systemAccountExists: true });
    // Sekme defteri de kapanır: kalıcı olduğu için temizlenmezse bir sonraki
    // kullanıcı öncekinin sekmelerini (ve başlıklarındaki müşteri/sipariş
    // adlarını) hazır bulurdu. Dinamik import: store döngüsünü kırar.
    void import("@/store/tabs")
      .then((m) => m.useTabsStore.getState().resetTabs())
      .catch(() => undefined);
    if (token) {
      // Dinamik import: apiClient ↔ auth store döngüsünü kır (eski desen korunur).
      void (async () => {
        try {
          const { authService } = await import("@/services/authService");
          await authService.logout(token);
        } catch {
          /* sunucuya ulaşılamadı / oturum zaten iptal — sessiz */
        }
      })();
    }
  },
}));
