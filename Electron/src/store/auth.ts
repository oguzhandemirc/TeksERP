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
    // Önce backend'de oturumu iptal et (registry revoke + audit) — token yerelde
    // silinince sunucuda geçerli kalmasın. Best-effort: dinamik import ile
    // apiClient ↔ auth store döngüsünü kır; sunucuya ulaşılamasa/oturum zaten
    // düşmüşse bile yerel temizliği yine yap.
    try {
      const { authService } = await import("@/services/authService");
      await authService.logout();
    } catch {
      /* sunucuya ulaşılamadı / oturum zaten iptal — yerel temizliğe devam */
    }
    await tokenStore.clear();
    set({ user: null });
  },
}));
