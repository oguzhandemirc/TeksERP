// =============================================================================
// Mükerrer kayıt birleştirme + inceleme kuyruğu — client servisi (backend /api/master-data)
// =============================================================================
// ⚠️ Tipler backend `src/services/master-data-merge.service.ts` ve
// `src/services/duplicate-detection.service.ts`in AYNASIDIR (Electron backend'i
// import edemez). Alan eklerken İKİSİ birlikte güncellenir.

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

// ── Mükerrer paneli v2 (P1) — tespit + kararlar ───────────────────────────────

export type DuplicateRuleKind = "EXACT_NAME" | "IDENTITY" | "FUZZY_NAME";
export type DuplicateReviewDecision = "NOT_DUPLICATE" | "MERGED" | "DEFERRED";

export const DUPLICATE_RULE_LABEL: Record<DuplicateRuleKind, string> = {
  EXACT_NAME: "Aynı ad",
  IDENTITY: "Kimlik",
  FUZZY_NAME: "Benzer ad",
};

export interface DuplicateCandidateRecord {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  identity: Record<string, string | null>;
  refCount: number | null;
}

export interface DuplicatePairEvidence {
  rule: DuplicateRuleKind;
  label: string;
  score?: number;
  detail: string;
}

export interface DuplicateCandidatePair {
  aId: string;
  bId: string;
  pairKey: string;
  evidence: DuplicatePairEvidence[];
  review: {
    id: string;
    decision: DuplicateReviewDecision;
    note: string | null;
    decidedAt: string;
    decidedBy: string | null;
  } | null;
}

export interface DuplicateCandidateGroup {
  key: string;
  records: DuplicateCandidateRecord[];
  pairs: DuplicateCandidatePair[];
  rules: DuplicateRuleKind[];
  maxScore: number | null;
  hasDeferred: boolean;
}

export interface DuplicateScanResult {
  entity: MergeEntity;
  scannedAt: string;
  fuzzyEnabled: boolean;
  thresholdPct: number;
  totals: { records: number; pairs: number; groups: number; hiddenNotDuplicate: number };
  groups: DuplicateCandidateGroup[];
}

export interface DuplicateReviewDto {
  id: string;
  entity: string;
  pairKey: string;
  aId: string;
  bId: string;
  decision: DuplicateReviewDecision;
  note: string | null;
  decidedAt: string;
  decidedBy: { id: string; username: string; fullName: string | null } | null;
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

  /** Tespit motoru: kesin ad + kimlik + bulanık ad — gerekçeli çiftler/gruplar. */
  candidates: (entity: MergeEntity, includeNotDuplicate = false) =>
    apiClient
      .get<ApiResponse<DuplicateScanResult>>(
        `/api/master-data/duplicates/candidates?entity=${entity}&includeNotDuplicate=${includeNotDuplicate ? "true" : "false"}`,
      )
      .then((r) => r.data),

  /** Aday raporu CSV (Blob) — dosya adı sunucudan gelir, istemci indirmeyi tetikler. */
  candidatesCsv: (entity: MergeEntity, includeNotDuplicate = false) =>
    apiClient
      .get<Blob>(
        `/api/master-data/duplicates/candidates.csv?entity=${entity}&includeNotDuplicate=${includeNotDuplicate ? "true" : "false"}`,
        { responseType: "blob" },
      )
      .then((r) => r.data),

  reviews: (entity: MergeEntity, decision?: DuplicateReviewDecision) =>
    apiClient
      .get<ApiResponse<DuplicateReviewDto[]>>(
        `/api/master-data/duplicates/reviews?entity=${entity}${decision ? `&decision=${decision}` : ""}`,
      )
      .then((r) => r.data),

  decide: (body: {
    entity: MergeEntity;
    aId: string;
    bId: string;
    decision: "NOT_DUPLICATE" | "DEFERRED";
    note?: string | null;
    evidence?: DuplicatePairEvidence[];
  }) =>
    apiClient
      .post<ApiResponse<DuplicateReviewDto>>(`/api/master-data/duplicates/reviews`, body)
      .then((r) => r.data),

  reopen: (id: string) =>
    apiClient
      .delete<ApiResponse<null>>(`/api/master-data/duplicates/reviews/${id}`)
      .then((r) => r.data),
};
