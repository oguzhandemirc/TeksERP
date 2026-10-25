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
import { runCoreWithExtras, variantQueryKeys } from "../../services/reports/temel/_variant";
import { LOOM_STOP_DIMS, dayWindowOf, loomStopsRunner } from "../../services/reports/temel/core-runs";
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
export const coreLoomEfficiencyQuerySchema = coreDayRangeQuerySchema.extend({ ...variantQueryKeys([]) }).strict();
export const coreLoomStopsQuerySchema = coreDayRangeQuerySchema.extend({ ...vardiyaEkseni, ...variantQueryKeys(LOOM_STOP_DIMS) }).strict();
export const coreBeamBalanceQuerySchema = coreDayRangeQuerySchema.extend({ ...variantQueryKeys([]) }).strict();
export const coreReceivablesQuerySchema = z.object({ asOf: z.string().datetime({ offset: true }).optional(), ...variantQueryKeys([]) }).strict();

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
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/dokuma/tezgah-randimani", requireDokumaEnabled, ...reportGate("dokuma/tezgah-randimani"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreLoomEfficiencyQuerySchema.parse(req.query);
    const window = resolveCoreDayRange(input, defaultDaysOf("dokuma/tezgah-randimani"));
    const { sunum } = await runCoreWithExtras({
      range: window.range, compareRange: window.compareRange, dims: [], donemler: input.donemler,
      run: (r, c) => buildLoomEfficiencyReport({ window: r === window.range ? window : dayWindowOf(r, c, window.mode) }),
    });
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
 *       - { in: query, name: varyant, schema: { type: string, enum: [vardiya] }, description: "Küçük çoklu kırılımı — en büyük ≤ 6 değer, her hücre ucun kendi süzgeciyle süzülmüş ana koşu (R1-VARYANT)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 *       404: { description: Vardiya tanımı bulunamadı }
 */
router.get("/dokuma/duruslar", requireDokumaEnabled, ...reportGate("dokuma/duruslar"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreLoomStopsQuerySchema.parse(req.query);
    const window = resolveCoreDayRange(input, defaultDaysOf("dokuma/duruslar"));
    const { sunum } = await runCoreWithExtras({
      range: window.range, compareRange: window.compareRange, dims: LOOM_STOP_DIMS, varyant: input.varyant, donemler: input.donemler,
      run: loomStopsRunner(input.shiftDefinitionId, window.mode),
    });
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
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Dokuma ya da devere modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/dokuma/levent-dengesi", requireDokumaEnabled, requireDevereEnabled, ...reportGate("dokuma/levent-dengesi"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreBeamBalanceQuerySchema.parse(req.query);
    const window = resolveCoreDayRange(input, defaultDaysOf("dokuma/levent-dengesi"));
    const { sunum } = await runCoreWithExtras({
      range: window.range, compareRange: window.compareRange, dims: [], donemler: input.donemler,
      run: (r, c) => buildBeamBalanceReport({ window: r === window.range ? window : dayWindowOf(r, c, window.mode) }),
    });
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
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Ön muhasebe kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/finance/alacaklar", requireFinanceEnabled, ...reportGate("finance/alacaklar"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreReceivablesQuerySchema.parse(req.query);
    const asOf = input.asOf ? new Date(input.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw AppError.badRequest("Geçersiz asOf tarihi");
    // Alacak yürüyen bakiyedir: geçmiş kesit `asOf` ile ölçülür → dönem sütunu = dönem SONUNDAKİ bakiye.
    const { sunum } = await runCoreWithExtras({ range: { from: asOf, to: asOf }, compareRange: null, dims: [], donemler: input.donemler, run: (r) => buildReceivablesReport(r.to) });
    res.status(200).json(reportEnvelope(sunum, { from: asOf, to: asOf }, null, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

export default router;
