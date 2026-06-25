// =============================================================================
// TeksERP - Printer Model & Label Format Profile Routes
// =============================================================================
// Mount: /api/printer-models, /api/label-format-profiles
//
// Yazıcı modeli kataloğu + etiket fiziksel format profilleri (medya boyutu +
// güvenlik payı). MachineHardware bunlara REFERANS tutar → yazıcı değişse de
// tanımlar kalıcı. İzin: donanım ailesi `station:read/write` (yeni permission YOK).
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { PrinterModelService, LabelFormatProfileService } from "../services/printer.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

// --- Printer Model (yazıcı katalog: Argox OS 214 plus vb.) ---
const printerModelService = new PrinterModelService({
  modelName: "printerModel",
  tableName: "PRINTER_MODEL",
  searchFields: ["code", "name", "manufacturer"],
  defaultInclude: { defaultProfile: { select: { id: true, code: true, name: true } } },
  uniqueField: "code",
});
const printerModelController = new BaseController(printerModelService);

// --- Label Format Profile (fiziksel etiket geometrisi + pay) ---
const labelFormatProfileService = new LabelFormatProfileService({
  modelName: "labelFormatProfile",
  tableName: "LABEL_FORMAT_PROFILE",
  searchFields: ["code", "name"],
  uniqueField: "code",
});
const labelFormatProfileController = new BaseController(labelFormatProfileService);

// =============================================================================
// PRINTER MODEL ENDPOINTS (/api/printer-models)
// =============================================================================
/**
 * @openapi
 * /api/printer-models:
 *   get: { tags: [Printers], summary: Yazıcı modeli listesi, security: [{ bearerAuth: [] }], responses: { 200: { description: Liste } } }
 *   post: { tags: [Printers], summary: Yazıcı modeli oluştur, security: [{ bearerAuth: [] }], responses: { 201: { description: Oluşturuldu } } }
 */
export const printerModelRouter = Router();
printerModelRouter.get("/", verifyToken, requirePermission("station:read"), printerModelController.findAll);
printerModelRouter.get("/:id", verifyToken, requirePermission("station:read"), printerModelController.findById);
printerModelRouter.post("/", verifyToken, requirePermission("station:write"), printerModelController.create);
printerModelRouter.patch("/:id", verifyToken, requirePermission("station:write"), printerModelController.update);
printerModelRouter.delete("/:id", verifyToken, requirePermission("station:write"), printerModelController.remove);
printerModelRouter.delete("/:id/permanent", verifyToken, requirePermission("station:write"), printerModelController.hardRemove);

// =============================================================================
// LABEL FORMAT PROFILE ENDPOINTS (/api/label-format-profiles)
// =============================================================================
/**
 * @openapi
 * /api/label-format-profiles:
 *   get: { tags: [Printers], summary: Etiket format profili listesi, security: [{ bearerAuth: [] }], responses: { 200: { description: Liste } } }
 *   post: { tags: [Printers], summary: Etiket format profili oluştur, security: [{ bearerAuth: [] }], responses: { 201: { description: Oluşturuldu } } }
 */
export const labelFormatProfileRouter = Router();
labelFormatProfileRouter.get("/", verifyToken, requirePermission("station:read"), labelFormatProfileController.findAll);
labelFormatProfileRouter.get("/:id", verifyToken, requirePermission("station:read"), labelFormatProfileController.findById);
labelFormatProfileRouter.post("/", verifyToken, requirePermission("station:write"), labelFormatProfileController.create);
labelFormatProfileRouter.patch("/:id", verifyToken, requirePermission("station:write"), labelFormatProfileController.update);
labelFormatProfileRouter.delete("/:id", verifyToken, requirePermission("station:write"), labelFormatProfileController.remove);
labelFormatProfileRouter.delete("/:id/permanent", verifyToken, requirePermission("station:write"), labelFormatProfileController.hardRemove);
