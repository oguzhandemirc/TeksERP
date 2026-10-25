// =============================================================================
// TeksERP — Raporlar v2 temel DOKUMA + ALACAK raporları (R0-RAPC)
// =============================================================================
// Dört uç `RaporSunumu` zarfı döner (`data`); sayılar mevcut rapor servislerinden okunur
// (`services/reports/temel/*`). Kök `reports.routes.ts`te ÖNEKSİZ mount edilir, yollar tam.
// Her uç kaynak raporunun modül kapısını AYNEN taşır: dokuma → `requireDokumaEnabled`, levent
// ayrıca `requireDevereEnabled` (levent devere tablosudur), alacaklar → `requireFinanceEnabled`.
// Zincir: kimlik (dosya başı) → modül → rapor kapısı → izin. İzin katalog satırının `izin`iyle birebir.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import { requireDevereEnabled, requireDokumaEnabled } from "../../middlewares/module.middleware";
import { requireFinanceEnabled } from "../../middlewares/finance.middleware";
import { REPORT_BY_KEY, type ReportKey } from "../../constants/report-catalog";
import { reportEnvelope } from "../../services/reports/_shared";
import { vardiyaEkseni } from "../../services/reports/_filters";
import { AppError } from "../../utils/app-error";
import { coreDayRangeQuerySchema, resolveCoreDayRange } from "../../services/reports/temel/_day-range";
import { buildLoomEfficiencyReport } from "../../services/reports/temel/tezgah-randimani.temel";
import { buildLoomStopsReport } from "../../services/reports/temel/duruslar.temel";
import { buildBeamBalanceReport } from "../../services/reports/temel/levent-dengesi.temel";
import { buildReceivablesReport } from "../../services/reports/temel/alacaklar.temel";

const router = Router();
// Kimlik dosya başında (R0-RAPA/RAPB kalıbı): kimliksiz istek 401, kapalı raporun varlığı sızmaz.
router.use(verifyToken);

/** Dört ucun izinleri — katalog satırının `izin`i (fail-closed: listede olmayan izin modül yüklenirken patlar). */
const CORE_WEAVING_FINANCE_PERMISSIONS = ["report:production", "report:finance"] as const;
export function permissionOf(key: ReportKey): string {
  const code = CORE_WEAVING_FINANCE_PERMISSIONS.find((p) => p === REPORT_BY_KEY.get(key)?.izin);
  if (!code) throw new Error(`Temel rapor izni tanımsız: ${key}`);
  return code;
}
/** RAPOR KAPISI → izin (sıra load-bearing: kapalı rapor "yetkin yok" değil "kapalı" der). */
const reportGate = (key: ReportKey) => [requireReportOpen(key), requirePermission(permissionOf(key))];

/** Katalog `varsayilanGun` — gün aralığı verilmezse uygulanan pencere (tek kaynak katalog). */
function defaultDaysOf(key: ReportKey): number {
  const days = REPORT_BY_KEY.get(key)?.varsayilanGun;
  if (!days) throw new Error(`Varsayılan gün tanımsız: ${key}`);
  return days;
}

// Şemalar bekçi için DIŞA AÇIK; her biri `.strict()` (tanınmayan anahtar 400).
export const coreLoomEfficiencyQuerySchema = coreDayRangeQuerySchema.strict();
export const coreLoomStopsQuerySchema = coreDayRangeQuerySchema.extend({ ...vardiyaEkseni }).strict();
export const coreBeamBalanceQuerySchema = coreDayRangeQuerySchema.strict();
export const coreReceivablesQuerySchema = z.object({ asOf: z.string().datetime({ offset: true }).optional() }).strict();

/**
 * @openapi
 * /api/reports/dokuma/tezgah-randimani:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Tezgahlar verimli mi? (RaporSunumu)
 *     description: |
 *       Randıman raporunun toplam randımanı (tek oran) ana sayı; yan sayılar Kapasite Kullanımı'ndan
 *       dokunan metre ve kapasitenin kumaşa dönen kısmı. Dokuma modülü kapalıysa 403 MODULE_DISABLED.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date }, description: "Fabrika günü (YYYY-MM-DD); to ile birlikte" }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL)" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/dokuma/tezgah-randimani", requireDokumaEnabled, ...reportGate("dokuma/tezgah-randimani"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const window = resolveCoreDayRange(coreLoomEfficiencyQuerySchema.parse(req.query), defaultDaysOf("dokuma/tezgah-randimani"));
    const { sunum } = await buildLoomEfficiencyReport({ window });
    res.status(200).json(reportEnvelope(sunum, window.range, window.compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/dokuma/duruslar:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Tezgahlar neden duruyor? (RaporSunumu)
 *     description: |
 *       Duruş Pareto'nun toplam duruş süresi (dakika) ana sayı; yan sayılar en sık sebep, duruş sayısı,
 *       ortalama müdahale süresi. Vardiya süzgeci iki kaynağa aynı vardiya tanımı kümesiyle gider.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] } }
 *       - { in: query, name: shiftDefinitionId, schema: { type: string }, description: "Vardiya tanımı (uuid; CSV ya da tekrarlı anahtar)" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 *       404: { description: Vardiya tanımı bulunamadı }
 */
router.get("/dokuma/duruslar", requireDokumaEnabled, ...reportGate("dokuma/duruslar"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreLoomStopsQuerySchema.parse(req.query);
    const window = resolveCoreDayRange(input, defaultDaysOf("dokuma/duruslar"));
    const { sunum } = await buildLoomStopsReport({ window, shiftDefinitionId: input.shiftDefinitionId });
    res.status(200).json(reportEnvelope(sunum, window.range, window.compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/dokuma/levent-dengesi:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Leventten beklenen kumaş çıktı mı? (RaporSunumu)
 *     description: |
 *       Levent Sonucu'ndan: biten leventlerde dokunan / beklenen kumaş (yalnız beklenen kumaşı bilinen
 *       leventler); fark metresi ve beklenen kumaşı bilinmeyen levent sayısı yan sayı. Dokuma ve devere ister.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] } }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Dokuma ya da devere modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/dokuma/levent-dengesi", requireDokumaEnabled, requireDevereEnabled, ...reportGate("dokuma/levent-dengesi"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const window = resolveCoreDayRange(coreBeamBalanceQuerySchema.parse(req.query), defaultDaysOf("dokuma/levent-dengesi"));
    const { sunum } = await buildBeamBalanceReport({ window });
    res.status(200).json(reportEnvelope(sunum, window.range, window.compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/finance/alacaklar:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Kimden ne alacağız? (RaporSunumu, kesit)
 *     description: |
 *       Cari Yaşlandırma'dan vadesi geçmiş alacak (TL bloğu; birimler toplanmaz) ana sayı; yan sayı
 *       30 gün içinde vadesi gelecek alınan çek. Ay sonu görüntüsü olmadığından kıyas ölçülemez.
 *       Ön muhasebe kapalıysa 403 MODULE_DISABLED.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: asOf, schema: { type: string, format: date-time }, description: "Kesit anı (verilmezse şimdi)" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Ön muhasebe kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/finance/alacaklar", requireFinanceEnabled, ...reportGate("finance/alacaklar"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreReceivablesQuerySchema.parse(req.query);
    const asOf = input.asOf ? new Date(input.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw AppError.badRequest("Geçersiz asOf tarihi");
    const { sunum } = await buildReceivablesReport(asOf);
    res.status(200).json(reportEnvelope(sunum, { from: asOf, to: asOf }, null, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

export default router;
