// =============================================================================
// TeksERP - Dashboard Service
// =============================================================================
// Admin dashboard'a özel, mevcut CRUD endpoint'lerinden türetilemeyecek aggregate
// metrikler. Salt-okunur (CUD yok). Eskiden bu mantık dashboard.routes handler'ı
// içindeydi (Routes→Services katman atlama); tek sahip burası.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { KK1_ENTRY_SOURCES } from "../constants/kk1-entry-sources";
import { factoryDayStart } from "../constants/time";

export interface DefectsSummary {
  /** isProcessed = false (Tambur'da kapatılmamış) açık hata sayısı. */
  openCount: number;
  /** detectedAt bugün olan hata sayısı. */
  todayCount: number;
}

export interface StationLiveStateRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  type: string;
  queueCount: number;
  activeCount: number;
  todayCompletedCount: number;
  /** Sadece EXTERNAL istasyonlar için anlamlı — bugün bu fason istasyonuna
   *  sevk edilmiş parça (dispatch item) sayısı. INTERNAL'de hep 0. */
  todayDispatchedCount: number;
}

/**
 * Dashboard'ın TÜM "bugün" sayaçlarının ortak sınırı: FABRİKA takvim gününün
 * başlangıcı (Europe/Istanbul 00:00), mutlak an olarak.
 *
 * NEDEN AÇIK SAAT DİLİMİ: bu sayaçları vardiya başındaki operatör okuyor —
 * "bugün" onun duvar saatidir. Kolonlar timestamptz olduğu için sınırı MUTLAK
 * bir an olarak vermek zorundayız; hangi anın "bugünün başı" olduğu ise bir iş
 * kararıdır. Eski `new Date().setHours(0,0,0,0)` deseni bu kararı hiçbir yerde
 * YAZMIYORDU: cevabı süreç saat dilimine (`TZ` env) devrediyordu. Sunucu
 * Europe/Istanbul olduğu sürece doğru sonuç veriyor ama UTC kurulan/konteynere
 * alınan bir sunucuda gün 03:00'te başlar ve gece vardiyası sayaçlardan düşerdi.
 * Bkz. constants/time.ts.
 */
function startOfToday(): Date {
  return factoryDayStart();
}

export class DashboardService {
  /** Açık defect özeti (bekleyen + bugün açılan). */
  static async getDefectsSummary(): Promise<DefectsSummary> {
    const today = startOfToday();
    const [openCount, todayCount] = await Promise.all([
      prisma.rollError.count({ where: { isProcessed: false } }),
      prisma.rollError.count({ where: { detectedAt: { gte: today } } }),
    ]);
    return { openCount, todayCount };
  }

  /**
   * İstasyon doluluk anlık görünümü. Her aktif istasyon için kuyrukta bekleyen,
   * üzerinde işlem yapılan ve bugün biten roll sayıları (detay: dashboard.routes
   * Swagger JSDoc). RAW_QC istasyonu üretim akışına step olarak girmez → q/a/t
   * join'leri 0 döner; bunun yerine "bugün giren ham mal sayısı" yapıştırılır.
   */
  static async getStationsLiveState(): Promise<StationLiveStateRow[]> {
    const today = startOfToday();
    return prisma.$queryRaw<StationLiveStateRow[]>`
      SELECT
        s."id"                                    AS "id",
        s."code"                                  AS "code",
        s."name"                                  AS "name",
        s."kind"::text                            AS "kind",
        s."type"::text                            AS "type",
        COALESCE(q.cnt, 0)::int                   AS "queueCount",
        COALESCE(a.cnt, 0)::int                   AS "activeCount",
        COALESCE(
          CASE WHEN s."type" = 'EXTERNAL' THEN ext.cnt END,
          t.cnt,
          e.cnt,
          0
        )::int                                    AS "todayCompletedCount",
        COALESCE(disp.cnt, 0)::int                AS "todayDispatchedCount"
      FROM "stations" s
      LEFT JOIN (
        SELECT wos."stationId" AS "stationId", COUNT(r."id")::int AS cnt
        FROM "rolls" r
        JOIN "work_order_steps" wos ON wos."id" = r."currentStepId"
        GROUP BY wos."stationId"
      ) q ON q."stationId" = s."id"
      LEFT JOIN (
        SELECT wos."stationId" AS "stationId", COUNT(DISTINCT rm."rollId")::int AS cnt
        FROM "roll_movements" rm
        JOIN "work_order_steps" wos ON wos."id" = rm."workOrderStepId"
        WHERE rm."exitedAt" IS NULL
          AND rm."revokedAt" IS NULL
        GROUP BY wos."stationId"
      ) a ON a."stationId" = s."id"
      LEFT JOIN (
        SELECT wos."stationId" AS "stationId", COUNT(DISTINCT rm."rollId")::int AS cnt
        FROM "roll_movements" rm
        JOIN "work_order_steps" wos ON wos."id" = rm."workOrderStepId"
        WHERE rm."exitedAt" IS NOT NULL AND rm."exitedAt" >= ${today}
          AND rm."revokedAt" IS NULL
        GROUP BY wos."stationId"
      ) t ON t."stationId" = s."id"
      LEFT JOIN (
        -- EXTERNAL: bugün fason kabulde kabul edilen parça sayısı.
        SELECT wos."stationId" AS "stationId", COUNT(sri."id")::int AS cnt
        FROM "subcontractor_receipt_items" sri
        JOIN "subcontractor_receipts" sr ON sr."id" = sri."receiptId"
        JOIN "work_order_steps" wos ON wos."id" = sr."stepId"
        WHERE sr."cancelledAt" IS NULL
          AND sr."receivedAt" >= ${today}
        GROUP BY wos."stationId"
      ) ext ON ext."stationId" = s."id"
      LEFT JOIN (
        -- EXTERNAL: bugün bu istasyona sevk edilmiş parça sayısı (dispatch item).
        SELECT wos."stationId" AS "stationId", COUNT(di."id")::int AS cnt
        FROM "subcontractor_dispatch_items" di
        JOIN "subcontractor_dispatches" sd ON sd."id" = di."dispatchId"
        JOIN "work_order_steps" wos ON wos."id" = sd."stepId"
        WHERE sd."cancelledAt" IS NULL
          AND sd."dispatchedAt" >= ${today}
        GROUP BY wos."stationId"
      ) disp ON disp."stationId" = s."id"
      LEFT JOIN (
        -- KK1'in işi olan "bugün gelen ham top": kapsam TEK sabitten (KK1_ENTRY_SOURCES,
        -- mobil KK1 listesiyle birebir) — elle yazılı liste WEAVING/SEMI_FINISHED'ı kaçırıyordu.
        SELECT COUNT("id")::int AS cnt
        FROM "rolls"
        WHERE "entrySource"::text IN (${Prisma.join([...KK1_ENTRY_SOURCES])})
          AND "createdAt" >= ${today}
          AND "colorId" IS NULL
      ) e ON s."kind" = 'RAW_QC'
      WHERE s."isActive" = true
      ORDER BY s."code" ASC
    `;
  }
}
