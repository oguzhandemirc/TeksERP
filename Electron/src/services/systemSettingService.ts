import apiClient from "./apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";

export interface SystemSetting {
  key: string;
  value: string;
  description: string | null;
  updatedById: string | null;
  updatedBy?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export const SETTING_KEYS = {
  SHIPPING_TOLERANCE_METERS: "shipping.toleranceMeters",
  ORDER_DEFAULT_DEADLINE_DAYS: "order.defaultDeadlineDays",
  WORKORDER_DEFAULT_PLAN_DURATION_DAYS: "workorder.defaultPlanDurationDays",
} as const;

export const systemSettingService = {
  list: (): Promise<ApiResponse<SystemSetting[]>> =>
    apiClient.get<ApiResponse<SystemSetting[]>>("/api/admin/settings").then((r) => r.data),

  /**
   * ⚠️ AYAR ŞİFRESİ KAPISINDAN GEÇER (üç yazma yüzeyinden biri). Şifre tanımlı
   * değilse hiçbir şey değişmez — istek şifresiz gider ve 200 döner.
   */
  upsert: (
    key: string,
    value: string,
    description?: string,
  ): Promise<ApiResponse<SystemSetting>> =>
    withSettingsPassword((headers) =>
      apiClient
        .put<ApiResponse<SystemSetting>>(
          `/api/admin/settings/${encodeURIComponent(key)}`,
          { value, description },
          { headers },
        )
        .then((r) => r.data),
    ),
};

/**
 * AYAR ŞİFRESİNİN YÖNETİMİ — YALNIZ SATICI (SİSTEM) HESABI.
 *
 * ⚠️ Uçlar sistem hesabı olmayan kimlikte **404** döner (403 ucun varlığını
 * doğrulardı — süperadmin gizliliği, P2 S6 kalıbı). Bu yüzden panel kartı da
 * yalnız `isSystemAccount` iken çizilir: fabrika yöneticisi 404 yiyen bir
 * düğme görmemeli.
 */
export const settingsPasswordAdminService = {
  status: (): Promise<ApiResponse<{ configured: boolean }>> =>
    apiClient
      .get<ApiResponse<{ configured: boolean }>>("/api/admin/settings-password")
      .then((r) => r.data),

  /** Tanımla/değiştir. Yanıt şifre/hash TAŞIMAZ (`{configured, rotated}`). */
  set: (password: string): Promise<ApiResponse<{ configured: boolean; rotated: boolean }>> =>
    apiClient
      .put<ApiResponse<{ configured: boolean; rotated: boolean }>>(
        "/api/admin/settings-password",
        { password },
      )
      .then((r) => r.data),

  /** Kaldır → kapı UYUR (hiçbir istek şifre istemez). */
  revoke: (): Promise<ApiResponse<{ configured: boolean; removed: boolean }>> =>
    apiClient
      .delete<ApiResponse<{ configured: boolean; removed: boolean }>>(
        "/api/admin/settings-password",
      )
      .then((r) => r.data),
};

/**
 * Backend `settings-password.service` + `settingsPasswordSchema` ile AYNI
 * sınırlar. ⚠️ ÜÇÜ DE LOAD-BEARING (2026-09-03 / D2 turu):
 *  • 8 alt sınır — kaba tahmine karşı.
 *  • 72 üst sınır — bcrypt yalnız ilk 72 baytı karıştırır; daha uzunu SESSİZCE
 *    kırpılır (ölçüldü: 100 karakterlik şifrede ilk 72 doğrulamaya yetiyordu).
 *  • KARAKTER KÜMESİ — şifre `X-Settings-Password` BAŞLIĞIYLA taşınır. Türkçe
 *    harf axios/fetch'te `ByteString` hatası verir (istek hiç çıkmaz), boşluk
 *    HTTP kırpmasına uğrar. Kart burada uyarmazsa süperadmin "tanımlandı"
 *    toast'ını görür, sonra hiçbir istemci o şifreyi İLETEMEZ ve fabrika
 *    rotasyona kadar bütün ayar yüzeylerinden kilitli kalır.
 */
export const SETTINGS_PASSWORD_MIN_LENGTH = 8;
export const SETTINGS_PASSWORD_MAX_LENGTH = 72;
/** Yazdırılabilir ASCII, boşluk YOK — backend Zod regex'inin birebir ikizi. */
export const SETTINGS_PASSWORD_CHARSET = /^[\x21-\x7E]+$/;
