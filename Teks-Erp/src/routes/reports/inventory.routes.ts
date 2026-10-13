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
  capReportLists,
} from "../../services/reports/_shared";
import { getStockScorecard } from "../../services/reports/stock-scorecard.report.service";

const router = Router();
/** Satır tavanına giren liste (Perf-2 B5): kumaş kırılımı katalogla büyür; yaş kovası/en eski 25 sabit. */
export const STOCK_LISTS = [["byItem", "Kumaş kırılımı"]] as const;
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
    const { data, warnings } = capReportLists(await getStockScorecard(), STOCK_LISTS);
    res.status(200).json(reportEnvelope(data, resolveDateRange({}), null, { warnings }));
  } catch (e) {
    next(e);
  }
});

export default router;
