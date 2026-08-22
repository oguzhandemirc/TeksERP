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

/**
 * ALAN SEÇİMİ (survivorship, P2). `values` gruptaki her kaydın değeri,
 * `suggestedFromId` sunucunun önerisi (survivor doluysa o, değilse en çok
 * referanslı kaynağın dolu değeri). Seçim DEĞER değil KAYIT üzerinden yapılır.
 */
export interface MergeFieldChoice {
  field: string;
  label: string;
  kind: "text" | "ref" | "number";
  values: Array<{ recordId: string; value: string | null }>;
  suggestedFromId: string;
  differs: boolean;
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
  fieldChoices: MergeFieldChoice[];
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
  /** Survivor'a kaynaktan yazılan alanlar (P2). */
  fieldsApplied: Array<{ field: string; from: string; value: string | null }>;
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

// ── HAYALET TOP (mükerrer ham giriş) — panel v2 P3c ──────────────────────────
// ⚠️ Top bir İŞLEM KAYDIDIR: "birleştirme" diye bir şey yok (metraj toplanmaz —
// fiziksel olarak tek top vardı). Fazlalık `MUKERRER` sebep koduyla İPTAL edilir
// ve iptal, topun kendi ucundan (`DELETE /api/rolls/:id`) geçer — o ucun etiket /
// çuval / sevkiyat guard'ları olduğu gibi kalsın diye toplu iptal ucu YOK.

export interface DuplicateRollRow {
  id: string;
  barcode: string | null;
  createdAt: string;
  status: string;
  clientToken: string | null;
  labelPrinted: boolean;
  /** Doluysa bu top iptal EDİLEMEZ (çuvalda / sevkiyata bağlı). */
  blockedReason: string | null;
}

export interface DuplicateRollCluster {
  key: string;
  score: number;
  level: "STRONG" | "SUSPECT" | "WEAK";
  reasons: string[];
  itemId: string;
  itemName: string | null;
  colorName: string | null;
  initialQty: number;
  width: number | null;
  operatorName: string | null;
  rolls: DuplicateRollRow[];
  /** Önerilen "asıl": etiketi basılan (en eskisi), yoksa en eski kayıt. */
  suggestedKeepId: string;
}

export interface DuplicateRollScan {
  scannedAt: string;
  days: number;
  windowSec: number;
  totals: { scanned: number; touched: number; evaluated: number; clusters: number; extras: number };
  clusters: DuplicateRollCluster[];
}

export const duplicateRollsService = {
  scan: (days: number) =>
    apiClient
      .get<ApiResponse<DuplicateRollScan>>(`/api/rolls/duplicates?days=${days}`)
      .then((r) => r.data),

  /**
   * Tek topu `MUKERRER` sebebiyle iptal eder. Sebep METNİNİ sunucu katalogdan
   * doldurur (`reasonCode`); `confirmActive`/`confirmLabelPrinted` bilinçli onay
   * beyanlarıdır — panel bunları ancak operatör uyarıyı gördükten sonra gönderir.
   */
  cancel: (rollId: string) =>
    apiClient
      .delete<ApiResponse<unknown>>(
        `/api/rolls/${rollId}?confirmActive=true&confirmLabelPrinted=true&reasonCode=MUKERRER`,
      )
      .then((r) => r.data),
};

/**
 * LİSTE SATIRI (2026-08-22) — panelin ana ekranı artık "öneri listesi" değil
 * varlığın TAM listesidir; şüpheliler onun üzerinde bir SÜZGEÇTİR.
 * Gerekçe (kullanıcı): "tüm cari listesini göreyim, arasından kendim seçeyim".
 */
export interface DuplicateRecordRow {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  /** `null` = ölçülemedi (panel "?" basar), `0` = gerçekten referans yok. */
  refCount: number | null;
  suspect: {
    partnerIds: string[];
    rules: DuplicateRuleKind[];
    maxScore: number | null;
    details: string[];
    groupKey: string;
    /** Bu kaydın çiftlerinde verilmiş kararlar — rozet + "Geri aç" için. */
    reviews: Array<{
      id: string;
      partnerId: string;
      decision: DuplicateReviewDecision;
      note: string | null;
      decidedBy: string | null;
    }>;
  } | null;
}

export interface DuplicateRecordList {
  entity: MergeEntity;
  rows: DuplicateRecordRow[];
  total: number;
  suspectTotal: number;
  page: number;
  limit: number;
  fuzzyEnabled: boolean;
  thresholdPct: number;
}

export const mergeService = {
  /** Varlığın TAM listesi + şüpheli süzgeci — panelin ana ekranı. */
  records: (
    entity: MergeEntity,
    opts: {
      search?: string;
      onlySuspect?: boolean;
      includeInactive?: boolean;
      includeNotDuplicate?: boolean;
      page?: number;
      limit?: number;
    } = {},
  ) => {
    const q = new URLSearchParams({ entity });
    if (opts.search) q.set("search", opts.search);
    if (opts.onlySuspect) q.set("onlySuspect", "true");
    if (opts.includeInactive) q.set("includeInactive", "true");
    if (opts.includeNotDuplicate) q.set("includeNotDuplicate", "true");
    if (opts.page) q.set("page", String(opts.page));
    if (opts.limit) q.set("limit", String(opts.limit));
    return apiClient
      .get<ApiResponse<DuplicateRecordList>>(`/api/master-data/duplicates/records?${q}`)
      .then((r) => r.data);
  },

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
      /** `{ alan: kayıtId }` — hangi alanın değeri hangi kayıttan alınsın (P2). */
      fieldPicks?: Record<string, string>;
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
