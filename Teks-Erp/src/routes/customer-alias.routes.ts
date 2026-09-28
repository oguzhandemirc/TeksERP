// =============================================================================
// TeksERP - Customer Alias Routes
// =============================================================================
// Mount: /api/customers/:customerId/aliases (suggest)
//        /api/customers/:customerId/item-aliases/:itemId
//        /api/customers/:customerId/color-aliases/:colorId
//        /api/customers/:customerId/item-color-aliases/:itemId/:colorId
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

// ---- KUMAŞA ÖZEL RENK ADLARI (müşteri × kumaş × renk) ----

/**
 * @openapi
 * /api/customers/{customerId}/item-color-aliases:
 *   get:
 *     tags: [Customer Aliases]
 *     summary: Müşterinin kumaşa özel renk adları
 *     description: |
 *       Müşterinin yalnız belirli bir kumaştaki renge verdiği adlar. Etiket,
 *       irsaliye ve ekranlarda genel renk adını o kumaşta gölgeler.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "Liste — satır + item + color özeti; createdAt desc, id desc" }
 *       400: { description: Müşteri pasif }
 *       404: { description: Müşteri bulunamadı }
 */
router.get(
  "/item-color-aliases",
  verifyToken,
  requirePermission("customer-alias:read"),
  controller.listItemColorAliases,
);

/**
 * @openapi
 * /api/customers/{customerId}/item-color-aliases/{itemId}/{colorId}:
 *   put:
 *     tags: [Customer Aliases]
 *     summary: Kumaşa özel renk adı upsert
 *     description: |
 *       Idempotent. Kapılar: müşteri aktif, kumaş tanım alabilir (Pasif/"Tükenene
 *       kadar" → 409 ITEM_INACTIVE/ITEM_PHASE_OUT), renk aktif. Eşzamanlı ilk
 *       yazım yarışı → 409 ITEM_COLOR_ALIAS_CONFLICT.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: customerId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: colorId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [alias]
 *             properties:
 *               alias: { type: string, maxLength: 200 }
 *     responses:
 *       200: { description: Satır }
 *       400: { description: Doğrulama / UUID / pasif müşteri ya da renk }
 *       404: { description: Müşteri ya da renk bulunamadı }
 *       409: { description: Kumaş kapısı ya da eşzamanlı yazım }
 */
router.put(
  "/item-color-aliases/:itemId/:colorId",
  verifyToken,
  requirePermission("customer-alias:write"),
  controller.upsertItemColorAlias,
);

/**
 * @openapi
 * /api/customers/{customerId}/item-color-aliases/{itemId}/{colorId}:
 *   delete:
 *     tags: [Customer Aliases]
 *     summary: Kumaşa özel renk adını sil
 *     description: Saf yapılandırma pivotu (③b); kart kapısı yok. Satır yoksa 404 ITEM_COLOR_ALIAS_NOT_FOUND.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: customerId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: colorId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ deleted: true }" }
 *       404: { description: Satır yok }
 */
router.delete(
  "/item-color-aliases/:itemId/:colorId",
  verifyToken,
  requirePermission("customer-alias:write"),
  controller.deleteItemColorAlias,
);

export default router;
