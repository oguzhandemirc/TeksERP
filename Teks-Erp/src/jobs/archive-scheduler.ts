// =============================================================================
// Audit log otomatik arşivleyici
// =============================================================================
// node-cron allowed-packages dışında olduğu için setInterval ile gidiyoruz.
// Tek Express process varsayımı — birden fazla replica gerekirse advisory
// lock veya ayrı worker'a taşı.
//
// Davranış:
//   - Server start'tan 60sn sonra ilk kontrol (DB hazır olsun)
//   - Sonra her CHECK_INTERVAL_MS'de bir kontrol
//   - Son çalışma SystemSetting'te (`audit.lastArchiveAt`); INTERVAL_DAYS dolmadan
//     tekrar koşmaz — server restart spam'ini engeller
//   - Eski log varsa ARCHIVE_BATCH_SIZE'lık batch döngüsü; safety cap 200 batch
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";

const SETTING_KEY = "audit.lastArchiveAt";
const MONTHS_TO_KEEP = 6;
const INTERVAL_DAYS = 30; // iki çalışma arasında min gün
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24sa
const STARTUP_DELAY_MS = 60 * 1000; // server start'tan sonra ilk kontrole kadar
const MAX_BATCHES_PER_RUN = 200; // sonsuz döngü guard'ı

let timer: NodeJS.Timeout | null = null;
let running = false;

async function getLastRun(): Promise<Date | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  if (typeof row?.value !== "string") return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function setLastRun(at: Date): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: {
      key: SETTING_KEY,
      value: at.toISOString(),
      description: "Audit log otomatik arşivleyicinin son çalıştığı zaman",
    },
    update: { value: at.toISOString() },
  });
}

async function runIfDue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const last = await getLastRun();
    if (last) {
      const daysSince = (Date.now() - last.getTime()) / (24 * 60 * 60 * 1000);
      if (daysSince < INTERVAL_DAYS) return;
    }

    let totalArchived = 0;
    let batches = 0;
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const result = await AuditService.archiveOlderThan(MONTHS_TO_KEEP);
      batches += 1;
      totalArchived += result.archived;
      if (result.archived === 0) break;
    }

    await setLastRun(new Date());

    if (totalArchived > 0) {
      console.log(
        `[audit-archive] ${totalArchived} kayıt arşivlendi (${batches} batch, monthsToKeep=${MONTHS_TO_KEEP})`,
      );
    }
  } catch (err) {
    console.error("[audit-archive] çalışma başarısız:", err);
  } finally {
    running = false;
  }
}

export function startArchiveScheduler(): void {
  if (timer) return;
  setTimeout(() => {
    void runIfDue();
    timer = setInterval(() => void runIfDue(), CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  console.log(
    `[audit-archive] scheduler aktif — her ${INTERVAL_DAYS} günde bir ${MONTHS_TO_KEEP} aydan eski log'ları arşivleyecek`,
  );
}
