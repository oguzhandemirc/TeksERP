// Yapılandırma paketi — client servisi (backend /api/config-bundle).
// Kurulumlar arası TANIM taşıma (etiket/kart/belge şablonları, roller).
// Ana veri içe aktarımından ayrı bir iştir: burada taşınan KAYIT değil AYAR'dır.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type BundleKind =
  | "LABEL_TEMPLATE"
  | "TRAVELER_TEMPLATE"
  | "DOCUMENT_PROFILE"
  | "FREE_DOCUMENT"
  | "PERMISSION_TEMPLATE";

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

  apply: (envelope: BundleEnvelope, onConflict: ConflictStrategy): Promise<ApiResponse<BundlePlan>> =>
    apiClient.post<ApiResponse<BundlePlan>>(`${base}/apply`, { envelope, onConflict }).then((r) => r.data),
};
