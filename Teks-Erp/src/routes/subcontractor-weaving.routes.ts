// =============================================================================
// TeksERP — Fason Dokuma Routes · levent sevki / top kabulü / özet (G2, 2026-09-14)
// =============================================================================
// ÜÇ KAPI SIRAYLA (machine-doff emsali): `verifyToken` → `requireDokumaEnabled`
// (fason dokuma dokuma işinin olayıdır) → izin. İzinler YENİ KOD AÇMAZ: sevk/kabul
// dokuma işinin yazma izni (`weavingorder:write`) ya da tabletin fason ekran
// izinleri (`mobile:fason-sevk` / `mobile:fason-kabul`); özet `weavingorder:read`.
// Levent DÖNÜŞÜ bu dosyada değil — F1'in ucu (`/api/subcontractor/dispatches/:id/
// beams/return`) sevk başlığına bakmaz, dokuma sevkinde de aynen çalışır.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { cancelWeavingDispatch, dispatchForWeaving, receiveForWeaving } from "../services/subcontractor-weaving.service";
import {
  cancelWeavingReceipt,
  getWeavingSubcontractSummary,
  previewCancelWeavingReceipt,
} from "../services/subcontractor-weaving-receipt.service";

const router = Router();

router.use(verifyToken, requireDokumaEnabled);

const MOBILE_FASON_SEVK = ["mobile:fason-sevk"] as const;
const MOBILE_FASON_KABUL = ["mobile:fason-kabul"] as const;

const dispatchSchema = z
  .object({
    weavingOrderId: z.string().uuid("Geçersiz dokuma işi"),
    warpBeamIds: z.array(z.string().uuid("Geçersiz levent")).min(1, "En az bir levent seçilmeli").max(50),
    plateNumber: z.string().trim().max(32).nullish(),
    driverName: z.string().trim().max(120).nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict();

const reasonSchema = z.object({ reason: z.string().trim().min(3, "Sebep en az 3 karakter") }).strict();

const receiptSchema = z
  .object({
    weavingOrderId: z.string().uuid("Geçersiz dokuma işi"),
    manifestNo: z.string().trim().max(64).nullish(),
    notes: z.string().trim().max(500).nullish(),
    clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish(),
    rolls: z
      .array(
        z
          .object({
            initialQty: z.number().positive("Metre pozitif olmalı").max(100_000),
            weightKg: z.number().nonnegative().max(10_000).nullish(),
            width: z.number().positive().max(1_000).nullish(),
            qualityGrade: z.string().trim().max(16).nullish(),
            colorId: z.string().uuid("Geçersiz renk").nullish(),
            propertyIds: z.array(z.string().uuid()).max(50).optional(),
            clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
          })
          .strict(),
      )
      .min(1, "En az bir top")
      .max(200),
  })
  .strict();

/**
 * @openapi
 * /api/subcontractor-weaving/dispatches:
 *   post:
 *     tags: [SubcontractorWeaving]
 *     summary: Fason dokuma sevki — dokuma işi adına LEVENT fasona gider
 *     description: >
 *       Başlık dokuma işine bağlı (iş emri/adım/parti YOK, CHECK `subcontractor_dispatches_header_ck`).
 *       İş SUBCONTRACTED ∧ açık olmalı (claim tx'in ilk ifadesi; PLANNED → IN_PROGRESS).
 *       Kalem defteri F1: her levent SHIP_OUT (READY → SHIPPED_OUT). Fasoncu kendi
 *       ipliğini kullanıyorsa bu belge hiç açılmaz.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Sevk açıldı }
 *       400: { description: Doğrulama / levent yok }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       409: { description: WEAVING_ORDER_NOT_SUBCONTRACTED · WEAVING_ORDER_NOT_OPEN · levent READY değil }
 */
router.post("/dispatches", requireAnyPermission("weavingorder:write", ...MOBILE_FASON_SEVK), async (req, res, next) => {
  try {
    const b = dispatchSchema.parse(req.body ?? {});
    res.status(201).json(await dispatchForWeaving(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/subcontractor-weaving/dispatches/{id}/cancel:
 *   post:
 *     tags: [SubcontractorWeaving]
 *     summary: Fason dokuma sevkini iptal et (dönmüş levent varsa 409, LIFO)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi, leventler READY }
 *       404: { description: Sevk yok }
 *       409: { description: DISPATCH_NOT_WEAVING_BOUND · WARP_BEAM_RETURNED · DISPATCH_CANCELLED }
 */
router.post("/dispatches/:id/cancel", requireAnyPermission("weavingorder:write", ...MOBILE_FASON_SEVK), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "Sevk");
    const b = reasonSchema.parse(req.body ?? {});
    res.json(await cancelWeavingDispatch(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/subcontractor-weaving/receipts:
 *   post:
 *     tags: [SubcontractorWeaving]
 *     summary: Fason dokuma kabulü — makbuz açılır, TOPLAR doğar (entrySource=WEAVING)
 *     description: >
 *       Makbuz kalemi yok; her satır `createInitialEntry(forcedEntrySource: WEAVING, parentReceiptId)`
 *       ile kendi tx'inde doğar (mal kabul emsali) — satır hatası makbuzu düşürmez, `failed[]`e düşer.
 *       `clientToken` makbuz replay kimliği (iptal edilmişse 409 RECEIPT_CANCELLED).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "Makbuz + doğan toplar + failed[]" }
 *       409: { description: WEAVING_ORDER_NOT_SUBCONTRACTED · WEAVING_ORDER_NOT_OPEN · RECEIPT_CANCELLED }
 */
router.post("/receipts", requireAnyPermission("weavingorder:write", ...MOBILE_FASON_KABUL), async (req, res, next) => {
  try {
    const b = receiptSchema.parse(req.body ?? {});
    res.status(201).json(await receiveForWeaving(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/subcontractor-weaving/receipts/{id}/cancel-preview:
 *   get:
 *     tags: [SubcontractorWeaving]
 *     summary: Makbuz iptali önizlemesi — doğan her top ve engeli
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "bornRolls[] + canCancel" }
 */
router.get("/receipts/:id/cancel-preview", requireAnyPermission("weavingorder:write", ...MOBILE_FASON_KABUL), async (req, res, next) => {
  try {
    res.json(await previewCancelWeavingReceipt(assertValidUuid(req.params.id, "Makbuz")));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/subcontractor-weaving/receipts/{id}/cancel:
 *   post:
 *     tags: [SubcontractorWeaving]
 *     summary: Makbuzu iptal et — yalnız doğan topların HEPSİ iptal edilmişse
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: "BORN_ROLLS_ALIVE (barcodes[]) · RECEIPT_CANCELLED · DISPATCH_NOT_WEAVING_BOUND" }
 */
router.post("/receipts/:id/cancel", requireAnyPermission("weavingorder:write", ...MOBILE_FASON_KABUL), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "Makbuz");
    const b = reasonSchema.parse(req.body ?? {});
    res.json(await cancelWeavingReceipt(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/subcontractor-weaving/weaving-orders/{id}/summary:
 *   get:
 *     tags: [SubcontractorWeaving]
 *     summary: Dokuma işinin fason özeti — sevkler, makbuzlar, doğan toplar, çözgü-metresi mutabakatı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "dispatches[] · receipts[] · totals" }
 */
router.get("/weaving-orders/:id/summary", requirePermission("weavingorder:read"), async (req, res, next) => {
  try {
    res.json(await getWeavingSubcontractSummary(assertValidUuid(req.params.id, "Dokuma işi")));
  } catch (e) {
    next(e);
  }
});

export default router;
