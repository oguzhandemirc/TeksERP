import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { UserPermissionGrant } from "@/types/permissions";

export interface AdminUserListItem {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  /**
   * En yetkili hesap mı (2026-09-04). Bu hesabın HİÇ `UserPermission` satırı
   * YOKTUR — yetkisi sunucuda `["*"]` olarak verilir — yani `_count.permissions`
   * onda 0 çıkar ve liste onu "0 yetki" gösterirdi. Rozet bu alandan çizilir.
   */
  isSystemAccount?: boolean;
  _count: { permissions: number };
}

/** Kullanıcı detayı (Ayak İzi başlığı) — GET /api/admin/users/:id. */
export interface AdminUserDetail extends AdminUserListItem {
  lastSession: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
    device: { id: string; name: string; kind: string };
    machine: { id: string; code: string; name: string } | null;
    station: { id: string; code: string; name: string; kind: string };
  } | null;
}

/** Toplu yetki kaydı öğesi — izin + opsiyonel bitiş tarihi ("YYYY-MM-DD" veya null/sınırsız). */
export interface PermissionSetItem {
  permissionId: string;
  /** Süreli izin bitişi. null/verilmezse süresiz. Backend z.coerce.date() ile Date'e çevirir. */
  validUntil?: string | null;
}

/**
 * `GET /api/admin/users/:id/credentials` — kısa kimlik DURUMU. DB'de düz değer yoktur:
 * `quickPin`/`cardCode` yalnız yeni verildiyse (kısa basım penceresi) ya da henüz
 * dönüştürülmemiş eski düz kayıttan dolu döner; özetli PIN'de `quickPin` "••••••" yer tutucudur.
 */
export interface UserCredentialStatus {
  quickPin: string | null;
  cardCode: string | null;
  quickPinSet: boolean;
  quickPinSetAt: string | null;
  quickPinRevealed: boolean;
  /** false → özet bu sunucunun anahtarıyla doğrulanamıyor (yedek başka makineden). */
  quickPinKeyOk: boolean;
  quickPinStorage: "OZET" | "DUZ" | null;
  cardSet: boolean;
  cardIssuedAt: string | null;
  cardRevealed: boolean;
  cardKeyOk: boolean;
  /** Kart düz metin döneminde basıldı (128 bit) — yeniden basılması önerilir. */
  cardLegacy: boolean;
  revealExpiresAt: string | null;
}

/** `GET /api/admin/short-credentials/status` — değer taşımaz. */
export interface ShortCredentialStatus {
  key: { ok: boolean; activeKid: string | null; kids: string[]; problem: string | null; detail: string | null };
  pin: { digest: number; legacyPlain: number; foreign: number };
  card: { digest: number; legacyPlain: number; legacyFormat: number; foreign: number };
  foreignKids: Array<{ kid: string; pin: number; card: number; escrow: boolean }>;
  escrow: { backupCrypto: "kapali" | "acik" | "gecersiz" | null; sealedKids: string[]; unsealedRingKids: string[] };
  approvedDeviceOnly: boolean;
  hostedInstallation: boolean;
}

export interface BulkPreviewRow {
  userId: string;
  username: string;
  fullName: string;
  reason: "ANAHTAR_UYUSMUYOR" | "DUZ_METIN" | "GECERLI";
  setAt: string | null;
}

export interface BulkResetPreview {
  scope: "uyusmayan" | "tumu";
  pins: BulkPreviewRow[];
  cardsToReprint: Array<{ userId: string; username: string; fullName: string; issuedAt: string | null }>;
}

export interface BulkResetResult {
  results: Array<{ userId: string; username: string; fullName: string; pin: string }>;
  skipped: string[];
}

/** `GET /api/admin/users/:id/totp` yanıtı. */
export interface TotpStatus {
  enabled: boolean;
  enabledAt: string | null;
  /** Kullanılmamış kurtarma kodu sayısı — "1 kod kaldı" uyarısının kaynağı. */
  remainingRecoveryCodes: number;
}

/** Açılan kurulum penceresi. ⚠️ Sır DÖNMEZ — QR'ı kullanıcı kendi penceresinde okur. */
export interface TotpWindow {
  token: string;
  expiresAt: string;
}

/** Fabrika yöneticisi açma sonucu. `temporaryPassword` YALNIZ bu cevapta gelir. */
export interface FactoryAdminCreated {
  user: { id: string; username: string; fullName: string };
  temporaryPassword: string;
}

export const adminUserService = {
  /** Fabrikanın kendi yöneticisini aç — parolayı sunucu üretir, yetkiyi sunucu uygular. */
  createFactoryAdmin: (body: { username: string; fullName: string }): Promise<FactoryAdminCreated> =>
    apiClient
      .post<ApiResponse<FactoryAdminCreated>>("/api/admin/factory-admin", body)
      .then((r) => r.data.data),

  list: (): Promise<ApiResponse<AdminUserListItem[]>> =>
    apiClient.get<ApiResponse<AdminUserListItem[]>>("/api/admin/users").then((r) => r.data),

  /** Kullanıcı detayı — kimlik + yetki sayısı + son çalışma oturumu. */
  getById: (id: string): Promise<ApiResponse<AdminUserDetail>> =>
    apiClient.get<ApiResponse<AdminUserDetail>>(`/api/admin/users/${id}`).then((r) => r.data),

  /** Personel kartı sırrını üret/YENİLE (rotasyon) — dönen cardCode QR olarak basılır.
   *  Eski kart anında geçersiz; açık oturumlar etkilenmez. */
  rotateCardToken: (
    userId: string,
  ): Promise<ApiResponse<{ cardCode: string; rotated: boolean }>> =>
    apiClient
      .post<ApiResponse<{ cardCode: string; rotated: boolean }>>(
        `/api/admin/users/${userId}/card-token`,
      )
      .then((r) => r.data),

  /** Kullanıcının kısa kimlik durumu (hızlı PIN + QR kart). Düz değer yalnız basım
   *  penceresinde döner (bkz. `UserCredentialStatus`). admin:settings + admin:users. */
  getCredentials: (userId: string): Promise<ApiResponse<UserCredentialStatus>> =>
    apiClient
      .get<ApiResponse<UserCredentialStatus>>(`/api/admin/users/${userId}/credentials`)
      .then((r) => r.data),

  /** Kısa kimlik genel durumu — anahtar, düz kalan, uyuşmayan, emanet. */
  shortCredentialStatus: (): Promise<ApiResponse<ShortCredentialStatus>> =>
    apiClient
      .get<ApiResponse<ShortCredentialStatus>>("/api/admin/short-credentials/status")
      .then((r) => r.data),

  /** Başka makineden gelen özetlerin anahtarını emanetten geri koy (yedek parolası başlıkta). */
  restoreShortCredentialKey: (
    headers: Record<string, string>,
  ): Promise<ApiResponse<{ needed: string[]; restored: string[]; failed: string[]; notEscrowed: string[] }>> =>
    apiClient
      .post<ApiResponse<{ needed: string[]; restored: string[]; failed: string[]; notEscrowed: string[] }>>(
        "/api/admin/short-credentials/key/restore",
        {},
        { headers, suppressErrorToast: true },
      )
      .then((r) => r.data),

  bulkResetPreview: (scope: "uyusmayan" | "tumu"): Promise<ApiResponse<BulkResetPreview>> =>
    apiClient
      .get<ApiResponse<BulkResetPreview>>("/api/admin/short-credentials/bulk-reset/preview", { params: { scope } })
      .then((r) => r.data),

  /** Seçili kullanıcılara yeni rastgele PIN — düz PIN'ler YALNIZ bu cevapta döner. */
  bulkReset: (userIds: string[]): Promise<ApiResponse<BulkResetResult>> =>
    apiClient
      .post<ApiResponse<BulkResetResult>>("/api/admin/short-credentials/bulk-reset", { userIds })
      .then((r) => r.data),

  /** Hızlı PIN ata/üret/kaldır (salt-PIN girişi — benzersiz 6 hane). pin verilmezse
   *  rastgele üretilir; başkasında varsa backend 409 döner; clear=true kaldırır. */
  setQuickPin: (
    userId: string,
    input: { pin?: string; clear?: boolean },
  ): Promise<ApiResponse<{ pin: string | null }>> =>
    apiClient
      .post<ApiResponse<{ pin: string | null }>>(`/api/admin/users/${userId}/quick-pin`, input)
      .then((r) => r.data),

  getPermissions: (userId: string): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .get<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/permissions`)
      .then((r) => r.data),

  /** Kullanıcının yetkilerini toplu set'le. Her öğe izin + opsiyonel bitiş tarihi taşır
   *  (süreli izin). Backend { permissions: [{permissionId, validUntil?}] } bekler. */
  setPermissions: (
    userId: string,
    permissions: PermissionSetItem[],
  ): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .put<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/permissions`, {
        permissions,
      })
      .then((r) => r.data),

  resetPassword: (userId: string, password: string): Promise<void> =>
    apiClient.post(`/api/admin/users/${userId}/reset-password`, { password }).then(() => undefined),

  updateFullName: (userId: string, fullName: string): Promise<ApiResponse<AdminUserListItem>> =>
    apiClient
      .patch<ApiResponse<AdminUserListItem>>(`/api/admin/users/${userId}`, { fullName })
      .then((r) => r.data),

  // ── İki adımlı doğrulama (2026-09-01, uzaktan erişim) ─────────────────────
  // Kurulumun TEK yolu buradan açılan penceredir; kullanıcı kendi başına 2FA
  // bağlayamaz (parola sızmışsa saldırgan kendi telefonunu bağlardı).
  getTotpStatus: (userId: string): Promise<ApiResponse<TotpStatus>> =>
    apiClient
      .get<ApiResponse<TotpStatus>>(`/api/admin/users/${userId}/totp`)
      .then((r) => r.data),

  /** 15 dk ömürlü, TEK KULLANIMLIK kurulum penceresi açar. */
  openTotpWindow: (userId: string): Promise<ApiResponse<TotpWindow>> =>
    apiClient
      .post<ApiResponse<TotpWindow>>(`/api/admin/users/${userId}/totp/window`, {})
      .then((r) => r.data),

  /** 2FA'yı kaldırır — telefon kaybı / cihaz değişimi. Açık oturumlar düşer. */
  resetTotp: (userId: string): Promise<void> =>
    apiClient.post(`/api/admin/users/${userId}/totp/reset`, {}).then(() => undefined),

  applyTemplate: (
    userId: string,
    templateId: string,
    mode: "merge" | "replace",
  ): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .post<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/apply-template`, {
        templateId,
        mode,
      })
      .then((r) => r.data),
};
