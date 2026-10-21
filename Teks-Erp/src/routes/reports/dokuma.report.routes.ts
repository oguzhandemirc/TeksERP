// =============================================================================
// TeksERP — DOKUMA RAPORLARI uçları: randıman · duruş Pareto · vardiya karnesi
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` → `report:production`
// (finance.report.routes emsali: rejim kapısı BU dosyada, `reports.routes` kökünde
// değil — kökte olsaydı öteki raporlar da dokuma rejimine bağlanırdı). Üç uç da
// üretim raporudur; ayrı `loom:read` AÇILMAZ (1e hükmü ③). Tarih parametreleri
// fabrika günü `YYYY-MM-DD`; süzme SUNUCUDA; her cevap `meta.ufuk` taşır.
// `?byLine=1` OPT-IN: randıman + vardiya karnesi satırlarına `hatlar` (çift enli tezgah);
// Pareto duruş ekseninde, hat bilmez. Opt-in yoksa gövde bayt bayt eski.
// Levent sonucu · kapasite kullanımı · levent bitiş tahmini (DOKUMA-MANUEL S1c): liste ≤500 kırpılır
// (`warnings` söyler), özet tam kümeden; levent uçlarına ek `requireDevereEnabled` (levent devere tablosudur).
// `/mudahale` (B4): kişi kırılımı yalnız `loom:alarm-escalation` (usta üstü amir) sahibine — yeni izin açılmaz.
// =============================================================================
import { Router, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import { requireDevereEnabled, requireDokumaEnabled } from "../../middlewares/module.middleware";
import { SHIFT_STAT_PAGE_MAX } from "../../services/machine-shift-stat.service";
import { durusParetoReport, efficiencyReport, shiftScorecardReport, type WithSuzgec } from "../../services/reports/dokuma.report.service";
import { capReportLists, reportEnvelope, resolveDateRange, splitOptions } from "../../services/reports/_shared";
import { filterEcho, musteriEkseni } from "../../services/reports/_filters";
import { getProductionChain, CHAIN_STATUSES } from "../../services/reports/production-chain.report.service";
import { alarmResponseReport } from "../../services/reports/alarm-response.report.service";
import { hasAlarmEscalation } from "../../services/helpers/loom-alarm-recipient.helper";
import { beamResultReport } from "../../services/reports/levent-sonucu.report.service";
import { capacityUsageReport } from "../../services/reports/kapasite-kullanimi.report.service";
import { finishForecastReport } from "../../services/reports/levent-bitis-tahmini.report.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);
const guard = requirePermission("report:production");

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz gün (YYYY-MM-DD)");
/** Hat kırılımı opt-in — yalnız `1` açar; tanınmayan değer 400 (fail-closed), yokluk = eski gövde. */
const byLineSchema = z.enum(["1", "0"], { message: "byLine yalnız 1 ya da 0 olabilir" }).optional();
const byLineOf = (q: { byLine?: "1" | "0" }): { byLine?: boolean } => (q.byLine === "1" ? { byLine: true } : {});
/** LEVENT/LOT ekseni (R5b-b): "o vardiyada bu levent tezgahta bağlı mıydı" — defterden (`beamsMountedDuring`), süzgeç yoksa sorgu eski. */
/** `suzgec` TEK ADRES = cevap kökü (diğer rapor aileleriyle aynı: `reportEnvelope`); süzgeç yoksa anahtar YOK. */
function yanit(res: Response, rapor: WithSuzgec): void {
  const { suzgec, ...data } = rapor;
  res.json({ success: true, data, ...(suzgec ? { suzgec } : {}) });
}
const leventEkseni = { warpBeamId: z.string().uuid("Geçersiz levent").optional(), lotNo: z.string().trim().min(1).max(64).optional() };
/** Randıman satır listesi sayfalı (imleç + boy); toplamlar sayfadan bağımsız. */
const pageParams = { cursor: z.string().min(1).max(200).optional(), limit: z.coerce.number().int().min(1).max(SHIFT_STAT_PAGE_MAX).optional() };
const aralikSchema = z.object({ from: YMD, to: YMD, machineId: z.string().uuid("Geçersiz makine").optional(), byLine: byLineSchema, ...leventEkseni, ...pageParams }).strict();
const gunSchema = z.object({ factoryDay: YMD, shiftDefinitionId: z.string().uuid("Geçersiz vardiya tanımı").optional(), byLine: byLineSchema, ...leventEkseni }).strict();
const paretoSchema = z.object({ from: YMD, to: YMD, machineId: z.string().uuid("Geçersiz makine").optional(), ...leventEkseni }).strict();

/**
 * @openapi
 * /api/reports/dokuma/randiman:
 *   get:
 *     tags: [Reports]
 *     summary: Randıman — makine×vardiya A · P · E AYRI (çarpılmaz), toplam Σ/Σ, "ölçülemedi" beyanı, kaynak kırılımı; `byLine=1` satıra `hatlar` ekler
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: machineId, schema: { type: string, format: uuid } }
 *       - { in: query, name: byLine, schema: { type: string, enum: ["1", "0"] }, description: Hat kırılımı opt-in (çift enli tezgah) }
 *       - { in: query, name: warpBeamId, schema: { type: string, format: uuid }, description: "Levent ekseni (R5b-b) — o vardiyada tezgahta bağlı olan leventin satırları (defterden)" }
 *       - { in: query, name: lotNo, schema: { type: string }, description: "İplik lotu ekseni — bu lotla sarılmış leventlerin satırları" }
 *       - { in: query, name: cursor, schema: { type: string }, description: "Sonraki sayfa imleci (meta.nextCursor); aralık/süzgeç değişince geçersiz (400 INVALID_CURSOR)" }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 5000 }, description: "Sayfa boyu (varsayılan 500)" }
 *     responses:
 *       200: { description: "Randıman raporu (satırlar · toplam · kaynakKirilimi · meta.ufuk · meta.leventler seçici kaynağı · süzgeçliyse kökte suzgec)" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
/**
 * @openapi
 * /api/reports/dokuma/zincir:
 *   get:
 *     tags: [Reports]
 *     summary: Üretim Zinciri hub'ı — açık sipariş satırı → iş emri (adım) → dokuma işi (Σkoşum/plan) → levent (kalan); bağsız kovalar (işsiz levent · siparişsiz dokuma · dışarıdan top) kendi sayımından; devere kapalıysa levent alanı dönmez
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: customerId, schema: { type: string }, description: "Müşteri ekseni — CSV (a,b); boş = tümü" }
 *       - { in: query, name: durum, schema: { type: string, enum: [BEKLEYEN, DEVAM, GECIKMIS, TAMAMLANAN] }, description: "Satır durumu (kapalı seçici); yoksa tümü" }
 *       - { in: query, name: gecikmis, schema: { type: string, enum: ["true"] }, description: "Yalnız gecikmiş satırlar" }
 *     responses:
 *       200: { description: "Rapor zarfı — data.satirlar · satirOmitted (tavan 500) · kovalar · ozet · moduller.devere; meta.secenekler.customerId; süzgeçliyse suzgec (+dusenSatir)" }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
/** Z3 üretim zinciri: müşteri CSV · durum (kapalı enum) · gecikmis ("true" = yalnız gecikmişler). Tarih YOK (anlık fotoğraf). */
export const productionChainQuerySchema = z.object({ customerId: musteriEkseni.customerId, durum: z.enum(CHAIN_STATUSES).optional(), gecikmis: z.enum(["true"]).optional() }).strict();
const CHAIN_FILTER_KEYS = ["customerId", "durum", "gecikmis"] as const;

router.get("/zincir", requireReportOpen("dokuma/zincir"), guard, async (req, res, next) => {
  try {
    const input = productionChainQuerySchema.parse(req.query);
    const { data, secenekler, dusenSatir } = splitOptions(await getProductionChain(input));
    res.status(200).json(reportEnvelope(data, resolveDateRange({}), null, { suzgec: filterEcho(input, CHAIN_FILTER_KEYS, dusenSatir), secenekler }));
  } catch (e) {
    next(e);
  }
});

router.get("/randiman", requireReportOpen("dokuma/randiman"), guard, async (req, res, next) => {
  try {
    const { byLine, ...q } = aralikSchema.parse(req.query);
    yanit(res, await efficiencyReport({ ...q, ...byLineOf({ byLine }) }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/dokuma/durus-pareto:
 *   get:
 *     tags: [Reports]
 *     summary: Duruş Pareto — SEBEP × SÜRE SINIFI; MINOR ayrı blok (sebep değil), sınıflandırılmamış ve atanmamış (beamSlot NULL) ayrı kovalar
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: machineId, schema: { type: string, format: uuid } }
 *       - { in: query, name: warpBeamId, schema: { type: string, format: uuid }, description: "Levent ekseni (R5b-b) — o vardiyada tezgahta bağlı olan leventin satırları (defterden)" }
 *       - { in: query, name: lotNo, schema: { type: string }, description: "İplik lotu ekseni — bu lotla sarılmış leventlerin satırları" }
 *     responses:
 *       200: { description: "Pareto raporu (meta.leventler seçici kaynağı · süzgeçliyse kökte suzgec)" }
 */
router.get("/durus-pareto", requireReportOpen("dokuma/durus-pareto"), guard, async (req, res, next) => {
  try {
    yanit(res, await durusParetoReport(paretoSchema.parse(req.query)));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/dokuma/vardiya-karnesi:
 *   get:
 *     tags: [Reports]
 *     summary: Vardiya karnesi — fabrika gününün vardiyaları; üretim, duruş, kaynak kırılımı (ölçülen · elle · simüle · çıkarım · ölçülemedi); `byLine=1` makine satırına `hatlar` ekler
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: factoryDay, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: shiftDefinitionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: warpBeamId, schema: { type: string, format: uuid }, description: "Levent ekseni (R5b-b) — o vardiyada tezgahta bağlı olan leventin satırları (defterden)" }
 *       - { in: query, name: lotNo, schema: { type: string }, description: "İplik lotu ekseni — bu lotla sarılmış leventlerin satırları" }
 *       - { in: query, name: byLine, schema: { type: string, enum: ["1", "0"] }, description: Hat kırılımı opt-in (çift enli tezgah) }
 *     responses:
 *       200: { description: "Vardiya karnesi (vardiyalar[].shiftDefinitionId · meta.leventler · süzgeçliyse kökte suzgec)" }
 */
router.get("/vardiya-karnesi", requireReportOpen("dokuma/vardiya-karnesi"), guard, async (req, res, next) => {
  try {
    const { byLine, ...q } = gunSchema.parse(req.query);
    yanit(res, await shiftScorecardReport({ ...q, ...byLineOf({ byLine }) }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/dokuma/mudahale:
 *   get:
 *     tags: [Reports]
 *     summary: Müdahale/çözüm süresi (B4) — tezgah alarmı defterinden ortalama üstlenme ve çözüm süresi, hedef (K2 vadesi) aşım oranı; kırılımlar sebep · hol · vardiya · tezgah · kişi (kişi yalnız loom:alarm-escalation sahibine)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date }, description: "Fabrika günü (alarm doğuşu)" }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "Rapor zarfı — data.ozet · sebepler · holler · vardiyalar · tezgahlar · (yetkiliyse) kisiler · kisiKirilimi; liste tavanında warnings" }
 *       400: { description: Geçersiz aralık ya da tanınmayan parametre }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
const mudahaleSchema = z.object({ from: YMD, to: YMD }).strict();
router.get("/mudahale", requireReportOpen("dokuma/mudahale"), guard, async (req, res, next) => {
  try {
    const q = mudahaleSchema.parse(req.query);
    const { data, range, warnings } = await alarmResponseReport({ ...q, withPeople: hasAlarmEscalation(req.user?.permissions ?? []) });
    res.status(200).json(reportEnvelope(data, range, null, { warnings }));
  } catch (e) {
    next(e);
  }
});

/** S1c raporlarının liste tavanı — özet tam kümeden, kesme `warnings` ile söylenir. */
export const DOKUMA_LIST_MAX = 500;
const uuidOpt = (msg: string) => z.string().uuid(msg).optional();
export const beamResultQuerySchema = z.object({ from: YMD, to: YMD, warpSpecId: uuidOpt("Geçersiz çözgü kartı"), machineId: uuidOpt("Geçersiz makine") }).strict();
export const capacityQuerySchema = z.object({ from: YMD, to: YMD, machineId: uuidOpt("Geçersiz makine") }).strict();
export const finishForecastQuerySchema = z.object({ machineId: uuidOpt("Geçersiz makine") }).strict();
export const BEAM_RESULT_LISTS = [["kapananlar", "Kapanan leventler"], ["acikLeventler", "Açık leventler"]] as const;
export const CAPACITY_LISTS = [["satirlar", "Tezgah × hafta"]] as const;
export const FINISH_FORECAST_LISTS = [["satirlar", "Tezgahtaki leventler"]] as const;

/**
 * @openapi
 * /api/reports/dokuma/levent-sonucu:
 *   get:
 *     tags: [Reports]
 *     summary: Levent sonucu — sarılan çözgü → beklenen kumaş (take-up) → gerçek kumaş (otomatik/elle) → fire; fire yalnız kapanmış (EXHAUSTED|SCRAPPED) leventte, açık leventler kesit
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date }, description: "Fabrika günü — kapanış olayının günü" }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: warpSpecId, schema: { type: string, format: uuid }, description: Çözgü kartı }
 *       - { in: query, name: machineId, schema: { type: string, format: uuid }, description: Leventin bağlandığı tezgah }
 *     responses:
 *       200: { description: "Rapor zarfı — data.kapananlar · acikLeventler · ozet (olculemedi) · meta.ufuk/ufukOncesiSatir/duzeltilmisTop/secenekler; süzgeçliyse kökte suzgec (+dusenSatir); liste tavanında warnings" }
 *       400: { description: Geçersiz gün ya da tanınmayan parametre }
 *       403: { description: Dokuma/devere modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/levent-sonucu", requireDevereEnabled, requireReportOpen("dokuma/levent-sonucu"), guard, async (req, res, next) => {
  try {
    const q = beamResultQuerySchema.parse(req.query);
    const { data, dusenSatir, range } = await beamResultReport(q);
    const capped = capReportLists(data, BEAM_RESULT_LISTS, DOKUMA_LIST_MAX);
    res.status(200).json(reportEnvelope(capped.data, range, null, { suzgec: filterEcho(q, ["warpSpecId", "machineId"], dusenSatir), warnings: capped.warnings }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/dokuma/kapasite-kullanimi:
 *   get:
 *     tags: [Reports]
 *     summary: Kapasite kullanımı — tezgah × fabrika haftası; teorik m/sa = nominal ÷ atkı/cm × 0,6, potansiyel = teorik × takvim saati, gerçek = doff'lu topların metresi; eksik terimde null + gerekçe
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date }, description: "En çok 366 gün" }
 *       - { in: query, name: machineId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Rapor zarfı — data.satirlar · ozet (hesaplanamadi) · meta.ufuk/secenekler; süzgeçliyse kökte suzgec (+dusenSatir); liste tavanında warnings" }
 *       400: { description: Geçersiz aralık (INVALID_RANGE) ya da tanınmayan parametre }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/kapasite-kullanimi", requireReportOpen("dokuma/kapasite-kullanimi"), guard, async (req, res, next) => {
  try {
    const q = capacityQuerySchema.parse(req.query);
    const { data, dusenSatir, range } = await capacityUsageReport(q);
    const capped = capReportLists(data, CAPACITY_LISTS, DOKUMA_LIST_MAX);
    res.status(200).json(reportEnvelope(capped.data, range, null, { suzgec: filterEcho(q, ["machineId"], dusenSatir), warnings: capped.warnings }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/dokuma/levent-bitis-tahmini:
 *   get:
 *     tags: [Reports]
 *     summary: Levent bitiş tahmini (kesit) — tezgahta bağlı her levent için kalan ÷ son 7 fabrika günü ortalama tüketim; tüketim yoksa tahmin yok (null + gerekçe)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: machineId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Rapor zarfı — data.satirlar (kalanM · gunlukOrtM · kaynak otomatik/elle · tahminiBitisGun · kalanGun) · ozet · meta.ufuk/secenekler; süzgeçliyse kökte suzgec (+dusenSatir)" }
 *       403: { description: Dokuma/devere modülü kapalı (MODULE_DISABLED), rapor kapalı ya da yetki yok }
 */
router.get("/levent-bitis-tahmini", requireDevereEnabled, requireReportOpen("dokuma/levent-bitis-tahmini"), guard, async (req, res, next) => {
  try {
    const q = finishForecastQuerySchema.parse(req.query);
    const { data, dusenSatir } = await finishForecastReport(q);
    const capped = capReportLists(data, FINISH_FORECAST_LISTS, DOKUMA_LIST_MAX);
    res.status(200).json(reportEnvelope(capped.data, resolveDateRange({}), null, { suzgec: filterEcho(q, ["machineId"], dusenSatir), warnings: capped.warnings }));
  } catch (e) {
    next(e);
  }
});

export default router;
