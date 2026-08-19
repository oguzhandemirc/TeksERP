// =============================================================================
// HAZIR SEBEP KATALOĞU — ROTALAR (2026-08-19)
// =============================================================================
// Dört liste (fire · kayıt düzeltmesi · elle top ekleme · top iptali) tek uçtan
// okunur/yazılır.
//
// ── İZİN FORMÜLÜ (yeni izin kodu ÜRETİLMEDİ, bilinçli) ──────────────────────
// OKUMA: yalnız `verifyToken`. Liste zaten her operatör ekranında çiziliyor;
//   ayrı bir okuma izni koymak, izni atanmamış her tablette Tambur'un sebep
//   adımını 403'e düşürürdü — yani özelliğin kendisini kırardı.
// YAZMA: `roll:manual-adjust` (masaüstü süpervizör) VEYA `mobile:tambur-duzelt`
//   (tablette saha düzeltmesi yetkisi olan kişi). İkisi de ZATEN "veriyi elle
//   düzeltebilen güvenilir kişi" anlamına geliyor ve zaten atanmış durumda.
//   Yeni bir kod (`reason-catalog:write`) eklemek, sahada ATANMASI UNUTULACAK
//   bir adım daha demekti — 2026-08-01 kurşun bypass vakasının dersi birebir bu.
//
// ⚠️ Katalog panelden düzenlenir ama SİLİNMEZ: sistem satırı gizlenir
// (`isActive=false`), fabrikanın satırı da öyle. Sert silme, geçmiş kayıtların
// etiketini öksüz bırakırdı.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ReasonPresetKind } from "@prisma/client";

import { ReasonPresetService } from "../services/reason-preset.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const router = Router();

/** Katalogu DÜZENLEYEBİLEN kişi — tek yerde, dört uçta aynısı. */
const canEdit = requireAnyPermission("roll:manual-adjust", "mobile:tambur-duzelt");

const kindSchema = z.nativeEnum(ReasonPresetKind);

const createSchema = z.object({
  kind: kindSchema,
  label: z.string().trim().min(2).max(120),
  fullText: z.string().trim().max(500).optional().nullable(),
  requiresText: z.boolean().optional(),
});

const updateSchema = z.object({
  label: z.string().trim().min(2).max(120).optional(),
  fullText: z.string().trim().max(500).optional().nullable(),
  requiresText: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const duplicateSchema = z.object({
  label: z.string().trim().min(2).max(120).optional(),
});

const reorderSchema = z.object({
  kind: kindSchema,
  ids: z.array(z.string().uuid()).min(1),
});

/**
 * @openapi
 * /api/reason-presets:
 *   get:
 *     tags: [ReasonPresets]
 *     summary: Hazır sebep listeleri (fire · kayıt düzeltmesi · elle ekleme · iptal)
 *     description: |
 *       Varsayılan yalnız AKTİF satırları döner (operatör ekranı).
 *       `?includeInactive=true` düzenleme yüzeyi içindir — gizlenmiş satırlar da gelir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sebep listesi }
 */
router.get("/", verifyToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = req.query.kind ? kindSchema.parse(req.query.kind) : undefined;
    res.status(200).json(
      await ReasonPresetService.list({
        kind,
        includeInactive: req.query.includeInactive === "true",
      }),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reason-presets:
 *   post:
 *     tags: [ReasonPresets]
 *     summary: Yeni hazır sebep ekle (kod etiketten türetilir, sonradan değişmez)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 */
router.post("/", verifyToken, canEdit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    res.status(201).json(await ReasonPresetService.create(body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reason-presets/reorder:
 *   patch:
 *     tags: [ReasonPresets]
 *     summary: Liste sırasını kaydet (tüm id'ler sırasıyla gönderilir)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yeni sıra }
 */
router.patch("/reorder", verifyToken, canEdit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = reorderSchema.parse(req.body);
    res.status(200).json(await ReasonPresetService.reorder(body.kind, body.ids, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reason-presets/{id}/duplicate:
 *   post:
 *     tags: [ReasonPresets]
 *     summary: Sebebi çoğalt (kaynağın hemen altına, yeni kodla)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Kopya }
 */
router.post("/:id/duplicate", verifyToken, canEdit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = duplicateSchema.parse(req.body ?? {});
    res.status(201).json(
      await ReasonPresetService.duplicate(req.params.id as string, body.label, req.user?.userId),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reason-presets/{id}:
 *   patch:
 *     tags: [ReasonPresets]
 *     summary: Etiketi düzenle / gizle (kod ve tür DEĞİŞMEZ)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Son aktif satır gizlenemez }
 */
router.patch("/:id", verifyToken, canEdit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    res.status(200).json(
      await ReasonPresetService.update(req.params.id as string, body, req.user?.userId),
    );
  } catch (e) {
    next(e);
  }
});

export default router;
