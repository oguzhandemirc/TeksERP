// =============================================================================
// Refakat Kartı Şablonu — rotalar (Şablon Stüdyosu, Faz 2)
// =============================================================================
// Controller'sız ince route (bilinçli istisna deseni) — Zod parse + servise delege.
//
// İZİN (2026-08-05 revizyonu): okuma `DOCUMENT_DESIGN_READ`, yazma
// `DOCUMENT_DESIGN_WRITE` — ikisi de `admin:settings`i OR ile kapsar, yani
// bugün erişebilen herkes erişmeye devam eder (bkz. constants/document-design.ts).
//
// Eskiden ikisi de düz `admin:settings` idi ve buradaki not "YENİ İZİN
// AÇILMADI — ayrı bir şablon tasarımcısı rolü gerçekten doğarsa O ZAMAN
// ayrılır" diyordu. O rol doğdu: şablonu düzenleyen büro personeline oturum
// politikasını, yedek saatini, cihaz onayını ve log arşivini de açmak
// gerekiyordu. 2026-08-01 kurşun bypass vakasının dersi (izin satırı
// atanmadığı için ekran görünmedi) burada `admin:settings`i OR'da tutarak
// karşılanıyor — yeni izin ATANMAZSA hiçbir şey bozulmaz, yalnız dar
// yetkilendirme imkânı kullanılmamış olur.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { DOCUMENT_DESIGN_READ, DOCUMENT_DESIGN_WRITE } from "../constants/document-design";
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
router.get("/", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_READ), async (_req, res, next) => {
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
router.post("/inspect", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_READ), (req: Request, res: Response, next: NextFunction) => {
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
router.get("/:id", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_READ), async (req, res, next) => {
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
router.post("/", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_WRITE), async (req, res, next) => {
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
router.patch("/:id", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_WRITE), async (req, res, next) => {
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
router.post("/:id/default", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_WRITE), async (req, res, next) => {
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
router.delete("/default", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_WRITE), async (req, res, next) => {
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
router.delete("/:id", verifyToken, requireAnyPermission(...DOCUMENT_DESIGN_WRITE), async (req, res, next) => {
  try {
    assertValidUuid(req.params.id);
    res.json(await travelerTemplateService.remove(req.params.id as string, req.user?.userId));
  } catch (err) {
    next(err);
  }
});

export default router;
