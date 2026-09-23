// Yapılandırma paketi — client servisi (backend /api/config-bundle).
// Kurulumlar arası TANIM taşıma (etiket/kart/belge şablonları, roller).
// Ana veri içe aktarımından ayrı bir iştir: burada taşınan KAYIT değil AYAR'dır.

import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";

export type BundleKind =
  | "LABEL_TEMPLATE"
  | "TRAVELER_TEMPLATE"
  | "DOCUMENT_PROFILE"
  | "FREE_DOCUMENT"
  | "PERMISSION_TEMPLATE"
  | "NUMBER_SERIES";

export type ConflictStrategy = "rename" | "overwrite" | "skip";

export interface BundleKindInfo {
  kind: BundleKind;
  label: string;
  canRead: boolean;
  canWrite: boolean;
}

export interface BundleEnvelope {
  schemaVersion: 1;
  app: "TeksERP";
  exportedAt: string;
  items: Array<{ kind: BundleKind; key: string; payload: Record<string, unknown> }>;
  /**
   * Paketin BİLEREK taşımadıkları (D6). Eski paketler bu alanı taşımaz.
   * Ekranda gösterilir: "yok" ile "bilerek dışarıda" aynı şey değildir ve
   * hedefteki yönetici bunu pakete bakarak anlayabilmeli.
   */
  excluded?: string[];
}

export interface BundlePlanRow {
  kind: BundleKind;
  key: string;
  action: "CREATE" | "OVERWRITE" | "RENAME" | "SKIP" | "ERROR";
  newKey?: string;
  message?: string;
}

export interface BundlePlan {
  rows: BundlePlanRow[];
  summary: Record<string, number>;
  kinds: BundleKind[];
  applied?: number;
  failed?: number;
}

const base = "/api/config-bundle";

export const configBundleService = {
  kinds: (): Promise<ApiResponse<BundleKindInfo[]>> =>
    apiClient.get<ApiResponse<BundleKindInfo[]>>(`${base}/kinds`).then((r) => r.data),

  export: (kinds?: BundleKind[]): Promise<ApiResponse<BundleEnvelope>> =>
    apiClient
      .get<ApiResponse<BundleEnvelope>>(`${base}/export`, {
        params: kinds?.length ? { kinds: kinds.join(",") } : {},
      })
      .then((r) => r.data),

  preview: (envelope: BundleEnvelope, onConflict: ConflictStrategy): Promise<ApiResponse<BundlePlan>> =>
    apiClient.post<ApiResponse<BundlePlan>>(`${base}/preview`, { envelope, onConflict }).then((r) => r.data),

  /**
   * ⚠️ AYAR ŞİFRESİ KAPISINDAN GEÇER — paket NUMARA SERİSİ taşıyorsa (D6).
   *
   * Kapı UCA değil İÇERİĞE takılı: şablon taşıyan bir paket şifre sormaz,
   * numara serisi taşıyan sorar. İstemci bunu ÖNCEDEN BİLMEZ ve bilmemeli —
   * istek önce şifresiz gider, sunucu isterse diyalog açılır ve AYNI yük
   * başlıkla tekrarlanır. "Hangi tür şifre ister" listesini panele kopyalamak,
   * backend listesi değiştiği gün sessizce bayatlayan ikinci bir gerçek olurdu.
   *
   * ⚠️ SARMALAYICI OLMADAN KAPI SESSİZCE DÜŞÜYORDU (ölçüldü 2026-09-23):
   * `apiClient` `SETTINGS_PASSWORD*` kodlarında genel 403 toast'ını BİLEREK
   * bastırıyor ("diyalog zaten açılacak" varsayımıyla) — ama bu uç sarmalayıcı
   * kullanmadığı için diyalog AÇILMIYORDU. Sonuç: ne toast, ne pencere, ne
   * açıklama. Yeni bir kapının çıkışsız kalmasının en kötü biçimi.
   */
  apply: (envelope: BundleEnvelope, onConflict: ConflictStrategy): Promise<ApiResponse<BundlePlan>> =>
    withSettingsPassword((headers) =>
      apiClient
        .post<ApiResponse<BundlePlan>>(`${base}/apply`, { envelope, onConflict }, { headers })
        .then((r) => r.data),
    ),
};
