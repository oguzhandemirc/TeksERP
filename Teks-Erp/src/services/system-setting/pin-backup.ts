// =============================================================================
// TeksERP - System Setting / pin-backup
// =============================================================================
// PIN kilidi · yedek saati · saklama süreleri · offsite · giriş yöntemleri.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { DEFAULT_AUDIT_ARCHIVE_RETENTION_YEARS, isValidAuditArchiveRetentionYears } from "../helpers/audit-retention.helper";
import { DEFAULT_PRINT_LOG_RETENTION_DAYS, isValidPrintLogRetentionDays } from "../helpers/print-job-retention.helper";
import { DEFAULT_REQUEST_TRACE_RETENTION_DAYS, isValidRequestTraceRetentionDays } from "../helpers/request-trace-retention.helper";
import { asNumber } from "./core";
import { DEFAULT_BACKUP_HOUR, DEFAULT_LOGIN_METHODS, DEFAULT_PIN_LOCKOUT_ATTEMPTS, DEFAULT_PIN_LOCKOUT_ENABLED, DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER, DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN, DEFAULT_PIN_LOCKOUT_PENALTY_SEC, LOGIN_METHODS, MAX_BACKUP_HOUR, MAX_PIN_LOCKOUT_ATTEMPTS, MAX_PIN_LOCKOUT_ESCALATE_AFTER, MAX_PIN_LOCKOUT_LONG_PENALTY_MIN, MAX_PIN_LOCKOUT_PENALTY_SEC, MIN_BACKUP_HOUR, MIN_PIN_LOCKOUT_ATTEMPTS, MIN_PIN_LOCKOUT_ESCALATE_AFTER, MIN_PIN_LOCKOUT_LONG_PENALTY_MIN, MIN_PIN_LOCKOUT_PENALTY_SEC, type LoginMethod, type LoginMethodsConfig } from "./defaults";
import { SETTING_KEYS } from "./keys";


/**
 * Giriş deneme kilidi KAPATILAMAZ (denetim O-04, 2026-10-12): eski kurulumda kalan
 * `false` satırı da yok sayılır — ayardan yalnız eşik ve ceza süreleri değişir.
 * Okuyucu imzası API sözleşmesi için durur; cevap her zaman açıktır.
 */
export async function readPinLockoutEnabled(
  _tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  // Yüzey `pinLockoutEnabled`; `SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED` yalnız `true` yazılır, okunmaz.
  return DEFAULT_PIN_LOCKOUT_ENABLED;
}

/** Kilit tetiklenene kadar izin verilen yanlış deneme (default 5, 1..20). */
export async function readPinLockoutAttempts(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_ATTEMPTS;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_ATTEMPTS) return DEFAULT_PIN_LOCKOUT_ATTEMPTS;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_ATTEMPTS);
}

/**
 * Otomatik gece yedeğinin saati (0-23, yerel saat).
 *
 * Öncelik: SystemSetting (`backup.hour`) → `BACKUP_HOUR` env → 3.
 * Env fallback'i geriye-uyum içindir: ayar UI'dan hiç kaydedilmemiş kurulumlarda
 * ecosystem.config.js'deki değer geçerli kalır. Scheduler bunu HER turda okur,
 * dolayısıyla admin saati değiştirdiğinde süreç yeniden başlatılmaz.
 */
export async function readBackupHour(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BACKUP_HOUR },
    select: { value: true },
  });
  const fromDb = asNumber(setting?.value);
  if (fromDb !== null && Number.isInteger(fromDb) && fromDb >= MIN_BACKUP_HOUR && fromDb <= MAX_BACKUP_HOUR) {
    return fromDb;
  }
  const fromEnv = Number(process.env.BACKUP_HOUR);
  if (Number.isInteger(fromEnv) && fromEnv >= MIN_BACKUP_HOUR && fromEnv <= MAX_BACKUP_HOUR) {
    return fromEnv;
  }
  return DEFAULT_BACKUP_HOUR;
}

/**
 * Audit arşivi saklama süresi (yıl). Kayıt yoksa ya da geçersizse varsayılan 3;
 * 0 açıkça yazılırsa budama yok.
 */
export async function readAuditArchiveRetentionYears(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUDIT_ARCHIVE_RETENTION_YEARS },
    select: { value: true },
  });
  const v = asNumber(setting?.value);
  return isValidAuditArchiveRetentionYears(v) ? v : DEFAULT_AUDIT_ARCHIVE_RETENTION_YEARS;
}

/**
 * Yazdırma geçmişi saklama süresi (gün). Kayıt yoksa ya da geçersizse varsayılan 180;
 * 0 açıkça yazılırsa budama yok.
 */
export async function readPrintLogRetentionDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PRINT_LOG_RETENTION_DAYS },
    select: { value: true },
  });
  const v = asNumber(setting?.value);
  return isValidPrintLogRetentionDays(v) ? v : DEFAULT_PRINT_LOG_RETENTION_DAYS;
}

export const DEFAULT_REPORTS_STATEMENT_TIMEOUT_SEC = 15;
export const MIN_REPORTS_STATEMENT_TIMEOUT_SEC = 5;
export const MAX_REPORTS_STATEMENT_TIMEOUT_SEC = 45;

/**
 * Semantik rapor bloğunun `statement_timeout`u (saniye). Kayıt yoksa ya da 5..45 dışındaysa 15:
 * aralık dışı değer ya tek process'i kilitler ya da her raporu düşürür.
 */
export async function readReportsStatementTimeoutSec(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.REPORTS_STATEMENT_TIMEOUT_SEC },
    select: { value: true },
  });
  const v = asNumber(setting?.value);
  return v !== null && Number.isInteger(v) && v >= MIN_REPORTS_STATEMENT_TIMEOUT_SEC && v <= MAX_REPORTS_STATEMENT_TIMEOUT_SEC
    ? v
    : DEFAULT_REPORTS_STATEMENT_TIMEOUT_SEC;
}

/**
 * İstek başlığı saklama süresi (gün). Kayıt yoksa ya da geçersizse varsayılan 90;
 * 0 açıkça yazılırsa budama yok.
 */
export async function readRequestTraceRetentionDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.REQUEST_TRACE_RETENTION_DAYS },
    select: { value: true },
  });
  const v = asNumber(setting?.value);
  return isValidRequestTraceRetentionDays(v) ? v : DEFAULT_REQUEST_TRACE_RETENTION_DAYS;
}

/**
 * Offsite metin ayarlarının ORTAK okuyucusu: SystemSetting → env → "".
 *
 * ⚠️ ÖNCELİK YAZILI OLMAK ZORUNDA (`backup.hour` emsali). İki kaynaklı bir ayarda
 * öncelik belirsizse "panelde değiştirdim, değişmedi" sınıfı sessiz hata doğar —
 * kullanıcı ayarı yaptığını sanır, sistem env'i okumaya devam eder ve hiçbir
 * yerde uyarı çıkmaz.
 *
 * Boş string ile kaydedilen değer "KAPAT" demektir ve env'e DÜŞMEZ: aksi halde
 * panelden hedefi silmek imkânsız olurdu (silince env geri gelirdi).
 */
async function readOffsiteText(
  key: string,
  envName: string,
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  // Kayıt VARSA (boş olsa bile) o kazanır — bilinçli bir "kapat" kararıdır.
  if (setting && typeof setting.value === "string") return setting.value.trim();
  return (process.env[envName] ?? "").trim();
}

/** Offsite uzak hedef (rclone). Boş = kapalı. */
export async function readOffsiteRemote(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  return readOffsiteText(SETTING_KEYS.BACKUP_OFFSITE_REMOTE, "BACKUP_RCLONE_REMOTE", tx);
}

/** Offsite YEREL ikinci hedef (ağ paylaşımı / ikinci disk). Boş = kapalı. */
export async function readOffsiteDir(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  return readOffsiteText(SETTING_KEYS.BACKUP_OFFSITE_DIR, "BACKUP_OFFSITE_DIR", tx);
}

/** Kısa ceza süresi, SANİYE (default 60, 5..3600). */
export async function readPinLockoutPenaltySec(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_PENALTY_SEC;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_PENALTY_SEC) return DEFAULT_PIN_LOCKOUT_PENALTY_SEC;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_PENALTY_SEC);
}

/** Kaç ceza turundan sonra uzun cezaya geçilir (default 3, 1..20). */
export async function readPinLockoutEscalateAfter(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_ESCALATE_AFTER) return DEFAULT_PIN_LOCKOUT_ESCALATE_AFTER;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_ESCALATE_AFTER);
}

/** Uzun ceza süresi, DAKİKA (default 15, 1..1440). */
export async function readPinLockoutLongPenaltyMin(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_PIN_LOCKOUT_LONG_PENALTY_MIN) return DEFAULT_PIN_LOCKOUT_LONG_PENALTY_MIN;
  return Math.min(Math.floor(parsed), MAX_PIN_LOCKOUT_LONG_PENALTY_MIN);
}

/**
 * Giriş kilidi yapılandırmasının TAMAMI — TEK sorguda.
 *
 * NEDEN: `login-lockout.ts` her PIN/kart giriş denemesinde bu beş ayarı beş ayrı
 * `findUnique` ile okuyordu. Beşi tek `findMany`'ye iner.
 *
 * ⚠️ BU BİR ÖNBELLEK DEĞİL. Yukarıdaki (bkz. featureFlagsCache notu) "per-flag
 * enforcement reader'ları KASITEN cache'siz kalır — middleware tazeliği aynen
 * korunur" kuralı burada da geçerli: bu fonksiyon HER çağrıda canlı DB'yi okur,
 * TTL yok, invalidation yok. Yönetici kilidi sıkılaştırdığında bir sonraki
 * denemede geçerlidir. Sadece round-trip sayısı 5→1 düşer.
 *
 * Desen `getFeatureFlags`'tan alındı (findMany + Map + sentetik findUnique
 * client'ı) — parse/clamp/default mantığı KOPYALANMAZ, tek kaynak yine
 * okuyucuların kendisidir. Fark: burada `key: { in: [...] }` filtresi var, çünkü
 * ayar tablosu büyüdükçe gereksiz satır çekmenin anlamı yok.
 *
 * 🔒 `valueByKey.has(...)` KONTROLÜ LOAD-BEARING — `.get(...) ?? null` YAZMA.
 * `value` sütunu jsonb ve JSON `null` saklanabilir; eksik anahtar için `null`
 * yerine `{ value: null }` döndüren bir shim `readPinLockoutEnabled`'ı bozar:
 * satır YOKKEN doğru cevap DEFAULT (=true, kilit AÇIK) ama `asBoolean(null)`
 * `false` (kilit KAPALI) verir. Canlı DB'de o satır seed'lenmiyor → giriş kilidi
 * her temiz kurulumda SESSİZCE devre dışı kalırdı. Diğer dört okuyucuda ikisi de
 * DEFAULT'a düşer (zararsız); ayrışma yalnız `enabled`'da.
 */
export async function readPinLockoutConfig(tx?: Pick<typeof prisma, "systemSetting">): Promise<{
  enabled: boolean;
  attempts: number;
  penaltySec: number;
  escalateAfter: number;
  longPenaltyMin: number;
}> {
  const client = tx ?? prisma;
  const keys = [
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN,
  ];
  const rows = await client.systemSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const valueByKey = new Map(rows.map((r) => [r.key, r.value] as const));
  const oneShot = {
    systemSetting: {
      findUnique: (args: { where: { key: string } }) =>
        Promise.resolve(
          valueByKey.has(args.where.key) ? { value: valueByKey.get(args.where.key) } : null,
        ),
    },
  } as unknown as Pick<typeof prisma, "systemSetting">;

  return {
    enabled: await readPinLockoutEnabled(oneShot),
    attempts: await readPinLockoutAttempts(oneShot),
    penaltySec: await readPinLockoutPenaltySec(oneShot),
    escalateAfter: await readPinLockoutEscalateAfter(oneShot),
    longPenaltyMin: await readPinLockoutLongPenaltyMin(oneShot),
  };
}

/**
 * Mobil giriş yöntemlerini okur: { enabled, primary }. Backend ENFORCE eder —
 * login-card yalnız "card", login-quick-pin yalnız "pin" etkinken çalışır
 * (kapalıyken ilgili altyapı saldırı yüzeyi açmaz); klasik /auth/login HEP açık.
 * GERİYE-UYUM: yeni key yoksa eski auth.loginMode'dan türetilir
 * ("card" → kart öncelikli + liste yedek; "pin"/yok → yalnız liste).
 */
export async function readLoginMethods(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<LoginMethodsConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_METHODS },
    select: { value: true },
  });
  const v = setting?.value as { enabled?: unknown; primary?: unknown } | null | undefined;
  if (v && typeof v === "object" && Array.isArray(v.enabled)) {
    const enabled = v.enabled.filter((m): m is LoginMethod =>
      LOGIN_METHODS.includes(m as LoginMethod),
    );
    if (enabled.length > 0) {
      const primary =
        typeof v.primary === "string" && enabled.includes(v.primary as LoginMethod)
          ? (v.primary as LoginMethod)
          : enabled[0];
      return { enabled: Array.from(new Set(enabled)), primary };
    }
  }
  // Geriye-uyum: eski tekil mod (Faz 5 ilk hali).
  const legacy = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_MODE },
    select: { value: true },
  });
  if (legacy?.value === "card") return { enabled: ["card", "list"], primary: "card" };
  return DEFAULT_LOGIN_METHODS;
}
