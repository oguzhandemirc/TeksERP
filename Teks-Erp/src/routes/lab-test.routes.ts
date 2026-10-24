// =============================================================================
// TeksERP — Lab testleri (`/api/lab-tests/*`, K4P-LAB)
// =============================================================================
// Kapı sırası load-bearing: `router.use` satırı HER uçtan önce — sonra tanımlanan uç kapıyı
// görmezse modül kapalıyken açık kalırdı. Okuma `labtest:read`, taslak yazımı `labtest:write`,
// onay ve iptal `labtest:approve`. Durum geçişleri servis içinde atomik claim'dir.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireKaliteGuvenceEnabled } from "../middlewares/module.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { approveLabTest, createLabTest, deleteDraftLabTest, deleteLabResult, upsertLabResult, voidLabTest } from "../services/lab-test.service";
import { getLabTest, listLabTests, voidPreviewLabTest } from "../services/lab-test-query.service";

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
const Id = z.uuid("Geçersiz kimlik");
const optText = (max: number) => z.string().max(max, `En çok ${max} karakter`).nullable().optional();

const ListQuery = z.object({
  status: z.union([z.string(), z.array(z.string())]).optional(),
  itemId: z.union([z.string(), z.array(z.string())]).optional(),
  rollId: z.union([z.string(), z.array(z.string())]).optional(),
  batchId: z.union([z.string(), z.array(z.string())]).optional(),
  forRollId: Id.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(64).optional(),
  verdict: z.enum(["FAIL"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const CreateBody = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz").nullable().optional(),
  rollId: Id.nullable().optional(),
  batchId: Id.nullable().optional(),
  sampleCode: optText(64),
  labName: optText(120),
  testedOn: z.string().nullable().optional(),
  note: optText(500),
});

const ResultBody = z.strictObject({
  testTypeId: Id,
  value: z.number("Değer sayı olmalı").finite().nullable(),
  verdict: z.enum(["PASS", "FAIL"], "Hüküm Geçti ya da Kaldı olmalı").nullable().optional(),
  specMin: z.number().finite().nullable().optional(),
  specMax: z.number().finite().nullable().optional(),
  note: optText(500),
});

const VoidBody = z.strictObject({ reason: z.string().trim().min(3, "İptal gerekçesi en az 3 karakter olmalı").max(500) });

/**
 * @openapi
 * /api/lab-tests:
 *   get:
 *     tags: [Kalite]
 *     summary: Lab testleri — liste + cursor + özet şeridi (tek where)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "items, nextCursor, summary" }
 *       403: { description: "MODULE_DISABLED ya da izin yok" }
 *   post:
 *     tags: [Kalite]
 *     summary: Lab testi aç (DRAFT; clientToken ile idempotent; numara doğuşta)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Test }
 *       400: { description: "LAB_SUBJECT_REQUIRED · LAB_ITEM_UNRESOLVED" }
 */
router.get("/", requirePermission("labtest:read"), wrap(async (req) => ({ status: 200, data: await listLabTests(ListQuery.parse(req.query)) })));
router.post("/", requirePermission("labtest:write"), wrap(async (req) => ({ status: 201, data: await createLabTest(CreateBody.parse(req.body), req.user!.userId) })));

/**
 * @openapi
 * /api/lab-tests/{id}:
 *   get:
 *     tags: [Kalite]
 *     summary: Lab testi ayrıntısı + sonuçlar
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Test }
 *   delete:
 *     tags: [Kalite]
 *     summary: Taslak lab testini sil (yalnız DRAFT; onaylı test iptal edilir)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Silinen test }
 *       409: { description: LAB_TEST_NOT_DRAFT }
 */
router.get("/:id", requirePermission("labtest:read"), wrap(async (req) => ({ status: 200, data: await getLabTest(Id.parse(req.params.id)) })));
router.delete("/:id", requirePermission("labtest:write"), wrap(async (req) => ({ status: 200, data: await deleteDraftLabTest(Id.parse(req.params.id), req.user!.userId) })));

/**
 * @openapi
 * /api/lab-tests/{id}/results:
 *   put:
 *     tags: [Kalite]
 *     summary: Sonuç yaz (tür başına tek satır; yalnız DRAFT, aksi 409 LAB_TEST_LOCKED)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Test }
 *       409: { description: LAB_TEST_LOCKED }
 * /api/lab-tests/{id}/results/{testTypeId}:
 *   delete:
 *     tags: [Kalite]
 *     summary: Sonuç sil (yalnız DRAFT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: testTypeId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Test }
 */
router.put("/:id/results", requirePermission("labtest:write"), wrap(async (req) => ({ status: 200, data: await upsertLabResult(Id.parse(req.params.id), ResultBody.parse(req.body), req.user!.userId) })));
router.delete("/:id/results/:testTypeId", requirePermission("labtest:write"), wrap(async (req) => ({ status: 200, data: await deleteLabResult(Id.parse(req.params.id), Id.parse(req.params.testTypeId), req.user!.userId) })));

/**
 * @openapi
 * /api/lab-tests/{id}/approve:
 *   post:
 *     tags: [Kalite]
 *     summary: Onayla (DRAFT → APPROVED; sonuçsuz test 400 LAB_TEST_EMPTY)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Test }
 * /api/lab-tests/{id}/void-preview:
 *   get:
 *     tags: [Kalite]
 *     summary: İptal önizlemesi (etkilenen test + sonuçlar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Önizleme }
 * /api/lab-tests/{id}/void:
 *   post:
 *     tags: [Kalite]
 *     summary: İptal et (gerekçe ≥ 3; DRAFT ya da APPROVED → VOIDED)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Test }
 */
router.post("/:id/approve", requirePermission("labtest:approve"), wrap(async (req) => ({ status: 200, data: await approveLabTest(Id.parse(req.params.id), req.user!.userId) })));
router.get("/:id/void-preview", requirePermission("labtest:approve"), wrap(async (req) => ({ status: 200, data: await voidPreviewLabTest(Id.parse(req.params.id)) })));
router.post("/:id/void", requirePermission("labtest:approve"), wrap(async (req) => ({ status: 200, data: await voidLabTest(Id.parse(req.params.id), VoidBody.parse(req.body).reason, req.user!.userId) })));

export default router;
