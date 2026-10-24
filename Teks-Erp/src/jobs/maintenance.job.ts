// =============================================================================
// Günlük bakım işi — gece penceresinde (fabrika saati 02:00–05:00) günde bir kez
// =============================================================================
// archive-scheduler ile aynı kalıp: setInterval + SystemSetting'te son-koşum günü.
// Tek Express process varsayımı (server.ts TEK-PROCESS INVARIANT).
// Görevler birbirinden bağımsızdır: birinin hatası ötekini durdurmaz.
// =============================================================================

import prisma from "../lib/prisma";
import { rotateRollbackBackups } from "../services/backup.service";
import { AuditService } from "../services/audit.service";
import { readLastAuditChainReport, verifyAndRecordAuditChain } from "../services/audit-chain.service";
import { SessionRegistryService } from "../services/session-registry.service";
import { TotpAccountService } from "../services/totp-account.service";
import { readAuditArchiveRetentionYears, readPrintLogRetentionDays } from "../services/system-setting.service";
import { prunePrintJobs } from "../services/print-job.service";
import { auditArchivePurgeCutoff, nextAuditPurgeSliceEnd } from "../services/helpers/audit-retention.helper";
import { isInMaintenanceWindow } from "../services/helpers/maintenance-window.helper";
import { factoryYmd } from "../constants/time";
import { reportJobFailure } from "./job-failure";
import { startArchiveScheduler } from "./archive-scheduler";
import { bilgi, hata } from "../lib/logger";

const SETTING_KEY = "maintenance.lastRunDay";
const PURGE_WATERMARK_KEY = "audit.archivePurgedThrough";
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;
/** Hiç doğrulanmamış zincirin açılıştaki tek seferlik doğrulamasının süre bütçesi. */
const FIRST_CHAIN_VERIFY_BUDGET_MS = 2 * 60 * 1000;
const WATCHDOG_MS = 3 * 60 * 60 * 1000;
/** Ölü oturum satırı bu yaştan sonra silinir (POST /admin/sessions/purge varsayılanıyla aynı). */
export const SESSION_PURGE_OLDER_THAN_DAYS = 90;
/** Tüketilmemiş 2FA kurulum penceresi süresi dolduktan bu kadar gün sonra silinir. */
export const TOTP_ENROLLMENT_PURGE_OLDER_THAN_DAYS = 30;
/** Bir gecede en fazla bu kadar aylık dilim budanır; kalan ertesi geceye kalır. */
const MAX_PURGE_SLICES = 200;

let timer: NodeJS.Timeout | null = null;
let running = false;
let runningSince: number | null = null;

async function getLastRunDay(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  return typeof row?.value === "string" ? row.value : null;
}

async function writeSetting(key: string, value: string, description: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value, description }, update: { value } });
}

async function readPurgeWatermark(): Promise<Date | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PURGE_WATERMARK_KEY } });
  const d = typeof row?.value === "string" ? new Date(row.value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Görev listesi — sıra önemsiz, her biri kendi hatasını raporlar. */
export const MAINTENANCE_TASKS: ReadonlyArray<{ name: string; run: () => Promise<string | null> }> = [
  {
    name: "rollback-backup-rotation",
    run: async () => {
      const r = await rotateRollbackBackups();
      if (r.deleted.length === 0 && r.failed.length === 0) return null;
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "BACKUP_ROTATED",
        payload: { deleted: r.deleted, failed: r.failed },
      });
      return `geri dönüş yedeği: ${r.deleted.length} silindi, ${r.failed.length} silinemedi`;
    },
  },
  {
    name: "audit-archive-purge",
    run: async () => {
      const years = await readAuditArchiveRetentionYears();
      const cutoff = auditArchivePurgeCutoff(years, new Date());
      if (!cutoff) return null;
      let deleted = 0;
      let watermark = await readPurgeWatermark();
      for (let i = 0; i < MAX_PURGE_SLICES && isInMaintenanceWindow(new Date()); i++) {
        const end = nextAuditPurgeSliceEnd(watermark, cutoff);
        if (!end) break;
        deleted += (await AuditService.purgeArchiveBefore(end)).deleted;
        await writeSetting(PURGE_WATERMARK_KEY, end.toISOString(), "Audit arşivi budamasının ulaştığı an");
        watermark = end;
      }
      if (deleted === 0) return null;
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "AUDIT_ARCHIVE_PURGE",
        payload: { retentionYears: years, cutoff: cutoff.toISOString(), deleted },
      });
      return `audit arşivi: ${deleted} satır budandı (${years} yıldan eski)`;
    },
  },
  {
    // G4: hash zinciri her gece baştan doğrulanır; kurcalama sağlık ekranına (auditProtection) düşer.
    name: "audit-chain-verify",
    run: async () => {
      const r = await verifyAndRecordAuditChain({ devamEt: () => isInMaintenanceWindow(new Date()) });
      if (r.yarim) return `audit zinciri: pencere kapandı, doğrulama yarım (${r.kontrolEdilen} satır)`;
      if (r.durum !== "kurcalanmis") return null;
      hata("maintenance", `audit zinciri KURCALANMIŞ: ${r.bulgular.length} bulgu`);
      return `audit zinciri: ${r.bulgular.length} kurcalama bulgusu`;
    },
  },
  {
    name: "session-purge",
    run: async () => {
      const r = await SessionRegistryService.purgeDeadSessions(SESSION_PURGE_OLDER_THAN_DAYS);
      return r.deleted > 0 ? `oturum: ${r.deleted} ölü satır silindi` : null;
    },
  },
  {
    name: "totp-enrollment-purge",
    run: async () => {
      const r = await TotpAccountService.purgeExpiredEnrollments(TOTP_ENROLLMENT_PURGE_OLDER_THAN_DAYS);
      if (r.deleted === 0) return null;
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "TOTP_ENROLLMENT_PURGE",
        payload: { olderThanDays: TOTP_ENROLLMENT_PURGE_OLDER_THAN_DAYS, deleted: r.deleted },
      });
      return `2FA kurulum penceresi: ${r.deleted} süresi dolmuş satır silindi`;
    },
  },
  {
    // Yazdırma geçmişi telemetridir: yalnız YAŞA göre budanır (`printLog.retentionDays`, 0 = budama yok).
    name: "print-job-purge",
    run: async () => {
      const days = await readPrintLogRetentionDays();
      const r = await prunePrintJobs(new Date(), days);
      if (r.deleted === 0) return null;
      return `yazdırma geçmişi: ${r.deleted} satır budandı (${days} günden eski)`;
    },
  },
];

export async function runMaintenanceIfDue(now: Date = new Date()): Promise<boolean> {
  if (running) {
    if (runningSince !== null && Date.now() - runningSince > WATCHDOG_MS) {
      hata("maintenance", "WATCHDOG: önceki bakım koşumu bitmedi — bayrak zorla bırakılıyor, elle kontrol edin.");
      running = false;
      runningSince = null;
    } else {
      return false;
    }
  }
  if (!isInMaintenanceWindow(now)) return false;
  running = true;
  runningSince = Date.now();
  try {
    const day = factoryYmd(now);
    if ((await getLastRunDay()) === day) return false;
    // Damga ÖNCE: düşen görev 15 dk'da bir yeniden denenip log'u doldurmasın.
    await writeSetting(SETTING_KEY, day, "Günlük bakım işinin son koştuğu fabrika günü");
    for (const task of MAINTENANCE_TASKS) {
      try {
        const summary = await task.run();
        if (summary) bilgi("maintenance", `${task.name}: ${summary}`);
      } catch (err) {
        reportJobFailure(`maintenance:${task.name}`, err);
      }
    }
    return true;
  } catch (err) {
    reportJobFailure("maintenance", err);
    return false;
  } finally {
    running = false;
    runningSince = null;
  }
}

/**
 * G4: zincir hiç doğrulanmamışsa (yeni kurulum, yeni göç) /health "kismi" kalmasın diye gece beklenmez —
 * açılışta bir kez, süre bütçeli; bütçe biterse yarım sonuç yazılmaz, gece görevi tamamlar.
 */
async function firstChainVerifyIfMissing(): Promise<void> {
  try {
    if (await readLastAuditChainReport()) return;
    const bitis = Date.now() + FIRST_CHAIN_VERIFY_BUDGET_MS;
    const r = await verifyAndRecordAuditChain({ devamEt: () => Date.now() < bitis });
    if (r.durum === "kurcalanmis") hata("maintenance", `audit zinciri KURCALANMIŞ: ${r.bulgular.length} bulgu`);
  } catch (err) {
    hata("maintenance", "ilk audit zinciri doğrulaması başarısız", err);
  }
}

/** Gece bakımının iki zamanlayıcısı: audit arşivleyicisi (30 günde bir) + günlük görevler. */
export function startMaintenanceScheduler(): void {
  startArchiveScheduler();
  if (timer) return;
  setTimeout(() => {
    void firstChainVerifyIfMissing();
    void runMaintenanceIfDue();
    timer = setInterval(() => void runMaintenanceIfDue(), CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("maintenance", "bakım işi aktif — her gün fabrika saatiyle 02:00–05:00 penceresinde bir kez");
}
