import { create } from "zustand";
import type { JwtPayload } from "@/types/auth";
import { tokenStore } from "@/lib/secure-token";

interface AuthState {
  user: JwtPayload | null;
  isHydrated: boolean;
  setUser: (user: JwtPayload | null) => void;
  setHydrated: (hydrated: boolean) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isHydrated: false,
  setUser: (user) => set({ user }),
  setHydrated: (isHydrated) => set({ isHydrated }),
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
    set({ user: null });
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
