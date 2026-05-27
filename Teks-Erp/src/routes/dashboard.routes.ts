// =============================================================================
// TeksERP - Dashboard Aggregation Routes
// =============================================================================
// Admin dashboard'a özel, mevcut CRUD endpoint'lerinden türetilemeyecek
// aggregate metrikler burada toplanır. Her endpoint salt-okunur; CUD yok.

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import prisma from "../lib/prisma";

const router = Router();

/**
 * @openapi
 * /api/dashboard/defects/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: Açık defect özeti (bekleyen + bugün açılan)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: openCount = isProcessed=false, todayCount = detectedAt bugün
 */
router.get(
  "/defects/summary",
  verifyToken,
  requirePermission("quality:read"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [openCount, todayCount] = await Promise.all([
        prisma.rollError.count({ where: { isProcessed: false } }),
        prisma.rollError.count({ where: { detectedAt: { gte: startOfToday } } }),
      ]);

      res.status(200).json({
        success: true,
        data: { openCount, todayCount },
      });
    } catch (error) {
      next(error);
    }
  },
);

interface StationLiveStateRow {
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
 * @openapi
 * /api/dashboard/stations/live-state:
 *   get:
 *     tags: [Dashboard]
 *     summary: İstasyon doluluk anlık görünümü
 *     description: |
 *       Her aktif istasyon için kuyrukta bekleyen, üzerinde işlem yapılan
 *       ve bugün biten roll sayılarını döner.
 *
 *       - queueCount = `Roll.currentStepId` bu istasyondaki step'lere bağlı tüm rolls
 *       - activeCount = açık RollMovement (exitedAt IS NULL) ile bu istasyonda işlenmekte olan distinct rolls
 *       - todayCompletedCount =
 *           - INTERNAL: bugün exitedAt'i dolan distinct rolls (FINISH/SKIP)
 *           - EXTERNAL: bugün fason kabul ile doğan açık kumaş parça sayısı
 *             (kaç gittiği değil, kaç tane kabul ettiği — operatör perspektifi)
 *           - RAW_QC: bugün giren ham mal sayısı
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/stations/live-state",
  verifyToken,
  requirePermission("station:read"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // RAW_QC (KK1) istasyonu üretim akışına step olarak girmez — `currentStepId`
      // hiçbir Roll'da bu istasyona bağlanmaz. Bu yüzden q/a/t join'leri RAW_QC
      // için her zaman 0 döner. Kullanıcı için anlamlı tek metrik "bugün giren
      // ham mal sayısı" — bunu entrySource=SUPPLIER_RECEIPT + createdAt>=today
      // ile e join'iyle hesaplıyoruz ve RAW_QC station'lara yapıştırıyoruz.
      const rows = await prisma.$queryRaw<StationLiveStateRow[]>`
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
          GROUP BY wos."stationId"
        ) a ON a."stationId" = s."id"
        LEFT JOIN (
          SELECT wos."stationId" AS "stationId", COUNT(DISTINCT rm."rollId")::int AS cnt
          FROM "roll_movements" rm
          JOIN "work_order_steps" wos ON wos."id" = rm."workOrderStepId"
          WHERE rm."exitedAt" IS NOT NULL AND rm."exitedAt" >= ${startOfToday}
          GROUP BY wos."stationId"
        ) t ON t."stationId" = s."id"
        LEFT JOIN (
          -- EXTERNAL: bugün fason kabulde kabul edilen parça sayısı.
          -- subcontractor_receipt_items her tür fason için bir satır tutar:
          -- boyahane'de yeni doğan açık kumaş, zımpara/yıkama'da geri dönen
          -- orijinal top. Operatörün "bugün kaç parça kabul ettim" cevabı.
          SELECT wos."stationId" AS "stationId", COUNT(sri."id")::int AS cnt
          FROM "subcontractor_receipt_items" sri
          JOIN "subcontractor_receipts" sr ON sr."id" = sri."receiptId"
          JOIN "work_order_steps" wos ON wos."id" = sr."stepId"
          WHERE sr."cancelledAt" IS NULL
            AND sr."receivedAt" >= ${startOfToday}
          GROUP BY wos."stationId"
        ) ext ON ext."stationId" = s."id"
        LEFT JOIN (
          -- EXTERNAL: bugün bu istasyona sevk edilmiş parça sayısı (dispatch
          -- item). İptal edilmiş sevkler hariç.
          SELECT wos."stationId" AS "stationId", COUNT(di."id")::int AS cnt
          FROM "subcontractor_dispatch_items" di
          JOIN "subcontractor_dispatches" sd ON sd."id" = di."dispatchId"
          JOIN "work_order_steps" wos ON wos."id" = sd."stepId"
          WHERE sd."cancelledAt" IS NULL
            AND sd."dispatchedAt" >= ${startOfToday}
          GROUP BY wos."stationId"
        ) disp ON disp."stationId" = s."id"
        LEFT JOIN (
          SELECT COUNT("id")::int AS cnt
          FROM "rolls"
          WHERE "entrySource" = 'SUPPLIER_RECEIPT'
            AND "createdAt" >= ${startOfToday}
            AND "colorId" IS NULL
        ) e ON s."kind" = 'RAW_QC'
        WHERE s."isActive" = true
        ORDER BY s."code" ASC
      `;

      res.status(200).json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
