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
import { isInMaintenanceWindow } from "../services/helpers/maintenance-window.helper";
import { factoryYmd } from "../constants/time";
import { reportJobFailure } from "./job-failure";
import { startArchiveScheduler } from "./archive-scheduler";
import { bilgi, hata } from "../lib/logger";

const SETTING_KEY = "maintenance.lastRunDay";
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;
const WATCHDOG_MS = 3 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let runningSince: number | null = null;

async function getLastRunDay(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  return typeof row?.value === "string" ? row.value : null;
}

async function setLastRunDay(day: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: day, description: "Günlük bakım işinin son koştuğu fabrika günü" },
    update: { value: day },
  });
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
    await setLastRunDay(day);
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

/** Gece bakımının iki zamanlayıcısı: audit arşivleyicisi (30 günde bir) + günlük görevler. */
export function startMaintenanceScheduler(): void {
  startArchiveScheduler();
  if (timer) return;
  setTimeout(() => {
    void runMaintenanceIfDue();
    timer = setInterval(() => void runMaintenanceIfDue(), CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("maintenance", "bakım işi aktif — her gün fabrika saatiyle 02:00–05:00 penceresinde bir kez");
}
