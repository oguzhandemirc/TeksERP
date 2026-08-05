// =============================================================================
// TeksERP - Customer (Müşteri / Fasoncu) Routes
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { CustomerService } from "../services/customer.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const MOBILE_CUSTOMER_READ = ["mobile:tarti-paket", "mobile:sevkiyat", "mobile:fason-sevk", "mobile:fason-kabul", "mobile:tambur", "mobile:siparis"] as const;
import branchRoutes from "./customer-branch.routes";
import aliasRoutes from "./customer-alias.routes";
import templateRouteRoutes from "./customer-template-route.routes";
import standaloneLabelRoutes from "./customer-standalone-label.routes";

const service = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  // exportCode aramada: sevk belgesindeki ihracat kodundan müşteri bulunabilsin.
  searchFields: ["code", "name", "taxNumber", "exportCode"],
  defaultInclude: undefined,
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "müşteri",
  // Tek-adım müşteri+şube: create body'sindeki opsiyonel `branches[]` sanitize'ı
  // geçip Prisma nested-create'e (`{ create: [...] }`) sarılır. CustomerService.create
  // diziyi ÖNCE doğrular/şekillendirir (mass-assignment guard); update'te düşürülür.
  nestedCreateFields: ["branches"],
});

const controller = new BaseController(service);
const router = Router();

router.use("/:customerId/branches", branchRoutes);
// /api/customers/:customerId/{aliases/suggest, item-aliases/:itemId, color-aliases/:colorId}
router.use("/:customerId", aliasRoutes);
// /api/customers/:customerId/template-routes — müşteriye özel etiket şablonu ataması
router.use("/:customerId", templateRouteRoutes);
// /api/customers/:customerId/standalone-labels — müşteriye bağlı serbest etiketler (M:N; rota DEĞİL)
router.use("/:customerId", standaloneLabelRoutes);

/**
 * @openapi
 * /api/customers:
 *   get:
 *     tags: [Customers]
 *     summary: Müşteri/Fasoncu listesi
 *     description: Tüm müşterileri filtre, sıralama ve sayfalama ile listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Kod, isim veya vergi numarasında arama
 *       - in: query
 *         name: filter[type]
 *         schema: { type: string, enum: [CUSTOMER, SUPPLIER, SUBCONTRACTOR] }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200:
 *         description: Sayfalanmış müşteri listesi
 */
router.get("/", verifyToken, requireAnyPermission("customer:read", ...MOBILE_CUSTOMER_READ), controller.findAll);

/**
 * @openapi
 * /api/customers/{id}:
 *   get:
 *     tags: [Customers]
 *     summary: Müşteri detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Müşteri detayı
 *       404:
 *         description: Kayıt bulunamadı
 */
router.get("/:id", verifyToken, requireAnyPermission("customer:read", ...MOBILE_CUSTOMER_READ), controller.findById);

/**
 * @openapi
 * /api/customers:
 *   post:
 *     tags: [Customers]
 *     summary: Yeni müşteri/fasoncu oluştur
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code: { type: string, example: "MUS-010" }
 *               name: { type: string, example: "Yeni Tekstil Ltd." }
 *               taxNumber: { type: string }
 *               type: { type: string, enum: [CUSTOMER, SUPPLIER, SUBCONTRACTOR], default: CUSTOMER }
 *               exportCode: { type: string, description: "İhracat kodu — sevk belgelerinde şube kodu yoksa basılır" }
 *               address: { type: string }
 *               city: { type: string }
 *               district: { type: string }
 *               country: { type: string }
 *               contactName: { type: string }
 *               contactPhone: { type: string }
 *               email: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Müşteri oluşturuldu
 *       409:
 *         description: Kod zaten mevcut
 */
router.post("/", verifyToken, requirePermission("customer:write"), controller.create);

/**
 * @openapi
 * /api/customers/{id}:
 *   patch:
 *     tags: [Customers]
 *     summary: Müşteri bilgilerini güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               taxNumber: { type: string }
 *               type: { type: string, enum: [CUSTOMER, SUPPLIER, SUBCONTRACTOR] }
 *               exportCode: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               district: { type: string }
 *               country: { type: string }
 *               contactName: { type: string }
 *               contactPhone: { type: string }
 *               email: { type: string }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Güncellendi
 */
router.patch("/:id", verifyToken, requirePermission("customer:write"), controller.update);

/**
 * @openapi
 * /api/customers/{id}:
 *   delete:
 *     tags: [Customers]
 *     summary: Müşteriyi pasife al
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pasife alındı
 */
router.delete("/:id", verifyToken, requirePermission("customer:write"), controller.remove);

/**
 * @openapi
 * /api/customers/{id}/permanent:
 *   delete:
 *     tags: [Customers]
 *     summary: Müşteriyi kalıcı olarak sil
 *     description: Veriyi veritabanından tamamen kaldırır. Bu işlem geri alınamaz.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Kalıcı olarak silindi
 *       404:
 *         description: Kayıt bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("customer:write"), controller.hardRemove);

export default router;
