import { createHashRouter, Navigate } from "react-router-dom";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";
import { LoginPage } from "@/pages/Login/LoginPage";
import { ForbiddenPage } from "@/pages/Forbidden/ForbiddenPage";
import { TotpEnrollPage } from "@/pages/TotpEnroll/TotpEnrollPage";
import { useAuthStore } from "@/store/auth";
import { canEnterApp } from "@/types/auth";
import { TOTP_ENROLL_PATH } from "@/lib/totp-enroll-url";

/**
 * Oturum-dışı (login/forbidden) router'ı. Yalnızca kullanıcı uygulamaya
 * giremediğinde mount edilir (bkz. App.tsx `Root` kapısı). Uygulama içeriği
 * artık burada DEĞİL — her sekme kendi memory router'ında yaşar
 * (`components/layout/tabs`). Dış katmanda data-router olmaması, sekme
 * router'larının iç içe geçmesini (React Router invariant'ı) önler.
 */
function AuthLanding() {
  const user = useAuthStore((s) => s.user);
  if (user && !canEnterApp(user.permissions)) {
    return <Navigate to="/forbidden" replace />;
  }
  return <Navigate to="/login" replace />;
}

export const authRouter = createHashRouter([
  { path: "/login", element: <LoginPage />, errorElement: <RouteErrorFallback /> },
  { path: "/forbidden", element: <ForbiddenPage />, errorElement: <RouteErrorFallback /> },
  // 2FA kurulumu — oturum GEREKTİRMEZ (sayfanın kendi başlığındaki gerekçe).
  // Yol sabiti `TOTP_ENROLL_PATH` ile paylaşılır; App.tsx kapısı da onu okur.
  { path: TOTP_ENROLL_PATH, element: <TotpEnrollPage />, errorElement: <RouteErrorFallback /> },
  { path: "*", element: <AuthLanding />, errorElement: <RouteErrorFallback /> },
]);
