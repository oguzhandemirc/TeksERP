// =============================================================================
// BİLDİRİM PROFİLLERİ İSTEMCİSİ — yönetici uçları `/api/bildirim/profiller*` + `fabrika-varsayilani` (plan §5.6 F4)
// =============================================================================
// Kişisel uçlardan (`bildirimService`) ayrı dosya: kapı farklı (`settings:notifications ∨ admin:settings`).
// Genel hata toast'ı bastırılır; 400/409 cümlesini çağıran sunucudan basar, kod `details.code`tan okunur.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { NotificationGroup } from "@/lib/bildirim/types";

const BASE = "/api/bildirim";
const Q = { suppressErrorToast: true } as const;

export type ProfileCellState = "ACIK" | "KAPALI" | "KILITLI";
export type FactoryDefaultState = "MIRAS" | ProfileCellState;

export interface ProfileCell {
  tur: string;
  durum: ProfileCellState;
}

export interface NotificationProfile {
  id: string;
  kod: string;
  ad: string;
  arsivlendi: string | null;
  hucreler: ProfileCell[];
  uyeler: { userId: string; ad: string }[];
  /** Tür → bu türü göremeyen üye sayısı (bilgi; profil izin VERMEZ). Eski sunucu göndermez. */
  izinsizUyeler?: Record<string, number>;
}

export interface FactoryDefaultKind {
  tur: string;
  ad: string;
  grup: NotificationGroup;
  kilit: "YOK" | "HER_ZAMAN" | "NOBETTE";
  durum: FactoryDefaultState;
  esikler: Record<string, unknown>;
  esikVar: boolean;
  ekAlicilar: string[];
}

export interface FactoryDefaultInput {
  tur: string;
  durum: FactoryDefaultState;
  esikler?: Record<string, unknown>;
  ekAlicilar?: string[];
}

export interface LockPreviewAffected {
  userId: string;
  ad: string;
  turler: { tur: string; ad: string }[];
}

export interface MemberCandidate {
  id: string;
  ad: string;
  kullaniciAdi: string;
}

const data = <T>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> => p.then((r) => r.data.data);
const pid = (id: string) => `${BASE}/profiller/${encodeURIComponent(id)}`;

export const bildirimProfilService = {
  liste: (arsiv: boolean): Promise<{ items: NotificationProfile[] }> =>
    data(apiClient.get(`${BASE}/profiller${arsiv ? "?arsiv=1" : ""}`, Q)),
  /** `clientToken` mantıksal deneme başına (`useAttemptToken`); yalnız belirsiz hatada aynı token yeniden. */
  olustur: (body: { kod: string; ad: string; clientToken: string }): Promise<NotificationProfile> =>
    data(apiClient.post(`${BASE}/profiller`, body, Q)),
  yenidenAdlandir: (id: string, ad: string): Promise<NotificationProfile> => data(apiClient.patch(pid(id), { ad }, Q)),
  arsivle: (id: string): Promise<NotificationProfile> => data(apiClient.delete(pid(id), Q)),
  hucreleriYaz: (id: string, hucreler: ProfileCell[]): Promise<NotificationProfile> =>
    data(apiClient.put(`${pid(id)}/hucreler`, { hucreler }, Q)),
  kilitOnizleme: (id: string, hucreler: ProfileCell[]): Promise<{ etkilenen: LockPreviewAffected[] }> =>
    data(apiClient.post(`${pid(id)}/kilit-onizleme`, { hucreler }, Q)),
  uyeleriYaz: (id: string, userIds: string[]): Promise<NotificationProfile> =>
    data(apiClient.put(`${pid(id)}/uyeler`, { userIds }, Q)),
  adaylar: (): Promise<{ items: MemberCandidate[] }> => data(apiClient.get(`${BASE}/profiller/aday-kullanicilar`, Q)),
  fabrikaVarsayilani: (): Promise<{ turler: FactoryDefaultKind[] }> => data(apiClient.get(`${BASE}/fabrika-varsayilani`, Q)),
  fabrikaVarsayilaniYaz: (turler: FactoryDefaultInput[]): Promise<{ turler: FactoryDefaultKind[] }> =>
    data(apiClient.put(`${BASE}/fabrika-varsayilani`, { turler }, Q)),
};
