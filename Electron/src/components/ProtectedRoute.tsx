import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { canEnterApp } from "@/types/auth";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";

interface Props {
  children: React.ReactNode;
  requirePermission?: string;
  /** Bunlardan HERHANGİ biri yeterli (örn. muhasebe = shipping:read VEYA report:sales). */
  requireAnyPermission?: string[];
  /**
   * SATICI (süperadmin) kimliği şart mı? — izin DEĞİL KİMLİK kapısı.
   *
   * ⚠️ SUPAP TAŞIR (2026-09-04): modül anahtarlarının İKİNCİ yazma yolu
   * (Genel Ayarlar → Modüller sekmesi) kaldırıldığı için supapsız bir kapı
   * artık KİLİTLENME üretir — süperadmin hesabı doğmamış kurulum modülleri bir
   * daha açamaz. Yüklem tek kaynaktan: `lib/superadmin-gate.ts`.
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
  // ekranını adres çubuğundan da açamaz — süperadmin hesabı DOĞMUŞSA.
  if (requireSystemAccount && !isSuperadminGateOpen({ isSystemAccount, systemAccountExists })) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
