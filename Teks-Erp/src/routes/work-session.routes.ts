// =============================================================================
// TeksERP - Work Session Routes
// =============================================================================
// Mount: /api/work-sessions
//
// Çalışma oturumu (kim hangi makinede/istasyonda): mobil uçlar oturumlu ekran
// izinleriyle (MOBILE_SESSION_PERMS — work-session.service'ten tek kaynak),
// panel uçları (aktif liste / geçmiş / zorla kapat) admin:settings ile.
// =============================================================================

import { Router } from "express";
import { WorkSessionController } from "../controllers/work-session.controller";
import { MOBILE_SESSION_PERMS } from "../services/work-session.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const router = Router();

/**
 * @openapi
 * /api/work-sessions:
 *   post:
 *     tags: [Work Sessions]
 *     summary: Çalışma oturumu aç (makine XOR makinesiz istasyon)
 *     description: |
 *       req.device (x-device-id, ONAYLI cihaz) zorunlu. Body { machineId } VEYA
 *       { stationId } (yalnız makinesiz istasyon) — tam biri. Aynı cihazın açık
 *       oturumu NEW_LOGIN ile kapanır. Makine doluysa 409 MACHINE_OCCUPIED döner;
 *       { confirmTakeover: true } ile tekrar denenirse eski oturum TAKEOVER ile kapanır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oturum açıldı }
 *       409: { description: MACHINE_OCCUPIED (teyit gerekli) veya SESSION_RACE }
 */
router.post("/", verifyToken, requireAnyPermission(...MOBILE_SESSION_PERMS), WorkSessionController.open);

/**
 * @openapi
 * /api/work-sessions/close:
 *   post:
 *     tags: [Work Sessions]
 *     summary: Cihazın aktif oturumunu kapat (LOGOUT — idempotent)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ closed: boolean }" } }
 */
router.post("/close", verifyToken, requireAnyPermission(...MOBILE_SESSION_PERMS), WorkSessionController.close);

/**
 * @openapi
 * /api/work-sessions/current:
 *   get:
 *     tags: [Work Sessions]
 *     summary: Cihazın aktif oturumu + son yer (onay ekranı varsayılanı)
 *     description: active = tembel idle süpürmesinden geçmiş aktif oturum; lastPlace = son oturumun yeri (server-side hafıza).
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ active, lastPlace }" } }
 */
router.get("/current", verifyToken, requireAnyPermission(...MOBILE_SESSION_PERMS), WorkSessionController.current);

/**
 * @openapi
 * /api/work-sessions/places:
 *   get:
 *     tags: [Work Sessions]
 *     summary: Oturum açılabilir yerler (istasyon-gruplu aktif makine listesi)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: İstasyon + makine listesi } }
 */
router.get("/places", verifyToken, requireAnyPermission(...MOBILE_SESSION_PERMS), WorkSessionController.places);

/**
 * @openapi
 * /api/work-sessions/active:
 *   get:
 *     tags: [Work Sessions]
 *     summary: Canlı panel — tüm aktif oturumlar (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Aktif oturum listesi } }
 */
router.get(
  "/active",
  verifyToken,
  requireAnyPermission("admin:settings", "system:work-sessions"),
  WorkSessionController.listActive,
);

/**
 * @openapi
 * /api/work-sessions:
 *   get:
 *     tags: [Work Sessions]
 *     summary: Oturum geçmişi (ayak izi) — kullanıcı/cihaz/makine/istasyon/tarih filtreli
 *     description: Cihaz ayak izi (admin:settings) + kullanıcı ayak izi (admin:users) paylaşır.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Sayfalı oturum listesi } }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("admin:settings", "admin:users", "system:work-sessions"),
  WorkSessionController.history,
);

/**
 * @openapi
 * /api/work-sessions/{id}/activity:
 *   get:
 *     tags: [Work Sessions]
 *     summary: Oturum penceresindeki işlem dökümü (kronolojik — giriş/hata/işlem/çıkış)
 *     description: |
 *       İşlem Dökümü — migration'sız, saf okuma. Oturumun (startedAt..endedAt ?? now)
 *       penceresinde makine damgası (MACHINE, kesin) veya operatör+pencere eşleşmesi
 *       (OPERATOR_WINDOW, kesin cihaz kanıtı değil) ile atfedilen olaylar; RollMovement
 *       giriş/çıkış + RollError + RollOperation, kronolojik sırada. Oturum sınırlı
 *       olduğundan tek çekiş (truncated bayrağı üst sınırda). admin:settings VEYA admin:users.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ session, summary, events[] } + truncated" }
 *       404: { description: Oturum bulunamadı }
 */
router.get(
  "/:id/activity",
  verifyToken,
  requireAnyPermission("admin:settings", "admin:users", "system:work-sessions"),
  WorkSessionController.activity,
);

/**
 * @openapi
 * /api/work-sessions/{id}/force-close:
 *   post:
 *     tags: [Work Sessions]
 *     summary: Oturumu zorla kapat (ADMIN) — sahadaki cihaz bir sonraki işlemde yeniden onay ister
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kapatıldı }
 *       409: { description: Oturum zaten kapalı }
 */
router.post(
  "/:id/force-close",
  verifyToken,
  requireAnyPermission("admin:settings", "system:work-sessions"),
  WorkSessionController.forceClose,
);

export default router;
