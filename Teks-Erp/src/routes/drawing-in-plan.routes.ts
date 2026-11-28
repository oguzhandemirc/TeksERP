// =============================================================================
// TeksERP — Tahar Planı (DrawingInPlan) Routes · kumaşa ait tel→çerçeve dizisi (T1, Seyitoğlu 2026-11-28)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` (TOPLU) → `requirePermission`. İzinler
// desen/çözgü kartıyla AYNI kodlar (`warpspec:read/write`; yeni izin kodu yok).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import {
  activateDrawingInPlan,
  createDrawingInPlan,
  deactivateDrawingInPlan,
  getDrawingInPlan,
  listDrawingInPlans,
  updateDrawingInPlan,
} from "../services/drawing-in-plan.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};
const idParam = z.object({ id: z.string().uuid("Geçersiz kayıt ID") });
const body = z.record(z.string(), z.unknown());
const listQuery = z.object({
  search: z.string().max(100, "Arama en çok 100 karakter").optional(),
  includeInactive: z.enum(["0", "1", "true", "false"], { message: "includeInactive yalnız 0/1/true/false olabilir" }).optional()
    .transform((v) => v === "1" || v === "true"),
});

/**
 * @openapi
 * /api/drawing-in-plans:
 *   get:
 *     tags: [DrawingInPlans]
 *     summary: Tahar planı listesi (dokuma modülü; varsayılan yalnız aktif; `_count.fabricItems` kullanım sayısı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("warpspec:read"), wrap(async (req, res) => {
  res.status(200).json({ success: true, data: await listDrawingInPlans(listQuery.parse(req.query)) });
}));

/**
 * @openapi
 * /api/drawing-in-plans/{id}:
 *   get:
 *     tags: [DrawingInPlans]
 *     summary: Tahar planı detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("warpspec:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await getDrawingInPlan(id) });
}));

/**
 * @openapi
 * /api/drawing-in-plans:
 *   post:
 *     tags: [DrawingInPlans]
 *     summary: Tahar planı oluştur ({ name, frameCount, notation | threading, selvedgeThreading?, notes?, code? }); kod boşsa seriden
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Geçersiz yazım / çerçeve sayısını aşan numara }
 *       409: { description: Aynı kod ya da ad }
 */
router.post("/", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const data = await createDrawingInPlan(body.parse(req.body ?? {}), req.user?.userId);
  res.status(201).json({ success: true, data, message: "Tahar planı oluşturuldu." });
}));

/**
 * @openapi
 * /api/drawing-in-plans/{id}:
 *   patch:
 *     tags: [DrawingInPlans]
 *     summary: Tahar planını düzenle
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Geçersiz alan }
 */
router.patch("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = await updateDrawingInPlan(id, body.parse(req.body ?? {}), req.user?.userId);
  res.status(200).json({ success: true, data, message: "Tahar planı güncellendi." });
}));

/**
 * @openapi
 * /api/drawing-in-plans/{id}:
 *   delete:
 *     tags: [DrawingInPlans]
 *     summary: Tahar planını pasife al (silme yok; arşivlenmemiş kumaş bağlıyken 409 DRAWING_IN_PLAN_IN_USE)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 *       409: { description: Kullanımda ya da zaten pasif }
 */
router.delete("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await deactivateDrawingInPlan(id, req.user?.userId), message: "Tahar planı pasife alındı." });
}));

/**
 * @openapi
 * /api/drawing-in-plans/{id}/activate:
 *   post:
 *     tags: [DrawingInPlans]
 *     summary: Tahar planını yeniden aktif et
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Aktif edildi }
 *       409: { description: Zaten aktif }
 */
router.post("/:id/activate", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await activateDrawingInPlan(id, req.user?.userId), message: "Tahar planı aktif edildi." });
}));

export default router;
