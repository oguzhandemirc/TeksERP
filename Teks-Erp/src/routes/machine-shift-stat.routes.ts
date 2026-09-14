// =============================================================================
// TeksERP — VARDİYA KARNESİ (MachineShiftStat) uçları · Dilim 2: canlı karne (M1)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA (machine-stop emsali): `verifyToken` → `requireDokumaEnabled`
// → izin. Okuma `report:production` (üretim raporudur; ayrı `loom:read` AÇILMAZ — 1e
// hükmü ③). Yazma: M3 terim düzeltme + M4 mühür `loom:manual-entry`; M5 mühür açma
// `loom:shift-unseal` (geçmiş rakamı değiştirir, ayrı kod, gerekçe ≥ 3).
// Tarih parametreleri fabrika günü `YYYY-MM-DD`; süzme SUNUCUDA, cursor yok.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { listShiftStats } from "../services/machine-shift-stat.service";
import { correctShiftTerms, listShiftSeals, sealShiftStat, unsealShiftStat } from "../services/machine-shift-seal.service";

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

const nonneg = z.coerce.number().int().min(0);
const termsSchema = z
  .object({
    nonScheduledSec: nonneg.optional(),
    plannedBreakSec: nonneg.optional(),
    setupSec: nonneg.optional(),
    plannedDownSec: nonneg.optional(),
    unplannedDownSec: nonneg.optional(),
    minorStopSec: nonneg.optional(),
    unclassifiedSec: nonneg.optional(),
    unitsActual: nonneg.optional(),
    producedM: z.coerce.number().min(0).nullable().optional(),
    targetUnitsPerMin: z.coerce.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Düzeltilecek en az bir terim verilmeli" });

/**
 * @openapi
 * /api/machine-shift-stats/{id}/terms:
 *   put:
 *     tags: [MachineShiftStats]
 *     summary: Karne terimlerini elle düzelt (M3) — yalnız OPEN karne; kaynak SUPERVISOR olur
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Düzeltildi }
 *       409: { description: Karne mühürlü (SHIFT_SEALED) }
 */
router.put("/:id/terms", requirePermission("loom:manual-entry"), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    res.json(await correctShiftTerms(id, termsSchema.parse(req.body), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-shift-stats/{id}/seal:
 *   post:
 *     tags: [MachineShiftStats]
 *     summary: Karneyi mühürle (M4) — atomik claim OPEN→SEALED, oranlar donar, kırılım yeni kuşak, mühür defteri satırı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Mühürlendi (SEAL ya da RESEAL) }
 *       409: { description: Zaten mühürlü / yarış (SHIFT_SEAL_RACE) }
 */
router.post("/:id/seal", requirePermission("loom:manual-entry"), async (req, res, next) => {
  try {
    res.json(await sealShiftStat(assertValidUuid(req.params.id, "id"), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

const unsealSchema = z.object({ reason: z.string().trim().min(3, "Gerekçe en az 3 karakter").max(300) }).strict();

/**
 * @openapi
 * /api/machine-shift-stats/{id}/unseal:
 *   post:
 *     tags: [MachineShiftStats]
 *     summary: Karne mührünü aç (M5) — claim SEALED→OPEN, mühür defterine UNSEAL; `sealedAt` kalır
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Mühür açıldı }
 *       409: { description: Mühürlü değil (SHIFT_NOT_SEALED) }
 */
router.post("/:id/unseal", requirePermission("loom:shift-unseal"), async (req, res, next) => {
  try {
    const b = unsealSchema.parse(req.body);
    res.json(await unsealShiftStat(assertValidUuid(req.params.id, "id"), b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-shift-stats/{id}/seals:
 *   get:
 *     tags: [MachineShiftStats]
 *     summary: Mühür defteri — kuşaklar (SEAL/UNSEAL/RESEAL), salt okuma
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Mühür satırları }
 */
router.get("/:id/seals", requirePermission("report:production"), async (req, res, next) => {
  try {
    res.json(await listShiftSeals(assertValidUuid(req.params.id, "id")));
  } catch (e) {
    next(e);
  }
});

export default router;
