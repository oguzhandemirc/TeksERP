// =============================================================================
// TeksERP - Customer Branch (global liste) Routes
// =============================================================================
// Salt-okunur global şube listesi. Müşteriye-özel CRUD `/api/customers/:id/branches`
// altında; bu endpoint tüm şubeleri tek listede döndürür (Electron Sevkiyatlar
// FilterBar şube filtresi gibi düz lookup'lar için). branchId FK index'li.
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const service = new BaseService({
  modelName: "customerBranch",
  tableName: "CUSTOMER_BRANCH",
  searchFields: ["name", "code", "city"],
  // Şube adları müşteri arası tekrar edebilir (örn. "Merkez") — etikette müşteri
  // adıyla ayrışsın diye customer'ı lean select ile getir.
  defaultInclude: { customer: { select: { id: true, name: true, code: true } } },
});

const controller = new BaseController(service);
const router = Router();

// Sevkiyatı/siparişi görebilen herkes (web sevkiyat/sipariş veya mobil paket/sevkiyat)
// ya da müşteri okuma yetkisi olan şube filtresini doldurabilsin. Yeni permission yok.
const READ = requireAnyPermission(
  "customer:read",
  "order:read",
  "shipping:read",
  "shipping:write",
  "mobile:tarti-paket",
  "mobile:sevkiyat"
);

/**
 * @openapi
 * /api/customer-branches:
 *   get:
 *     tags: [Customer Branches]
 *     summary: Global şube listesi (lookup) — müşteri adıyla birlikte
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string, description: "name / code / city" }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: filter[customerId]
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sayfalanmış şube listesi (customer dahil) }
 */
router.get("/", verifyToken, READ, controller.findAll);

export default router;
