import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/store/auth";

/**
 * Satıcı hesabı hâlâ her kurulumda AYNI olan varsayılan parolayla duruyor: kırmızı şerit,
 * kapatılamaz. Ölçüt sunucuda (`defaultSuperadminPasswordPending`); parola değişince kalkar.
 */
export function DefaultSuperadminBanner() {
  const pending = useAuthStore((s) => s.defaultSuperadminPasswordPending);
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  if (!pending) return null;
  return (
    <div
      role="alert"
      data-testid="varsayilan-superadmin-bandi"
      className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {isSystemAccount
          ? "Bu hesap hâlâ ortak varsayılan parolayla duruyor — hemen kendi parolanızı belirleyin."
          : "Destek hesabı hâlâ ortak varsayılan parolayla duruyor — satıcınızdan parolayı değiştirmesini isteyin."}
      </span>
    </div>
  );
}
