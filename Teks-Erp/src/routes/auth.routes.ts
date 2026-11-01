// =============================================================================
// TeksERP - Auth Routes
// =============================================================================

import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { UserPreferenceController } from "../controllers/user-preference.controller";
import { verifyToken, verifyTokenAllowPasswordChange } from "../middlewares/auth.middleware";

const router = Router();

// Public (device-gated — global resolveDevice middleware + handler check)
router.post("/login", AuthController.login); // klasik (liste+şifre) — HEP açık (panel + acil kapı)
router.post("/login-card", AuthController.loginCard); // QR personel kartı ("card" etkinken)
router.post("/login-quick-pin", AuthController.loginQuickPin); // salt hızlı-PIN ("pin" etkinken)
router.get("/login-methods", AuthController.loginMethods); // login ekranı auth'suz okur
router.get("/mobile-users", AuthController.mobileUsers);

// İki adımlı doğrulama KURULUMU — public, korumanın kaynağı tek kullanımlık
// token'dır (yalnız `admin:users` üretebilir; bkz. TotpAccountService başlığı).
router.get("/totp/enroll", AuthController.totpEnrollRead);
router.post("/totp/enroll", AuthController.totpEnrollConsume);

// Protected
// K6 (2026-06-12): POST /register kaldırıldı — hiçbir istemci çağırmıyordu;
// kullanıcı oluşturmanın tek yolu POST /api/admin/users (permission-management).
// Zorunlu parola değişimi bekleyen hesabın geçebildiği YALNIZ üç uç (kimlik, çıkış, değişim).
router.get("/me", verifyTokenAllowPasswordChange, AuthController.me);
router.post("/logout", verifyTokenAllowPasswordChange, AuthController.logout);
router.post("/change-password", verifyTokenAllowPasswordChange, AuthController.changePassword);

// Self-service UI tercihleri (ekstra permission gerekmez — kendi kaydı)
router.get("/preferences", verifyToken, UserPreferenceController.getMine);
router.put("/preferences", verifyToken, UserPreferenceController.updateMine);
// Kendi hesabında web girişi TOTP tercihi (2026-11-01) — yalnız KENDİ kaydı; başkası adına uç yok.
router.get("/web-totp", verifyToken, AuthController.webTotpGet);
router.put("/web-totp", verifyToken, AuthController.webTotpSet);
// Kendi hatırlanan cihazlarım (2026-11-01) — yalnız KENDİ kaydı; yönetici yolu /api/admin/users/:id/trusted-devices.
router.get("/trusted-devices", verifyToken, AuthController.trustedDevicesList);
router.post("/trusted-devices/revoke-all", verifyToken, AuthController.trustedDevicesRevokeAll);
router.post("/trusted-devices/:id/revoke", verifyToken, AuthController.trustedDeviceRevoke);

export default router;
