// =============================================================================
// MASRAF BAĞI ROTALARI (D4-H3, ister 5.3/4.3) — `/api/finance/...`
// =============================================================================
// ⚠️ KENDİ BAŞINA MOUNT EDİLMEZ: `finance.routes.ts` içinde `router.use(expenseAllocationRoutes)` ile bağlanır ve
// oradaki `router.use(verifyToken, requireFinanceEnabled)` kapısını miras alır. Okuma `finance:read`, yazma
// `finance:payment` (kasa masrafını yazan izin; yeni izin yok — DALGA4 §9.7).
// =============================================================================
import { Router, type Request } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import {
  changeExpenseAllocation,
  createExpenseAllocation,
  listExpenseAllocationsForTxn,
  revokeExpenseAllocation,
} from "../services/expense-allocation.service";
import { AppError } from "../utils/app-error";

const router = Router();

const uuidParam = (v: unknown, label: string): string => {
  const r = z.uuid().safeParse(v);
  if (!r.success) throw AppError.badRequest(`Geçersiz ${label}.`);
  return r.data;
};

const actor = (req: Request): string => {
  const id = req.user?.userId;
  if (!id) throw AppError.unauthorized("Oturum gerekli.");
  return id;
};

/** Hedef + pay — kasa masraf formundaki `allocation` gövdesiyle aynı alanlar (token hariç). */
export const allocationFieldsSchema = {
  machineId: z.uuid({ error: "Makine geçersiz" }).nullable().optional(),
  workOrderId: z.uuid({ error: "Terbiye iş emri geçersiz" }).nullable().optional(),
  serviceItemId: z.uuid({ error: "Hizmet kalemi geçersiz" }).nullable().optional(),
  sharePct: z.union([z.string().trim().min(1).max(12), z.number()], { error: "Pay (%) zorunlu" }),
};

const createSchema = z.strictObject({ ...allocationFieldsSchema, clientToken: z.uuid({ error: "clientToken geçerli bir UUID olmalı" }) });
const changeSchema = z.strictObject({
  ...allocationFieldsSchema,
  clientToken: z.uuid({ error: "clientToken geçerli bir UUID olmalı" }),
  reason: z.string().trim().max(300, "Gerekçe en çok 300 karakter olabilir").nullable().optional(),
});
const revokeSchema = z.strictObject({
  reason: z.string({ error: "Kaldırma gerekçesi zorunlu" }).trim().min(3, "Gerekçe en az 3 karakter olmalı").max(300, "Gerekçe en çok 300 karakter olabilir"),
});

/**
 * @openapi
 * /api/finance/cash-transactions/{id}/allocations:
 *   get:
 *     tags: [Finance]
 *     summary: Masrafın makine / terbiye iş emri / hizmet kalemi bağları + tarihçe (D4-H3)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ data: { rows[], activePct, remainingPct } }" }
 *       404: { description: CASH_TXN_NOT_FOUND }
 *   post:
 *     tags: [Finance]
 *     summary: Masrafı bağla — hedef tam olarak biri + pay % (D4-H3)
 *     description: >
 *       Aynı clientToken → aynı bağ (replay). Σ aktif pay en çok 100. `finance.masraf.bagAlani` OFF iken 409.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sharePct, clientToken]
 *             properties:
 *               machineId: { type: string, format: uuid, nullable: true }
 *               workOrderId: { type: string, format: uuid, nullable: true }
 *               serviceItemId: { type: string, format: uuid, nullable: true }
 *               sharePct: { type: string, example: "100" }
 *               clientToken: { type: string, format: uuid }
 *     responses:
 *       201: { description: Bağlandı (ya da token replay) }
 *       400: { description: "EXPENSE_ALLOCATION_TARGET · EXPENSE_ALLOCATION_SHARE · EXPENSE_ALLOCATION_NOT_EXPENSE · EXPENSE_ALLOCATION_NOT_SERVICE_ITEM" }
 *       409: { description: "EXPENSE_ALLOCATION_OVER · CASH_TXN_CANCELLED · kapalı kasa dönemi · MACHINE_INACTIVE · WORK_ORDER_CLOSED · EXPENSE_ALLOCATION_DISABLED · CLIENT_TOKEN_COLLISION" }
 */
router.get("/cash-transactions/:id/allocations", requirePermission("finance:read"), async (req, res, next) => {
  try {
    res.json(await listExpenseAllocationsForTxn(uuidParam(req.params.id, "kasa hareketi")));
  } catch (e) {
    next(e);
  }
});

router.post("/cash-transactions/:id/allocations", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const id = uuidParam(req.params.id, "kasa hareketi");
    const body = createSchema.parse(req.body);
    res.status(201).json(await createExpenseAllocation(id, body, actor(req)));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/expense-allocations/{id}/change:
 *   post:
 *     tags: [Finance]
 *     summary: Masraf bağını değiştir — eski bağ damgalanır, yeni bağ yazılır (tek tx, D4-H3)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Değiştirildi (ya da token replay) }
 *       409: { description: "EXPENSE_ALLOCATION_NOT_ACTIVE · EXPENSE_ALLOCATION_OVER · CASH_TXN_CANCELLED · kapalı dönem" }
 * /api/finance/expense-allocations/{id}/revoke:
 *   post:
 *     tags: [Finance]
 *     summary: Masraf bağını kaldır — damga (D4-H3; ayar kapalıyken de açık)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string, minLength: 3, maxLength: 300 } } }
 *     responses:
 *       200: { description: Kaldırıldı }
 *       404: { description: EXPENSE_ALLOCATION_NOT_FOUND }
 *       409: { description: "EXPENSE_ALLOCATION_NOT_ACTIVE · CASH_TXN_CANCELLED · kapalı dönem" }
 */
router.post("/expense-allocations/:id/change", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const id = uuidParam(req.params.id, "masraf bağı");
    const body = changeSchema.parse(req.body);
    res.json(await changeExpenseAllocation(id, body, actor(req)));
  } catch (e) {
    next(e);
  }
});

router.post("/expense-allocations/:id/revoke", requirePermission("finance:payment"), async (req, res, next) => {
  try {
    const id = uuidParam(req.params.id, "masraf bağı");
    const body = revokeSchema.parse(req.body);
    res.json(await revokeExpenseAllocation(id, body.reason, actor(req)));
  } catch (e) {
    next(e);
  }
});

export default router;
