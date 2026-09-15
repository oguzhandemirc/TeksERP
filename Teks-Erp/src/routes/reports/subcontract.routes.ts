// =============================================================================
// TeksERP - Subcontract Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import type { ReportKey } from "../../constants/report-catalog";
import {
  splitOptions,
  compareRangeSchema,
  reportEnvelope,
  resolveCompareRange,
  resolveDateRange,
} from "../../services/reports/_shared";
import { getSubcontractScorecard } from "../../services/reports/subcontract-scorecard.report.service";
import { fasonEkseni, filterEcho, kalemEkseni } from "../../services/reports/_filters";

const router = Router();
/**
 * Kimlik → RAPOR KAPISI → izin. Sıra load-bearing (K4): kimliksiz istek 401 almalı
 * (kapalı raporun varlığı anonim çağırana sızmaz), rapor kapısı ise izin reddinden
 * ÖNCE koşar ki kapalı bir rapor "yetkin yok" değil "kapalı" desin.
 */
const reportGate = (key: ReportKey) => [verifyToken, requireReportOpen(key), requirePermission("report:subcontract")];

// R5b-c: fasoncu + topun kumaşı/rengi; işlem türü ekseni BİLEREK yok (sevkte kolon yok, 2 hop — aday). Bekçi için dışa açık.
export const subcontractScorecardQuerySchema = compareRangeSchema.extend({ ...fasonEkseni, ...kalemEkseni }).strict();
const FASON_ANAHTARLARI = ["subcontractorId", "itemId", "colorId"] as const;

/**
 * @openapi
 * /api/reports/subcontract/scorecard:
 *   get:
 *     tags: [Reports]
 *     summary: Fason karnesi — fire (giden ↔ dönen metraj), süre, açık bakiye; dönem karşılaştırmalı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: compare, schema: { type: string, enum: [none, prev, prevYear, custom] } }
 *       - { in: query, name: subcontractorId, schema: { type: string }, description: "Fasoncu süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50) — açık bakiye listesi de süzülür" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "Topun kumaşı (uuid; CSV)" }
 *       - { in: query, name: colorId, schema: { type: string }, description: "Topun rengi (uuid; CSV)" }
 *     responses:
 *       200: { description: "Fason karnesi (süzgeçliyse zarfta suzgec (+dusenSatir); meta.secenekler fasoncu/kumaş/renk seçici kaynağı ≤200, süzgeçten bağımsız — süzgeçli istek kalem sorgusunu bir kez daha süzgeçsiz koşar)" }
 */
router.get("/scorecard", ...reportGate("subcontract/scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = subcontractScorecardQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const { data, secenekler, dusenSatir } = splitOptions(await getSubcontractScorecard(range, compareRange, input));
    res.status(200).json(reportEnvelope(data, range, compareRange, { suzgec: filterEcho(input, FASON_ANAHTARLARI, dusenSatir), secenekler }));
  } catch (e) {
    next(e);
  }
});

export default router;
