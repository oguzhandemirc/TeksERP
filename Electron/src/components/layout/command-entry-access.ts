import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { useAuthStore } from "@/store/auth";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";
import { useLicenseScreenVisible } from "@/hooks/useLicenseStatus";
import type { CommandEntry } from "./command-entries.types";

/**
 * Kullanıcı bu katalog girişini AÇABİLİR mi — komut paleti ve yan menü alt öğeleri TEK süzgeç (izin + duruma
 * bağlı görünürlük + kimlik/lisans kapısı). İkisi ayrışırsa menüde görünüp /forbidden'a atan satır doğar.
 */
export function useCommandEntryAccess() {
  const { isAdmin, hasPermission, hasAnyPermission } = useRoleAccess();
  const visibilityCtx = useOperationsVisibilityContext();
  // Sistem hub'ının süzgeciyle AYNI kaynak (`lib/superadmin-gate.ts`).
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  const superadminGateOpen = isSuperadminGateOpen({ isSystemAccount, systemAccountExists });
  const licenseScreenVisible = useLicenseScreenVisible();

  const isAllowed = (entry: CommandEntry) => {
    // Durum süzgeci İZİNDEN ÖNCE: "bu ekranın şu an yapacağı iş var mı" sorusu izinden bağımsız, VE ile birleşir.
    if (entry.visibleWhen && !entry.visibleWhen(visibilityCtx)) return false;
    if (entry.superadminOnly && !superadminGateOpen) return false;
    if (entry.licenseObservationGate && !licenseScreenVisible) return false;
    if (entry.permissionAny) return hasAnyPermission(entry.permissionAny);
    if (entry.permission) return hasPermission(entry.permission);
    if (entry.adminOnly) return isAdmin;
    return true;
  };
  const labelOf = (entry: CommandEntry) => entry.labelWhen?.(visibilityCtx) ?? entry.label;
  return { isAllowed, labelOf, visibilityCtx, superadminGateOpen, licenseScreenVisible };
}
