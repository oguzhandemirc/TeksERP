// =============================================================================
// TeksERP — Lab test türü kataloğu (`/api/lab-test-types/*`, K4P-LAB)
// =============================================================================
// Okuma `labtest:read` (test formu tür listesini ister), katalog yazımı `labtest:write`.
// Kapı `router.use` satırında, her uçtan ÖNCE.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireKaliteGuvenceEnabled } from "../middlewares/module.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { listSearchParam } from "../utils/list-search";
import { addLabTestPresets, createLabTestType, listLabTestTypes, previewLabTestPresets, updateLabTestType } from "../services/lab-test-type.service";

const router = Router();
router.use(verifyToken, requireKaliteGuvenceEnabled);

type Handler = (req: Request) => Promise<{ status: number; data: unknown }>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json({ success: true, data: out.data });
  } catch (err) {
    next(err);
  }
};

const TypeBody = z.strictObject({
  code: z.string().trim().min(1, "Kod boş olamaz").max(32, "Kod en çok 32 karakter").regex(/^[A-Za-z0-9_-]+$/, "Kod yalnız harf, rakam, - ve _ içerebilir"),
  name: z.string().trim().min(1, "Ad boş olamaz").max(80, "Ad en çok 80 karakter"),
  method: z.string().max(64, "Yöntem en çok 64 karakter").nullable().optional(),
  resultKind: z.enum(["NUMERIC", "SCALE", "PASS_FAIL"], "Sonuç biçimi geçersiz"),
  scaleMax: z.number().int().nullable().optional(),
  unit: z.string().max(16, "Birim en çok 16 karakter").nullable().optional(),
  specMin: z.number().finite().nullable().optional(),
  specMax: z.number().finite().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});
// Liste sorgusu katı: tanınmayan parametre 400 (fail-closed); arama kod/ad/yöntem.
const ListQuery = z.strictObject({ activeOnly: z.enum(["0", "1"]).optional(), search: listSearchParam });
const PresetBody = z.strictObject({ codes: z.array(z.string().max(32)).min(1, "En az bir satır seçin").max(50) });

/**
 * @openapi
 * /api/lab-test-types:
 *   get:
 *     tags: [Kalite]
 *     summary: Lab test türleri (activeOnly=1 → yalnız etkin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: activeOnly, schema: { type: string, enum: ["0", "1"] } }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *         description: "Metin araması — tür kodu, adı ya da yöntemi; boş = arama yok"
 *     responses:
 *       200: { description: Türler }
 *       400: { description: Tanınmayan parametre ya da 100 karakteri aşan arama }
 *   post:
 *     tags: [Kalite]
 *     summary: Lab test türü ekle
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Tür }
 *       409: { description: LAB_TYPE_CODE_TAKEN }
 * /api/lab-test-types/presets:
 *   get:
 *     tags: [Kalite]
 *     summary: Hazır liste önizlemesi (katalogda var mı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hazır satırlar }
 *   post:
 *     tags: [Kalite]
 *     summary: Seçilen hazır satırları ekle (var olan kod atlanır)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "requested, created" }
 * /api/lab-test-types/{id}:
 *   put:
 *     tags: [Kalite]
 *     summary: Lab test türünü düzenle / pasife al
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Tür }
 */
router.get("/", requirePermission("labtest:read"), wrap(async (req) => {
  const q = ListQuery.parse(req.query);
  return { status: 200, data: await listLabTestTypes({ activeOnly: q.activeOnly === "1", search: q.search }) };
}));
router.post("/", requirePermission("labtest:write"), wrap(async (req) => ({ status: 201, data: await createLabTestType(TypeBody.parse(req.body), req.user!.userId) })));
router.get("/presets", requirePermission("labtest:write"), wrap(async () => ({ status: 200, data: await previewLabTestPresets() })));
router.post("/presets", requirePermission("labtest:write"), wrap(async (req) => ({ status: 201, data: await addLabTestPresets(PresetBody.parse(req.body).codes, req.user!.userId) })));
router.put("/:id", requirePermission("labtest:write"), wrap(async (req) => ({ status: 200, data: await updateLabTestType(z.uuid("Geçersiz kimlik").parse(req.params.id), TypeBody.parse(req.body), req.user!.userId) })));

export default router;
