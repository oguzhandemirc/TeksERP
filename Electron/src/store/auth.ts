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
    await tokenStore.clear();
    set({ user: null });
  },
}));
