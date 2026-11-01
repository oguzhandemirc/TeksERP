// Sistem sayfası uyarısı (2026-11-01): web girişi 2FA kullanıcı tercihine bırakıldıysa yöneticiye
// kaç kullanıcının kendi hesabında kapattığını söyler. REQUIRED / eski backend / yetkisiz → çizilmez.
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { adminUserService } from "@/services/adminUserService";
import { useRoleAccess } from "@/hooks/useRoleAccess";

export function WebTotpWarningBanner() {
  const { hasAnyPermission } = useRoleAccess();
  const allowed = hasAnyPermission(["admin:users", "admin:settings"]);
  const q = useQuery({
    queryKey: ["admin-web-totp-summary"],
    queryFn: adminUserService.getWebTotpSummary,
    enabled: allowed,
    retry: false,
    staleTime: 60_000,
  });
  const s = q.data?.data;
  if (!allowed || !s || s.policy !== "USER_CHOICE") return null;
  return (
    <div
      role="alert"
      data-testid="web-totp-uyari-bandi"
      className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        Web girişinde iki adımlı doğrulama kullanıcı tercihine bırakıldı —{" "}
        {s.optedOutCount > 0
          ? `${s.optedOutCount} kullanıcı web 2FA'yı kapattı (internetten yalnız parolayla girer).`
          : "henüz kapatan kullanıcı yok."}
      </span>
    </div>
  );
}
