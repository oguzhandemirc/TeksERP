// =============================================================================
// CARİ KİLİDİ ROTALARI (D4-I1a, ister 4.7) — `/api/finance/cari/...`
// =============================================================================
// ⚠️ KENDİ BAŞINA MOUNT EDİLMEZ: `finance.routes.ts` içinde `router.use("/cari", cariHoldRoutes)` ile bağlanır ve
// oradaki `router.use(verifyToken, requireFinanceEnabled)` kapısını miras alır (`finance-allocation.routes` emsali).
// Koymak `finance:hold`, açmak `finance:hold-release` (SoD kümesi). Kapı entegrasyonu (gelen belge/sipariş/sevk/
// fatura) D4-I1b'de; bu uçlar yalnız kilit satırını yönetir.
// =============================================================================
import { Router, type Request } from "express";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { cariHoldService } from "../services/cari-hold.service";
import { CARI_HOLD_REASON_CODES } from "../services/helpers/cari-hold.helper";
import { AppError } from "../utils/app-error";

const router = Router();

const uuidParam = (v: unknown, label: string): string => {
  const r = z.uuid().safeParse(v);
  if (!r.success) throw AppError.badRequest(`Geçersiz ${label}.`);
  return r.data;
};

// Kilit satırı koyanı/açanı zorunlu taşır (DB CHECK); oturumsuz istek verifyToken'da düşer, bu yalnız tip savunması.
const actor = (req: Request): string => {
  const id = req.user?.userId;
  if (!id) throw AppError.unauthorized("Oturum gerekli.");
  return id;
};

const placeSchema = z.strictObject({
  blocksIntake: z.boolean({ error: "Yeni iş kabulü kapsamı evet/hayır olmalı" }),
  blocksShipment: z.boolean({ error: "Sevk kapsamı evet/hayır olmalı" }),
  blocksInvoice: z.boolean({ error: "Fatura onayı kapsamı evet/hayır olmalı" }),
  reasonCode: z.enum(CARI_HOLD_REASON_CODES, { error: "Kilit sebebi BORC, RISK, ANLASMAZLIK ya da DIGER olmalı" }),
  reasonText: z.string().trim().max(300, "Açıklama en çok 300 karakter olabilir").nullable().optional(),
  clientToken: z.uuid({ error: "clientToken geçerli bir UUID olmalı" }),
});
const releaseSchema = z.strictObject({
  reason: z.string({ error: "Açma sebebi zorunlu" }).trim().min(3, "Açma sebebi en az 3 karakter olmalı").max(300, "Açma sebebi en çok 300 karakter olabilir"),
});

/**
 * @openapi
 * /api/finance/cari/{id}/holds:
 *   get:
 *     tags: [Finance]
 *     summary: Carinin aktif kilidi + kilit tarihçesi (D4-I1a)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ data: { active, history[] } } — satırda kapsam, sebep kodu/etiketi, koyan/açan adı ve tarihleri" }
 *       404: { description: CARI_ACCOUNT_NOT_FOUND }
 *   post:
 *     tags: [Finance]
 *     summary: Cari kilidi koy — yeni iş kabulü / sevk / fatura onayını durdurur (D4-I1a)
 *     description: >
 *       Hesap başına tek AKTİF kilit. Aynı clientToken → aynı kilit (replay). Kapsam en az biri true.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [blocksIntake, blocksShipment, blocksInvoice, reasonCode, clientToken]
 *             properties:
 *               blocksIntake: { type: boolean }
 *               blocksShipment: { type: boolean }
 *               blocksInvoice: { type: boolean }
 *               reasonCode: { type: string, enum: [BORC, RISK, ANLASMAZLIK, DIGER] }
 *               reasonText: { type: string, maxLength: 300, nullable: true }
 *               clientToken: { type: string, format: uuid }
 *     responses:
 *       201: { description: Kilit kondu (ya da token replay) }
 *       400: { description: "CARI_HOLD_SCOPE_EMPTY · CARI_HOLD_NOT_CUSTOMER · doğrulama" }
 *       404: { description: CARI_ACCOUNT_NOT_FOUND }
 *       409: { description: "CARI_HOLD_EXISTS · CARI_INACTIVE · CARI_HOLD_RELEASED · CLIENT_TOKEN_COLLISION" }
 */
/**
 * @openapi
 * /api/finance/cari/by-customer/{customerId}/holds:
 *   get:
 *     tags: [Finance]
 *     summary: Cari kartının kilit bölümü — kartın hesabı + aktif kilit + tarihçe (D4-I3)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: customerId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ data: { cariId, active, history[] } }" }
 *       404: { description: CARI_ACCOUNT_MISSING }
 */
router.get("/by-customer/:customerId/holds", requireAnyPermission("finance:read", "finance:hold"), async (req, res, next) => {
  try {
    res.json(await cariHoldService.listByCustomer(uuidParam(req.params.customerId, "müşteri")));
  } catch (e) {
    next(e);
  }
});

router.get("/:id/holds", requireAnyPermission("finance:read", "finance:hold"), async (req, res, next) => {
  try {
    res.json(await cariHoldService.listByCari(uuidParam(req.params.id, "cari")));
  } catch (e) {
    next(e);
  }
});

router.post("/:id/holds", requirePermission("finance:hold"), async (req, res, next) => {
  try {
    const cariId = uuidParam(req.params.id, "cari");
    const body = placeSchema.parse(req.body);
    res.status(201).json(await cariHoldService.place(cariId, body, actor(req)));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/cari/holds/{holdId}/release:
 *   post:
 *     tags: [Finance]
 *     summary: Cari kilidini aç (D4-I1a; SoD — finance:hold-release)
 *     description: >
 *       Atomik claim; açılmış kilit yeniden açılamaz. `finance.cariHold.releaseBySamePerson` DENY iken kilidi koyan kişi açamaz.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: holdId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string, minLength: 3, maxLength: 300 } } }
 *     responses:
 *       200: { description: Kilit açıldı }
 *       404: { description: CARI_HOLD_NOT_FOUND }
 *       409: { description: "CARI_HOLD_NOT_ACTIVE · CARI_HOLD_SAME_PERSON" }
 */
router.post("/holds/:holdId/release", requirePermission("finance:hold-release"), async (req, res, next) => {
  try {
    const holdId = uuidParam(req.params.holdId, "kilit");
    const body = releaseSchema.parse(req.body);
    res.json(await cariHoldService.release(holdId, body.reason, actor(req)));
  } catch (e) {
    next(e);
  }
});

export default router;
