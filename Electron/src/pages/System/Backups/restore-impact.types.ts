// =============================================================================
// Geri yükleme etki önizlemesi — backend kontratı
// =============================================================================
// Kaynak: Teks-Erp/src/services/backup-impact.service.ts
// GET /api/admin/backups/:name/restore-impact → { success, data }
// =============================================================================

export type ImpactGroupKey = "production" | "orders" | "subcontract" | "system";
export type BackupVerifyResult = "ok" | "corrupt" | "unknown";

export interface ImpactRow {
  key: string;
  label: string;
  /** `null` = ÖLÇÜLEMEDİ (timeout/hata). Sıfırla KARIŞTIRILMAMALI. */
  count: number | null;
  timestampField: string;
  note?: string;
}

export interface ImpactGroup {
  key: ImpactGroupKey;
  label: string;
  rows: ImpactRow[];
}

export interface AuditRollup {
  /** false ise sayılar alt sınır bile değil → UI "ölçülemedi" yazar, ASLA 0 göstermez. */
  available: boolean;
  oldestLogAt: string | null;
  created: number;
  updated: number;
  deleted: number;
  byTable: Array<{
    tableName: string;
    created: number;
    updated: number;
    deleted: number;
    total: number;
  }>;
}

export interface RestoreTarget {
  host: string;
  port: string;
  user: string;
  database: string;
}

export interface RestoreImpact {
  /** `absPath` backend'in `path.join`'inden gelir — istemci ayırıcı BİRLEŞTİRMEZ. */
  file: { name: string; sizeBytes: number; time: string; absPath: string };
  /** `source: "mtime"` → ad çözülemedi, kesim anı dump SÜRESİ kadar sapabilir. */
  cutoff: { at: string; source: "name" | "mtime" };
  isNewest: boolean;
  newerBackup: { name: string; time: string } | null;
  canRestore: boolean;
  blockReasons: string[];
  warnings: string[];
  restoreTarget: RestoreTarget | null;
  verify: BackupVerifyResult;
  /** Geri yükleme öncesi alınacak güvenlik yedeğinin adı — BACKEND üretir. */
  safetyBackup: { fileName: string; absPath: string } | null;
  /** Backend çalışma dizini — `prisma migrate deploy` oradan koşar. */
  backendCwd: string;
  pm2AppName: string;
  audit: AuditRollup;
  groups: ImpactGroup[];
  totalCreated: number;
  /** false → toplam "en az" dilinde sunulmalı. */
  measuredAllRows: boolean;
  computedAt: string;
  durationMs: number;
}

export interface RestoreImpactResponse {
  success: boolean;
  data: RestoreImpact;
}
