// =============================================================================
// TeksERP - Auth Routes
// =============================================================================

import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { UserPreferenceController } from "../controllers/user-preference.controller";
import { verifyToken } from "../middlewares/auth.middleware";

const router = Router();

// Public (device-gated — global resolveDevice middleware + handler check)
router.post("/login", AuthController.login);
router.get("/mobile-users", AuthController.mobileUsers);

// Protected
// K6 (2026-06-12): POST /register kaldırıldı — hiçbir istemci çağırmıyordu;
// kullanıcı oluşturmanın tek yolu POST /api/admin/users (permission-management).
router.get("/me", verifyToken, AuthController.me);
router.post("/logout", verifyToken, AuthController.logout);

// Self-service UI tercihleri (ekstra permission gerekmez — kendi kaydı)
router.get("/preferences", verifyToken, UserPreferenceController.getMine);
router.put("/preferences", verifyToken, UserPreferenceController.updateMine);

export default router;
