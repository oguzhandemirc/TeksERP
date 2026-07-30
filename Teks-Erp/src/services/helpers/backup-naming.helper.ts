// =============================================================================
// Yedek dosyası adlandırma + kesim (cutoff) anı çözümleme — SAF
// =============================================================================
// Bilinçli olarak env/fs/prisma bağımlılığı YOK: `backup.service.ts` BACKUP_DIR'i
// modül-yükleme anında `const`'a alır ve bu yüzden testte dinamik import gerekir.
// Cutoff mantığı bu tasarımın en ince parçası; saf tutulunca statik import'la,
// veritabanı ve pg_dump olmadan test edilebiliyor.
//
// Üç dosya ön eki, üç farklı yaşam döngüsü:
//   tekserp_      → otomatik/manuel yedek. 14'lük ROTASYONA GİRER (silinebilir).
//   premigrate_   → migration öncesi geri dönüş noktası. Rotasyon DIŞI.
//   pre-restore_  → geri yükleme öncesi güvenlik yedeği. Rotasyon DIŞI.
// Rotasyon (backup.service.ts) yalnız `tekserp_` ile başlayanlara dokunur; diğer
// iki ön ek bu sayede otomatik silinmez. Bu, geri yükleme güvenlik ağının
// dayandığı invariant'tır — değiştirilirse güvenlik yedeği bir gün yok olur.
// =============================================================================

export const NIGHTLY_PREFIX = "tekserp_";
export const PREMIGRATE_PREFIX = "premigrate_";
export const PRE_RESTORE_PREFIX = "pre-restore_";

/** Dosya adı damgası: `YYYYAAGG_SSDDSS` — SUNUCUNUN YEREL saatiyle. */
export function stamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/** Geri yükleme öncesi güvenlik yedeğinin adı. Rotasyon DIŞI ön ek kullanır. */
export function safetyBackupName(now: Date): string {
  return `${PRE_RESTORE_PREFIX}${stamp(now)}.dump`;
}

// Sona çapalı: üç ön eki de yakalar (`premigrate_1.5.0_...` gibi araya sürüm
// giren biçim dahil), `....dump.bak` gibi kuyruklu adları REDDEDER.
const STAMP_RE = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.dump$/i;
/** Veritabanı adları için aynı damga, `.dump` uzantısı OLMADAN (sona çapalı). */
const DB_STAMP_RE = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;

/** Akıl sağlığı alt sınırı — bundan eski damga bozuk/uydurma sayılır. */
const MIN_YEAR = 2020;

/**
 * Damga alanlarından Date kurar; geçersizse `null`.
 *
 * Dosya adı ve veritabanı adı parser'ları BUNU çağırır — guard'ı kopyalarsak biri
 * gün gelip birini düzeltir, diğerini unutur.
 *
 * İki tuzak, ikisi de load-bearing:
 * 1. **YEREL kurucu şart.** `stamp()` yerel getter'larla üretiyor; UTC ile geri
 *    inşa Europe/Istanbul'da 3 saat kaydırır.
 * 2. **Rollover reddi şart.** `new Date(2026, 1, 30)` hata vermez, sessizce
 *    2 Mart'a döner → uydurma bir tarih geçerli sayılırdı.
 */
function rebuildStamp(
  y: number, mo: number, d: number, hh: number, mm: number, ss: number,
): Date | null {
  const dt = new Date(y, mo - 1, d, hh, mm, ss, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d ||
    dt.getHours() !== hh ||
    dt.getMinutes() !== mm ||
    dt.getSeconds() !== ss
  ) {
    return null;
  }
  if (y < MIN_YEAR) return null;
  // Gelecek tarihli ad: saat kayması payı bırak, ötesi bozuk say.
  if (dt.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return dt;
}

/**
 * Dosya adındaki damgayı Date'e çevirir; çözülemezse `null`.
 *
 * İki tuzak, ikisi de load-bearing:
 *
 * 1. **YEREL kurucu şart.** `stamp()` yerel getter'larla üretiyor; UTC ile geri
 *    inşa edilirse Europe/Istanbul'da 3 saat kayar ve cutoff yanlış olur.
 * 2. **Rollover reddi şart.** `new Date(2026, 1, 30)` hata vermez, sessizce
 *    2 Mart'a döner. Böyle bir ad geçerli sayılırsa uydurma bir cutoff üretilir.
 *    Bu yüzden inşa sonrası alanlar geri okunup girdiyle karşılaştırılır.
 */
export function parseBackupStamp(name: string): Date | null {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, hh, mm, ss] = m.slice(1, 7).map(Number) as [
    number, number, number, number, number, number,
  ];
  return rebuildStamp(y, mo, d, hh, mm, ss);
}

export interface BackupCutoff {
  /** Bu andan SONRA oluşan kayıtlar geri yüklemede kaybolur. */
  at: Date;
  /** Kesim anı nereden çözüldü — UI bunu göstermeli (aşağıdaki gerekçe). */
  source: "name" | "mtime";
}

/**
 * Yedeğin kesim anını çözer: `min(ad damgası, mtime)`.
 *
 * **Neden ad damgası tercih edilir:** `stamp()` `pg_dump` spawn edilmeden ÖNCE
 * üretilir, yani dump'ın BAŞLANGICIDIR. `pg_dump` snapshot'ını da işlemin başında
 * alır → yedeğin içeriği tam olarak o ana karşılık gelir. mtime ise dump'ın BİTİŞ
 * zamanıdır; tek başına kullanılırsa dump süresince (büyük DB'de dakikalar) oluşan
 * kayıtlar "kaybolmayacak" sayılır — halbuki dump'ta yoklar. Sessiz eksik rapor.
 *
 * **Neden yine de `min`:** dosya elle geriye `touch`lanmış ya da arşivden mtime
 * korunarak dönmüşse ad, mtime'dan yeni olabilir. `min` her iki sapmada da
 * muhafazakâr (daha erken = daha çok kayıp gösterir) tarafa düşer.
 *
 * `source` çağırana taşınır: mtime'a düşüldüyse kullanıcıya "dosya adı
 * çözülemedi, dump süresi kadar sapma olabilir" denmeli. Kesim anını kaynağı
 * olmadan göstermek yanlış güven verir.
 */
export function resolveBackupCutoff(name: string, mtimeMs: number): BackupCutoff {
  const fromName = parseBackupStamp(name);
  if (!fromName) return { at: new Date(mtimeMs), source: "mtime" };
  return fromName.getTime() <= mtimeMs
    ? { at: fromName, source: "name" }
    : { at: new Date(mtimeMs), source: "mtime" };
}

// =============================================================================
// Veritabanı adları — "kopyaya geri yükleme" akışı
// =============================================================================
// Aynı TEK KAYNAK ilkesi: ön ek→anlam eşlemesi burada yaşar. Silme guard'ı bu
// dosyadaki `isRestoreCopyName` ALLOWLIST'ine dayanır — "canlıya eşit değilse sil"
// gibi bir blocklist ASLA kullanılmaz.
//
//   <canlı>_restore_<damga>  → doğrulanmak üzere yaratılan kopya (silinebilir)
//   <canlı>_old_<damga>      → takastan sonra kenara çekilen ESKİ canlı (GERİ DÖNÜŞ
//                              NOKTASI — otomatik silinmez, DELETE ucu bile yok)
//   <canlı>_failed_<damga>   → geri alma sırasında kenara çekilen başarısız kopya

export const RESTORE_DB_INFIX = "_restore_";
export const OLD_DB_INFIX = "_old_";
export const FAILED_DB_INFIX = "_failed_";

/**
 * PostgreSQL identifier üst sınırı (NAMEDATALEN-1). Aşan adı PG **sessizce keser**
 * → iki kopya aynı ada düşebilir ya da rename yanlış veritabanını hedefleyebilir.
 * Bu yüzden üretilen ad sınırı aşarsa iş BAŞLAMADAN reddedilir.
 */
export const MAX_IDENTIFIER_BYTES = 63;

export function restoreDbName(live: string, now: Date): string {
  return `${live}${RESTORE_DB_INFIX}${stamp(now)}`;
}
export function oldDbName(live: string, now: Date): string {
  return `${live}${OLD_DB_INFIX}${stamp(now)}`;
}
export function failedDbName(live: string, now: Date): string {
  return `${live}${FAILED_DB_INFIX}${stamp(now)}`;
}

/** Ad PostgreSQL'in sessizce keseceği uzunlukta mı? (UTF-8 bayt cinsinden) */
export function exceedsIdentifierLimit(name: string): boolean {
  return Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER_BYTES;
}

function matchesInfix(live: string, name: string, infix: string): boolean {
  const prefix = `${live}${infix}`;
  if (!name.startsWith(prefix)) return false;
  // Kuyruk GEÇERLİ bir damga olmalı. Yalnız ön eke bakmak yetmez: `TeksErpDb` canlı
  // iken `TeksErpDbX_restore_...` ön eki taşımaz ama `TeksErpDb_restore_elle` taşır —
  // damga şartı olmadan elle yaratılmış bir veritabanı silinebilir hâle gelirdi.
  return parseDbStamp(name) !== null && name.length === prefix.length + "YYYYAAGG_SSDDSS".length;
}

/** Silme allowlist'i: yalnız BU canlı veritabanının damgalı restore kopyası. */
export function isRestoreCopyName(live: string, name: string): boolean {
  return matchesInfix(live, name, RESTORE_DB_INFIX);
}
/** Takas sonrası kenara çekilmiş eski canlı — geri dönüş noktası. */
export function isOldSwapName(live: string, name: string): boolean {
  return matchesInfix(live, name, OLD_DB_INFIX);
}

/** Veritabanı adının sonundaki damga (`.dump` uzantısı YOK). */
export function parseDbStamp(name: string): Date | null {
  const m = DB_STAMP_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, hh, mm, ss] = m.slice(1, 7).map(Number) as [
    number, number, number, number, number, number,
  ];
  return rebuildStamp(y, mo, d, hh, mm, ss);
}

/** Dosya adından yedek türü — panelde rozet olarak gösterilir. */
export type BackupKind = "nightly" | "premigrate" | "pre-restore" | "other";

export function backupKind(name: string): BackupKind {
  if (name.startsWith(NIGHTLY_PREFIX)) return "nightly";
  if (name.startsWith(PREMIGRATE_PREFIX)) return "premigrate";
  if (name.startsWith(PRE_RESTORE_PREFIX)) return "pre-restore";
  return "other";
}
