// =============================================================================
// TeksERP - Customer Alias Routes
// =============================================================================
// Mount: /api/customers/:customerId/aliases (suggest)
//        /api/customers/:customerId/item-aliases/:itemId
//        /api/customers/:customerId/color-aliases/:colorId
// =============================================================================

import { Router } from "express";
import { CustomerAliasController } from "../controllers/customer-alias.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new CustomerAliasController();
const router = Router({ mergeParams: true });

/**
 * @openapi
 * /api/customers/{customerId}/aliases/suggest:
 *   get:
 *     tags: [Customer Aliases]
 *     summary: Sipariş girişinde alias önerisi (item + color tek atış)
 *     description: |
 *       Planlamacı sipariş satırı eklerken müşteri + ürün + (opsiyonel renk)
 *       seçince çağrılır. Master tablodan o müşteri için tanımlı alias varsa
 *       döner. Frontend bu değeri default olarak göster, planlamacı override
 *       edebilir → OrderLine.customerItemName / customerColorName olarak yazılır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: colorId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "{ itemAlias, colorAlias } (her ikisi de null olabilir)"
 */
router.get(
  "/aliases/suggest",
  verifyToken,
  requirePermission("customer-alias:read"),
  controller.suggest,
);

// ---- ITEM ALIASES ----

/**
 * @openapi
 * /api/customers/{customerId}/item-aliases:
 *   get:
 *     tags: [Customer Aliases]
 *     summary: Müşterinin tüm ürün alias'ları
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Liste }
 */
router.get(
  "/item-aliases",
  verifyToken,
  requirePermission("customer-alias:read"),
  controller.listItemAliases,
);

/**
 * @openapi
 * /api/customers/{customerId}/item-aliases/{itemId}:
 *   put:
 *     tags: [Customer Aliases]
 *     summary: Ürün alias'ı upsert
 *     description: |
 *       Bir müşteri-ürün çifti için alias yazar. Varsa günceller, yoksa
 *       oluşturur (idempotent). OrderLine override'ı bu işlemden etkilenmez —
 *       master değişti ama OrderLine.customerItemName dolu olan satırlar
 *       eski değerini korur.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [alias]
 *             properties:
 *               alias: { type: string, maxLength: 200 }
 */
router.put(
  "/item-aliases/:itemId",
  verifyToken,
  requirePermission("customer-alias:write"),
  controller.upsertItemAlias,
);

/**
 * @openapi
 * /api/customers/{customerId}/item-aliases/{itemId}:
 *   delete:
 *     tags: [Customer Aliases]
 *     summary: Ürün alias'ını sil
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/item-aliases/:itemId",
  verifyToken,
  requirePermission("customer-alias:write"),
  controller.deleteItemAlias,
);

// ---- COLOR ALIASES ----

/**
 * @openapi
 * /api/customers/{customerId}/color-aliases:
 *   get:
 *     tags: [Customer Aliases]
 *     summary: Müşterinin tüm renk alias'ları
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/color-aliases",
  verifyToken,
  requirePermission("customer-alias:read"),
  controller.listColorAliases,
);

/**
 * @openapi
 * /api/customers/{customerId}/color-aliases/{colorId}:
 *   put:
 *     tags: [Customer Aliases]
 *     summary: Renk alias'ı upsert
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [alias]
 *             properties:
 *               alias: { type: string, maxLength: 200 }
 */
router.put(
  "/color-aliases/:colorId",
  verifyToken,
  requirePermission("customer-alias:write"),
  controller.upsertColorAlias,
);

/**
 * @openapi
 * /api/customers/{customerId}/color-aliases/{colorId}:
 *   delete:
 *     tags: [Customer Aliases]
 *     summary: Renk alias'ını sil
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/color-aliases/:colorId",
  verifyToken,
  requirePermission("customer-alias:write"),
  controller.deleteColorAlias,
);

export default router;
