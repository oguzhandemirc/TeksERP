// =============================================================================
// Geri yükleme kopyaları — listeleme, durum uzlaştırma, disk guard'ı
// =============================================================================
// "Yedeği CANLI veritabanına değil YENİ bir veritabanına geri yükle" akışının
// okuma tarafı. Yerine-yazma akışının aksine burada canlı veriye HİÇ dokunulmaz:
// kopya beğenilmezse silinir, hiçbir şey kaybolmaz.
//
// Kalıcı durum için AYRI BİR TABLO YOK — bilinçli. İş kayıtları *değiştirilmek
// üzere olan* veritabanında yaşardı; takastan sonra "az önce yapılan geri
// yüklemenin kaydı" yedeğin içeriğine döner ve KAYBOLURDU. Bunun yerine etkin
// durum üç kaynaktan UZLAŞTIRILIR: `pg_database` (gerçek) + `SystemSetting`
// (hızlandırıcı) + bellekteki iş (canlı faz).
// =============================================================================

import path from "path";
import prisma from "../lib/prisma";
import { readDiskFor, type DiskUsage } from "../lib/disk-metrics";
import { AuditService } from "./audit.service";
import { isBackupRunning, resolveBackupPath, verifyBackupFile } from "./backup.service";
import {
  exceedsIdentifierLimit,
  failedDbName,
  isOldSwapName,
  isRestoreCopyName,
  MAX_IDENTIFIER_BYTES,
  oldDbName,
  parseDbStamp,
  restoreDbName,
} from "./helpers/backup-naming.helper";
import {
  buildSwapCommands,
  type SwapCommands,
} from "./helpers/db-swap-command.helper";
import {
  describePgError,
  liveConn,
  maintenanceDbName,
  probeCapabilities,
  withAdminClient,
  type AdminCapability,
} from "./helpers/pg-admin-client";
import { pgToolArgs, quoteIdent, quoteLiteral, withDatabase } from "./helpers/pg-conn.helper";
import { pgTool, runTool } from "./helpers/pg-tool.helper";
import {
  readDbGuc,
  readLocaleProps,
  verifyCopy,
  type DbLocaleProps,
  type VerificationReport,
} from "./db-copy-verify.service";

// =============================================================================
// Tipler
// =============================================================================

export type CopyPhase =
  | "queued"
  | "creating"
  | "restoring"
  | "verifying"
  | "ready"
  | "failed";

/** Etkin durum — `evaluateCopyState` ile hesaplanır, saklanmaz. */
export type CopyState = CopyPhase | "interrupted" | "unverified";

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

/** `SystemSetting` → `dbRestore.copies` içinde saklanan kayıt. */
export interface CopyRecord {
  sourceBackup: string;
  startedAt: string;
  finishedAt: string | null;
  /** `running` iken süreç yeniden başlarsa uzlaştırma bunu `interrupted` yapar. */
  state: "running" | "ready" | "failed";
  message: string | null;
  verification: unknown | null;
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

export interface DbCopyListing {
  liveDatabase: string | null;
  liveSizeBytes: number | null;
  capabilities: AdminCapability | null;
  capabilityError: string | null;
  copies: DbCopy[];
  /** Takas sonrası kenara çekilmiş eski canlı DB'ler — GERİ DÖNÜŞ NOKTASI. */
  oldDatabases: DbCopy[];
  disk: DiskGuardResult | null;
  job: DbCopyJob | null;
  lastResult: DbCopyJob | null;
  error: string | null;
}

// =============================================================================
// Bellekteki iş durumu (canlı faz) — kalıcı olan SystemSetting'te
// =============================================================================

let currentJob: DbCopyJob | null = null;
let lastJobResult: DbCopyJob | null = null;

export function getCurrentJob(): DbCopyJob | null {
  return currentJob;
}
export function getLastJobResult(): DbCopyJob | null {
  return lastJobResult;
}
export function isCopyJobRunning(): boolean {
  return currentJob !== null;
}
/** @internal — iş servisi (adım 4) tarafından kullanılır. */
export function _setCurrentJob(job: DbCopyJob | null): void {
  if (job === null && currentJob) lastJobResult = currentJob;
  currentJob = job;
}

// =============================================================================
// SAF: etkin durum uzlaştırması
// =============================================================================
// `interrupted` tespiti tek-process invariant'ına dayanır (server.ts): ikinci bir
// process olmadığı için "kayıt koşuyor diyor ama bellekte iş yok" ⇒ süreç yeniden
// başlamış demektir. Yarım bir kopya `pg_database`'de tam bir kopyadan AYIRT
// EDİLEMEZ; ona geçmek felakettir → geçiş sunulmaz.

export function evaluateCopyState(input: {
  record: CopyRecord | undefined;
  jobPhase: CopyPhase | null;
}): CopyState {
  if (input.jobPhase) return input.jobPhase;
  if (!input.record) return "unverified"; // DB var, kaydı yok → doğrulanmamış
  if (input.record.state === "running") return "interrupted";
  return input.record.state; // "ready" | "failed"
}

// =============================================================================
// SAF: disk guard'ı
// =============================================================================
// PGDATA volume'ünü doldurmak CANLI veritabanını durdurur — bu özelliğin
// üretebileceği en kötü sonuç ve tek meşru sert durak.

export function evaluateDiskGuard(input: {
  disk: DiskUsage | null;
  volumeKnown: boolean;
  measuredPath: string;
  liveSizeBytes: number | null;
  copiesTotalBytes: number;
}): DiskGuardResult {
  const warnings: string[] = [];
  const base = {
    measuredPath: input.measuredPath,
    volumeKnown: input.volumeKnown,
    freeBytes: input.disk?.freeBytes ?? null,
    liveSizeBytes: input.liveSizeBytes,
    copiesTotalBytes: input.copiesTotalBytes,
  };

  if (!input.disk || input.liveSizeBytes === null) {
    return {
      ...base,
      ok: false,
      blockReason: "Disk alanı ya da veritabanı boyutu ölçülemedi — kopya oluşturulamaz.",
      warnings,
    };
  }
  if (!input.volumeKnown) {
    warnings.push(
      `Ölçülen birim: ${input.measuredPath}. PostgreSQL veri dizini BAŞKA bir diskteyse ` +
        `bu ölçüm yanıltıcıdır — PGDATA_DIR ortam değişkenini ayarlayın.`,
    );
  }
  if (input.copiesTotalBytes > 0) {
    warnings.push(
      `Mevcut kopyalar ${Math.round(input.copiesTotalBytes / 1024 / 1024)} MB yer tutuyor — ` +
        `kullanılmayanları silerek yer açabilirsiniz.`,
    );
  }

  const need = input.liveSizeBytes * 1.2;
  if (input.disk.freeBytes < need) {
    return {
      ...base,
      ok: false,
      blockReason:
        `Yetersiz disk alanı: veritabanı ${Math.round(input.liveSizeBytes / 1024 / 1024)} MB, ` +
        `boş alan ${Math.round(input.disk.freeBytes / 1024 / 1024)} MB. En az %20 pay gerekir — ` +
        `diski doldurmak CANLI veritabanını durdurur.`,
      warnings,
    };
  }
  if (input.disk.freeBytes < input.liveSizeBytes * 2) {
    warnings.push(
      "Boş alan veritabanı boyutunun iki katından az — index oluşturma ve WAL için pay dar.",
    );
  }
  return { ...base, ok: true, blockReason: null, warnings };
}

// =============================================================================
// PGDATA volume'ünü bulma
// =============================================================================
// Sıra: PGDATA_DIR env → canlının tablespace dizini → SHOW data_directory →
// process.cwd() (volumeKnown=false).

async function resolvePgDataPath(
  client: import("pg").Client,
  tablespaceDir: string | null,
): Promise<{ path: string; known: boolean }> {
  const fromEnv = process.env.PGDATA_DIR;
  if (fromEnv) return { path: fromEnv, known: true };
  if (tablespaceDir) return { path: tablespaceDir, known: true };
  try {
    const r = await client.query<{ setting: string }>(
      `SELECT setting FROM pg_settings WHERE name = 'data_directory'`,
    );
    const dir = r.rows[0]?.setting;
    if (dir) return { path: dir, known: true };
  } catch {
    /* yetki yok — aşağıya düş */
  }
  return { path: process.cwd(), known: false };
}

// =============================================================================
// SystemSetting kaydı
// =============================================================================
// Makine tetikli yazım → doğrudan `prisma.systemSetting.upsert`
// (`jobs/backup-scheduler.ts` kalıbı). `systemSettingService.set()` KULLANILMAZ:
// `userId` ister ve her yazımda audit satırı üretir.

export const COPIES_SETTING_KEY = "dbRestore.copies";

interface CopiesBlob {
  version: 1;
  copies: Record<string, CopyRecord>;
}

export async function readCopyRecords(): Promise<Record<string, CopyRecord>> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: COPIES_SETTING_KEY } });
    const blob = row?.value as unknown as CopiesBlob | null;
    if (!blob || typeof blob !== "object" || !blob.copies) return {};
    return blob.copies;
  } catch {
    return {};
  }
}

/** Kaydı yaz ve `pg_database`'de artık olmayanları buda. */
export async function writeCopyRecords(
  copies: Record<string, CopyRecord>,
  existingNames: Set<string>,
): Promise<void> {
  const pruned: Record<string, CopyRecord> = {};
  for (const [name, rec] of Object.entries(copies)) {
    if (existingNames.has(name)) pruned[name] = rec;
  }
  const blob: CopiesBlob = { version: 1, copies: pruned };
  await prisma.systemSetting.upsert({
    where: { key: COPIES_SETTING_KEY },
    create: {
      key: COPIES_SETTING_KEY,
      value: blob as never,
      description: "Geri yükleme kopyalarının durum kayıtları (makine tarafından yazılır)",
    },
    update: { value: blob as never },
  });
}

// =============================================================================
// SAF: CREATE DATABASE DDL'i
// =============================================================================
// Kopyanın yerel ayarları canlıyla BİREBİR aynı olmalı; farklıysa takastan sonra
// `ILIKE` / `mode:'insensitive'` (kodda 34 yer) sessizce farklı davranır (Y-2).
//
// `TEMPLATE template0` ŞART — üç sebep:
//  (a) `template1` kullanıcı nesnesi içerebilir → restore çakışır;
//  (b) PostgreSQL, template'ten FARKLI encoding/locale ile DB yaratmayı REDDEDER;
//      locale'i açıkça vermenin tek yolu template0'dır;
//  (c) `template0.datallowconn = false` → "being accessed by other users" imkânsız.
// Canlıyı şablon almak (`TEMPLATE "<canlı>"`) cazip ama backend bağlı olduğu için
// HER ZAMAN patlar.

export function buildCreateDatabaseSql(input: {
  copyName: string;
  props: DbLocaleProps;
  tablespace: string | null;
}): string {
  const { copyName, props } = input;
  const parts: string[] = [
    `CREATE DATABASE ${quoteIdent(copyName)}`,
    `  WITH TEMPLATE template0`,
    `       OWNER ${quoteIdent(props.owner)}`,
    `       ENCODING ${quoteLiteral(props.encoding)}`,
    `       LC_COLLATE ${quoteLiteral(props.datcollate)}`,
    `       LC_CTYPE ${quoteLiteral(props.datctype)}`,
  ];
  // datlocprovider: 'c'=libc, 'i'=icu, 'b'=builtin (PG17+)
  if (props.datlocprovider === "i") {
    parts.push(`       LOCALE_PROVIDER 'icu'`);
    if (props.datlocale) parts.push(`       ICU_LOCALE ${quoteLiteral(props.datlocale)}`);
    if (props.daticurules) parts.push(`       ICU_RULES ${quoteLiteral(props.daticurules)}`);
  } else if (props.datlocprovider === "b") {
    parts.push(`       LOCALE_PROVIDER 'builtin'`);
    if (props.datlocale) parts.push(`       BUILTIN_LOCALE ${quoteLiteral(props.datlocale)}`);
  } else {
    parts.push(`       LOCALE_PROVIDER 'libc'`);
  }
  if (input.tablespace && input.tablespace !== "pg_default") {
    parts.push(`       TABLESPACE ${quoteIdent(input.tablespace)}`);
  }
  return parts.join("\n");
}

// =============================================================================
// Kopya oluşturma işi
// =============================================================================

export interface StartCopyResult {
  started: boolean;
  message: string;
  copyName?: string;
}

function setPhase(phase: CopyPhase, message?: string): void {
  if (!currentJob) return;
  currentJob = {
    ...currentJob,
    phase,
    phaseStartedAt: new Date().toISOString(),
    ...(message !== undefined ? { message } : {}),
  };
}

/**
 * Kopya işini BAŞLATIR ve hemen döner (202 sözleşmesi). İş arka planda ilerler;
 * istemci `GET /api/admin/db-copies` yanıtındaki `job` alanını yoklar.
 */
export async function startCopyJob(
  backupName: string,
  /** @internal test kancası — üretim çağrısında verilmez (tek çağıran db-copy.routes). */
  deps: { list?: typeof listDbCopies; run?: typeof runCopyJob } = {},
): Promise<StartCopyResult> {
  if (currentJob) {
    return { started: false, message: "Zaten bir kopya işlemi sürüyor." };
  }
  // pg_dump + pg_restore aynı anda diski boğar. TERS YÖNDE guard EKLENMEZ: gece
  // yedeği bir kopya işi yüzünden reddedilirse damga işten önce yazıldığı için
  // (backup-scheduler) o gece SESSİZCE kaybolur.
  if (isBackupRunning()) {
    return { started: false, message: "Şu anda yedek alınıyor — bitmesini bekleyin." };
  }

  const abs = resolveBackupPath(backupName);
  if (!abs) return { started: false, message: "Yedek dosyası bulunamadı." };

  const conn = liveConn();
  if (!conn) return { started: false, message: "DATABASE_URL çözümlenemedi." };

  const copyName = restoreDbName(conn.database, new Date());
  if (exceedsIdentifierLimit(copyName)) {
    return {
      started: false,
      message:
        `Üretilen veritabanı adı ${MAX_IDENTIFIER_BYTES} baytı aşıyor (${copyName}). ` +
        `PostgreSQL adı sessizce keser ve yanlış veritabanı hedeflenebilir.`,
    };
  }

  // ATOMİK CLAIM — buraya kadar hiç await yok (üstteki kontrollerin tümü senkron),
  // tek thread'de iki istek bu satırı aynı anda geçemez. Async doğrulamalar claim'den
  // SONRA koşar ve başarısızlıkta claim geri bırakılır. Claim await'lerin arkasındayken
  // `await listDbCopies()` penceresinde ikinci istek de currentJob'u null görüp paralel
  // ikinci pg_restore başlatabiliyordu (2026-07-31 veri bütünlüğü denetimi A2).
  const now = new Date().toISOString();
  currentJob = {
    copyName,
    sourceBackup: backupName,
    phase: "queued",
    startedAt: now,
    phaseStartedAt: now,
    finishedAt: null,
    durationMs: null,
    message: null,
    failedPhase: null,
  };

  let listing: Awaited<ReturnType<typeof listDbCopies>>;
  try {
    listing = await (deps.list ?? listDbCopies)();
  } catch (err) {
    currentJob = null;
    throw err;
  }
  if (listing.capabilityError) {
    currentJob = null;
    return { started: false, message: listing.capabilityError };
  }
  if (listing.capabilities && !listing.capabilities.enabled) {
    currentJob = null;
    return { started: false, message: listing.capabilities.reason ?? "Yetki yok." };
  }
  if (listing.disk && !listing.disk.ok) {
    currentJob = null;
    return { started: false, message: listing.disk.blockReason ?? "Disk alanı yetersiz." };
  }

  void (deps.run ?? runCopyJob)(abs, backupName, copyName, conn.database);
  return { started: true, message: `Kopya oluşturuluyor: ${copyName}`, copyName };
}

async function finishJob(ok: boolean, message: string, failedPhase: CopyPhase | null): Promise<void> {
  if (!currentJob) return;
  const startedMs = new Date(currentJob.startedAt).getTime();
  const done: DbCopyJob = {
    ...currentJob,
    phase: ok ? "ready" : "failed",
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    message,
    failedPhase,
  };
  lastJobResult = done;
  currentJob = null;

  void AuditService.logEvent({
    category: "SYSTEM",
    action: ok ? "DB_COPY_COMPLETED" : "DB_COPY_FAILED",
    payload: { copyName: done.copyName, sourceBackup: done.sourceBackup, message, failedPhase },
  });

  await persistRecord(done.copyName, {
    sourceBackup: done.sourceBackup,
    startedAt: done.startedAt,
    finishedAt: done.finishedAt,
    state: ok ? "ready" : "failed",
    message,
    verification: lastVerification,
  });
}

let lastVerification: unknown | null = null;

async function persistRecord(name: string, rec: CopyRecord): Promise<void> {
  try {
    const records = await readCopyRecords();
    records[name] = rec;
    const existing = await listExistingDbNames();
    await writeCopyRecords(records, existing);
  } catch (err) {
    console.error("[db-copy] kayıt yazılamadı:", err);
  }
}

async function listExistingDbNames(): Promise<Set<string>> {
  try {
    return await withAdminClient(async (c) => {
      const r = await c.query<{ datname: string }>(`SELECT datname FROM pg_database`);
      return new Set(r.rows.map((x) => x.datname));
    });
  } catch {
    // Budayamadıysak kaybetmemek için hepsini "var" say.
    return new Set(Object.keys(await readCopyRecords()));
  }
}

/** Hata/iptal sonrası KENDİ yarattığımız kopyayı temizle. */
async function dropCopyQuietly(copyName: string): Promise<string | null> {
  try {
    await withAdminClient(
      async (c) => c.query(`DROP DATABASE IF EXISTS ${quoteIdent(copyName)} WITH (FORCE)`),
      { statementTimeoutMs: 0 },
    );
    return null;
  } catch (err) {
    return describePgError(err);
  }
}

async function runCopyJob(
  absDump: string,
  backupName: string,
  copyName: string,
  liveDb: string,
): Promise<void> {
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "DB_COPY_STARTED",
    payload: { copyName, sourceBackup: backupName },
  });
  await persistRecord(copyName, {
    sourceBackup: backupName,
    startedAt: currentJob?.startedAt ?? new Date().toISOString(),
    finishedAt: null,
    state: "running",
    message: null,
    verification: null,
  });
  lastVerification = null;

  // --- 0) Dump dosyası sağlam mı? Bozuksa veritabanı bile yaratmayalım.
  const verdict = await verifyBackupFile(absDump);
  if (verdict === "corrupt") {
    await finishJob(false, "Yedek dosyası bozuk (pg_restore --list başarısız).", "creating");
    return;
  }

  const conn = liveConn();
  if (!conn) {
    await finishJob(false, "DATABASE_URL çözümlenemedi.", "creating");
    return;
  }

  // --- 1) CREATE DATABASE (canlının yerel ayarlarıyla birebir)
  setPhase("creating");
  let liveGuc: string[] = [];
  try {
    await withAdminClient(
      async (client) => {
        const v = await client.query<{ n: string }>(
          `SELECT current_setting('server_version_num') AS n`,
        );
        const vnum = Number(v.rows[0]?.n ?? 0);
        const props = await readLocaleProps(client, liveDb, vnum);
        if (!props) throw new Error(`Canlı veritabanının (${liveDb}) özellikleri okunamadı.`);
        const ts = await client.query<{ spcname: string }>(
          `SELECT t.spcname FROM pg_database d JOIN pg_tablespace t ON t.oid = d.dattablespace
           WHERE d.datname = $1`,
          [liveDb],
        );
        liveGuc = await readDbGuc(client, liveDb);
        await client.query(
          buildCreateDatabaseSql({
            copyName,
            props,
            tablespace: ts.rows[0]?.spcname ?? null,
          }),
        );
      },
      { statementTimeoutMs: 0 },
    );
  } catch (err) {
    await finishJob(false, `Veritabanı oluşturulamadı: ${describePgError(err)}`, "creating");
    return;
  }

  // --- 2) pg_restore
  // `--clean`/`--if-exists` YOK (hedef boş) · `--no-owner` YOK (sahiplik canlıyla
  // birebir kalmalı; dump `ALTER SCHEMA public OWNER TO …` içeriyor) ·
  // `--exit-on-error` VAR: varsayılan "hataları say ve devam et" yarım bir
  // veritabanını başarı gibi gösterirdi.
  setPhase("restoring");
  const jobs = Number(process.env.PG_RESTORE_JOBS) > 1 ? Number(process.env.PG_RESTORE_JOBS) : 1;
  const restore = await runTool(
    pgTool("pg_restore"),
    [
      ...pgToolArgs(withDatabase(conn, copyName)),
      "--exit-on-error",
      ...(jobs > 1 ? ["-j", String(jobs)] : []),
      absDump,
    ],
    conn.password,
  );
  if (restore.spawnError || restore.code !== 0) {
    const dropErr = await dropCopyQuietly(copyName);
    await finishJob(
      false,
      `pg_restore başarısız (kod ${restore.code}): ${restore.stderr.trim().slice(0, 400)}` +
        (dropErr ? ` — kopya SİLİNEMEDİ (${dropErr}), elle silin.` : " — kopya silindi."),
      "restoring",
    );
    return;
  }

  // --- 3) GUC replay
  // `pg_db_role_setting.setdatabase` bir OID kolonu → bu ayarlar takas sırasındaki
  // rename ile KOPYAYA GEÇMEZ. Replay edilmezse takastan sonra statement_timeout
  // koruması SESSİZCE kaybolur (CLAUDE.md'nin aktif dediği güvence).
  if (liveGuc.length > 0) {
    try {
      await withAdminClient(
        async (client) => {
          for (const kv of liveGuc) {
            const eq = kv.indexOf("=");
            if (eq <= 0) continue;
            const key = kv.slice(0, eq);
            const value = kv.slice(eq + 1);
            if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) continue; // GUC adı parametrelenemez
            await client.query(
              `ALTER DATABASE ${quoteIdent(copyName)} SET ${key} = ${quoteLiteral(value)}`,
            );
          }
        },
        { statementTimeoutMs: 0 },
      );
    } catch (err) {
      console.error("[db-copy] GUC replay başarısız:", err);
      // Bloklamıyoruz — doğrulama bunu `fail` olarak zaten yakalayacak.
    }
  }

  // --- 4) Doğrulama
  setPhase("verifying");
  const report = await verifyCopy(copyName, { restoreStderr: restore.stderr });
  lastVerification = report;
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "DB_COPY_VERIFIED",
    payload: { copyName, ok: report.ok, needsMigrateDeploy: report.needsMigrateDeploy },
  });

  await finishJob(
    report.ok,
    report.ok
      ? `Kopya hazır ve doğrulandı: ${copyName}`
      : `Kopya oluştu ama DOĞRULAMA BAŞARISIZ — geçiş yapmayın. ` +
        report.checks.filter((c) => c.status === "fail").map((c) => c.label).join(", "),
    report.ok ? null : "verifying",
  );
}

// =============================================================================
// Silme — canlı veritabanını ASLA silmeme guard'ları
// =============================================================================
// ALLOWLIST kullanılır ("canlıya eşit değilse sil" gibi bir BLOCKLIST asla):
// ad tam olarak `<canlı>_restore_<geçerli damga>` olmalı. Silinecek ad ayrıca
// TAZE `pg_database` sorgusundan alınır — istemciden gelen string'e güvenilmez.

export interface DropCopyResult {
  ok: boolean;
  message: string;
  /** Açık bağlantı yüzünden silinemediyse: kim bağlı. */
  blockedBy?: Array<{ pid: number; user: string; application: string }>;
}

export async function dropCopy(name: string, force: boolean): Promise<DropCopyResult> {
  const conn = liveConn();
  if (!conn) return { ok: false, message: "DATABASE_URL çözümlenemedi." };
  const live = conn.database;

  // 1) Allowlist — damga şartı dahil.
  if (!isRestoreCopyName(live, name)) {
    return {
      ok: false,
      message: `"${name}" bir geri yükleme kopyası değil — silinemez. Yalnız ${live}_restore_<damga> silinebilir.`,
    };
  }
  // 2) İkinci savunma katmanı: canlıya eşit olamaz (allowlist zaten engeller).
  if (name === live) return { ok: false, message: "Canlı veritabanı silinemez." };
  // 3) Koşan işin kopyası silinemez.
  if (currentJob?.copyName === name) {
    return { ok: false, message: "Bu kopya şu anda oluşturuluyor — bitmesini bekleyin." };
  }

  try {
    return await withAdminClient(
      async (client) => {
        // 4) Adı TAZE pg_database'den al — istemci string'iyle interpolate etme.
        const exists = await client.query<{ datname: string }>(
          `SELECT datname FROM pg_database WHERE datname = $1`,
          [name],
        );
        const actual = exists.rows[0]?.datname;
        if (!actual) return { ok: false, message: "Veritabanı bulunamadı." };
        if (!isRestoreCopyName(live, actual)) {
          return { ok: false, message: "Ad doğrulaması başarısız — silinmedi." };
        }

        if (!force) {
          const conns = await client.query<{ pid: number; usename: string; app: string }>(
            `SELECT pid, usename, application_name AS app FROM pg_stat_activity
             WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [actual],
          );
          if (conns.rows.length > 0) {
            return {
              ok: false,
              message: `Kopyaya ${conns.rows.length} açık bağlantı var — kapatın ya da zorla silin.`,
              blockedBy: conns.rows.map((r) => ({
                pid: r.pid, user: r.usename, application: r.app,
              })),
            };
          }
        }

        await client.query(
          `DROP DATABASE ${quoteIdent(actual)}${force ? " WITH (FORCE)" : ""}`,
        );
        const records = await readCopyRecords();
        delete records[actual];
        await writeCopyRecords(records, await listExistingDbNames());
        void AuditService.logEvent({
          category: "SYSTEM",
          action: "DB_COPY_DROPPED",
          payload: { copyName: actual, force },
        });
        return { ok: true, message: `${actual} silindi.` };
      },
      { statementTimeoutMs: 0 },
    );
  } catch (err) {
    return { ok: false, message: describePgError(err) };
  }
}

// =============================================================================
// Takas komutu
// =============================================================================

export async function getSwapCommands(copyName: string): Promise<
  { ok: true; commands: SwapCommands; needsMigrateDeploy: boolean } | { ok: false; message: string }
> {
  const conn = liveConn();
  if (!conn) return { ok: false, message: "DATABASE_URL çözümlenemedi." };
  const live = conn.database;
  if (!isRestoreCopyName(live, copyName)) {
    return { ok: false, message: "Geçersiz kopya adı." };
  }

  // Etkin durum `ready` DEĞİLSE komut ÜRETİLMEZ — `restoreCommand`'ın "önizleme
  // yoksa null dön" sözleşmesinin aynısı. Yarım/doğrulanmamış bir kopyaya geçiş
  // felakettir.
  const listing = await listDbCopies();
  const copy = listing.copies.find((c) => c.name === copyName);
  if (!copy) return { ok: false, message: "Kopya bulunamadı." };
  if (copy.state !== "ready") {
    return {
      ok: false,
      message:
        `Kopyanın durumu "${copy.state}" — yalnız doğrulanmış (ready) kopyaya geçiş yapılabilir. ` +
        (copy.state === "interrupted"
          ? "Bu kopya yarıda kalmış; silip yeniden oluşturun."
          : copy.state === "unverified"
            ? "Önce 'Doğrula' ile kontrol edin."
            : ""),
    };
  }

  const records = await readCopyRecords();
  const verification = records[copyName]?.verification as VerificationReport | null | undefined;
  const now = new Date();
  return {
    ok: true,
    needsMigrateDeploy: verification?.needsMigrateDeploy ?? true,
    commands: buildSwapCommands({
      liveDatabase: live,
      copyDatabase: copyName,
      oldDatabase: oldDbName(live, now),
      failedDatabase: failedDbName(live, now),
      psqlPath: pgTool("psql"),
      maintenanceDb: maintenanceDbName(),
      host: conn.host,
      port: conn.port,
      user: conn.user,
      pm2AppName: process.env.name || "teks-erp-backend",
      backendCwd: process.cwd(),
      // Doğrulama okunamadıysa MUHAFAZAKÂR davran: deploy adımını yine de koy
      // (idempotent; atlanması P2022 ile sessiz audit kaybına yol açar).
      needsMigrateDeploy: verification?.needsMigrateDeploy ?? true,
    }),
  };
}

/** Mevcut bir kopyayı yeniden doğrular (idempotent). */
export async function reverifyCopy(copyName: string): Promise<VerificationReport> {
  const report = await verifyCopy(copyName);
  const records = await readCopyRecords();
  const prev = records[copyName];
  records[copyName] = {
    sourceBackup: prev?.sourceBackup ?? "(bilinmiyor)",
    startedAt: prev?.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    state: report.ok ? "ready" : "failed",
    message: report.ok ? "Yeniden doğrulandı." : "Yeniden doğrulama başarısız.",
    verification: report,
  };
  await writeCopyRecords(records, await listExistingDbNames());
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "DB_COPY_VERIFIED",
    payload: { copyName, ok: report.ok, reverify: true },
  });
  return report;
}

// =============================================================================
// Ana okuma
// =============================================================================

interface RawDbRow {
  datname: string;
  size_bytes: string;
  open_conns: string;
}

export async function listDbCopies(): Promise<DbCopyListing> {
  const conn = liveConn();
  const empty: DbCopyListing = {
    liveDatabase: conn?.database ?? null,
    liveSizeBytes: null,
    capabilities: null,
    capabilityError: null,
    copies: [],
    oldDatabases: [],
    disk: null,
    job: currentJob,
    lastResult: lastJobResult,
    error: null,
  };
  if (!conn) return { ...empty, error: "DATABASE_URL çözümlenemedi." };

  const caps = await probeCapabilities();
  if ("error" in caps) return { ...empty, capabilityError: caps.error };

  try {
    return await withAdminClient(async (client) => {
      const live = conn.database;

      // Cluster genelindeki tüm DB'ler + boyut + açık bağlantı sayısı (tek sorgu).
      const dbs = await client.query<RawDbRow>(
        `SELECT d.datname,
                pg_database_size(d.datname)::text AS size_bytes,
                (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname)::text AS open_conns
         FROM pg_database d
         WHERE d.datistemplate = false`,
      );

      // Canlının tablespace dizini — disk guard'ının hangi birimi ölçeceğini belirler.
      const tsRow = await client.query<{ dir: string | null }>(
        `SELECT NULLIF(pg_tablespace_location(t.oid), '') AS dir
         FROM pg_database d JOIN pg_tablespace t ON t.oid = d.dattablespace
         WHERE d.datname = $1`,
        [live],
      );
      const tablespaceDir = tsRow.rows[0]?.dir ?? null;

      const byName = new Map(dbs.rows.map((r) => [r.datname, r]));
      const liveSize = byName.has(live) ? Number(byName.get(live)!.size_bytes) : null;

      const records = await readCopyRecords();
      const toCopy = (r: RawDbRow): DbCopy => {
        const rec = records[r.datname];
        return {
          name: r.datname,
          createdAt: parseDbStamp(r.datname)?.toISOString() ?? null,
          sizeBytes: Number(r.size_bytes),
          state: evaluateCopyState({
            record: rec,
            jobPhase: currentJob?.copyName === r.datname ? currentJob.phase : null,
          }),
          sourceBackup: rec?.sourceBackup ?? null,
          openConnections: Number(r.open_conns),
          message: rec?.message ?? null,
        };
      };

      const copies = dbs.rows
        .filter((r) => isRestoreCopyName(live, r.datname))
        .map(toCopy)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      const oldDatabases = dbs.rows
        .filter((r) => isOldSwapName(live, r.datname))
        .map(toCopy)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

      const pgdata = await resolvePgDataPath(client, tablespaceDir);
      const disk = evaluateDiskGuard({
        disk: readDiskFor(pgdata.path),
        volumeKnown: pgdata.known,
        measuredPath: path.resolve(pgdata.path),
        liveSizeBytes: liveSize,
        copiesTotalBytes: copies.reduce((a, c) => a + (c.sizeBytes ?? 0), 0),
      });

      return {
        liveDatabase: live,
        liveSizeBytes: liveSize,
        capabilities: caps,
        capabilityError: null,
        copies,
        oldDatabases,
        disk,
        job: currentJob,
        lastResult: lastJobResult,
        error: null,
      };
    });
  } catch (err) {
    return { ...empty, capabilities: caps, error: describePgError(err) };
  }
}
