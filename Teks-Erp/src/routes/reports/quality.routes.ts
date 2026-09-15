// =============================================================================
// TeksERP - Quality Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
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
import { getQualityScorecard } from "../../services/reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../../services/reports/scrap-scorecard.report.service";
import { getPlanDeviationScorecard } from "../../services/reports/plan-deviation-scorecard.report.service";
import { filterEcho } from "../../services/reports/_filters";

const router = Router();
/**
 * Kimlik → RAPOR KAPISI → izin. Sıra load-bearing (K4): kimliksiz istek 401 almalı
 * (kapalı raporun varlığı anonim çağırana sızmaz), rapor kapısı ise izin reddinden
 * ÖNCE koşar ki kapalı bir rapor "yetkin yok" değil "kapalı" desin.
 */
const reportGate = (key: ReportKey) => [verifyToken, requireReportOpen(key), requirePermission("report:quality")];

/** Kalite/fire karnesi sorgusu: karşılaştırma aralığı + LEVENT/LOT ekseni (R5b-b; top → CONSUMED.rollId, defterden). İkizler aynı şemayı paylaşır. */
const LEVENT_ANAHTARLARI = ["warpBeamId", "lotNo"] as const;
export const qualityQuerySchema = compareRangeSchema
  .extend({ warpBeamId: z.string().uuid("Geçersiz levent").optional(), lotNo: z.string().trim().min(1).max(64).optional() })
  .strict();

/**
 * KALİTE KARNESİ — dönem karşılaştırmalı.
 *
 * `compare=prev|prevYear|custom` verilmezse karşılaştırma sorgusu HİÇ koşmaz
 * (karşılaştırma istemeyen ekran maliyetini ödemesin). `compareRangeSchema`
 * `.strict()` olduğu için yanlış yazılmış bir parametre sessizce yok sayılmaz,
 * 400 döner — sessiz "karşılaştırma çalışmıyor" şikâyetinin önü kapalı.
 */
router.get("/scorecard", ...reportGate("quality/scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = qualityQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getQualityScorecard(range, compareRange, { warpBeamId: input.warpBeamId, lotNo: input.lotNo });
    res.status(200).json(reportEnvelope(data, range, compareRange, filterEcho(input, LEVENT_ANAHTARLARI)));
  } catch (e) {
    next(e);
  }
});

/**
 * FİRE KARNESİ — Kalite Karnesi'nin ikizi, aynı evren ve aynı çıpa.
 * İkisinin `producedQty`'si birebir aynı olmak zorunda (bekçi: test_scrap_scorecard).
 */
router.get("/scrap-scorecard", ...reportGate("quality/scrap-scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = qualityQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getScrapScorecard(range, compareRange, { warpBeamId: input.warpBeamId, lotNo: input.lotNo });
    res.status(200).json(reportEnvelope(data, range, compareRange, filterEcho(input, LEVENT_ANAHTARLARI)));
  } catch (e) {
    next(e);
  }
});

/**
 * PLAN-SAPMA KARNESİ (2026-08-19) — Tambur plan kapısında "yine de bitir" ile
 * onaylanan, yani plan dışı kimlikle depoya inen malın karnesi.
 *
 * ⚠️ Kaynağı `roll_plan_deviations` KALICI defteridir, audit DEĞİL: audit 6 ayda
 * arşive taşınır ve rapor katmanı arşivi okumaz (aynı ders `Roll.entryReason`
 * notunda yazılı). Yeni izin kodu YOK — `report:quality` kategorisi.
 */
router.get(
  "/plan-deviation-scorecard",
  ...reportGate("quality/plan-deviation-scorecard"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = compareRangeSchema.parse(req.query);
      const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
      const compareRange = resolveCompareRange(input, range);
      const data = await getPlanDeviationScorecard(range, compareRange);
      res.status(200).json(reportEnvelope(data, range, compareRange));
    } catch (e) {
      next(e);
    }
  },
);

export default router;
