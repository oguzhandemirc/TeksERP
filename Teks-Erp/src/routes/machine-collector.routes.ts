// =============================================================================
// TeksERP — MAKİNE KARTI (toplayıcı) yönetim uçları (makine kaynaklı duruş D3a) · /api/machine-collectors
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireTezgahEnabled` → `loom:spec-manage` (tezgah künyesiyle
// aynı yetenek; yeni izin kodu yok). Sır yalnız kayıt ve yenileme cevabında döner; okuma uçları
// izdüşümdür (tohum yok). Kartın kendi ucu ayrı router: `machine-signal.routes.ts`.
// =============================================================================
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireTezgahEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { MachineCollectorService } from "../services/machine-collector.service";

const router = Router();
router.use(verifyToken, requireTezgahEnabled);
const guard = requirePermission("loom:spec-manage");

/**
 * @openapi
 * /api/machine-collectors:
 *   get:
 *     tags: [MachineCollectors]
 *     summary: Makine kartları (ad · kart tipi · bağlı tezgahlar · sır veriliş zamanı) — sır/tohum dönmez
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Tezgah modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *   post:
 *     tags: [MachineCollectors]
 *     summary: Kart kaydet — allowlist (name · collectorType · machineIds); sır YALNIZ bu cevapta döner
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "Kaydedildi — { collector, secret } (secret 64 hex, bir daha gösterilmez)" }
 *       400: { description: Tanınmayan alan · biçim · tezgah yok/pasif (MACHINE_NOT_FOUND · MACHINE_INACTIVE) }
 *       409: { description: Tezgah başka karta bağlı (MACHINE_ALREADY_LINKED) · ad dolu (COLLECTOR_NAME_TAKEN) }
 *       503: { description: Anahtar halkası yok (SHORT_CREDENTIAL_KEY_UNAVAILABLE) }
 */
router.get("/", guard, async (_req, res, next) => {
  try {
    res.json(await MachineCollectorService.list());
  } catch (e) {
    next(e);
  }
});
router.post("/", guard, async (req, res, next) => {
  try {
    res.status(201).json(await MachineCollectorService.create(req.body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-collectors/{id}:
 *   get:
 *     tags: [MachineCollectors]
 *     summary: Kart detayı (sır/tohum dönmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Detay }
 *       404: { description: Bulunamadı }
 *   patch:
 *     tags: [MachineCollectors]
 *     summary: Ad · kart tipi · bağlı tezgahlar (liste verilirse yerine konur)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Tanınmayan alan · biçim · tezgah yok/pasif }
 *       409: { description: COLLECTOR_REVOKED · MACHINE_ALREADY_LINKED · COLLECTOR_NAME_TAKEN }
 */
router.get("/:id", guard, async (req, res, next) => {
  try {
    res.json(await MachineCollectorService.get(assertValidUuid(req.params.id, "id")));
  } catch (e) {
    next(e);
  }
});
router.patch("/:id", guard, async (req, res, next) => {
  try {
    res.json(await MachineCollectorService.update(assertValidUuid(req.params.id, "id"), req.body, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-collectors/{id}/rotate-secret:
 *   post:
 *     tags: [MachineCollectors]
 *     summary: Sırrı yenile — eski sır o an geçersiz; yeni sır YALNIZ bu cevapta döner
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ collector, secret }" }
 *       404: { description: Bulunamadı }
 *       409: { description: İptal edilmiş kart (COLLECTOR_REVOKED) }
 */
router.post("/:id/rotate-secret", guard, async (req, res, next) => {
  try {
    res.json(await MachineCollectorService.rotateSecret(assertValidUuid(req.params.id, "id"), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-collectors/{id}/revoke:
 *   post:
 *     tags: [MachineCollectors]
 *     summary: Kartı iptal et — imza atamaz, tezgah bağları çözülür (durum geçişi, silme değil)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: İptal edildi }
 *       404: { description: Bulunamadı }
 *       409: { description: Zaten iptal (COLLECTOR_REVOKED) }
 */
router.post("/:id/revoke", guard, async (req, res, next) => {
  try {
    res.json(await MachineCollectorService.revoke(assertValidUuid(req.params.id, "id"), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
