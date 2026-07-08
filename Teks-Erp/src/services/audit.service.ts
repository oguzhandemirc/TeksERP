// =============================================================================
// TeksERP - Audit (SystemLog) Service
// =============================================================================
// Every CUD operation MUST log via this service (kök CLAUDE.md kuralı).
// Best-effort: yazım hatası isteği DÜŞÜRMEZ (/health sayacına düşer); tx DIŞINDA çağrılır.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

type JsonValue = Prisma.InputJsonValue | typeof Prisma.JsonNull;

const ARCHIVE_BATCH_SIZE = 5000;

// =============================================================================
// Audit yazım sağlığı (best-effort ama sessiz değil)
// =============================================================================
// Audit log yazımı ana operasyonu ASLA bozmaz (catch yutar) — ama DB çökerse
// ya da P2022 gibi bir sebeple log düşerse bunun sessizce kaybolması "kim neyi
// yaptı" izini sonsuza dek siler ve sistemin haberi olmaz. Bu yüzden başarısız
// yazımları say + son hatayı tut. `/health` bunu `auditWriteFailures` olarak
// gösterir → operatör/durum paneli audit kaybını fark eder (yutmaya devam edip
// ana akışı korurken). Süreç içi sayaç; restart'ta sıfırlanır (kalıcı izleme
// gerekirse ileride /health metriği bir monitöre bağlanır).
interface AuditHealth {
  failureCount: number;
  lastError: string | null;
  lastFailureAt: string | null;
}

const auditFailureState = {
  count: 0,
  lastError: null as string | null,
  lastAt: null as string | null,
};

function recordAuditFailure(error: unknown): void {
  auditFailureState.count += 1;
  auditFailureState.lastError = error instanceof Error ? error.message : String(error);
  auditFailureState.lastAt = new Date().toISOString();
}

export class AuditService {
  /**
   * `/health` endpoint'i için audit yazım sağlığı. Best-effort log'ların
   * sessizce düşmediğini izlemek için süreç-içi sayaç döner.
   */
  static getHealth(): AuditHealth {
    return {
      failureCount: auditFailureState.count,
      lastError: auditFailureState.lastError,
      lastFailureAt: auditFailureState.lastAt,
    };
  }

  /**
   * Log a Create/Update/Delete operation to SystemLog.
   * Bu yol DOMAIN kategorisini doldurur (Activity Page'in beslendiği kanal).
   */
  static async log(params: {
    userId: string | undefined;
    action: "CREATE" | "UPDATE" | "DELETE";
    tableName: string;
    recordId: string;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await prisma.systemLog.create({
        data: {
          userId: params.userId ?? null,
          category: "DOMAIN",
          action: params.action,
          tableName: params.tableName,
          recordId: params.recordId,
          oldData: (params.oldData ?? Prisma.JsonNull) as JsonValue,
          newData: (params.newData ?? Prisma.JsonNull) as JsonValue,
        },
      });
    } catch (error) {
      // Audit logging should never crash the main operation — but don't lose it
      // silently: sayacı artır ki /health audit kaybını görsün.
      recordAuditFailure(error);
      console.error("[audit]: Failed to write SystemLog:", error);
    }
  }

  /**
   * Birden çok DOMAIN CUD log'unu TEK `createMany` ile yazar — toplu işlemlerden
   * (WO'ya N top iliştir/çıkar, Tambur'da N child üret) sonra `Promise.all`/`for`
   * ile N ayrı INSERT atmak yerine. CLAUDE.md perf kuralı #9 (createMany toplu).
   * Best-effort: hata ana akışı bozmaz, sayaca düşer (/health görür). Tx DIŞINDA.
   */
  static async logMany(
    entries: Array<{
      userId: string | undefined;
      action: "CREATE" | "UPDATE" | "DELETE";
      tableName: string;
      recordId: string;
      oldData?: Record<string, unknown> | null;
      newData?: Record<string, unknown> | null;
    }>
  ): Promise<void> {
    if (entries.length === 0) return;
    try {
      await prisma.systemLog.createMany({
        data: entries.map((e) => ({
          userId: e.userId ?? null,
          category: "DOMAIN",
          action: e.action,
          tableName: e.tableName,
          recordId: e.recordId,
          oldData: (e.oldData ?? Prisma.JsonNull) as JsonValue,
          newData: (e.newData ?? Prisma.JsonNull) as JsonValue,
        })),
      });
    } catch (error) {
      recordAuditFailure(error);
      console.error("[audit]: Failed to write SystemLog batch:", error);
    }
  }

  /**
   * Log non-CUD system events (auth, startup, errors). Sistem Kayıtları
   * sayfasının beslendiği kanal.
   *
   * - category="AUTH": tableName="AUTH", recordId=username, action="LOGIN_SUCCESS"/"LOGIN_FAILED"
   * - category="SYSTEM": tableName="SYSTEM", recordId="-" veya error code, action="STARTUP"/"ERROR"
   *
   * newData payload'ı serbest — username, reason, stack özeti, env vs.
   */
  static async logEvent(params: {
    category: "AUTH" | "SYSTEM";
    action: string;
    userId?: string | null;
    tableName?: string;
    recordId?: string;
    ipAddress?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await prisma.systemLog.create({
        data: {
          userId: params.userId ?? null,
          category: params.category,
          action: params.action,
          tableName: params.tableName ?? params.category,
          recordId: params.recordId ?? "-",
          ipAddress: params.ipAddress ?? null,
          newData: (params.payload ?? Prisma.JsonNull) as JsonValue,
        },
      });
    } catch (error) {
      recordAuditFailure(error);
      console.error("[audit]: Failed to write event SystemLog:", error);
    }
  }

  /**
   * X aydan eski sistem loglarını system_log_archives tablosuna taşır.
   * Büyük tablolarda ARCHIVE_BATCH_SIZE kadar kayıtla çalışır — tekrar çağır.
   * Dönen `archived` sayısı 0 ise tamamlandı.
   */
  static async archiveOlderThan(monthsToKeep: number): Promise<{ archived: number; cutoff: string }> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsToKeep);

    const logsToArchive = await prisma.systemLog.findMany({
      where: { createdAt: { lt: cutoff } },
      take: ARCHIVE_BATCH_SIZE,
      orderBy: { createdAt: "asc" },
    });

    if (logsToArchive.length === 0) {
      return { archived: 0, cutoff: cutoff.toISOString() };
    }

    const ids = logsToArchive.map((l) => l.id);

    await prisma.$transaction(async (tx) => {
      await tx.systemLogArchive.createMany({
        data: logsToArchive.map((log) => ({
          id: log.id,
          userId: log.userId,
          action: log.action,
          category: log.category,
          ipAddress: log.ipAddress,
          tableName: log.tableName,
          recordId: log.recordId,
          oldData: log.oldData as Prisma.InputJsonValue,
          newData: log.newData as Prisma.InputJsonValue,
          createdAt: log.createdAt,
          updatedAt: log.updatedAt,
        })),
        skipDuplicates: true,
      });
      await tx.systemLog.deleteMany({ where: { id: { in: ids } } });
    });

    return { archived: logsToArchive.length, cutoff: cutoff.toISOString() };
  }

  /**
   * GET /api/admin/system-logs/stats için tablo boyutu istatistikleri.
   * K4: prisma erişimi admin.routes'tan servise taşındı (katman kuralı).
   * Global pool client'la Promise.all serbest (tx değil).
   */
  static async getLogStats(): Promise<{
    activeCount: number;
    archiveCount: number;
    oldestLog: Date | null;
    lastAutoArchiveAt: string | null;
  }> {
    // F229: iki tam COUNT(*) yerine pg_class.reltuples TAHMİNİ. system_logs +
    // system_log_archives sınırsız büyür; milyonlarca satırda COUNT(*) index tam
    // taraması saniyeler (statement_timeout=50s riski). Boyut göstergesi için
    // kesin sayı gerekmez; reltuples autovacuum/ANALYZE ile güncellenir (YAKLAŞIK).
    const [sizes, oldest, lastRun] = await Promise.all([
      prisma.$queryRaw<Array<{ active: bigint; archive: bigint }>>(Prisma.sql`
        SELECT
          GREATEST(COALESCE((SELECT c.reltuples FROM pg_class c WHERE c.oid = to_regclass('public.system_logs')), 0), 0)::bigint AS active,
          GREATEST(COALESCE((SELECT c.reltuples FROM pg_class c WHERE c.oid = to_regclass('public.system_log_archives')), 0), 0)::bigint AS archive
      `),
      prisma.systemLog.findFirst({
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.systemSetting.findUnique({
        where: { key: "audit.lastArchiveAt" },
        select: { value: true },
      }),
    ]);
    return {
      activeCount: Number(sizes[0]?.active ?? 0),
      archiveCount: Number(sizes[0]?.archive ?? 0),
      oldestLog: oldest?.createdAt ?? null,
      lastAutoArchiveAt: (lastRun?.value as string | null) ?? null,
    };
  }
}
