import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { canEnterApp } from "@/types/auth";
import { isSystemAccountIdentity } from "@/lib/superadmin-gate";

interface Props {
  children: React.ReactNode;
  requirePermission?: string;
  /** Bunlardan HERHANGİ biri yeterli (örn. muhasebe = shipping:read VEYA report:sales). */
  requireAnyPermission?: string[];
  /**
   * SATICI (süperadmin) kimliği şart mı? — izin DEĞİL KİMLİK kapısı.
   *
   * ⚠️ SUPAP TAŞIMAZ (kullanıcı kararı 2026-09-03): satıcı ekranı, sistem
   * hesabı hiç kurulmamış bir kurulumda da fabrikaya görünmez. Kilitlenme
   * riski yok çünkü modül anahtarlarının YAZMA yolu ayrı ve supaplı
   * (Genel Ayarlar → Modüller; bkz. `lib/superadmin-gate.ts`).
   */
  requireSystemAccount?: boolean;
}

export function ProtectedRoute({
  children,
  requirePermission,
  requireAnyPermission,
  requireSystemAccount,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const location = useLocation();

  if (!isHydrated) return null;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!canEnterApp(user.permissions)) {
    return <Navigate to="/forbidden" replace />;
  }

  if (requirePermission && !hasPermission(requirePermission)) {
    return <Navigate to="/forbidden" replace />;
  }

  if (requireAnyPermission && requireAnyPermission.length > 0 && !hasAnyPermission(requireAnyPermission)) {
    return <Navigate to="/forbidden" replace />;
  }

  // Kimlik kapısı izinlerden SONRA: yetkisiz kullanıcı zaten yukarıda elendi,
  // buraya gelen `admin:settings` sahibi fabrika yöneticisidir ve satıcı
  // ekranını adres çubuğundan da açamaz.
  if (requireSystemAccount && !isSystemAccountIdentity({ isSystemAccount, systemAccountExists })) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
