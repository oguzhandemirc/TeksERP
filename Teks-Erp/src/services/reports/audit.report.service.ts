// =============================================================================
// TeksERP - Audit (System Log) Reports
// =============================================================================
// 2 alt-rapor: audit log özeti (tablo × işlem türü), kullanıcı aktivitesi.
// SystemLog yüksek hacimli — sorgular yalnız @@index([createdAt]) üzerinden.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { factoryDaySql } from "../../constants/time";

// ---------- 1) System Log Summary --------------------------------------------

export interface SystemLogSummary {
  totalLogs: number;
  byAction: { action: string; count: number }[];
  byTable: { tableName: string; count: number }[];
  daily: { day: string; create: number; update: number; delete: number }[];
}

export async function getSystemLogSummary(range: DateRange): Promise<SystemLogSummary> {
  // GÜN SORUSU = TAKVİM GÜNÜ (fabrika saati, Europe/Istanbul — constants/time.ts).
  // Audit "hangi gün kaç kayıt değişti" sorusudur; denetçi/yönetici bunu kendi
  // takviminden okur. "createdAt" timestamptz olduğu için çıplak DATE_TRUNC günü
  // OTURUM saat diliminde (UTC) keserdi → gece 00:00–03:00 arasındaki her işlem
  // BİR ÖNCEKİ günün çubuğuna düşerdi.
  //
  // PERF (Faz C2 — ÖLÇÜLDÜ, bkz. docs/history/SCALE-REPORT.md §8): system_logs en hızlı
  // büyüyen tablo; 365-gün worst-case'de bu rapor tabloyu tarar. Worst-case
  // toplam ~2.66× hızlandı (p50 1064→400ms, 430k satır). Üç katman:
  //   0) ASIL KAZANÇ (2.14×) KODDA DEĞİL: `daily` sorgusunun GROUP BY ifadesi
  //      için EKLENEN ifade istatistiği (migration 20260614120000 →
  //      2026-08-01'de 20260801050000_system_log_daily_stats_tz ile fabrika
  //      saat dilimli ifadeye TAŞINDI; ifade birebir eşleşmezse stats devre
  //      dışı kalır ve sorgu sessizce yavaş plana düşer). Onsuz
  //      planner grup sayısını yanlış (≈satır sayısı) tahmin edip diske-taşan
  //      tek-thread Sort+GroupAggregate seçer (258ms); statsla gerçek günü (≤366)
  //      bilir → paralel in-memory HashAggregate (113ms). ⚠️ daily'nin WHERE/
  //      GROUP BY ifadesini değiştirirsen stats devre dışı kalır (yavaşlar, ama
  //      DOĞRU sonuç verir) — migration'ı da güncelle.
  //   1) `total` sorgusu KALDIRILDI — `byAction` LIMIT'siz + `action` NOT NULL
  //      olduğundan totalLogs = Σ byAction.count (cebirsel olarak birebir). Bir
  //      tam-tablo taraması bedavaya elendi (4 → 3).
  //   2) Kalan 3 sorgu Promise.all ile PARALEL (1→2 ek 1.24×). Base prisma client
  //      havuzlu (pg Pool max:30, tx DEĞİL) → ayrı connection'larda gerçekten
  //      eşzamanlı koşar; süre ardışık-toplam yerine ~en-yavaş-sorgu olur. (Kural
  //      #11'deki "tx.* + Promise.all YASAK" yalnız tek-connection tx client'ı
  //      içindir; bu salt-okuma rapor tx kullanmaz.) NOT: paralelleştirme yalnız
  //      (0) sonrası kazanç — daily baskınken (ilk ölçüm) contention yüzünden
  //      REGRESYON veriyordu; stats onu dengeleyince kazanca döndü. GROUPING SETS
  //      denemesi (C2 ilk tur) plan değişimiyle regresyon vermişti; bu yaklaşım
  //      SQL şeklini değiştirmez → regresyon yapısal olarak imkânsız.
  const [actionRows, tableRows, dailyRows] = await Promise.all([
    prisma.$queryRaw<Array<{ action: string; count: bigint }>>(Prisma.sql`
      SELECT action, COUNT(*) AS count
      FROM system_logs
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY action
      ORDER BY count DESC
    `),
    prisma.$queryRaw<Array<{ tableName: string; count: bigint }>>(Prisma.sql`
      SELECT "tableName", COUNT(*) AS count
      FROM system_logs
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY "tableName"
      ORDER BY count DESC
      LIMIT 30
    `),
    prisma.$queryRaw<
      Array<{ day: Date; createCount: bigint; updateCount: bigint; deleteCount: bigint }>
    >(Prisma.sql`
      SELECT
        ${factoryDaySql('"createdAt"')}                AS day,
        COUNT(*) FILTER (WHERE action = 'CREATE')      AS "createCount",
        COUNT(*) FILTER (WHERE action = 'UPDATE')      AS "updateCount",
        COUNT(*) FILTER (WHERE action = 'DELETE')      AS "deleteCount"
      FROM system_logs
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY 1
      ORDER BY 1
    `),
  ]);

  const byAction = actionRows.map((r) => ({ action: r.action, count: Number(r.count) }));
  const totalLogs = byAction.reduce((sum, r) => sum + r.count, 0);

  return {
    totalLogs,
    byAction,
    byTable: tableRows.map((r) => ({ tableName: r.tableName, count: Number(r.count) })),
    daily: dailyRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      create: Number(r.createCount),
      update: Number(r.updateCount),
      delete: Number(r.deleteCount),
    })),
  };
}

// ---------- 2) User Activity -------------------------------------------------

export interface UserActivityRow {
  userId: string | null;
  username: string | null;
  fullName: string | null;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  totalCount: number;
  lastActionAt: Date | null;
}

export async function getUserActivity(range: DateRange): Promise<UserActivityRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      userId: string | null;
      username: string | null;
      fullName: string | null;
      createCount: bigint;
      updateCount: bigint;
      deleteCount: bigint;
      totalCount: bigint;
      lastActionAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      sl."userId"                                     AS "userId",
      u.username                                       AS username,
      u."fullName"                                     AS "fullName",
      COUNT(*) FILTER (WHERE sl.action = 'CREATE')     AS "createCount",
      COUNT(*) FILTER (WHERE sl.action = 'UPDATE')     AS "updateCount",
      COUNT(*) FILTER (WHERE sl.action = 'DELETE')     AS "deleteCount",
      COUNT(*)                                         AS "totalCount",
      MAX(sl."createdAt")                              AS "lastActionAt"
    FROM system_logs sl
    LEFT JOIN users u ON u.id = sl."userId"
    WHERE sl."createdAt" >= ${range.from} AND sl."createdAt" <= ${range.to}
    -- SATIR SUZULMEZ (karar #8 - tam iz); gizlenen yalniz KIMLIKTIR ve bunu
    -- SELECT tarafindaki CASE yapar. Suzmek userId IS NULL olan sistem
    -- olaylarini da (LEFT JOIN -> u NULL) dusururdu; ayrica bu bir DENETIM
    -- raporudur. GROUP BY ifadeleri SELECT ile AYNI metin olmak ZORUNDA.
    GROUP BY sl."userId", u.username, u."fullName"
    ORDER BY "totalCount" DESC
    LIMIT 100
  `);

  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    fullName: r.fullName,
    createCount: Number(r.createCount),
    updateCount: Number(r.updateCount),
    deleteCount: Number(r.deleteCount),
    totalCount: Number(r.totalCount),
    lastActionAt: r.lastActionAt,
  }));
}
