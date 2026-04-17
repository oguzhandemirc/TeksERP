import { create } from "zustand";
import type { JwtPayload } from "@/types/auth";
import { authService } from "@/services/authService";

interface AuthState {
  token: string | null;
  user: JwtPayload | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (token: string, user: JwtPayload) => void;
  logout: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: (token, user) => {
    localStorage.setItem("token", token);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ token: null, user: null, isAuthenticated: false });
  },

  hydrate: async () => {
    const storedToken = localStorage.getItem("token");
    if (!storedToken) {
      set({ isLoading: false });
      return;
    }

    try {
      set({ token: storedToken });
      const response = await authService.getMe();
      set({
        user: response.data,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      localStorage.removeItem("token");
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
}));
