import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { canEnterApp } from "@/types/auth";

interface Props {
  children: React.ReactNode;
  requirePermission?: string;
}

export function ProtectedRoute({ children, requirePermission }: Props) {
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const { hasPermission } = useRoleAccess();
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

  return <>{children}</>;
}
