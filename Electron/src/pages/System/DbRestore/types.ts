// =============================================================================
// Kopyaya geri yükleme — backend kontratı
// =============================================================================
// Kaynak: Teks-Erp/src/services/db-copy.service.ts + db-copy-verify.service.ts
// =============================================================================

export type CopyPhase =
  | "queued"
  | "creating"
  | "restoring"
  | "verifying"
  | "ready"
  | "failed";

/** Etkin durum — backend'de `pg_database` + kayıt + bellekteki iş uzlaştırılarak hesaplanır. */
export type CopyState = CopyPhase | "interrupted" | "unverified";

export type CheckStatus = "ok" | "warn" | "fail" | "skipped";

export interface VerificationCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  expected?: string;
  actual?: string;
}

export interface MigrationDiff {
  expected: number;
  applied: number;
  missing: string[];
  extra: string[];
  unfinished: string[];
  rolledBack: string[];
}

export interface TableCount {
  table: string;
  /** `null` = ÖLÇÜLEMEDİ — `0` ile karıştırılmamalı. */
  liveCount: number | null;
  copyCount: number | null;
}

export interface VerificationReport {
  ok: boolean;
  checks: VerificationCheck[];
  migrations: MigrationDiff;
  tables: TableCount[];
  sizeBytes: number | null;
  liveSizeBytes: number | null;
  needsMigrateDeploy: boolean;
  checkedAt: string;
  durationMs: number;
}

export interface DbCopyJob {
  copyName: string;
  sourceBackup: string;
  phase: CopyPhase;
  startedAt: string;
  phaseStartedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  message: string | null;
  failedPhase: CopyPhase | null;
}

export interface DbCopy {
  name: string;
  createdAt: string | null;
  sizeBytes: number | null;
  state: CopyState;
  sourceBackup: string | null;
  openConnections: number;
  message: string | null;
}

export interface DiskGuardResult {
  ok: boolean;
  blockReason: string | null;
  warnings: string[];
  measuredPath: string;
  volumeKnown: boolean;
  freeBytes: number | null;
  liveSizeBytes: number | null;
  copiesTotalBytes: number;
}

export interface AdminCapability {
  user: string;
  isSuperuser: boolean;
  canCreateDb: boolean;
  enabled: boolean;
  reason: string | null;
  serverVersionNum: number;
}

export interface DbCopyListing {
  liveDatabase: string | null;
  liveSizeBytes: number | null;
  capabilities: AdminCapability | null;
  capabilityError: string | null;
  copies: DbCopy[];
  /** Takas sonrası kenara çekilmiş eski canlı DB'ler — GERİ DÖNÜŞ NOKTASI, silinmez. */
  oldDatabases: DbCopy[];
  disk: DiskGuardResult | null;
  job: DbCopyJob | null;
  lastResult: DbCopyJob | null;
  error: string | null;
}

export interface SwapCommands {
  forward: string;
  rollback: string;
  needsMigrateDeploy: boolean;
}

/** İş koşarken hangi fazlarda yoklama yapılmalı. */
export const ACTIVE_PHASES: readonly CopyPhase[] = [
  "queued",
  "creating",
  "restoring",
  "verifying",
];

/**
 * Yoklama aralığı — SAF, test edilebilir.
 *
 * `useIsTabActive()` gating'i ZORUNLU (K-A8): açık sekmelerin hepsi mount kalır,
 * gating olmadan pasif sekmede sonsuza dek poll döner. İş yokken de `false` —
 * bu sayfada boşta izlenecek canlı metrik yok.
 */
export function pollIntervalFor(phase: CopyPhase | null | undefined, isTabActive: boolean): number | false {
  if (!isTabActive) return false;
  if (!phase) return false;
  return ACTIVE_PHASES.includes(phase) ? 2_000 : false;
}
