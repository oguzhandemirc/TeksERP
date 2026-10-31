// =============================================================================
// /api/reports/maliyet/* — maliyet modülünün raporları (MAL-7: İplik İhtiyaç Planı)
// =============================================================================
// Rejim kapısı `requireMaliyetEnabled` bu router'da (yapı ve motor maliyet modülündedir; kapalı → 403
// MODULE_DISABLED). Para yok → `cost:read` istemez; izin `report:yarn-need`. Stok/alış/levent
// modülleri kapalıysa uç yine çalışır, değerleri `null`dır (köprü; `test_iplik_ihtiyaci`).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import { requireDokumaEnabled, requireMaliyetEnabled } from "../../middlewares/module.middleware";
import { yarnNeedReport } from "../../services/reports/yarn-need.report.service";
import { buildYarnNeedSunumu } from "../../services/reports/yarn-need.sunum";
import { buildWeavingEfficiencySunumu, weavingEfficiencyReport } from "../../services/reports/weaving-efficiency.report";
import { coreDayRangeQuerySchema, resolveCoreDayRange } from "../../services/reports/temel/_day-range";
import { reportEnvelope } from "../../services/reports/_shared";

const router = Router();
router.use(verifyToken, requireMaliyetEnabled);

const evetHayir = z.enum(["1", "0"], { message: "Değer yalnız 1 ya da 0 olabilir" }).optional();
/** Tanınmayan anahtar 400 (fail-closed); bekçi şemayı HTTP'siz ölçer. */
export const yarnNeedQuerySchema = z.object({
  netle: evetHayir,
  leventDus: evetHayir,
  musteriId: z.string().uuid("Geçersiz müşteri").optional(),
  urunId: z.string().uuid("Geçersiz ürün").optional(),
}).strict();

/**
 * @openapi
 * /api/reports/maliyet/iplik-ihtiyaci:
 *   get:
 *     tags: [Reports]
 *     summary: İplik ihtiyaç planı — açık siparişler → ürün yapısı → iplik kg (çözgü/atkı ayrı) − serbest stok − açık alış − hazır levent = eksik; kapalı modülün değeri null ("bilinmiyor")
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: netle, schema: { type: string, enum: ["1", "0"] }, description: "1 (varsayılan) = depo ve üretimdeki kumaş düşülür" }
 *       - { in: query, name: leventDus, schema: { type: string, enum: ["1", "0"] }, description: "1 (varsayılan) = devere açıksa hazır leventlerin kalanı çözgüden düşülür" }
 *       - { in: query, name: musteriId, schema: { type: string, format: uuid } }
 *       - { in: query, name: urunId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "v2 sunum zarfı (data.tablo · anaSayi · uyarilar) + data.detay (satirlar[iplik, cozguKg, atkiKg, ihtiyacKg, serbestStokKg, emanetKg, acikAlisKg, eksikKg, eksikBelirsiz] · ozet · meta[yapisiEksik, olculemeyen, leventler, kaynaklar, hesapZamani])" }
 *       400: { description: Tanınmayan ya da geçersiz parametre }
 *       403: { description: Maliyet modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/iplik-ihtiyaci", requireReportOpen("maliyet/iplik-ihtiyaci"), requirePermission("report:yarn-need"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = yarnNeedQuerySchema.parse(req.query);
    const opts = { netle: q.netle !== "0", leventDus: q.leventDus !== "0", musteriId: q.musteriId, urunId: q.urunId };
    const detay = await yarnNeedReport(opts);
    res.status(200).json({ success: true, data: { ...buildYarnNeedSunumu(detay, opts), detay } });
  } catch (e) {
    next(e);
  }
});

/** SY-D3: gün aralığı (fabrika günü); kıyas kabul edilir ama uygulanmaz (satır = iş, dönem yalnız iş kümesini seçer). */
export const weavingEfficiencyQuerySchema = coreDayRangeQuerySchema;

/**
 * @openapi
 * /api/reports/maliyet/dokuma-verimlilik:
 *   get:
 *     tags: [Reports]
 *     summary: Dokuma maliyet verimliliği — iş başına standart vs gerçek dokuma /m (koşum tezgâh saati × saat ücreti ÷ canlı top metresi), teorik/gerçek m/saat, duruş payı; kur/ücret/koşum yoksa "eksik" (0 değil)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "v2 sunum zarfı + data.detay (currency, fxRate, rows, runlessMeters)" }
 *       400: { description: Tanınmayan ya da geçersiz parametre }
 *       403: { description: Maliyet ya da dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/dokuma-verimlilik", requireDokumaEnabled, requireReportOpen("maliyet/dokuma-verimlilik"), requirePermission("cost:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = weavingEfficiencyQuerySchema.parse(req.query);
    const window = resolveCoreDayRange(q, 30);
    const detay = await weavingEfficiencyReport(window.range);
    const sunum = buildWeavingEfficiencySunumu(detay, window);
    res.status(200).json(reportEnvelope({ ...sunum, detay }, window.range, null, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

export default router;
