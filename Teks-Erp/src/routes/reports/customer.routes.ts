// =============================================================================
// TeksERP - Customer Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import type { ReportKey } from "../../constants/report-catalog";
import {
  getCustomerOrderProfiles,
} from "../../services/reports/customer.report.service";
import { getCustomerScorecard } from "../../services/reports/customer-scorecard.report.service";
import {
  splitOptions,
  compareRangeSchema,
  reportEnvelope,
  resolveCompareRange,
  resolveDateRange,
} from "../../services/reports/_shared";
import { filterEcho, kalemEkseni, musteriEkseni } from "../../services/reports/_filters";

const router = Router();
/**
 * Kimlik → RAPOR KAPISI → izin. Sıra load-bearing (K4): kimliksiz istek 401 almalı
 * (kapalı raporun varlığı anonim çağırana sızmaz), rapor kapısı ise izin reddinden
 * ÖNCE koşar ki kapalı bir rapor "yetkin yok" değil "kapalı" desin.
 */
const reportGate = (key: ReportKey) => [verifyToken, requireReportOpen(key), requirePermission("report:customer")];

// R5b-c süzgeç eksenleri — şemalar bekçi için DIŞA AÇIK; `.strict()`.
export const customerScorecardQuerySchema = compareRangeSchema.extend({ ...musteriEkseni, itemId: kalemEkseni.itemId }).strict();
export const orderProfileQuerySchema = z.object({ ...musteriEkseni }).strict();
const MUSTERI_ANAHTARLARI = ["customerId", "destination", "itemId"] as const;

/**
 * @openapi
 * /api/reports/customer/order-profile:
 *   get:
 *     tags: [Reports]
 *     summary: Müşteri sipariş profili — müşteri başına sipariş/kalem sayısı, en sık kumaş/renk/en, son sipariş (tüm zamanlar, en çok 200 satır)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50)" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Müşterinin VARSAYILAN hedefi (Customer.defaultDestination) — sevkin fiili hedefi değil" }
 *     responses:
 *       200: { description: "Profil satırları (süzgeçliyse kökte suzgec; meta.secenekler müşteri seçici kaynağı ≤200, süzgeçten bağımsız — süzgeçli istek bir kez daha süzgeçsiz toplar)" }
 */
router.get("/order-profile", ...reportGate("customer/order-profile"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = orderProfileQuerySchema.parse(req.query);
    const { rows, secenekler } = await getCustomerOrderProfiles(input);
    const suzgec = filterEcho(input, MUSTERI_ANAHTARLARI);
    res.status(200).json({ success: true, data: rows, ...(suzgec ? { suzgec } : {}), meta: { secenekler } });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/customer/scorecard:
 *   get:
 *     tags: [Reports]
 *     summary: Müşteri Karnesi — ABC (Pareto) + RFM
 *     description: |
 *       En çok veren, en sık veren ve kaybolmakta olan müşteriyi tek ekranda
 *       gösterir.
 *
 *       İKİ ZAMAN KAPSAMI vardır ve bilinçlidir: ABC sıralaması ve dönem
 *       metrikleri seçili tarih aralığına aittir; "kaç gündür sessiz" ve
 *       "ortalama sipariş aralığı" ise TÜM GEÇMİŞTEN hesaplanır — aksi halde
 *       30 günlük pencerede herkes "sessiz" görünürdü.
 *
 *       Risk ölçüsü mutlak gün değil ORANDIR: geçen süre / o müşterinin kendi
 *       ortalama sipariş aralığı. Ritim en az 3 sipariş ister; daha az geçmişi
 *       olanlar risk listesine girmez ve sayıları ayrıca döner.
 *
 *       SIKLIK TEK SAYIYLA ÖLÇÜLMEZ. Fabrikada bazı siparişler kalem kalem,
 *       bazıları tek tek giriliyor; bu yüzden orderCount (belge adedi) giriş
 *       alışkanlığına duyarlıdır ve tek başına sıralama ölçütü DEĞİLDİR.
 *       Yanında lineCount (kaç ayrı mal), orderDayCount (kaç ayrı gün sipariş
 *       verdi) ve avgLinesPerOrder (iki alışkanlığı ayırt eden anahtar) döner.
 *       ABC sıralaması metraja dayanır, çünkü metraj alışkanlıktan bağımsızdır.
 *
 *       shippedQty, dönemde sevk edilen BRÜT metrajdır ve tek tanımdan gelir
 *       (reports/_shipped.ts); aynı siparişlere ait olmak zorunda değildir.
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
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri süzgeci (uuid; CSV ya da tekrarlı anahtar; en fazla 50) — ABC sınıfı süzülmüş evrende hesaplanır" }
 *       - { in: query, name: destination, schema: { type: string, enum: [DOMESTIC, EXPORT] }, description: "Müşterinin VARSAYILAN hedefi (Customer.defaultDestination) — sevkin fiili hedefi değil" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "Kumaş süzgeci (uuid; CSV) — dönem, ömür boyu ve sevk metrajı aynı koşulla" }
 *     responses:
 *       200:
 *         description: Müşteri karnesi (süzgeçliyse zarfta `suzgec`; `meta.secenekler` müşteri/kumaş seçici kaynağı, süzgeçten bağımsız — süzgeçli istek dönem toplayıcısını bir kez daha süzgeçsiz koşar)
 */
router.get("/scorecard", ...reportGate("customer/scorecard"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = customerScorecardQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const { data, secenekler } = splitOptions(await getCustomerScorecard(range, compareRange, input));
    res.status(200).json(reportEnvelope(data, range, compareRange, { suzgec: filterEcho(input, MUSTERI_ANAHTARLARI), secenekler }));
  } catch (e) {
    next(e);
  }
});

export default router;
