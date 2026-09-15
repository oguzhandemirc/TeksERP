// =============================================================================
// TeksERP - Audit Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import type { ReportKey } from "../../constants/report-catalog";
import {
  dateRangeSchema,
  reportEnvelope,
  resolveDateRange,
} from "../../services/reports/_shared";
import {
  getSystemLogSummary,
  getUserActivity,
} from "../../services/reports/audit.report.service";

const router = Router();
/**
 * Kimlik → RAPOR KAPISI → izin. Sıra load-bearing (K4): kimliksiz istek 401 almalı
 * (kapalı raporun varlığı anonim çağırana sızmaz), rapor kapısı ise izin reddinden
 * ÖNCE koşar ki kapalı bir rapor "yetkin yok" değil "kapalı" desin.
 */
const reportGate = (key: ReportKey) => [verifyToken, requireReportOpen(key), requirePermission("report:audit")];

router.get("/system-log-summary", ...reportGate("audit/system-log-summary"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getSystemLogSummary(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

router.get("/user-activity", ...reportGate("audit/user-activity"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getUserActivity(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

export default router;
