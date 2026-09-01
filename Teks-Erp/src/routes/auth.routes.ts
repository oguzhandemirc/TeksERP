// =============================================================================
// TeksERP - Auth Routes
// =============================================================================

import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { UserPreferenceController } from "../controllers/user-preference.controller";
import { verifyToken } from "../middlewares/auth.middleware";

const router = Router();

// Public (device-gated — global resolveDevice middleware + handler check)
router.post("/login", AuthController.login); // klasik (liste+şifre) — HEP açık (panel + acil kapı)
router.post("/login-card", AuthController.loginCard); // QR personel kartı ("card" etkinken)
router.post("/login-quick-pin", AuthController.loginQuickPin); // salt hızlı-PIN ("pin" etkinken)
router.get("/login-methods", AuthController.loginMethods); // login ekranı auth'suz okur
router.get("/mobile-users", AuthController.mobileUsers);

// İki adımlı doğrulama KURULUMU — public, korumanın kaynağı tek kullanımlık
// token'dır (yalnız `admin:users` üretebilir; bkz. TotpAccountService başlığı).
// ⚠️ Uzaktan erişim kapısı bu iki ucu KAPATMAZ ve kapatmamalıdır: kurulumu
// yapacak kişi tanımı gereği henüz uzaktan giriş YAPAMIYOR olan kişidir.
router.get("/totp/enroll", AuthController.totpEnrollRead);
router.post("/totp/enroll", AuthController.totpEnrollConsume);

// Protected
// K6 (2026-06-12): POST /register kaldırıldı — hiçbir istemci çağırmıyordu;
// kullanıcı oluşturmanın tek yolu POST /api/admin/users (permission-management).
router.get("/me", verifyToken, AuthController.me);
router.post("/logout", verifyToken, AuthController.logout);

// Self-service UI tercihleri (ekstra permission gerekmez — kendi kaydı)
router.get("/preferences", verifyToken, UserPreferenceController.getMine);
router.put("/preferences", verifyToken, UserPreferenceController.updateMine);

export default router;
