import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { LICENSE_DETAIL_KEY } from "@/hooks/useLicenseStatus";
import { licenseService } from "@/services/licenseService";
import { ceilingAllowsField } from "@/lib/license/ceiling";
import type { ModuleFlagKey } from "@/lib/module-flags";

/**
 * "Lisansınızda yok" rozeti — UYGULANAN modül tavanından. Gözlemde tavan
 * uygulanmaz (backend `applies:false`), rozet hiç çizilmez (sıfır fark). Açma
 * denemesini backend `LICENSE_MODULE` ile reddeder; rozet yalnız önceden söyler.
 */
export function LicenseCeilingBadge({ field }: { field: ModuleFlagKey }) {
  const { hasAnyPermission } = useRoleAccess();
  const q = useQuery({
    queryKey: LICENSE_DETAIL_KEY,
    queryFn: licenseService.detail,
    enabled: hasAnyPermission(["license:view", "license:manage"]),
    staleTime: 60_000,
    retry: false,
  });
  const ceiling = q.data?.durum.uygulanan.modulTavani;
  if (!ceiling || ceilingAllowsField(ceiling, field)) return null;
  return (
    <Badge variant="destructive" data-testid={`lisansta-yok-${field}`}>
      Lisansınızda yok
    </Badge>
  );
}
