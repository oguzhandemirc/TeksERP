// =============================================================================
// TeksERP — Atkı Kartı (WeftSpec) Routes · dokuma ürün yapısı (MAL-1, S2 çekirdeği)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` (modül rejimi; TOPLU) →
// `requirePermission`. İzinler çözgü kartıyla AYNI kodlar (`warpspec:read/write`; yeni
// kod yok — DOKUMA-MANUEL-PLAN §S2). Ekran S4c'de (iş emri formu v2 + kart sayfaları).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import {
  createWeftSpec,
  deactivateWeftSpec,
  getWeftSpec,
  listWeftSpecs,
  updateWeftSpec,
} from "../services/weft-spec.service";
import { forkWeftSpecForItem } from "../services/weft-spec-fork.service";

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
 * /api/weft-specs:
 *   get:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı listesi (dokuma modülü; varsayılan yalnız aktif)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("warpspec:read"), wrap(async (req, res) => {
  res.status(200).json({ success: true, data: await listWeftSpecs(listQuery.parse(req.query)) });
}));

/**
 * @openapi
 * /api/weft-specs/{id}:
 *   get:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı detayı (iplik satırlarıyla)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("warpspec:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await getWeftSpec(id) });
}));

/**
 * @openapi
 * /api/weft-specs:
 *   post:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı oluştur (çoklu atkı ipliği — rapordaki adet payı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: İplik değil / denye boş / adet ≤ 0 }
 *       409: { description: Kod ya da ad mükerrer }
 */
router.post("/", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const data = await createWeftSpec(body.parse(req.body ?? {}), req.user?.userId);
  res.status(201).json({ success: true, data, message: "Atkı kartı oluşturuldu." });
}));

const forkBody = z.object({
  itemId: z.string().uuid("Geçersiz kumaş ID"),
  code: z.string().max(32, "Atkı kartı kodu en çok 32 karakter olabilir"),
  name: z.string().max(100, "Atkı kartı adı en çok 100 karakter olabilir"),
}).strict();

/**
 * @openapi
 * /api/weft-specs/{id}/fork:
 *   post:
 *     tags: [WeftSpecs]
 *     summary: Bu desene özel kopya — kartı kopyalar, YALNIZ verilen kumaşın bağını kopyaya çevirir (SY-P3)
 *     description: Aynı kod bu kumaşa zaten bağlıysa önceki denemenin tekrarı sayılır (200, replayed=true).
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: Kopya oluşturuldu ve kumaş bağı çevrildi }
 *       200: { description: Tekrar deneme — mevcut kopya döndü }
 *       400: { description: Kod/ad boş ya da gövde geçersiz }
 *       404: { description: Kart ya da kumaş bulunamadı }
 *       409: { description: WEFT_SPEC_DUPLICATE · WEFT_SPEC_BINDING_CHANGED · WEFT_SPEC_NOT_SHARED }
 */
router.post("/:id/fork", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = await forkWeftSpecForItem(id, forkBody.parse(req.body ?? {}), req.user?.userId);
  res.status(data.replayed ? 200 : 201).json({ success: true, data, message: data.replayed ? "Özel kopya zaten oluşturulmuştu." : "Bu desene özel atkı kartı oluşturuldu." });
}));

/**
 * @openapi
 * /api/weft-specs/{id}:
 *   patch:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı güncelle (yarns gönderilirse küme değiştirilir)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = await updateWeftSpec(id, body.parse(req.body ?? {}), req.user?.userId);
  res.status(200).json({ success: true, data, message: "Atkı kartı güncellendi." });
}));

/**
 * @openapi
 * /api/weft-specs/{id}:
 *   delete:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartını pasife al (silinmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await deactivateWeftSpec(id, req.user?.userId), message: "Atkı kartı pasife alındı." });
}));

export default router;
