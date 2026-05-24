// =============================================================================
// TeksERP - Auth Routes
// =============================================================================

import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const router = Router();

// Public
router.post("/login", AuthController.login);

// Protected
router.post("/register", verifyToken, requirePermission("admin:users"), AuthController.register);
router.get("/me", verifyToken, AuthController.me);
router.post("/logout", verifyToken, AuthController.logout);

export default router;
