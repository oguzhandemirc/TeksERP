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
  /**
   * İzlenebilirlik B3: sunucunun OKUMA ANINDA kurduğu Türkçe cümle. Eski backend
   * göndermez → satır eski düzene düşer. YALNIZ GÖRÜNTÜ: istemci bundan karar
   * türetmez, geri de yazmaz.
   */
  anlati?: Anlati;
  /** `q` aramasında: eşleşen kaydın değil, aynı istekteki kardeş satır. */
  kardes?: boolean;
}

export type AnlatiParcaTuru = "kisi" | "kayit" | "deger" | "metin";

/** Backend `audit-narrative/sablonlar.ts` `Parca` sözleşmesinin aynası. */
export interface AnlatiParca {
  t: AnlatiParcaTuru;
  text: string;
  ref?: { table: string; id: string };
}

export interface Anlati {
  parcalar: AnlatiParca[];
  metin: string;
}

/** `gorunum=islem` öğesi: aynı istekteki audit satırları tek iş eylemi. */
export interface SystemLogIslem {
  /** requestId ya da (isteksiz satırda) log id. */
  id: string;
  requestId: string | null;
  createdAt: string;
  user: SystemLogUserOption | null;
  kayitSayisi: number;
  reddedildi: boolean;
  iz: SystemLogTraceSummary | null;
  anlati: Anlati;
  satirlar: Array<{ id: string; tableName: string; recordId: string; action: string; createdAt: string; anlati?: Anlati }>;
}

/**
 * İstek izi — YALNIZ bu alanlar çizilir. Gövde sunucuda SAKLANMAZ; istemci de
 * buraya alan eklemeden hiçbir şey göstermez (bekçi: audit-technical-detail.test).
 */
export interface SystemLogTraceSummary {
  id: string;
  deviceLocalId: string | null;
  clientType: string | null;
  appVersion: string | null;
  method: string;
  routeKey: string;
  status: number;
  durationMs: number | null;
  errorCode: string | null;
  auditCount: number | null;
  createdAt: string;
  ip?: string | null;
  cihazAdi?: string | null;
}

/** `GET /system-logs/islem/:requestId`. */
export interface SystemLogIslemDetay {
  requestId: string;
  user: SystemLogUserOption | null;
  anlati: Anlati;
  iz: SystemLogTraceSummary | null;
  kayitlar: Array<{
    id: string;
    tableName: string;
    modul: string;
    recordId: string;
    action: string;
    olay: string | null;
    anlati?: Anlati;
    changes?: AuditChange[] | null;
  }>;
  ham: unknown[];
}

export type SystemLogGun = "bugun" | "dun" | "hafta";

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
  /** B4: 1 = yalnız reddedilen istekler (sunucuda süzülür). Eski backend yok sayar. */
  reddedilen?: 1;
  /** B3: "islem" = iş eylemi görünümü. Eski backend yok sayar → satır döner. */
  gorunum?: "satir" | "islem";
  /** Kayıt numarası araması (SP-…, CV…, barkod) — sunucuda. */
  q?: string;
  /** Fabrika günü kısayolu — aralığı SUNUCU hesaplar. */
  gun?: SystemLogGun;
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
