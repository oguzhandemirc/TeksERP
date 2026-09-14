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
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../../middlewares/module.middleware";
import { durusParetoReport, efficiencyReport, shiftScorecardReport } from "../../services/reports/dokuma.report.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);
const guard = requirePermission("report:production");

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz gün (YYYY-MM-DD)");
/** Hat kırılımı opt-in — yalnız `1` açar; tanınmayan değer 400 (fail-closed), yokluk = eski gövde. */
const byLineSchema = z.enum(["1", "0"], { message: "byLine yalnız 1 ya da 0 olabilir" }).optional();
const byLineOf = (q: { byLine?: "1" | "0" }): { byLine?: boolean } => (q.byLine === "1" ? { byLine: true } : {});
const aralikSchema = z.object({ from: YMD, to: YMD, machineId: z.string().uuid("Geçersiz makine").optional(), byLine: byLineSchema }).strict();
const gunSchema = z.object({ factoryDay: YMD, shiftDefinitionId: z.string().uuid("Geçersiz vardiya tanımı").optional(), byLine: byLineSchema }).strict();
const paretoSchema = z.object({ from: YMD, to: YMD, machineId: z.string().uuid("Geçersiz makine").optional() }).strict();

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
 *     responses:
 *       200: { description: Randıman raporu (satırlar · toplam · kaynakKirilimi · meta.ufuk) }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/randiman", guard, async (req, res, next) => {
  try {
    const { byLine, ...q } = aralikSchema.parse(req.query);
    res.json({ success: true, data: await efficiencyReport({ ...q, ...byLineOf({ byLine }) }) });
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
 *     responses:
 *       200: { description: Pareto raporu }
 */
router.get("/durus-pareto", guard, async (req, res, next) => {
  try {
    res.json({ success: true, data: await durusParetoReport(paretoSchema.parse(req.query)) });
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
 *       - { in: query, name: byLine, schema: { type: string, enum: ["1", "0"] }, description: Hat kırılımı opt-in (çift enli tezgah) }
 *     responses:
 *       200: { description: Vardiya karnesi }
 */
router.get("/vardiya-karnesi", guard, async (req, res, next) => {
  try {
    const { byLine, ...q } = gunSchema.parse(req.query);
    res.json({ success: true, data: await shiftScorecardReport({ ...q, ...byLineOf({ byLine }) }) });
  } catch (e) {
    next(e);
  }
});

export default router;
