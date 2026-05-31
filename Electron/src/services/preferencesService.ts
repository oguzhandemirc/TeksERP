import apiClient from "./apiClient";
import { mergePreferences, type AppPreferences } from "@/types/preferences";

interface PreferencesResponse {
  success: boolean;
  data: Partial<AppPreferences> | null;
}

/** Giriş yapan kullanıcının tercihlerini çeker (varsayılanlarla birleşmiş). */
export async function fetchPreferences(): Promise<AppPreferences> {
  const res = await apiClient.get<PreferencesResponse>("/api/auth/preferences");
  return mergePreferences(res.data.data);
}

/** Tüm tercih blob'unu kaydeder (backend upsert). */
export async function savePreferences(prefs: AppPreferences): Promise<AppPreferences> {
  const res = await apiClient.put<PreferencesResponse>("/api/auth/preferences", prefs);
  return mergePreferences(res.data.data ?? prefs);
}
