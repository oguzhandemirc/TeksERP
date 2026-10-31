// =============================================================================
// TeksERP — Desen Kartı (WeaveDesign) Routes · armür/örgü kataloğu (Seyitoğlu SY-A2)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` (modül rejimi; TOPLU) →
// `requirePermission`. İzinler çözgü kartıyla AYNI kodlar (`warpspec:read/write`; yeni
// kod yok — tasarım §2.7). Ekran SY-A3'te (Desen Kartları).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import {
  activateWeaveDesign,
  createWeaveDesign,
  deactivateWeaveDesign,
  getWeaveDesign,
  listWeaveDesigns,
  updateWeaveDesign,
} from "../services/weave-design.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};
const idParam = z.object({ id: z.string().uuid("Geçersiz kayıt ID") });
const body = z.record(z.string(), z.unknown());
const listQuery = z.object({
  search: z.string().max(100).optional(),
  includeInactive: z.enum(["0", "1", "true", "false"], { message: "includeInactive yalnız 0/1/true/false olabilir" }).optional()
    .transform((v) => v === "1" || v === "true"),
});

/**
 * @openapi
 * /api/weave-designs:
 *   get:
 *     tags: [WeaveDesigns]
 *     summary: Desen kartı listesi (dokuma modülü; varsayılan yalnız aktif; armür ızgarası listede yok)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("warpspec:read"), wrap(async (req, res) => {
  res.status(200).json({ success: true, data: await listWeaveDesigns(listQuery.parse(req.query)) });
}));

/**
 * @openapi
 * /api/weave-designs/{id}:
 *   get:
 *     tags: [WeaveDesigns]
 *     summary: Desen kartı detayı (armür ızgarasıyla)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("warpspec:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await getWeaveDesign(id) });
}));

/**
 * @openapi
 * /api/weave-designs:
 *   post:
 *     tags: [WeaveDesigns]
 *     summary: Desen kartı oluştur
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Geçersiz tür / ızgara (LIFT_PLAN_INVALID) }
 *       409: { description: Kod ya da ad mükerrer }
 */
router.post("/", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const data = await createWeaveDesign(body.parse(req.body ?? {}), req.user?.userId);
  res.status(201).json({ success: true, data, message: "Desen kartı oluşturuldu." });
}));

/**
 * @openapi
 * /api/weave-designs/{id}:
 *   patch:
 *     tags: [WeaveDesigns]
 *     summary: Desen kartı güncelle
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = await updateWeaveDesign(id, body.parse(req.body ?? {}), req.user?.userId);
  res.status(200).json({ success: true, data, message: "Desen kartı güncellendi." });
}));

/**
 * @openapi
 * /api/weave-designs/{id}:
 *   delete:
 *     tags: [WeaveDesigns]
 *     summary: Desen kartını pasife al (silinmez; aktif ürün bağlıysa 409 WEAVE_DESIGN_IN_USE)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await deactivateWeaveDesign(id, req.user?.userId), message: "Desen kartı pasife alındı." });
}));

/**
 * @openapi
 * /api/weave-designs/{id}/activate:
 *   post:
 *     tags: [WeaveDesigns]
 *     summary: Pasif desen kartını yeniden aktif et
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Aktif edildi }
 *       409: { description: Zaten aktif }
 */
router.post("/:id/activate", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await activateWeaveDesign(id, req.user?.userId), message: "Desen kartı aktif edildi." });
}));

export default router;
