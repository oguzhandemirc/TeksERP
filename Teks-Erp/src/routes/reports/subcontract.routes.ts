// =============================================================================
// TeksERP - Subcontract Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import type { ReportKey } from "../../constants/report-catalog";
import {
  compareRangeSchema,
  dateRangeSchema,
  reportEnvelope,
  resolveCompareRange,
  resolveDateRange,
} from "../../services/reports/_shared";
import { getSubcontractScorecard } from "../../services/reports/subcontract-scorecard.report.service";

const router = Router();
/**
 * Kimlik → RAPOR KAPISI → izin. Sıra load-bearing (K4): kimliksiz istek 401 almalı
 * (kapalı raporun varlığı anonim çağırana sızmaz), rapor kapısı ise izin reddinden
 * ÖNCE koşar ki kapalı bir rapor "yetkin yok" değil "kapalı" desin.
 */
const reportGate = (key: ReportKey) => [verifyToken, requireReportOpen(key), requirePermission("report:subcontract")];

/** FASON KARNESİ — fire (giden ↔ dönen metraj), süre, açık bakiye. */
router.get("/scorecard", ...reportGate("subcontract/scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getSubcontractScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

export default router;
