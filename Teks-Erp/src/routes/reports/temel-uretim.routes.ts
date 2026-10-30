// =============================================================================
// TeksERP — Raporlar v2 temel ÜRETİM/KALİTE/DEPO/FASON raporları (R0-RAPB)
// =============================================================================
// Beş uç `RaporSunumu` zarfı döner (`data`); sayılar mevcut rapor servislerinden okunur
// (`services/reports/temel/*`). Kök `reports.routes.ts`te ÖNEKSİZ mount edilir, yollar tam.
// Zincir uç başına açık yazılır (izin domain'e göre değişir): kimlik → modül (katalog
// `modul`u rejim kapısıysa) → rapor kapısı → izin. İzin kodu katalog satırıyla birebir.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import { requireMachineStopRegime, requireProductionEnabled } from "../../middlewares/module.middleware";
import type { ReportKey } from "../../constants/report-catalog";
import { reportEnvelope, resolveDateRange } from "../../services/reports/_shared";
import { coreRangeQuerySchema, resolveCoreCompare } from "../../services/reports/temel/_common";
import { fasonEkseni, kalemEkseni, machineStopAxis } from "../../services/reports/_filters";
import { buildProductionFlowReport, PRODUCTION_FLOW_VIEWS } from "../../services/reports/temel/uretim-akisi.temel";
import { buildQualityReport, QUALITY_VIEWS } from "../../services/reports/temel/kalite.temel";
import { buildLossReport } from "../../services/reports/temel/kayip.temel";
import { buildWarehouseReport } from "../../services/reports/temel/depo.temel";
import { periodSpecSchema, runCoreWithExtras, variantQueryKeys } from "../../services/reports/temel/_variant";
import { MACHINE_STOP_DIMS, SUBCONTRACTOR_DIMS, dayWindowOf, subcontractorRunner } from "../../services/reports/temel/core-runs";
import { MACHINE_STOPS_KEY, machineStopsRunner } from "../../services/reports/temel/makine-duruslari.temel";
import { coreDayRangeQuerySchema, resolveCoreDayRange } from "../../services/reports/temel/_day-range";
import { REPORT_BY_KEY } from "../../constants/report-catalog";

const router = Router();
// Kimlik dosya başında (BE-30, R0-RAPA ile aynı kalıp): kimliksiz istek 401, kapalı raporun varlığı sızmaz.
router.use(verifyToken);
/** Beş ucun birincil alan izinleri (`report:<kategori>`); katalog `izin`iyle birebirliği `test_temel_rapor_esitlik` §R0z ölçer. */
const CORE_PRODUCTION_PERMISSIONS = ["report:production", "report:quality", "report:inventory", "report:subcontract"] as const;
// Fail-closed: listede olmayan kategori modül yüklenirken patlar (izinsiz uç doğmaz).
export function permissionOf(key: ReportKey): string {
  const code = CORE_PRODUCTION_PERMISSIONS.find((p) => p === `report:${key.split("/")[0]}`);
  if (!code) throw new Error(`Temel rapor izni tanımsız: ${key}`);
  return code;
}
/** RAPOR KAPISI → izin (sıra load-bearing: kapalı rapor "yetkin yok" değil "kapalı" der). */
const reportGate = (key: ReportKey) => [requireReportOpen(key), requirePermission(permissionOf(key))];

// Şemalar bekçi için DIŞA AÇIK; her biri `.strict()` (tanınmayan anahtar 400). Süzgeç kümesi kaynak ucunkiyle aynı.
// Üretim akışı ve kalitede `varyant` zaten GÖRÜNÜM seçimidir (tablo kırılımı, R0-RAPB) — küçük çoklu yok, yalnız `donemler` eklenir.
export const coreProductionFlowQuerySchema = coreRangeQuerySchema.extend({ varyant: z.enum(PRODUCTION_FLOW_VIEWS).optional(), donemler: periodSpecSchema.optional() }).strict();
export const coreQualityQuerySchema = coreRangeQuerySchema
  .extend({
    warpBeamId: z.string().uuid("Geçersiz levent").optional(),
    lotNo: z.string().trim().min(1).max(64).optional(),
    varyant: z.enum(QUALITY_VIEWS).optional(),
    donemler: periodSpecSchema.optional(),
  })
  .strict();
export const coreLossQuerySchema = coreRangeQuerySchema.extend({ ...variantQueryKeys([]) }).strict();
export const coreWarehouseQuerySchema = z.object({ ...variantQueryKeys([]) }).strict();
/** Makine duruşları (D4-A4): fabrika günü aralığı + makine · tür · sebep süzgeci + varyant/dönem. */
export const coreMachineStopsQuerySchema = coreDayRangeQuerySchema.extend({ ...machineStopAxis, ...variantQueryKeys(MACHINE_STOP_DIMS) }).strict();
export const coreSubcontractorsQuerySchema = coreRangeQuerySchema.extend({ ...fasonEkseni, ...kalemEkseni, ...variantQueryKeys(SUBCONTRACTOR_DIMS) }).strict();

/**
 * @openapi
 * /api/reports/production/uretim-akisi:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Üretim nerede takıldı? (RaporSunumu)
 *     description: |
 *       Nerede Takıldı karnesinin sayılarıyla kurulan sunum zarfı: ana sayı şu an istasyonlarda
 *       bekleyen top (kesit), yan sayılar dönemde geçen metre (kıyaslı), top ağırlıklı ortalama
 *       bekleme, en uzun kuyruk. `varyant=operator` tabloyu operatör iş kaydına çevirir; yanıt
 *       sunumunda `kisiAdi:true` döner (kişi adı taşır, buluta gitmez — K-KISI).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: varyant, schema: { type: string, enum: [istasyon, operator] } }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data); operatör görünümünde sunumda kisiAdi:true" }
 *       403: { description: Üretim modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/production/uretim-akisi", requireProductionEnabled, ...reportGate("production/uretim-akisi"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreProductionFlowQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode, compareRange } = resolveCoreCompare(input, range);
    const { sunum } = await runCoreWithExtras({
      range, compareRange, dims: [], donemler: input.donemler,
      run: (r, c) => buildProductionFlowReport({ range: r, compareRange: c, compareMode: mode, view: input.varyant }),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/quality/kalite:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Kalite nasıl gidiyor? (RaporSunumu)
 *     description: |
 *       Kalite Karnesi'nin sayılarıyla: ana sayı birinci kalite payı (METRE ağırlıklı; iptal ve
 *       tüketilmiş toplar dışında, hurda içinde), yan sayılar bin metrede hata, plan dışı onaylı
 *       metre, biten kumaş. Levent/lot süzgeci Kalite ve Fire Karnesi'ndekiyle aynıdır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: warpBeamId, schema: { type: string, format: uuid }, description: Levent }
 *       - { in: query, name: lotNo, schema: { type: string }, description: Lot }
 *       - { in: query, name: varyant, schema: { type: string, enum: [urun, renk, fasoncu] } }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data) + süzgeç beyanı" }
 *       403: { description: Üretim modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/quality/kalite", requireProductionEnabled, ...reportGate("quality/kalite"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreQualityQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode, compareRange } = resolveCoreCompare(input, range);
    const { sunum, suzgec } = await runCoreWithExtras({
      range, compareRange, dims: [], donemler: input.donemler,
      run: (r, c) => buildQualityReport({ range: r, compareRange: c, compareMode: mode, view: input.varyant, filters: { warpBeamId: input.warpBeamId, lotNo: input.lotNo } }),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { suzgec, warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/quality/kayip:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Ne kaybettik? Tek fire tanımı (RaporSunumu)
 *     description: |
 *       Fire = satılabilir olmaktan çıkan kumaş metresi; üç kaynak (hurda · fason farkı yalnız
 *       dönüşü tamamlanan kalemler · levent farkı yalnız biten levent) kendi karnelerinden okunur.
 *       Oran yalnız kaynak satırında kendi paydasıyla verilir; toplam fire oranı verilmez.
 *       Dokuma/devere kapalıysa levent satırı "kapalı" notuyla çıkar (0 basılmaz).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       403: { description: Üretim modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/quality/kayip", requireProductionEnabled, ...reportGate("quality/kayip"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreLossQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode, compareRange } = resolveCoreCompare(input, range);
    const { sunum } = await runCoreWithExtras({
      range, compareRange, dims: [], donemler: input.donemler,
      run: (r, c) => buildLossReport({ range: r, compareRange: c, compareMode: mode }),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/inventory/depo:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Depoda ne yatıyor? (RaporSunumu, kesit)
 *     description: |
 *       Stok & Ölü Stok karnesinin sayılarıyla: ana sayı 90 günden eski ve siparişsiz bitmiş kumaş,
 *       yan sayılar depodaki bitmiş kumaş, 90 günden eski (siparişli dahil), yaşı bilinmeyen metre.
 *       Tarih parametresi YOK (bugünün durumu); ay sonu görüntüsü olmadığından kıyas ölçülemez.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas — kesit raporu: dönem değerleri ölçülemedi + uyarı (geçmiş kesit görüntüsü yok)" }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       400: { description: Tanınmayan parametre }
 */
router.get("/inventory/depo", ...reportGate("inventory/depo"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreWarehouseQuerySchema.parse(req.query);
    const range = resolveDateRange({});
    const { sunum } = await runCoreWithExtras({ range, compareRange: null, dims: [], donemler: input.donemler, snapshotOnly: true, run: () => buildWarehouseReport() });
    res.status(200).json(reportEnvelope(sunum, range, null, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/subcontract/fasoncular:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Fasoncular zamanında dönüyor mu? (RaporSunumu)
 *     description: |
 *       Fason Karnesi'nin sayılarıyla (aynı süzgeç). Ana sayı dönemde kapanan kalemlerin ortalama
 *       dönüş süresi (gün; söz verilen dönüş günü kaydedilmediği için "zamanında %" ölçülmez — K-FASON);
 *       yan sayılar fasonda bekleyen metre ve eksik dönen metre (fire tanımı "Ne kaybettik?" raporunda).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date-time } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date-time } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] }, description: "Verilmezse önceki dönem (K-KIYAS, K-TEL; uygulanan kip `parametreler[]` içinde `kiyas`)" }
 *       - { in: query, name: subcontractorId, schema: { type: string }, description: "Fasoncu (uuid; CSV ya da tekrarlı anahtar; en fazla 50)" }
 *       - { in: query, name: itemId, schema: { type: string }, description: "Topun kumaşı (uuid; CSV)" }
 *       - { in: query, name: colorId, schema: { type: string }, description: "Topun rengi (uuid; CSV)" }
 *       - { in: query, name: varyant, schema: { type: string, enum: [fasoncu] }, description: "Küçük çoklu kırılımı — en büyük ≤ 6 değer, her hücre ucun kendi süzgeciyle süzülmüş ana koşu (R1-VARYANT)" }
 *       - { in: query, name: donemler, schema: { type: string, example: "ay:6" }, description: "Çok dönemli kıyas (birim ay|hafta|gun, adet 2–12; alt koşular sıralı). Kesit raporunda dönem değerleri ölçülemedi döner" }
 *     responses:
 *       200: { description: "RaporSunumu (data) + süzgeç beyanı (+dusenSatir)" }
 */
router.get("/subcontract/fasoncular", ...reportGate("subcontract/fasoncular"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreSubcontractorsQuerySchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const { mode, compareRange } = resolveCoreCompare(input, range);
    const { sunum, suzgec } = await runCoreWithExtras({
      range, compareRange, dims: SUBCONTRACTOR_DIMS, varyant: input.varyant, donemler: input.donemler,
      run: subcontractorRunner({ subcontractorId: input.subcontractorId, itemId: input.itemId, colorId: input.colorId }, mode),
    });
    res.status(200).json(reportEnvelope(sunum, range, compareRange, { suzgec, warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/production/makine-duruslari:
 *   get:
 *     tags: [Reports]
 *     summary: Temel rapor — Makineler neden durdu? (RaporSunumu; D4-A4)
 *     description: |
 *       Kaynak makine duruşu span defteri (karne değil): geri alınan duruş girmez, süren duruş şu ana kadar sayılır,
 *       gece yarısını aşan duruş fabrika günlerine bölünür. Kapsam duruş rejiminin tek helper'ından
 *       (`machineStopScopeWhere`); kapı `dokuma ∨ (üretim ∧ uretim.makineDurusTakibi)`. Tablo makine başına,
 *       yanında aynı makinenin dönemdeki çıkış sayaç metresi; grafik vardiya (tanım varsa) ya da gün.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: kiyas, schema: { type: string, enum: [none, prev, prevYear] } }
 *       - { in: query, name: machineId, schema: { type: string }, description: "Makine (uuid; CSV ya da tekrarlı anahtar)" }
 *       - { in: query, name: stationKind, schema: { type: string }, description: "İstasyon türü (CSV; bilinmeyen 400)" }
 *       - { in: query, name: reasonCode, schema: { type: string }, description: "Duruş sebebi kodu (CSV)" }
 *       - { in: query, name: varyant, schema: { type: string, enum: [makine, istasyon, sebep] } }
 *       - { in: query, name: donemler, schema: { type: string, example: "gun:7" } }
 *     responses:
 *       200: { description: "RaporSunumu (data)" }
 *       400: { description: Geçersiz parametre ya da aralıkta çok fazla duruş (REPORT_RANGE_TOO_LARGE) }
 *       403: { description: Duruş takibi kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/production/makine-duruslari", requireMachineStopRegime, ...reportGate("production/makine-duruslari"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = coreMachineStopsQuerySchema.parse(req.query);
    const window = resolveCoreDayRange(input, REPORT_BY_KEY.get(MACHINE_STOPS_KEY)?.varsayilanGun ?? 7);
    const filters = { machineId: input.machineId, stationKind: input.stationKind, reasonCode: input.reasonCode };
    const { sunum } = await runCoreWithExtras({
      range: window.range, compareRange: window.compareRange, dims: MACHINE_STOP_DIMS, varyant: input.varyant, donemler: input.donemler,
      run: machineStopsRunner(filters, window.mode, (r, c, m) => (r === window.range && c === window.compareRange ? window : dayWindowOf(r, c, m))),
    });
    res.status(200).json(reportEnvelope(sunum, window.range, window.compareRange, { warnings: sunum.uyarilar }));
  } catch (e) {
    next(e);
  }
});

export default router;
