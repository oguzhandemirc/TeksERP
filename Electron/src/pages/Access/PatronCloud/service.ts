import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";

/** Backend sözleşmesi — `GET /api/patron-bulut` (Teks-Erp `services/patron-cloud.service.ts` PatronCloudStatus). */
/** Backend `CLOUD_BLOCK_REASONS` aynası (`src/cloud-sync/eligibility.ts`). */
export type CloudIneligibleReason =
  | "HAZIR_DEGIL"
  | "HAK_YOK"
  | "KIRA_YOK"
  | "LISANS_GECERSIZ"
  | "LISANS_OLCULEMEDI"
  | "SINIF_URETIM_DEGIL"
  | "PATRON_BULUT_HAKKI_YOK"
  | "ABONELIK_YOK"
  | "DEVREDILDI"
  | "ARALIK_YOK"
  | "BULUT_ADRESI_YOK";

export type CloudUrlSource = "varsayilan" | "ortam" | "kapali" | "gecersiz";

/** Bulut hesabı — bulutun kendi hesabı (fabrika kullanıcısı DEĞİL); liste eşitlemeden gelir, salt okunur. */
export interface CloudAccount {
  id: string;
  ad: string;
  eposta?: string | null;
  durum: "DAVETLI" | "AKTIF" | "KILITLI" | "PASIF";
  sonGiris?: string | null;
}

export interface PatronCloudStatus {
  etkin: boolean;
  teknikKullanici: { id: string; username: string; fullName: string; isActive: boolean } | null;
  uygunluk: { ok: boolean; neden: CloudIneligibleReason | null };
  adres: CloudUrlSource;
  hesaplar: CloudAccount[];
  hesaplarAlinma: string | null;
  sonTur: {
    at: string;
    outcome: string;
    pulled: number;
    processed: number;
    rejected: number;
    uncertain: number;
    errorCode: string | null;
  } | null;
}

export interface PatronCloudActivation {
  userId: string;
  created: boolean;
  durum: PatronCloudStatus;
}

// Hatalar backend'in kendi cümlesiyle çağıranda tek toast olarak basılır.
const QUIET = { suppressErrorToast: true } as const;

export const patronCloudService = {
  status: (): Promise<PatronCloudStatus> =>
    apiClient.get<ApiResponse<PatronCloudStatus>>("/api/patron-bulut", QUIET).then((r) => r.data.data),

  /** ⚠️ AYAR ŞİFRESİ KAPISINDAN GEÇER (uç `system_settings`e teknik kullanıcı kaydını yazar). */
  activate: (): Promise<{ data: PatronCloudActivation; message?: string }> =>
    withSettingsPassword((headers) =>
      apiClient
        .post<ApiResponse<PatronCloudActivation>>("/api/patron-bulut/etkinlestir", {}, { headers, ...QUIET })
        .then((r) => ({ data: r.data.data, message: r.data.message })),
    ),

  /**
   * Bulut hesabını KİLİTLE — backend buluta kurulum imzalı istek atar (bulut tek yazar; kilidi bulut yöneticisi açar).
   * `islemKimligi` mantıksal deneme başına bir kez (`useAttemptToken`); ⚠️ ayar şifresi kapısından geçer.
   */
  lock: (hesapId: string, islemKimligi: string): Promise<{ data: CloudAccount; message?: string }> =>
    withSettingsPassword((headers) =>
      apiClient
        .post<ApiResponse<CloudAccount>>(`/api/patron-bulut/hesap/${hesapId}/kilitle`, { islemKimligi }, { headers, ...QUIET })
        .then((r) => ({ data: r.data.data, message: r.data.message })),
    ),
};
