// Kumaş kartından maliyet kartına geçiş (MAL-3). Yalnız KUMAŞ + Maliyet modülü açık + `cost:read`: üçünden biri
// yoksa hiçbir maliyet yüzeyi çizilmez (modül kapalı fabrikada link bile görünmez).
import { Link } from "react-router-dom";
import { Calculator } from "lucide-react";
import { useMaliyetEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";

export function ItemCostLink({ itemId, itemType }: { itemId: string; itemType: string }) {
  const enabled = useMaliyetEnabled();
  const { hasPermission } = useRoleAccess();
  if (itemType !== "FABRIC" || !enabled || !hasPermission("cost:read")) return null;
  return (
    <div className="mb-2 flex justify-end">
      <Link to={`/cost/items/${itemId}`} className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
        <Calculator className="h-4 w-4" />
        Maliyet kartı
      </Link>
    </div>
  );
}
