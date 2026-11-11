import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { visibleCostTiles } from "./tile-config";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { isHubTileHidden } from "@/lib/menu-layout";
import { SALES_COST_TILE_KEYS } from "@/pages/Operations/sections";

export function CostHubPage() {
  // Muhasebe hub'ıyla aynı kural: `isAdmin` kısa devresi YOK — izni olmayan karo görünmez.
  const { hasAnyPermission } = useRoleAccess();
  const menu = useMenuLayout();
  const ctx = useOperationsVisibilityContext();
  // T5: Teklifler menüde Satış bölümünde (`SALES_COST_TILE_KEYS`) — burada çizilmez.
  const visible = visibleCostTiles(hasAnyPermission, (to) => isRouteModuleOpen(to, ctx))
    .filter((t) => !isHubTileHidden(menu, t.to) && !SALES_COST_TILE_KEYS.includes(t.key));
  return (
    <PageShell>
      <PageHeader
        title="Maliyet"
        description="Kumaşın metre maliyeti: parametreler, iplik fiyatları, fason tarifeleri ve ürün başına standart maliyet. Her sayı sunucuda hesaplanır."
      />
      <PageBody className="p-4 sm:p-6">
        <HubGrid>
          {visible.map((tile, i) => (
            <HubCard key={tile.key} to={tile.to} title={tile.title} description={tile.description} icon={tile.icon} tone={tile.tone} index={i} />
          ))}
        </HubGrid>
      </PageBody>
    </PageShell>
  );
}
