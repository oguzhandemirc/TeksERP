// =============================================================================
// TeksERP - Quality Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  compareRangeSchema,
  dateRangeSchema,
  reportEnvelope,
  resolveCompareRange,
  resolveDateRange,
} from "../../services/reports/_shared";
import { getQualityScorecard } from "../../services/reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../../services/reports/scrap-scorecard.report.service";

const router = Router();
const guard = [verifyToken, requirePermission("report:quality")];

/**
 * KALİTE KARNESİ — dönem karşılaştırmalı.
 *
 * `compare=prev|prevYear|custom` verilmezse karşılaştırma sorgusu HİÇ koşmaz
 * (karşılaştırma istemeyen ekran maliyetini ödemesin). `compareRangeSchema`
 * `.strict()` olduğu için yanlış yazılmış bir parametre sessizce yok sayılmaz,
 * 400 döner — sessiz "karşılaştırma çalışmıyor" şikâyetinin önü kapalı.
 */
router.get("/scorecard", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getQualityScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

/**
 * FİRE KARNESİ — Kalite Karnesi'nin ikizi, aynı evren ve aynı çıpa.
 * İkisinin `producedQty`'si birebir aynı olmak zorunda (bekçi: test_scrap_scorecard).
 */
router.get("/scrap-scorecard", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getScrapScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

export default router;
