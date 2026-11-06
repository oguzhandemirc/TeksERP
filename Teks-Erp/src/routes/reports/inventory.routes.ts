// =============================================================================
// TeksERP - Inventory Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import type { ReportKey } from "../../constants/report-catalog";
import {
  dateRangeSchema,
  emptyQuerySchema,
  reportEnvelope,
  resolveDateRange,
} from "../../services/reports/_shared";
import { getStockScorecard } from "../../services/reports/stock-scorecard.report.service";
import { getStockKalem } from "../../services/reports/stock-kalem.report.service";

const router = Router();
/**
 * Kimlik → RAPOR KAPISI → izin. Sıra load-bearing (K4): kimliksiz istek 401 almalı
 * (kapalı raporun varlığı anonim çağırana sızmaz), rapor kapısı ise izin reddinden
 * ÖNCE koşar ki kapalı bir rapor "yetkin yok" değil "kapalı" desin.
 */
const reportGate = (key: ReportKey) => [verifyToken, requireReportOpen(key), requirePermission("report:inventory")];

/**
 * STOK & ÖLÜ STOK — SNAPSHOT (tarih aralığı YOK).
 * "Şu an rafta ne var, kaç gündür duruyor, siparişi var mı" sorusunun tarih
 * filtresiyle işi yoktur; zarf yine de `resolveDateRange` ile doldurulur ki
 * istemci sözleşmesi tek tip kalsın.
 */
router.get("/scorecard", ...reportGate("inventory/scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    emptyQuerySchema.parse(req.query);
    const data = await getStockScorecard();
    res.status(200).json(reportEnvelope(data, resolveDateRange({})));
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/reports/inventory/scorecard/kalem:
 *   get:
 *     summary: Stok & Ölü Stok — kalem bazında (ham kumaş başına · bitmiş kumaş+en+renk+kat başına top ve metre)
 *     tags: [Reports]
 *     responses:
 *       200: { description: "totals + ham[] + bitmis[]; toplamlar Stok & Ölü Stok kutularıyla aynı" }
 */
// Aynı raporun sekmesi → aynı rapor kapısı ve izin (katalog `kapiTasiyici` iki uç).
// Bakım dalı (2.11.x): satır tavanı (`capReportLists`) bu sürümde yok; satırlar kalem grubudur.
router.get("/scorecard/kalem", ...reportGate("inventory/scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    emptyQuerySchema.parse(req.query);
    const data = await getStockKalem();
    res.status(200).json(reportEnvelope(data, resolveDateRange({})));
  } catch (e) {
    next(e);
  }
});

export default router;
