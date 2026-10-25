// =============================================================================
// TeksERP - 4 puan muayene uçları (/api/quality-inspections) — K4P-MOTOR, plan §4.1–§4.2
// =============================================================================
// Modül kapısı `requireKaliteGuvenceEnabled` (kapalı → 403 MODULE_DISABLED). Tablet operatörü
// yalnız `mobile:muayene` taşır (MOBILE_KK1 şablonu, patron kararı 2026-10-24) — önizleme ve
// yeni muayene bu yüzden web kodu (`inspection:*`) ∨ `mobile:muayene` kabul eder.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireKaliteGuvenceEnabled } from "../middlewares/module.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import * as svc from "../services/quality-inspection.service";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireKaliteGuvenceEnabled);

const READ = requirePermission("inspection:read");
const PREVIEW = requireAnyPermission("inspection:write", "inspection:read", "mobile:muayene");
const WRITE = requireAnyPermission("inspection:write", "mobile:muayene");
const CORRECT = requirePermission("inspection:correct");

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

const decimal = (label: string) => z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/, `${label} sayı olmalı`)]);
const Defect = z.strictObject({
  defectTypeId: z.uuid("Hata türü kimliği geçersiz"),
  sizeClass: z.enum(["UP_TO_3IN", "IN_3_TO_6", "IN_6_TO_9", "OVER_9IN"], "Hata boyutu geçersiz").nullable().optional(),
  startMeter: decimal("Hata metresi").nullable().optional(),
});
const Common = {
  defects: z.array(Defect).max(500, "En fazla 500 hata girilebilir"),
  inspectedLengthM: decimal("Muayene uzunluğu").nullable().optional(),
  manualWidthCm: decimal("En").nullable().optional(),
  stationId: z.uuid("İstasyon kimliği geçersiz").nullable().optional(),
};
// K4P-TABLET: KK1 doğuşunda top henüz yok → `draft {itemId, widthCm?}` (rollId XOR draft; uzunluk inspectedLengthM).
const DraftRoll = z.strictObject({ itemId: z.uuid("Kumaş kimliği geçersiz"), widthCm: decimal("En").nullable().optional() });
const PreviewSchema = z
  .strictObject({
    rollId: z.uuid("Top kimliği geçersiz").optional(),
    draft: DraftRoll.optional(),
    customerId: z.uuid("Müşteri kimliği geçersiz").nullable().optional(),
    ...Common,
  })
  .refine((b) => (b.rollId ? 1 : 0) + (b.draft ? 1 : 0) === 1, { message: "Önizleme için top ya da taslak (kumaş) verilmeli — ikisi birden değil" });
const CreateSchema = z.strictObject({
  rollId: z.uuid("Top kimliği geçersiz"),
  phase: z.enum(["RAW", "FINAL"], "Aşama RAW ya da FINAL olmalı").nullable().optional(),
  ...Common,
  note: z.string().max(500, "Not en fazla 500 karakter olabilir").nullable().optional(),
  deviceId: z.uuid("Cihaz kimliği geçersiz").nullable().optional(),
  clientToken: z.uuid("İşlem kimliği geçersiz").optional(),
});
const ReviseSchema = z.strictObject({
  ...Common,
  note: z.string().max(500, "Not en fazla 500 karakter olabilir").nullable().optional(),
  reviseReason: z.string().trim().min(3, "Düzeltme gerekçesi en az 3 karakter olmalı").max(1000, "Gerekçe en fazla 1000 karakter"),
  clientToken: z.uuid("İşlem kimliği geçersiz").optional(),
});
const VoidSchema = z.strictObject({ reason: z.string().trim().min(3, "İptal gerekçesi en az 3 karakter olmalı").max(1000, "Gerekçe en fazla 1000 karakter") });
const body = <T extends z.ZodType>(s: T, req: Request) => s.parse(req.body ?? {});

/**
 * @openapi
 * /api/quality-inspections:
 *   get:
 *     tags: [QualityInspections]
 *     summary: "Muayene listesi + özet şeridi (aynı where): tarih (fabrika günü), kumaş, derece, aşama, istasyon, operatör, puan aralığı, en bilinmiyor, uyumsuz"
 *     security: [{ bearerAuth: [] }]
 *   post:
 *     tags: [QualityInspections]
 *     summary: "Yeni muayene (panel kâğıttan giriş / tablet bağımsız ekran) — clientToken ile idempotent; 409 INSPECTION_ALREADY_ACTIVE"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", READ, wrap((req) => svc.listInspections(req.query as Record<string, string>)));
router.post("/", WRITE, wrap((req) => svc.create(body(CreateSchema, req), userOf(req)), 201));

/**
 * @openapi
 * /api/quality-inspections/preview:
 *   post:
 *     tags: [QualityInspections]
 *     summary: "Önizleme — yazmaz; puan/100 m², kural seti, derece önerisi (muayeneyle aynı motor). rollId XOR draft {itemId, widthCm?} (KK1 doğuşu)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/preview", PREVIEW, wrap((req) => svc.preview(body(PreviewSchema, req))));

/**
 * @openapi
 * /api/quality-inspections/{id}:
 *   get:
 *     tags: [QualityInspections]
 *     summary: "Muayene detayı: hatalar, hesap dökümü, kural snapshot'ı, revizyon geçmişi"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id", READ, wrap((req) => svc.getInspection(idOf(req))));

/**
 * @openapi
 * /api/quality-inspections/{id}/revise:
 *   post:
 *     tags: [QualityInspections]
 *     summary: "Düzelt — eski revizyon atomik claim (supersededAt), yeni revizyon yazılır; 409 INSPECTION_NOT_ACTIVE"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/revise", CORRECT, wrap((req) => svc.revise(idOf(req), body(ReviseSchema, req), userOf(req)), 201));

/**
 * @openapi
 * /api/quality-inspections/{id}/void-preview:
 *   get:
 *     tags: [QualityInspections]
 *     summary: "İptal önizlemesi — etkilenen muayene, hata sayısı, basılmış rapor numaraları"
 *     security: [{ bearerAuth: [] }]
 * /api/quality-inspections/{id}/void:
 *   post:
 *     tags: [QualityInspections]
 *     summary: "İptal — voidedAt damgası (gerekçe ≥ 3); silme yolu yoktur"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id/void-preview", CORRECT, wrap((req) => svc.voidPreview(idOf(req))));
router.post("/:id/void", CORRECT, wrap((req) => svc.voidInspection(idOf(req), body(VoidSchema, req).reason, userOf(req))));

export default router;
