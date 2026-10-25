// =============================================================================
// TeksERP — Raporlar v2 temel SATIŞ raporları (R0-RAPA)
// =============================================================================
// Beş uç `RaporSunumu` zarfı döner (`data`); sayılar mevcut rapor servislerinden okunur
// (`services/reports/temel/*`). Kök `reports.routes.ts`te ÖNEKSİZ mount edilir, yollar tam.
// Süzgeç kümesi her uçta KAYNAK ucun şemasıyla aynıdır (eşitlik bekçisi aynı parametreyle ölçer).
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import type { ReportKey } from "../../constants/report-catalog";
import { reportEnvelope, resolveDateRange } from "../../services/reports/_shared";
import { coreRangeQuerySchema, resolveCoreCompare } from "../../services/reports/temel/_common";
import { kalemEkseni, musteriEkseni } from "../../services/reports/_filters";
import { buildLostWorkReport } from "../../services/reports/temel/vazgecilen-is.temel";
import { runCoreWithExtras, variantQueryKeys } from "../../services/reports/temel/_variant";
import {
  DEADLINE_DIMS, OPEN_ORDER_DIMS, ORDER_DEMAND_DIMS, SHIPPED_DIMS,
  deadlineRunner, openOrderRunner, orderDemandRunner, shippedRunner,
} from "../../services/reports/temel/core-runs";

const router = Router();
// Kimlik dosya başında (BE-30): kimliksiz istek 401 alır, kapalı raporun varlığı anonim çağırana sızmaz.
router.use(verifyToken);
/** RAPOR KAPISI → izin (sıra load-bearing: kapalı rapor "yetkin yok" değil "kapalı" der). */
const reportGate = (key: ReportKey) => [requireReportOpen(key), requirePermission("report:sales")];

// Şemalar bekçi için DIŞA AÇIK; her biri `.strict()` (tanınmayan anahtar 400).
// `varyant` yalnız ucun beyanlı boyutlarından (dışı 400), `donemler` "ay:6" biçimi (R1-VARYANT).
export const coreOrderDemandQuerySchema = coreRangeQuerySchema.extend({ ...musteriEkseni, itemId: kalemEkseni.itemId, ...variantQueryKeys(ORDER_DEMAND_DIMS) }).strict();
export const coreShippedQuerySchema = coreRangeQuerySchema.extend({ destination: musteriEkseni.destination, ...variantQueryKeys(SHIPPED_DIMS) }).strict();
export const coreDeadlineQuerySchema = coreRangeQuerySchema.extend({ destination: musteriEkseni.destination, ...variantQueryKeys(DEADLINE_DIMS) }).strict();
export const coreOpenOrderQuerySchema = z.object({ itemId: kalemEkseni.itemId, ...variantQueryKeys(OPEN_ORDER_DIMS) }).strict();
export const coreLostWorkQuerySchema = coreRangeQuerySchema.extend({ ...variantQueryKeys([]) }).strict();

/**
 * @openapi
 * /api/reports/sales/siparis-talep:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Ne kadar iş aldık? (RaporSunumu)
 *     description: |
 *       Sipariş Karnesi'nin sayılarıyla (aynı parametre) kurulan sunum zarfı: ana sayı alınan
 *       sipariş metresi (iptaller hariç), yan sayılar sipariş adedi, müşteri sayısı, tutar
 *       (tek para birimiyse; fiyatsız satır sayılmaz). Grafik günlük sipariş metresi (fabrika günü).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Siparişin yönü (Sipariş Karnesi ile aynı)" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "Kumaş süzgeci (uuid; CSV ya da tekrarlı anahtar)" }
 *       - { in: query, name: varyant, schema: { type: string, enum: [musteri, urun, yon] }, description: "Küçük çoklu kırılımı — en büyük ≤ 6 değer, her hücre ucun kendi süzgeciyle süzülmüş ana koşu (R1-VARYANT)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data) + süzgeç beyanı" }
 */
router.get("/sales/siparis-talep", ...reportGate("sales/siparis-talep"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreOrderDemandQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode: compareMode, compareRange } = resolveCoreCompare(input, range);
    const { sunum, suzgec } = await runCoreWithExtras({
      range, compareRange, dims: ORDER_DEMAND_DIMS, varyant: input.varyant, donemler: input.donemler,
      run: orderDemandRunner({ customerId: input.customerId, destination: input.destination, itemId: input.itemId }, compareMode),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { suzgec, warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/sevkiyat:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Ne sevk ettik? (RaporSunumu)
 *     description: |
 *       Ana sayı BRÜT sevk metresi (`_shipped`; iade düşülmez, ayrı belgedir). Yan sayılar sevk
 *       tutarı (`report:sales` — Yurtiçi/Yurtdışı raporuyla aynı izin), top sayısı, ihracat payı
 *       (yön süzgeci yoksa). Grafik müşteri × yön yığın çubuğu (ilk 10 + Diğer).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Sevkiyatın donmuş yönü" }
 *       - { in: query, name: varyant, schema: { type: string, enum: [yon] }, description: "Küçük çoklu kırılımı — en büyük ≤ 6 değer, her hücre ucun kendi süzgeciyle süzülmüş ana koşu (R1-VARYANT)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data) + süzgeç beyanı" }
 */
router.get("/sales/sevkiyat", ...reportGate("sales/sevkiyat"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreShippedQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode: compareMode, compareRange } = resolveCoreCompare(input, range);
    const { sunum, suzgec } = await runCoreWithExtras({
      range, compareRange, dims: SHIPPED_DIMS, varyant: input.varyant, donemler: input.donemler, run: shippedRunner(input.destination, compareMode),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { suzgec, warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/termin:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Sözümüzü tuttuk mu? (RaporSunumu)
 *     description: |
 *       Ana sayı zamanında teslim yüzdesi (Sevk & Termin Karnesi); terminsiz sipariş paydaya
 *       girmez, sayısı anlatıda. Termini olan tamamlanmış sipariş yoksa ana sayı `null` +
 *       `olculemedi`. Yan sayılar geç kalan sipariş ve teslim süreleri (Sipariş → Teslim Süresi).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Yön (Sevk & Termin Karnesi ile aynı)" }
 *       - { in: query, name: varyant, schema: { type: string, enum: [yon] }, description: "Küçük çoklu kırılımı — en büyük ≤ 6 değer, her hücre ucun kendi süzgeciyle süzülmüş ana koşu (R1-VARYANT)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data) + süzgeç beyanı" }
 */
router.get("/sales/termin", ...reportGate("sales/termin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreDeadlineQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode: compareMode, compareRange } = resolveCoreCompare(input, range);
    const { sunum, suzgec } = await runCoreWithExtras({
      range, compareRange, dims: DEADLINE_DIMS, varyant: input.varyant, donemler: input.donemler, run: deadlineRunner(input.destination, compareMode),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { suzgec, warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/acik-siparisler:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Açık siparişler hazır mı? (RaporSunumu, anlık)
 *     description: |
 *       ANLIK kesit, tarih ve kıyas almaz (Açık Sipariş Karşılanma ile aynı motor). Ana sayı
 *       açık metrenin depodan karşılanan payı; açık sipariş yoksa `null` + `olculemedi`.
 *       Müşteri süzgeci bilerek yok (FIFO havuzu).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: itemId, schema: { type: string }, description: "Kumaş süzgeci (uuid; CSV ya da tekrarlı anahtar)" }
 *       - { in: query, name: varyant, schema: { type: string, enum: [urun] }, description: "Küçük çoklu kırılımı — en büyük ≤ 6 değer, her hücre ucun kendi süzgeciyle süzülmüş ana koşu (R1-VARYANT)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data) + süzgeç beyanı" }
 */
router.get("/sales/acik-siparisler", ...reportGate("sales/acik-siparisler"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreOpenOrderQuerySchema.parse(req.query);
    const range = resolveDateRange({});
    const { sunum, suzgec } = await runCoreWithExtras({
      range, compareRange: null, dims: OPEN_ORDER_DIMS, varyant: input.varyant, donemler: input.donemler, snapshotOnly: true, run: openOrderRunner(input.itemId),
    });
    res.status(200).json(reportEnvelope(sunum, range, null, { suzgec, warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/vazgecilen-is:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Ne geri geldi, neden vazgeçildi? (RaporSunumu)
 *     description: |
 *       İade (İade Karnesi) ve sipariş iptali (Sipariş İptal Karnesi; çıpa iptal anı) İKİ ayrı
 *       satır; ana sayı ikisinin metre toplamı. İptal oranı tek tanımdan (`cancelRatePct`).
 *       Süzgeç yok: iki kaynağın yön anlamı farklı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 */
router.get("/sales/vazgecilen-is", ...reportGate("sales/vazgecilen-is"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreLostWorkQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode: compareMode, compareRange } = resolveCoreCompare(input, range);
    const { sunum } = await runCoreWithExtras({
      range, compareRange, dims: [], donemler: input.donemler,
      run: (r, c) => buildLostWorkReport({ range: r, compareRange: c, compareMode }),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

export default router;
