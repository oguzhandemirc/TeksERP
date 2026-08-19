// DOMAIN = CUD audit (Activity Page'in beslendiği kanal)
// AUTH   = login_success / login_failed
// SYSTEM = backend startup / unhandled error
export type SystemLogCategory = "DOMAIN" | "AUTH" | "SYSTEM";

export type SystemLogDomainAction = "CREATE" | "UPDATE" | "DELETE";
export type SystemLogAuthAction = "LOGIN_SUCCESS" | "LOGIN_FAILED";
export type SystemLogSystemAction = "STARTUP" | "ERROR";

export type SystemLogAction =
  | SystemLogDomainAction
  | SystemLogAuthAction
  | SystemLogSystemAction
  | string;

export interface SystemLogUserOption {
  id: string;
  username: string;
  fullName: string;
}

export interface SystemLogListItem {
  id: string;
  category: SystemLogCategory;
  action: SystemLogAction;
  tableName: string;
  recordId: string;
  ipAddress: string | null;
  createdAt: string;
  user: SystemLogUserOption | null;
  /**
   * ⚠️ YALNIZ kayıt-bazlı geçmişte (`recordId` filtresiyle) dolu — genel
   * listede backend bunları SEÇMEZ (perf kuralı: listede JSON çekme).
   */
  changes?: AuditChange[] | null;
  deviceId?: string | null;
  /**
   * İŞLEM GRUPLAMA (2026-08-19) — aynı HTTP isteğinde yazılan tüm audit
   * satırları aynı id'yi taşır ("bu üç değişiklik aynı kaydetme tuşundan mı
   * çıktı?"). Genel listede DE gelir (küçük skaler).
   * ⚠️ İş/script kaynaklı satırlarda null; o hâlde gruplama sorgusu ATILMAZ
   * (null filtre yanlış davranır).
   */
  requestId?: string | null;
}

export interface SystemLogDetail extends SystemLogListItem {
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  updatedAt: string;
}

export interface SystemLogListParams {
  cursor?: string;
  limit?: number;
  userId?: string;
  tableName?: string;
  /** TEK KAYDIN geçmişi (Faz B1). `tableName` ile BİRLİKTE verilir. */
  recordId?: string;
  category?: string; // "DOMAIN" | "AUTH" | "SYSTEM" | "AUTH,SYSTEM"
  action?: SystemLogAction;
  dateFrom?: string;
  dateTo?: string;
  /** TEK İŞLEMİN tüm satırları. Geçersiz UUID backend'de boş sonuca çevrilir. */
  requestId?: string;
}

export interface SystemLogStats {
  activeCount: number;
  archiveCount: number;
  oldestLog: string | null;
  lastAutoArchiveAt: string | null;
}

export interface SystemLogArchiveResult {
  archived: number;
  cutoff: string;
}

/**
 * Alan-bazlı değişiklik satırı (Faz B2).
 *
 * `oldLabel`/`newLabel` SUNUCUDA çözülür (`audit-value-resolver`): UUID taşıyan
 * alanlarda insana okunur karşılık. Çözülemeyen değerde alan hiç gelmez —
 * istemci ham değere düşer.
 */
export interface AuditChange {
  field: string;
  old: unknown;
  new: unknown;
  oldLabel?: string;
  newLabel?: string;
}
