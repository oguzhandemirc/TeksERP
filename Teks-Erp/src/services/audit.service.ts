// =============================================================================
// TeksERP - Audit (SystemLog) Service
// =============================================================================
// Every CUD operation MUST log via this service (kök CLAUDE.md kuralı).
// Best-effort: yazım hatası isteği DÜŞÜRMEZ (/health sayacına düşer); tx DIŞINDA çağrılır.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

import { currentOrigin } from "../lib/request-context";
import { diffCommonFields } from "./helpers/audit-diff.helper";
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
    /** Alan-bazlı değişiklik (Faz B2) — [{ field, old, new }]. */
    changes?: Array<{ field: string; old: unknown; new: unknown }> | null;
  }): Promise<void> {
    const origin = currentOrigin();
    // ── NE DEĞİŞTİ (Faz B2 — kapsam genişletmesi) ────────────────────────────
    // Çağıran diff vermediyse BURADA hesaplanır. Gerekçe ölçümle: 213 çağrı
    // noktasının yalnız 2'si `changes` gönderiyordu; geri kalanı elle yazılmış
    // ham JSON'du ve ekranda "targetColorId: 91cd… → bb82…" diye okunuyordu.
    // Diff'i çağrı noktalarına tek tek eklemek 211 dosya dokunuşu + her yeni
    // çağrıda unutulabilecek bir adım demekti; tek kapıda hesaplamak aynı işi
    // geriye dönük de yapar. Çağıranın verdiği diff DAİMA kazanır (o, alanın
    // anlamını bilir).
    const changes =
      params.changes ?? diffCommonFields(params.oldData ?? null, params.newData ?? null);
    try {
      await prisma.systemLog.create({
        data: {
          userId: params.userId ?? null,
          category: "DOMAIN",
          action: params.action,
          tableName: params.tableName,
          recordId: params.recordId,
          // ── NEREDEN (Faz B3) ────────────────────────────────────────────
          // İstek bağlamından OTOMATİK okunur — 251 çağrı noktasının hiçbiri
          // değişmedi. Bağlam yoksa (job/script/test) null kalır ve kayıt yine
          // yazılır: cihaz bilgisi eksik diye izi düşürmek daha kötüdür.
          ipAddress: origin.ipAddress,
          deviceId: origin.deviceId,
          // ── HANGİ İŞLEM (2026-08-19) ────────────────────────────────────
          // Aynı istekte yazılan tüm satırlar aynı id. SAP `CDHDR` bunu ayrı
          // bir başlık kaydıyla yapar; bizde tek kolon yetiyor çünkü gruplama
          // sorgusu index'li tek eşitlik.
          requestId: origin.requestId,
          oldData: (params.oldData ?? Prisma.JsonNull) as JsonValue,
          newData: (params.newData ?? Prisma.JsonNull) as JsonValue,
          // Faz B2 — alan-bazlı değişiklik. Boş dizi de `JsonNull` yazılır:
          // "değişiklik yok" ile "diff hesaplanmadı" ayrımı BURADA değil,
          // çağıranda yapılır (boş diffte satır hiç yazılmaz).
          changes: (changes?.length ? changes : Prisma.JsonNull) as JsonValue,
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
    const origin = currentOrigin();
    try {
      await prisma.systemLog.createMany({
        data: entries.map((e) => ({
          userId: e.userId ?? null,
          category: "DOMAIN",
          action: e.action,
          tableName: e.tableName,
          recordId: e.recordId,
          ipAddress: origin.ipAddress,
          deviceId: origin.deviceId,
          // Toplu yazımın TAMAMI tek istekten çıktığı için hepsi AYNI id'yi
          // taşır — gruplamanın tanımı zaten budur.
          requestId: origin.requestId,
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
    const origin = currentOrigin();
    try {
      await prisma.systemLog.create({
        data: {
          userId: params.userId ?? null,
          category: params.category,
          action: params.action,
          tableName: params.tableName ?? params.category,
          recordId: params.recordId ?? "-",
          ipAddress: params.ipAddress ?? null,
          // Giriş olayı da bir isteğin parçasıdır; STARTUP/ERROR gibi bağlamsız
          // olaylarda null kalır.
          requestId: origin.requestId,
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
      // ── ARŞİVLEYİCİNİN MEŞRU SİLME İZNİ (2026-08-19) ──────────────────────
      // `system_logs` üzerinde UPDATE/DELETE/TRUNCATE'i engelleyen trigger var
      // (migration 20260819161000, ISO 27001 A.8.15). Arşivleme o engelin TEK
      // meşru istisnasıdır — satır silinmiyor, TAŞINIYOR.
      //
      // ⚠️ `SET LOCAL` bu transaction'a özeldir ve COMMIT'te söner; havuzdaki
      // diğer bağlantılara SIZMAZ. Prisma interactive tx'i adanmış bir client
      // alır, dolayısıyla aşağıdaki `deleteMany` ile AYNI oturumda koşar.
      //
      // ⚠️ SIRA LOAD-BEARING: bu ifade `deleteMany`den ÖNCE gelmek zorunda.
      // Bekçi (test_audit_depth §10) iki ifadenin kaynak sırasını da doğrular —
      // "var mı" kontrolü sonradan aşağı kaydırılmasına karşı kör olurdu.
      await tx.$executeRaw`SET LOCAL teks.audit_purge = 'on'`;

      await tx.systemLogArchive.createMany({
        data: logsToArchive.map((log) => ({
          id: log.id,
          userId: log.userId,
          action: log.action,
          category: log.category,
          ipAddress: log.ipAddress,
          tableName: log.tableName,
          recordId: log.recordId,
          deviceId: log.deviceId,
          // İşlem gruplaması arşivde de yaşamalı — taşınmasaydı 6 ay sonra
          // "bu değişiklikler aynı işlemden mi" sorusu cevapsız kalırdı.
          requestId: log.requestId,
          changes: log.changes as Prisma.InputJsonValue,
          oldData: log.oldData as Prisma.InputJsonValue,
          newData: log.newData as Prisma.InputJsonValue,
          createdAt: log.createdAt,
          // ⚠️ `system_logs.updatedAt` DÜŞÜRÜLDÜ (Faz B1): audit satırı yazıldıktan
          // sonra hiç güncellenmez. Arşiv tablosunda kolon DURUYOR (taşınmış
          // tarihsel veri, şeması değiştirilmez) → `createdAt` ile doldurulur.
          // Bu bir kayıp DEĞİL: düşürmeden önce canlıda `updatedAt > createdAt`
          // olan 0 satır vardı, yani ikisi zaten her zaman aynıydı.
          updatedAt: log.createdAt,
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
