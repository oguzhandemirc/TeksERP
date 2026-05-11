import { create } from 'zustand';
import { storage } from '../utils/storage';
import type { JwtPayload } from '../types/auth';

type User = JwtPayload;

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  setAuth: (user: User, token: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  setAuth: async (user, token) => {
    await storage.setItem('auth_token', token);
    await storage.setItem('auth_user', JSON.stringify(user));
    set({ user, token });
  },

  clearAuth: async () => {
    await storage.deleteItem('auth_token');
    await storage.deleteItem('auth_user');
    set({ user: null, token: null });
  },

  loadStoredAuth: async () => {
    try {
      const token = await storage.getItem('auth_token');
      const userStr = await storage.getItem('auth_user');
      if (token && userStr) {
        set({ user: JSON.parse(userStr), token });
      }
    } finally {
      set({ isLoading: false });
    }
  },
}));
