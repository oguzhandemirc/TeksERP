// =============================================================================
// KUMAŞ TÜRÜ (K8) + LİF TÜRÜ (K7) katalogları — ayarlanabilir kısa listeler (Seyitoğlu 2026-11-25)
// =============================================================================
// Ürün kartının tanım listeleri → izin ürün kartıyla aynı (`item:read` / `item:write`); yeni izin kodu yok.
// SİLME UCU YOK (kullanıcı kararı): kullanılmayan tür de pasife alınır; pasif tür seçicide çıkmaz, eski kart okur.
// Listede `_count` = "N yerde kullanılıyor" bandının kaynağı.
// =============================================================================
import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

export const fabricTypeService = new BaseService({
  modelName: "fabricType",
  tableName: "FABRIC_TYPE",
  searchFields: ["name"],
  defaultInclude: { _count: { select: { items: true } } },
  uniqueField: "name",
  duplicateNameField: "name",
  entityLabel: "kumaş türü",
  preserveCaseFields: ["name"],
});

export const fiberTypeService = new BaseService({
  modelName: "fiberType",
  tableName: "FIBER_TYPE",
  searchFields: ["name", "abbreviation"],
  defaultInclude: { _count: { select: { itemFibers: true } } },
  uniqueField: "name",
  duplicateNameField: "name",
  entityLabel: "lif türü",
  preserveCaseFields: ["name", "abbreviation"],
});

function crudRouter(service: BaseService): Router {
  const controller = new BaseController(service);
  const router = Router();
  router.use(verifyToken);
  router.get("/", requireAnyPermission("item:read", "item:write"), controller.findAll);
  router.get("/:id", requireAnyPermission("item:read", "item:write"), controller.findById);
  router.post("/", requirePermission("item:write"), controller.create);
  router.patch("/:id", requirePermission("item:write"), controller.update);
  return router;
}

/**
 * @openapi
 * /api/fabric-types:
 *   get:
 *     tags: [Items]
 *     summary: Kumaş türleri (Tül, Fon, Blackout…) — `_count.items` kullanım sayısı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *   post:
 *     tags: [Items]
 *     summary: Kumaş türü ekler ({ name, sortOrder?, isActive? })
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 * /api/fabric-types/{id}:
 *   get:
 *     tags: [Items]
 *     summary: Kumaş türü
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Kayıt }
 *   patch:
 *     tags: [Items]
 *     summary: Kumaş türünü düzenler / pasife alır (silme yok)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Güncellendi }
 */
export const fabricTypeRoutes = crudRouter(fabricTypeService);

/**
 * @openapi
 * /api/fiber-types:
 *   get:
 *     tags: [Items]
 *     summary: Lif türleri (Polyester, Pamuk, Viskon…) — `_count.itemFibers` kullanım sayısı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *   post:
 *     tags: [Items]
 *     summary: Lif türü ekler ({ name, abbreviation?, sortOrder?, isActive? })
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 * /api/fiber-types/{id}:
 *   get:
 *     tags: [Items]
 *     summary: Lif türü
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Kayıt }
 *   patch:
 *     tags: [Items]
 *     summary: Lif türünü düzenler / pasife alır (silme yok)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Güncellendi }
 */
export const fiberTypeRoutes = crudRouter(fiberTypeService);
