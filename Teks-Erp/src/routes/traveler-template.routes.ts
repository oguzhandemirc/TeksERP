// =============================================================================
// Refakat Kartı Şablonu — rotalar (Şablon Stüdyosu, Faz 2)
// =============================================================================
// Controller'sız ince route (bilinçli istisna deseni) — Zod parse + servise delege.
//
// İZİN: okuma da yazma da `admin:settings`. YENİ İZİN AÇILMADI — bilinçli:
// bu ekranı kullanan kişi zaten "Belge Şablonları / Refakat Kartı Ayarları"nı
// düzenleyen kişidir ve o yüzey aynı izinle korunuyor. Yeni bir izin kodu, saha
// tarafında ATANMASI unutulabilecek bir adım daha demekti (2026-08-01 kurşun
// bypass vakası: ekran canlıya çıktı, izin satırı kimseye atanmadığı için
// görünmedi, teşhis saatler aldı). Ayrı bir "şablon tasarımcısı" rolü gerçekten
// doğarsa izin O ZAMAN ayrılır.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { travelerTemplateService } from "../services/traveler-template.service";
import "../types/express-augment";

const router = Router();

const modeSchema = z.enum(["BUILTIN", "SECTIONS", "RAW_HTML"]);
const upsertSchema = z.object({
  name: z.string().min(1, "Şablon adı gerekli").max(80).optional(),
  mode: modeSchema.optional(),
  // İç yapı servis katmanında normalizeTravelerCardConfig ile süzülür.
  config: z.record(z.string(), z.unknown()).optional(),
  html: z.string().max(200_000).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * @openapi
 * /api/traveler-templates:
 *   get:
 *     tags: [TravelerTemplates]
 *     summary: Refakat kartı şablonları (silinmemişler; varsayılan önce)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", verifyToken, requirePermission("admin:settings"), async (_req, res, next) => {
  try {
    res.json(await travelerTemplateService.list());
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/traveler-templates/inspect:
 *   post:
 *     tags: [TravelerTemplates]
 *     summary: Uzman HTML ön-denetimi — neyin kesileceği + bilinmeyen alanlar (UYARI, hata değil)
 *     security: [{ bearerAuth: [] }]
 */
router.post("/inspect", verifyToken, requirePermission("admin:settings"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { html } = z.object({ html: z.string().max(200_000) }).parse(req.body ?? {});
    res.json({ success: true, data: travelerTemplateService.inspect(html) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/traveler-templates/{id}:
 *   get:
 *     tags: [TravelerTemplates]
 *     summary: Tek şablon
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id", verifyToken, requirePermission("admin:settings"), async (req, res, next) => {
  try {
    assertValidUuid(req.params.id);
    res.json(await travelerTemplateService.findById(req.params.id as string));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/traveler-templates:
 *   post:
 *     tags: [TravelerTemplates]
 *     summary: Şablon oluştur (varsayılanlık AYRI uçtan verilir)
 *     security: [{ bearerAuth: [] }]
 */
router.post("/", verifyToken, requirePermission("admin:settings"), async (req, res, next) => {
  try {
    const body = upsertSchema.parse(req.body ?? {});
    res.status(201).json(await travelerTemplateService.create(body, req.user?.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/traveler-templates/{id}:
 *   patch:
 *     tags: [TravelerTemplates]
 *     summary: Şablon güncelle
 *     security: [{ bearerAuth: [] }]
 */
router.patch("/:id", verifyToken, requirePermission("admin:settings"), async (req, res, next) => {
  try {
    assertValidUuid(req.params.id);
    const body = upsertSchema.parse(req.body ?? {});
    res.json(await travelerTemplateService.update(req.params.id as string, body, req.user?.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/traveler-templates/{id}/default:
 *   post:
 *     tags: [TravelerTemplates]
 *     summary: Bu şablonu varsayılan yap (eski varsayılan düşer — tek tx)
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/default", verifyToken, requirePermission("admin:settings"), async (req, res, next) => {
  try {
    assertValidUuid(req.params.id);
    res.json(await travelerTemplateService.setDefault(req.params.id as string, req.user?.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/traveler-templates/default:
 *   delete:
 *     tags: [TravelerTemplates]
 *     summary: Varsayılanlığı kaldır — yerleşik kart basılır (şablon silinmez)
 *     security: [{ bearerAuth: [] }]
 */
router.delete("/default", verifyToken, requirePermission("admin:settings"), async (req, res, next) => {
  try {
    res.json(await travelerTemplateService.clearDefault(req.user?.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/traveler-templates/{id}:
 *   delete:
 *     tags: [TravelerTemplates]
 *     summary: Şablonu sil (soft) — BASILMIŞ kartlar etkilenmez (şablon karta donmuştur)
 *     security: [{ bearerAuth: [] }]
 */
router.delete("/:id", verifyToken, requirePermission("admin:settings"), async (req, res, next) => {
  try {
    assertValidUuid(req.params.id);
    res.json(await travelerTemplateService.remove(req.params.id as string, req.user?.userId));
  } catch (err) {
    next(err);
  }
});

export default router;
