// =============================================================================
// TeksERP — VARDİYA KARNESİ (MachineShiftStat) uçları · Dilim 2: canlı karne (M1)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA (machine-stop emsali): `verifyToken` → `requireDokumaEnabled`
// → izin. Okuma `report:production` (üretim raporudur; ayrı `loom:read` AÇILMAZ — 1e
// hükmü ③). Yazma uçları (M3 terim düzeltme · M4 mühür · M5 mühür açma) Dilim 3.
// Tarih parametreleri fabrika günü `YYYY-MM-DD`; süzme SUNUCUDA, cursor yok.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { listShiftStats } from "../services/machine-shift-stat.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz gün (YYYY-MM-DD)");
const listSchema = z
  .object({
    from: YMD,
    to: YMD,
    machineId: z.string().uuid("Geçersiz makine").optional(),
    sealState: z.enum(["OPEN", "SEALED"]).optional(),
  })
  .strict();

/**
 * @openapi
 * /api/machine-shift-stats:
 *   get:
 *     tags: [MachineShiftStats]
 *     summary: Vardiya karnesi listesi — vardiya × tezgah; mühürsüz satır ANLIK hesaplanır (`live`), mühürlü satır olduğu gibi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: machineId, schema: { type: string, format: uuid } }
 *       - { in: query, name: sealState, schema: { type: string, enum: [OPEN, SEALED] } }
 *     responses:
 *       200: { description: Karne satırları (terimler + oranlar + source + sealState + warnings) }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("report:production"), async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    res.json(await listShiftStats(q));
  } catch (e) {
    next(e);
  }
});

export default router;
