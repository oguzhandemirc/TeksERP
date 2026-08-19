// =============================================================================
// Mükerrer kayıt birleştirme — client servisi (backend /api/master-data)
// =============================================================================
// ⚠️ Tipler backend `src/services/master-data-merge.service.ts`in AYNASIDIR
// (Electron backend'i import edemez). Önizleme alanı eklerken İKİSİ birlikte
// güncellenir.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export const MERGE_ENTITIES = ["customer", "item", "color", "subcontractor"] as const;
export type MergeEntity = (typeof MERGE_ENTITIES)[number];

export const MERGE_ENTITY_LABEL: Record<MergeEntity, string> = {
  customer: "Müşteri",
  item: "Kumaş",
  color: "Renk",
  subcontractor: "Fason Firma",
};

export interface MergeBlocker {
  key: string;
  count: number;
  message: string;
}

export interface MergeMoveRow {
  model: string;
  table: string;
  column: string;
  label: string;
  /** ⚠️ `null` = ÖLÇÜLEMEDİ, `0` DEĞİL. Panelde "?" basılır, "0" DEĞİL. */
  count: number | null;
}

export interface MergeConflictRow {
  table: string;
  label: string;
  policy: string;
  why: string;
  count: number;
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
}

export interface MergePreview {
  entity: MergeEntity;
  survivor: { id: string; code: string | null; name: string } | null;
  sources: Array<{ id: string; code: string | null; name: string; isActive: boolean }>;
  canMerge: boolean;
  blockers: MergeBlocker[];
  warnings: string[];
  moves: MergeMoveRow[];
  conflicts: MergeConflictRow[];
  sideEffects: string[];
  totalRowsToMove: number;
  measuredAll: boolean;
  computedAt: string;
}

export interface DuplicateGroup {
  key: string;
  records: Array<{
    id: string;
    code: string | null;
    name: string;
    isActive: boolean;
    refCount: number | null;
  }>;
}

export interface MergeResult {
  survivorId: string;
  mergedCount: number;
  movedRows: Array<{ table: string; column: string; count: number }>;
  conflictsResolved: number;
}

export const mergeService = {
  duplicates: (entity: MergeEntity) =>
    apiClient
      .get<ApiResponse<DuplicateGroup[]>>(`/api/master-data/duplicates?entity=${entity}`)
      .then((r) => r.data),

  preview: (entity: MergeEntity, survivorId: string, sourceIds: string[]) =>
    apiClient
      .post<ApiResponse<MergePreview>>(`/api/master-data/${entity}/merge/preview`, {
        survivorId,
        sourceIds,
      })
      .then((r) => r.data),

  merge: (
    entity: MergeEntity,
    body: {
      survivorId: string;
      sourceIds: string[];
      reason: string;
      acknowledgedConflicts: number;
    },
  ) =>
    apiClient
      .post<ApiResponse<MergeResult>>(`/api/master-data/${entity}/merge`, body)
      .then((r) => r.data),
};
