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
import { buildYarnNeedSunumu, yarnReservationWarnings } from "../../services/reports/yarn-need.sunum";
import { requireFinanceEnabled } from "../../middlewares/finance.middleware";
import { reportEnvelope } from "../../services/reports/_shared";
import { coreDayRangeQuerySchema, resolveCoreDayRange } from "../../services/reports/temel/_day-range";
import { PROFIT_BREAKDOWNS, PROFIT_SCOPES, PROFITABILITY_KEY } from "../../services/reports/profitability.sunum";
import { PRODUCT_BREAKDOWNS } from "../../services/reports/profitability-product.sunum";
import { profitabilityScopedReport } from "../../services/reports/profitability.report";
import { REPORT_BY_KEY } from "../../constants/report-catalog";
import { AppError } from "../../utils/app-error";
import { buildWeavingEfficiencySunumu, weavingEfficiencyReport } from "../../services/reports/weaving-efficiency.report";

const router = Router();
router.use(verifyToken, requireMaliyetEnabled);

const evetHayir = z.enum(["1", "0"], { message: "Değer yalnız 1 ya da 0 olabilir" }).optional();
/** Tanınmayan anahtar 400 (fail-closed); bekçi şemayı HTTP'siz ölçer. */
export const yarnNeedQuerySchema = z.object({
  netle: evetHayir,
  leventDus: evetHayir,
  deverecideDus: evetHayir,
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
 *       - { in: query, name: deverecideDus, schema: { type: string, enum: ["1", "0"] }, description: "0 (varsayılan) = deverecideki iplik yalnız gösterilir; 1 = fabrika malı payı eksikten düşülür (devere + iplik açıkken)" }
 *       - { in: query, name: musteriId, schema: { type: string, format: uuid } }
 *       - { in: query, name: urunId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "v2 sunum zarfı (data.tablo · anaSayi · uyarilar) + data.detay (satirlar[iplik, cozguKg, atkiKg, ihtiyacKg, serbestStokKg, emanetKg, acikAlisKg, eksikKg, eksikBelirsiz] · ozet · meta[yapisiEksik, olculemeyen, leventler, kaynaklar, hesapZamani]); ayar dokuma.yarnReservationEnabled açıkken satır ayrilanKg/serbestKg, ozet.ayrilanKg, meta.ayirma ve gövdede warnings; devere + iplik açıkken satır/özet deverecideKg (emanet açıkken satır deverecideEmanetKg), meta.kaynaklar.deverecide, meta.deverecideDus" }
 *       400: { description: Tanınmayan ya da geçersiz parametre }
 *       403: { description: Maliyet modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/iplik-ihtiyaci", requireReportOpen("maliyet/iplik-ihtiyaci"), requirePermission("report:yarn-need"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = yarnNeedQuerySchema.parse(req.query);
    const opts = { netle: q.netle !== "0", leventDus: q.leventDus !== "0", deverecideDus: q.deverecideDus === "1", musteriId: q.musteriId, urunId: q.urunId };
    const detay = await yarnNeedReport(opts);
    const warnings = yarnReservationWarnings(detay);
    res.status(200).json({ success: true, data: { ...buildYarnNeedSunumu(detay, opts), detay }, ...(warnings.length ? { warnings } : {}) });
  } catch (e) {
    next(e);
  }
});

/** SY-D3: gün aralığı (fabrika günü); kıyas kabul edilir ama uygulanmaz (satır = iş, dönem yalnız iş kümesini seçer). */
export const weavingEfficiencyQuerySchema = coreDayRangeQuerySchema.strict();

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

/** Kârlılık sorgusu — gün aralığı + kıyas + kapsam + kırılım; tanınmayan anahtar/değer 400 (kapsam ↔ kırılım uyumu koşucuda). */
export const profitabilityQuerySchema = coreDayRangeQuerySchema.extend({
  kapsam: z.enum(PROFIT_SCOPES, { message: "Tanınmayan kapsam (hizmet ya da kumas)" }).optional(),
  kirilim: z.enum([...PROFIT_BREAKDOWNS, ...PRODUCT_BREAKDOWNS.filter((b) => !(PROFIT_BREAKDOWNS as readonly string[]).includes(b))] as [string, ...string[]], { message: "Tanınmayan kırılım" }).optional(),
}).strict();

/** Kumaş kapsamı dokuma modülünün yüzeyidir: yalnız `kapsam=kumas` isteğinde dokuma kapısı (kapalı → 403 MODULE_DISABLED). */
function requireDokumaForFabricScope(req: Request, res: Response, next: NextFunction): void {
  if (req.query.kapsam === "kumas") void requireDokumaEnabled(req, res, next);
  else next();
}

/**
 * @openapi
 * /api/reports/maliyet/karlilik:
 *   get:
 *     tags: [Reports]
 *     summary: Kârlılık — hizmet işlerinin kesinleşen geliri, ipe/makineye/dışarıya giden, kalan (katkı) ve net (RaporSunumu)
 *     description: >
 *       Tek kaynak `profitability.helper` (sonuç saklanmaz, kârlılık ayarları okuma anında uygulanır; özeti
 *       `parametreler[hesap]`). Dönem TAM AYLARLA hesaplanır (gün aralığının ayları). Eksik girdili iş 0 yazılmaz,
 *       boş + "eksik" rozeti. Modül: maliyet ∧ ön muhasebe; izin `cost:read` + `report:finance`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] } }
 *       - { in: query, name: kapsam, schema: { type: string, enum: [hizmet, kumas] }, description: "Yoksa ayar maliyet.karlilik.varsayilanKapsam (HIZMET; KUMAS yalnız dokuma açıkken)" }
 *       - { in: query, name: kirilim, schema: { type: string, enum: [musteri, islem, makine, ay, is, desen] }, description: "hizmet: musteri|islem|makine|ay|is · kumas: desen|musteri|ay|is" }
 *     responses:
 *       200: { description: "RaporSunumu (tablo = seçili kapsam ve kırılım; toplam tam kümeden)" }
 *       400: { description: Tanınmayan ya da geçersiz parametre; kapsama ait olmayan kırılım (PROFIT_BREAKDOWN_SCOPE) }
 *       403: { description: Maliyet ya da ön muhasebe kapalı, kumaş kapsamında dokuma kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 *       409: { description: Modül istek sırasında kapandı (PROFITABILITY_MODULE_CHANGED) }
 */
router.get("/karlilik", requireFinanceEnabled, requireDokumaForFabricScope, requireReportOpen("maliyet/karlilik"), requirePermission("cost:read"), requirePermission("report:finance"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = profitabilityQuerySchema.parse(req.query);
      const window = resolveCoreDayRange(q, REPORT_BY_KEY.get(PROFITABILITY_KEY)?.varsayilanGun ?? 90);
      const sunum = await profitabilityScopedReport(window, { kapsam: q.kapsam, kirilim: q.kirilim });
      // Kapılar (lisans tavanlı) yukarıda reddeder; null yalnız istek sırasında modül kapanınca — ikinci MODULE_DISABLED sitesi açılmaz.
      if (!sunum) throw AppError.conflict("Maliyet ya da ön muhasebe modülü istek sırasında kapandı; sayfayı yenileyin", { code: "PROFITABILITY_MODULE_CHANGED" });
      res.status(200).json(reportEnvelope(sunum, window.range, window.compareRange, { warnings: sunum.uyarilar }));
    } catch (e) {
      next(e);
    }
  });

export default router;
