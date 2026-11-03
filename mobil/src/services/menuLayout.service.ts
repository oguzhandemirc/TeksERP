import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// Menü düzeni (K19) — backend `GET /api/menu-layout` (yalnız oturum). Tablet yalnız gizlenen ekran listesini okur;
// yazım panelde (Sistem → Menü Düzeni). Gizleme GÜVENLİK SINIRI DEĞİL: yalnız ana ekran karosu kalkar.
export interface MobileMenuLayout {
  hiddenScreens: string[];
}

export const menuLayoutService = {
  get: (): Promise<MobileMenuLayout> =>
    apiClient.get<ApiResponse<{ hiddenScreens?: unknown }>>('/menu-layout').then((r) => {
      const raw = r.data.data?.hiddenScreens;
      return { hiddenScreens: Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [] };
    }),
};
