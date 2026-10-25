// =============================================================================
// TeksERP - 4 puan kural setleri (/api/four-point-rules) — K4P-MOTOR, plan §3.2
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireKaliteGuvenceEnabled } from "../middlewares/module.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import * as svc from "../services/four-point-rule.service";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireKaliteGuvenceEnabled);

const READ = requirePermission("inspection:read");
const RULES = requirePermission("inspection:rules");

type Handler = (req: Request) => Promise<unknown>;
const wrap = (h: Handler, status = 200) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => h(req))
    .then((data) => res.status(status).json({ success: true, data }), next);
};
const idOf = (req: Request) => assertValidUuid(req.params.id, "id");
const userOf = (req: Request): string => {
  const id = req.user?.userId;
  if (!id) throw AppError.unauthorized("Oturum gerekli.");
  return id;
};

const Band = z.strictObject({
  sortOrder: z.number().int("Sıra tam sayı olmalı").min(0, "Sıra negatif olamaz"),
  maxScore: z.union([z.number().min(0, "Üst sınır negatif olamaz"), z.string().regex(/^\d+(\.\d{1,2})?$/, "Üst sınır sayı olmalı")]).nullable(),
  label: z.string().trim().min(1, "Bant etiketi boş olamaz").max(16, "Bant etiketi en fazla 16 karakter"),
  accepted: z.boolean("Kabul alanı evet/hayır olmalı"),
  qualityGradeId: z.uuid("Kalite derecesi kimliği geçersiz").nullable().optional(),
});
const Editable = {
  name: z.string().trim().min(1, "Ad boş olamaz").max(80, "Ad en fazla 80 karakter"),
  unit: z.enum(["M2", "YD2"], "Birim M2 ya da YD2 olmalı").optional(),
  runningCap: z.enum(["NONE", "METER", "YARD"], "Koşu tavanı NONE, METER ya da YARD olmalı").optional(),
  bands: z.array(Band).min(1, "En az bir bant tanımlanmalı").max(20, "En fazla 20 bant"),
};
const CreateSchema = z.strictObject({
  ...Editable,
  scope: z.enum(["FACTORY", "CUSTOMER"], "Kapsam FACTORY ya da CUSTOMER olmalı"),
  customerId: z.uuid("Müşteri kimliği geçersiz").nullable().optional(),
  itemId: z.uuid("Ürün kimliği geçersiz").nullable().optional(),
});
const UpdateSchema = z.strictObject(Editable);
const ActiveSchema = z.strictObject({ isActive: z.boolean("isActive evet/hayır olmalı") });
const body = <T extends z.ZodType>(s: T, req: Request) => s.parse(req.body ?? {});

/**
 * @openapi
 * /api/four-point-rules:
 *   get:
 *     tags: [FourPointRules]
 *     summary: "Kural setleri (varsayılan yalnız aktif; ?includeInactive=1)"
 *     security: [{ bearerAuth: [] }]
 *   post:
 *     tags: [FourPointRules]
 *     summary: "Kural seti oluştur (bantlarla); tek aktif fabrika seti — 409 FOUR_POINT_RULE_ACTIVE_EXISTS"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", READ, wrap((req) => svc.listRuleSets(req.query as Record<string, string>)));
router.post("/", RULES, wrap((req) => svc.createRuleSet(body(CreateSchema, req), userOf(req)), 201));

/**
 * @openapi
 * /api/four-point-rules/{id}:
 *   get:
 *     tags: [FourPointRules]
 *     summary: "Kural seti detayı"
 *     security: [{ bearerAuth: [] }]
 *   put:
 *     tags: [FourPointRules]
 *     summary: "Kural setini güncelle — bantlar tek tx'te değiştirilir; geçmiş muayene etkilenmez"
 *     security: [{ bearerAuth: [] }]
 * /api/four-point-rules/{id}/active:
 *   post:
 *     tags: [FourPointRules]
 *     summary: "Pasife al / etkinleştir"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id", READ, wrap((req) => svc.getRuleSet(idOf(req))));
router.put("/:id", RULES, wrap((req) => svc.updateRuleSet(idOf(req), body(UpdateSchema, req), userOf(req))));
router.post("/:id/active", RULES, wrap((req) => svc.setRuleSetActive(idOf(req), body(ActiveSchema, req).isActive, userOf(req))));

export default router;
