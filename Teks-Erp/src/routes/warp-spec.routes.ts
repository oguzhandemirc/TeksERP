// =============================================================================
// TeksERP — Çözgü Kartı (WarpSpec) Routes · devere modülü
// =============================================================================
// Çözgü kartı ana veridir; CRUD `BaseController` üzerinden koşar.
//
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDevereEnabled` (modül rejimi — YALNIZ
// devere; iplik/ticaret bağımlılığı YOK, §9.7d / 1e K3 2026-09-14) → `requirePermission`
// (kişi bunu yapabilir mi). Modül kapısı izin kapısının YERİNE GEÇMEZ: bayrak
// "bu kurulum bu modülü kullanıyor mu", izin "bu kişi bunu yapabilir mi".
// Jenerik `requireModule("devere")` YASAK — kapı varlığı middleware'in ADIYLA
// ölçülüyor (`test_devere_regime_gate`, `test_screen_catalog §10`).
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { WarpSpecService } from "../services/warp-spec.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled } from "../middlewares/module.middleware";

export const warpSpecService = new WarpSpecService({
  modelName: "warpSpec",
  tableName: "WARP_SPEC",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  // Liste ekranı "hangi iplikten" sorusunu kod/ad olmadan cevaplayamaz.
  defaultInclude: { yarnItem: { select: { id: true, code: true, name: true, linearDensityDen: true } } },
  uniqueField: "code",
  // Kod ELLE girilir (desen kodu saha dilidir: "UA6007-Ç"); autoCode YOK.
  duplicateNameField: "name",
});

const controller = new BaseController(warpSpecService);
const router = Router();

router.use(verifyToken, requireDevereEnabled);

/**
 * @openapi
 * /api/warp-specs:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı listesi (devere modülü)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("warpspec:read"), controller.findAll);

/**
 * @openapi
 * /api/warp-specs/similar-names:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: Benzer ad uyarısı (mükerrer kart açmadan önce)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Benzer adlar }
 */
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar, `assertValidUuid` 400 verir ve panelde geliştirici jargonlu bir toast
// çıkar (uyarı ise hiç çizilmez). On üç ana veri router'ında emsali var.
router.get("/similar-names", requirePermission("warpspec:write"), controller.similarNames);

/**
 * @openapi
 * /api/warp-specs/{id}:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("warpspec:read"), controller.findById);

/**
 * @openapi
 * /api/warp-specs:
 *   post:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı oluştur
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Tel adedi ≤ 0 · iplik İPLİK değil · denye boş }
 */
router.post("/", requirePermission("warpspec:write"), controller.create);

/**
 * @openapi
 * /api/warp-specs/{id}:
 *   patch:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı güncelle (kısmi)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 */
// PATCH (PUT değil): panelin `crudService.update`i PATCH atıyor ve master-data
// CRUD'un tamamı bu fiili kullanıyor (`color.routes.ts` emsali).
router.patch("/:id", requirePermission("warpspec:write"), controller.update);

/**
 * @openapi
 * /api/warp-specs/{id}:
 *   delete:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartını pasife al (soft delete)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", requirePermission("warpspec:write"), controller.remove);

export default router;
