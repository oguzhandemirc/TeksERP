import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { reportTiles } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function ReportsHubPage() {
  const { isAdmin, hasPermission } = useRoleAccess();
  const tiles = reportTiles.filter(
    (t) => isAdmin || !t.permission || hasPermission(t.permission),
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Raporlar"
        description="Üretim, sipariş, kalite, stok, fason, müşteri ve sistem raporları."
      />
      <div className="p-6">
        <HubGrid>
          {tiles.map((tile, i) => (
            <HubCard
              key={tile.key}
              to={tile.to}
              title={tile.title}
              description={tile.description}
              icon={tile.icon}
              index={i}
            />
          ))}
        </HubGrid>
      </div>
    </div>
  );
}
