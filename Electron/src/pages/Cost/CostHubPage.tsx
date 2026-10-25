import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { visibleCostTiles } from "./tile-config";

export function CostHubPage() {
  // Muhasebe hub'ıyla aynı kural: `isAdmin` kısa devresi YOK — izni olmayan karo görünmez.
  const { hasAnyPermission } = useRoleAccess();
  const visible = visibleCostTiles(hasAnyPermission);
  return (
    <PageShell>
      <PageHeader
        title="Maliyet & Teklif"
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
