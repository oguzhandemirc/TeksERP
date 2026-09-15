// =============================================================================
// TeksERP - Sales Reports Routes
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
import { getReturnScorecard } from "../../services/reports/return-scorecard.report.service";
import { getShipmentScorecard } from "../../services/reports/shipment-scorecard.report.service";
import { getOpenOrderCoverage } from "../../services/reports/open-order-coverage.report.service";
import { getOrderIntake } from "../../services/reports/order-intake.report.service";
import { getDemandAnalysis } from "../../services/reports/demand-analysis.report.service";
import { getOrderLeadTime } from "../../services/reports/order-leadtime.report.service";
import { getOrderCancellationScorecard } from "../../services/reports/order-cancellation.report.service";
import { filterEcho, iptalEkseni, kalemEkseni, musteriEkseni } from "../../services/reports/_filters";

const router = Router();
/**
 * Kimlik → RAPOR KAPISI → izin. Sıra load-bearing (K4): kimliksiz istek 401 almalı
 * (kapalı raporun varlığı anonim çağırana sızmaz), rapor kapısı ise izin reddinden
 * ÖNCE koşar ki kapalı bir rapor "yetkin yok" değil "kapalı" desin.
 */
const reportGate = (key: ReportKey) => [verifyToken, requireReportOpen(key), requirePermission("report:sales")];

// R5b-c süzgeç eksenleri — şemalar bekçi için DIŞA AÇIK; her biri `.strict()` (tanınmayan anahtar 400).
export const orderIntakeQuerySchema = compareRangeSchema.extend({ ...musteriEkseni, itemId: kalemEkseni.itemId }).strict();
export const demandAnalysisQuerySchema = compareRangeSchema.extend({ ...musteriEkseni, ...kalemEkseni }).strict();
export const orderLeadTimeQuerySchema = dateRangeSchema.extend({ ...musteriEkseni, itemId: kalemEkseni.itemId }).strict();
export const orderCancellationQuerySchema = dateRangeSchema.extend({ ...musteriEkseni, ...iptalEkseni }).strict();
export const openOrderCoverageQuerySchema = z.object({ itemId: kalemEkseni.itemId }).strict();
const SIPARIS_ANAHTARLARI = ["customerId", "destination", "itemId", "colorId", "reasonCode"] as const;

/**
 * İADE KARNESİ — dönem karşılaştırmalı.
 * `report:sales` altında: payda sevkiyat, ana kırılım müşteri. Nedenler kalite
 * geri-beslemesidir ama raporu okuyan kişi sevkiyat/müşteri tarafındadır.
 */
/** SEVK & TERMİN KARNESİ (OTIF) — sevk hacmi + zamanında teslim oranı. */
router.get("/shipment-scorecard", ...reportGate("sales/shipment-scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getShipmentScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

router.get("/return-scorecard", ...reportGate("sales/return-scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getReturnScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/open-order-coverage:
 *   get:
 *     tags: [Reports]
 *     summary: Açık sipariş karşılanma (anlık)
 *     description: |
 *       Açık sipariş metrajının ne kadarı elde duran bitmiş maldan karşılanır,
 *       ne kadarı zaten üretimdeki mala düşer, ne kadarı için yeni iş emri
 *       gerekir.
 *
 *       ANLIK fotoğraftır — tarih aralığı ALMAZ. "Bugün neyi sevk edebilirim"
 *       sorusunun dönemle işi yoktur (Stok Karnesi ile aynı gerekçe). Zarf yine
 *       de standart `range` alanını taşır ki istemci sözleşmesi tek tip kalsın.
 *
 *       Hesap motoru Üretim Dengesi ekranıyla AYNIDIR
 *       (`production-balance.service`) — iki yüzey aynı rakamı söyler.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: itemId, schema: { type: string }, description: "Kumaş süzgeci (uuid; CSV ya da tekrarlı anahtar). Müşteri süzgeci BİLEREK yok — FIFO havuzu bozulurdu." }
 *     responses:
 *       200:
 *         description: Karşılanma özeti + müşteri/kumaş kırılımı + kalem listesi (süzgeçliyse zarfta `suzgec`)
 */
router.get("/open-order-coverage", ...reportGate("sales/open-order-coverage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = openOrderCoverageQuerySchema.parse(req.query);
    const data = await getOpenOrderCoverage(input);
    res.status(200).json(reportEnvelope(data, resolveDateRange({}), null, filterEcho(input, SIPARIS_ANAHTARLARI)));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/order-intake:
 *   get:
 *     tags: [Reports]
 *     summary: Sipariş Karnesi — dönemde alınan iş
 *     description: |
 *       Sipariş GİRİŞİNİ ölçer: kaç sipariş alındı, kaç metre istendi, ortalama
 *       sipariş büyüklüğü, iptal oranı, müşteri/kumaş kırılımı ve günlük seri.
 *
 *       Çıpa `Order.orderDate` (kaydın yazıldığı an değil, işin alındığı tarih).
 *
 *       İki payda bilinçli olarak farklıdır: ADET dönemde açılan tüm siparişleri
 *       sayar (sonradan iptal edilenler dahil), METRAJ iptalleri dışlar.
 *       Ortalama sipariş büyüklüğünün paydası iptalsiz sipariş adedidir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: compare
 *         schema: { type: string, enum: [none, prev, prevYear, custom] }
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Müşterinin VARSAYILAN hedefi (Customer.defaultDestination) — sevkin fiili hedefi değil" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "Kumaş süzgeci (uuid; CSV ya da tekrarlı anahtar)" }
 *     responses:
 *       200:
 *         description: Sipariş giriş karnesi (süzgeçliyse zarfta `suzgec`)
 */
router.get("/order-intake", ...reportGate("sales/order-intake"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = orderIntakeQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getOrderIntake(range, compareRange, input);
    res.status(200).json(reportEnvelope(data, range, compareRange, filterEcho(input, SIPARIS_ANAHTARLARI)));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/demand-analysis:
 *   get:
 *     tags: [Reports]
 *     summary: Talep Analizi — hangi kumaş-renk-en isteniyor
 *     description: |
 *       Talebi ÜÇLÜ SPEC düzeyinde (kumaş + renk + en) sıralar. Depodaki mal
 *       ancak birebir aynı spec'i karşıladığı için kumaş düzeyinde sıralamak
 *       yanlış rengi üretmeye yol açardı.
 *
 *       İKİ ZAMAN KAPSAMI: sıralama ve kırılımlar seçili tarih aralığına aittir;
 *       aylık mevsimsellik serisi ise SON 24 AYI okur (30 günlük pencerede
 *       mevsim yoktur).
 *
 *       "Müşteri Sipariş Profili" ile karıştırma: o tek müşterinin favorilerini,
 *       bu fabrika geneli talebi gösterir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: compare
 *         schema: { type: string, enum: [none, prev, prevYear, custom] }
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Müşterinin VARSAYILAN hedefi (Customer.defaultDestination) — sevkin fiili hedefi değil" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "Kumaş süzgeci (uuid; CSV ya da tekrarlı anahtar)" }
 *       - { in: query, name: colorId, schema: { type: string }, description: "Renk süzgeci (uuid; CSV ya da tekrarlı anahtar)" }
 *     responses:
 *       200:
 *         description: Talep analizi (süzgeçliyse zarfta `suzgec`)
 */
router.get("/demand-analysis", ...reportGate("sales/demand-analysis"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = demandAnalysisQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getDemandAnalysis(range, compareRange, input);
    res.status(200).json(reportEnvelope(data, range, compareRange, filterEcho(input, SIPARIS_ANAHTARLARI)));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/order-leadtime:
 *   get:
 *     tags: [Reports]
 *     summary: Sipariş → Teslim Süresi
 *     description: |
 *       "Kaç gün termin sözü verebilirim" sorusunu ölçer. Sevk & Termin Karnesi
 *       sözün TUTULUP tutulmadığını ölçer; bu rapor sözün NE OLMASI gerektiğini.
 *
 *       İki ayrı süre döner: ilk sevke kadar ("mal ne zaman çıkmaya başlar") ve
 *       tam kapanışa kadar ("ne zaman biter"). Kısmi sevkli siparişlerde ikisi
 *       çok farklıdır ve tek sayıya indirmek termini yanlışlar.
 *
 *       Ana rakam MEDYANDIR; ortalama tek bir felaket siparişle yukarı çekilir.
 *       P90 da döner (taahhüt için). Her seviyede `sampleSize` vardır ve
 *       `minSample` altında istemci sayı yerine uyarı basar — az örnekle
 *       hesaplanan medyan istatistik değil tesadüftür.
 *
 *       Çıpa `orderDate` (işin alındığı an), `createdAt` değil.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Müşterinin VARSAYILAN hedefi (Customer.defaultDestination) — sevkin fiili hedefi değil" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "Kumaş süzgeci (uuid; CSV ya da tekrarlı anahtar)" }
 *     responses:
 *       200:
 *         description: Teslim süresi istatistikleri (süzgeçliyse zarfta `suzgec`)
 */
router.get("/order-leadtime", ...reportGate("sales/order-leadtime"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = orderLeadTimeQuerySchema.parse(req.query);
    const range = resolveDateRange(input);
    const data = await getOrderLeadTime(range, input);
    res.status(200).json(reportEnvelope(data, range, null, filterEcho(input, SIPARIS_ANAHTARLARI)));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/sales/order-cancellation:
 *   get:
 *     tags: [Reports]
 *     summary: Sipariş İptal Karnesi — müşteriler neden vazgeçiyor
 *     description: |
 *       Çıpa `cancelledAt` (iptalin OLDUĞU an). Sipariş Karnesi'ndeki iptal
 *       oranı FARKLI bir soruyu cevaplar ("bu ay ALINAN siparişlerin kaçı
 *       sonradan iptal oldu"); iki rakam birbirini tutmak zorunda değildir.
 *
 *       Sebep kodu rapor anahtarıdır; sebebi girilmemiş ve serbest metinle
 *       girilmiş iptaller AYRI ve adlandırılmış kovalarda görünür (gizlenmez).
 *
 *       `cancelledAt` 2026-08-26'da eklendi — öncesindeki iptallerde NULL'dur ve
 *       dönem raporuna girmez; sayıları `undatedCancelCount` ile ayrıca döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Müşterinin VARSAYILAN hedefi (Customer.defaultDestination) — sevkin fiili hedefi değil" }
 *       - { in: query, name: reasonCode, schema: { type: string }, description: "İptal sebep kodu (ORDER_CANCEL kataloğu; CSV) — yalnız iptal satırlarına, payda süzülmez" }
 *     responses:
 *       200:
 *         description: İptal karnesi (süzgeçliyse zarfta `suzgec`)
 */
router.get("/order-cancellation", ...reportGate("sales/order-cancellation"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = orderCancellationQuerySchema.parse(req.query);
    const range = resolveDateRange(input);
    const data = await getOrderCancellationScorecard(range, input);
    res.status(200).json(reportEnvelope(data, range, null, filterEcho(input, SIPARIS_ANAHTARLARI)));
  } catch (e) {
    next(e);
  }
});

export default router;
