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
  /** Üyeler kişisel uygulama-içi tercih yazamaz. Eski sunucu göndermez (= kapalı). */
  tercihKilidi?: boolean;
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

export interface PresetProfileSet {
  kod: string;
  ad: string;
  aciklama: string;
  turler: string[];
}

export interface MemberCandidate {
  id: string;
  ad: string;
  kullaniciAdi: string;
}

/** Kişi kartı → Bildirimler: kişinin bir türü kanal başına nasıl aldığı (sunucu `resolvePreference`). */
export interface UserPrefChannel {
  kanal: "UYGULAMA" | "OZET" | "MASAUSTU" | "TABLET_SES" | "PATRON_PUSH";
  durum: "ACIK" | "KAPALI" | "GIZLI";
  kilit: boolean;
  kaynak: string;
  kisisel: { acik: boolean; kapsamli: boolean } | null;
}

export interface UserPrefKind {
  tur: string;
  ad: string;
  grup: NotificationGroup;
  gorur: boolean;
  /** Göremiyorsa Türkçe gerekçe (modül kapalı · yetki yok · pasif). */
  gizliNeden: string | null;
  kanallar: UserPrefChannel[];
}

export interface UserPrefSummary {
  kullanici: { id: string; ad: string; kullaniciAdi: string; aktif: boolean; sistemHesabi: boolean };
  tercihKilidi: { kilitli: boolean; profiller: string[] };
  profiller: { id: string; ad: string; tercihKilidi: boolean }[];
  turler: UserPrefKind[];
}

export interface UserPrefInput {
  tur: string;
  kanal: UserPrefChannel["kanal"];
  /** `null` = kişisel satırı kaldır (profil/fabrika/görev varsayılanına dön). */
  acik: boolean | null;
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
  tercihKilidiYaz: (id: string, tercihKilidi: boolean): Promise<NotificationProfile> => data(apiClient.patch(pid(id), { tercihKilidi }, Q)),
  arsivle: (id: string): Promise<NotificationProfile> => data(apiClient.delete(pid(id), Q)),
  hucreleriYaz: (id: string, hucreler: ProfileCell[]): Promise<NotificationProfile> =>
    data(apiClient.put(`${pid(id)}/hucreler`, { hucreler }, Q)),
  kilitOnizleme: (id: string, hucreler: ProfileCell[]): Promise<{ etkilenen: LockPreviewAffected[] }> =>
    data(apiClient.post(`${pid(id)}/kilit-onizleme`, { hucreler }, Q)),
  uyeleriYaz: (id: string, userIds: string[]): Promise<NotificationProfile> =>
    data(apiClient.put(`${pid(id)}/uyeler`, { userIds }, Q)),
  /** Hazır profillerin tam (süzgeçsiz) tür kümeleri — matrisi doldurmak için. Eski sunucu 404. */
  hazirProfiller: (): Promise<{ items: PresetProfileSet[] }> => data(apiClient.get(`${BASE}/profiller/hazir`, Q)),
  adaylar: (): Promise<{ items: MemberCandidate[] }> => data(apiClient.get(`${BASE}/profiller/aday-kullanicilar`, Q)),
  kisiTercihleri: (userId: string): Promise<UserPrefSummary> =>
    data(apiClient.get(`${BASE}/kullanicilar/${encodeURIComponent(userId)}/tercihler`, Q)),
  /** DELTA: yalnız verilen hücre değişir; sunucu kişinin göremediği türü 400 ile reddeder. */
  kisiTercihleriYaz: (userId: string, tercihler: UserPrefInput[]): Promise<UserPrefSummary> =>
    data(apiClient.put(`${BASE}/kullanicilar/${encodeURIComponent(userId)}/tercihler`, { tercihler }, Q)),
  fabrikaVarsayilani: ():Promise<{ turler: FactoryDefaultKind[] }> => data(apiClient.get(`${BASE}/fabrika-varsayilani`, Q)),
  fabrikaVarsayilaniYaz: (turler: FactoryDefaultInput[]): Promise<{ turler: FactoryDefaultKind[] }> =>
    data(apiClient.put(`${BASE}/fabrika-varsayilani`, { turler }, Q)),
};
