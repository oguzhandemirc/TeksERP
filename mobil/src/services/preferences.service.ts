import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Kullanıcının kişisel UI tercih blob'u — backend: GET/PUT /auth/preferences
// (kullanıcı başına tek satır, serbest JSON; verifyToken yeterli).
//
// ⚠️ DİKKAT: PUT blob'un TAMAMINI değiştirir ve AYNI blob'u Electron yönetim
// paneli de kullanıyor (tema, accent, dashboard düzeni…). Mobil yalnız kendi
// anahtarını yazmalı; bu yüzden kaydederken mevcut blob OKUNUP üzerine merge
// edilir (bkz. useModuleOrder). Buradaki `save` ham blob'u gönderir.
// =============================================================================

export type PreferenceBlob = Record<string, unknown>;

export const preferencesService = {
  /** Giriş yapan kullanıcının tercih blob'u (yoksa boş obje). */
  get: (): Promise<PreferenceBlob> =>
    apiClient
      .get<ApiResponse<PreferenceBlob | null>>('/auth/preferences')
      .then((r) => r.data.data ?? {}),

  /** Tüm blob'u upsert eder. Çağıran taraf mevcut blob'la merge edip göndermeli. */
  save: (prefs: PreferenceBlob): Promise<PreferenceBlob> =>
    apiClient
      .put<ApiResponse<PreferenceBlob | null>>('/auth/preferences', prefs)
      .then((r) => r.data.data ?? prefs),
};
